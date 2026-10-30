"""Usage counts per person per day, across sessions (fen 2026-10-29).

WHY. Kernel rule 7 (REPEATED WORK) counts a manual step only inside one session. Someone who signs in
to the same app every morning, each time in a new session, never reaches "the 3rd time". Learn-back
now counts, for every person and day, what their work logs say they did, and keeps the counts with
their personal id. The turn context reads them back and lists a step done on several days.

HOW A LOG IS COUNTED. Each work log of the day is keyed by the kernel tag vocabulary (app/kernel/tags.py):
the best action tag and the best object tag of its text, e.g. "sign_in/app", "deploy/service". Keyed in
code, never by a model, so the same work gets the same key every day and the counts compare.

    usage_daily(person, day_utc, action_key, hits, sessions, projects, sample)   person = personal project id
    (column names avoid HANA keywords: DAY, KEY and COUNT are SQL words there)

learn(day) rewrites that day's rows from the logs, so a rerun is idempotent.
    GET  /usage/repeats[?days=&min_days=]   the caller's keys seen on at least min_days of the last days
    GET  /usage/mine[?days=]                the caller's rows
    POST /usage/learn {day?, days_back?, projects?}   maintainers; learn-back calls learn() itself
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timedelta, timezone

from fastapi import Query

from app import sqldb

logger = logging.getLogger(__name__)

TABLE = "usage_daily"
WINDOW_DAYS = 14
MIN_DAYS = 3
LOCAL = "local"            # the person of a log written with sign-in off
# HANA counts NVARCHAR length in its own encoding units, so a 300-char sample with a symbol such as a heart overflowed
# NVARCHAR(300) on prod (2026-10-30). Kept well under the column sizes.
SAMPLE_CHARS = 120
LIST_MAX = 20
_LOCK = threading.Lock()


def init() -> None:
    with _LOCK, sqldb.connect() as c:
        sqldb.create_table(
            c, TABLE,
            f"""CREATE TABLE IF NOT EXISTS {TABLE} (
                person TEXT NOT NULL, day_utc TEXT NOT NULL, action_key TEXT NOT NULL, hits INTEGER NOT NULL,
                sessions TEXT NOT NULL DEFAULT '[]', projects TEXT NOT NULL DEFAULT '[]',
                sample TEXT NOT NULL DEFAULT '', PRIMARY KEY (person, day_utc, action_key))""",
            f"""CREATE COLUMN TABLE {TABLE} (
                person NVARCHAR(256) NOT NULL, day_utc NVARCHAR(10) NOT NULL, action_key NVARCHAR(100) NOT NULL,
                hits INTEGER NOT NULL, sessions NVARCHAR(2000) NOT NULL DEFAULT '[]',
                projects NVARCHAR(2000) NOT NULL DEFAULT '[]', sample NVARCHAR(300) NOT NULL DEFAULT '',
                PRIMARY KEY (person, day_utc, action_key))""",
        )


# Only steps a tool could take over are counted. On prod data (2026-10-30) the unfiltered top keys were test/file,
# read/file and the like: words such as 'test', 'check' and 'read' are in nearly every log and say nothing repeated.
REPEATABLE = frozenset((
    "sign_in", "sign_out", "deploy", "build", "release", "install", "upgrade", "configure", "run_script", "merge",
    "push", "export", "import", "upload", "download", "archive", "backup", "restore", "migrate", "track_time",
    "send", "notify", "announce", "schedule", "monitor", "convert", "copy", "move", "rename", "screenshot", "sync",
    "seed", "open_page", "cleanup", "invite", "grant_access", "index", "scan", "benchmark"))


def key_of(text: str) -> str | None:
    """'action/object' for a log text from the tag vocabulary, or None when no repeatable action fits."""
    from app.kernel import tags as T
    act = [a for a in T.suggest(text, limit=40, facet="action", floor=1.5) if a["tag"] in REPEATABLE][:1]
    if not act:
        return None
    obj = T.suggest(text, limit=1, facet="object", floor=1.5)
    return act[0]["tag"] + ("/" + obj[0]["tag"] if obj else "")


def _person(meta: dict) -> str:
    from app import auth, hotlog, personal
    who = meta.get(auth.ACTING_KEY) or meta.get(hotlog.AUTHOR_KEY)
    return personal.personal_id(who) if who else LOCAL


def _day_bounds(day: str) -> tuple[float, float]:
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
    return start, start + 86400


def count_day(day: str, projects: list[str], log_lanes) -> dict[tuple[str, str], dict]:
    """{(person, key): {count, sessions, projects, sample}} from the logs of one UTC day."""
    from app import auth, hotlog, vector_store as vs
    lo, hi = _day_bounds(day)
    out: dict[tuple[str, str], dict] = {}
    for project in projects:
        seen: set[str] = set()
        for coll, where in log_lanes(project):
            ids = [vid for vid, ts in vs.field_values_vt("ts", where, collection=coll)
                   if vid not in seen and ts is not None and lo <= hotlog.parse_ts(ts) < hi]
            seen.update(ids)
            for start in range(0, len(ids), 200):
                for h in vs.get_ids_vt(ids[start:start + 200], where, collection=coll):
                    meta = h.get("metadata") or {}
                    text = h.get("source_text") or ""
                    key = key_of(text)
                    if not key:
                        continue
                    row = out.setdefault((_person(meta), key),
                                         {"count": 0, "sessions": set(), "projects": set(), "sample": text[:SAMPLE_CHARS]})
                    row["count"] += 1
                    row["projects"].add(project)
                    if meta.get(auth.ACTOR_KEY):
                        row["sessions"].add(str(meta[auth.ACTOR_KEY]))
    return out


def learn(day: str, projects: list[str], log_lanes) -> dict:
    """Rewrite one day's counts from its logs (idempotent)."""
    init()
    counted = count_day(day, projects, log_lanes)
    with _LOCK, sqldb.connect() as c:
        c.execute(f"DELETE FROM {TABLE} WHERE day_utc=?", (day,))
        for (person, key), r in counted.items():
            sqldb.upsert(c, TABLE, ("person", "day_utc", "action_key"), {
                "person": person, "day_utc": day, "action_key": key, "hits": r["count"],
                "sessions": json.dumps(sorted(r["sessions"])[-LIST_MAX:]), "projects": json.dumps(sorted(r["projects"])[:LIST_MAX]),
                "sample": r["sample"]})
    return {"day": day, "rows": len(counted), "people": len({p for p, _ in counted}),
            "logs": sum(r["count"] for r in counted.values())}


def learn_recent(days_back: int, projects: list[str], log_lanes, today: datetime | None = None) -> list[dict]:
    today = (today or datetime.now(timezone.utc)).date()
    return [learn((today - timedelta(days=d)).isoformat(), projects, log_lanes) for d in range(days_back, -1, -1)]


def rows(person: str, days: int = WINDOW_DAYS, today: datetime | None = None) -> list[dict]:
    since = ((today or datetime.now(timezone.utc)).date() - timedelta(days=days - 1)).isoformat()
    init()
    with sqldb.connect() as c:
        got = [dict(r) for r in c.execute(
            f"SELECT * FROM {TABLE} WHERE person=? AND day_utc>=? ORDER BY day_utc, action_key", (person, since)).fetchall()]
    for r in got:
        r["sessions"], r["projects"] = json.loads(r["sessions"]), json.loads(r["projects"])
        r["day"], r["key"], r["count"] = r.pop("day_utc"), r.pop("action_key"), r.pop("hits")
    return got


def repeats(person: str, days: int = WINDOW_DAYS, min_days: int = MIN_DAYS,
            today: datetime | None = None) -> list[dict]:
    """Keys the person hit on at least min_days different days of the window, most days first."""
    per: dict[str, dict] = {}
    for r in rows(person, days, today):
        k = per.setdefault(r["key"], {"key": r["key"], "days": 0, "total": 0, "last_day": "", "sample": ""})
        k["days"] += 1
        k["total"] += r["count"]
        k["last_day"], k["sample"] = r["day"], r["sample"]
    out = [k for k in per.values() if k["days"] >= min_days]
    out.sort(key=lambda k: (-k["days"], -k["total"], k["key"]))
    return out


def caller() -> str:
    from app import personal
    return personal.own_id() or LOCAL


def turn_lines(text: str = "", limit: int = 3) -> list[str]:
    """For the turn context: the caller's repeated steps that this message is about (same action, and the same
    object when the message names one). A message that matches none gets no line, so the hint stays rare."""
    key = key_of(text) if text else None
    if not key:
        return []
    act, _, obj = key.partition("/")
    hits = [k for k in repeats(caller()) if k["key"].split("/")[0] == act
            and (not obj or k["key"].partition("/")[2] in ("", obj))]
    return [f"{k['key']} on {k['days']} days of the last {WINDOW_DAYS} ({k['total']} times, last {k['last_day']})"
            for k in hits[:limit]]


def attach(app, log_lanes) -> None:
    TAG = ["Usage"]
    try:
        init()
    except Exception:  # noqa: BLE001 - usage counts are an extra; the app starts without them
        logger.exception("usage table could not be created; /usage routes will fail until fixed")

    @app.get("/usage/repeats", tags=TAG, summary="Your steps repeated on several days (for 'suggest a tool')")
    def usage_repeats(days: int = Query(WINDOW_DAYS, ge=1, le=90), min_days: int = Query(MIN_DAYS, ge=1, le=90)):
        return {"person": caller(), "days": days, "min_days": min_days, "repeats": repeats(caller(), days, min_days)}

    @app.get("/usage/mine", tags=TAG, summary="Your daily usage counts")
    def usage_mine(days: int = Query(WINDOW_DAYS, ge=1, le=90)):
        got = rows(caller(), days)
        return {"person": caller(), "count": len(got), "rows": got}

    @app.post("/usage/learn", tags=TAG, summary="Count one day (or the last days) of work logs (maintainers)")
    def usage_learn(body: dict | None = None):
        from app.projects import list_projects
        body = body or {}
        projects = body.get("projects") or sorted(list_projects())
        if body.get("day"):
            return {"learned": [learn(str(body["day"]), projects, log_lanes)]}
        return {"learned": learn_recent(int(body.get("days_back") or 1), projects, log_lanes)}

    logger.info("Usage routes attached (/usage/repeats|mine|learn)")
