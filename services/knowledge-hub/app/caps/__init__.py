"""Stage F capability modules (docs/multi-agent-instance-design.md section 3.1, docs/caps-dev.md).

Each module in ``MODULES`` exposes ``NAME``, ``VERSION`` (semver), optional ``STATUS``
(stable|beta|deprecated), ``SUNSET`` and ``LIMITS``, ``init(c)`` (dual DDL through app/sqldb.py, applied
once through ``sqldb.migrate``) and ``attach(app)``. ``main.py`` calls ``attach_all(app)`` once.

ADDING A MODULE = one line in ``MODULES`` below. ``KH_CAP_<NAME>=off`` switches one off: it is then
missing from ``GET /v1/capabilities`` and its routes answer 404.

DEFAULT-OFF MODULES (docs/roadmap-e-to-5-design.md section 2): a module that sets ``DEFAULT_ON = False`` is
attached only when ``KH_CAP_<NAME>=on``. Every module of the roadmap E-5 stage sets it. A listed module whose
file does not exist yet (a later slice) is skipped, so its registration line can land before its code.
"""
from __future__ import annotations

import importlib
import logging

from fastapi import Request
from fastapi.responses import JSONResponse

from app import config, sqldb

logger = logging.getLogger(__name__)

API_VERSIONS = ["v1"]

#: The registration list. Order matters only for dependencies (registry first).
MODULES = [
    "app.caps.registry",
    "app.caps.coord",
    "app.caps.events",
    "app.caps.principals",
    "app.caps.records",
    "app.caps.rules",
    "app.caps.redact",
    "app.caps.items",
    "app.caps.retrieval",
    "app.caps.vault",
    "app.caps.packs",
    "app.caps.metrics",
    "app.caps.outbox",
    "app.caps.lifecycle",
    # Roadmap E-5 (docs/roadmap-e-to-5-design.md): every one is DEFAULT_ON = False (KH_CAP_<NAME>=on attaches it).
    # people first: the others write into its kh_people namespace.
    "app.caps.people",
    "app.caps.daily",
    "app.caps.outcomes",
    "app.caps.learn",
    "app.caps.improve",
]

#: What attach_all loaded: [{name, version, status, sunset?, limits}] - the source of discovery.
CAPABILITIES: list[dict] = []
_loaded: dict[str, object] = {}


def enabled(name: str, default_on: bool = True) -> bool:
    """``KH_CAP_<NAME>``: on unless switched off; a ``DEFAULT_ON = False`` module only when switched on."""
    raw = config._env(f"KH_CAP_{name.upper()}", "on" if default_on else "off").strip().lower()
    if default_on:
        return raw not in ("off", "false", "0", "no")
    return raw in ("on", "true", "1", "yes")


def _import(path: str):
    """The module, or None when a registered module's file does not exist yet (a later roadmap slice)."""
    try:
        return importlib.import_module(path)
    except ModuleNotFoundError as exc:
        if exc.name != path:
            raise                                  # a real missing dependency inside an existing module
        logger.debug("caps: %s is registered but not built yet", path)
        return None


def is_loaded(name: str) -> bool:
    return name in _loaded


def init_all() -> list:
    """Run every enabled module's init (its migrations). Safe to call more than once."""
    mods = []
    for path in MODULES:
        mod = _import(path)
        if mod is None or not enabled(mod.NAME, getattr(mod, "DEFAULT_ON", True)):
            continue
        with sqldb.connect() as c:
            sqldb.ensure_core(c)
            mod.init(c)
        mods.append(mod)
    return mods


def attach_all(app) -> list[dict]:
    """Init and attach every enabled capability, then the discovery routes."""
    from app.caps import core

    core.install_error_handler(app)
    CAPABILITIES.clear()
    _loaded.clear()
    for mod in init_all():
        mod.attach(app)
        _loaded[mod.NAME] = mod
        cap = {"name": mod.NAME, "version": mod.VERSION, "status": getattr(mod, "STATUS", "beta"),
               "limits": dict(getattr(mod, "LIMITS", {}) or {})}
        if getattr(mod, "SUNSET", None):
            cap["sunset"] = mod.SUNSET
        CAPABILITIES.append(cap)

    @app.get("/v1/capabilities", tags=["v1 discovery"], summary="What this KH can do, each capability at semver")
    async def v1_capabilities():
        return {"kh_version": config.KH_VERSION, "api_versions": API_VERSIONS,
                "capabilities": sorted(CAPABILITIES, key=lambda c: c["name"])}

    @app.get("/v1/openapi.json", tags=["v1 discovery"], summary="OpenAPI document of the /v1 routes only")
    async def v1_openapi(request: Request):
        doc = dict(request.app.openapi())
        doc["paths"] = {p: v for p, v in doc.get("paths", {}).items() if p.startswith("/v1/")}
        doc["info"] = {**doc.get("info", {}), "title": "Knowledge Hub /v1"}
        return JSONResponse(doc)

    logger.info("caps attached: %s", ", ".join(f"{c['name']}@{c['version']}" for c in CAPABILITIES))
    return CAPABILITIES


_cron_threads: list = []


def start_crons() -> list[str]:
    """Start every loaded module's ``CRONS = [(lease_name, interval_s, fn)]`` (called from main's lifespan).

    Each run first takes the KH lease ``('_kh', lease_name)`` through sqldb.run_under_lease, so with N
    instances a job runs on one at a time. Disable all with KH_CAPS_CRONS=false.
    """
    import threading

    if not config._flag("KH_CAPS_CRONS", "true") or _cron_threads:
        return []
    started = []
    for mod in _loaded.values():
        for name, interval, fn in getattr(mod, "CRONS", []) or []:
            def loop(name=name, interval=interval, fn=fn):
                stop = threading.Event()
                if stop.wait(min(interval, 30)):
                    return
                while True:
                    try:
                        ran, res = sqldb.run_under_lease(name, interval * 1.5, fn)
                        if ran and res:
                            logger.info("%s - %s", name, res)
                    except Exception:
                        logger.exception("%s failed", name)
                    if stop.wait(interval):
                        return
            t = threading.Thread(target=loop, name=name, daemon=True)
            t.start()
            _cron_threads.append(t)
            started.append(name)
    return started
