"""Shared plumbing for stage F capability modules (docs/caps-dev.md explains how to use it).

A capability module never re-implements these:

  * ``CapError``            - every refusal, with a STABLE error code (design 6.4) and JSON body
                              ``{"error": code, "detail": ..., ...extra}``.
  * ``ns_ctx``              - FastAPI dependency for every ``/v1/{ns}/...`` route: resolves the namespace
                              through the 5 s state cache (404 / 423), resolves the caller (person,
                              namespace client, KH principal or the local single user) and returns ``Ctx``.
  * ``Ctx.require``         - the role matrix (design 3.4), narrowed by a type's ACL from the manifest.
  * ``fence``               - X-KH-Lease / X-KH-Epoch check inside the caller's transaction (409 stale_epoch).
  * ``if_match`` / ``cas_update`` / ``etag`` - revisions with If-Match (409 write_conflict, 428).
  * ``idempotent``          - decorator: Idempotency-Key replay / in_progress / idempotency_mismatch.
  * ``emit``                - write a ``kh.*`` event into the namespace's own event store.

Everything stateful lives in SQL through app/sqldb.py; nothing here depends on a process lock.
"""
from __future__ import annotations

import functools
import hashlib
import inspect
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse

from app import config, sqldb

logger = logging.getLogger(__name__)

NS_RE = re.compile(r"^[a-z][a-z0-9_]{2,31}$")
RESERVED_NS = {"admin", "me", "capabilities", "token", "redaction", "openapi", "health", "version"}

# ── errors ───────────────────────────────────────────────────────────────────

#: Stable codes a consumer may branch on. Add new ones here (never rename).
CODES = {
    "ns_not_active": 404, "ns_suspended": 423, "not_found": 404, "forbidden": 403, "unauthorized": 401,
    "invalid": 422, "validation_failed": 422, "invalid_manifest": 422, "schema_immutable": 409,
    "type_in_use": 409, "precondition_required": 428, "write_conflict": 409, "stale_epoch": 409,
    "lease_held": 409, "lease_lost": 409, "idempotency_mismatch": 422, "in_progress": 409, "quota": 429,
    "duplicate": 409, "effect_claimed": 409, "too_large": 413, "provisioner_unavailable": 503,
    "record_final": 409, "pack_immutable": 409, "redaction_refused": 422,
    "vault_not_declared": 404, "canary_conflict": 409, "version_order": 409, "assumption_final": 409,
    "leak_refused": 422, "lint_failed": 422, "invalid_transition": 409, "approval_required": 428,
    "improve_off": 409, "embedder_unavailable": 503,
}


class CapError(Exception):
    """A refusal with a stable code. ``extra`` is merged into the JSON body."""

    def __init__(self, code: str, detail: str = "", status: int | None = None,
                 extra: dict | None = None, headers: dict | None = None, kh_events: list | None = None):
        super().__init__(detail or code)
        self.code = code
        self.status = status or CODES.get(code, 400)
        self.detail = detail or code
        self.extra = extra or {}
        self.headers = headers or {}
        #: [(ns, kind, body, actor)] written by the error handler AFTER the failed transaction rolled back
        #: (writing them inside it would wait on the very lock the transaction holds).
        self.kh_events = kh_events or []

    def emit_events(self) -> None:
        events, self.kh_events = self.kh_events, []
        for ns, kind, body, actor in events:
            emit(ns, kind, body, actor)

    def response(self) -> JSONResponse:
        return JSONResponse({"error": self.code, "detail": self.detail, **self.extra}, status_code=self.status,
                            headers=self.headers)


def install_error_handler(app) -> None:
    @app.exception_handler(CapError)
    async def _cap_error(request: Request, exc: CapError):     # noqa: ARG001
        import asyncio
        if exc.kh_events:
            await asyncio.to_thread(exc.emit_events)
        return exc.response()


def reply(status: int, body: Any, headers: dict | None = None) -> JSONResponse:
    """A JSON response with a status and headers (what idempotency stores and replays)."""
    return JSONResponse(body, status_code=status, headers=headers or {})


def jdump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256_json(obj) -> str:
    return hashlib.sha256(jdump(obj).encode("utf-8")).hexdigest()


# ── roles ────────────────────────────────────────────────────────────────────

ROLES = ("orchestrator", "agent", "judge", "grader", "distiller", "confirmer")
ADMIN = "admin"

#: Design 3.4 default role matrix: role -> area -> allowed actions. A type ACL can only narrow it.
ROLE_MATRIX: dict[str, dict[str, set[str]]] = {
    "orchestrator": {"events": {"append", "read"}, "records": {"read", "write"}, "rules": {"read", "write"},
                     "packs": {"read", "write"}, "items": {"read"}, "retrieval": {"read"}, "worklog": {"append"},
                     "metrics": {"write", "read"}, "admin": {"principals", "leases"}, "leases": {"use"},
                     "effects": {"use"}},
    # agents propose findings (status proposed; a confirmer activates them) - D20 revised 2026-10-11
    "agent": {"events": {"append"}, "records": {"read", "write"}, "rules": {"read", "write"}, "packs": {"read"},
              "items": {"read", "propose"}, "retrieval": {"read"}, "worklog": {"append"}, "metrics": {"write"}, "leases": {"use"},
              "effects": {"use"}},
    "judge": {"events": {"append", "read"}, "records": {"read", "write"}, "rules": {"read"}, "packs": {"read"},
              "items": {"read"}, "retrieval": {"read"}, "worklog": {"append"}, "metrics": {"read"}, "leases": {"use"},
              "effects": {"use"}},
    "grader": {"events": {"append", "read"}, "records": {"read"}, "rules": {"read"}, "packs": {"read"},
               "items": {"read"}, "vault": {"read"}, "metrics": {"write", "read"}, "leases": {"use"},
               "effects": {"use"}},
    "distiller": {"events": {"read"}, "records": {"read"}, "rules": {"read"}, "packs": {"read"},
                  "items": {"propose", "write", "read"}, "retrieval": {"read"}, "metrics": {"read"}},
    "confirmer": {"events": {"read"}, "records": {"read"}, "rules": {"read", "confirm"},
                  "packs": {"read", "confirm"}, "items": {"read", "confirm", "withdraw"}, "retrieval": {"read"},
                  "metrics": {"read"}},
}


def role_allows(role: str, area: str, action: str) -> bool:
    if role == ADMIN:
        return True
    return action in ROLE_MATRIX.get(role, {}).get(area, set())


def acl_allows(type_row: dict | None, role: str, op: str) -> bool:
    """A type's manifest ACL (read_roles / write_roles). Empty list = the role matrix decides alone."""
    if role == ADMIN or not type_row:
        return True
    roles = type_row.get("read_roles" if op == "read" else "write_roles") or []
    return not roles or role in roles


# ── the caller and the request context ──────────────────────────────────────

@dataclass
class Caller:
    """Who is calling a namespace route. ``kind``: person | client | service | local."""
    principal: str                       # e-mail for people, 'ns:<id>' for KH principals
    role: str                            # admin or one of ROLES
    kind: str
    on_behalf_of: str | None = None
    projects: set[str] | None = None     # effective projects (None = every project of the namespace)


#: Callables ``(request, ns_row) -> Caller | None`` tried in order before the defaults (principals adds one).
CALLER_RESOLVERS: list[Callable] = []


@dataclass
class Ctx:
    ns: str
    ns_row: dict
    caller: Caller
    request: Request
    run_id: str | None = None
    unit_id: str | None = None
    session_id: str | None = None
    attempt: int | None = None
    extra: dict = field(default_factory=dict)

    @property
    def role(self) -> str:
        return self.caller.role

    @property
    def is_admin(self) -> bool:
        return self.caller.role == ADMIN

    def actor(self) -> dict:
        """actor_json stamped on every write (design 3.4)."""
        return {"principal": self.caller.principal, "role": self.caller.role, "on_behalf_of": self.caller.on_behalf_of,
                "run_id": self.run_id, "unit_id": self.unit_id, "session_id": self.session_id}

    def require(self, area: str, action: str, type_row: dict | None = None, op: str | None = None) -> None:
        """403 unless the role matrix allows ``action`` on ``area`` and the type ACL allows ``op``."""
        if not role_allows(self.role, area, action):
            raise CapError("forbidden", f"role {self.role} may not {action} {area}")
        if type_row is not None and not acl_allows(type_row, self.role, op or ("read" if action == "read" else "write")):
            raise CapError("forbidden", f"role {self.role} is not in the ACL of type {type_row.get('type')}")

    def require_admin(self) -> None:
        if not self.is_admin:
            raise CapError("forbidden", "namespace admin only")

    def require_project(self, project: str | None) -> str:
        """The project a write names must be one of the namespace's projects and the caller's grant."""
        project = (project or "").strip()
        allowed = set(self.ns_row.get("projects") or [])
        if not project:
            if not allowed:
                return ""
            if len(allowed) == 1:
                return next(iter(allowed))
            raise CapError("invalid", "project is required")
        if allowed and project not in allowed:
            raise CapError("forbidden", f"project {project} is not attached to namespace {self.ns}")
        if self.caller.projects is not None and project not in self.caller.projects:
            raise CapError("forbidden", f"no grant on project {project}")
        return project


def _default_caller(request: Request, ns_row: dict) -> Caller | None:
    from app import auth
    p = auth.current()
    if p is None:
        if auth.enabled():
            return None
        return Caller(principal=config.MSG_LOCAL_USER, role=ADMIN, kind="local")
    if getattr(p, "ns", None):
        return None                                  # service tokens are resolved by principals
    if p.is_maintainer or p.email == (ns_row.get("owner_email") or "").lower():
        return Caller(principal=p.email, role=ADMIN, kind="person", on_behalf_of=p.email)
    return None


def resolve_caller(request: Request, ns_row: dict) -> Caller:
    for fn in CALLER_RESOLVERS:
        got = fn(request, ns_row)
        if got is not None:
            return got
    got = _default_caller(request, ns_row)
    if got is None:
        raise CapError("forbidden", f"no access to namespace {ns_row.get('ns')}")
    return got


def _int_header(request: Request, name: str) -> int | None:
    v = request.headers.get(name)
    if v is None or v == "":
        return None
    try:
        return int(v)
    except ValueError:
        raise CapError("invalid", f"{name} must be an integer")


async def ns_ctx(request: Request, ns: str) -> Ctx:
    """Dependency for every /v1/{ns}/ route: namespace state (404/423) then the caller (403)."""
    import asyncio

    from app.caps import registry
    row = await asyncio.to_thread(registry.ns_state, ns)
    if row is None or row["state"] in ("detached", "purged"):
        raise CapError("ns_not_active", f"namespace {ns} is not attached")
    if row["state"] == "suspended" and request.method not in ("GET", "HEAD", "OPTIONS"):
        raise CapError("ns_suspended", f"namespace {ns} is suspended (reads only)")
    caller = await asyncio.to_thread(resolve_caller, request, row)
    rate_check(row, caller)
    h = request.headers
    return Ctx(ns=ns, ns_row=row, caller=caller, request=request, run_id=h.get("x-kh-run"),
               unit_id=h.get("x-kh-unit"), session_id=h.get("x-kh-session"),
               attempt=_int_header(request, "x-kh-attempt"))


# ── rate quotas (design 3.6, D21) ────────────────────────────────────────────

#: Defaults per namespace; a manifest quota of the same name overrides them. Per-instance token buckets
#: sized limit / KH_INSTANCE_COUNT: no database hit per request, imprecision bounded by one bucket.
RATE_DEFAULTS = {"requests_per_min_principal": (1200, 60), "requests_per_min_ns": (20000, 60)}
INSTANCES = max(1, int(config._env("KH_INSTANCE_COUNT", "1")))
_buckets: dict[tuple, list] = {}
_quota_noted: dict[tuple, float] = {}


def _take(key: tuple, limit: int, window_s: int) -> float:
    """0 when a token was taken, else the seconds until one is free."""
    import time as _t
    cap = max(1.0, limit / INSTANCES)
    rate = cap / max(1, window_s)
    now = _t.monotonic()
    b = _buckets.get(key)
    if b is None:
        b = _buckets[key] = [cap, now]
    b[0] = min(cap, b[0] + (now - b[1]) * rate)
    b[1] = now
    if b[0] >= 1:
        b[0] -= 1
        return 0.0
    return (1 - b[0]) / rate


def rate_check(ns_row: dict, caller: Caller) -> None:
    import time as _t
    quotas = ns_row.get("quotas") or {}
    for name, key in (("requests_per_min_principal", (ns_row["ns"], caller.principal)),
                      ("requests_per_min_ns", (ns_row["ns"],))):
        limit, window = quotas.get(name) or RATE_DEFAULTS[name]
        wait = _take((name,) + key, int(limit), int(window))
        if wait:
            events = []
            now = _t.monotonic()
            if now - _quota_noted.get((name,) + key, 0) > 10:      # at most one kh.quota per bucket per 10 s
                _quota_noted[(name,) + key] = now
                events.append((ns_row["ns"], "kh.quota", {"quota": name, "limit": limit, "window_s": window,
                                                          "principal": caller.principal}, {"principal": caller.principal}))
            raise CapError("quota", f"quota {name} exceeded", extra={"quota": name},
                           headers={"Retry-After": str(max(1, int(wait + 0.999)))}, kh_events=events)


# ── fencing ──────────────────────────────────────────────────────────────────

def fence_headers(request: Request) -> tuple[str, int] | None:
    """(lease, epoch) from X-KH-Lease / X-KH-Epoch, or None when the request carries neither."""
    lease = request.headers.get("x-kh-lease")
    epoch = _int_header(request, "x-kh-epoch")
    if lease is None and epoch is None:
        return None
    if not lease or epoch is None:
        raise CapError("invalid", "X-KH-Lease and X-KH-Epoch go together")
    return lease, epoch


def fence(ctx: Ctx, c, required: bool = False) -> tuple[str, int] | None:
    """Check the caller's lease epoch INSIDE transaction ``c`` (call it right after the guarded write,
    or AND ``sqldb.fence_sql()`` into the write itself). Raises 409 stale_epoch and writes kh.stale_epoch.

    ``required``: the type or kind is fenced, so a write without the headers is refused (428).
    """
    got = fence_headers(ctx.request)
    if got is None:
        if required:
            raise CapError("precondition_required", "this write is fenced: send X-KH-Lease and X-KH-Epoch")
        return None
    lease, epoch = got
    if not sqldb.fence_ok(c, ctx.ns, lease, epoch):
        raise stale_epoch(ctx, c, lease, epoch)
    return got


def stale_epoch(ctx: Ctx, c, lease: str, epoch: int) -> CapError:
    """The 409 stale_epoch refusal, carrying its kh.stale_epoch event."""
    cur = sqldb.lease_get(c, ctx.ns, lease)
    return CapError("stale_epoch", f"lease {lease} is not held at epoch {epoch}",
                    extra={"lease": lease, "epoch": epoch, "current_epoch": cur["epoch"] if cur else None},
                    kh_events=[(ctx.ns, "kh.stale_epoch", {"lease": lease, "epoch": epoch,
                                                           "current_epoch": cur["epoch"] if cur else None,
                                                           "path": ctx.request.url.path}, ctx.actor())])


# ── revisions and If-Match ───────────────────────────────────────────────────

def etag(rev: int) -> str:
    return f'"{int(rev)}"'


def if_match(request: Request) -> int | None:
    """The revision in If-Match (``"7"`` or ``W/"7"`` or ``7``), or None when absent."""
    v = request.headers.get("if-match")
    if v is None:
        return None
    v = v.strip()
    if v == "*":
        return -1
    v = v[2:] if v.startswith("W/") else v
    try:
        return int(v.strip('"'))
    except ValueError:
        raise CapError("invalid", "If-Match must be an ETag returned by KH")


def if_none_match_star(request: Request) -> bool:
    return (request.headers.get("if-none-match") or "").strip() == "*"


def require_if_match(request: Request, type_row: dict | None) -> int | None:
    """428 when the type demands If-Match and the request has none; otherwise the expected rev."""
    rev = if_match(request)
    if rev is None and type_row and type_row.get("require_if_match"):
        raise CapError("precondition_required", f"type {type_row.get('type')} requires If-Match")
    return rev


def cas_update(ctx: Ctx | None, c, table: str, key: dict, sets: dict, expected_rev: int | None,
               load_current: Callable[[], dict | None] | None = None, extra_where: str = "",
               extra_params: list | None = None) -> int:
    """UPDATE ``table`` SET sets, rev=rev+1 WHERE key AND rev=expected. Returns the new rev.

    expected_rev None = last writer wins (legacy behaviour). On 0 rows: 404 when the row is missing,
    otherwise 409 write_conflict with the current row and its ETag, and a kh.write_conflict event.
    """
    cols = list(sets)
    where = " AND ".join(f"{k}=?" for k in key)
    params = [sets[k] for k in cols] + [key[k] for k in key]
    if expected_rev is not None and expected_rev >= 0:
        where += " AND rev=?"
        params.append(int(expected_rev))
    if extra_where:
        where += " AND " + extra_where
        params += list(extra_params or [])
    set_sql = ", ".join([f"{k}=?" for k in cols] + ["rev = rev + 1"])
    if sqldb.update(c, f"UPDATE {table} SET {set_sql} WHERE {where}", params):
        r = c.execute(f"SELECT rev FROM {table} WHERE " + " AND ".join(f"{k}=?" for k in key), list(key.values())
                      ).fetchone()
        return int(r[0])
    current = load_current() if load_current else None
    if current is None:
        cur = c.execute(f"SELECT rev FROM {table} WHERE " + " AND ".join(f"{k}=?" for k in key),
                        list(key.values())).fetchone()
        if cur is None:
            raise CapError("not_found", f"no such row in {table}")
        current = {"rev": int(cur[0])}
    events = []
    if ctx is not None:
        events.append((ctx.ns, "kh.write_conflict", {"table": table, "key": key, "expected_rev": expected_rev,
                                                     "current_rev": current.get("rev")}, ctx.actor()))
    raise CapError("write_conflict", "the row changed since you read it", extra={"current": current},
                   headers={"ETag": etag(current.get("rev", 0))}, kh_events=events)


# ── kh.* events ──────────────────────────────────────────────────────────────

#: Set by app.caps.events when the event store is enabled: fn(ns, kind, body, actor) -> None.
_EMITTER: list[Callable] = []


def emit(ctx_or_ns, kind: str, body: dict, actor: dict | None = None) -> None:
    """Write a KH-owned ``kh.*`` event into the namespace's event store, in its OWN transaction. Never raises.

    Call it only when no transaction of this thread is open (after the ``with sqldb.connect()`` block):
    on SQLite the event insert waits for the database write lock. Inside a transaction, raise a
    CapError with ``kh_events=[...]`` instead; the error handler writes them after the rollback.
    """
    if not kind.startswith("kh."):
        raise ValueError("emit writes kh.* events only")
    if isinstance(ctx_or_ns, Ctx):
        ns, actor = ctx_or_ns.ns, actor or ctx_or_ns.actor()
    else:
        ns = ctx_or_ns
    for fn in _EMITTER:
        try:
            fn(ns, kind, body, actor or {})
        except Exception:
            logger.exception("caps - could not write %s for %s", kind, ns)


# ── idempotency ──────────────────────────────────────────────────────────────

def idempotent(handler):
    """Decorator for a /v1 POST/PUT/PATCH route with parameters ``request: Request`` and ``ctx: Ctx``.

    With an Idempotency-Key header the first call runs and its response is stored; a repeat with the
    same request hash replays it (and writes kh.duplicate), a repeat while the first still runs gets
    409 in_progress with Retry-After: 1, a different body under the same key gets 422
    idempotency_mismatch. Without the header the route runs normally. Needs the coord capability.
    """
    @functools.wraps(handler)
    async def wrapper(*args, **kwargs):
        request: Request = kwargs["request"]
        ctx: Ctx = kwargs["ctx"]
        key = request.headers.get("idempotency-key")
        if not key:
            return await handler(*args, **kwargs)
        import asyncio

        from app.caps import coord
        raw = await request.body()
        req_hash = hashlib.sha256(f"{request.method} {request.url.path}?{request.url.query}\n".encode() + raw
                                  ).hexdigest()
        replay = await asyncio.to_thread(coord.idem_begin, ctx, key, req_hash)
        if replay is not None:
            return replay
        try:
            result = await handler(*args, **kwargs)
        except CapError as exc:
            if exc.status in _IDEM_STORED_ERRORS:
                await asyncio.to_thread(coord.idem_finish, ctx, key, exc.status,
                                        {"error": exc.code, "detail": exc.detail, **exc.extra})
            else:
                await asyncio.to_thread(coord.idem_abort, ctx, key)
            raise
        except Exception:
            await asyncio.to_thread(coord.idem_abort, ctx, key)
            raise
        if isinstance(result, JSONResponse):
            await asyncio.to_thread(coord.idem_finish, ctx, key, result.status_code,
                                    json.loads(result.body or b"null"))
        else:
            await asyncio.to_thread(coord.idem_finish, ctx, key, 200, result)
        return result
    # FastAPI reads the signature through __wrapped__ but would evaluate string annotations in THIS
    # module's globals; resolve them in the handler's own module now.
    wrapper.__signature__ = inspect.signature(handler, eval_str=True)
    return wrapper


#: Refusals that are a stable answer to that exact request, so a replay repeats them. Conflicts
#: (409/423/428/429) and server errors free the key instead: a retry may well succeed.
_IDEM_STORED_ERRORS = {400, 403, 404, 413, 422}
