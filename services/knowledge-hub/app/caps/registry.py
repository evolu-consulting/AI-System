"""Consumer registry: namespaces, the declarative manifest, schemas and discovery (design 3.2, 4.1).

A consumer exists in KH only as rows. ``PUT /v1/admin/ns/{ns}`` attaches a namespace;
``PUT /v1/{ns}/manifest`` declares, in one idempotent JSON document applied in one transaction,
its schemas (JSON Schema 2020-12, immutable per version), types (event kinds, record types, item and
metric kinds, each with index fields, ACLs, fencing, If-Match, retention and confirm policy),
keyspaces, quotas, retention, redaction packs, vaults, subscriptions and settings.

Every /v1/{ns}/ route resolves the namespace through ``ns_state`` - a per-instance cache with a
KH_NS_CACHE_S (default 5 s) bound - so a detach is seen by every instance within 5 s (G3).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
from typing import Any, Callable

from fastapi import Depends, Request
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from app import config, sqldb
from app.caps import core
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "registry"
VERSION = "1.0.0"
STATUS = "beta"
CACHE_S = float(config._env("KH_NS_CACHE_S", "5"))
LIMITS = {"schema_bytes": 65536, "types_per_ns": 200, "index_fields_per_type": 8, "ns_cache_s": CACHE_S}

STATES = ("active", "suspended", "detached", "purged")
KINDS_OF = ("record", "event", "item", "metric")
ENVELOPE = ("run_id", "unit_id", "session_id", "attempt", "epoch")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.\-]{0,127}$")
TYPE_RE = re.compile(r"^[a-z][a-z0-9_.\-]{0,127}$")
SUB_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$")
IX_SLOTS = {"s": ["ix_s1", "ix_s2", "ix_s3", "ix_s4"], "n": ["ix_n1", "ix_n2"], "t": ["ix_t1", "ix_t2"]}
EVENT_IX = {"s", "n"}                 # kh_event has no ix_t columns
MANIFEST_KEYS = {"schemas", "types", "keyspaces", "quotas", "retention", "redaction", "vaults", "subscriptions",
                 "settings", "manifest_version", "consumer", "description"}
GRACE_DAYS = int(config._env("KH_NS_GRACE_DAYS", "30"))
#: Days an event is kept when neither its type nor the manifest says otherwise (cron.retention, app/caps/lifecycle.py).
EVENTS_DAYS = max(1, int(config._env("KH_EVENTS_RETENTION_DAYS", "180")))

#: Hooks other modules register. TYPE_USAGE: fn(c, ns, type_row) -> rows using that type (blocks removal).
TYPE_USAGE: list[Callable] = []
#: ON_STATE: fn(c, ns, old_state, new_state) inside the state-change transaction (principals suspend, ...).
ON_STATE: list[Callable] = []
#: ON_ATTACH: fn(ns, owner_email) -> dict, after a namespace is first created (namespace client provisioning).
#: The results are returned in the 201 body under "client".
ON_ATTACH: list[Callable] = []
#: ON_MANIFEST: fn(c, ns, norm) inside the apply-manifest transaction, after types and subscriptions are written
#: (the outbox starts a new subscription's cursor here, so no event between apply and first fan-out is missed).
ON_MANIFEST: list[Callable] = []


# ── tables ───────────────────────────────────────────────────────────────────

_DDL = {
    "kh_ns": ("""CREATE TABLE IF NOT EXISTS kh_ns (
                   ns TEXT PRIMARY KEY, display TEXT NOT NULL DEFAULT '', state TEXT NOT NULL,
                   owner_email TEXT NOT NULL, projects_json TEXT NOT NULL, config_json TEXT NOT NULL,
                   manifest_json TEXT, manifest_sha TEXT, manifest_rev INTEGER NOT NULL DEFAULT 0,
                   created_ms INTEGER NOT NULL, detached_ms INTEGER, purge_after_ms INTEGER,
                   rev INTEGER NOT NULL DEFAULT 1)""",
              """CREATE COLUMN TABLE kh_ns (
                   ns NVARCHAR(32) PRIMARY KEY, display NVARCHAR(256) NOT NULL, state NVARCHAR(16) NOT NULL,
                   owner_email NVARCHAR(256) NOT NULL, projects_json NCLOB NOT NULL, config_json NCLOB NOT NULL,
                   manifest_json NCLOB, manifest_sha NVARCHAR(64), manifest_rev BIGINT NOT NULL,
                   created_ms BIGINT NOT NULL, detached_ms BIGINT, purge_after_ms BIGINT, rev BIGINT NOT NULL)"""),
    "kh_schema": ("""CREATE TABLE IF NOT EXISTS kh_schema (
                       ns TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, json_schema TEXT NOT NULL,
                       sha256 TEXT NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY (ns, name, version))""",
                  """CREATE COLUMN TABLE kh_schema (
                       ns NVARCHAR(32) NOT NULL, name NVARCHAR(128) NOT NULL, version BIGINT NOT NULL,
                       json_schema NCLOB NOT NULL, sha256 NVARCHAR(64) NOT NULL, created_ms BIGINT NOT NULL,
                       PRIMARY KEY (ns, name, version))"""),
    "kh_type": ("""CREATE TABLE IF NOT EXISTS kh_type (
                     ns TEXT NOT NULL, type TEXT NOT NULL, kind_of TEXT NOT NULL, schema_name TEXT,
                     current_ver INTEGER, index_fields_json TEXT NOT NULL, read_roles_json TEXT NOT NULL,
                     write_roles_json TEXT NOT NULL, fenced INTEGER NOT NULL DEFAULT 0,
                     require_if_match INTEGER NOT NULL DEFAULT 0, retention_days INTEGER,
                     confirm_policy_json TEXT NOT NULL, required_json TEXT NOT NULL,
                     state TEXT NOT NULL DEFAULT 'active', rev INTEGER NOT NULL DEFAULT 1,
                     PRIMARY KEY (ns, type))""",
                """CREATE COLUMN TABLE kh_type (
                     ns NVARCHAR(32) NOT NULL, type NVARCHAR(128) NOT NULL, kind_of NVARCHAR(16) NOT NULL,
                     schema_name NVARCHAR(128), current_ver BIGINT, index_fields_json NCLOB NOT NULL,
                     read_roles_json NVARCHAR(512) NOT NULL, write_roles_json NVARCHAR(512) NOT NULL,
                     fenced TINYINT NOT NULL, require_if_match TINYINT NOT NULL, retention_days BIGINT,
                     confirm_policy_json NCLOB NOT NULL, required_json NVARCHAR(512) NOT NULL,
                     state NVARCHAR(16) NOT NULL, rev BIGINT NOT NULL, PRIMARY KEY (ns, type))"""),
    "kh_keyspace": ("""CREATE TABLE IF NOT EXISTS kh_keyspace (
                         ns TEXT NOT NULL, keyspace TEXT NOT NULL, dims_json TEXT NOT NULL, config_json TEXT NOT NULL,
                         rev INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (ns, keyspace))""",
                    """CREATE COLUMN TABLE kh_keyspace (
                         ns NVARCHAR(32) NOT NULL, keyspace NVARCHAR(128) NOT NULL, dims_json NCLOB NOT NULL,
                         config_json NCLOB NOT NULL, rev BIGINT NOT NULL, PRIMARY KEY (ns, keyspace))"""),
    "kh_quota": ("""CREATE TABLE IF NOT EXISTS kh_quota (
                      ns TEXT NOT NULL, name TEXT NOT NULL, limit_value INTEGER NOT NULL, window_s INTEGER NOT NULL,
                      PRIMARY KEY (ns, name))""",
                 """CREATE COLUMN TABLE kh_quota (
                      ns NVARCHAR(32) NOT NULL, name NVARCHAR(128) NOT NULL, limit_value BIGINT NOT NULL,
                      window_s BIGINT NOT NULL, PRIMARY KEY (ns, name))"""),
    "kh_subscription": ("""CREATE TABLE IF NOT EXISTS kh_subscription (
                             ns TEXT NOT NULL, sub_id TEXT NOT NULL, kinds_json TEXT NOT NULL, url TEXT NOT NULL,
                             secret_ref TEXT, state TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1,
                             PRIMARY KEY (ns, sub_id))""",
                        """CREATE COLUMN TABLE kh_subscription (
                             ns NVARCHAR(32) NOT NULL, sub_id NVARCHAR(64) NOT NULL, kinds_json NCLOB NOT NULL,
                             url NVARCHAR(1024) NOT NULL, secret_ref NVARCHAR(256), state NVARCHAR(16) NOT NULL,
                             rev BIGINT NOT NULL, PRIMARY KEY (ns, sub_id))"""),
}
TABLES = list(_DDL)


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── the namespace state cache ────────────────────────────────────────────────

_cache: dict[tuple[str, str], tuple[float, dict | None]] = {}
_cache_lock = threading.Lock()


def _decode_ns(r) -> dict:
    return {"ns": r["ns"], "display": r["display"], "state": r["state"], "owner_email": r["owner_email"],
            "projects": json.loads(r["projects_json"] or "[]"), "config": json.loads(r["config_json"] or "{}"),
            "manifest_rev": int(r["manifest_rev"] or 0), "manifest_sha": r["manifest_sha"],
            "created_ms": int(r["created_ms"]), "detached_ms": r["detached_ms"],
            "purge_after_ms": r["purge_after_ms"], "rev": int(r["rev"])}


def _decode_type(r) -> dict:
    return {"type": r["type"], "kind_of": r["kind_of"], "schema": r["schema_name"],
            "schema_version": r["current_ver"], "index_fields": json.loads(r["index_fields_json"] or "{}"),
            "read_roles": json.loads(r["read_roles_json"] or "[]"),
            "write_roles": json.loads(r["write_roles_json"] or "[]"), "fenced": bool(r["fenced"]),
            "require_if_match": bool(r["require_if_match"]), "retention_days": r["retention_days"],
            "confirm_policy": json.loads(r["confirm_policy_json"] or "{}"),
            "required_envelope": json.loads(r["required_json"] or "[]"), "state": r["state"], "rev": int(r["rev"])}


def _load(ns: str) -> dict | None:
    with sqldb.connect() as c:
        r = c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
        if r is None:
            return None
        row = _decode_ns(r)
        row["types"] = {t["type"]: t for t in (_decode_type(x) for x in c.execute(
            "SELECT * FROM kh_type WHERE ns=? AND state='active'", [ns]).fetchall())}
        row["quotas"] = {q["name"]: (int(q["limit_value"]), int(q["window_s"])) for q in c.execute(
            "SELECT name, limit_value, window_s FROM kh_quota WHERE ns=?", [ns]).fetchall()}
    return row


def ns_state(ns: str) -> dict | None:
    """The namespace row (with its active types), at most CACHE_S seconds old. None when unknown."""
    if not core.NS_RE.match(ns or ""):
        return None
    key = (sqldb.location(), ns)
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    row = _load(ns)
    with _cache_lock:
        _cache[key] = (now + CACHE_S, row)
    return row


def invalidate(ns: str | None = None) -> None:
    """Drop this instance's cached copy (other instances refresh within CACHE_S)."""
    with _cache_lock:
        if ns is None:
            _cache.clear()
        else:
            _cache.pop((sqldb.location(), ns), None)


def type_of(ctx_or_row, type_name: str, kind_of: str | None = None) -> dict:
    """The manifest entry of an active type, or 404 not_found (or 422 when it is another kind)."""
    row = ctx_or_row.ns_row if isinstance(ctx_or_row, Ctx) else ctx_or_row
    t = (row.get("types") or {}).get(type_name)
    if t is None:
        raise CapError("not_found", f"type {type_name} is not registered in namespace {row['ns']}")
    if kind_of and t["kind_of"] != kind_of:
        raise CapError("invalid", f"type {type_name} is a {t['kind_of']}, not a {kind_of}")
    return t


# ── schemas and validation ───────────────────────────────────────────────────

_validators: dict[tuple[str, str, str, int], Draft202012Validator] = {}


def validator(ns: str, name: str, version: int) -> Draft202012Validator:
    """Compiled validator for an immutable schema version (cached for the process lifetime)."""
    key = (sqldb.location(), ns, name, int(version))
    v = _validators.get(key)
    if v is None:
        with sqldb.connect() as c:
            r = c.execute("SELECT json_schema FROM kh_schema WHERE ns=? AND name=? AND version=?",
                          [ns, name, int(version)]).fetchone()
        if r is None:
            raise CapError("not_found", f"schema {name} v{version} is not registered")
        v = Draft202012Validator(json.loads(r["json_schema"]))
        _validators[key] = v
    return v


def validate(ns: str, type_row: dict, body: Any) -> list[dict]:
    """Errors of ``body`` against the type's current schema: [{pointer, message}] (empty = valid)."""
    if not type_row.get("schema"):
        return []
    v = validator(ns, type_row["schema"], type_row["schema_version"])
    out = []
    for e in sorted(v.iter_errors(body), key=lambda e: list(e.absolute_path)):
        pointer = "/" + "/".join(str(p) for p in e.absolute_path) if e.absolute_path else ""
        out.append({"pointer": pointer, "message": e.message[:300]})
        if len(out) >= 50:
            break
    return out


def index_values(type_row: dict, body: Any) -> dict[str, Any]:
    """The promoted index columns of a body: {ix_s1: ..., ix_n1: ...} (missing fields are NULL)."""
    out: dict[str, Any] = {}
    src = body if isinstance(body, dict) else {}
    for name, col in (type_row.get("index_fields") or {}).items():
        v: Any = src
        for part in name.split("."):
            v = v.get(part) if isinstance(v, dict) else None
        if v is None:
            out[col] = None
        elif col.startswith("ix_s"):
            out[col] = (v if isinstance(v, str) else json.dumps(v, sort_keys=True))[:256]
        else:
            try:
                out[col] = float(v) if col.startswith("ix_n") else int(v)
            except (TypeError, ValueError):
                out[col] = None
    return out


# ── manifest parsing ─────────────────────────────────────────────────────────

def _err(errors: list, where: str, msg: str) -> None:
    errors.append({"pointer": where, "message": msg})


def parse_manifest(doc: Any, existing_types: dict[str, dict]) -> tuple[dict, list[dict]]:
    """Normalize and validate a manifest. Returns (normalized, errors)."""
    errors: list[dict] = []
    if not isinstance(doc, dict):
        return {}, [{"pointer": "", "message": "manifest must be a JSON object"}]
    for k in doc:
        if k not in MANIFEST_KEYS:
            _err(errors, f"/{k}", "unknown manifest section")
    norm: dict[str, Any] = {}

    # schemas: list of {name, version, schema} or {name: {version, schema}}
    raw = doc.get("schemas") or []
    if isinstance(raw, dict):
        raw = [{"name": k, **(v if isinstance(v, dict) else {})} for k, v in raw.items()]
    schemas = []
    seen = set()
    for i, s in enumerate(raw if isinstance(raw, list) else []):
        where = f"/schemas/{i}"
        if not isinstance(s, dict) or not NAME_RE.match(str(s.get("name") or "")):
            _err(errors, where, "a schema needs a name ([A-Za-z][A-Za-z0-9_.-]{0,127})")
            continue
        ver = s.get("version", 1)
        if not isinstance(ver, int) or ver < 1:
            _err(errors, where + "/version", "version must be an integer >= 1")
            continue
        body = s.get("schema")
        if not isinstance(body, dict):
            _err(errors, where + "/schema", "schema must be a JSON Schema object")
            continue
        if len(core.jdump(body).encode()) > LIMITS["schema_bytes"]:
            _err(errors, where + "/schema", f"schema is larger than {LIMITS['schema_bytes']} bytes")
            continue
        try:
            Draft202012Validator.check_schema(body)
        except SchemaError as e:
            _err(errors, where + "/schema", f"does not compile: {e.message[:200]}")
            continue
        if (s["name"], ver) in seen:
            _err(errors, where, "duplicate schema name and version")
            continue
        seen.add((s["name"], ver))
        schemas.append({"name": s["name"], "version": ver, "schema": body})
    norm["schemas"] = schemas
    latest = {}
    for s in schemas:
        latest[s["name"]] = max(latest.get(s["name"], 0), s["version"])

    # types
    types = []
    raw = doc.get("types") or []
    if not isinstance(raw, list):
        _err(errors, "/types", "types must be a list")
        raw = []
    if len(raw) > LIMITS["types_per_ns"]:
        _err(errors, "/types", f"at most {LIMITS['types_per_ns']} types per namespace")
    names = set()
    for i, t in enumerate(raw):
        where = f"/types/{i}"
        if not isinstance(t, dict):
            _err(errors, where, "a type must be an object")
            continue
        name = str(t.get("type") or "")
        if not TYPE_RE.match(name) or name.startswith("kh.") or name == "kh":
            _err(errors, where + "/type", "type must match [a-z][a-z0-9_.-]{0,127}; the kh. prefix is reserved")
            continue
        if name in names:
            _err(errors, where + "/type", "duplicate type")
            continue
        names.add(name)
        kind_of = t.get("kind_of", "record")
        if kind_of not in KINDS_OF:
            _err(errors, where + "/kind_of", f"kind_of must be one of {list(KINDS_OF)}")
            continue
        schema = t.get("schema")
        ver = t.get("schema_version")
        if schema is not None:
            if not isinstance(schema, str):
                _err(errors, where + "/schema", "schema must name a schema")
                continue
            ver = ver or latest.get(schema)
            if ver is None:
                _err(errors, where + "/schema", f"schema {schema} is not declared in this manifest")
                continue
            if (schema, ver) not in seen:
                _err(errors, where + "/schema_version", f"schema {schema} v{ver} is not declared in this manifest")
                continue
        ixf = t.get("index_fields") or {}
        if isinstance(ixf, list):
            ixf = {str(n): "s" for n in ixf}
        if not isinstance(ixf, dict) or len(ixf) > LIMITS["index_fields_per_type"]:
            _err(errors, where + "/index_fields", f"index_fields: an object of at most "
                                                  f"{LIMITS['index_fields_per_type']} fields")
            continue
        allowed_ix = EVENT_IX if kind_of == "event" else set(IX_SLOTS)
        bad = [k for k, v in ixf.items() if v not in allowed_ix or not NAME_RE.match(k)]
        if bad:
            _err(errors, where + "/index_fields", f"field types must be one of {sorted(allowed_ix)}: {bad}")
            continue
        mapping, msg = _assign_columns(ixf, (existing_types.get(name) or {}).get("index_fields") or {})
        if msg:
            _err(errors, where + "/index_fields", msg)
            continue
        roles_ok = set(core.ROLES) | {core.ADMIN}
        rr, wr = t.get("read_roles") or [], t.get("write_roles") or []
        if not isinstance(rr, list) or not isinstance(wr, list) or not set(rr + wr) <= roles_ok:
            _err(errors, where, f"read_roles/write_roles must be lists of {sorted(roles_ok)}")
            continue
        req = t.get("required_envelope") or []
        if not isinstance(req, list) or not set(req) <= set(ENVELOPE):
            _err(errors, where + "/required_envelope", f"required_envelope must be a subset of {list(ENVELOPE)}")
            continue
        ret = t.get("retention_days", EVENTS_DAYS if kind_of == "event" else None)
        if ret is not None and (not isinstance(ret, int) or ret < 1):
            _err(errors, where + "/retention_days", "retention_days must be a positive integer or null")
            continue
        cp = t.get("confirm_policy") or {}
        if not isinstance(cp, dict):
            _err(errors, where + "/confirm_policy", "confirm_policy must be an object")
            continue
        types.append({"type": name, "kind_of": kind_of, "schema": schema, "schema_version": ver,
                      "index_fields": mapping, "read_roles": rr, "write_roles": wr,
                      "fenced": bool(t.get("fenced", False)), "require_if_match": bool(t.get("require_if_match", False)),
                      "retention_days": ret, "confirm_policy": cp, "required_envelope": req})
    norm["types"] = types

    # keyspaces
    ks = []
    for i, k in enumerate(doc.get("keyspaces") or []):
        where = f"/keyspaces/{i}"
        dims = k.get("dims") if isinstance(k, dict) else None
        if not isinstance(k, dict) or not NAME_RE.match(str(k.get("keyspace") or "")) or not isinstance(dims, list) \
                or not dims or not all(isinstance(d, str) and NAME_RE.match(d) for d in dims) or len(dims) > 8:
            _err(errors, where, "a keyspace needs keyspace (name) and dims (1-8 names)")
            continue
        ks.append({"keyspace": k["keyspace"], "dims": dims, "config": k.get("config") or {}})
    norm["keyspaces"] = ks

    # quotas
    qs = []
    for i, q in enumerate(doc.get("quotas") or []):
        if not isinstance(q, dict) or not NAME_RE.match(str(q.get("name") or "")) \
                or not isinstance(q.get("limit"), int) or q["limit"] < 0 \
                or not isinstance(q.get("window_s", 60), int) or q.get("window_s", 60) < 1:
            _err(errors, f"/quotas/{i}", "a quota needs name, limit (int >= 0) and window_s (int >= 1)")
            continue
        qs.append({"name": q["name"], "limit": q["limit"], "window_s": q.get("window_s", 60)})
    norm["quotas"] = qs

    # subscriptions
    subs = []
    for i, s in enumerate(doc.get("subscriptions") or []):
        where = f"/subscriptions/{i}"
        if not isinstance(s, dict) or not SUB_RE.match(str(s.get("sub_id") or "")) \
                or not _sub_url_ok(str(s.get("url") or "")) or not isinstance(s.get("kinds"), list):
            _err(errors, where, "a subscription needs sub_id, kinds (list) and an https url")
            continue
        subs.append({"sub_id": s["sub_id"], "kinds": s["kinds"], "url": s["url"], "secret_ref": s.get("secret_ref"),
                     "state": "active" if s.get("state", "active") == "active" else "paused"})
    norm["subscriptions"] = subs

    # stored for later slices as configuration
    for key, kind in (("retention", dict), ("redaction", dict), ("settings", dict), ("vaults", list)):
        v = doc.get(key)
        if v is None:
            norm[key] = kind()
        elif not isinstance(v, kind):
            _err(errors, f"/{key}", f"{key} must be a {'list' if kind is list else 'object'}")
        else:
            norm[key] = v
    for i, v in enumerate(norm.get("vaults") or []):
        if not isinstance(v, dict) or not NAME_RE.match(str(v.get("vault_id") or "")):
            _err(errors, f"/vaults/{i}", "a vault needs vault_id")
    for key in ("manifest_version", "consumer", "description"):
        if key in doc:
            norm[key] = doc[key]
    return norm, errors


def _assign_columns(fields: dict[str, str], existing: dict[str, str]) -> tuple[dict, str | None]:
    """Map index field names to ix_* columns. Existing names keep their column (rows already use it)."""
    out: dict[str, str] = {}
    for name, col in existing.items():
        if name in fields:
            if col[3] != fields[name]:
                return {}, f"index field {name} cannot change type once registered"
            out[name] = col
    used = set(out.values())
    for name, kind in fields.items():
        if name in out:
            continue
        free = [c for c in IX_SLOTS[kind] if c not in used and c not in existing.values()]
        if not free:
            return {}, f"no free {kind} index column for {name} (s:4, n:2, t:2)"
        out[name] = free[0]
        used.add(free[0])
    return out, None


# ── manifest apply (one transaction) ─────────────────────────────────────────

def _sub_url_ok(url: str) -> bool:
    """https only; http://127.0.0.1 / localhost only with KH_OUTBOX_ALLOW_LOCAL=1 (tests, Docker dev)."""
    if url.startswith("https://"):
        return True
    import os
    return os.getenv("KH_OUTBOX_ALLOW_LOCAL") == "1" and url.startswith(("http://127.0.0.1", "http://localhost"))


def apply_manifest(ns: str, doc: dict, expected_rev: int | None, archive: bool = False,
                   actor: dict | None = None) -> dict:
    """Validate and apply a manifest in one transaction. Same manifest twice = no change."""
    with sqldb.connect() as c:
        r = c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
        if r is None:
            raise CapError("ns_not_active", f"namespace {ns} is not attached")
        nsrow = _decode_ns(r)
        existing = {t["type"]: t for t in (_decode_type(x) for x in
                                            c.execute("SELECT * FROM kh_type WHERE ns=?", [ns]).fetchall())}
        norm, errors = parse_manifest(doc, existing)
        if errors:
            raise CapError("invalid_manifest", "the manifest is not valid", extra={"errors": errors})
        sha = core.sha256_json(norm)
        if sha == nsrow["manifest_sha"]:
            return {"ns": ns, "changed": False, "manifest_rev": nsrow["manifest_rev"], "sha256": sha}
        if expected_rev is None and nsrow["manifest_rev"] > 0:
            raise CapError("precondition_required", "a manifest exists: send If-Match with its ETag",
                           headers={"ETag": core.etag(nsrow["manifest_rev"])})
        # The conditional UPDATE first: it serializes concurrent applies and decides If-Match.
        where_rev = nsrow["manifest_rev"] if expected_rev is None or expected_rev < 0 else expected_rev
        if not sqldb.update(c, "UPDATE kh_ns SET manifest_rev = manifest_rev + 1, manifest_sha=?, manifest_json=?, "
                               "config_json=? WHERE ns=? AND manifest_rev=?",
                            [sha, core.jdump(norm), core.jdump(_config_of(norm, nsrow["config"])), ns, where_rev]):
            cur = c.execute("SELECT manifest_rev FROM kh_ns WHERE ns=?", [ns]).fetchone()
            raise CapError("write_conflict", "the manifest changed since you read it",
                           extra={"current_rev": int(cur[0])}, headers={"ETag": core.etag(int(cur[0]))})
        now = sqldb.now_ms(c)
        for s in norm["schemas"]:
            body = core.jdump(s["schema"])
            ssha = core.sha256_json(s["schema"])
            if not sqldb.insert_new(c, "kh_schema", {"ns": ns, "name": s["name"], "version": s["version"],
                                                     "json_schema": body, "sha256": ssha, "created_ms": now}):
                old = c.execute("SELECT sha256 FROM kh_schema WHERE ns=? AND name=? AND version=?",
                                [ns, s["name"], s["version"]]).fetchone()
                if old["sha256"] != ssha:
                    raise CapError("schema_immutable", f"schema {s['name']} v{s['version']} already exists with "
                                                       "different content; publish a new version")
        removed = []
        for name, t in existing.items():
            if name in {x["type"] for x in norm["types"]} or t["state"] != "active":
                continue
            used = sum(int(fn(c, ns, t) or 0) for fn in TYPE_USAGE)
            if used and not archive:
                raise CapError("type_in_use", f"type {name} has {used} rows: remove it with ?archive=true",
                               extra={"type": name, "rows": used})
            if used:
                c.execute("UPDATE kh_type SET state='archived', rev=rev+1 WHERE ns=? AND type=?", [ns, name])
            else:
                c.execute("DELETE FROM kh_type WHERE ns=? AND type=?", [ns, name])
            removed.append(name)
        for t in norm["types"]:
            row = {"ns": ns, "type": t["type"], "kind_of": t["kind_of"], "schema_name": t["schema"],
                   "current_ver": t["schema_version"], "index_fields_json": core.jdump(t["index_fields"]),
                   "read_roles_json": core.jdump(t["read_roles"]), "write_roles_json": core.jdump(t["write_roles"]),
                   "fenced": int(t["fenced"]), "require_if_match": int(t["require_if_match"]),
                   "retention_days": t["retention_days"], "confirm_policy_json": core.jdump(t["confirm_policy"]),
                   "required_json": core.jdump(t["required_envelope"]), "state": "active"}
            old = existing.get(t["type"])
            if old is None:
                sqldb.insert_new(c, "kh_type", {**row, "rev": 1})
            else:
                if old["kind_of"] != t["kind_of"]:
                    raise CapError("invalid_manifest", f"type {t['type']} cannot change kind_of",
                                   extra={"errors": [{"pointer": "/types", "message": "kind_of is fixed"}]})
                sets = {k: v for k, v in row.items() if k not in ("ns", "type")}
                core.cas_update(None, c, "kh_type", {"ns": ns, "type": t["type"]}, sets, None)
        for table, rows, key in (("kh_keyspace", norm["keyspaces"], "keyspace"), ("kh_quota", norm["quotas"], "name"),
                                 ("kh_subscription", norm["subscriptions"], "sub_id")):
            c.execute(f"DELETE FROM {table} WHERE ns=?", [ns])
            for x in rows:
                if table == "kh_keyspace":
                    vals = {"ns": ns, "keyspace": x["keyspace"], "dims_json": core.jdump(x["dims"]),
                            "config_json": core.jdump(x["config"]), "rev": 1}
                elif table == "kh_quota":
                    vals = {"ns": ns, "name": x["name"], "limit_value": x["limit"], "window_s": x["window_s"]}
                else:
                    vals = {"ns": ns, "sub_id": x["sub_id"], "kinds_json": core.jdump(x["kinds"]), "url": x["url"],
                            "secret_ref": x["secret_ref"], "state": x["state"], "rev": 1}
                sqldb.insert_new(c, table, vals)
        for fn in ON_MANIFEST:
            fn(c, ns, norm)
        rev = int(c.execute("SELECT manifest_rev FROM kh_ns WHERE ns=?", [ns]).fetchone()[0])
    invalidate(ns)
    return {"ns": ns, "changed": True, "manifest_rev": rev, "sha256": sha, "types": len(norm["types"]),
            "schemas": len(norm["schemas"]), "removed_types": removed}


def _config_of(norm: dict, old: dict) -> dict:
    return {**(old or {}), "retention": norm.get("retention") or {}, "redaction": norm.get("redaction") or {},
            "vaults": norm.get("vaults") or [], "settings": norm.get("settings") or {}}


def get_manifest(ns: str) -> tuple[dict, int]:
    with sqldb.connect() as c:
        r = c.execute("SELECT manifest_json, manifest_rev FROM kh_ns WHERE ns=?", [ns]).fetchone()
    if r is None:
        raise CapError("ns_not_active", f"namespace {ns} is not attached")
    return (json.loads(r["manifest_json"]) if r["manifest_json"] else {}), int(r["manifest_rev"] or 0)


# ── namespace lifecycle ──────────────────────────────────────────────────────

def _admin_person(request: Request, projects: list[str], ns_row: dict | None) -> str:
    """Who may attach or change a namespace: a KH maintainer, or a person who owns every project it names
    (and, for an existing namespace, is its owner). Auth off: the local user."""
    from app import auth
    p = auth.current()
    if p is None:
        if auth.enabled():
            raise CapError("unauthorized", "sign-in required")
        return config.MSG_LOCAL_USER
    if getattr(p, "ns", None):
        raise CapError("forbidden", "service tokens cannot manage namespaces")
    if p.is_maintainer:
        return p.email
    if ns_row is not None and ns_row["owner_email"] != p.email:
        raise CapError("forbidden", "only the namespace owner or a maintainer may change it")
    if not projects or not all(p.is_owner(x) for x in projects):
        raise CapError("forbidden", "you must own every project the namespace uses")
    return p.email


def put_ns(ns: str, body: dict, request: Request) -> tuple[int, dict]:
    if not core.NS_RE.match(ns) or ns.startswith("kh") or ns in core.RESERVED_NS:
        raise CapError("invalid", "ns must match [a-z][a-z0-9_]{2,31}; the prefixes kh and _ and some words are "
                                  "reserved")
    projects = body.get("projects") or []
    if not isinstance(projects, list) or not all(isinstance(x, str) and x for x in projects):
        raise CapError("invalid", "projects must be a list of KH project ids")
    with sqldb.connect() as c:
        r = c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
        old = _decode_ns(r) if r else None
        # A purge that FINISHED leaves a tombstone (state purged, purge_after_ms NULL) and no rows: the id is free
        # again, exactly as :import treats it. Attaching it is a fresh attach (new owner check, new client).
        tomb = old is not None and old["state"] == "purged" and old["purge_after_ms"] is None
        if old is not None and old["state"] == "purged" and not tomb:
            raise CapError("invalid_transition", f"namespace {ns} is being purged; attach it again when that ends")
        who = _admin_person(request, projects, None if tomb else old)
        owner = (body.get("owner_email") or (None if tomb else (old or {}).get("owner_email")) or who).strip().lower()
        display = str(body.get("display") or (None if tomb else (old or {}).get("display")) or ns)[:256]
        if old is None or tomb:
            row ={"ns": ns, "display": display, "state": "active", "owner_email": owner,
                   "projects_json": core.jdump(sorted(set(projects))),
                   "config_json": core.jdump(body.get("config") or {}), "manifest_json": None, "manifest_sha": None,
                   "manifest_rev": 0, "created_ms": sqldb.now_ms(c), "detached_ms": None, "purge_after_ms": None,
                   "rev": 1}
            if old is None:
                claimed = sqldb.insert_new(c, "kh_ns", row)
            else:
                sets = {k: v for k, v in row.items() if k not in ("ns", "rev")}
                claimed = bool(sqldb.update(
                    c, "UPDATE kh_ns SET " + ", ".join(f"{k}=?" for k in sets) + ", rev=rev+1 "
                       "WHERE ns=? AND state='purged' AND purge_after_ms IS NULL", list(sets.values()) + [ns]))
            if not claimed:
                raise CapError("duplicate", f"namespace {ns} was attached concurrently")
            status = 201
        else:
            rev = core.if_match(request)
            core.cas_update(None, c, "kh_ns", {"ns": ns},
                            {"display": display, "owner_email": owner,
                             "projects_json": core.jdump(sorted(set(projects or old["projects"]))),
                             "config_json": core.jdump({**old["config"], **(body.get("config") or {})})},
                            rev)
            status = 200
        out = _decode_ns(c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone())
    invalidate(ns)
    if status == 201:
        for fn in ON_ATTACH:
            out["client"] = fn(ns, out["owner_email"])
    return status, out


def grace_days(ns_row: dict) -> int:
    """Days a detached namespace is kept: manifest retention.grace_days, else KH_NS_GRACE_DAYS (30)."""
    v = ((ns_row.get("config") or {}).get("retention") or {}).get("grace_days")
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else GRACE_DAYS


def set_state(ns: str, new_state: str, request: Request) -> dict:
    """detach / reattach / suspend / resume. Detach fences every lease of the namespace (epoch+1)."""
    with sqldb.connect() as c:
        r = c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
        if r is None:
            raise CapError("not_found", f"no namespace {ns}")
        old = _decode_ns(r)
        _admin_person(request, old["projects"], old)
        allowed = {"detached": ("active", "suspended"), "active": ("detached", "suspended"),
                   "suspended": ("active",)}
        if old["state"] == new_state:
            return old
        if old["state"] not in allowed[new_state]:
            raise CapError("invalid", f"cannot go from {old['state']} to {new_state}")
        now = sqldb.now_ms(c)
        if old["state"] == "detached" and old["purge_after_ms"] is not None and now > int(old["purge_after_ms"]):
            raise CapError("invalid_transition", f"namespace {ns} is past its grace period (purge pending)")
        sets = {"state": new_state}
        if new_state == "detached":
            sets.update(detached_ms=now, purge_after_ms=now + grace_days(old) * 86400000)
        elif new_state == "active":
            sets.update(detached_ms=None, purge_after_ms=None)
        if not sqldb.update(c, "UPDATE kh_ns SET " + ", ".join(f"{k}=?" for k in sets) + ", rev=rev+1 "
                               "WHERE ns=? AND state=?", list(sets.values()) + [ns, old["state"]]):
            raise CapError("write_conflict", "the namespace state changed concurrently")
        if new_state in ("detached", "active"):
            sqldb.lease_bump_all(c, ns)
        for fn in ON_STATE:
            fn(c, ns, old["state"], new_state)
        out = _decode_ns(c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone())
    invalidate(ns)
    body = {"ns": ns, "from": old["state"], "to": new_state}
    core.emit(ns, "kh.ns_state", body, {"principal": "kh"})
    core.emit(sqldb.KH_NS, "kh.ns_state", body, {"principal": "kh"})
    return out


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    TAG = ["v1 registry"]

    @app.put("/v1/admin/ns/{ns}", tags=TAG, summary="Attach or update a consumer namespace")
    async def ns_put(ns: str, request: Request):
        body = await _json(request)
        status, row = await asyncio.to_thread(put_ns, ns, body, request)
        return core.reply(status, row, {"ETag": core.etag(row["rev"])})

    @app.get("/v1/admin/ns/{ns}", tags=TAG, summary="One namespace")
    async def ns_get(ns: str, request: Request):
        def run():
            with sqldb.connect() as c:
                return c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
        r = await asyncio.to_thread(run)
        if r is None:
            raise CapError("not_found", f"no namespace {ns}")
        row = _decode_ns(r)
        _admin_person(request, row["projects"], row)
        return core.reply(200, row, {"ETag": core.etag(row["rev"])})

    @app.get("/v1/admin/ns", tags=TAG, summary="Namespaces the caller may manage")
    async def ns_list(request: Request):
        from app import auth
        def run():
            with sqldb.connect() as c:
                return [_decode_ns(r) for r in c.execute("SELECT * FROM kh_ns ORDER BY ns").fetchall()]
        rows = await asyncio.to_thread(run)
        p = auth.current()
        if p is not None and not p.is_maintainer:
            rows = [r for r in rows if r["owner_email"] == p.email]
        return {"namespaces": rows}

    @app.delete("/v1/admin/ns/{ns}", tags=TAG, summary="Detach a namespace (same as :detach)")
    async def ns_delete(ns: str, request: Request):
        return await asyncio.to_thread(set_state, ns, "detached", request)

    @app.post("/v1/admin/ns/{ns}:detach", tags=TAG, summary="Detach: every /v1/{ns} route answers 404 within 5 s")
    async def ns_detach(ns: str, request: Request):
        return await asyncio.to_thread(set_state, ns, "detached", request)

    @app.post("/v1/admin/ns/{ns}:reattach", tags=TAG, summary="Re-attach a detached namespace within grace")
    async def ns_reattach(ns: str, request: Request):
        return await asyncio.to_thread(set_state, ns, "active", request)

    @app.post("/v1/admin/ns/{ns}:suspend", tags=TAG, summary="Suspend: reads only (writes answer 423)")
    async def ns_suspend(ns: str, request: Request):
        return await asyncio.to_thread(set_state, ns, "suspended", request)

    @app.post("/v1/admin/ns/{ns}:resume", tags=TAG, summary="Resume a suspended namespace")
    async def ns_resume(ns: str, request: Request):
        return await asyncio.to_thread(set_state, ns, "active", request)

    @app.put("/v1/{ns}/manifest", tags=TAG, summary="Apply the namespace manifest (one transaction, If-Match)")
    async def manifest_put(request: Request, ns: str, archive: bool = False, ctx: Ctx = Depends(ns_ctx)):
        ctx.require_admin()
        body = await _json(request)
        out = await asyncio.to_thread(apply_manifest, ns, body, core.if_match(request), archive, ctx.actor())
        return core.reply(200, out, {"ETag": core.etag(out["manifest_rev"])})

    @app.get("/v1/{ns}/manifest", tags=TAG, summary="The namespace manifest as it is now")
    async def manifest_get(ns: str, ctx: Ctx = Depends(ns_ctx)):
        doc, rev = await asyncio.to_thread(get_manifest, ns)
        return core.reply(200, {"ns": ns, "manifest_rev": rev, "manifest": doc}, {"ETag": core.etag(rev)})


async def _json(request: Request) -> dict:
    raw = await request.body()
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        raise CapError("invalid", "body must be JSON")
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be a JSON object")
    return body
