"""
Personal projects - one private project per signed-in person (fen 2026-09-30).

WHY. With sign-in on, KH serves several people. Personalization used to be ONE common store in the
orchestrator, injected into every session of every person, so one person's "reply short, call me
fen" reached everybody's assistant. The split is now:

  orchestrator   routes each person's request to the projects THEY may read (unchanged);
  knowledge      the common project everyone may read;
  personal-<id>  each person's own project: what they told their assistants to remember.

WHAT A PERSONAL PROJECT IS. An ordinary KH project bundle whose id is derived from the e-mail in
the caller's verified token, <config.PERSONAL_PREFIX><slug of the e-mail>. Its access follows that
e-mail, not a grant: the owner holds every permission on it (auth.Principal.can), nobody else holds
any unless their token carries all_projects (maintainers). So it needs no Keycloak record, no token
refresh after it is created, and it cannot be claimed by someone else, because POST /projects
refuses a personal id that is not the caller's own.

WHERE ITS ROWS LIVE. scope=personalization rows of a personal project go to that project's own part,
kh_personalization_<id> (vector_store.part_collection_name). A personalization write or read that
names no project goes to the caller's own. The project is created on the first such write.

SIGN-IN OFF. No caller, no personal project: every function here answers None and personalization
stays the orchestrator's common store, exactly as before.
"""
from __future__ import annotations

import logging
import re

from . import config

logger = logging.getLogger(__name__)

_SLUG = re.compile(r"[^a-z0-9]+")


def personal_id(email: str) -> str:
    """The personal project id of one e-mail: jane.doe@example.com -> personal-jane-doe-example-com."""
    return config.PERSONAL_PREFIX + _SLUG.sub("-", (email or "").strip().lower()).strip("-")


def is_personal(project: str | None) -> bool:
    return bool(project) and str(project).startswith(config.PERSONAL_PREFIX)


def is_personal_scope(scope: str | None) -> bool:
    return scope == config.PERSONAL_SCOPE


def own_id() -> str | None:
    """The caller's personal project id, or None with sign-in off."""
    from . import auth
    principal = auth.current()
    return personal_id(principal.email) if principal is not None else None


def ensure(project_id: str, email: str | None) -> dict:
    """Create the personal project bundle if it is missing. Idempotent; never registers at Keycloak.

    ``email`` is the owner's when they write it themselves; None when a maintainer writes into it
    first (a migration), and the descriptor then names the id only.
    """
    from .projects import get_or_create_project, get_project
    entry = get_project(project_id)
    if entry is not None:
        return entry
    logger.info("personal — creating %s for %s", project_id, email)
    return get_or_create_project(
        project_id, role="project",
        descriptor=f"Personal project of {email or project_id}: the preferences and standing instructions this "
                   f"person gave their assistants. Private to them.")


# What belongs to the person, not to a shared project (fen 2026-10-13): their personalization, worklogs and
# findings, and their own lessons (2026-10-29). Written with no project named, they land in the writer's own personal project - never in the
# orchestrator, which is the system registry (project registry, shared routes, the sign-in guide) and holds
# nobody's log.
OWN_SCOPES = (config.PERSONAL_SCOPE, config.HOTLOG_SCOPE, "findings", config.PERSONAL_LESSON_SCOPE)
NO_LOG_IN = ("log", "findings")

_touched: set[str] = set()


def write_target(scope: str | None, project: str | None) -> str | None:
    """Where a WRITE lands: a named project is kept; one naming none, in a person's own scope, goes to the
    caller's personal project (sign-in on). Reads keep ``target``: an unnamed log read spans every project."""
    if project or scope not in OWN_SCOPES:
        return project
    return own_id() or project


def redirects_write(scope: str | None) -> bool:
    return scope in OWN_SCOPES


def touch(email: str, encode) -> None:
    """Every signed-in person has a personal project from their first request, entered in the registry so
    the routing finds it for them (and only them: registry rows are filtered by who may read the project)."""
    pid = personal_id(email)
    if not email:
        return
    from .projects import _registry_text, get_project, registry_entries, upsert_registry_entry
    entry = get_project(pid)
    if entry is not None and pid in _touched:
        return                                  # exists and is registered: the common case, one manifest read
    _touched.add(pid)
    try:
        entry = entry or ensure(pid, email)
        if not any(e.get("id") == pid for e in registry_entries()):
            want = {"id": pid, "role": "project", "aliases": [], "keywords": [], "conflicts_with": [],
                    "descriptor": entry.get("descriptor", "")}
            upsert_registry_entry(want, list(encode(_registry_text(want))))
    except Exception:
        _touched.discard(pid)
        logger.exception("personal - could not prepare %s", pid)


def target(scope: str | None, project: str | None) -> str | None:
    """The project a personalization request lands in, or ``project`` unchanged.

    Only scope=personalization with sign-in on is redirected, and only when no project is named:
    then it is the caller's own personal project. A named project is kept, so a maintainer can
    still write into someone's personal project (a migration) or into the orchestrator's common
    store; the permission check decides whether that is allowed.
    """
    if not is_personal_scope(scope) or project:
        return project
    return own_id()
