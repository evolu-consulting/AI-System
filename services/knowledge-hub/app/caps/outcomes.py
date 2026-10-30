"""Step outcomes: serve ids, the people ``kh.served`` log and ``POST /step/outcome`` (roadmap E-5 slice S7).

docs/roadmap-e-to-5-design.md section 5.2. Default off: ``KH_CAP_OUTCOMES=on`` attaches it, and it writes only while
the ``kh_people`` namespace is active (``KH_CAP_PEOPLE=on``). Off, people's ``/context/step`` and ``/turn/context``
answer exactly as before (no ``serve_id``) and the routes below answer 404.

SERVE ID. People's ``/context/step`` and ``/turn/context`` routes call ``note_served`` after the response is built.
It adds ``serve_id`` to the response and schedules ONE ``kh.served`` event into ``kh_people`` on a thread
(``asyncio.create_task(asyncio.to_thread(...))``), never awaited by the request; a failure is logged, never raised.
The event id IS the serve id, so ``/step/outcome`` finds a serve through the unique ``(ns, id)`` index. Body:
``{serve_id, route, project, action, context, item_ids, withheld_ids, session, caller}``; the event's
``session_id`` is the ``X-KH-Session`` header (the Claude session id, sent by kh-helper), ``ix_s1``/``ix_s2`` hold
the action and the context. A maintainer bench call (``only_tiers`` / ``with_items``) is not a real step and is
not logged.

  POST /step/outcome {serve_ids[1..50], outcome done|failed|corrected, source tool|correction|stop|model, error?}
       authenticated; each serve id must be the caller's own. Per id: ``applied`` | ``duplicate`` | ``unknown`` |
       ``forbidden`` | ``lower_precedence`` | ``code_signal_wins`` | ``window_closed``.
  GET  /step/outcomes?session=&limit=   (maintainers) the session's kh.served and step.outcome events.

LABELS. ``corrected`` > ``failed`` > ``done``. A label replaces the current one when it ranks higher, or equal with
another source, within ``settings.learn.label_override_h`` (24 h) of the current label; a lower one is ignored. A
model's own label (source ``model``) never replaces a code signal (tool, correction, stop). Each applied label is a
``step.outcome`` event whose id is ``o_<outcome[0]><source[0]>_<serve_id>``, so a retried call is a duplicate and
the current label is the highest-ranked of at most 12 known ids. ``error`` (first line, <= 300 chars) is masked by
caps/redact (the namespace selection when redaction is on, else the shipped kh-default pack) and gives
``error_kind = sha12(project, action, context, normalised line)`` - digits, paths, ids and hex stripped. Each
applied label also records metric ``step.success`` (1 for done, else 0), ``unit_id`` = session, dims
``{project, action, context}``.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import secrets
import time

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import auth, sqldb
from app.caps.core import CapError

logger = logging.getLogger(__name__)

NAME = "outcomes"
VERSION = "1.0.0"
STATUS = "beta"
DEFAULT_ON = False                       # KH_CAP_OUTCOMES=on attaches it (design 5.2)

SERVED = "kh.served"
OUTCOME = "step.outcome"
RANK = {"done": 0, "failed": 1, "corrected": 2}
SOURCES = ("tool", "correction", "stop", "model")
ERROR_MAX = 300
SERVE_IDS_MAX = 50
LIST_MAX = 500
LIMITS = {"serve_ids_max": SERVE_IDS_MAX, "error_chars": ERROR_MAX, "list_max": LIST_MAX}
SESSION_HEADER = "x-kh-session"

_tasks: set = set()                      # strong references: a pending task is not garbage collected


def init(c) -> None:                     # noqa: ARG001 - no tables: kh_people events and metrics only
    sqldb.migrate(c, NAME, [])


def enabled() -> bool:
    """True when this module is attached and kh_people is active."""
    from app import caps
    from app.caps import people
    try:
        return caps.is_loaded(NAME) and people.active()
    except Exception:  # noqa: BLE001 - a context read must never fail on the served log
        return False


def new_serve_id() -> str:
    return f"sv_{int(time.time() * 1000):012x}{secrets.token_hex(6)}"


def caller_of(principal) -> str:
    """The identity a serve is bound to: the person's e-mail, a service principal's id, '' with auth off."""
    if principal is None:
        return ""
    if getattr(principal, "ns", None) and getattr(principal, "principal_id", None):
        return f"{principal.ns}:{principal.principal_id}"
    return (principal.email or "").lower()


def session_of(request: Request | None) -> str | None:
    if request is None:
        return None
    s = (request.headers.get(SESSION_HEADER) or "").strip()
    return s[:128] or None


# ── the served log ───────────────────────────────────────────────────────────

def write_served(body: dict) -> int:
    """Store one kh.served event in kh_people with id = serve_id. Returns its seq."""
    from app.caps import core, events, people
    actor = {"principal": people.SYSTEM, "session_id": body.get("session"), "caller": body.get("caller")}
    row = {"ns": people.NS, "id": body["serve_id"], "project": body.get("project") or "", "kind": SERVED,
           "ts_ms": None, "received_ms": None, "run_id": None, "unit_id": body.get("session"), "session_id": body.get("session"),
           "attempt": None, "epoch": None, "actor_json": core.jdump(actor), "schema_ver": None,
           **{x: None for x in events.IX}, "body_json": json.dumps(body, ensure_ascii=False, default=str)}
    row["ix_s1"] = (body.get("action") or None)
    row["ix_s2"] = (body.get("context") or None)
    return events._insert_tx(people.NS, [row])[0]["seq"]


def _safe(fn, *args) -> None:
    try:
        fn(*args)
    except Exception as exc:  # noqa: BLE001 - the served log must never reach the request
        logger.warning("outcomes: %s failed: %s", getattr(fn, "__name__", fn), exc)


def _spawn(fn, *args) -> None:
    """Fire and forget on a thread; never awaited, never raises."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        _safe(fn, *args)
        return
    task = loop.create_task(asyncio.to_thread(_safe, fn, *args))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def note_served(request: Request | None, out: dict, route: str, project: str | None, action: str | None,
                context: str | None, item_ids: list, withheld_ids: list | None = None) -> None:
    """Add ``serve_id`` to ``out`` and log kh.served in the background - only while enabled. Never raises."""
    try:
        if not enabled():
            return
        serve_id = new_serve_id()
        body = {"serve_id": serve_id, "route": route, "project": project, "action": action, "context": context,
                "item_ids": [str(i) for i in item_ids if i], "withheld_ids": [str(i) for i in withheld_ids or []],
                "session": session_of(request), "caller": caller_of(auth.current())}
        out["serve_id"] = serve_id
        _spawn(write_served, body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("outcomes: note_served failed: %s", exc)


def split_served(value) -> tuple[tuple, list]:
    """``distill.served`` result -> ((items, key), withheld ids). Tolerates a third element (slice S11)."""
    if isinstance(value, tuple) and len(value) > 2:
        return (value[0], value[1]), list(value[2] or [])
    return value, []


# ── labels ───────────────────────────────────────────────────────────────────

_PATH = re.compile(r"(?:[A-Za-z]:)?(?:[\\/][\w.\-~@+]+)+[\\/]?|\b[\w.\-]+\.(?:py|js|ts|java|go|rs|json|ya?ml|log|txt)\b")
_HEX = re.compile(r"\b(?:0x)?[0-9a-f]{6,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
_ID = re.compile(r"\b[a-z][a-z0-9]*[_\-][a-z0-9_\-]*\d[a-z0-9_\-]*\b")
_DIGITS = re.compile(r"\d+")


def first_line(text: str | None) -> str:
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()[:ERROR_MAX]
    return ""


def normalise(line: str) -> str:
    s = (line or "").lower()
    s = _HEX.sub(" ", s)
    s = _PATH.sub(" ", s)
    s = _ID.sub(" ", s)
    s = _DIGITS.sub(" ", s)
    return " ".join(s.split())


def error_kind(project: str | None, action: str | None, context: str | None, line: str) -> str:
    raw = "\x1f".join([project or "", action or "", context or "", normalise(line)])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def mask(text: str) -> str:
    """caps/redact masking: the kh_people selection when redaction is on, else the shipped default pack."""
    from app.caps import people, redact
    try:
        if redact._active[0]:
            return redact.scrub(people.system_ctx(), "events", text)
        return redact.default_scanner().scan(text)[0]
    except CapError:                       # a refuse-mode finding: keep nothing of the line
        return "[REDACTED:refused]"


def label_id(outcome: str, source: str, serve_id: str) -> str:
    return f"o_{outcome[0]}{source[0]}_{serve_id}"


def serve_id_of(label_row_id: str, body: dict) -> str | None:
    """The serve id of a step.outcome event. Read from the event id: redaction may mask the body's copy."""
    rid = str(label_row_id or "")
    return rid[5:] if rid.startswith("o_") and len(rid) > 5 else body.get("serve_id")


def _rows_by_id(c, ns: str, ids: list[str], kind: str) -> list:
    out = []
    for k in range(0, len(ids), 200):
        part = ids[k:k + 200]
        out += c.execute(f"SELECT * FROM kh_event WHERE ns=? AND kind=? AND id IN ({','.join('?' for _ in part)})",
                         [ns, kind] + part).fetchall()
    return out


def decide(current: dict | None, outcome: str, source: str, now_ms: int, window_ms: int) -> str:
    """'apply' or the reason the new label is ignored (the precedence rules of the module doc)."""
    if current is None:
        return "apply"
    if current["outcome"] == outcome and current["source"] == source:
        return "duplicate"
    if now_ms - current["ts_ms"] > window_ms:
        return "window_closed"
    if source == "model" and current["source"] != "model":
        return "code_signal_wins"
    if RANK[outcome] < RANK[current["outcome"]]:
        return "lower_precedence"
    return "apply"


def record(serve_ids: list[str], outcome: str, source: str, error: str | None, caller: str) -> dict:
    from app.caps import people
    if not people.active():
        raise CapError("ns_not_active", "kh_people is not active (KH_CAP_PEOPLE=on)", status=503)
    window_ms = int(float(people.settings("learn").get("label_override_h", 24)) * 3600 * 1000)
    ids = list(dict.fromkeys(serve_ids))
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        served = {r["id"]: r for r in _rows_by_id(c, people.NS, ids, SERVED)}
        known = [label_id(o, s, sid) for sid in served for o in RANK for s in SOURCES]
        labels = _rows_by_id(c, people.NS, known, OUTCOME)
    current: dict[str, dict] = {}
    for r in labels:
        b = json.loads(r["body_json"] or "{}")
        cur = {"outcome": b.get("outcome"), "source": b.get("source"), "ts_ms": int(r["ts_ms"])}
        key = serve_id_of(r["id"], b)
        old = current.get(key)
        if old is None or (RANK[cur["outcome"]], cur["ts_ms"]) > (RANK[old["outcome"]], old["ts_ms"]):
            current[key] = cur
    line = mask(first_line(error)) if error else ""
    results, applied = [], 0
    for n, sid in enumerate(ids):
        row = served.get(sid)
        if row is None:
            results.append({"serve_id": sid, "status": "unknown"})
            continue
        sb = json.loads(row["body_json"] or "{}")
        if (sb.get("caller") or "") != caller:
            results.append({"serve_id": sid, "status": "forbidden"})
            continue
        verdict = decide(current.get(sid), outcome, source, now, window_ms)
        if verdict != "apply":
            results.append({"serve_id": sid, "status": verdict, "current": (current.get(sid) or {}).get("outcome")})
            continue
        project, action, context, session = sb.get("project"), sb.get("action"), sb.get("context"), sb.get("session")
        body = {"serve_id": sid, "outcome": outcome, "source": source}
        if line:
            body["error"] = line
            body["error_kind"] = error_kind(project, action, context, line)
        for k, v in (("action", action), ("context", context)):
            if v:
                body[k] = v
        ev = {"id": label_id(outcome, source, sid), "kind": OUTCOME, "body": body, "session_id": session}
        if project:
            ev["project"] = project
        res = people.append_events([ev], session=session)
        dup = bool(res["accepted"] and res["accepted"][0].get("duplicate"))
        if not dup:
            dims = {k: v for k, v in (("project", project), ("action", action), ("context", context)) if v}
            obs = {"series": "step.success", "value": 1 if outcome == "done" else 0, "unit_id": session or "",
                   "ts_ms": int(time.time() * 1000) + n, "dims": dims}
            if project:
                obs["project"] = project
            try:
                people.record_metrics({"observations": [obs]})
            except Exception as exc:  # noqa: BLE001 - the label is stored; the metric is secondary
                logger.warning("outcomes: step.success for %s failed: %s", sid, exc)
            applied += 1
        out = {"serve_id": sid, "status": "duplicate" if dup else "applied", "outcome": outcome}
        if body.get("error_kind"):
            out["error_kind"] = body["error_kind"]
        results.append(out)
    return {"applied": applied, "results": results}


def session_events(session: str, limit: int) -> dict:
    from app.caps import events, people
    with sqldb.connect() as c:
        rows = c.execute("SELECT * FROM kh_event WHERE ns=? AND session_id=? AND kind IN (?, ?) ORDER BY seq LIMIT ?",
                         [people.NS, session, SERVED, OUTCOME, int(limit)]).fetchall()
    decoded = [events._decode(r) for r in rows]
    for e in decoded:
        if e["kind"] == OUTCOME and isinstance(e.get("body"), dict):
            e["body"]["serve_id"] = serve_id_of(e["id"], e["body"])
    return {"session": session, "served": [e for e in decoded if e["kind"] == SERVED],
            "outcomes": [e for e in decoded if e["kind"] == OUTCOME]}


# ── routes ───────────────────────────────────────────────────────────────────

class OutcomeRequest(BaseModel):
    serve_ids: list[str] = Field(..., min_length=1, max_length=SERVE_IDS_MAX)
    outcome: str = Field(..., pattern="^(done|failed|corrected)$")
    source: str = Field(..., pattern="^(tool|correction|stop|model)$")
    error: str | None = Field(default=None, max_length=4000,
                              description="the first error line; masked, cut to 300 characters")


def attach(app) -> None:
    TAG = ["Turn"]

    @app.post("/step/outcome", tags=TAG, summary="Label served step packs done, failed or corrected (caller's own)")
    async def step_outcome(body: OutcomeRequest) -> dict:
        bad = [s for s in body.serve_ids if not re.fullmatch(r"[A-Za-z0-9_\-]{1,64}", s or "")]
        if bad:
            raise HTTPException(status_code=422, detail=f"invalid serve ids: {bad[:5]}")
        caller = caller_of(auth.current())
        return await asyncio.to_thread(record, body.serve_ids, body.outcome, body.source, body.error, caller)

    @app.get("/step/outcomes", tags=TAG, summary="A session's served packs and labels (maintainers)")
    async def step_outcomes(session: str = Query(..., min_length=1, max_length=128),
                            limit: int = Query(200, ge=1, le=LIST_MAX)) -> dict:
        return await asyncio.to_thread(session_events, session, limit)

    logger.info("Outcome routes attached (/step/outcome, /step/outcomes)")
