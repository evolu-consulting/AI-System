"""Subscriptions, outbox, signed webhooks and a long-poll pull (docs/multi-agent-instance-design.md 4.13, 3.6).

Subscriptions come from the namespace manifest (``subscriptions: [{sub_id, kinds, url, secret_ref?, state?}]``,
stored by the registry in kh_subscription). ``kinds`` filters event kinds: an exact kind, a prefix pattern
``run.*`` / ``kh.*``, or ``*`` for every kind.

FAN-OUT (cursor based, no hook in events.py). kh_outbox_cursor(ns, sub_id).last_seq is the last event seq that
was turned into outbox rows for that subscription. One fan-out step locks the cursor row (UPDATE first), reads
the events after it, inserts one kh_outbox row per matching event (delivery_id = '<sub_id>:<seq>', PK
(ns, delivery_id), so a repeat insert is a no-op) and moves the cursor - all in ONE transaction. Event seqs are
gapless and commit in seq order (events.py), so a cursor read never skips an event: nothing is lost, and each
(subscription, event) gets exactly one outbox row. A new subscription starts at the current end of the stream.

DELIVERY. A worker (cron under the KH lease 'outbox_deliver', any instance) claims due rows with a conditional
``UPDATE ... SET state='claimed', claim_token=?, claimed_until_ms=now+30 s WHERE delivery_id IN (SELECT ...
LIMIT n) AND <still due>``; only the claimer's token can finish a row, so one instance delivers each row
(an expired claim is taken over: at least once). Each delivery is a POST with a 10 s timeout and headers
``X-KH-Delivery``, ``X-KH-Namespace``, ``X-KH-Subscription``, ``X-KH-Event-Seq``, ``X-KH-Timestamp`` (epoch ms)
and ``X-KH-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>." + body)>`` (see ``verify``). 2xx = done;
otherwise retry after 1 s, 2 s, 4 s ... capped at 1 h; after 12 attempts the row is ``dead``.
DEDUPE KEY: ``(namespace, delivery id)``. A delivery id ``<sub_id>:<seq>`` is unique only inside its
namespace; a receiver that serves several namespaces (an imported copy keeps the manifest's url) sees the same
ids from each. The body (signed) carries ``ns`` and ``delivery_id`` too; ``X-KH-Namespace`` mirrors ``ns``.

SSRF GUARD. Targets must be https (http only for http://127.0.0.1 with KH_OUTBOX_ALLOW_LOCAL=1, for tests).
The host is resolved once; every address must be globally routable (no private, loopback, link-local, metadata,
CGNAT, multicast, reserved or unspecified address, IPv4-mapped included), and the connection goes to that
checked address (no second lookup, no redirects). Optional per-namespace host allowlist: manifest
``settings.webhook_hosts``. A refused target is a permanent failure: the row is dead with ``unsafe_target``.

NAMESPACE STATE. Fan-out and delivery only run for ``active`` namespaces. Detaching a namespace turns its
pending and claimed rows dead with reason ``detached`` (registry.ON_STATE, same transaction); re-attaching it
makes exactly those rows pending again, so an event that was in flight at the detach is still delivered.

SECRETS. ``secret_ref: "env:NAME"`` reads the secret from the environment; otherwise KH generates one per
subscription (kh_outbox_secret), readable and rotatable by the namespace admin.

Routes (namespace admin unless noted):
  GET  /v1/{ns}/subscriptions                               subscriptions with cursors and row counts
  GET  /v1/{ns}/subscriptions/{sub_id}/secret               the signing secret (409 secret_external for env:)
  POST /v1/{ns}/subscriptions/{sub_id}/secret/rotate
  GET  /v1/{ns}/outbox?state=&sub_id=&limit=                outbox rows
  POST /v1/{ns}/outbox/{delivery_id}/retry                  dead -> pending
  GET  /v1/{ns}/subscriptions/{sub_id}/pull?after_seq=&limit=&wait_s=   long poll (events read)
  POST /v1/{ns}/subscriptions/{sub_id}/ack  {"after_seq": n}           move the pull cursor (events read)

New error codes (explicit status, not in core.CODES): ``unsafe_target`` 422, ``secret_external`` 409.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import http.client
import ipaddress
import json
import logging
import os
import secrets
import socket
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core, registry
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "outbox"
VERSION = "1.0.0"
STATUS = "beta"
CLAIM_MS = 30_000
CLAIM_MAX = 24                 # rows per claim: 24 rows / 8 workers x 10 s timeout stays inside the 30 s claim
WORKERS = 8
TIMEOUT_S = 10
MAX_ATTEMPTS = 12
BACKOFF_MIN_S = 1
BACKOFF_MAX_S = 3600
FANOUT_BATCH = 500
PULL_MAX = 1000
WAIT_MAX_S = 25
DONE_KEEP_DAYS = 7
LIMITS = {"claim_ms": CLAIM_MS, "timeout_s": TIMEOUT_S, "max_attempts": MAX_ATTEMPTS, "backoff_s": [BACKOFF_MIN_S,
          BACKOFF_MAX_S], "pull_limit": PULL_MAX, "long_poll_s": WAIT_MAX_S}
STATES = ("pending", "claimed", "done", "dead")

_DDL = {
    "kh_outbox": ("""CREATE TABLE IF NOT EXISTS kh_outbox (
                       ns TEXT NOT NULL, delivery_id TEXT NOT NULL, sub_id TEXT NOT NULL, event_seq INTEGER NOT NULL,
                       attempts INTEGER NOT NULL DEFAULT 0, next_ms INTEGER NOT NULL, state TEXT NOT NULL,
                       claim_token TEXT, claimed_until_ms INTEGER, last_status INTEGER, last_error TEXT,
                       created_ms INTEGER NOT NULL, done_ms INTEGER, PRIMARY KEY (ns, delivery_id))""",
                  """CREATE COLUMN TABLE kh_outbox (
                       ns NVARCHAR(32) NOT NULL, delivery_id NVARCHAR(96) NOT NULL, sub_id NVARCHAR(64) NOT NULL,
                       event_seq BIGINT NOT NULL, attempts BIGINT NOT NULL, next_ms BIGINT NOT NULL,
                       state NVARCHAR(16) NOT NULL, claim_token NVARCHAR(64), claimed_until_ms BIGINT,
                       last_status BIGINT, last_error NVARCHAR(512), created_ms BIGINT NOT NULL, done_ms BIGINT,
                       PRIMARY KEY (ns, delivery_id))"""),
    "kh_outbox_cursor": ("""CREATE TABLE IF NOT EXISTS kh_outbox_cursor (
                              ns TEXT NOT NULL, sub_id TEXT NOT NULL, last_seq INTEGER NOT NULL,
                              pull_seq INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 1,
                              PRIMARY KEY (ns, sub_id))""",
                         """CREATE COLUMN TABLE kh_outbox_cursor (
                              ns NVARCHAR(32) NOT NULL, sub_id NVARCHAR(64) NOT NULL, last_seq BIGINT NOT NULL,
                              pull_seq BIGINT NOT NULL, rev BIGINT NOT NULL, PRIMARY KEY (ns, sub_id))"""),
    "kh_outbox_secret": ("""CREATE TABLE IF NOT EXISTS kh_outbox_secret (
                              ns TEXT NOT NULL, sub_id TEXT NOT NULL, secret TEXT NOT NULL, created_ms INTEGER NOT NULL,
                              PRIMARY KEY (ns, sub_id))""",
                         """CREATE COLUMN TABLE kh_outbox_secret (
                              ns NVARCHAR(32) NOT NULL, sub_id NVARCHAR(64) NOT NULL, secret NVARCHAR(128) NOT NULL,
                              created_ms BIGINT NOT NULL, PRIMARY KEY (ns, sub_id))"""),
}


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ix_kh_outbox_due", "kh_outbox", "state, next_ms")
    sqldb.create_index(c, "ix_kh_outbox_sub", "kh_outbox", "ns, sub_id, state")
    sqldb.create_index(c, "ix_kh_outbox_claim", "kh_outbox", "claim_token")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


def unsafe(detail: str) -> CapError:
    return CapError("unsafe_target", detail, status=422)


# ── subscriptions and kind filters ───────────────────────────────────────────

def matches(kinds: list, kind: str) -> bool:
    """``*`` = every kind; ``a.*`` = every kind starting with ``a.``; otherwise exact."""
    for k in kinds or []:
        if not isinstance(k, str):
            continue
        if k == "*" or k == kind or (k.endswith(".*") and kind.startswith(k[:-1])):
            return True
    return False


def _sub_row(r) -> dict:
    return {"sub_id": r["sub_id"], "kinds": json.loads(r["kinds_json"] or "[]"), "url": r["url"],
            "secret_ref": r["secret_ref"], "state": r["state"]}


def subscriptions(c, ns: str) -> list[dict]:
    return [_sub_row(r) for r in c.execute("SELECT * FROM kh_subscription WHERE ns=? ORDER BY sub_id", [ns]).fetchall()]


def _subscription(c, ns: str, sub_id: str) -> dict | None:
    r = c.execute("SELECT * FROM kh_subscription WHERE ns=? AND sub_id=?", [ns, sub_id]).fetchone()
    return _sub_row(r) if r else None


def _ensure_cursor(c, ns: str, sub_id: str) -> None:
    """A new subscription starts at the current end of the event stream (no backfill for webhooks)."""
    if c.execute("SELECT 1 FROM kh_outbox_cursor WHERE ns=? AND sub_id=?", [ns, sub_id]).fetchone():
        return
    top = sqldb.counter_get(c, "ev:" + ns)
    sqldb.insert_new(c, "kh_outbox_cursor", {"ns": ns, "sub_id": sub_id, "last_seq": int(top or 0), "pull_seq": 0,
                                             "rev": 1})


def _on_manifest(c, ns: str, norm: dict) -> None:
    """A subscription added by a manifest starts its cursor at the stream end AS OF the apply (same transaction)."""
    for sub in norm.get("subscriptions") or []:
        _ensure_cursor(c, ns, sub["sub_id"])


# ── fan-out: event store -> outbox ───────────────────────────────────────────

def fanout_sub(ns: str, sub: dict) -> int:
    """Move one subscription's cursor forward by up to FANOUT_BATCH events; returns rows created."""
    with sqldb.connect() as c:
        _ensure_cursor(c, ns, sub["sub_id"])
    with sqldb.connect() as c:
        # Lock the cursor row first: concurrent fan-outs of one subscription serialize here.
        if not sqldb.update(c, "UPDATE kh_outbox_cursor SET rev=rev+1 WHERE ns=? AND sub_id=?", [ns, sub["sub_id"]]):
            return 0
        if not c.execute("SELECT 1 FROM kh_ns WHERE ns=? AND state='active'", [ns]).fetchone():
            return 0
        cur = int(c.execute("SELECT last_seq FROM kh_outbox_cursor WHERE ns=? AND sub_id=?",
                            [ns, sub["sub_id"]]).fetchone()[0])
        evs = c.execute("SELECT seq, kind FROM kh_event WHERE ns=? AND seq>? ORDER BY seq LIMIT ?",
                        [ns, cur, FANOUT_BATCH]).fetchall()
        if not evs:
            return 0
        now = sqldb.now_ms(c)
        made = 0
        for e in evs:
            if matches(sub["kinds"], e["kind"]):
                made += sqldb.insert_new(c, "kh_outbox", {
                    "ns": ns, "delivery_id": f"{sub['sub_id']}:{int(e['seq'])}", "sub_id": sub["sub_id"],
                    "event_seq": int(e["seq"]), "attempts": 0, "next_ms": now, "state": "pending",
                    "claim_token": None, "claimed_until_ms": None, "last_status": None, "last_error": None,
                    "created_ms": now, "done_ms": None})
        last = int(evs[-1]["seq"])
        if not sqldb.update(c, "UPDATE kh_outbox_cursor SET last_seq=? WHERE ns=? AND sub_id=? AND last_seq=?",
                            [last, ns, sub["sub_id"], cur]):
            raise RuntimeError("outbox cursor moved under its own lock")      # rolls back the inserts
    return made


def fanout_all() -> int:
    """Every active subscription of every active namespace, until each cursor is at the end."""
    with sqldb.connect() as c:
        rows = c.execute("SELECT s.* FROM kh_subscription s JOIN kh_ns n ON n.ns=s.ns "
                         "WHERE n.state='active' AND s.state='active'").fetchall()
        subs = [(r["ns"], _sub_row(r)) for r in rows]
    total = 0
    for ns, sub in subs:
        for _ in range(100):
            n = fanout_sub(ns, sub)
            total += n
            with sqldb.connect() as c:
                cur = c.execute("SELECT last_seq FROM kh_outbox_cursor WHERE ns=? AND sub_id=?",
                                [ns, sub["sub_id"]]).fetchone()
                top = sqldb.counter_get(c, "ev:" + ns)
            if cur is None or int(cur[0]) >= int(top or 0):
                break
    return total


# ── the SSRF guard ───────────────────────────────────────────────────────────

def _allow_local() -> bool:
    return config._env("KH_OUTBOX_ALLOW_LOCAL", "0") == "1"


def _ip_ok(ip: ipaddress._BaseAddress, local_ok: bool) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if local_ok and ip.is_loopback:
        return True
    if not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified or ip.is_link_local:
        return False
    return str(ip) not in ("169.254.169.254", "100.100.100.200", "fd00:ec2::254")


def check_target(url: str, allow_hosts: list | None = None, resolve=socket.getaddrinfo) -> tuple[str, str, int, str]:
    """(scheme, host, port, checked ip) or CapError unsafe_target. Resolves the host exactly once."""
    try:
        u = urlsplit(url)
        port = u.port
    except ValueError:
        raise unsafe("the url cannot be parsed")
    host = (u.hostname or "").lower()
    if not host or u.username or u.password:
        raise unsafe("the url needs a host and no credentials")
    local_ok = False
    if u.scheme == "http":
        if not (_allow_local() and host == "127.0.0.1"):
            raise unsafe("webhook targets must be https")
        local_ok = True
    elif u.scheme != "https":
        raise unsafe("webhook targets must be https")
    if allow_hosts and host not in {str(h).lower() for h in allow_hosts}:
        raise unsafe(f"host {host} is not on the namespace's webhook_hosts allowlist")
    port = port or (443 if u.scheme == "https" else 80)
    try:
        infos = resolve(host, port, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError) as exc:
        raise unsafe(f"host {host} does not resolve: {exc}")
    ips = []
    for info in infos:
        try:
            ips.append(ipaddress.ip_address(info[4][0].split("%")[0]))
        except ValueError:
            continue
    if not ips:
        raise unsafe(f"host {host} has no address")
    bad = [str(ip) for ip in ips if not _ip_ok(ip, local_ok)]
    if bad:
        raise unsafe(f"host {host} resolves to a non-public address ({', '.join(bad)})")
    return u.scheme, host, port, str(ips[0])


class _PinnedHTTPS(http.client.HTTPSConnection):
    """HTTPS to an already checked IP, with SNI and certificate check against the original host name."""

    def __init__(self, host, port, ip, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host, port, ip, timeout):
        super().__init__(host, port, timeout=timeout)
        self._ip = ip

    def connect(self):
        self.sock = socket.create_connection((self._ip, self.port), self.timeout)


# ── signatures ───────────────────────────────────────────────────────────────

def sign(secret: str, ts_ms: int, body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), f"{int(ts_ms)}.".encode() + body, hashlib.sha256).hexdigest()
    return "sha256=" + mac


def verify(secret: str, ts_ms, body: bytes, signature: str, tolerance_s: int = 300, now_ms: int | None = None) -> bool:
    """What a consumer does: recompute the HMAC and reject stale timestamps (replay window)."""
    try:
        ts = int(ts_ms)
    except (TypeError, ValueError):
        return False
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    if abs(now - ts) > tolerance_s * 1000:
        return False
    return hmac.compare_digest(sign(secret, ts, body), signature or "")


def secret_of(c, ns: str, sub: dict) -> str:
    ref = sub.get("secret_ref") or ""
    if ref.startswith("env:"):
        v = os.environ.get(ref[4:])
        if not v:
            raise RuntimeError(f"secret {ref} is not set")
        return v
    r = c.execute("SELECT secret FROM kh_outbox_secret WHERE ns=? AND sub_id=?", [ns, sub["sub_id"]]).fetchone()
    if r:
        return r["secret"]
    sqldb.insert_new(c, "kh_outbox_secret", {"ns": ns, "sub_id": sub["sub_id"], "secret": secrets.token_hex(32),
                                             "created_ms": sqldb.now_ms(c)})
    return c.execute("SELECT secret FROM kh_outbox_secret WHERE ns=? AND sub_id=?", [ns, sub["sub_id"]]).fetchone()[0]


# ── delivery ─────────────────────────────────────────────────────────────────

_DUE = "((state='pending' AND next_ms<=?) OR (state='claimed' AND claimed_until_ms<?))"


def claim(limit: int = CLAIM_MAX, token: str | None = None) -> tuple[str, list[dict]]:
    """Claim up to ``limit`` due rows of active namespaces with a conditional UPDATE. (token, rows)."""
    token = token or secrets.token_hex(16)
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        nss = [r[0] for r in c.execute(
            "SELECT DISTINCT o.ns FROM kh_outbox o JOIN kh_ns n ON n.ns=o.ns WHERE n.state='active' AND "
            "((o.state='pending' AND o.next_ms<=?) OR (o.state='claimed' AND o.claimed_until_ms<?))",
            [now, now]).fetchall()]
    got = 0
    for ns in nss:
        if got >= limit:
            break
        with sqldb.connect() as c:
            now = sqldb.now_ms(c)
            got += sqldb.update(
                c, f"UPDATE kh_outbox SET state='claimed', claim_token=?, claimed_until_ms=? "
                   f"WHERE ns=? AND delivery_id IN (SELECT delivery_id FROM kh_outbox WHERE ns=? AND {_DUE} "
                   f"ORDER BY next_ms LIMIT ?) AND {_DUE} "
                   f"AND EXISTS (SELECT 1 FROM kh_ns n WHERE n.ns=kh_outbox.ns AND n.state='active')",
                [token, now + CLAIM_MS, ns, ns, now, now, int(limit - got), now, now])
    if not got:
        return token, []
    with sqldb.connect() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM kh_outbox WHERE claim_token=? AND state='claimed' "
                                           "ORDER BY ns, event_seq", [token]).fetchall()]
    return token, rows


def backoff_ms(attempts: int) -> int:
    return int(min(BACKOFF_MAX_S, BACKOFF_MIN_S * (2 ** max(0, attempts - 1))) * 1000)


def _finish(row: dict, token: str, ok: bool, status: int | None, error: str | None, permanent: bool = False,
            release: bool = False) -> bool:
    """Record a delivery result. Only the claim holder can (claim_token AND state='claimed')."""
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        if release:                                  # paused subscription: back to pending, no attempt counted
            sql, params = "state='pending', claim_token=NULL, next_ms=?", [now + 30_000]
        elif ok:
            sql, params = ("state='done', claim_token=NULL, attempts=attempts+1, last_status=?, last_error=NULL, "
                           "done_ms=?"), [status, now]
        else:
            attempts = int(row["attempts"]) + 1
            dead = permanent or attempts >= MAX_ATTEMPTS
            sql = ("state=?, claim_token=NULL, attempts=attempts+1, last_status=?, last_error=?, next_ms=?, "
                   "done_ms=?")
            params = ["dead" if dead else "pending", status, (error or "")[:500], now + backoff_ms(attempts),
                      now if dead else None]
        return bool(sqldb.update(c, f"UPDATE kh_outbox SET {sql} WHERE ns=? AND delivery_id=? AND claim_token=? "
                                    f"AND state='claimed'", params + [row["ns"], row["delivery_id"], token]))


def _post(url: str, allow_hosts, body: bytes, headers: dict) -> int:
    scheme, host, port, ip = check_target(url, allow_hosts)
    u = urlsplit(url)
    path = (u.path or "/") + (f"?{u.query}" if u.query else "")
    conn = (_PinnedHTTPS if scheme == "https" else _PinnedHTTP)(host, port, ip, TIMEOUT_S)
    try:
        conn.request("POST", path, body=body, headers={**headers, "Host": u.netloc.split("@")[-1]})
        resp = conn.getresponse()
        resp.read(65536)
        return int(resp.status)
    finally:
        conn.close()


def deliver_row(row: dict, token: str) -> str:
    """Deliver one claimed row; returns its outcome (done|retry|dead|released|lost)."""
    from app.caps import events
    ns = row["ns"]
    with sqldb.connect() as c:
        sub = _subscription(c, ns, row["sub_id"])
        ev = c.execute("SELECT * FROM kh_event WHERE ns=? AND seq=?", [ns, row["event_seq"]]).fetchone()
        nsrow = c.execute("SELECT config_json FROM kh_ns WHERE ns=?", [ns]).fetchone()
        secret = None
        if sub is not None and sub["state"] == "active":
            try:
                secret = secret_of(c, ns, sub)
            except RuntimeError as exc:
                secret = exc
    if sub is None:
        return "dead" if _finish(row, token, False, None, "unsubscribed", permanent=True) else "lost"
    if sub["state"] != "active":
        return "released" if _finish(row, token, False, None, None, release=True) else "lost"
    if ev is None:
        return "dead" if _finish(row, token, False, None, "event_gone", permanent=True) else "lost"
    if isinstance(secret, RuntimeError):
        return "retry" if _finish(row, token, False, None, str(secret)) else "lost"
    settings = (json.loads(nsrow["config_json"] or "{}") if nsrow else {}).get("settings") or {}
    body = json.dumps({"delivery_id": row["delivery_id"], "ns": ns, "sub_id": sub["sub_id"],
                       "event": events._decode(ev)}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ts = int(time.time() * 1000)
    headers = {"Content-Type": "application/json", "User-Agent": f"KnowledgeHub-Outbox/{VERSION}",
               "X-KH-Delivery": row["delivery_id"], "X-KH-Namespace": ns, "X-KH-Subscription": sub["sub_id"],
               "X-KH-Event-Seq": str(row["event_seq"]), "X-KH-Timestamp": str(ts),
               "X-KH-Signature": sign(secret, ts, body)}
    try:
        status = _post(sub["url"], settings.get("webhook_hosts"), body, headers)
    except CapError as exc:                                     # unsafe_target: permanent
        return "dead" if _finish(row, token, False, None, f"unsafe_target: {exc.detail}", permanent=True) else "lost"
    except Exception as exc:  # noqa: BLE001 - network errors are retried
        return "retry" if _finish(row, token, False, None, f"{type(exc).__name__}: {exc}") else "lost"
    if 200 <= status < 300:
        return "done" if _finish(row, token, True, status, None) else "lost"
    return "retry" if _finish(row, token, False, status, f"HTTP {status}") else "lost"


def deliver_once(limit: int = CLAIM_MAX) -> dict:
    """One claim and its deliveries (WORKERS in parallel). Returns outcome counts."""
    token, rows = claim(limit)
    out: dict[str, int] = {}
    if not rows:
        return out
    with ThreadPoolExecutor(max_workers=min(WORKERS, len(rows))) as pool:
        for res in pool.map(lambda r: deliver_row(r, token), rows):
            out[res] = out.get(res, 0) + 1
    return out


def deliver_all(budget_s: float = 20) -> dict:
    end = time.monotonic() + budget_s
    total: dict[str, int] = {}
    while time.monotonic() < end:
        got = deliver_once()
        if not got:
            break
        for k, v in got.items():
            total[k] = total.get(k, 0) + v
    return total


def run_once() -> dict:
    """Fan out, then deliver (what the crons do; tests call it directly)."""
    return {"fanned_out": fanout_all(), **deliver_all()}


def gc() -> int:
    with sqldb.connect() as c:
        cut = sqldb.now_ms(c) - DONE_KEEP_DAYS * 86400000
        return sqldb.update(c, "DELETE FROM kh_outbox WHERE state='done' AND done_ms<?", [cut])


CRONS = [("outbox_fanout", 2, fanout_all), ("outbox_deliver", 2, deliver_all), ("outbox_gc", 3600, gc)]


# ── namespace state ──────────────────────────────────────────────────────────

def _on_state(c, ns: str, old: str, new: str) -> None:
    """Detach: every row not yet delivered is dead (reason detached), in the state-change transaction.
    Re-attach: exactly those rows are due again (at least once survives a plug-out; a row that was mid-delivery
    may arrive twice, deduped by (namespace, delivery id)). Rows dead for any other reason stay dead."""
    if new in ("detached", "purged"):
        now = sqldb.now_ms(c)
        sqldb.update(c, "UPDATE kh_outbox SET state='dead', claim_token=NULL, last_error='detached', done_ms=? "
                        "WHERE ns=? AND state IN ('pending','claimed')", [now, ns])
    elif old == "detached" and new == "active":
        now = sqldb.now_ms(c)
        sqldb.update(c, "UPDATE kh_outbox SET state='pending', next_ms=?, last_error=NULL, done_ms=NULL "
                        "WHERE ns=? AND state='dead' AND last_error='detached'", [now, ns])


# ── pull ─────────────────────────────────────────────────────────────────────

def _pull_sub(ctx: Ctx, sub_id: str) -> dict:
    with sqldb.connect() as c:
        sub = _subscription(c, ctx.ns, sub_id)
        if sub is None:
            raise CapError("not_found", f"no subscription {sub_id}")
        _ensure_cursor(c, ctx.ns, sub_id)
        sub["pull_seq"] = int(c.execute("SELECT pull_seq FROM kh_outbox_cursor WHERE ns=? AND sub_id=?",
                                        [ctx.ns, sub_id]).fetchone()[0])
    return sub


def pull(ctx: Ctx, sub: dict, after_seq: int, limit: int) -> tuple[list[dict], int]:
    """Matching events after ``after_seq`` (scans at most 5 x limit rows per call). (events, scanned_to)."""
    from app.caps import events
    hidden = set(events._hidden_kinds(ctx))
    with sqldb.connect() as c:
        rows = c.execute("SELECT * FROM kh_event WHERE ns=? AND seq>? ORDER BY seq LIMIT ?",
                         [ctx.ns, int(after_seq), int(limit) * 5]).fetchall()
    out, last = [], int(after_seq)
    for r in rows:
        if matches(sub["kinds"], r["kind"]) and r["kind"] not in hidden:
            out.append(events._decode(r))
        last = int(r["seq"])
        if len(out) >= limit:
            break
    return out, last


def ack(ctx: Ctx, sub_id: str, after_seq: int) -> int:
    _pull_sub(ctx, sub_id)
    with sqldb.connect() as c:
        top = int(sqldb.counter_get(c, "ev:" + ctx.ns) or 0)
        if after_seq > top:
            raise CapError("invalid", f"after_seq {after_seq} is beyond the last event ({top})")
        sqldb.update(c, "UPDATE kh_outbox_cursor SET pull_seq=?, rev=rev+1 WHERE ns=? AND sub_id=? AND pull_seq<?",
                     [int(after_seq), ctx.ns, sub_id, int(after_seq)])
        return int(c.execute("SELECT pull_seq FROM kh_outbox_cursor WHERE ns=? AND sub_id=?",
                             [ctx.ns, sub_id]).fetchone()[0])


# ── admin views ──────────────────────────────────────────────────────────────

def list_subs(ns: str) -> list[dict]:
    with sqldb.connect() as c:
        subs = subscriptions(c, ns)
        counts = {}
        for r in c.execute("SELECT sub_id, state, COUNT(*) AS n FROM kh_outbox WHERE ns=? GROUP BY sub_id, state",
                           [ns]).fetchall():
            counts.setdefault(r["sub_id"], {})[r["state"]] = int(r["n"])
        curs = {r["sub_id"]: r for r in c.execute("SELECT * FROM kh_outbox_cursor WHERE ns=?", [ns]).fetchall()}
    for s in subs:
        cur = curs.get(s["sub_id"])
        s["cursor"] = int(cur["last_seq"]) if cur else None
        s["pull_seq"] = int(cur["pull_seq"]) if cur else None
        s["outbox"] = {k: counts.get(s["sub_id"], {}).get(k, 0) for k in STATES}
    return subs


def list_rows(ns: str, state: str, sub_id: str, limit: int) -> list[dict]:
    where, params = ["ns=?"], [ns]
    if state:
        if state not in STATES:
            raise CapError("invalid", f"state is one of {list(STATES)}")
        where.append("state=?")
        params.append(state)
    if sub_id:
        where.append("sub_id=?")
        params.append(sub_id)
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT * FROM kh_outbox WHERE {' AND '.join(where)} ORDER BY event_seq DESC LIMIT ?",
                         params + [max(1, min(int(limit), 1000))]).fetchall()
    return [{k: r[k] for k in ("delivery_id", "sub_id", "event_seq", "attempts", "next_ms", "state", "last_status",
                               "last_error", "created_ms", "done_ms")} for r in rows]


def retry(ns: str, delivery_id: str) -> dict:
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        if not sqldb.update(c, "UPDATE kh_outbox SET state='pending', attempts=0, next_ms=?, last_error=NULL, "
                               "done_ms=NULL WHERE ns=? AND delivery_id=? AND state='dead'", [now, ns, delivery_id]):
            r = c.execute("SELECT state FROM kh_outbox WHERE ns=? AND delivery_id=?", [ns, delivery_id]).fetchone()
            if r is None:
                raise CapError("not_found", f"no delivery {delivery_id}")
            raise CapError("invalid_transition", f"delivery {delivery_id} is {r['state']}, only dead rows are retried")
    return {"delivery_id": delivery_id, "state": "pending"}


def get_secret(ns: str, sub_id: str, rotate: bool = False) -> dict:
    with sqldb.connect() as c:
        sub = _subscription(c, ns, sub_id)
        if sub is None:
            raise CapError("not_found", f"no subscription {sub_id}")
        if (sub.get("secret_ref") or "").startswith("env:"):
            raise CapError("secret_external", f"the secret of {sub_id} comes from {sub['secret_ref']}", status=409)
        if rotate:
            c.execute("DELETE FROM kh_outbox_secret WHERE ns=? AND sub_id=?", [ns, sub_id])
        return {"sub_id": sub_id, "secret": secret_of(c, ns, sub), "signature": "sha256=HMAC_SHA256(secret, "
                "X-KH-Timestamp + '.' + body)"}


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    TAG = ["v1 outbox"]
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)
    if _on_manifest not in registry.ON_MANIFEST:
        registry.ON_MANIFEST.append(_on_manifest)

    @app.get("/v1/{ns}/subscriptions", tags=TAG, summary="Subscriptions with their cursors and outbox counts")
    async def subs_get(ns: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require_admin()
        return {"subscriptions": await asyncio.to_thread(list_subs, ns)}

    @app.get("/v1/{ns}/subscriptions/{sub_id}/secret", tags=TAG, summary="The webhook signing secret")
    async def sub_secret(ns: str, sub_id: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require_admin()
        return await asyncio.to_thread(get_secret, ns, sub_id)

    @app.post("/v1/{ns}/subscriptions/{sub_id}/secret/rotate", tags=TAG, summary="Rotate the signing secret")
    async def sub_secret_rotate(ns: str, sub_id: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require_admin()
        return await asyncio.to_thread(get_secret, ns, sub_id, True)

    @app.get("/v1/{ns}/outbox", tags=TAG, summary="Outbox rows (state, sub_id filters)")
    async def outbox_get(ns: str, state: str = "", sub_id: str = "", limit: int = 100, ctx: Ctx = Depends(ns_ctx)):
        ctx.require_admin()
        return {"deliveries": await asyncio.to_thread(list_rows, ns, state, sub_id, limit)}

    @app.post("/v1/{ns}/outbox/{delivery_id}/retry", tags=TAG, summary="Requeue a dead delivery")
    async def outbox_retry(ns: str, delivery_id: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require_admin()
        return await asyncio.to_thread(retry, ns, delivery_id)

    @app.get("/v1/{ns}/subscriptions/{sub_id}/pull", tags=TAG,
             summary="Long-poll the subscription's events (after_seq, default the acked pull cursor)")
    async def sub_pull(ns: str, sub_id: str, after_seq: int | None = None, limit: int = 100, wait_s: float = 0,
                       ctx: Ctx = Depends(ns_ctx)):
        ctx.require("events", "read")
        sub = await asyncio.to_thread(_pull_sub, ctx, sub_id)
        start = sub["pull_seq"] if after_seq is None else max(0, int(after_seq))
        limit = max(1, min(limit, PULL_MAX))
        deadline = time.monotonic() + max(0.0, min(wait_s, WAIT_MAX_S))
        pos = start
        while True:
            rows, pos = await asyncio.to_thread(pull, ctx, sub, pos, limit)
            if rows or time.monotonic() >= deadline:
                break
            await asyncio.sleep(0.25)
        return {"sub_id": sub_id, "events": rows, "next_after_seq": rows[-1]["seq"] if rows else pos,
                "acked_seq": sub["pull_seq"]}

    @app.post("/v1/{ns}/subscriptions/{sub_id}/ack", tags=TAG, summary="Move the pull cursor forward")
    async def sub_ack(request: Request, ns: str, sub_id: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("events", "read")
        try:
            doc = json.loads(await request.body() or b"null")
            seq = int(doc["after_seq"])
        except (ValueError, TypeError, KeyError):
            raise CapError("invalid", 'body must be {"after_seq": <int>}')
        return {"sub_id": sub_id, "acked_seq": await asyncio.to_thread(ack, ctx, sub_id, seq)}
