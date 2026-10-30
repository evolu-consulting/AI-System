"""Session project binding: one project per CLI session, kept in the account's personal project (fen 2026-10-24).

WHY. The project of a worklog was matched on every prompt by keyword ('tool' -> kh-tools, 'message' ->
ai-communication, 'design' -> designer), so one piece of work landed in four projects and another machine of
the same account could not find it. Now a session's project is decided once and kept: worklogs follow it.

HOW
  - A binding is (owner, actor) -> project. owner is the personal project of the signed-in account (a technical
    user's own), actor the session id the CLI sends in X-KH-Actor (app/auth.py ACTORS). It lives in KH's
    relational store as data of that personal project; it is not a vector row, because last_seen moves on
    every call.
  - BIND. The first prompt of an unbound session that names a project by id or alias binds it ('detected');
    a keyword alone never does. PUT /session/project binds or switches it ('asked'): the assistant calls it
    when the person asks to move to another project, never on its own guess. DELETE unbinds.
  - USE. A worklog write (POST /vector/add, scope log) carrying the actor of a bound session is stored in the
    bound project, whatever project the body names, as long as the caller may log there (otherwise the body
    decides, as before). The auth middleware applies it before the permission check (apply_to_log_write).
    The turn context names the bound project instead of a per-prompt match.
  - KEEP. Every call carrying the actor refreshes last_seen (at most every TOUCH_S). A binding idle for more
    than SESSION_BINDING_TTL_HOURS (72) is gone: reads treat it as absent at once, and POST /session/sweep
    (the distill sidecar's 02:00 job) deletes the rows.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from app import config, sqldb

logger = logging.getLogger(__name__)

TABLE = "kh_session_binding"
DETECTED, ASKED = "detected", "asked"
TOUCH_S = 600                       # refresh last_seen at most this often per session

_LOCK = threading.Lock()
_ready = False
_touched: dict[tuple[str, str], float] = {}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _cutoff(hours: float | None = None) -> str:
    hours = config.SESSION_BINDING_TTL_HOURS if hours is None else hours
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _m1(c) -> None:
    sqldb.create_table(
        c, TABLE,
        f"""CREATE TABLE IF NOT EXISTS {TABLE} (
                owner     TEXT NOT NULL,
                actor     TEXT NOT NULL,
                project   TEXT NOT NULL,
                source    TEXT NOT NULL,
                bound_at  TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                PRIMARY KEY (owner, actor))""",
        f"""CREATE COLUMN TABLE {TABLE} (
                owner     NVARCHAR(256) NOT NULL,
                actor     NVARCHAR(128) NOT NULL,
                project   NVARCHAR(256) NOT NULL,
                source    NVARCHAR(16)  NOT NULL,
                bound_at  NVARCHAR(32)  NOT NULL,
                last_seen NVARCHAR(32)  NOT NULL,
                PRIMARY KEY (owner, actor))""")
    sqldb.create_index(c, "ix_kh_session_binding_seen", TABLE, "last_seen")


def init() -> None:
    global _ready
    with _LOCK, sqldb.connect() as c:
        sqldb.migrate(c, "session_binding", [(1, _m1)])
    _ready = True


def get(owner: str, actor: str | None) -> dict | None:
    """The live binding of session `actor`, or None (none, or idle past the TTL)."""
    if not (_ready and owner and actor):
        return None
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT project, source, bound_at, last_seen FROM {TABLE} WHERE owner=? AND actor=?",
                         [owner, actor]).fetchall()
    if not rows or rows[0]["last_seen"] < _cutoff():
        return None
    r = rows[0]
    return {"actor": actor, "project": r["project"], "source": r["source"], "bound_at": r["bound_at"],
            "last_seen": r["last_seen"]}


def bind(owner: str, actor: str, project: str, source: str) -> dict:
    now = _now()
    with sqldb.connect() as c:
        sqldb.upsert(c, TABLE, ["owner", "actor"], {"owner": owner, "actor": actor, "project": project,
                                                    "source": source, "bound_at": now, "last_seen": now})
    _touched[(owner, actor)] = time.time()
    return {"actor": actor, "project": project, "source": source, "bound_at": now, "last_seen": now}


def unbind(owner: str, actor: str) -> bool:
    with sqldb.connect() as c:
        return bool(sqldb.update(c, f"DELETE FROM {TABLE} WHERE owner=? AND actor=?", [owner, actor]))


def touch(owner: str, actor: str | None) -> None:
    """Keep a used session's binding alive. At most one write per TOUCH_S per session; never raises."""
    if not (_ready and owner and actor):
        return
    key, now = (owner, actor), time.time()
    if now - _touched.get(key, 0) < TOUCH_S:
        return
    _touched[key] = now
    try:
        with sqldb.connect() as c:
            # Only a live binding is refreshed: one already past the TTL stays expired for the sweep.
            sqldb.update(c, f"UPDATE {TABLE} SET last_seen=? WHERE owner=? AND actor=? AND last_seen>=?",
                         [_now(), owner, actor, _cutoff()])
    except Exception:
        logger.exception("session binding - touch failed")


def sweep(max_idle_hours: float | None = None) -> dict:
    """Delete every binding idle for more than `max_idle_hours` (default the TTL)."""
    cutoff = _cutoff(max_idle_hours)
    with sqldb.connect() as c:
        deleted = sqldb.update(c, f"DELETE FROM {TABLE} WHERE last_seen < ?", [cutoff])
    _touched.clear()
    return {"deleted": max(deleted, 0), "idle_before": cutoff}


def detect(text_matches: list[dict]) -> str | None:
    """The project a first prompt names strongly enough to bind: one hit on its id or alias, no tie."""
    strong = [h for h in text_matches if h.get("on") in ("id", "alias")]
    if not strong:
        return None
    if len(strong) > 1 and len(strong[1].get("term", "")) == len(strong[0].get("term", "")):
        return None
    return strong[0]["project"]


def apply_to_log_write(principal, actor: str | None, body) -> bool:
    """Point a worklog write of a bound session at the bound project. True when the body was changed."""
    if principal is None or not actor or not isinstance(body, dict) or body.get("scope") != config.HOTLOG_SCOPE:
        return False
    try:
        bound = get(principal.personal_project, actor)
    except Exception:
        logger.exception("session binding - read failed")
        return False
    if not bound or not principal.can(bound["project"], "project.log"):
        return False
    meta = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    if meta.get("project") == bound["project"] and not body.get("project"):
        return False
    meta = {k: v for k, v in meta.items() if k != "source_id"}
    meta["project"] = bound["project"]
    meta["project_from"] = "session"
    body["metadata"] = meta
    body.pop("project", None)
    return True


# ── routes ──────────────────────────────────────────────────────────────────

def attach(app) -> None:
    from fastapi import HTTPException

    from app import auth, projects

    init()
    TAG = ["Session"]

    def _who() -> tuple[str, str]:
        principal = auth.current()
        actor = auth.current_actor()
        if principal is None:
            raise HTTPException(400, "session binding needs sign-in")
        if not actor:
            raise HTTPException(400, f"name the session in the {auth.ACTOR_HEADER} header")
        return principal.personal_project, actor

    @app.get("/session/project", tags=TAG, summary="The project this session (X-KH-Actor) is bound to")
    async def session_project_get() -> dict:
        owner, actor = _who()
        return {"actor": actor, "binding": get(owner, actor), "ttl_hours": config.SESSION_BINDING_TTL_HOURS}

    @app.put("/session/project", tags=TAG, summary="Bind or switch this session's project (the person asked)")
    async def session_project_put(body: dict) -> dict:
        """Body: {project}. Call it only when the person asks to work on another project; worklogs of this
        session then go there."""
        owner, actor = _who()
        project = projects.canonical_or_none(str((body or {}).get("project") or "").strip())
        if not project:
            raise HTTPException(404, "no such project")
        if not auth.current().can(project, "project.log"):
            raise HTTPException(403, f"missing permission project.log on {project}: worklogs could not go there")
        before = get(owner, actor)
        return {"binding": bind(owner, actor, project, ASKED),
                "previous": before["project"] if before else None}

    @app.delete("/session/project", tags=TAG, summary="Unbind this session's project")
    async def session_project_delete() -> dict:
        owner, actor = _who()
        return {"actor": actor, "unbound": unbind(owner, actor)}

    @app.post("/session/sweep", tags=TAG, summary="Delete bindings idle past the TTL (maintainers; nightly job)")
    async def session_sweep(body: dict | None = None) -> dict:
        hours = (body or {}).get("max_idle_hours")
        try:
            hours = None if hours is None else float(hours)
        except (TypeError, ValueError):
            raise HTTPException(400, "max_idle_hours must be a number")
        if hours is not None and hours < 1:
            raise HTTPException(400, "max_idle_hours must be at least 1")
        return sweep(hours)

    logger.info("Session routes attached (/session/project, /session/sweep)")
