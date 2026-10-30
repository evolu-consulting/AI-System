"""Sealed vault: a holdout set that only graders can read, with canary leak detection (design 4.12, D10).

  GET    /v1/{ns}/vault                              declared vaults with their refresh state
  GET    /v1/{ns}/vault/{vault}                      one vault: items, canaries, last refresh, refresh_due
  PUT    /v1/{ns}/vault/{vault}/items/{id}           create (If-None-Match: *) or update (If-Match / last writer wins)
  GET    /v1/{ns}/vault/{vault}/items[?ids=a,b]      items with bodies and active canaries (writes kh.vault_read)
  GET    /v1/{ns}/vault/{vault}/items/{id}           one item (writes kh.vault_read)
  DELETE /v1/{ns}/vault/{vault}/items/{id}           drop an item; its canaries stay detectable for retire_days
  POST   /v1/{ns}/vault/{vault}:refresh              rotate the KH canaries of every item now (If-Match on the vault)

ACCESS. Every route needs ``vault`` read in the role matrix: grader or namespace admin. Agent, judge,
distiller, orchestrator and confirmer get 403 ``forbidden`` on every route, before the vault is even looked up.

DECLARATION. A vault exists only when the manifest lists it: ``vaults: [{vault_id, refresh_days?=30,
retire_days?=180, fenced?=false, project?}]``. An undeclared vault answers 404 ``vault_not_declared``; rows of
a vault removed from the manifest are kept (not readable) until the namespace is purged.

ISOLATION. Own tables (kh_vault, kh_vault_item, kh_vault_canary). Nothing here embeds, projects into the
graph, emits bodies into the event store or exposes rows to records / rules / retrieval / search. kh.vault_read
and kh.canary_hit carry ids only, never a body or a canary. ``export_rows`` is the only bulk accessor and gives
nothing unless the namespace admin passed include_vault=true.

CANARIES. Each item gets >= 1 KH canary ``khc-`` + 16 hex (``kh_canaries`` 1..5 at create) and up to 20 custom
strings (12..256 characters, not in the KH format, unique within the namespace). ``scan(ns, text)`` is
registered with redact.register_canary_scanner, so every redacted /v1 write (events, records, rules, ... and
later items / packs / metrics) is scanned: a regex for the KH format plus a set lookup (with a database lookup
on a cache miss, so a canary minted on another instance is found at once), and a substring alternation over
the custom strings (cached per instance for registry.CACHE_S). On a hit redact stores the write with the canary
masked as ``[REDACTED:canary]`` and writes ``kh.canary_hit {vault, item, canary_kind, retired, principal,
run_id, unit_id, where, pointer}`` - the write is flagged, not refused (D10: refusing would hide the evidence).
The vault's own write path never runs the canary scan (it masks secrets only).

ROTATION. Every refresh_days the cron (lease ``vault.refresh``) rotates the KH canaries of each due vault:
old ones are retired and still detected for retire_days (default 180), a new one is minted per item, and a
``vault.refresh_due {vault, items, reason}`` event is written so the consumer adds new holdout items (KH never
invents holdout content). ``:refresh`` rotates on demand and restarts the period. Custom strings are the
consumer's and are not rotated; replacing them on PUT retires the removed ones.

CONCURRENCY. Every vault write first bumps ``kh_vault.wseq`` (a conditional UPDATE), which serialises writers
of one vault on both backends; the scheduled rotation only runs ``WHERE next_due_ms <= now``, so one instance
wins a period. Item PUT: If-None-Match: * (409 duplicate), If-Match (409 write_conflict + kh.write_conflict),
fencing with X-KH-Lease / X-KH-Epoch (required when the vault is ``fenced``), Idempotency-Key replay.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import threading
import time

from fastapi import Depends, Request

from app import sqldb
from app.caps import core, registry
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "vault"
VERSION = "1.0.0"
STATUS = "beta"

DEFAULT_REFRESH_DAYS = 30
DEFAULT_RETIRE_DAYS = 180
MAX_CUSTOM = 20
MIN_CUSTOM_LEN = 12
MAX_CUSTOM_LEN = 256
MAX_KH_CANARIES = 5
BODY_MAX = 256 * 1024
READ_MAX = 500
DAY_MS = 86400000
LIMITS = {"custom_canaries_per_item": MAX_CUSTOM, "custom_canary_min_chars": MIN_CUSTOM_LEN,
          "custom_canary_max_chars": MAX_CUSTOM_LEN, "kh_canaries_per_item": MAX_KH_CANARIES,
          "body_bytes": BODY_MAX, "read_limit": READ_MAX, "default_refresh_days": DEFAULT_REFRESH_DAYS,
          "retired_canary_days": DEFAULT_RETIRE_DAYS}

#: Codes of this module (statuses passed explicitly; core.CODES is not edited by this slice).
VAULT_NOT_DECLARED = ("vault_not_declared", 404)
CANARY_CONFLICT = ("canary_conflict", 409)

KH_CANARY_RE = re.compile(r"khc-[0-9a-f]{16}")
ITEM_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,128}$")

# ── tables ───────────────────────────────────────────────────────────────────

_DDL_VAULT = ("""CREATE TABLE IF NOT EXISTS kh_vault (
    ns TEXT NOT NULL, vault_id TEXT NOT NULL, refresh_days INTEGER NOT NULL, created_ms INTEGER NOT NULL,
    last_refresh_ms INTEGER NOT NULL, next_due_ms INTEGER NOT NULL, refresh_count INTEGER NOT NULL DEFAULT 0,
    wseq INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL, PRIMARY KEY (ns, vault_id))""",
              """CREATE COLUMN TABLE kh_vault (
    ns NVARCHAR(32) NOT NULL, vault_id NVARCHAR(128) NOT NULL, refresh_days BIGINT NOT NULL, created_ms BIGINT NOT NULL,
    last_refresh_ms BIGINT NOT NULL, next_due_ms BIGINT NOT NULL, refresh_count BIGINT DEFAULT 0 NOT NULL,
    wseq BIGINT DEFAULT 0 NOT NULL, rev BIGINT NOT NULL, PRIMARY KEY (ns, vault_id))""")

_DDL_ITEM = ("""CREATE TABLE IF NOT EXISTS kh_vault_item (
    ns TEXT NOT NULL, vault_id TEXT NOT NULL, item_id TEXT NOT NULL, project TEXT, version INTEGER NOT NULL,
    body_json TEXT NOT NULL, canaries_json TEXT NOT NULL, actor_json TEXT, created_ms INTEGER NOT NULL,
    updated_ms INTEGER NOT NULL, refreshed_ms INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (ns, vault_id, item_id))""",
             """CREATE COLUMN TABLE kh_vault_item (
    ns NVARCHAR(32) NOT NULL, vault_id NVARCHAR(128) NOT NULL, item_id NVARCHAR(128) NOT NULL, project NVARCHAR(128),
    version BIGINT NOT NULL, body_json NCLOB NOT NULL, canaries_json NCLOB NOT NULL, actor_json NCLOB,
    created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL, refreshed_ms BIGINT NOT NULL, rev BIGINT NOT NULL,
    PRIMARY KEY (ns, vault_id, item_id))""")

_DDL_CANARY = ("""CREATE TABLE IF NOT EXISTS kh_vault_canary (
    ns TEXT NOT NULL, canary TEXT NOT NULL, vault_id TEXT NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL,
    state TEXT NOT NULL, created_ms INTEGER NOT NULL, retired_ms INTEGER, expires_ms INTEGER,
    PRIMARY KEY (ns, canary))""",
               """CREATE COLUMN TABLE kh_vault_canary (
    ns NVARCHAR(32) NOT NULL, canary NVARCHAR(256) NOT NULL, vault_id NVARCHAR(128) NOT NULL,
    item_id NVARCHAR(128) NOT NULL, kind NVARCHAR(8) NOT NULL, state NVARCHAR(8) NOT NULL, created_ms BIGINT NOT NULL,
    retired_ms BIGINT, expires_ms BIGINT, PRIMARY KEY (ns, canary))""")
TABLES = ["kh_vault", "kh_vault_item", "kh_vault_canary"]


def _m1(c) -> None:
    sqldb.create_table(c, "kh_vault", *_DDL_VAULT)
    sqldb.create_table(c, "kh_vault_item", *_DDL_ITEM)
    sqldb.create_table(c, "kh_vault_canary", *_DDL_CANARY)
    sqldb.create_index(c, "ix_kh_vault_canary_item", "kh_vault_canary", "ns, vault_id, item_id")
    sqldb.create_index(c, "ix_kh_vault_due", "kh_vault", "next_due_ms")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── declaration (manifest) ───────────────────────────────────────────────────

def _int_in(v, lo: int, hi: int, default: int) -> int:
    if v is None:
        return default
    if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
        raise CapError("invalid", f"vault setting must be an integer {lo}..{hi}")
    return v


def declared(ctx: Ctx, vault: str) -> dict:
    """The manifest entry of ``vault``: {vault_id, refresh_days, retire_days, fenced, project}. 404 otherwise."""
    for v in (ctx.ns_row.get("config") or {}).get("vaults") or []:
        if isinstance(v, dict) and v.get("vault_id") == vault:
            return _norm_decl(v)
    code, status = VAULT_NOT_DECLARED
    raise CapError(code, f"vault {vault} is not declared in the manifest of {ctx.ns}", status=status)


def _norm_decl(v: dict) -> dict:
    return {"vault_id": v["vault_id"],
            "refresh_days": _int_in(v.get("refresh_days"), 1, 3650, DEFAULT_REFRESH_DAYS),
            "retire_days": _int_in(v.get("retire_days"), 1, 3650, DEFAULT_RETIRE_DAYS),
            "fenced": bool(v.get("fenced")), "project": v.get("project") or None}


def _guard(ctx: Ctx) -> None:
    """Grader or namespace admin only, on every vault route (design 3.4 / 4.12)."""
    ctx.require("vault", "read")


def _sync(c, ns: str, decl: dict, now: int) -> dict:
    """The kh_vault row for a declared vault (created on first use, refresh_days kept in line with the manifest)."""
    sqldb.insert_new(c, "kh_vault", {"ns": ns, "vault_id": decl["vault_id"], "refresh_days": decl["refresh_days"],
                                     "created_ms": now, "last_refresh_ms": now,
                                     "next_due_ms": now + decl["refresh_days"] * DAY_MS, "refresh_count": 0,
                                     "wseq": 0, "rev": 1})
    r = c.execute("SELECT * FROM kh_vault WHERE ns=? AND vault_id=?", [ns, decl["vault_id"]]).fetchone()
    if int(r["refresh_days"]) != decl["refresh_days"]:
        sqldb.update(c, "UPDATE kh_vault SET refresh_days=?, next_due_ms=? WHERE ns=? AND vault_id=? "
                        "AND refresh_days=?",
                     [decl["refresh_days"], int(r["last_refresh_ms"]) + decl["refresh_days"] * DAY_MS, ns,
                      decl["vault_id"], int(r["refresh_days"])])
        r = c.execute("SELECT * FROM kh_vault WHERE ns=? AND vault_id=?", [ns, decl["vault_id"]]).fetchone()
    return dict(r)


def _lock(c, ns: str, vault: str) -> None:
    """Serialise writers of one vault: a write on its row (SQLite: the write lock; HANA: the row lock)."""
    sqldb.update(c, "UPDATE kh_vault SET wseq = wseq + 1 WHERE ns=? AND vault_id=?", [ns, vault])


# ── canaries ─────────────────────────────────────────────────────────────────

def new_kh_canary() -> str:
    return "khc-" + secrets.token_hex(8)


def _mint(c, ns: str, vault: str, item: str, now: int) -> str:
    for _ in range(8):
        can = new_kh_canary()
        if sqldb.insert_new(c, "kh_vault_canary", {"ns": ns, "canary": can, "vault_id": vault, "item_id": item,
                                                   "kind": "kh", "state": "active", "created_ms": now,
                                                   "retired_ms": None, "expires_ms": None}):
            return can
    raise RuntimeError("could not mint a unique canary")


def _retire(c, ns: str, vault: str, item: str, now: int, retire_days: int, kind: str | None = None,
            canaries: list[str] | None = None) -> int:
    where, params = "ns=? AND vault_id=? AND item_id=? AND state='active'", [ns, vault, item]
    if kind:
        where += " AND kind=?"
        params.append(kind)
    if canaries is not None:
        if not canaries:
            return 0
        where += f" AND canary IN ({','.join('?' for _ in canaries)})"
        params += canaries
    return sqldb.update(c, f"UPDATE kh_vault_canary SET state='retired', retired_ms=?, expires_ms=? WHERE {where}",
                        [now, now + retire_days * DAY_MS] + params)


def _active(c, ns: str, vault: str, item: str) -> list[dict]:
    return [{"canary": r["canary"], "kind": r["kind"]} for r in c.execute(
        "SELECT canary, kind FROM kh_vault_canary WHERE ns=? AND vault_id=? AND item_id=? AND state='active' "
        "ORDER BY kind, created_ms, canary", [ns, vault, item]).fetchall()]


def _check_custom(raw) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_CUSTOM:
        raise CapError("invalid", f"canaries must be a list of at most {MAX_CUSTOM} strings")
    out = []
    for s in raw:
        if not isinstance(s, str) or not MIN_CUSTOM_LEN <= len(s) <= MAX_CUSTOM_LEN:
            raise CapError("invalid", f"a custom canary is a string of {MIN_CUSTOM_LEN}..{MAX_CUSTOM_LEN} characters")
        if KH_CANARY_RE.search(s):
            raise CapError("invalid", "a custom canary may not contain the KH canary format khc-<16 hex>")
        if s not in out:
            out.append(s)
    return out


def _set_custom(c, ctx: Ctx, decl: dict, item: str, wanted: list[str], now: int) -> None:
    """Make the item's active custom canaries exactly ``wanted`` (removed ones are retired, still detected)."""
    ns, vault = ctx.ns, decl["vault_id"]
    have = {r["canary"] for r in c.execute("SELECT canary FROM kh_vault_canary WHERE ns=? AND vault_id=? AND "
                                           "item_id=? AND kind='custom' AND state='active'", [ns, vault, item])}
    _retire(c, ns, vault, item, now, decl["retire_days"], "custom", sorted(have - set(wanted)))
    for s in wanted:
        if s in have:
            continue
        if sqldb.insert_new(c, "kh_vault_canary", {"ns": ns, "canary": s, "vault_id": vault, "item_id": item,
                                                   "kind": "custom", "state": "active", "created_ms": now,
                                                   "retired_ms": None, "expires_ms": None}):
            continue
        # taken: re-activate only when it is this item's own retired string
        if not sqldb.update(c, "UPDATE kh_vault_canary SET state='active', retired_ms=NULL, expires_ms=NULL "
                               "WHERE ns=? AND canary=? AND vault_id=? AND item_id=? AND kind='custom'",
                            [ns, s, vault, item]):
            code, status = CANARY_CONFLICT
            raise CapError(code, f"custom canary #{wanted.index(s)} is already used by another vault item",
                           status=status, extra={"index": wanted.index(s)})


# ── the scanner (registered with redact) ─────────────────────────────────────

_cache: dict[tuple, tuple] = {}
_cache_lock = threading.Lock()


def invalidate(ns: str | None = None) -> None:
    with _cache_lock:
        if ns is None:
            _cache.clear()
        else:
            _cache.pop((sqldb.location(), ns), None)


def _load_canaries(ns: str) -> dict:
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        rows = c.execute("SELECT canary, vault_id, item_id, kind, state FROM kh_vault_canary WHERE ns=? AND "
                         "(state='active' OR expires_ms >= ?)", [ns, now]).fetchall()
    kh, custom = {}, {}
    for r in rows:
        hit = {"vault": r["vault_id"], "item": r["item_id"], "canary_kind": r["kind"],
               "retired": r["state"] != "active"}
        (kh if r["kind"] == "kh" else custom)[r["canary"]] = hit
    rx = None
    if custom:
        rx = re.compile("|".join(re.escape(s) for s in sorted(custom, key=len, reverse=True)))
    return {"kh": kh, "custom": custom, "rx": rx}


def _canaries_of(ns: str) -> dict:
    key = (sqldb.location(), ns)
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    data = _load_canaries(ns)
    with _cache_lock:
        _cache[key] = (now + registry.CACHE_S, data)
    return data


def _lookup_kh(ns: str, canary: str) -> dict | None:
    """A KH-format string missing from this instance's cache: ask the database (minted elsewhere just now)."""
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        r = c.execute("SELECT vault_id, item_id, kind, state FROM kh_vault_canary WHERE ns=? AND canary=? AND "
                      "(state='active' OR expires_ms >= ?)", [ns, canary, now]).fetchone()
    if r is None:
        return None
    return {"vault": r["vault_id"], "item": r["item_id"], "canary_kind": r["kind"], "retired": r["state"] != "active"}


def scan(ns: str, text: str) -> list[dict]:
    """Canary hits in ``text``: [{start, end, vault, item, canary_kind, retired}] - never the canary itself."""
    if not text or not ns:
        return []
    data = _canaries_of(ns)
    hits = []
    for m in KH_CANARY_RE.finditer(text):
        h = data["kh"].get(m.group(0))
        if h is None:
            h = _lookup_kh(ns, m.group(0))
        if h is not None:
            hits.append({"start": m.start(), "end": m.end(), **h})
    if data["rx"] is not None:
        for m in data["rx"].finditer(text):
            hits.append({"start": m.start(), "end": m.end(), **data["custom"][m.group(0)]})
    return hits


# ── secret masking of vault bodies (no canary scan here) ─────────────────────

def _mask(ctx: Ctx, where: str, body):
    from app.caps import redact
    if not redact._active[0]:
        return body
    sel = redact.resolve(ctx.ns, ctx.ns_row)
    masked, findings = redact.scan_value(sel["scanner"], body, ctx.ns, canaries=False)
    if not findings:
        return body
    refused = [f for f in findings if f["mode"] == "refuse"]
    core.emit(ctx, "kh.redacted", {"where": where, "count": len(findings), "refused": bool(refused),
                                   "packs": sel["scanner"].refs,
                                   "findings": [{k: f[k] for k in ("name", "kind", "mode", "pack", "pointer")}
                                                for f in findings[:100]]})
    if refused:
        raise CapError("redaction_refused", "refused by redaction", status=422,
                       extra={"findings": [{k: f[k] for k in ("name", "kind", "pack", "pointer")} for f in refused]})
    return masked


# ── items ────────────────────────────────────────────────────────────────────

def _item_out(c, r, with_body: bool = True) -> dict:
    out = {"vault": r["vault_id"], "item_id": r["item_id"], "project": r["project"] or None,
           "version": int(r["version"]), "rev": int(r["rev"]), "created_ms": int(r["created_ms"]),
           "updated_ms": int(r["updated_ms"]), "refreshed_ms": int(r["refreshed_ms"]),
           "canaries": json.loads(r["canaries_json"] or "[]")}
    if with_body:
        out["body"] = json.loads(r["body_json"])
    return out


def _check_item_id(item_id: str) -> None:
    if not ITEM_ID_RE.match(item_id or ""):
        raise CapError("invalid", "item id must be 1-128 of [A-Za-z0-9_.-]")


def put_item(ctx: Ctx, vault: str, item_id: str, doc) -> tuple[int, dict, int]:
    _guard(ctx)
    decl = declared(ctx, vault)
    _check_item_id(item_id)
    if not isinstance(doc, dict) or "body" not in doc:
        raise CapError("invalid", "body is {body, canaries?: [custom strings], kh_canaries?: 1..5, project?}")
    custom = _check_custom(doc.get("canaries"))
    n_kh = _int_in(doc.get("kh_canaries"), 1, MAX_KH_CANARIES, 1)
    project = ctx.require_project(doc.get("project") or decl["project"])
    if decl["project"] and project != decl["project"]:
        raise CapError("invalid", f"vault {vault} belongs to project {decl['project']}")
    body = _mask(ctx, f"vault/{vault}", doc["body"])
    raw = core.jdump(body)
    if len(raw.encode("utf-8")) > BODY_MAX:
        raise CapError("too_large", f"body is larger than {BODY_MAX} bytes")
    expected = core.if_match(ctx.request)
    create_only = core.if_none_match_star(ctx.request)
    ns = ctx.ns
    key = {"ns": ns, "vault_id": vault, "item_id": item_id}
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        _sync(c, ns, decl, now)
        _lock(c, ns, vault)
        old = c.execute("SELECT * FROM kh_vault_item WHERE ns=? AND vault_id=? AND item_id=?",
                        [ns, vault, item_id]).fetchone()
        if old is not None and create_only:
            raise CapError("duplicate", f"vault item {item_id} exists", headers={"ETag": core.etag(old["rev"])})
        if old is None and expected is not None:
            raise CapError("not_found", f"no vault item {item_id}")
        if old is None:
            for _ in range(n_kh):
                _mint(c, ns, vault, item_id, now)
            _set_custom(c, ctx, decl, item_id, custom, now)
            canaries = _active(c, ns, vault, item_id)
            c.execute("INSERT INTO kh_vault_item (ns, vault_id, item_id, project, version, body_json, canaries_json, "
                      "actor_json, created_ms, updated_ms, refreshed_ms, rev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                      [ns, vault, item_id, project, 1, raw, core.jdump(canaries), core.jdump(ctx.actor()),
                       now, now, now, 1])
            status, rev = 201, 1
        else:
            if (old["project"] or "") != (project or ""):
                raise CapError("invalid", f"vault item {item_id} belongs to project {old['project']}")
            changed = old["body_json"] != raw
            if "canaries" in doc:
                _set_custom(c, ctx, decl, item_id, custom, now)
            canaries = _active(c, ns, vault, item_id)
            rev = core.cas_update(ctx, c, "kh_vault_item", key,
                                  {"body_json": raw, "canaries_json": core.jdump(canaries),
                                   "version": int(old["version"]) + (1 if changed else 0),
                                   "actor_json": core.jdump(ctx.actor()), "updated_ms": now}, expected)
            status = 200
        core.fence(ctx, c, required=decl["fenced"])
        out = _item_out(c, c.execute("SELECT * FROM kh_vault_item WHERE ns=? AND vault_id=? AND item_id=?",
                                     [ns, vault, item_id]).fetchone(), with_body=False)
    invalidate(ns)
    return status, out, rev


def delete_item(ctx: Ctx, vault: str, item_id: str) -> dict:
    _guard(ctx)
    decl = declared(ctx, vault)
    _check_item_id(item_id)
    expected = core.if_match(ctx.request)
    ns = ctx.ns
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        _sync(c, ns, decl, now)
        _lock(c, ns, vault)
        old = c.execute("SELECT * FROM kh_vault_item WHERE ns=? AND vault_id=? AND item_id=?",
                        [ns, vault, item_id]).fetchone()
        if old is None:
            raise CapError("not_found", f"no vault item {item_id}")
        if old["project"]:
            ctx.require_project(old["project"])
        where, params = "ns=? AND vault_id=? AND item_id=?", [ns, vault, item_id]
        if expected is not None and expected >= 0:
            where += " AND rev=?"
            params.append(expected)
        if not sqldb.update(c, f"DELETE FROM kh_vault_item WHERE {where}", params):
            raise CapError("write_conflict", "the item changed since you read it", headers={"ETag": core.etag(old["rev"])},
                           extra={"current": {"rev": int(old["rev"])}},
                           kh_events=[(ns, "kh.write_conflict", {"table": "kh_vault_item", "key": {
                               "vault_id": vault, "item_id": item_id}, "expected_rev": expected,
                               "current_rev": int(old["rev"])}, ctx.actor())])
        retired = _retire(c, ns, vault, item_id, now, decl["retire_days"])
        core.fence(ctx, c, required=decl["fenced"])
    invalidate(ns)
    return {"vault": vault, "item_id": item_id, "deleted": True, "canaries_retired": retired,
            "detected_until_ms": now + decl["retire_days"] * DAY_MS}


def read_items(ctx: Ctx, vault: str, ids: list[str] | None, after: str, limit: int) -> list[dict]:
    _guard(ctx)
    declared(ctx, vault)
    where, params = ["ns=?", "vault_id=?"], [ctx.ns, vault]
    if ids is not None:
        for i in ids:
            _check_item_id(i)
        if not ids:
            return []
        where.append(f"item_id IN ({','.join('?' for _ in ids)})")
        params += ids
    elif after:
        where.append("item_id > ?")
        params.append(after)
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT * FROM kh_vault_item WHERE {' AND '.join(where)} ORDER BY item_id LIMIT ?",
                         params + [int(limit)]).fetchall()
        out = [_item_out(c, r) for r in rows]
    if ctx.caller.projects is not None:
        out = [o for o in out if not o["project"] or o["project"] in ctx.caller.projects]
    return out


def _vault_read_event(ctx: Ctx, vault: str, items: list[dict]) -> None:
    core.emit(ctx, "kh.vault_read", {"vault": vault, "count": len(items),
                                     "item_ids": [i["item_id"] for i in items][:100]})


# ── refresh and rotation ─────────────────────────────────────────────────────

def _rotate(c, ns: str, decl: dict, now: int) -> dict:
    """Retire every active KH canary of the vault and mint a new one per item (inside the caller's transaction)."""
    vault = decl["vault_id"]
    items = c.execute("SELECT item_id, rev FROM kh_vault_item WHERE ns=? AND vault_id=? ORDER BY item_id",
                      [ns, vault]).fetchall()
    retired = minted = 0
    for it in items:
        n = max(1, int(c.execute("SELECT COUNT(*) FROM kh_vault_canary WHERE ns=? AND vault_id=? AND item_id=? "
                                 "AND kind='kh' AND state='active'", [ns, vault, it["item_id"]]).fetchone()[0]))
        retired += _retire(c, ns, vault, it["item_id"], now, decl["retire_days"], "kh")
        for _ in range(n):
            _mint(c, ns, vault, it["item_id"], now)
            minted += 1
        sqldb.update(c, "UPDATE kh_vault_item SET canaries_json=?, refreshed_ms=?, rev=rev+1 WHERE ns=? AND "
                        "vault_id=? AND item_id=?",
                     [core.jdump(_active(c, ns, vault, it["item_id"])), now, ns, vault, it["item_id"]])
    return {"items": len(items), "canaries_retired": retired, "canaries_minted": minted}


def _status(r: dict, now: int, c, ns: str) -> dict:
    vault = r["vault_id"]
    n_items = int(c.execute("SELECT COUNT(*) FROM kh_vault_item WHERE ns=? AND vault_id=?", [ns, vault]).fetchone()[0])
    counts = {(x["kind"], x["state"]): int(x["n"]) for x in c.execute(
        "SELECT kind, state, COUNT(*) AS n FROM kh_vault_canary WHERE ns=? AND vault_id=? AND (state='active' OR "
        "expires_ms >= ?) GROUP BY kind, state", [ns, vault, now]).fetchall()}
    return {"vault": vault, "refresh_days": int(r["refresh_days"]), "items": n_items,
            "last_refresh_ms": int(r["last_refresh_ms"]), "next_due_ms": int(r["next_due_ms"]),
            "refresh_due": now >= int(r["next_due_ms"]), "refresh_count": int(r["refresh_count"]),
            "canaries": {"kh_active": counts.get(("kh", "active"), 0), "custom_active": counts.get(("custom", "active"), 0),
                         "retired_detected": counts.get(("kh", "retired"), 0) + counts.get(("custom", "retired"), 0)},
            "rev": int(r["rev"])}


def vault_status(ctx: Ctx, vault: str | None) -> list[dict]:
    _guard(ctx)
    decls = [declared(ctx, vault)] if vault else [
        _norm_decl(v) for v in (ctx.ns_row.get("config") or {}).get("vaults") or [] if isinstance(v, dict)]
    out = []
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        for d in decls:
            r = _sync(c, ctx.ns, d, now)
            out.append({**_status(r, now, c, ctx.ns), "fenced": d["fenced"], "retire_days": d["retire_days"],
                        "project": d["project"]})
    return out


def refresh(ctx: Ctx, vault: str) -> tuple[dict, int]:
    """On-demand rotation; restarts the refresh period. If-Match on the vault rev makes it conditional."""
    _guard(ctx)
    decl = declared(ctx, vault)
    expected = core.if_match(ctx.request)
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        _sync(c, ctx.ns, decl, now)
        cur = c.execute("SELECT rev FROM kh_vault WHERE ns=? AND vault_id=?", [ctx.ns, vault]).fetchone()
        rev = core.cas_update(ctx, c, "kh_vault", {"ns": ctx.ns, "vault_id": vault},
                              {"last_refresh_ms": now, "next_due_ms": now + decl["refresh_days"] * DAY_MS},
                              expected)
        sqldb.update(c, "UPDATE kh_vault SET refresh_count = refresh_count + 1 WHERE ns=? AND vault_id=?",
                     [ctx.ns, vault])
        res = _rotate(c, ctx.ns, decl, now)
        core.fence(ctx, c, required=decl["fenced"])
        r = dict(c.execute("SELECT * FROM kh_vault WHERE ns=? AND vault_id=?", [ctx.ns, vault]).fetchone())
        out = {**_status(r, now, c, ctx.ns), **res, "previous_rev": int(cur["rev"])}
    invalidate(ctx.ns)
    return out, rev


def refresh_due(now_override: int | None = None) -> dict:
    """The cron: sync declared vaults, rotate every due one (one winner per period across instances), write
    vault.refresh_due, and forget retired canaries past their detection window."""
    from app.caps import events
    done, events_out = [], []
    with sqldb.connect() as c:
        nss = [(r["ns"], json.loads(r["config_json"] or "{}")) for r in c.execute(
            "SELECT ns, config_json FROM kh_ns WHERE state='active'").fetchall()]
    for ns, cfg in nss:
        for v in cfg.get("vaults") or []:
            try:
                decl = _norm_decl(v)
            except (CapError, KeyError, TypeError):
                continue
            with sqldb.connect() as c:
                now = now_override if now_override is not None else sqldb.now_ms(c)
                r = _sync(c, ns, decl, now)
                if int(r["next_due_ms"]) > now:
                    continue
                # the winner of this period: conditional on the due time it read
                if not sqldb.update(c, "UPDATE kh_vault SET last_refresh_ms=?, next_due_ms=?, "
                                       "refresh_count=refresh_count+1, rev=rev+1 WHERE ns=? AND vault_id=? AND "
                                       "next_due_ms=? AND next_due_ms <= ?",
                                    [now, now + decl["refresh_days"] * DAY_MS, ns, decl["vault_id"],
                                     int(r["next_due_ms"]), now]):
                    continue
                res = _rotate(c, ns, decl, now)
            invalidate(ns)
            body = {"vault": decl["vault_id"], "reason": "schedule", "refresh_days": decl["refresh_days"],
                    "next_due_ms": now + decl["refresh_days"] * DAY_MS, **res}
            events_out.append((ns, body))
            done.append(f"{ns}/{decl['vault_id']}")
    for ns, body in events_out:
        try:
            events.append_system(ns, "vault.refresh_due", body, {"principal": "kh", "role": "kh"})
        except Exception:
            logger.exception("vault - could not write vault.refresh_due for %s", ns)
    with sqldb.connect() as c:
        now = now_override if now_override is not None else sqldb.now_ms(c)
        purged = sqldb.update(c, "DELETE FROM kh_vault_canary WHERE state='retired' AND expires_ms < ?", [now])
    if purged:
        invalidate()
    return {"refreshed": done, "expired_canaries": purged}


CRONS = [("vault.refresh", 3600, refresh_due)]


# ── export and lifecycle ─────────────────────────────────────────────────────

def export_rows(ns: str, include_vault: bool = False, is_admin: bool = False) -> dict:
    """For the export path: nothing unless the namespace admin asked for include_vault=true (design 4.12)."""
    if not (include_vault and is_admin):
        return {}
    with sqldb.connect() as c:
        return {t: [dict(r) for r in c.execute(f"SELECT * FROM {t} WHERE ns=?", [ns]).fetchall()]
                for t in ("kh_vault", "kh_vault_item", "kh_vault_canary")}


def _on_state(c, ns: str, old: str, new: str) -> None:       # noqa: ARG001
    if new == "purged":
        for t in ("kh_vault_canary", "kh_vault_item", "kh_vault"):
            c.execute(f"DELETE FROM {t} WHERE ns=?", [ns])
    invalidate(ns)


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    from app.caps import redact
    TAG = ["v1 vault"]
    redact.register_canary_scanner(scan)
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)

    @app.get("/v1/{ns}/vault", tags=TAG, summary="Declared vaults and their refresh state (grader / admin)")
    async def vaults_list(ns: str, ctx: Ctx = Depends(ns_ctx)):
        return {"vaults": await asyncio.to_thread(vault_status, ctx, None)}

    @app.post("/v1/{ns}/vault/{vault}:refresh", tags=TAG, summary="Rotate the KH canaries now (grader / admin)")
    @core.idempotent
    async def vault_refresh(request: Request, ns: str, vault: str, ctx: Ctx = Depends(ns_ctx)):
        out, rev = await asyncio.to_thread(refresh, ctx, vault)
        return core.reply(200, out, {"ETag": core.etag(rev)})

    @app.get("/v1/{ns}/vault/{vault}", tags=TAG, summary="One vault's state (grader / admin)")
    async def vault_get(ns: str, vault: str, ctx: Ctx = Depends(ns_ctx)):
        out = (await asyncio.to_thread(vault_status, ctx, vault))[0]
        return core.reply(200, out, {"ETag": core.etag(out["rev"])})

    @app.get("/v1/{ns}/vault/{vault}/items", tags=TAG, summary="Vault items (grader / admin; writes kh.vault_read)")
    async def items_get(ns: str, vault: str, ids: str | None = None, after: str = "", limit: int = 100,
                        ctx: Ctx = Depends(ns_ctx)):
        id_list = None if ids is None else [x for x in ids.split(",") if x]
        if id_list is not None and len(id_list) > READ_MAX:
            raise CapError("too_large", f"at most {READ_MAX} ids")
        items = await asyncio.to_thread(read_items, ctx, vault, id_list, after, max(1, min(limit, READ_MAX)))
        await asyncio.to_thread(_vault_read_event, ctx, vault, items)
        return {"items": items}

    @app.get("/v1/{ns}/vault/{vault}/items/{item_id}", tags=TAG, summary="One vault item (writes kh.vault_read)")
    async def item_get(ns: str, vault: str, item_id: str, ctx: Ctx = Depends(ns_ctx)):
        items = await asyncio.to_thread(read_items, ctx, vault, [item_id], "", 1)
        if not items:
            raise CapError("not_found", f"no vault item {item_id}")
        await asyncio.to_thread(_vault_read_event, ctx, vault, items)
        return core.reply(200, items[0], {"ETag": core.etag(items[0]["rev"])})

    @app.put("/v1/{ns}/vault/{vault}/items/{item_id}", tags=TAG,
             summary="Create (If-None-Match: *) or update (If-Match) a vault item (grader / admin)")
    @core.idempotent
    async def item_put(request: Request, ns: str, vault: str, item_id: str, ctx: Ctx = Depends(ns_ctx)):
        _guard(ctx)
        try:
            doc = json.loads(await request.body() or b"null")
        except ValueError:
            raise CapError("invalid", "body must be JSON")
        status, out, rev = await asyncio.to_thread(put_item, ctx, vault, item_id, doc)
        return core.reply(status, out, {"ETag": core.etag(rev)})

    @app.delete("/v1/{ns}/vault/{vault}/items/{item_id}", tags=TAG, summary="Delete a vault item (grader / admin)")
    async def item_delete(ns: str, vault: str, item_id: str, ctx: Ctx = Depends(ns_ctx)):
        return await asyncio.to_thread(delete_item, ctx, vault, item_id)
