"""Append-only event store with gapless cursors (docs/multi-agent-instance-design.md 4.4).

  POST /v1/{ns}/events               one event or {"events": [...]} (<= 500); all or nothing unless ?partial=true
  GET  /v1/{ns}/events?after_seq=&kind=&run_id=&unit_id=&limit=&wait_s=   cursor read, long poll <= 25 s
  GET  /v1/{ns}/events/{id}
  GET  /v1/{ns}/events:stats?group_by=kind,ix_s1&since=

An event: {id?, kind, project?, ts_ms?, run_id?, unit_id?, session_id?, attempt?, epoch?, body}. ``kind`` must be
an event type of the namespace manifest; its JSON Schema ``required`` and its ``required_envelope`` are
enforced (422 with a JSON pointer per error). A fenced kind needs X-KH-Lease / X-KH-Epoch, checked inside the
insert transaction. A repeated ``id`` is a duplicate: 200 with the original seq, plus a kh.duplicate event.

GAPLESS SEQ. ``seq`` comes from kh_counter('ev:<ns>') in the same transaction as the insert. The batch first
locks that counter row, so concurrent appends to one namespace serialize on it and commit in seq order: a
cursor reader (after_seq) never skips a row that commits later with a smaller seq.

KH writes its own ``kh.*`` events through ``append_system`` (registered as core's emitter).

STORAGE goes through the EventStore port (app/eventing/store.py, KH_EVENT_STORE, default ``sql`` = kh_event in
KH's relational store); this module validates, fences and routes. A namespace listed in KH_EVENTS_BUFFERED_NS
sends its unfenced batches through the event queue (app/eventing/queue.py): the answer then says ``queued`` and
carries no seq; a fenced kind always writes straight through, inside its lease check.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
import time

from fastapi import Depends, Request

from app import sqldb
from app.caps import core, registry
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "events"
VERSION = "1.0.0"
STATUS = "beta"
BATCH_MAX = 500
BODY_MAX = 256 * 1024
READ_MAX = 1000
WAIT_MAX_S = 25
LIMITS = {"batch_max": BATCH_MAX, "body_bytes": BODY_MAX, "read_limit": READ_MAX, "long_poll_s": WAIT_MAX_S}

ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
IX = ["ix_s1", "ix_s2", "ix_s3", "ix_s4", "ix_n1", "ix_n2"]
COLS = (["ns", "seq", "id", "project", "kind", "ts_ms", "received_ms", "run_id", "unit_id", "session_id", "attempt",
         "epoch", "actor_json", "schema_ver"] + IX + ["body_json"])
GROUPABLE = {"kind", "project", "run_id", "unit_id", "session_id"} | set(IX[:4])
#: Body filters other capabilities register in attach (redaction, canaries; docs/caps-dev.md section 9):
#: fn(ctx, where, body) -> body, run on every event body before validation and storage. A CapError rejects the event.
BODY_FILTERS: list = []

_DDL = ("""CREATE TABLE IF NOT EXISTS kh_event (
             ns TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT NOT NULL, project TEXT NOT NULL DEFAULT '',
             kind TEXT NOT NULL, ts_ms INTEGER NOT NULL, received_ms INTEGER NOT NULL, run_id TEXT, unit_id TEXT,
             session_id TEXT, attempt INTEGER, epoch INTEGER, actor_json TEXT NOT NULL, schema_ver INTEGER,
             ix_s1 TEXT, ix_s2 TEXT, ix_s3 TEXT, ix_s4 TEXT, ix_n1 REAL, ix_n2 REAL, body_json TEXT NOT NULL,
             PRIMARY KEY (ns, seq))""",
        """CREATE COLUMN TABLE kh_event (
             ns NVARCHAR(32) NOT NULL, seq BIGINT NOT NULL, id NVARCHAR(64) NOT NULL, project NVARCHAR(256) NOT NULL,
             kind NVARCHAR(128) NOT NULL, ts_ms BIGINT NOT NULL, received_ms BIGINT NOT NULL, run_id NVARCHAR(128),
             unit_id NVARCHAR(128), session_id NVARCHAR(128), attempt BIGINT, epoch BIGINT, actor_json NCLOB NOT NULL,
             schema_ver BIGINT, ix_s1 NVARCHAR(256), ix_s2 NVARCHAR(256), ix_s3 NVARCHAR(256), ix_s4 NVARCHAR(256),
             ix_n1 DOUBLE, ix_n2 DOUBLE, body_json NCLOB NOT NULL, PRIMARY KEY (ns, seq))""")
TABLES = ["kh_event"]


def _m1(c) -> None:
    sqldb.create_table(c, "kh_event", *_DDL)
    sqldb.create_index(c, "ux_kh_event_id", "kh_event", "ns, id", unique=True)
    sqldb.create_index(c, "ix_kh_event_run", "kh_event", "ns, run_id")
    sqldb.create_index(c, "ix_kh_event_kind_ts", "kh_event", "ns, kind, ts_ms")
    sqldb.create_index(c, "ix_kh_event_unit", "kh_event", "ns, unit_id")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


def new_id() -> str:
    """Time-ordered id: 12 hex ms + 12 hex random (ULID-like ordering, URL-safe)."""
    return f"{int(time.time() * 1000):012x}{secrets.token_hex(6)}"


def _counter(ns: str) -> str:
    return "ev:" + ns


# ── the write path ───────────────────────────────────────────────────────────

def _prepare(ctx: Ctx, i: int, ev) -> tuple[dict | None, list[dict]]:
    """Validate one event; returns (row without seq, errors). ``received_ms`` (and ``ts_ms`` when the client sent
    none) are stamped from the database clock inside the insert transaction."""
    errors: list[dict] = []
    if not isinstance(ev, dict):
        return None, [{"pointer": f"/events/{i}", "message": "an event must be an object"}]
    kind = ev.get("kind")
    if not isinstance(kind, str) or not kind:
        return None, [{"pointer": "/kind", "message": "kind is required"}]
    if kind.startswith("kh."):
        return None, [{"pointer": "/kind", "message": "the kh. prefix is written by KH only"}]
    t = (ctx.ns_row.get("types") or {}).get(kind)
    if t is None or t["kind_of"] != "event":
        return None, [{"pointer": "/kind", "message": f"{kind} is not an event kind of this namespace"}]
    if not core.acl_allows(t, ctx.role, "write"):
        return None, [{"pointer": "/kind", "message": f"role {ctx.role} may not append {kind}"}]
    eid = ev.get("id") or new_id()
    if not isinstance(eid, str) or not ID_RE.match(eid):
        errors.append({"pointer": "/id", "message": "id must be 1-64 of [A-Za-z0-9_-]"})
    body = ev.get("body", {})
    try:
        for f in BODY_FILTERS:
            body = f(ctx, "events", body)
    except CapError as exc:
        return None, [{"pointer": "/body", "message": exc.detail, "error": exc.code}]
    raw = json.dumps(body, ensure_ascii=False)
    if len(raw.encode("utf-8")) > BODY_MAX:
        errors.append({"pointer": "/body", "message": f"body is larger than {BODY_MAX} bytes"})
    env = {"run_id": ev.get("run_id") or ctx.run_id, "unit_id": ev.get("unit_id") or ctx.unit_id,
           "session_id": ev.get("session_id") or ctx.session_id,
           "attempt": ev.get("attempt") if ev.get("attempt") is not None else ctx.attempt,
           "epoch": ev.get("epoch")}
    fenced = core.fence_headers(ctx.request)
    if env["epoch"] is None and fenced:
        env["epoch"] = fenced[1]
    for k in t.get("required_envelope") or []:
        if env.get(k) in (None, ""):
            errors.append({"pointer": f"/{k}", "message": f"{k} is required for {kind}"})
    for k in ("attempt", "epoch"):
        if env[k] is not None and not isinstance(env[k], int):
            errors.append({"pointer": f"/{k}", "message": f"{k} must be an integer"})
    for k in ("run_id", "unit_id", "session_id"):
        if env[k] is not None and (not isinstance(env[k], str) or len(env[k]) > 128):
            errors.append({"pointer": f"/{k}", "message": f"{k} must be a string <= 128"})
    ts = ev.get("ts_ms")
    if ts is not None and (not isinstance(ts, int) or isinstance(ts, bool)):
        errors.append({"pointer": "/ts_ms", "message": "ts_ms must be integer epoch ms"})
    errors += [{"pointer": "/body" + e["pointer"], "message": e["message"]} for e in registry.validate(ctx.ns, t, body)]
    if errors:
        return None, errors
    try:
        project = ctx.require_project(ev.get("project"))
    except CapError as exc:
        return None, [{"pointer": "/project", "message": exc.detail}]
    row = {"ns": ctx.ns, "id": eid, "project": project, "kind": kind, "ts_ms": ts, "received_ms": None,
           **env, "actor_json": core.jdump(ctx.actor()), "schema_ver": t.get("schema_version"),
           **{c: None for c in IX}, **registry.index_values(t, body), "body_json": raw}
    row["_fenced"] = bool(t.get("fenced"))
    return row, []


def _store():
    from app.eventing.store import get_store
    return get_store()


def _insert_tx(ns: str, rows: list[dict], ctx: Ctx | None = None, needs_fence: bool = False) -> list[dict]:
    """Store ``rows`` with gapless seq; with ``ctx`` the lease fence runs inside the same transaction."""
    guard = (lambda c: core.fence(ctx, c, required=needs_fence)) if ctx is not None else None
    store = _store()
    if guard is not None and needs_fence and not store.supports_guard:
        raise CapError("unsupported", f"the event store '{store.name}' cannot fence {ns} events")
    return store.append(ns, rows, guard)


def append(ctx: Ctx, events: list, partial: bool = False) -> tuple[int, dict]:
    ctx.require("events", "append")
    if len(events) > BATCH_MAX:
        raise CapError("too_large", f"at most {BATCH_MAX} events per call")
    accepted, rejected = [], []
    prepared = []
    for i, ev in enumerate(events):
        row, errors = _prepare(ctx, i, ev)
        if errors:
            rejected.append({"index": i, "errors": errors})
        else:
            prepared.append((i, row))
    if rejected and not partial:
        return 422, {"error": "validation_failed", "detail": "no event was stored (send ?partial=true to keep the "
                                                             "valid ones)", "accepted": [], "rejected": rejected}
    if not prepared:
        return 200, {"accepted": [], "rejected": rejected}
    needs_fence = any(r["_fenced"] for _, r in prepared)
    for _, r in prepared:
        r.pop("_fenced", None)
    from app.eventing import queue
    if not needs_fence and queue.buffered(ctx.ns):
        # Through the queue (app/eventing/queue.py): accepted now, stored by the writer within a second or so.
        queue.publish(ctx.ns, [r for _, r in prepared])
        return 202, {"accepted": [{"index": i, "id": r["id"], "seq": None, "queued": True} for i, r in prepared],
                     "rejected": rejected}
    res = _insert_tx(ctx.ns, [r for _, r in prepared], ctx, needs_fence)
    for (i, _), r in zip(prepared, res):
        accepted.append({"index": i, **r})
    dups = [a for a in accepted if a["duplicate"]]
    if dups:
        core.emit(ctx, "kh.duplicate", {"event_ids": [d["id"] for d in dups][:100], "count": len(dups)})
    return 200, {"accepted": accepted, "rejected": rejected}


def append_system(ns: str, kind: str, body: dict, actor: dict) -> int:
    """KH's own kh.* event (core's emitter). Own transaction; returns its seq."""
    raw = json.dumps(body, ensure_ascii=False, default=str)
    row = {"ns": ns, "id": new_id(), "project": "", "kind": kind, "ts_ms": None, "received_ms": None,
           "run_id": actor.get("run_id"), "unit_id": actor.get("unit_id"), "session_id": actor.get("session_id"),
           "attempt": None, "epoch": None, "actor_json": core.jdump(actor), "schema_ver": None,
           **{x: None for x in IX}, "body_json": raw}
    return _insert_tx(ns, [row])[0]["seq"]


# ── the read path ────────────────────────────────────────────────────────────

def _decode(r) -> dict:
    from app.eventing.store import decode
    return decode(r)


def _hidden_kinds(ctx: Ctx) -> list[str]:
    """Event kinds whose type ACL does not let this role read them."""
    return [t for t, row in (ctx.ns_row.get("types") or {}).items()
            if row["kind_of"] == "event" and not core.acl_allows(row, ctx.role, "read")]


def read(ctx: Ctx, after_seq: int, kinds: list[str], run_id: str | None, unit_id: str | None, limit: int) -> list[dict]:
    return _store().read(ctx.ns, after_seq, kinds, _hidden_kinds(ctx), {"run_id": run_id, "unit_id": unit_id}, limit)


def stats(ctx: Ctx, group_by: list[str], since: int | None) -> list[dict]:
    bad = [g for g in group_by if g not in GROUPABLE]
    if bad or not group_by or len(group_by) > 4:
        raise CapError("invalid", f"group_by: 1-4 of {sorted(GROUPABLE)}")
    return _store().stats(ctx.ns, group_by, since, _hidden_kinds(ctx))


def _type_usage(c, ns: str, type_row: dict) -> int:
    if type_row.get("kind_of") != "event":
        return 0
    return _store().count_kind(ns, type_row["type"])


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    TAG = ["v1 events"]
    if append_system not in core._EMITTER:
        core._EMITTER.append(append_system)
    if _type_usage not in registry.TYPE_USAGE:
        registry.TYPE_USAGE.append(_type_usage)

    @app.post("/v1/{ns}/events", tags=TAG, summary="Append one event or a batch (<= 500)")
    @core.idempotent
    async def events_post(request: Request, ns: str, partial: bool = False, ctx: Ctx = Depends(ns_ctx)):
        raw = await request.body()
        try:
            doc = json.loads(raw or b"null")
        except ValueError:
            raise CapError("invalid", "body must be JSON")
        events = doc.get("events") if isinstance(doc, dict) and "events" in doc else [doc]
        if not isinstance(events, list):
            raise CapError("invalid", "events must be a list")
        status, out = await asyncio.to_thread(append, ctx, events, partial)
        return core.reply(status, out)

    @app.get("/v1/{ns}/events", tags=TAG, summary="Cursor read by seq (long poll with wait_s <= 25)")
    async def events_get(ns: str, after_seq: int = 0, kind: str = "", run_id: str = "", unit_id: str = "",
                         limit: int = 100, wait_s: float = 0, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("events", "read")
        kinds = [k for k in kind.split(",") if k]
        limit = max(1, min(limit, READ_MAX))
        deadline = time.monotonic() + max(0.0, min(wait_s, WAIT_MAX_S))
        while True:
            rows = await asyncio.to_thread(read, ctx, after_seq, kinds, run_id or None, unit_id or None, limit)
            if rows or time.monotonic() >= deadline:
                break
            await asyncio.sleep(0.25)
        return {"events": rows, "next_after_seq": rows[-1]["seq"] if rows else after_seq}

    @app.get("/v1/{ns}/events:stats", tags=TAG, summary="Counts grouped by kind / envelope / ix_s* columns")
    async def events_stats(ns: str, group_by: str = "kind", since: int | None = None, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("events", "read")
        return {"groups": await asyncio.to_thread(stats, ctx, [g for g in group_by.split(",") if g], since)}

    @app.get("/v1/{ns}/events/{event_id}", tags=TAG, summary="One event by id")
    async def event_get(ns: str, event_id: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("events", "read")

        r = await asyncio.to_thread(_store().get, ns, event_id)
        if r is None or r["kind"] in _hidden_kinds(ctx):
            raise CapError("not_found", f"no event {event_id}")
        return r
