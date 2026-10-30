"""KH's own operational events: API calls, session turns, messages and worklogs (fen 2026-10-24).

``emit(kind, body, ...)`` never blocks a request and never raises: the event goes into a bounded in-process outbox
and a flusher thread hands it to the EventBuffer (app/eventing/queue.py) once a second. When the buffer refuses
(the sidecar is full or down) the batch stays and is retried; past KH_EVENTS_OUTBOX_MAX the oldest events are
dropped and counted, so a dead sidecar can never grow KH's memory.

Every event lands in namespace KH_EVENTS_NS (default "kh") with session_id = the CLI session (X-KH-Actor) and
ix_s1 = the caller's e-mail, so the events of one person or one session are one indexed read away.

Kinds (all kh.*: only KH writes them):
  kh.api.call          {method, path, status, ms, hook_type?}           ix_s2 = path, ix_n1 = ms
  kh.session.turn      {project, bound, source}                          the turn context of one prompt
  kh.message.sent      {channel, to_actor, project}
  kh.message.delivered {count, project}
  kh.worklog.stored    {project, project_from}
Off unless KH_EVENTS=on.
"""
from __future__ import annotations

import collections
import json
import logging
import os
import secrets
import threading
import time

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_outbox: collections.deque = collections.deque()
_thread: threading.Thread | None = None
_stop = threading.Event()
STATS = {"emitted": 0, "sent": 0, "dropped": 0, "send_errors": 0}
SKIP_PATHS = ("/health", "/queue/", "/favicon.ico", "/static/")


def enabled() -> bool:
    return (os.getenv("KH_EVENTS") or "off").strip().lower() in ("1", "on", "true", "yes")


def namespace() -> str:
    return (os.getenv("KH_EVENTS_NS") or "kh").strip() or "kh"


def _max() -> int:
    return int(os.getenv("KH_EVENTS_OUTBOX_MAX") or 20000)


def new_id() -> str:
    return f"{int(time.time() * 1000):012x}{secrets.token_hex(6)}"


def row(kind: str, body: dict, project: str = "", email: str | None = None, actor: str | None = None,
        ix2: str | None = None, n1: float | None = None) -> dict:
    """A kh_event row (no ns, seq or received_ms: the store sets them)."""
    return {"id": new_id(), "project": project or "", "kind": kind, "ts_ms": int(time.time() * 1000),
            "run_id": None, "unit_id": None, "session_id": (actor or None) and str(actor)[:128], "attempt": None,
            "epoch": None, "actor_json": json.dumps({"email": email, "actor": actor}), "schema_ver": None,
            "ix_s1": (email or None) and str(email)[:256], "ix_s2": (ix2 or None) and str(ix2)[:256],
            "ix_s3": None, "ix_s4": None, "ix_n1": n1, "ix_n2": None,
            "body_json": json.dumps(body, ensure_ascii=False, default=str)}


def emit(kind: str, body: dict, project: str = "", email: str | None = None, actor: str | None = None,
         ix2: str | None = None, n1: float | None = None) -> None:
    """Queue one KH event. Never raises, never blocks."""
    if not enabled():
        return
    try:
        if email is None or actor is None:
            from app import auth
            p = auth.current()
            email = email if email is not None else (p.email if p is not None else None)
            actor = actor if actor is not None else auth.current_actor()
        r = row(kind, body, project, email, actor, ix2, n1)
        with _LOCK:
            _outbox.append(r)
            STATS["emitted"] += 1
            while len(_outbox) > _max():
                _outbox.popleft()
                STATS["dropped"] += 1
        _ensure_thread()
    except Exception:  # noqa: BLE001 - telemetry must never break a request
        logger.debug("event emit failed", exc_info=True)


def flush(limit: int = 500) -> int:
    """Hand up to ``limit`` queued events to the buffer; on failure they stay (oldest first). Returns sent."""
    from app.eventing import queue
    with _LOCK:
        batch = [_outbox.popleft() for _ in range(min(limit, len(_outbox)))]
    if not batch:
        return 0
    try:
        queue.publish(namespace(), batch)
    except Exception as exc:  # noqa: BLE001 - keep the batch for the next round
        STATS["send_errors"] += 1
        logger.warning("kh events: %d event(s) not handed over, kept: %s", len(batch), exc)
        with _LOCK:
            _outbox.extendleft(reversed(batch))
        return 0
    STATS["sent"] += len(batch)
    return len(batch)


def pending() -> int:
    return len(_outbox)


def _run() -> None:
    while not _stop.wait(1.0):
        while flush() == 500:
            pass


def _ensure_thread() -> None:
    global _thread
    if _thread is None:
        with _LOCK:
            if _thread is None:
                _thread = threading.Thread(target=_run, name="kh-events-flusher", daemon=True)
                _thread.start()


def shutdown(deadline_s: float = 5.0) -> None:
    """Hand what is left to the buffer before the process ends."""
    _stop.set()
    end = time.monotonic() + deadline_s
    while _outbox and time.monotonic() < end:
        if flush() == 0:
            break


def attach(app) -> None:
    """GET /events and /events:stats (maintainers): KH's own events from the store. The store is prepared even
    when KH_EVENTS is off, so the routes answer (empty) everywhere."""
    import asyncio
    import atexit

    from app.eventing.store import get_store

    try:
        get_store().init()
    except Exception:  # noqa: BLE001 - the routes then answer 503; KH itself keeps working
        logger.exception("kh events: store init failed")
    atexit.register(shutdown)
    TAG = ["Events"]
    GROUPS = {"kind", "project", "session_id", "ix_s1", "ix_s2"}

    @app.get("/events", tags=TAG, summary="KH's own events, oldest first after a cursor (maintainers)")
    async def kh_events(after_seq: int = 0, kind: str = "", session: str = "", project: str = "", limit: int = 100):
        """kind: comma list (kh.api.call, kh.session.turn, kh.message.sent, kh.message.delivered,
        kh.worklog.stored); session: an X-KH-Actor id."""
        rows = await asyncio.to_thread(get_store().read, namespace(), after_seq, [k for k in kind.split(",") if k],
                                       [], {"session_id": session or None, "project": project or None},
                                       max(1, min(limit, 1000)))
        return {"events": rows, "next_after_seq": rows[-1]["seq"] if rows else after_seq,
                "enabled": enabled(), "pending": pending(), **{f"emit_{k}": v for k, v in STATS.items()}}

    @app.get("/events:stats", tags=TAG, summary="Counts of KH's own events (maintainers)")
    async def kh_events_stats(group_by: str = "kind", since: int | None = None):
        groups = [g for g in group_by.split(",") if g]
        if not groups or any(g not in GROUPS for g in groups):
            from fastapi import HTTPException
            raise HTTPException(400, f"group_by: 1-4 of {sorted(GROUPS)}")
        return {"groups": await asyncio.to_thread(get_store().stats, namespace(), groups[:4], since, [])}


class ApiCallMiddleware:
    """Times each request and emits kh.api.call with the caller, session, status and latency. Must run inside the
    auth middleware (it reads the principal)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not enabled() or scope["path"].startswith(SKIP_PATHS):
            return await self.app(scope, receive, send)
        start = time.perf_counter()
        status = {"code": 500}

        async def capture(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, capture)
        finally:
            ms = round((time.perf_counter() - start) * 1000, 1)
            body = {"method": scope["method"], "path": scope["path"][:256], "status": status["code"], "ms": ms}
            qs = (scope.get("query_string") or b"").decode("latin-1")
            if "hook_type=" in qs:
                body["hook_type"] = qs.split("hook_type=", 1)[1].split("&", 1)[0][:64]
            emit("kh.api.call", body, ix2=body["path"], n1=ms)
