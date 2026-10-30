"""
The hot log window — one shared partition in front of the per-project logs.

WHY IT EXISTS. Logs are physically isolated per project (kh_log_<id>), which makes
"what did I just do with X?" unanswerable until the project has been resolved, and
makes a cross-project answer a scan of every partition. The window turns that around:
every worklog is written to ONE small partition tagged with the project that owns it,
so a recency question with NO project named reads a single place.

WHAT THE WINDOW IS. A set of SLOTS, one per project — not a row count. A slot holds
ALL of that project's recent entries, so several days of work stay answerable. The
slot count matches ``config.MAX_OPEN_PROJECT_GRAPHS``: a project hot in the graph
cache is hot in the log window, and both evict least-recently-used, so the two
windows track each other instead of drifting apart.

ONE WINDOW PER PERSON (2026-09-25, with sign-in on). When KH runs with sign-in, every hot row
also carries the e-mail of the person who wrote it (AUTHOR_KEY), and the slots are counted per
person: each person has their own window of recent projects, filled only by their own writes,
read back only by them through /log/recent and /log/window - except that /log/recent with a
project named returns every author's rows on that project to anyone who may read it. A row is spilled into a project's log
only if its author still holds the log permission on that project; otherwise it is dropped, so
nobody's log reaches a project they have lost access to. Without sign-in there are no authors and
the window behaves exactly as before.

WHAT IT IS NOT. It is a CACHE, never a system of record. Evicting a slot SPILLS it
into kh_log_<project> — copy, then delete — so a row is duplicated at worst and never
lost. Reads of a single project fan in over both places, so a caller cannot tell
whether a row is still hot or already spilled; that is the point.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from . import config
from . import vector_store as vs
from .vector_store import (
    hotlog_collection,
    move_rows,
    part_collection_name,
    get_or_create,
)

logger = logging.getLogger(__name__)

# Metadata key naming the project a hot row belongs to. Written on every hot row and
# kept when the row spills, so the owner survives the move.
OWNER_KEY = "project"
# Metadata key naming the person who wrote a hot row (sign-in on only). Kept when the row spills.
AUTHOR_KEY = "author"


def is_windowed_scope(scope: str | None) -> bool:
    """Is this the scope the window governs? Independent of the on/off flag.

    Reads and maintenance use this; only the WRITE path uses ``is_hot``. Keeping the two
    apart is what lets the flag be flipped off without hiding or stranding rows.
    """
    return scope == config.HOTLOG_SCOPE


def is_hot(scope: str | None) -> bool:
    """Should a WRITE in this scope go into the window?"""
    return bool(config.HOTLOG_ENABLED) and is_windowed_scope(scope)


def parse_ts(raw) -> float:
    """Sortable timestamp. Unparseable or missing sorts OLDEST (0.0).

    Accepts ISO-8601 UTC ('2026-08-29T12:33:02Z') and epoch seconds, because both
    forms are already present in the store; sorting must not depend on which one a
    writer happened to use.
    """
    if raw is None or raw == "":
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    try:
        return float(text)                       # epoch seconds as a string
    except ValueError:
        pass
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except ValueError:
        logger.debug("hotlog — unparseable ts %r, treating as oldest", raw)
        return 0.0


def row_ts(meta: dict | None) -> float:
    """The sortable timestamp of one stored row."""
    return parse_ts((meta or {}).get("ts"))


_ts = row_ts        # internal alias, kept so call sites below read tersely


def _owner(meta: dict) -> str | None:
    value = (meta or {}).get(OWNER_KEY)
    return str(value) if value else None


def read_lane(scope: str | None, project: str | None, base_where: dict | None):
    """The extra (collection, where) lane a READ must include for this scope.

    Reads fan in over BOTH the project's own log collection and the window, so a
    caller cannot tell whether a row is still hot or already spilled — which is what
    makes the window safe to add without changing any existing read. When a project
    is named the lane is narrowed to that project's rows, so the shared partition
    never leaks another project's work into a project-scoped read. With sign-in on and
    no project named, the lane is narrowed to the projects the caller may read.

    Returns None when this scope does not use the window.
    """
    # Deliberately gated on SCOPE ONLY, not on HOTLOG_ENABLED. Writes respect the
    # flag; reads must not, or flipping the window off would hide every row still
    # sitting in it until it drained. A disabled-and-empty window costs one cheap
    # lookup against an empty collection.
    if not is_windowed_scope(scope):
        return None
    from . import auth
    narrow = None
    if project:
        narrow = {OWNER_KEY: {"$eq": project}}
    else:
        visible = auth.visible_projects("project.read")
        if visible is not None:
            narrow = {OWNER_KEY: {"$in": sorted(visible) or ["__no_visible_project__"]}}
    where = base_where
    if narrow:
        where = narrow if not base_where else {"$and": [base_where, narrow]}
    return (hotlog_collection(), where)


def personal_where(base_where: dict | None) -> dict | None:
    """Narrow a window read to the caller's own rows. Unchanged when sign-in is off."""
    from . import auth
    principal = auth.current()
    if principal is None:
        return base_where
    mine = {AUTHOR_KEY: {"$eq": principal.email}}
    return mine if not base_where else {"$and": [base_where, mine]}


def recent_where(base_where: dict | None, project: str | None) -> dict | None:
    """The author narrowing /log/recent applies on top of ``read_lane``.

    With NO project named it is the caller's own window ("what did I just do?"). With a
    project named - and the caller already cleared for project.read on it - every author's
    rows are returned, because a project's log belongs to everyone who may read the project;
    each row still carries metadata.author, so the reader sees who wrote it (fen 2026-09-30:
    worklogs migrated by agent-admin were invisible to the project's own owner).
    """
    return base_where if project else personal_where(base_where)


def slots(author: str | None = None) -> dict[str, dict]:
    """Current window contents grouped by project: {project: {ids, newest, count}}.

    With ``author`` only that person's rows are counted, which is their own window.
    Metadata-only fetch, so this is cheap enough to run on every write.
    """
    coll = hotlog_collection()
    got = coll.get(include=["metadatas"])
    ids = list(got.get("ids", []) or [])
    metas = got.get("metadatas") or []
    out: dict[str, dict] = {}
    for i, row_id in enumerate(ids):
        meta = metas[i] if i < len(metas) else {}
        if author is not None and (meta or {}).get(AUTHOR_KEY) != author:
            continue
        owner = _owner(meta)
        if not owner:
            continue                              # untagged rows are never spilled blindly
        slot = out.setdefault(owner, {"ids": [], "newest": 0.0, "count": 0})
        slot["ids"].append((row_id, _ts(meta)))
        slot["count"] += 1
        slot["newest"] = max(slot["newest"], _ts(meta))
    for slot in out.values():
        slot["ids"].sort(key=lambda pair: pair[1])          # oldest first
    return out


def _spill(project: str, row_ids: list[str], may_log=None) -> int:
    """Move rows out of the window into that project's own log collection.

    ``may_log(project)`` answers whether the rows' author still holds the log permission
    there; when it says no, the rows are dropped instead of delivered.
    """
    if not row_ids:
        return 0
    if may_log is not None and not may_log(project):
        vs.delete_vt(row_ids, collection=hotlog_collection())
        logger.warning("hotlog — dropped %d rows for %s: author may no longer log there", len(row_ids), project)
        return 0
    target = get_or_create(part_collection_name(config.HOTLOG_SCOPE, project))
    moved = move_rows(row_ids, hotlog_collection(), target)
    if moved:
        logger.info("hotlog — spilled %d rows to %s", len(moved), project)
    return len(moved)


def enforce(author: str | None = None, may_log=None) -> dict:
    """Apply the window policy, spilling whatever no longer fits.

    With sign-in on it runs over ONE person's window (``author``) and checks each project
    with ``may_log`` before delivering rows there.

    Three bounds, applied in this order and all of them env-tunable:
      1. AGE      — entries older than HOTLOG_MAX_AGE_DAYS leave, whatever slot.
      2. PER SLOT — a slot keeps at most HOTLOG_MAX_PER_SLOT entries, newest kept.
      3. SLOT LRU — at most HOTLOG_SLOTS projects hold a slot; the least recently
                    used slot (oldest newest-entry) is spilled whole.

    Returns a report of what moved, so a caller can log or assert on it.
    """
    report: dict[str, int] = {}
    current = slots(author)

    # Turned OFF: drain rather than strand. New writes already bypass the window, so
    # anything still here would sit forever; spilling it home makes the flag a true
    # kill switch and leaves the store in the same shape as if it had never run.
    if not config.HOTLOG_ENABLED:
        for project, slot in current.items():
            report[project] = _spill(project, [row_id for row_id, _ in slot["ids"]], may_log)
        return {"enabled": False, "spilled": report, "slots": len(slots(author))}

    # 1. age
    if config.HOTLOG_MAX_AGE_DAYS > 0:
        cutoff = datetime.now(timezone.utc).timestamp() - config.HOTLOG_MAX_AGE_DAYS * 86400
        for project, slot in current.items():
            stale = [row_id for row_id, ts in slot["ids"] if 0.0 < ts < cutoff]
            if stale:
                report[project] = report.get(project, 0) + _spill(project, stale, may_log)

    # 2. per-slot depth
    if config.HOTLOG_MAX_PER_SLOT > 0:
        current = slots(author)
        for project, slot in current.items():
            excess = len(slot["ids"]) - config.HOTLOG_MAX_PER_SLOT
            if excess > 0:
                oldest = [row_id for row_id, _ in slot["ids"][:excess]]
                report[project] = report.get(project, 0) + _spill(project, oldest, may_log)

    # 3. slot count (LRU over projects)
    if config.HOTLOG_SLOTS > 0:
        current = slots(author)
        if len(current) > config.HOTLOG_SLOTS:
            by_recency = sorted(current.items(), key=lambda kv: kv[1]["newest"])
            for project, slot in by_recency[: len(current) - config.HOTLOG_SLOTS]:
                report[project] = report.get(project, 0) + _spill(
                    project, [row_id for row_id, _ in slot["ids"]], may_log)

    return {"enabled": True, "spilled": report, "slots": len(slots(author))}
