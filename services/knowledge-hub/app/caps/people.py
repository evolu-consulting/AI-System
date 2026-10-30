"""The internal namespace ``kh_people`` (docs/roadmap-e-to-5-design.md section 2, slice S1).

WHAT. People-side learning (served packs, step outcomes, worker runs and cost, the lesson trial ledger, daily lag)
reuses stage F's event store, metrics, items, leases, redaction and rollback statistics through ONE namespace that
KH owns. No second event, metric or item store exists.

HOW. With ``KH_CAP_PEOPLE=on`` (``DEFAULT_ON = False``) ``attach`` makes sure that:

- the namespace row ``kh_people`` exists (the ``kh`` prefix is reserved, so ``PUT /v1/admin/ns`` refuses it and no
  consumer can take it): owner ``KH_PEOPLE_OWNER`` (the KH maintainers; maintainers are its admin anyway), projects
  ``*`` - stored as ``[]``, which stage F reads as "every project" (``Ctx.require_project``);
- ``app/caps/data/people_manifest.json`` is applied - first time, and again only when its ``manifest_version`` is
  higher than the stored one, so a maintainer's edit through ``PUT /v1/kh_people/manifest`` survives a restart;
- the principals of ``settings.principals`` exist (role ``distiller`` for the worker; nothing else).

People's code paths write into it BY DIRECT CALLS with a system ``Ctx`` (``system_ctx``, the pattern of
``metrics._system_ctx``): ``append_events``, ``record_metrics``, ``emit`` (KH-written ``kh.*`` kinds such as
``kh.served`` and ``kh.intervention``). Maintainers read it through the normal ``/v1/kh_people/*`` routes.

THE WORKER (design 3.2, E6). Five non-/v1 routes carry ``"worker": true`` in ``app/auth_rules.json`` (``/distill/next``,
``/distill/submit``, ``/distill/cursor``, ``/daily/next``, ``/daily/submit``). Their kind stays ``maintainer``, so with
this module off nothing changes. With it on, ``attach`` wraps ``auth.decide`` once: a KH principal token of
``kh_people`` with role ``distiller`` may call exactly those routes, and only while ``KH_DISTILL_WORKER`` is ``dry`` or
``on``. While it is ``off`` (the default) KH refuses worker tokens everywhere, ``/v1/kh_people`` included.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app import config, sqldb
from app.caps import core
from app.caps.core import Caller, CapError, Ctx

logger = logging.getLogger(__name__)

NAME = "people"
VERSION = "1.0.0"
STATUS = "beta"
DEFAULT_ON = False                      # KH_CAP_PEOPLE=on attaches it (design section 2, F5)

NS = "kh_people"
SYSTEM = "kh:people"
WORKER_ROLE = "distiller"
WORKER_MODES = ("off", "dry", "on")
MANIFEST_PATH = Path(__file__).with_name("data") / "people_manifest.json"
RULES_PATH = Path(__file__).resolve().parent.parent / "auth_rules.json"
LIMITS = {"ns": NS, "worker_routes": 5}


def owner_email() -> str:
    return config._env("KH_PEOPLE_OWNER", "kh-maintainers@kh.local").strip().lower()


def worker_mode() -> str:
    """``KH_DISTILL_WORKER`` = off | dry | on (default off): the server's final word on worker tokens."""
    v = config._env("KH_DISTILL_WORKER", "off").strip().lower()
    return v if v in WORKER_MODES else "off"


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


# ── migrations: none of its own (it only uses stage F tables) ────────────────

def init(c) -> None:
    sqldb.migrate(c, NAME, [])


# ── the namespace ────────────────────────────────────────────────────────────

def _ensure_ns_row() -> bool:
    """Insert the kh_people row once (first insert wins across instances). True when this call created it."""
    from app.caps import registry
    with sqldb.connect() as c:
        if c.execute("SELECT 1 FROM kh_ns WHERE ns=?", [NS]).fetchone() is not None:
            return False
        row = {"ns": NS, "display": "KH people-side learning", "state": "active", "owner_email": owner_email(),
               "projects_json": core.jdump([]), "config_json": core.jdump({}), "manifest_json": None,
               "manifest_sha": None, "manifest_rev": 0, "created_ms": sqldb.now_ms(c), "detached_ms": None,
               "purge_after_ms": None, "rev": 1}
        created = sqldb.insert_new(c, "kh_ns", row)
    registry.invalidate(NS)
    return created


def _stored_version() -> int | None:
    from app.caps import registry
    doc, rev = registry.get_manifest(NS)
    if rev == 0:
        return None
    v = doc.get("manifest_version")
    return v if isinstance(v, int) and not isinstance(v, bool) else 0


def _ensure_principals(doc: dict) -> list[str]:
    """Create the manifest's principals that do not exist yet (never re-activates a revoked one)."""
    from app.caps import principals, registry
    made = []
    for p in ((doc.get("settings") or {}).get("principals") or []):
        pid, role = p.get("principal_id"), p.get("role")
        if principals.get_principal(NS, pid, fresh=True) is not None:
            continue
        ctx = system_ctx(registry.ns_state(NS) or registry._load(NS))
        try:
            principals.create(ctx, {"principal_id": pid, "role": role, "on_behalf_of": owner_email(), "projects": []})
            made.append(pid)
        except CapError as exc:
            if exc.code != "duplicate":         # another instance created it at the same time
                raise
    return made


def ensure() -> dict:
    """Idempotent: namespace row, manifest (when new or a higher manifest_version), principals."""
    from app.caps import registry
    created = _ensure_ns_row()
    doc = load_manifest()
    want = doc.get("manifest_version") or 0
    have = _stored_version()
    applied = None
    if have is None or want > have:
        try:
            applied = registry.apply_manifest(NS, doc, expected_rev=-1, actor={"principal": SYSTEM})
        except CapError as exc:
            if exc.code != "write_conflict":    # another instance applied it concurrently: fine
                raise
    registry.invalidate(NS)
    made = _ensure_principals(doc)
    return {"ns": NS, "created": created, "manifest": applied, "principals_created": made}


def ns_row() -> dict | None:
    """The kh_people namespace row (5 s cache), or None when it is not there."""
    from app.caps import registry
    return registry.ns_state(NS)


def active() -> bool:
    """True when this module is attached and the namespace is active: callers skip their writes otherwise."""
    from app import caps
    row = ns_row() if caps.is_loaded(NAME) else None
    return bool(row) and row["state"] == "active"


def settings(section: str | None = None) -> dict:
    s = ((ns_row() or {}).get("config") or {}).get("settings") or {}
    s = s if isinstance(s, dict) else {}
    if section is None:
        return s
    out = s.get(section) or {}
    return out if isinstance(out, dict) else {}


def daily_tz(project: str) -> str:
    """``settings.daily.tz[project]``, else ``tz_default`` (Asia/Ho_Chi_Minh)."""
    d = settings("daily")
    return (d.get("tz") or {}).get(project) or d.get("tz_default") or "Asia/Ho_Chi_Minh"


# ── direct calls with a system context ───────────────────────────────────────

def system_ctx(row: dict | None = None, *, if_match: int | None = None, kind: str | None = None,
               principal: str = SYSTEM, session: str | None = None, run_id: str | None = None) -> Ctx:
    """ADAPTER (as metrics._system_ctx): KH acting as the kh_people admin on a module function that takes a request
    Ctx. ``if_match`` makes an items.transition conditional on that revision; ``kind`` sees that type unfenced
    (KH never holds a consumer's lease)."""
    row = row or ns_row()
    if row is None:
        raise CapError("ns_not_active", f"namespace {NS} is not attached (KH_CAP_PEOPLE=on)")
    if kind:
        types = dict(row.get("types") or {})
        if kind in types:
            types[kind] = {**types[kind], "fenced": False}
        row = {**row, "types": types}
    headers = {"if-match": core.etag(if_match)} if if_match is not None else {}
    req = SimpleNamespace(headers=headers, method="POST", url=SimpleNamespace(path=f"/v1/{NS}/system", query=""))
    # kind "client": the namespace administrator acting for the owner (principals.create checks on_behalf_of).
    caller = Caller(principal=principal, role=core.ADMIN, kind="client", on_behalf_of=owner_email())
    return Ctx(ns=NS, ns_row=row, caller=caller, request=req, run_id=run_id, session_id=session)


def append_events(events: list[dict], session: str | None = None) -> dict:
    """events.append on kh_people (manifest kinds only; redaction applies). Raises CapError on a refused event."""
    from app.caps import events as ev
    status, out = ev.append(system_ctx(session=session), events)
    if status != 200:
        raise CapError("validation_failed", "kh_people event refused", extra={"rejected": out.get("rejected")})
    return out


def emit(kind: str, body: dict, session: str | None = None) -> int:
    """A KH-written ``kh.*`` event (``kh.served``, ``kh.intervention``) in its own transaction. Returns its seq."""
    from app.caps import events as ev
    if not kind.startswith("kh."):
        raise ValueError("emit writes kh.* kinds only; use append_events for manifest kinds")
    return ev.append_system(NS, kind, body, {"principal": SYSTEM, "session_id": session})


def record_metrics(obs: Any) -> dict:
    """metrics.record on kh_people (manifest series, scale and dims schema apply)."""
    from app.caps import metrics
    return metrics.record(system_ctx(), obs)


# ── the worker token: five routes, behind KH_DISTILL_WORKER ─────────────────

def worker_routes(path: Path = RULES_PATH) -> set[tuple[str, str]]:
    """(METHOD, template) of every auth rule marked ``"worker": true``."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out = set()
    for entry in data["routes"]:
        if entry.get("worker") is True:
            method, template = entry["route"].split(" ", 1)
            out.add((method.upper(), template))
    return out


def is_worker(principal) -> bool:
    return getattr(principal, "ns", None) == NS and getattr(principal, "svc_role", None) == WORKER_ROLE


def _worker_refusal(principal) -> str | None:
    """None when this worker token may use its routes now: flag not off, principal row active (5 s cache)."""
    from app.caps import principals
    if worker_mode() == "off":
        return "worker tokens are refused while KH_DISTILL_WORKER=off"
    row = principals.get_principal(NS, principal.principal_id)
    if row is None or row["state"] != "active" or row["role"] != WORKER_ROLE:
        return f"principal {principal.principal_id} is {row['state'] if row else 'unknown'}"
    return None


def _wrap_decide() -> None:
    from app import auth
    if getattr(auth.decide, "_kh_people", False):
        return
    inner = auth.decide
    routes = worker_routes()

    def decide(rule, principal, path_params, query, body):
        if is_worker(principal):
            refusal = _worker_refusal(principal)
            if refusal:
                return refusal
            if rule is not None and (rule.method, rule.template) in routes:
                return None
        return inner(rule, principal, path_params, query, body)

    decide._kh_people = True                  # type: ignore[attr-defined]
    decide._inner = inner                     # type: ignore[attr-defined]
    auth.decide = decide


def _unwrap_decide() -> None:
    """Tests only: restore auth.decide."""
    from app import auth
    inner = getattr(auth.decide, "_inner", None)
    if inner is not None:
        auth.decide = inner


def attach(app) -> None:                      # noqa: ARG001 - no routes: maintainers use /v1/kh_people/*
    res = ensure()
    _wrap_decide()
    logger.info("kh_people ready: %s", res)
