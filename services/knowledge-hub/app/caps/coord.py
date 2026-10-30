"""Coordination for any consumer: leases with fencing epochs, idempotency and side-effect claims
(docs/multi-agent-instance-design.md 2.1, 2.3, 4.3).

  POST /v1/{ns}/leases/{name}:acquire {ttl_s}   -> {name, epoch, until_ms} or 409 lease_held {holder, until_ms}
  POST /v1/{ns}/leases/{name}:renew   {epoch, ttl_s}  -> 409 lease_lost (+ kh.lease_lost) when it was lost
  POST /v1/{ns}/leases/{name}:release {epoch}
  GET  /v1/{ns}/leases?prefix=          GET /v1/{ns}/leases/{name}
  POST /v1/{ns}/effects/{key}:claim {ttl_s}  -> 201 to the first caller, 409 effect_claimed with the state
  POST /v1/{ns}/effects/{key}:complete {result} | :fail {error}      GET /v1/{ns}/effects/{key}
  POST /v1/{ns}/effects/{key}:approve {decision: approve|reject, note?}   (phase 4, human confirmer only)

HIGH-RISK APPROVAL (docs/roadmap-e-to-5-design.md 6.2). A ``:claim`` on a key that starts with one of the
namespace's ``settings.effects.approval_required`` prefixes (default ``APPROVAL_DEFAULT``; ``*`` = every key)
answers 428 ``approval_required`` until a ``kh.approval {effect_key, approver, decision}`` record with decision
``approve`` exists, written through ``:approve`` by a signed-in PERSON listed in
``settings.effects.confirm_policy.emails`` (fallback ``settings.items.confirm_policy``) and still listed at claim
time. ``kh.`` record types cannot be declared in a manifest, so only this route writes them (kh_record /
kh_record_rev, one record per effect key, every decision a revision). Each decision writes ``kh.intervention``.
Off by default: ``KH_EFFECT_APPROVAL=manifest`` (default) gates only namespaces whose manifest declares
``settings.effects``; ``on`` gates every namespace (default prefixes when none are declared); ``off`` never gates.

Lease names are free-form (<= 200 chars, slashes allowed, e.g. ``unit/42``); the holder is the calling
principal. Every rule is SQL in app/sqldb.py (leases) or a conditional UPDATE / PK insert here.
The Idempotency-Key machinery (kh_idem) used by ``core.idempotent`` lives here too.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging

from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "coord"
VERSION = "1.0.0"
STATUS = "beta"
TTL_MIN_S, TTL_MAX_S, TTL_DEFAULT_S = 5, 300, 30
EFFECT_TTL_DEFAULT_S = 300
IDEM_PENDING_TAKEOVER_MS = 60000
IDEM_HOURS_DEFAULT, IDEM_HOURS_MAX = 24, 168
LIMITS = {"lease_ttl_s": [TTL_MIN_S, TTL_MAX_S], "lease_name_chars": 200, "idempotency_hours_max": IDEM_HOURS_MAX,
          "effect_ttl_default_s": EFFECT_TTL_DEFAULT_S}
APPROVAL_DEFAULT = ["delete/", "deploy/prod", "send/external", "merge/"]
APPROVAL_TYPE = "kh.approval"
DECISIONS = {"approve", "reject"}

_DDL = {
    "kh_idem": ("""CREATE TABLE IF NOT EXISTS kh_idem (
                     ns TEXT NOT NULL, principal TEXT NOT NULL, idem_key TEXT NOT NULL, request_sha256 TEXT NOT NULL,
                     state TEXT NOT NULL, status_code INTEGER, response_json TEXT, created_ms INTEGER NOT NULL,
                     updated_ms INTEGER NOT NULL, PRIMARY KEY (ns, principal, idem_key))""",
                """CREATE COLUMN TABLE kh_idem (
                     ns NVARCHAR(32) NOT NULL, principal NVARCHAR(256) NOT NULL, idem_key NVARCHAR(256) NOT NULL,
                     request_sha256 NVARCHAR(64) NOT NULL, state NVARCHAR(16) NOT NULL, status_code INTEGER,
                     response_json NCLOB, created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL,
                     PRIMARY KEY (ns, principal, idem_key))"""),
    "kh_effect": ("""CREATE TABLE IF NOT EXISTS kh_effect (
                       ns TEXT NOT NULL, effect_key TEXT NOT NULL, holder TEXT NOT NULL, state TEXT NOT NULL,
                       result_json TEXT, claimed_until_ms INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
                       rev INTEGER NOT NULL DEFAULT 1, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
                       PRIMARY KEY (ns, effect_key))""",
                  """CREATE COLUMN TABLE kh_effect (
                       ns NVARCHAR(32) NOT NULL, effect_key NVARCHAR(256) NOT NULL, holder NVARCHAR(256) NOT NULL,
                       state NVARCHAR(16) NOT NULL, result_json NCLOB, claimed_until_ms BIGINT NOT NULL,
                       attempts BIGINT NOT NULL, rev BIGINT NOT NULL, created_ms BIGINT NOT NULL,
                       updated_ms BIGINT NOT NULL, PRIMARY KEY (ns, effect_key))"""),
}
TABLES = list(_DDL)


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ix_kh_idem_created", "kh_idem", "created_ms")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── idempotency (used by core.idempotent) ────────────────────────────────────

def _idem_hours(ctx: Ctx) -> int:
    h = ((ctx.ns_row.get("config") or {}).get("retention") or {}).get("idempotency_hours", IDEM_HOURS_DEFAULT)
    try:
        return max(1, min(int(h), IDEM_HOURS_MAX))
    except (TypeError, ValueError):
        return IDEM_HOURS_DEFAULT


def idem_begin(ctx: Ctx, key: str, req_hash: str):
    """None = run the request (this call owns the key). Otherwise a replayed response, or a CapError."""
    if len(key) > 255:
        raise CapError("invalid", "Idempotency-Key is longer than 255 characters")
    pk = [ctx.ns, ctx.caller.principal, key]
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        # An expired key (past the namespace's retention) is forgotten first, then the insert decides.
        sqldb.update(c, "DELETE FROM kh_idem WHERE ns=? AND principal=? AND idem_key=? AND created_ms < ?",
                     pk + [now - _idem_hours(ctx) * 3600000])
        if sqldb.insert_new(c, "kh_idem", {"ns": ctx.ns, "principal": ctx.caller.principal, "idem_key": key,
                                           "request_sha256": req_hash, "state": "pending", "status_code": None,
                                           "response_json": None, "created_ms": now, "updated_ms": now}):
            return None
        r = c.execute("SELECT request_sha256, state, status_code, response_json, updated_ms FROM kh_idem "
                      "WHERE ns=? AND principal=? AND idem_key=?", pk).fetchone()
        if r is None:                                            # released between insert and read
            raise CapError("in_progress", "retry", headers={"Retry-After": "1"})
        if r["request_sha256"] != req_hash:
            raise CapError("idempotency_mismatch", "this Idempotency-Key was used with a different request")
        if r["state"] == "pending":
            # A pending row older than 60 s belongs to a caller that died: take it over conditionally.
            if sqldb.update(c, "UPDATE kh_idem SET updated_ms=? WHERE ns=? AND principal=? AND idem_key=? "
                               "AND state='pending' AND updated_ms < ?", [now] + pk + [now - IDEM_PENDING_TAKEOVER_MS]):
                return None
            raise CapError("in_progress", "the first request with this Idempotency-Key is still running",
                           headers={"Retry-After": "1"})
        status, body = int(r["status_code"]), json.loads(r["response_json"] or "null")
    core.emit(ctx, "kh.duplicate", {"idempotency_key": key, "status": status, "path": ctx.request.url.path})
    return core.reply(status, body, {"Idempotent-Replay": "true"})


def idem_finish(ctx: Ctx, key: str, status: int, body) -> None:
    with sqldb.connect() as c:
        sqldb.update(c, "UPDATE kh_idem SET state='done', status_code=?, response_json=?, updated_ms=? "
                        "WHERE ns=? AND principal=? AND idem_key=? AND state='pending'",
                     [int(status), json.dumps(body, ensure_ascii=False), sqldb.now_ms(c), ctx.ns,
                      ctx.caller.principal, key])


def idem_abort(ctx: Ctx, key: str) -> None:
    """The first call failed in a way worth retrying: free the key."""
    with sqldb.connect() as c:
        sqldb.update(c, "DELETE FROM kh_idem WHERE ns=? AND principal=? AND idem_key=? AND state='pending'",
                     [ctx.ns, ctx.caller.principal, key])


def purge_idempotency(max_hours: int = IDEM_HOURS_MAX) -> int:
    """Drop rows past the longest retention (cron)."""
    with sqldb.connect() as c:
        return sqldb.update(c, "DELETE FROM kh_idem WHERE created_ms < ?", [sqldb.now_ms(c) - max_hours * 3600000])


CRONS = [("cron.idempotency_purge", 3600, purge_idempotency)]


# ── leases ───────────────────────────────────────────────────────────────────

def _ttl_ms(body: dict) -> int:
    ttl = body.get("ttl_s", TTL_DEFAULT_S)
    if not isinstance(ttl, (int, float)) or not TTL_MIN_S <= ttl <= TTL_MAX_S:
        raise CapError("invalid", f"ttl_s must be between {TTL_MIN_S} and {TTL_MAX_S}")
    return int(ttl * 1000)


def _lease_name(name: str) -> str:
    if not name or len(name) > 200:
        raise CapError("invalid", "a lease name is 1-200 characters")
    return name


def _split(path_value: str, verbs: tuple[str, ...]) -> tuple[str, str]:
    for v in verbs:
        if path_value.endswith(":" + v):
            return path_value[: -len(v) - 1], v
    raise CapError("not_found", f"unknown action; use one of {', '.join(':' + v for v in verbs)}")


def lease_action(ctx: Ctx, name: str, verb: str, body: dict):
    ctx.require("leases", "use")
    name = _lease_name(name)
    holder = ctx.caller.principal
    lost_event = None
    with sqldb.connect() as c:
        if verb == "acquire":
            got = sqldb.lease_acquire(c, ctx.ns, name, holder, _ttl_ms(body))
            if got is None:
                cur = sqldb.lease_get(c, ctx.ns, name) or {}
                raise CapError("lease_held", f"lease {name} is held", extra={"holder": cur.get("holder"),
                                                                              "until_ms": cur.get("until_ms")})
            return {"name": name, **got}
        epoch = body.get("epoch")
        if epoch is None:
            got_h = core.fence_headers(ctx.request)
            epoch = got_h[1] if got_h else None
        if not isinstance(epoch, int):
            raise CapError("invalid", "epoch is required (body or X-KH-Epoch)")
        if verb == "renew":
            got = sqldb.lease_renew(c, ctx.ns, name, holder, epoch, _ttl_ms(body))
            if got is not None:
                return {"name": name, **got}
            cur = sqldb.lease_get(c, ctx.ns, name) or {}
            lost_event = {"lease": name, "epoch": epoch, "holder": cur.get("holder"),
                          "current_epoch": cur.get("epoch")}
        else:
            return {"name": name, "released": sqldb.lease_release(c, ctx.ns, name, holder, epoch)}
    raise CapError("lease_lost", f"lease {name} is no longer held at epoch {epoch}", extra=lost_event,
                   kh_events=[(ctx.ns, "kh.lease_lost", lost_event, ctx.actor())])


# ── high-risk approval (phase 4) ─────────────────────────────────────────────

def _settings(ns_row: dict) -> dict:
    s = (ns_row.get("config") or {}).get("settings") or {}
    return s if isinstance(s, dict) else {}


def _effects_settings(ns_row: dict) -> dict | None:
    eff = _settings(ns_row).get("effects")
    return eff if isinstance(eff, dict) else None


def approval_prefixes(ns_row: dict) -> list[str]:
    """Key prefixes that need a human approval in this namespace ([] = no gate). See the module doc."""
    mode = (config._env("KH_EFFECT_APPROVAL", "manifest") or "manifest").strip().lower()
    eff = _effects_settings(ns_row)
    if mode == "off" or (mode != "on" and eff is None):
        return []
    got = (eff or {}).get("approval_required", APPROVAL_DEFAULT)
    if not isinstance(got, list):
        return list(APPROVAL_DEFAULT)
    return [x for x in got if isinstance(x, str) and x]


def needs_approval(ns_row: dict, key: str) -> bool:
    return any(p == "*" or key.startswith(p) for p in approval_prefixes(ns_row))


def confirmer_emails(ns_row: dict) -> set[str]:
    cp = (_effects_settings(ns_row) or {}).get("confirm_policy")
    if not isinstance(cp, dict):
        items = _settings(ns_row).get("items")
        cp = items.get("confirm_policy") if isinstance(items, dict) else None
    emails = cp.get("emails") if isinstance(cp, dict) else None
    return {e.strip().lower() for e in emails or [] if isinstance(e, str) and e.strip()}


def approval_id(key: str) -> str:
    """kh_record ids are [A-Za-z0-9_.-]{1,128}; effect keys are free-form up to 256 characters."""
    return "ap-" + hashlib.sha256(key.encode("utf-8")).hexdigest()


def _records_on() -> bool:
    from app import caps
    return caps._loaded.get("records") is not None


def _approval(c, ns: str, key: str) -> dict | None:
    if not _records_on():
        return None
    r = c.execute("SELECT body_json, actor_json, rev, updated_ms FROM kh_record WHERE ns=? AND type=? AND id=?",
                  [ns, APPROVAL_TYPE, approval_id(key)]).fetchone()
    if r is None:
        return None
    return {**json.loads(r["body_json"] or "{}"), "rev": int(r["rev"]), "updated_ms": int(r["updated_ms"]),
            "written_by": json.loads(r["actor_json"] or "{}").get("principal")}


def _approved(c, ctx: Ctx, key: str) -> tuple[bool, dict | None]:
    """An approve decision written by its approver, who is still a listed human confirmer."""
    ap = _approval(c, ctx.ns, key)
    if ap is None or ap.get("decision") != "approve":
        return False, ap
    who = str(ap.get("approver") or "").lower()
    ok = bool(who) and who == str(ap.get("written_by") or "").lower() and who in confirmer_emails(ctx.ns_row)
    return ok, ap


def approve_action(ctx: Ctx, key: str, body: dict):
    """Record a human decision on an effect key (kh.approval) and write kh.intervention."""
    if ctx.caller.kind != "person" or (ctx.caller.principal or "").lower() not in confirmer_emails(ctx.ns_row):
        raise CapError("forbidden", "only a signed-in person listed in settings.effects.confirm_policy may "
                                    "approve an effect")
    if not _records_on():
        raise CapError("not_found", "the records capability is off: approvals cannot be stored")
    decision = body.get("decision", "approve")
    if decision not in DECISIONS:
        raise CapError("invalid", "decision must be approve or reject")
    note = body.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 2000):
        raise CapError("invalid", "note must be a string of at most 2000 characters")
    approver = ctx.caller.principal.lower()
    rec = {"effect_key": key, "approver": approver, "decision": decision}
    if note:
        rec["note"] = note
    raw, actor, rid = core.jdump(rec), core.jdump(ctx.actor()), approval_id(key)
    state = "approved" if decision == "approve" else "rejected"
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        row = {"ns": ctx.ns, "type": APPROVAL_TYPE, "id": rid, "project": "", "schema_ver": None, "rev": 1,
               "state": state, "ix_s1": key, "ix_s2": approver, "ix_s3": decision, "ix_s4": None, "ix_n1": None,
               "ix_n2": None, "ix_t1": now, "ix_t2": None, "body_json": raw, "actor_json": actor,
               "created_ms": now, "updated_ms": now}
        if sqldb.insert_new(c, "kh_record", row):
            rev = 1
        else:
            sqldb.update(c, "UPDATE kh_record SET state=?, ix_s2=?, ix_s3=?, ix_t1=?, body_json=?, actor_json=?, "
                            "updated_ms=?, rev=rev+1 WHERE ns=? AND type=? AND id=?",
                         [state, approver, decision, now, raw, actor, now, ctx.ns, APPROVAL_TYPE, rid])
            rev = int(c.execute("SELECT rev FROM kh_record WHERE ns=? AND type=? AND id=?",
                                [ctx.ns, APPROVAL_TYPE, rid]).fetchone()[0])
        c.execute("INSERT INTO kh_record_rev (ns, type, id, rev, state, schema_ver, body_json, actor_json, at_ms) "
                  "VALUES (?,?,?,?,?,?,?,?,?)", [ctx.ns, APPROVAL_TYPE, rid, rev, state, None, raw, actor, now])
    core.emit(ctx, "kh.intervention", {"kind": "approval", "effect_key": key, "decision": decision,
                                       "approver": approver, "high_risk": needs_approval(ctx.ns_row, key),
                                       "record": {"type": APPROVAL_TYPE, "id": rid, "rev": rev}})
    return core.reply(201 if rev == 1 else 200, {"type": APPROVAL_TYPE, "id": rid, "rev": rev, "state": state, **rec})


def _confirmer_resolver(request: Request, ns_row: dict):
    """core.CALLER_RESOLVERS entry: a signed-in person listed in settings.effects.confirm_policy is a confirmer
    of the namespace, so it can reach :approve. Owners, maintainers and service tokens fall through."""
    from app import auth
    p = auth.current()
    if p is None or getattr(p, "ns", None) or p.is_maintainer \
            or p.email == (ns_row.get("owner_email") or "").lower():
        return None
    if _effects_settings(ns_row) is None or p.email.lower() not in confirmer_emails(ns_row):
        return None
    projects = {x for x in ns_row.get("projects") or [] if p.can(x, "project.read")}
    return core.Caller(principal=p.email, role="confirmer", kind="person", on_behalf_of=p.email, projects=projects)


# ── effects ledger ───────────────────────────────────────────────────────────

def _effect(c, ns: str, key: str) -> dict | None:
    r = c.execute(f"SELECT effect_key, holder, state, result_json, claimed_until_ms, attempts, rev, "
                  f"{sqldb.now_ms_sql()} AS now_ms FROM kh_effect WHERE ns=? AND effect_key=?", [ns, key]).fetchone()
    if r is None:
        return None
    return {"key": r["effect_key"], "holder": r["holder"], "state": r["state"],
            "result": json.loads(r["result_json"]) if r["result_json"] else None,
            "claimed_until_ms": int(r["claimed_until_ms"]), "attempts": int(r["attempts"]), "rev": int(r["rev"]),
            "expired": r["state"] == "claimed" and int(r["claimed_until_ms"]) < int(r["now_ms"])}


def effect_action(ctx: Ctx, key: str, verb: str, body: dict):
    if not key or len(key) > 256:
        raise CapError("invalid", "an effect key is 1-256 characters")
    if verb == "approve":
        return approve_action(ctx, key, body)
    ctx.require("effects", "use")
    holder = ctx.caller.principal
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        if verb == "claim":
            ttl = body.get("ttl_s", EFFECT_TTL_DEFAULT_S)
            if not isinstance(ttl, (int, float)) or not 1 <= ttl <= 86400:
                raise CapError("invalid", "ttl_s must be between 1 and 86400")
            until = now + int(ttl * 1000)
            if needs_approval(ctx.ns_row, key):          # phase 4: checked in the claim's own transaction
                ok, ap = _approved(c, ctx, key)
                if not ok:
                    raise CapError("approval_required", f"effect {key} is high-risk: a listed human confirmer must "
                                   f"approve it first (POST /v1/{ctx.ns}/effects/{key}:approve)", status=428,
                                   extra={"effect_key": key, "approval": ap})
            won = sqldb.insert_new(c, "kh_effect", {"ns": ctx.ns, "effect_key": key, "holder": holder,
                                                    "state": "claimed", "result_json": None,
                                                    "claimed_until_ms": until, "attempts": 1, "rev": 1,
                                                    "created_ms": now, "updated_ms": now})
            if not won:
                # An expired claim (crashed holder) or a failed attempt may be claimed again - conditionally.
                won = sqldb.update(c, "UPDATE kh_effect SET holder=?, state='claimed', claimed_until_ms=?, "
                                      "attempts=attempts+1, rev=rev+1, updated_ms=? WHERE ns=? AND effect_key=? AND "
                                      f"(state='failed' OR (state='claimed' AND claimed_until_ms < {sqldb.now_ms_sql()}))",
                                   [holder, until, now, ctx.ns, key]) > 0
            cur = _effect(c, ctx.ns, key)
            if not won:
                raise CapError("effect_claimed", f"effect {key} is {cur['state']}", extra={"effect": cur})
            return core.reply(201, cur)
        state = "done" if verb == "complete" else "failed"
        payload = body.get("result") if verb == "complete" else {"error": body.get("error")}
        if not sqldb.update(c, "UPDATE kh_effect SET state=?, result_json=?, rev=rev+1, updated_ms=? "
                               "WHERE ns=? AND effect_key=? AND holder=? AND state='claimed'",
                            [state, json.dumps(payload, ensure_ascii=False), now, ctx.ns, key, holder]):
            cur = _effect(c, ctx.ns, key)
            if cur is None:
                raise CapError("not_found", f"no effect {key}")
            raise CapError("effect_claimed", f"effect {key} is {cur['state']} by {cur['holder']}", extra={"effect": cur})
        return _effect(c, ctx.ns, key)


# ── routes ───────────────────────────────────────────────────────────────────

async def _body(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        return {}
    try:
        b = json.loads(raw)
    except ValueError:
        raise CapError("invalid", "body must be JSON")
    if not isinstance(b, dict):
        raise CapError("invalid", "body must be a JSON object")
    return b


def attach(app) -> None:
    TAG = ["v1 coordination"]
    if _confirmer_resolver not in core.CALLER_RESOLVERS:
        core.CALLER_RESOLVERS.append(_confirmer_resolver)

    @app.post("/v1/{ns}/leases/{name:path}", tags=TAG,
              summary="Lease :acquire {ttl_s} | :renew {epoch, ttl_s} | :release {epoch}")
    @core.idempotent
    async def lease_post(request: Request, ns: str, name: str, ctx: Ctx = Depends(ns_ctx)):
        lease, verb = _split(name, ("acquire", "renew", "release"))
        return await asyncio.to_thread(lease_action, ctx, lease, verb, await _body(request))

    @app.get("/v1/{ns}/leases", tags=TAG, summary="Leases of a namespace by name prefix")
    async def leases_list(ns: str, prefix: str = "", limit: int = 500, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("leases", "use")

        def run():
            with sqldb.connect() as c:
                return {"leases": sqldb.lease_list(c, ns, prefix, max(1, min(limit, 1000)))}
        return await asyncio.to_thread(run)

    @app.get("/v1/{ns}/leases/{name:path}", tags=TAG, summary="One lease")
    async def lease_get(ns: str, name: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("leases", "use")

        def run():
            with sqldb.connect() as c:
                return sqldb.lease_get(c, ns, name)
        got = await asyncio.to_thread(run)
        if got is None:
            raise CapError("not_found", f"no lease {name}")
        return got

    @app.post("/v1/{ns}/effects/{key:path}", tags=TAG,
              summary="Side-effect ledger :claim {ttl_s} | :complete {result} | :fail {error} | "
                      ":approve {decision}")
    @core.idempotent
    async def effect_post(request: Request, ns: str, key: str, ctx: Ctx = Depends(ns_ctx)):
        effect, verb = _split(key, ("claim", "complete", "fail", "approve"))
        return await asyncio.to_thread(effect_action, ctx, effect, verb, await _body(request))

    @app.get("/v1/{ns}/effects/{key:path}", tags=TAG, summary="One side effect and its recorded state")
    async def effect_get(ns: str, key: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("effects", "use")

        def run():
            with sqldb.connect() as c:
                got = _effect(c, ns, key)
                gated, ap = needs_approval(ctx.ns_row, key), _approval(c, ns, key)
            if gated or ap is not None:
                got = {**(got or {"key": key, "state": "unclaimed"}), "approval_required": gated, "approval": ap}
            return got
        got = await asyncio.to_thread(run)
        if got is None:
            raise CapError("not_found", f"no effect {key}")
        return got


__all__ = ["idem_begin", "idem_finish", "idem_abort", "lease_action", "effect_action", "approve_action",
           "approval_prefixes", "needs_approval", "config"]
