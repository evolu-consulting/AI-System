"""Learn back: distil worklogs and findings into lessons, now or on a schedule (fen 2026-10-13).

WHAT IT RUNS. The worker's distil job (worker/kh_worker/jobs/distil.py) inside this KH process: the job's
GET /distill/next and POST /distill/submit become direct calls (distill.serve_next / distill.submit), and its
model is the worker's LLM door (KH_LEARNBACK_LLM: claude_cli = the Claude Code CLI on this machine, dry =
canned answers for tests, anthropic = the API). Items land as 'proposed' and wait for approval on /home >
Lesson learn, exactly like the worker's. The batch reads the project's log AND its findings.

WHERE IT RUNS. Only on a KH that has a model at hand: KH_LEARNBACK_LLM unset (the default) turns it off - the
page shows the button disabled with the reason. Prod (CF, no Claude CLI) runs KH_LEARNBACK_LLM=anthropic with
CLAUDE_CODE_OAUTH_TOKEN (a `claude setup-token`, see kh_worker/llm.py) since 2026-10-27; push.ps1 stages
worker/kh_worker and the anthropic SDK for it.

PROMOTE. A schedule or run whose projects include the pseudo project 'common' (PROMOTE) also runs the worker's
promote job (app/promote.py, kernel rule 10) after the distil of the real projects.

SCHEDULES. 'now', 'once' at a local date-time, 'daily' at HH:MM, 'weekly' on a weekday at HH:MM, in
KH_LEARNBACK_TZ (default Asia/Ho_Chi_Minh). A thread checks every KH_LEARNBACK_TICK_S seconds; one run at a
time. Schedules and runs live in the relational store (learnback_schedule, learnback_run), so they survive a
restart; a run that was going when KH stopped is marked interrupted at the next start.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from . import config, sqldb

logger = logging.getLogger(__name__)

LLM = (os.getenv("KH_LEARNBACK_LLM") or "").strip().lower()
MODEL = (os.getenv("KH_LEARNBACK_MODEL") or "").strip()
TZ_NAME = (os.getenv("KH_LEARNBACK_TZ") or "Asia/Ho_Chi_Minh").strip()
TICK_S = float(os.getenv("KH_LEARNBACK_TICK_S") or "30")
CAP_RUN_USD = float(os.getenv("KH_LEARNBACK_CAP_RUN_USD") or "5")
KINDS = ("now", "once", "daily", "weekly")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
SCHED, RUNS = "learnback_schedule", "learnback_run"
# The pseudo project of a schedule or run that also reviews personal rules for the common tier (app/promote.py).
PROMOTE = "common"

_LOCK = threading.Lock()
_READY = False
_RUNNING: Dict[str, Any] = {}
_APP = None


# ── availability ─────────────────────────────────────────────────────────────

def _worker_path() -> Optional[Path]:
    for root in (Path(__file__).resolve().parent.parent / "worker", Path(os.getenv("KH_WORKER_PATH") or "-")):
        if (root / "kh_worker" / "jobs" / "distil.py").exists():
            return root
    return None


def status() -> Dict[str, Any]:
    if LLM not in ("claude_cli", "dry", "anthropic"):
        return {"enabled": False, "reason": "Learn back is off on this KH: it needs a model on the server "
                                            "(KH_LEARNBACK_LLM). Run it from a KH that has the Claude CLI."}
    if _worker_path() is None:
        return {"enabled": False, "reason": "the distil worker (worker/kh_worker) is not deployed with this KH"}
    return {"enabled": True, "llm": LLM, "model": MODEL or "worker default", "tz": TZ_NAME, "reason": ""}


def _zone() -> tzinfo:
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(TZ_NAME)
    except Exception:
        fixed = {"Asia/Ho_Chi_Minh": 7, "Asia/Saigon": 7, "UTC": 0}
        return timezone(timedelta(hours=fixed.get(TZ_NAME, 7)), TZ_NAME)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(t: Optional[datetime]) -> Optional[str]:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


# ── tables ───────────────────────────────────────────────────────────────────

def init() -> None:
    global _READY
    with _LOCK:
        if _READY:
            return
        with sqldb.connect() as c:
            sqldb.create_table(c, SCHED, f"""
                CREATE TABLE IF NOT EXISTS {SCHED} (
                    id TEXT PRIMARY KEY, projects TEXT NOT NULL, kind TEXT NOT NULL, at_spec TEXT NOT NULL DEFAULT '',
                    next_utc TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
                    created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
                    last_run TEXT NOT NULL DEFAULT '')""", f"""
                CREATE COLUMN TABLE {SCHED} (
                    id NVARCHAR(64) PRIMARY KEY, projects NVARCHAR(2000) NOT NULL, kind NVARCHAR(16) NOT NULL,
                    at_spec NVARCHAR(64) NOT NULL DEFAULT '', next_utc NVARCHAR(32) NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1, created_by NVARCHAR(256) NOT NULL DEFAULT '',
                    created_at NVARCHAR(32) NOT NULL DEFAULT '', last_run NVARCHAR(64) NOT NULL DEFAULT '')""")
            sqldb.create_table(c, RUNS, f"""
                CREATE TABLE IF NOT EXISTS {RUNS} (
                    id TEXT PRIMARY KEY, trigger_kind TEXT NOT NULL, projects TEXT NOT NULL, state TEXT NOT NULL,
                    started TEXT NOT NULL, finished TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '',
                    summary TEXT NOT NULL DEFAULT '')""", f"""
                CREATE COLUMN TABLE {RUNS} (
                    id NVARCHAR(64) PRIMARY KEY, trigger_kind NVARCHAR(16) NOT NULL, projects NVARCHAR(2000) NOT NULL,
                    state NVARCHAR(16) NOT NULL, started NVARCHAR(32) NOT NULL, finished NVARCHAR(32) NOT NULL DEFAULT '',
                    created_by NVARCHAR(256) NOT NULL DEFAULT '', summary NCLOB)""")
            c.execute(f"UPDATE {RUNS} SET state = 'interrupted', finished = ? WHERE state = 'running'", [_iso(_now())])
        _READY = True


def _rows(sql: str, params=()) -> List[dict]:
    init()
    with sqldb.connect() as c:
        return [{k.lower(): r[k] for k in r.keys()} for r in c.execute(sql, list(params)).fetchall()]


# ── schedules ────────────────────────────────────────────────────────────────

def next_time(kind: str, at: str, after: datetime) -> Optional[datetime]:
    """The next UTC moment a schedule fires after ``after``; None when it never will again."""
    z = _zone()
    if kind == "now":
        return after
    if kind == "once":
        t = datetime.fromisoformat(at)
        t = t.replace(tzinfo=z) if t.tzinfo is None else t
        return t.astimezone(timezone.utc) if t > after else None
    parts = at.lower().split()
    wd = WEEKDAYS.index(parts[0][:3]) if kind == "weekly" else None
    hh, mm = (int(x) for x in parts[-1].split(":", 1))
    local = after.astimezone(z)
    for d in range(0, 8):
        day = (local + timedelta(days=d)).replace(hour=hh, minute=mm, second=0, microsecond=0)
        if day <= local or (wd is not None and day.weekday() != wd):
            continue
        return day.astimezone(timezone.utc)
    return None


def _check(kind: str, at: str) -> None:
    if kind not in KINDS:
        raise HTTPException(422, "kind must be one of %s" % list(KINDS))
    try:
        if kind == "once":
            datetime.fromisoformat(at)
        elif kind in ("daily", "weekly"):
            parts = at.lower().split()
            if kind == "weekly" and (len(parts) != 2 or parts[0][:3] not in WEEKDAYS):
                raise ValueError
            hh, mm = (int(x) for x in parts[-1].split(":", 1))
            if not (0 <= hh < 24 and 0 <= mm < 60):
                raise ValueError
    except (ValueError, IndexError):
        raise HTTPException(422, "at: 'YYYY-MM-DDTHH:MM' (once), 'HH:MM' (daily), 'fri 00:00' (weekly)")


def schedules() -> List[dict]:
    out = []
    for r in _rows(f"SELECT * FROM {SCHED} ORDER BY created_at DESC"):
        r["projects"] = json.loads(r["projects"] or "[]")
        r["enabled"] = bool(r["enabled"])
        r["at"] = r.pop("at_spec", "")
        out.append(r)
    return out


def add_schedule(projects: List[str], kind: str, at: str, by: str) -> dict:
    _check(kind, at)
    projects = [p for p in projects if p]
    if not projects:
        raise HTTPException(422, "pick at least one project")
    nxt = next_time(kind, at, _now())
    if nxt is None:
        raise HTTPException(422, "that time is already past")
    row = {"id": "lbs_" + uuid.uuid4().hex[:10], "projects": json.dumps(projects), "kind": kind, "at_spec": at,
           "next_utc": _iso(nxt), "enabled": 1, "created_by": by, "created_at": _iso(_now()), "last_run": ""}
    init()
    with sqldb.connect() as c:
        sqldb.upsert(c, SCHED, ("id",), row)
    return {**row, "projects": projects, "at": at}


def delete_schedule(sid: str) -> dict:
    init()
    with sqldb.connect() as c:
        c.execute(f"DELETE FROM {SCHED} WHERE id = ?", [sid])
    return {"id": sid, "deleted": True}


def runs(limit: int = 20) -> List[dict]:
    out = []
    for r in _rows(f"SELECT * FROM {RUNS} ORDER BY started DESC")[:limit]:
        r["projects"] = json.loads(r["projects"] or "[]")
        try:
            r["summary"] = json.loads(r["summary"] or "{}")
        except ValueError:
            r["summary"] = {"raw": str(r["summary"])[:500]}
        out.append(r)
    return out


# ── running ──────────────────────────────────────────────────────────────────

class _LocalKH:
    """The KH client the worker's distil job expects, answered in-process."""

    def __init__(self, encode, caller: str):
        self.encode = encode
        self.caller = caller
        self.dry = False
        self.run_id = "learnback-" + uuid.uuid4().hex[:8]
        self.events: List[dict] = []

    @staticmethod
    def lanes(project: str) -> list:
        from . import distill, sync
        lanes = list(distill.LOG_LANES(project))
        f = sync.part_collection("findings", project)
        if f is not None:
            lanes.append((f, None))
        return lanes

    def distill_next(self, project: str, limit: Optional[int] = None) -> dict:
        from . import distill
        return distill.serve_next(project, limit or config.DISTILL_BATCH, self.encode, self.lanes(project))

    def distill_submit(self, body: dict) -> dict:
        from . import distill
        from .policy_actions import store as policy_store
        project = body.get("project") or ""
        actions = {a["action"] for a in policy_store.menu(project)}
        return distill.submit(body, self.encode, actions, "learnback:" + self.caller, self.lanes(project),
                              dry_run=body.get("dry_run") is True)

    def distill_cursor(self, project: str) -> dict:
        from . import distill
        return distill.cursor(project)

    def promote_next(self) -> dict:
        from . import promote
        return promote.serve_next()

    def promote_submit(self, body: dict) -> dict:
        from . import promote
        return promote.submit(body, self.encode, dry_run=body.get("dry_run") is True)

    def append_event(self, kind: str, body: dict, *, project: str = "", event_id: str = "") -> None:
        self.events.append({"kind": kind, "project": project, "results": len((body or {}).get("results") or [])})


def _execute(run_id: str, projects: List[str], caller: str) -> dict:
    root = _worker_path()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from kh_worker.budget import Budget
    from kh_worker.jobs import distil, promote as promote_job
    from . import promote
    from kh_worker.llm import Metered, make_llm
    from kh_worker.main import Config, RunContext
    model = _APP.state.model
    encode = lambda t: model.encode(t, normalize_embeddings=True).tolist()   # noqa: E731
    llm = make_llm(LLM, MODEL or None)
    budget = Budget(cap_run_usd=CAP_RUN_USD, cap_month_usd=max(CAP_RUN_USD, 1e9), month_spent_usd=0.0)
    cfg = Config(mode="on", llm=LLM, model=llm.model, projects=list(projects))
    kh = _LocalKH(encode, caller)
    real = [p for p in projects if p != PROMOTE]
    ctx = RunContext(cfg=cfg, kh=kh, llm=Metered(llm, budget), budget=budget, job="distil",
                     projects=real, dry=False, backfill=False, lease_lost=threading.Event())
    out = distil.run(ctx) if real else {"status": "ok"}
    if promote.ENABLED and PROMOTE in projects:
        # Kernel rule 10: personal rules several people share -> common-tier proposals (app/promote.py).
        try:
            out["promote"] = promote_job.run(ctx)
        except Exception as exc:  # noqa: BLE001 - the distil part of the run stands
            out["promote"] = {"status": "error", "error": f"{type(exc).__name__}: {exc}"[:500]}
    # Usage across sessions (app/usage.py): yesterday and today counted again from every project's logs,
    # personal ones included, so a step done every day in a new session is seen. Code only, no model cost.
    try:
        from . import distill, usage
        from .projects import list_projects
        out["usage"] = usage.learn_recent(1, sorted(list_projects()), distill.LOG_LANES)
    except Exception as exc:  # noqa: BLE001 - the distil part of the run stands
        out["usage"] = {"status": "error", "error": f"{type(exc).__name__}: {exc}"[:500]}
    out["budget"] = budget.summary()
    out["llm"], out["model"] = LLM, llm.model
    return out


def _finish(run_id: str, state: str, summary: dict) -> None:
    with sqldb.connect() as c:
        c.execute(f"UPDATE {RUNS} SET state = ?, finished = ?, summary = ? WHERE id = ?",
                  [state, _iso(_now()), json.dumps(summary, default=str)[:200000], run_id])


def start(projects: List[str], trigger: str, by: str) -> dict:
    """Start a run in the background; one at a time."""
    st = status()
    if not st["enabled"]:
        raise HTTPException(409, st["reason"])
    projects = [p for p in projects if p]
    if not projects:
        raise HTTPException(422, "pick at least one project")
    init()
    with _LOCK:
        if _RUNNING:
            raise HTTPException(409, "a learn-back run is already going (%s)" % next(iter(_RUNNING)))
        run_id = "lbr_" + uuid.uuid4().hex[:10]
        _RUNNING[run_id] = True
    with sqldb.connect() as c:
        sqldb.upsert(c, RUNS, ("id",), {"id": run_id, "trigger_kind": trigger, "projects": json.dumps(projects),
                                        "state": "running", "started": _iso(_now()), "finished": "",
                                        "created_by": by, "summary": "{}"})

    def go():
        try:
            out = _execute(run_id, projects, by)
            _finish(run_id, "done" if out.get("status") in ("ok", None) else str(out.get("status")), out)
        except Exception as exc:  # noqa: BLE001 - the run's row says what went wrong
            logger.exception("learnback run %s failed", run_id)
            _finish(run_id, "failed", {"error": f"{type(exc).__name__}: {exc}"[:1000]})
        finally:
            with _LOCK:
                _RUNNING.pop(run_id, None)

    threading.Thread(target=go, name="kh-learnback-" + run_id, daemon=True).start()
    return {"id": run_id, "state": "running", "projects": projects}


def tick(now: Optional[datetime] = None) -> List[str]:
    """Fire due schedules (one run at a time; a due schedule waits for the running one)."""
    now = now or _now()
    started = []
    for s in schedules():
        if not s["enabled"] or not s["next_utc"] or s["next_utc"] > _iso(now) or _RUNNING:
            continue
        try:
            run = start(s["projects"], s["kind"], s["created_by"] or "schedule")
        except HTTPException as exc:
            logger.warning("learnback schedule %s not started: %s", s["id"], exc.detail)
            continue
        nxt = None if s["kind"] in ("once", "now") else next_time(s["kind"], s["at"], now + timedelta(seconds=1))
        with sqldb.connect() as c:
            c.execute(f"UPDATE {SCHED} SET last_run = ?, next_utc = ?, enabled = ? WHERE id = ?",
                      [run["id"], _iso(nxt) or "", 1 if nxt else 0, s["id"]])
        started.append(run["id"])
    return started


def _loop(stop: threading.Event) -> None:
    while not stop.wait(TICK_S):
        try:
            tick()
        except Exception:  # noqa: BLE001 - one bad tick must not stop the scheduler
            logger.exception("learnback tick failed")


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    import asyncio
    global _APP
    _APP = app
    TAG = ["Learn back"]

    def caller() -> str:
        from . import auth
        p = auth.current()
        return p.email if p is not None else "local"

    @app.get("/home/learnback", tags=TAG, summary="Learn back: availability, schedules and recent runs")
    async def lb_state():
        st = status()
        if not st["enabled"]:                  # never touch the store where learn back cannot run (prod)
            return {**st, "running": [], "schedules": [], "runs": []}
        return {**st, "running": list(_RUNNING), "schedules": await asyncio.to_thread(schedules),
                "runs": await asyncio.to_thread(runs)}

    @app.post("/home/learnback/run", tags=TAG, summary="Start learning lessons from worklogs and findings now")
    async def lb_run(body: dict):
        return await asyncio.to_thread(start, [str(p) for p in body.get("projects") or []], "now", caller())

    @app.post("/home/learnback/schedules", tags=TAG, summary="Schedule learn back: once, daily or weekly")
    async def lb_schedule(body: dict):
        if not status()["enabled"]:
            raise HTTPException(409, status()["reason"])
        return await asyncio.to_thread(add_schedule, [str(p) for p in body.get("projects") or []],
                                       str(body.get("kind") or ""), str(body.get("at") or ""), caller())

    @app.post("/home/learnback/schedules/{sid}/delete", tags=TAG, summary="Remove a learn-back schedule")
    async def lb_schedule_delete(sid: str):
        return await asyncio.to_thread(delete_schedule, sid)

    if status()["enabled"]:
        init()
        stop = threading.Event()
        threading.Thread(target=_loop, args=(stop,), name="kh-learnback-scheduler", daemon=True).start()
        logger.info("Learn back on (llm=%s, tz=%s)", LLM, TZ_NAME)
    else:
        logger.info("Learn back off: %s", status()["reason"])


__all__ = ["status", "start", "tick", "next_time", "add_schedule", "delete_schedule", "schedules", "runs", "attach"]
