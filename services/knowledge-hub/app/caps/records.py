"""Typed records: structured rows of any type a namespace registers (docs/multi-agent-instance-design.md 4.5).

  PUT   /v1/{ns}/records/{type}/{id}[?project=&state=]   create (If-None-Match: *) or update (If-Match: "<rev>")
  PATCH /v1/{ns}/records/{type}/{id}[?state=]            JSON merge patch (RFC 7386) on the current body
  GET   /v1/{ns}/records/{type}/{id}[?rev=]              the record, or one stored revision of it
  GET   /v1/{ns}/records/{type}/{id}:revisions           every revision (audit trail)
  POST  /v1/{ns}/records/{type}:query                    filters on index fields, order, decay, partition

A record type is a manifest type with ``kind_of: record``: its JSON Schema validates every body, its
``index_fields`` are promoted into the typed columns ix_s1..4 / ix_n1..2 / ix_t1..2 (queries filter only on
those), ``read_roles`` / ``write_roles`` narrow the role matrix (a type with ``write_roles: [admin]`` and
``read_roles: [agent, judge, distiller]`` is a read-only registry for those roles, with no special code),
``fenced`` demands X-KH-Lease / X-KH-Epoch (checked inside the write transaction) and ``require_if_match``
makes every update conditional (428 without If-Match).

REVISIONS. ``rev`` starts at 1; each write is ``UPDATE ... SET rev=rev+1 WHERE ... [AND rev=?] AND
state<>'final'`` and also stores the new revision in kh_record_rev, so a ledger stays auditable after later
fields are filled in. A conditional write that loses gets 409 write_conflict with the current record and its
ETag, plus a kh.write_conflict event. A record whose ``state`` is ``final`` is immutable (409 record_final).
Without If-Match a PUT is last-writer-wins (no lost revision: rev=rev+1 is atomic) and a PATCH is applied to
the revision it read (internal compare-and-swap, retried).

QUERY. ``{where: {field: value | {eq, ne, gt, gte, lt, lte, in}}, project, state, order: "-field" | [...],
limit <= 500, offset, decay: {field, half_life_days}, partition_by: field, per_partition}``. Fields are index
field names (or their ix_* columns) plus id, project, state, rev, schema_ver, created_ms, updated_ms. Decay
adds ``weight = 0.5 ** (age_days / half_life_days)`` with the age taken from the database clock; partitions
group the rows by one field (for example a model version) with a count and a weight sum per group.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time
from typing import Any

from fastapi import Depends, Request

from app import sqldb
from app.caps import core, registry
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "records"
VERSION = "1.0.0"
STATUS = "beta"
BODY_MAX = 256 * 1024
QUERY_MAX = 500
# Each lost round means another writer committed, so N concurrent writers need N attempts in the worst case.
# SQLite's single write lock hid that; HANA (row locks, a longer read->write window) exposes it.
PATCH_RETRIES = 16
REVISIONS_MAX = 1000
LIMITS = {"body_bytes": BODY_MAX, "query_limit": QUERY_MAX, "revisions_limit": REVISIONS_MAX}

ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,128}$")
STATE_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
FINAL = "final"
DEFAULT_STATE = "open"
IX = ["ix_s1", "ix_s2", "ix_s3", "ix_s4", "ix_n1", "ix_n2", "ix_t1", "ix_t2"]
COLS = (["ns", "type", "id", "project", "schema_ver", "rev", "state"] + IX
        + ["body_json", "actor_json", "created_ms", "updated_ms"])
#: Envelope columns a query may filter, order or partition on (besides the type's index fields).
ENVELOPE_COLS = {"id", "project", "state", "rev", "schema_ver", "created_ms", "updated_ms"}
TIME_COLS = {"created_ms", "updated_ms", "ix_t1", "ix_t2"}
OPS = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}

_DDL = {
    "kh_record": ("""CREATE TABLE IF NOT EXISTS kh_record (
                       ns TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL, project TEXT NOT NULL DEFAULT '',
                       schema_ver INTEGER, rev INTEGER NOT NULL, state TEXT NOT NULL,
                       ix_s1 TEXT, ix_s2 TEXT, ix_s3 TEXT, ix_s4 TEXT, ix_n1 REAL, ix_n2 REAL,
                       ix_t1 INTEGER, ix_t2 INTEGER, body_json TEXT NOT NULL, actor_json TEXT NOT NULL,
                       created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, PRIMARY KEY (ns, type, id))""",
                  """CREATE COLUMN TABLE kh_record (
                       ns NVARCHAR(32) NOT NULL, type NVARCHAR(128) NOT NULL, id NVARCHAR(128) NOT NULL,
                       project NVARCHAR(256) NOT NULL, schema_ver BIGINT, rev BIGINT NOT NULL,
                       state NVARCHAR(32) NOT NULL, ix_s1 NVARCHAR(256), ix_s2 NVARCHAR(256), ix_s3 NVARCHAR(256),
                       ix_s4 NVARCHAR(256), ix_n1 DOUBLE, ix_n2 DOUBLE, ix_t1 BIGINT, ix_t2 BIGINT,
                       body_json NCLOB NOT NULL, actor_json NCLOB NOT NULL, created_ms BIGINT NOT NULL,
                       updated_ms BIGINT NOT NULL, PRIMARY KEY (ns, type, id))"""),
    "kh_record_rev": ("""CREATE TABLE IF NOT EXISTS kh_record_rev (
                           ns TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL,
                           state TEXT NOT NULL, schema_ver INTEGER, body_json TEXT NOT NULL,
                           actor_json TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (ns, type, id, rev))""",
                      """CREATE COLUMN TABLE kh_record_rev (
                           ns NVARCHAR(32) NOT NULL, type NVARCHAR(128) NOT NULL, id NVARCHAR(128) NOT NULL,
                           rev BIGINT NOT NULL, state NVARCHAR(32) NOT NULL, schema_ver BIGINT,
                           body_json NCLOB NOT NULL, actor_json NCLOB NOT NULL, at_ms BIGINT NOT NULL,
                           PRIMARY KEY (ns, type, id, rev))"""),
}
TABLES = list(_DDL)


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ix_kh_record_upd", "kh_record", "ns, type, updated_ms")
    sqldb.create_index(c, "ix_kh_record_crt", "kh_record", "ns, type, created_ms")
    for col in ("ix_s1", "ix_s2", "ix_s3", "ix_s4", "ix_n1", "ix_t1"):
        sqldb.create_index(c, f"ix_kh_record_{col}", "kh_record", f"ns, type, {col}")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── helpers ──────────────────────────────────────────────────────────────────

def _decode(r, with_rev_row: bool = False) -> dict:
    out = {"type": r["type"], "id": r["id"], "rev": int(r["rev"]), "state": r["state"],
           "schema_ver": r["schema_ver"], "body": json.loads(r["body_json"] or "null"),
           "actor": json.loads(r["actor_json"] or "{}")}
    if with_rev_row:
        out["at_ms"] = int(r["at_ms"])
    else:
        out.update(project=r["project"], created_ms=int(r["created_ms"]), updated_ms=int(r["updated_ms"]))
    return out


def _load(c, ns: str, rtype: str, rid: str):
    return c.execute("SELECT * FROM kh_record WHERE ns=? AND type=? AND id=?", [ns, rtype, rid]).fetchone()


def _visible(ctx: Ctx, project: str) -> bool:
    """A record of a project outside the caller's grant is invisible (404, never 403: no existence leak)."""
    return not project or ctx.caller.projects is None or project in ctx.caller.projects


def _check_id(rid: str) -> None:
    if not ID_RE.match(rid or ""):
        raise CapError("invalid", "record id must be 1-128 of [A-Za-z0-9_.-]")


def _check_state(state: str | None) -> str | None:
    if state is not None and not STATE_RE.match(state):
        raise CapError("invalid", "state must match [a-z][a-z0-9_]{0,31}")
    return state


def merge_patch(target: Any, patch: Any) -> Any:
    """RFC 7386 JSON merge patch."""
    if not isinstance(patch, dict):
        return patch
    out = dict(target) if isinstance(target, dict) else {}
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        else:
            out[k] = merge_patch(out.get(k), v)
    return out


def _redact(ctx: Ctx, t: dict, body: Any) -> Any:
    """REDACTION WRITE-PATH HOOK (design 4.11): every incoming record body or merge patch passes here once,
    before validation and storage and outside any transaction (redact.scrub writes kh.redacted itself and
    raises 422 redaction_refused on a refuse-mode match). A pass-through when redaction is not installed."""
    try:
        from app.caps import redact
    except ImportError:
        return body
    return redact.scrub(ctx, f"records/{t['type']}", body)


def _prepare(ctx: Ctx, t: dict, body: Any) -> tuple[Any, str]:
    """Size-check and validate a (redacted) body against the type's current schema. Returns (body, json)."""
    raw = json.dumps(body, ensure_ascii=False)
    if len(raw.encode("utf-8")) > BODY_MAX:
        raise CapError("too_large", f"record body is larger than {BODY_MAX} bytes")
    errors = registry.validate(ctx.ns, t, body)
    if errors:
        raise CapError("validation_failed", "body does not match the schema", extra={"errors": errors})
    return body, raw


def _conflict(ctx: Ctx, c, t: dict, rid: str, expected: int | None, reason: str = "rev") -> CapError:
    """409 write_conflict (or 404 / 409 record_final) after a conditional write changed nothing."""
    cur = _load(c, ctx.ns, t["type"], rid)
    if cur is None:
        return CapError("not_found", f"no record {t['type']}/{rid}")
    current = _decode(cur)
    if cur["state"] == FINAL:
        return CapError("record_final", f"record {t['type']}/{rid} is final and immutable", status=409,
                        extra={"current": current}, headers={"ETag": core.etag(current["rev"])})
    return CapError("write_conflict", "the record changed since you read it", extra={"current": current},
                    headers={"ETag": core.etag(current["rev"])},
                    kh_events=[(ctx.ns, "kh.write_conflict",
                                {"table": "kh_record", "type": t["type"], "id": rid, "reason": reason,
                                 "expected_rev": expected, "current_rev": current["rev"]}, ctx.actor())])


def _store_rev(c, ctx: Ctx, t: dict, rid: str, rev: int, state: str, raw: str, actor: str, now: int) -> None:
    c.execute("INSERT INTO kh_record_rev (ns, type, id, rev, state, schema_ver, body_json, actor_json, at_ms) "
              "VALUES (?,?,?,?,?,?,?,?,?)",
              [ctx.ns, t["type"], rid, rev, state, t.get("schema_version"), raw, actor, now])


def _update(c, ctx: Ctx, t: dict, rid: str, body: Any, raw: str, state: str | None,
            expected: int | None, now: int) -> dict:
    """Conditional UPDATE (rev=expected when given, never a final record) plus its revision row."""
    actor = core.jdump(ctx.actor())
    sets = {"schema_ver": t.get("schema_version"), **{x: None for x in IX}, **registry.index_values(t, body),
            "body_json": raw, "actor_json": actor, "updated_ms": now}
    if state is not None:
        sets["state"] = state
    where, params = "ns=? AND type=? AND id=? AND state<>?", [ctx.ns, t["type"], rid, FINAL]
    if expected is not None and expected >= 0:
        where += " AND rev=?"
        params.append(int(expected))
    n = sqldb.update(c, "UPDATE kh_record SET " + ", ".join(f"{k}=?" for k in sets) + ", rev=rev+1 WHERE " + where,
                     list(sets.values()) + params)
    if not n:
        raise _conflict(ctx, c, t, rid, expected)
    row = _load(c, ctx.ns, t["type"], rid)
    _store_rev(c, ctx, t, rid, int(row["rev"]), row["state"], raw, actor, now)
    return _decode(row)


def _insert(c, ctx: Ctx, t: dict, rid: str, project: str, body: Any, raw: str, state: str, now: int) -> bool:
    actor = core.jdump(ctx.actor())
    row = {"ns": ctx.ns, "type": t["type"], "id": rid, "project": project, "schema_ver": t.get("schema_version"),
           "rev": 1, "state": state, **{x: None for x in IX}, **registry.index_values(t, body), "body_json": raw,
           "actor_json": actor, "created_ms": now, "updated_ms": now}
    if not sqldb.insert_new(c, "kh_record", row):
        return False
    _store_rev(c, ctx, t, rid, 1, state, raw, actor, now)
    return True


# ── the write path ───────────────────────────────────────────────────────────

def put(ctx: Ctx, t: dict, rid: str, body: Any, project: str | None, state: str | None) -> tuple[int, dict]:
    """Create (If-None-Match: *), conditional update (If-Match) or upsert (neither; refused when the
    type requires If-Match). Returns (status, record)."""
    _check_id(rid)
    _check_state(state)
    create_only = core.if_none_match_star(ctx.request)
    expected = None if create_only else core.require_if_match(ctx.request, t)
    body, raw = _prepare(ctx, t, _redact(ctx, t, body))
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        status, rec = 200, None
        if create_only or (expected is None and _load(c, ctx.ns, t["type"], rid) is None):
            proj = ctx.require_project(project)
            if _insert(c, ctx, t, rid, proj, body, raw, state or DEFAULT_STATE, now):
                status, rec = 201, _decode(_load(c, ctx.ns, t["type"], rid))
            elif create_only:
                cur = _load(c, ctx.ns, t["type"], rid)
                raise CapError("duplicate", f"record {t['type']}/{rid} already exists",
                               headers={"ETag": core.etag(int(cur["rev"]))} if cur is not None else {},
                               kh_events=[(ctx.ns, "kh.write_conflict",
                                           {"table": "kh_record", "type": t["type"], "id": rid, "reason": "exists",
                                            "expected_rev": None, "current_rev": int(cur["rev"]) if cur else None},
                                           ctx.actor())])
        if rec is None:
            cur = _load(c, ctx.ns, t["type"], rid)
            if cur is None or not _visible(ctx, cur["project"]):
                raise CapError("not_found", f"no record {t['type']}/{rid}")
            if project and project != cur["project"]:
                raise CapError("invalid", "a record's project cannot change")
            rec = _update(c, ctx, t, rid, body, raw, state, expected, now)
        # Fencing inside the same transaction: the lease must still be held at this epoch at commit.
        core.fence(ctx, c, required=bool(t.get("fenced")))
    return status, rec


def patch(ctx: Ctx, t: dict, rid: str, doc: Any, state: str | None) -> dict:
    """JSON merge patch. With If-Match the patch applies only to that revision; without it (and when the
    type allows that) it applies to the revision it read, retrying on a concurrent write."""
    _check_id(rid)
    _check_state(state)
    expected = core.require_if_match(ctx.request, t)
    doc = _redact(ctx, t, doc)
    for attempt in range(PATCH_RETRIES):
        with sqldb.connect() as c:
            cur = _load(c, ctx.ns, t["type"], rid)
        if cur is None or not _visible(ctx, cur["project"]):
            raise CapError("not_found", f"no record {t['type']}/{rid}")
        base = int(cur["rev"])
        if cur["state"] == FINAL or (expected is not None and expected >= 0 and expected != base):
            with sqldb.connect() as c:
                raise _conflict(ctx, c, t, rid, expected)
        body, raw = _prepare(ctx, t, merge_patch(json.loads(cur["body_json"] or "null"), doc))
        try:
            with sqldb.connect() as c:
                rec = _update(c, ctx, t, rid, body, raw, state, base, sqldb.now_ms(c))
                core.fence(ctx, c, required=bool(t.get("fenced")))
            return rec
        except CapError as exc:
            # Our own read went stale (no If-Match from the caller): read again and re-apply the patch.
            if exc.code != "write_conflict" or (expected is not None and expected >= 0) \
                    or attempt == PATCH_RETRIES - 1:
                raise
            time.sleep(random.uniform(0, min(0.2, 0.005 * 2 ** attempt)))     # jittered backoff, <= 200 ms
    raise CapError("write_conflict", "too many concurrent writes")      # not reached


# ── the read path ────────────────────────────────────────────────────────────

def get(ctx: Ctx, t: dict, rid: str, rev: int | None) -> dict:
    with sqldb.connect() as c:
        r = _load(c, ctx.ns, t["type"], rid)
        if r is None or not _visible(ctx, r["project"]):
            raise CapError("not_found", f"no record {t['type']}/{rid}")
        rec = _decode(r)
        if rev is None or rev == rec["rev"]:
            return rec
        old = c.execute("SELECT * FROM kh_record_rev WHERE ns=? AND type=? AND id=? AND rev=?",
                        [ctx.ns, t["type"], rid, int(rev)]).fetchone()
    if old is None:
        raise CapError("not_found", f"record {t['type']}/{rid} has no revision {rev}")
    return {**_decode(old, with_rev_row=True), "project": rec["project"], "current_rev": rec["rev"]}


def revisions(ctx: Ctx, t: dict, rid: str, limit: int) -> list[dict]:
    with sqldb.connect() as c:
        r = _load(c, ctx.ns, t["type"], rid)
        if r is None or not _visible(ctx, r["project"]):
            raise CapError("not_found", f"no record {t['type']}/{rid}")
        rows = c.execute("SELECT * FROM kh_record_rev WHERE ns=? AND type=? AND id=? ORDER BY rev LIMIT ?",
                         [ctx.ns, t["type"], rid, int(limit)]).fetchall()
    return [_decode(x, with_rev_row=True) for x in rows]


def _col(t: dict, field: str) -> str:
    """Map a query field (index field name, its ix_* column, or an envelope column) to a column."""
    ixf = t.get("index_fields") or {}
    if field in ixf:
        return ixf[field]
    if field in ENVELOPE_COLS or field in ixf.values():
        return field
    raise CapError("invalid", f"{field} is not an index field of type {t['type']} "
                              f"(index fields: {sorted(ixf)}; envelope: {sorted(ENVELOPE_COLS)})")


def _scalar(v: Any) -> Any:
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        raise CapError("invalid", "filter values must be strings or numbers")
    return v


def query(ctx: Ctx, t: dict, q: dict) -> dict:
    if not isinstance(q, dict):
        raise CapError("invalid", "the query must be a JSON object")
    where, params = ["ns=?", "type=?"], [ctx.ns, t["type"]]
    w = q.get("where") or {}
    if not isinstance(w, dict):
        raise CapError("invalid", "where must be an object")
    for field, cond in w.items():
        col = _col(t, field)
        if not isinstance(cond, dict):
            cond = {"eq": cond}
        if not cond:
            raise CapError("invalid", f"empty condition for {field}")
        for op, v in cond.items():
            if op == "in":
                if not isinstance(v, list) or not v or len(v) > 100:
                    raise CapError("invalid", f"{field}.in must be a list of 1-100 values")
                where.append(f"{col} IN ({','.join('?' for _ in v)})")
                params += [_scalar(x) for x in v]
            elif op in OPS:
                if v is None and op in ("eq", "ne"):
                    where.append(f"{col} IS {'NOT ' if op == 'ne' else ''}NULL")
                else:
                    where.append(f"{col} {OPS[op]} ?")
                    params.append(_scalar(v))
            else:
                raise CapError("invalid", f"unknown operator {op} (use {sorted(OPS) + ['in']})")
    for k in ("project", "state"):
        if q.get(k) is not None:
            where.append(f"{k}=?")
            params.append(_scalar(q[k]))
    if ctx.caller.projects is not None:
        allowed = sorted(ctx.caller.projects)
        where.append(f"(project='' OR project IN ({','.join('?' for _ in allowed)}))" if allowed else "project=''")
        params += allowed

    decay = q.get("decay")
    dcol, half_life = None, None
    if decay is not None:
        if not isinstance(decay, dict):
            raise CapError("invalid", "decay must be {field, half_life_days}")
        dcol = _col(t, decay.get("field") or "created_ms")
        if dcol not in TIME_COLS:
            raise CapError("invalid", "decay.field must be created_ms, updated_ms or a time (t) index field")
        half_life = decay.get("half_life_days")
        if isinstance(half_life, bool) or not isinstance(half_life, (int, float)) or half_life <= 0:
            raise CapError("invalid", "decay.half_life_days must be a positive number")

    order = q.get("order")
    if order is None:
        order = [f"-{dcol}"] if dcol else ["-updated_ms"]
    if isinstance(order, str):
        order = [order]
    if not isinstance(order, list) or len(order) > 4:
        raise CapError("invalid", "order: a field or a list of up to 4 fields ('-' prefix = descending)")
    order_sql = []
    for o in order:
        if not isinstance(o, str) or not o:
            raise CapError("invalid", "order entries must be field names")
        desc = o.startswith("-")
        order_sql.append(f"{_col(t, o.lstrip('-+'))} {'DESC' if desc else 'ASC'}")
    order_sql.append("id ASC")

    try:
        limit = max(1, min(int(q.get("limit", 100)), QUERY_MAX))
        offset = max(0, int(q.get("offset", 0)))
    except (TypeError, ValueError):
        raise CapError("invalid", "limit and offset must be integers")
    pcol = _col(t, q["partition_by"]) if q.get("partition_by") else None
    per_partition = q.get("per_partition")
    if per_partition is not None and (not isinstance(per_partition, int) or per_partition < 1):
        raise CapError("invalid", "per_partition must be a positive integer")

    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        rows = c.execute(f"SELECT * FROM kh_record WHERE {' AND '.join(where)} ORDER BY {', '.join(order_sql)} "
                         f"LIMIT ? OFFSET ?", params + [limit, offset]).fetchall()
    out = []
    for r in rows:
        rec = _decode(r)
        rec["index"] = {name: r[col] for name, col in (t.get("index_fields") or {}).items()}
        if dcol:
            ts = r[dcol]
            rec["age_days"] = None if ts is None else max(0.0, (now - int(ts)) / 86400000.0)
            rec["weight"] = 0.0 if ts is None else 0.5 ** (rec["age_days"] / float(half_life))
        if pcol:
            rec["partition"] = r[pcol]
        out.append(rec)
    res: dict[str, Any] = {"type": t["type"], "now_ms": now, "limit": limit, "offset": offset}
    if pcol:
        groups: dict[Any, dict] = {}
        kept = []
        for rec in out:
            g = groups.setdefault(rec["partition"], {"key": rec["partition"], "n": 0, "weight_sum": 0.0, "ids": []})
            if per_partition is not None and g["n"] >= per_partition:
                continue
            g["n"] += 1
            g["ids"].append(rec["id"])
            if dcol:
                g["weight_sum"] += rec["weight"]
            kept.append(rec)
        out = kept
        res["partition_by"] = q["partition_by"]
        res["partitions"] = list(groups.values())
        if not dcol:
            for g in res["partitions"]:
                g.pop("weight_sum")
    res["records"] = out
    res["count"] = len(out)
    return res


def _type_usage(c, ns: str, type_row: dict) -> int:
    if type_row.get("kind_of") != "record":
        return 0
    return int(c.execute("SELECT COUNT(*) FROM kh_record WHERE ns=? AND type=?", [ns, type_row["type"]]).fetchone()[0])


# ── routes ───────────────────────────────────────────────────────────────────

async def _json_body(request: Request) -> Any:
    raw = await request.body()
    try:
        return json.loads(raw or b"null")
    except ValueError:
        raise CapError("invalid", "body must be JSON")


def attach(app) -> None:
    TAG = ["v1 records"]
    if _type_usage not in registry.TYPE_USAGE:
        registry.TYPE_USAGE.append(_type_usage)

    def rtype_of(ctx: Ctx, rtype: str, op: str) -> dict:
        t = registry.type_of(ctx, rtype, kind_of="record")
        ctx.require("records", "read" if op == "read" else "write", type_row=t, op=op)
        return t

    @app.post("/v1/{ns}/records/{rtype}:query", tags=TAG, summary="Query a record type (filters, decay, partition)")
    async def records_query(request: Request, ns: str, rtype: str, ctx: Ctx = Depends(ns_ctx)):
        t = rtype_of(ctx, rtype, "read")
        q = await _json_body(request)
        return await asyncio.to_thread(query, ctx, t, q or {})

    @app.put("/v1/{ns}/records/{rtype}/{rid}", tags=TAG,
             summary="Create (If-None-Match: *) or update (If-Match) a record")
    @core.idempotent
    async def record_put(request: Request, ns: str, rtype: str, rid: str, project: str = "", state: str = "",
                         ctx: Ctx = Depends(ns_ctx)):
        t = rtype_of(ctx, rtype, "write")
        body = await _json_body(request)
        status, rec = await asyncio.to_thread(put, ctx, t, rid, body, project or None, state or None)
        return core.reply(status, rec, {"ETag": core.etag(rec["rev"])})

    @app.patch("/v1/{ns}/records/{rtype}/{rid}", tags=TAG, summary="JSON merge patch of a record (If-Match)")
    @core.idempotent
    async def record_patch(request: Request, ns: str, rtype: str, rid: str, state: str = "",
                           ctx: Ctx = Depends(ns_ctx)):
        t = rtype_of(ctx, rtype, "write")
        doc = await _json_body(request)
        rec = await asyncio.to_thread(patch, ctx, t, rid, doc, state or None)
        return core.reply(200, rec, {"ETag": core.etag(rec["rev"])})

    @app.get("/v1/{ns}/records/{rtype}/{rid}:revisions", tags=TAG, summary="Every stored revision of a record")
    async def record_revisions(ns: str, rtype: str, rid: str, limit: int = REVISIONS_MAX, ctx: Ctx = Depends(ns_ctx)):
        t = rtype_of(ctx, rtype, "read")
        revs = await asyncio.to_thread(revisions, ctx, t, rid, max(1, min(limit, REVISIONS_MAX)))
        return {"type": rtype, "id": rid, "revisions": revs}

    @app.get("/v1/{ns}/records/{rtype}/{rid}", tags=TAG, summary="One record, or one revision with ?rev=")
    async def record_get(ns: str, rtype: str, rid: str, rev: int | None = None, ctx: Ctx = Depends(ns_ctx)):
        t = rtype_of(ctx, rtype, "read")
        rec = await asyncio.to_thread(get, ctx, t, rid, rev)
        return core.reply(200, rec, {"ETag": core.etag(rec["rev"])})
