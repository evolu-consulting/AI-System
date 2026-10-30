"""kh-events: the sidecar instance that takes KH's events and writes them to the EventStore (fen 2026-10-24).

    python -m app.eventing.sidecar                       # PORT (CF) or KH_EVENTS_PORT, default 8090

  POST /queue/publish  {events: [{ns, row}]}  bearer KH_EVENTS_TOKEN; 202 {accepted} or 503 + Retry-After when full
  GET  /queue/stats    bearer KH_EVENTS_TOKEN; depth, accepted, written, refused, write errors
  GET  /health         no sign-in

The queue is app/eventing/queue.py MemoryQueue (KH_EVENTS_QUEUE_MAX, default 50000; batches of
KH_EVENTS_BATCH_MAX, default 500, at least every KH_EVENTS_FLUSH_S, default 1 s), the store app/eventing/store.py
(KH_EVENT_STORE, default sql: the same HANA schema as KH, bound to this app). A graceful stop drains the queue.
It shares KH's code, staged by deploy/btp/push.ps1 into the same build folder; deploy/btp/kh-events/manifest.yml.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.eventing import queue as q

logger = logging.getLogger("kh_events")
PUBLISH_MAX = 2000


def _vcap_secret(name: str) -> str:
    """A credential of a bound user-provided service (CF puts those in VCAP_SERVICES, not in the environment)."""
    import json
    try:
        services = json.loads(os.getenv("VCAP_SERVICES") or "{}")
    except ValueError:
        return ""
    for inst in services.get("user-provided", []) or []:
        value = (inst.get("credentials") or {}).get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def create_app(token: str | None = None, mq: q.MemoryQueue | None = None) -> FastAPI:
    token = token if token is not None else ((os.getenv("KH_EVENTS_TOKEN") or "").strip()
                                             or _vcap_secret("KH_EVENTS_TOKEN"))
    if not token:
        raise RuntimeError("KH_EVENTS_TOKEN is required: the sidecar takes events only from KH")
    mq = mq or q.MemoryQueue(max_events=int(os.getenv("KH_EVENTS_QUEUE_MAX") or 50000),
                             batch_max=int(os.getenv("KH_EVENTS_BATCH_MAX") or 500),
                             flush_s=float(os.getenv("KH_EVENTS_FLUSH_S") or 1.0))
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(_app):
        mq.store().init()
        mq.start()
        logger.info("kh-events up: store=%s queue max=%d batch=%d", mq.store().name, mq.max_events, mq.batch_max)
        yield
        left = mq.stop()
        logger.info("kh-events stopping: drained %d event(s), %d left", left, mq.depth())

    app = FastAPI(title="kh-events", lifespan=lifespan)
    app.state.queue = mq

    def _denied(request: Request):
        if not q.token_ok(request.headers.get("authorization", ""), token):
            return JSONResponse({"detail": "a valid bearer token is required"}, status_code=401)
        return None

    @app.get("/health")
    async def health():
        return {"status": "ok", "depth": mq.depth()}

    @app.post("/queue/publish")
    async def publish(request: Request):
        denied = _denied(request)
        if denied:
            return denied
        try:
            body = await request.json()
        except ValueError:
            return JSONResponse({"detail": "body must be JSON"}, status_code=400)
        events = body.get("events") if isinstance(body, dict) else None
        if not isinstance(events, list) or not events or len(events) > PUBLISH_MAX:
            return JSONResponse({"detail": f"events: a list of 1-{PUBLISH_MAX} {{ns, row}}"}, status_code=400)
        by_ns: dict[str, list[dict]] = {}
        for ev in events:
            ns, row = (ev or {}).get("ns"), (ev or {}).get("row")
            if not isinstance(ns, str) or not ns or not isinstance(row, dict) or not row.get("id") or not row.get("kind"):
                return JSONResponse({"detail": "each event needs ns and a row with id and kind"}, status_code=400)
            by_ns.setdefault(ns, []).append(row)
        try:
            if mq.depth() + len(events) > mq.max_events:
                raise q.QueueFull("full")
            for ns, rows in by_ns.items():
                mq.publish(ns, rows)
        except q.QueueFull:
            return JSONResponse({"detail": "the event queue is full; retry"}, status_code=503,
                                headers={"Retry-After": "5"})
        return JSONResponse({"accepted": len(events), "depth": mq.depth()}, status_code=202)

    @app.get("/queue/stats")
    async def stats(request: Request):
        denied = _denied(request)
        if denied:
            return denied
        return {"depth": mq.depth(), "max": mq.max_events, "store": mq.store().name, **mq.stats}

    return app


def main() -> None:
    import uvicorn
    logging.basicConfig(level=os.environ.get("KH_EVENTS_LOG", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    port = int(os.getenv("PORT") or os.getenv("KH_EVENTS_PORT") or 8090)
    uvicorn.run(create_app(), host="0.0.0.0", port=port, timeout_graceful_shutdown=8)


if __name__ == "__main__":
    main()
