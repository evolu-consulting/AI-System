"""How public each project is - a copy for display; the identity service decides access (fen 2026-10-13).

    private      the default: only the people granted on the project.
    semi-public  everyone holding the role semi.read reads it (readonly level).
    public       everyone holding public.read reads it, public.write edits its content (editable level).

A semi-public or public project is an ordinary project. Keycloak keeps its visibility
(KH_AUTH_PROJECT.VISIBILITY) and puts the levels it opens into the token, next to the project's own
grants; the roles are carried by tenant groups, so a tenant is excluded by taking the roles off its group
(Keycloak deploy/btp/configure_shared_roles.py). KH therefore checks the token alone (app/auth.py), and
kh_me, people lists and every Keycloak-side check agree with it. This replaced, on 2026-10-13, the
KH-side override of 2026-10-09, which Keycloak did not know about: a semi-public reader was told
'missing permission project.read' by kh_members and did not see the project in kh_me.

PUT /projects/{id}/visibility sets it at Keycloak first (who manages the project's people may), then
here, so GET /projects can show it without asking Keycloak. Personal projects and the orchestrator are
always private. A project with no row here is private.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from app import config, sqldb

logger = logging.getLogger(__name__)

PRIVATE = "private"
SEMI_PUBLIC = "semi-public"
PUBLIC = "public"
VISIBILITIES = (PRIVATE, SEMI_PUBLIC, PUBLIC)

_LOCK = threading.RLock()
_READY = False
_cache: dict[str, str] | None = None
_cached_at = 0.0


def init() -> None:
    """Create the table if absent. Idempotent."""
    global _READY
    with _LOCK:
        if _READY:
            return
        with sqldb.connect() as c:
            sqldb.create_table(
                c, "project_access",
                """
                CREATE TABLE IF NOT EXISTS project_access (
                    id          TEXT PRIMARY KEY,
                    visibility  TEXT NOT NULL DEFAULT 'private',
                    updated_at  TEXT NOT NULL DEFAULT '',
                    updated_by  TEXT NOT NULL DEFAULT ''
                )
                """,
                """
                CREATE COLUMN TABLE project_access (
                    id          NVARCHAR(256) PRIMARY KEY,
                    visibility  NVARCHAR(32)  NOT NULL DEFAULT 'private',
                    updated_at  NVARCHAR(32)  NOT NULL DEFAULT '',
                    updated_by  NVARCHAR(256) NOT NULL DEFAULT ''
                )
                """,
            )
        _READY = True


def _drop_cache() -> None:
    global _cache
    with _LOCK:
        _cache = None


def non_private() -> dict[str, str]:
    """{project id: visibility} for every project that is not private."""
    global _cache, _cached_at
    with _LOCK:
        if _cache is not None and time.monotonic() - _cached_at < config.PROJECT_ACCESS_CACHE_S:
            return _cache
    try:
        init()
        with sqldb.connect() as c:
            rows = c.execute("SELECT id, visibility FROM project_access").fetchall()
        table = {r["id"]: r["visibility"] for r in rows if r["visibility"] in (SEMI_PUBLIC, PUBLIC)}
    except Exception:
        logger.exception("project_access - table unreadable, every project counts as private")
        return {}
    with _LOCK:
        _cache, _cached_at = table, time.monotonic()
    return table


def visibility_of(project_id: str) -> str:
    return non_private().get(project_id, PRIVATE)


def check(project_id: str, visibility: str) -> None:
    """ValueError for an unknown value or a project whose visibility is fixed."""
    from app import personal
    from app.projects import ORCHESTRATOR_ID
    if visibility not in VISIBILITIES:
        raise ValueError(f"visibility must be one of {', '.join(VISIBILITIES)}")
    if project_id == ORCHESTRATOR_ID or personal.is_personal(project_id):
        raise ValueError("personal projects and the orchestrator are always private")


def set_visibility(project_id: str, visibility: str, by: str = "") -> str:
    """Record a project's visibility; raises ValueError for an unknown value or a fixed project."""
    check(project_id, visibility)
    init()
    with _LOCK, sqldb.connect() as c:
        if visibility == PRIVATE:
            c.execute("DELETE FROM project_access WHERE id = ?", [project_id])
        else:
            sqldb.upsert(c, "project_access", ("id",), {
                "id": project_id, "visibility": visibility,
                "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "updated_by": by or ""})
        _drop_cache()
    logger.info("project_access - %s is now %s (by %s)", project_id, visibility, by or "-")
    return visibility


def forget(project_id: str) -> None:
    """Drop a deleted project's row, so a new project with the same id starts private."""
    try:
        init()
        with _LOCK, sqldb.connect() as c:
            c.execute("DELETE FROM project_access WHERE id = ?", [project_id])
            _drop_cache()
    except Exception:
        logger.exception("project_access - could not forget %s", project_id)
