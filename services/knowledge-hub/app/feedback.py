"""Feedback loop (B7, SA-1) — failing-counter + dumb cron + findings.

The roles are split so no reasoning happens in the wrong place:

  Claude (the learner)   marks that an issue recurred. First time Claude self-notices
                         a mistake OR fen nudges (without demanding a change), Claude
                         MINTS an issue (id + description) and +1s it; each recurrence
                         +1s. When fen demands a direct fix, the issue RESETS to 0.
                         Counter lives in the project bundle: projects/<id>/counter.json.

  Cron (the detector)    a DUMB background sweep — NO AI, NO content reading, NO worklog.
                         It reads ONLY the issues counter: for each open issue whose
                         count is over the threshold (> FINDING_MIN_COUNT, default 3) it
                         MARKS a finding into the project's findings collection. It never
                         decides what to do about it.

  Claude (again)         at the NEXT consult reads findings + policy for the current
                         intent (cheap: no full-history replay) → learns, fixes, and may
                         mint a policy (SA-2). That learn-back is a separate turn.

SA-1 threshold model (fen 2026-08-20, tightened): the cron NO LONGER looks at the worklog
or a request-ratio — some actions legitimately never write a worklog, so a ratio would
miss them. The single source of truth is the issues counter: count > 3 marks a finding.
On mark the issue is KEPT (never cleared) so issues/* and findings/* stay in lockstep;
they are cleared TOGETHER only when the problem is actually resolved (reset_issue), which
deletes both the issue entry and its finding record.

STORAGE (stage F1, multi-instance). The counters used to be one JSON document per project
(projects/<id>/counter.json, or a kh_docs row on HANA) rewritten whole under a process lock, so two
instances lost each other's increments. They are now rows in KH's relational store (app/sqldb.py):
  * feedback_issue(project, issue_id, ...) with ``count = count + 1`` - an atomic increment;
  * kh_counter('fb:req:<project>') for request_total;
  * marking a finding is a conditional UPDATE on last_marked_count, so it happens once per count even
    when two crons race. The old JSON is imported once per project (guarded by a kh_counter marker row).
The cron runs under the KH lease 'cron.feedback'. ``_read`` still returns the old JSON shape.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from . import config
from . import docstore
from . import sqldb
from . import vector_store as vs
from . import projects as kh_projects
from .projects import assert_canonical_id, bundle_of

logger = logging.getLogger(__name__)

# SA-1 (tightened 2026-08-20): a finding is marked purely on the issue count — no
# worklog, no ratio. An issue seen more than this many times becomes a finding.
FINDING_MIN_COUNT = int(os.getenv("KH_FINDING_MIN_COUNT", "3"))   # count > 3 -> mark

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Counter storage (feedback_issue + kh_counter rows; see the module docstring)
# ---------------------------------------------------------------------------

ISSUE = "feedback_issue"
_DESC_MAX = 2000
_IMPORTED: set[str] = set()
_ISSUE_COLS = "issue_id, descr, count, opened_at_request, last_marked_count, created_at, updated_at"


def _m1_issue_table(c) -> None:
    sqldb.create_table(
        c, ISSUE,
        f"""CREATE TABLE IF NOT EXISTS {ISSUE} (
                project           TEXT    NOT NULL,
                issue_id          TEXT    NOT NULL,
                descr             TEXT    NOT NULL DEFAULT '',
                count             INTEGER NOT NULL DEFAULT 0,
                opened_at_request INTEGER NOT NULL DEFAULT 0,
                last_marked_count INTEGER NOT NULL DEFAULT 0,
                created_at        TEXT    NOT NULL,
                updated_at        TEXT    NOT NULL,
                PRIMARY KEY (project, issue_id))""",
        f"""CREATE COLUMN TABLE {ISSUE} (
                project           NVARCHAR(256)  NOT NULL,
                issue_id          NVARCHAR(256)  NOT NULL,
                descr             NVARCHAR(2000) NOT NULL,
                count             BIGINT         NOT NULL,
                opened_at_request BIGINT         NOT NULL,
                last_marked_count BIGINT         NOT NULL,
                created_at        NVARCHAR(32)   NOT NULL,
                updated_at        NVARCHAR(32)   NOT NULL,
                PRIMARY KEY (project, issue_id))""")


_TABLE_READY: set[str] = set()


def _ready(c, project_id: str) -> None:
    """Table exists, and this project's legacy counter.json has been imported (once, race-safe)."""
    loc = sqldb.location()
    if loc not in _TABLE_READY:
        sqldb.migrate(c, "feedback", [(1, _m1_issue_table)])
        _TABLE_READY.add(loc)
    key = loc + "|" + project_id
    if key in _IMPORTED:
        return
    # The marker insert decides who imports: a racing instance waits on the key, then sees the rows.
    if sqldb.insert_new(c, "kh_counter", {"name": f"fb:imported:{project_id}", "n": 1}):
        legacy = docstore.read_json(bundle_of(project_id).counter_file, {}) or {}
        total = int(legacy.get("request_total") or 0)
        if total:
            sqldb.counter_add(c, f"fb:req:{project_id}", total)
        for iid, it in (legacy.get("issues") or {}).items():
            if not isinstance(it, dict):
                continue
            sqldb.insert_new(c, ISSUE, {
                "project": project_id, "issue_id": str(iid), "descr": str(it.get("desc") or "")[:_DESC_MAX],
                "count": int(it.get("count") or 0), "opened_at_request": int(it.get("opened_at_request") or 0),
                "last_marked_count": int(it.get("last_marked_count") or 0),
                "created_at": it.get("created_at") or _now(), "updated_at": it.get("updated_at") or _now()})
    _IMPORTED.add(key)


def _issue(r) -> dict:
    return {"issue_id": r["issue_id"], "desc": r["descr"] or "", "count": int(r["count"]),
            "opened_at_request": int(r["opened_at_request"]), "last_marked_count": int(r["last_marked_count"]),
            "created_at": r["created_at"], "updated_at": r["updated_at"]}


def _read(project_id: str) -> dict:
    """The counter in its old JSON shape: {request_total, issues: {issue_id: {...}}}."""
    pid = assert_canonical_id(project_id)
    with sqldb.connect() as c:
        _ready(c, pid)
        total = sqldb.counter_get(c, f"fb:req:{pid}")
        rows = c.execute(f"SELECT {_ISSUE_COLS} FROM {ISSUE} WHERE project=? ORDER BY issue_id", [pid]).fetchall()
    return {"request_total": total, "issues": {r["issue_id"]: _issue(r) for r in rows}}


# ---------------------------------------------------------------------------
# Counter operations (called by Claude)
# ---------------------------------------------------------------------------

def bump_issue(project_id: str, issue_id: str, desc: str = "") -> dict:
    """Mint-or-increment an issue's failing-counter. Returns the issue record. Atomic across instances."""
    if not kh_projects.projects_store.get_one(kh_projects.normalize_project_id(project_id)):
        kh_projects.get_or_create_project(project_id)  # ensure bundle exists (once, not on every bump)
    pid = assert_canonical_id(project_id)
    desc = (desc or "")[:_DESC_MAX]
    with sqldb.connect() as c:
        _ready(c, pid)
        now = _now()
        inc = (f"UPDATE {ISSUE} SET count = count + 1, updated_at=?, "
               "descr = CASE WHEN ? = '' THEN descr ELSE ? END WHERE project=? AND issue_id=?")
        params = [now, desc, desc, pid, issue_id]
        if not sqldb.update(c, inc, params):
            opened = sqldb.counter_get(c, f"fb:req:{pid}")
            if not sqldb.insert_new(c, ISSUE, {"project": pid, "issue_id": issue_id, "descr": desc, "count": 1,
                                               "opened_at_request": opened, "last_marked_count": 0,
                                               "created_at": now, "updated_at": now}):
                sqldb.update(c, inc, params)
        it = _issue(c.execute(f"SELECT {_ISSUE_COLS} FROM {ISSUE} WHERE project=? AND issue_id=?",
                              [pid, issue_id]).fetchone())
    logger.info("feedback bump — %s/%s count=%d", pid, issue_id, it["count"])
    return it


def reset_issue(project_id: str, issue_id: str) -> dict:
    """Issue RESOLVED (fen demanded a direct fix) → clear BOTH sides in sync.

    Per SA-1 (2026-08-20): a marked finding is never cleared on its own; the issue and
    its finding are cleared TOGETHER only here, when the problem is actually resolved.
    Removes the issue entry from the counter AND deletes its finding record so issues/*
    and findings/* never drift out of sync.
    """
    pid = assert_canonical_id(project_id)
    with sqldb.connect() as c:
        _ready(c, pid)
        removed = sqldb.update(c, f"DELETE FROM {ISSUE} WHERE project=? AND issue_id=?", [pid, issue_id]) > 0
    # delete the paired finding (best-effort; stable 1:1 id)
    deleted_finding = False
    try:
        _findings_collection(pid).delete(ids=[f"finding__{issue_id}"])
        deleted_finding = True
    except Exception:
        logger.exception("reset_issue — finding delete failed for %s/%s", pid, issue_id)
    logger.info("feedback resolve — %s/%s cleared (issue=%s finding=%s)",
                pid, issue_id, removed, deleted_finding)
    return {"issue_id": issue_id, "resolved": True,
            "issue_cleared": removed, "finding_cleared": deleted_finding}


def tick_request(project_id: str, n: int = 1) -> int:
    """Increment the project's authoritative request counter (the cron denominator). Atomic."""
    pid = assert_canonical_id(project_id)
    with sqldb.connect() as c:
        _ready(c, pid)
        return sqldb.counter_add(c, f"fb:req:{pid}", int(n))


def forget_project(project_id: str) -> None:
    """Drop a deleted project's counter rows."""
    with sqldb.connect() as c:
        _ready(c, project_id)
        c.execute(f"DELETE FROM {ISSUE} WHERE project=?", [project_id])
        sqldb.counter_delete(c, f"fb:req:{project_id}")


# ---------------------------------------------------------------------------
# Findings (marked by the cron; read by Claude at consult)
# ---------------------------------------------------------------------------

def _findings_collection(project_id: str):
    return vs.get_or_create(bundle_of(assert_canonical_id(project_id)).findings_collection)


def mark_finding(project_id: str, issue: dict, embedding: list[float] | None) -> dict:
    """Persist ONE finding per issue (dumb: copies the count, no reasoning).

    Stable id ``finding__<issue_id>`` so re-marking an issue at a higher count UPDATES
    the same record instead of spawning duplicates — keeps a clean 1:1 issue<->finding
    mapping that reset_issue can clear atomically.
    """
    pid = assert_canonical_id(project_id)
    fid = f"finding__{issue['issue_id']}"
    desc = issue.get("desc", "") or issue["issue_id"]
    meta = {"kind": "finding", "project": pid, "issue_id": issue["issue_id"],
            "desc": desc, "count": issue["count"], "status": "open", "ts": _now(),
            "source_text": desc}
    coll = _findings_collection(pid)
    kwargs = {"ids": [fid], "metadatas": [meta], "documents": [desc]}
    if embedding is not None:
        kwargs["embeddings"] = [embedding]
    coll.upsert(**kwargs)
    logger.info("feedback finding MARKED — %s/%s count=%d", pid, issue["issue_id"], issue["count"])
    return meta


def list_findings(project_id: str) -> list[dict]:
    coll = _findings_collection(project_id)
    r = coll.get(include=["metadatas"])
    return list(r.get("metadatas") or [])


def query_findings(project_id: str, intent_embedding: list[float], k: int = 5,
                   threshold: float = 0.35) -> list[dict]:
    """Findings matching an intent — the cheap consult read Claude does per turn."""
    coll = _findings_collection(project_id)
    total = coll.count() or 0
    if total == 0:
        return []
    r = coll.query(query_embeddings=[intent_embedding], n_results=min(k, total),
                   include=["distances", "metadatas", "documents"])
    out = []
    for fid, dist, meta, doc in zip(r["ids"][0], r["distances"][0], r["metadatas"][0], r["documents"][0]):
        score = round(1.0 - dist, 6)
        if score < threshold:
            continue
        m = dict(meta or {})
        m["score"] = score
        out.append(m)
    return out


# ---------------------------------------------------------------------------
# The dumb cron — sequential per project, number-compare only
# ---------------------------------------------------------------------------

def evaluate_project(project_id: str, embed=None) -> list[dict]:
    """One dumb pass over a project's issues; mark a finding for any issue over the
    count threshold. Reads ONLY the issues counter — no worklog, no ratio (SA-1 2026-08-20).

    `embed(text)->vector` is optional (KH's own embedder, 0 tokens); when absent the
    finding is stored without a vector (still listable, just not intent-searchable).
    """
    marked = []
    pid = assert_canonical_id(project_id)
    to_mark = []
    with sqldb.connect() as c:
        _ready(c, pid)
        rows = c.execute(f"SELECT {_ISSUE_COLS} FROM {ISSUE} WHERE project=? AND count > ? "
                         "AND count > last_marked_count", [pid, FINDING_MIN_COUNT]).fetchall()
        for r in rows:
            it = _issue(r)
            # Conditional: only the sweep that moves last_marked_count up to this count marks it.
            if sqldb.update(c, f"UPDATE {ISSUE} SET last_marked_count=? WHERE project=? AND issue_id=? "
                               "AND last_marked_count < ?", [it["count"], pid, it["issue_id"], it["count"]]):
                it["last_marked_count"] = it["count"]
                to_mark.append(it)
    # embed + persist after the counter transaction committed
    for it in to_mark:
        emb = None
        if embed is not None:
            try:
                emb = embed(it.get("desc", "") or it["issue_id"])
            except Exception:
                emb = None
        marked.append(mark_finding(project_id, it, emb))
    return marked


def sweep(embed=None) -> dict:
    """Scan every project SEQUENTIALLY and mark findings. Returns per-project counts."""
    out = {}
    for pid in kh_projects.list_projects().keys():
        try:
            m = evaluate_project(pid, embed)
            if m:
                out[pid] = len(m)
        except Exception:
            logger.exception("feedback sweep — project %s failed", pid)
    return out


class _Cron:
    """Background sweeper — starts with KH, ticks on an interval, no AI."""
    def __init__(self, interval: int, embed):
        self.interval = interval
        self.embed = embed
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread:
            return
        self._thread = threading.Thread(target=self._run, name="feedback-cron", daemon=True)
        self._thread.start()
        logger.info("feedback cron started (interval=%ss)", self.interval)

    def stop(self):
        self._stop.set()

    def _run(self):
        # small initial delay so startup finishes first
        if self._stop.wait(min(self.interval, 30)):
            return
        while not self._stop.is_set():
            try:
                ran, res = sqldb.run_under_lease("cron.feedback", self.interval * 1.5,
                                                 lambda: sweep(self.embed))
                if ran and res:
                    logger.info("feedback cron — findings marked: %s", res)
            except Exception:
                logger.exception("feedback cron sweep failed")
            if self._stop.wait(self.interval):
                break


_cron: _Cron | None = None


def start_cron(model, interval: int | None = None) -> None:
    """Start the feedback cron with KH's own embedder (called from lifespan)."""
    global _cron
    if _cron is not None:
        return
    iv = interval or int(os.getenv("KH_FEEDBACK_CRON_SECONDS", "300"))

    def _embed(text: str):
        return model.encode(text, normalize_embeddings=True).tolist()

    _cron = _Cron(iv, _embed)
    _cron.start()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def attach(app) -> None:
    TAG = ["Feedback"]

    @app.post("/feedback/issue", tags=TAG, summary="Mint/increment an issue failing-counter (SA-1)")
    async def issue(body: dict):
        project = (body.get("project") or "").strip()
        issue_id = (body.get("issue_id") or "").strip()
        if not project or not issue_id:
            raise HTTPException(400, "project and issue_id required")
        try:
            return bump_issue(project, issue_id, body.get("desc", ""))
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.post("/feedback/reset", tags=TAG,
              summary="Resolve an issue: clear BOTH the issue counter AND its finding (sync)")
    async def reset(body: dict):
        project = (body.get("project") or "").strip()
        issue_id = (body.get("issue_id") or "").strip()
        if not project or not issue_id:
            raise HTTPException(400, "project and issue_id required")
        return reset_issue(project, issue_id)

    @app.post("/feedback/resolve", tags=TAG,
              summary="Alias of /feedback/reset — mark an issue resolved, clear issue + finding")
    async def resolve(body: dict):
        project = (body.get("project") or "").strip()
        issue_id = (body.get("issue_id") or "").strip()
        if not project or not issue_id:
            raise HTTPException(400, "project and issue_id required")
        return reset_issue(project, issue_id)

    @app.post("/feedback/tick", tags=TAG, summary="Increment a project's request counter (cron denominator)")
    async def tick(body: dict):
        project = (body.get("project") or "").strip()
        if not project:
            raise HTTPException(400, "project required")
        return {"project": project, "request_total": tick_request(project, int(body.get("n", 1)))}

    @app.get("/feedback/counter", tags=TAG, summary="Read a project's raw counter")
    async def counter(project: str):
        return _read(project)

    @app.get("/findings/list", tags=TAG, summary="List a project's findings")
    async def findings_list(project: str):
        return {"project": project, "findings": list_findings(project)}

    @app.post("/findings/query", tags=TAG, summary="Findings matching an intent — the consult read")
    async def findings_query(body: dict, request: Request):
        project = (body.get("project") or "").strip()
        intent = (body.get("intent") or body.get("query") or "").strip()
        if not project or not intent:
            raise HTTPException(400, "project and intent required")
        model = request.app.state.model
        emb = await asyncio.to_thread(model.encode, intent, normalize_embeddings=True)
        return {"project": project, "findings": query_findings(project, emb.tolist(),
                int(body.get("k", 5)), float(body.get("threshold", 0.35)))}

    @app.post("/feedback/sweep", tags=TAG, summary="Run the dumb finding sweep now (same logic as the cron)")
    async def sweep_now(request: Request):
        model = request.app.state.model
        def _embed(t): return model.encode(t, normalize_embeddings=True).tolist()
        return {"marked": await asyncio.to_thread(sweep, _embed)}

    logger.info("Feedback routes attached (/feedback/*, /findings/*)")
