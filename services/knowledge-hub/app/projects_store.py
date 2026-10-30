"""SQLite (or HANA, see app/sqldb.py) store for the project registry (fen, 2026-09-22).

WHY IT MOVED OUT OF A FILE. The registry used to be ``projects_manifest.json``, rewritten
whole on every change. fen asked for it to live in KH's database instead, and he is right
about the shape: this is the table every turn depends on - step 1 of the always-on kernel
resolves an intent to a project by matching against it - and a JSON blob rewritten in full
has no way to change one project without restating all of them. A crash mid-write took the
whole registry with it, which is why the old code had a ``starting empty`` fallback that
would have silently orphaned every project's data. One row per project cannot lose its
neighbours.

IT LIVES IN hooks.db, next to hook_rules and the policy action table (config.HOOKS_DB_PATH)
- KH's own deterministic store, the same choice policy_actions made and for the same reason:
Chroma's sqlite file belongs to a third-party library and its schema is not ours to share.

THE SHAPE IS THE OLD SHAPE, DELIBERATELY. ``load_all`` returns exactly the dict that used
to sit under the manifest's ``projects`` key, and ``save_all`` takes it back, so every
caller in app/projects.py - get-or-create, the C4 registry sync, delete_project, the
/projects route - is untouched. The list fields (aliases, keywords, tools, conflicts_with)
and the ``paths`` binding block are stored as JSON text in their own columns: they are read
and written whole by name, never filtered or joined on, so a column each is honest storage
rather than a schema waiting to be normalised.

THE FILE IS IMPORTED ONCE AND THEN RETIRED, not deleted - see :func:`migrate_from_file`.

PER-ROW WRITES (stage F1, multi-instance). ``save_all`` deletes every row missing from the dict it
is given, so a stale copy on instance B deleted a project instance A had just created. Callers now
write one row with :func:`upsert_one` and remove one with :func:`delete_one`; ``save_all`` remains
only for the one-time startup import of the legacy file.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time

from app import config, sqldb

logger = logging.getLogger(__name__)

_LOCK = threading.RLock()
_READY = False

#: Columns holding a JSON list, decoded on read and encoded on write.
_LIST_FIELDS = ("aliases", "keywords", "tools", "conflicts_with")

#: Which system made the project (2026-10-22): "KH" for KH itself and its people, or the name a client
#: sends (the DLC engine sends "AI-SDLC") so that client can list only its own projects.
DEFAULT_SOURCE = "KH"
SOURCE_MAX = 64


def clean_source(value) -> str:
    """The source as stored: a missing, null or blank value is "KH". ValueError on a non-string."""
    if value is None:
        return DEFAULT_SOURCE
    if not isinstance(value, str):
        raise ValueError("source must be a string")
    value = value.strip()
    if len(value) > SOURCE_MAX:
        raise ValueError("source is longer than %d characters" % SOURCE_MAX)
    return value or DEFAULT_SOURCE


def _conn():
    return sqldb.connect()


def init() -> None:
    """Create the table if absent and import a legacy manifest once. Idempotent.

    Called on first use rather than only from ``attach``, because the project registry
    is read during startup as well as by routes, and an ordering mistake here would
    look like an empty registry rather than an error.
    """
    global _READY
    with _LOCK:
        if _READY:
            return
        with _conn() as c:
            sqldb.create_table(
                c, "projects",
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id             TEXT PRIMARY KEY,
                    role           TEXT NOT NULL DEFAULT 'project',
                    aliases        TEXT NOT NULL DEFAULT '[]',
                    keywords       TEXT NOT NULL DEFAULT '[]',
                    tools          TEXT NOT NULL DEFAULT '[]',
                    descriptor     TEXT NOT NULL DEFAULT '',
                    conflicts_with TEXT NOT NULL DEFAULT '[]',
                    paths          TEXT NOT NULL DEFAULT '{}',
                    created_at     TEXT NOT NULL DEFAULT '',
                    updated_at     TEXT NOT NULL DEFAULT ''
                )
                """,
                """
                CREATE COLUMN TABLE projects (
                    id             NVARCHAR(256) PRIMARY KEY,
                    role           NVARCHAR(64)  NOT NULL DEFAULT 'project',
                    aliases        NCLOB         NOT NULL,
                    keywords       NCLOB         NOT NULL,
                    tools          NCLOB         NOT NULL,
                    descriptor     NCLOB         NOT NULL,
                    conflicts_with NCLOB         NOT NULL,
                    paths          NCLOB         NOT NULL,
                    created_at     NVARCHAR(32)  NOT NULL DEFAULT '',
                    updated_at     NVARCHAR(32)  NOT NULL DEFAULT ''
                )
                """,
            )
            # source came later (2026-10-22): rows made before it are KH's own
            sqldb.add_column(c, "projects", "source", "TEXT NOT NULL DEFAULT 'KH'",
                             "NVARCHAR(64) DEFAULT 'KH'")
        _READY = True
    migrate_from_file()


def _json_list(value) -> str:
    """A list field as the JSON text the column holds. None-safe."""
    return json.dumps(list(value or []), ensure_ascii=False)


def _decode(row) -> dict:
    """One row as the entry shape the manifest used to hold."""
    entry: dict = {"id": row["id"], "role": row["role"],
                   "descriptor": row["descriptor"] or ""}
    for field in _LIST_FIELDS:
        try:
            value = json.loads(row[field] or "[]")
        except ValueError:
            value = []
        entry[field] = value if isinstance(value, list) else []
    try:
        paths = json.loads(row["paths"] or "{}")
    except ValueError:
        paths = {}
    entry["paths"] = paths if isinstance(paths, dict) else {}
    try:
        source = row["source"]
    except (IndexError, KeyError):
        source = None
    entry["source"] = source or DEFAULT_SOURCE
    entry["created_at"] = row["created_at"] or ""
    entry["updated_at"] = row["updated_at"] or ""
    return entry


def load_all() -> dict:
    """Every project, keyed by id - the old manifest's ``projects`` block."""
    init()
    with _LOCK, _conn() as c:
        rows = c.execute("SELECT * FROM projects ORDER BY id").fetchall()
    return {r["id"]: _decode(r) for r in rows}


def _row_of(pid, entry: dict) -> dict:
    e = entry or {}
    return {
        "id": str(pid), "role": str(e.get("role") or "project"),
        "aliases": _json_list(e.get("aliases")),
        "keywords": _json_list(e.get("keywords")),
        "tools": _json_list(e.get("tools")),
        "descriptor": str(e.get("descriptor") or ""),
        "conflicts_with": _json_list(e.get("conflicts_with")),
        "paths": json.dumps(dict(e.get("paths") or {}), ensure_ascii=False),
        "source": str(e.get("source") or DEFAULT_SOURCE)[:SOURCE_MAX],
        "created_at": str(e.get("created_at") or ""),
        "updated_at": str(e.get("updated_at") or ""),
    }


def get_one(project_id: str) -> dict | None:
    """One project's entry, or None."""
    init()
    with _conn() as c:
        r = c.execute("SELECT * FROM projects WHERE id=?", [str(project_id)]).fetchone()
    return _decode(r) if r else None


def upsert_one(entry: dict) -> None:
    """Insert or replace ONE project row. Never touches any other project."""
    init()
    with _conn() as c:
        sqldb.upsert(c, "projects", ("id",), _row_of(entry["id"], entry))


def delete_one(project_id: str) -> bool:
    """Delete ONE project row. True when a row was removed."""
    init()
    with _conn() as c:
        return sqldb.update(c, "DELETE FROM projects WHERE id=?", [str(project_id)]) > 0


def save_all(projects: dict) -> None:
    """Make the table match this dict exactly, in one transaction. STARTUP MIGRATION ONLY.

    Not safe with more than one instance (a stale dict deletes newer projects): runtime callers use
    upsert_one / delete_one.

    WHOLE-SET SEMANTICS, which is not laziness: ``delete_project`` removes a project by
    popping it from the dict and saving, so a save that only upserted would leave the
    deleted project registered and its data orphaned but still routed to. Rows absent
    from `projects` are therefore deleted here. At this scale - a dozen projects - the
    write is trivial, and it keeps every existing caller working unchanged.
    """
    init()
    keep = [str(pid) for pid in (projects or {})]
    with _LOCK, _conn() as c:
        for pid, entry in (projects or {}).items():
            sqldb.upsert(c, "projects", ("id",), _row_of(pid, entry))
        if keep:
            marks = ",".join("?" for _ in keep)
            c.execute(f"DELETE FROM projects WHERE id NOT IN ({marks})", keep)
        else:
            c.execute("DELETE FROM projects")


def count() -> int:
    init()
    with _LOCK, _conn() as c:
        return int(c.execute("SELECT COUNT(*) FROM projects").fetchone()[0])


def legacy_manifest_path() -> str:
    """Where the retired JSON registry lived."""
    return os.path.join(os.path.dirname(config.PROJECTS_PATH), "projects_manifest.json")


def migrate_from_file() -> int:
    """Import the legacy manifest ONCE, then retire the file. Returns rows imported.

    Runs only when the table is EMPTY: a table with rows is the live registry, and
    re-importing over it would resurrect projects somebody deleted. The file is RENAMED
    rather than removed, because it is the only copy of a registry that took weeks to
    accumulate and a rename is reversible while a delete is not.
    """
    path = legacy_manifest_path()
    if not os.path.exists(path):
        return 0
    if count():
        return 0
    try:
        with open(path, encoding="utf-8") as f:
            man = json.load(f)
        projects = man.get("projects") or {}
    except Exception:
        logger.exception("projects_store — legacy manifest unreadable; leaving it in place")
        return 0
    if not projects:
        return 0
    save_all(projects)
    imported = count()
    retired = path + ".migrated-" + time.strftime("%Y%m%d%H%M%S", time.gmtime())
    try:
        os.replace(path, retired)
    except OSError:
        logger.exception("projects_store — imported %d project(s) but could not retire %s",
                         imported, path)
        return imported
    logger.info("projects_store — imported %d project(s) from %s, retired it as %s",
                imported, path, os.path.basename(retired))
    return imported


def stats() -> dict:
    """Where the registry lives and how much of it there is."""
    init()
    return {"db": sqldb.location(), "table": "projects", "projects": count()}
