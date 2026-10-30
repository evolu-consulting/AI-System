"""
KH embed service: the embedding model in its own process, so KH instances can run without it.

    python -m app.embed_server --port 8010 [--host 0.0.0.0]

Same codebase and same model as KH (KH_EMBEDDING_MODEL, KH_MODEL_DIR), loaded once. KH switches to it with
KH_EMBEDDER=remote|auto + KH_EMBED_URL + KH_EMBED_TOKEN (app/embeddings/remote.py).

ROUTES
  GET  /health        {"ok": true, "model"}                       (no token; for the platform health check)
  GET  /embed/info    {"model", "dim", "emb_ver", "query_instruction", "max_texts", "max_chars"}
  POST /embed         {"texts": [...], "kind": "passage"|"query", "normalize": true}
                      -> {"vectors": [[...]], "model", "dim"}
  Both /embed routes need "Authorization: Bearer <KH_EMBED_TOKEN>" (constant-time compare).

MICRO-BATCHING. Requests that arrive within KH_EMBED_BATCH_WINDOW_MS (default 5 ms) are encoded together, up to
KH_EMBED_MAX_BATCH texts per forward pass: one pass over 32 short texts costs ~4-8 ms per text against
15-40 ms for 32 separate passes (measured 2026-10-11 on bge-small, CPU). One encoder thread runs at a time
so torch threads (KH_EMBED_THREADS) are not oversubscribed.

KIND. "passage" encodes the texts as they are (what KH's .encode() does everywhere); "query" prepends the
model's query instruction first (what the local adapter's encode_query() does). The asymmetry stays where it
was.

LIMITS. KH_EMBED_MAX_TEXTS texts per request, KH_EMBED_MAX_BODY bytes per body, and each text is cut at
KH_EMBED_MAX_CHARS characters - above anything 512 tokens can cover, so the cut never changes a vector.

TOKEN. The service refuses to start without KH_EMBED_TOKEN, unless KH_EMBED_ALLOW_NO_TOKEN=true AND it binds
to a loopback address (local development only).
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import logging
import os
import sys
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import config

logger = logging.getLogger("kh.embed_server")

LOOPBACK = {"127.0.0.1", "localhost", "::1"}


class Batcher:
    """Groups concurrent embed requests into shared forward passes."""

    def __init__(self, adapter: Any, window_ms: float, max_batch: int) -> None:
        self.adapter = adapter
        self.window_s = max(0.0, window_ms) / 1000.0
        self.max_batch = max(1, max_batch)
        self.queue: asyncio.Queue | None = None
        self.task: asyncio.Task | None = None
        self.passes = 0                          # forward passes run (observable in tests)

    def start(self) -> None:
        self.queue = asyncio.Queue()
        self.task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def submit(self, texts: list[str], normalize: bool) -> list:
        fut = asyncio.get_running_loop().create_future()
        await self.queue.put((texts, normalize, fut))
        return await fut

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            first = await self.queue.get()
            items = [first]
            n = len(first[0])
            deadline = loop.time() + self.window_s
            while n < self.max_batch:
                left = deadline - loop.time()
                if left <= 0:
                    break
                try:
                    nxt = await asyncio.wait_for(self.queue.get(), left)
                except asyncio.TimeoutError:
                    break
                items.append(nxt)
                n += len(nxt[0])
            # one pass per normalize flag (in practice always true)
            for norm in {it[1] for it in items}:
                group = [it for it in items if it[1] == norm]
                flat = [t for it in group for t in it[0]]
                try:
                    vecs = await asyncio.to_thread(self._encode, flat, norm)
                except Exception as e:   # noqa: BLE001 - every waiter gets the error
                    for it in group:
                        if not it[2].done():
                            it[2].set_exception(e)
                    continue
                i = 0
                for texts, _, fut in group:
                    if not fut.done():
                        fut.set_result(vecs[i:i + len(texts)])
                    i += len(texts)

    def _encode(self, texts: list[str], normalize: bool) -> list:
        self.passes += 1
        arr = self.adapter.encode(texts, normalize_embeddings=normalize, batch_size=self.max_batch,
                                  show_progress_bar=False)
        return [[float(x) for x in row] for row in arr]


def create_app(adapter: Any = None, *, token: str | None = None, window_ms: float | None = None,
               max_batch: int | None = None, max_texts: int | None = None, max_chars: int | None = None,
               max_body: int | None = None):
    """The FastAPI app. `adapter` defaults to the local model (loaded at startup); tests pass a fake."""
    from contextlib import asynccontextmanager

    token = config.EMBED_TOKEN if token is None else token
    max_texts = config.EMBED_MAX_TEXTS if max_texts is None else max_texts
    max_chars = config.EMBED_MAX_CHARS if max_chars is None else max_chars
    max_body = config.EMBED_MAX_BODY if max_body is None else max_body
    state: dict = {"adapter": adapter}

    @asynccontextmanager
    async def lifespan(app):
        if state["adapter"] is None:
            from .embeddings import get_local_embedder
            if config.EMBED_THREADS > 0:
                import torch
                torch.set_num_threads(config.EMBED_THREADS)
            state["adapter"] = get_local_embedder().load()
            logger.info("embed service: model %s loaded (dim %s)", state["adapter"].name, state["adapter"].dim)
        b = Batcher(state["adapter"], config.EMBED_BATCH_WINDOW_MS if window_ms is None else window_ms,
                    config.EMBED_MAX_BATCH if max_batch is None else max_batch)
        b.start()
        state["batcher"] = b
        app.state.batcher = b
        yield
        await b.stop()

    app = FastAPI(title="KH embed service", lifespan=lifespan, docs_url=None, redoc_url=None)

    def _err(status: int, code: str, detail: str):
        return JSONResponse({"error": code, "detail": detail}, status_code=status)

    def _authorized(request: Request) -> bool:
        if not token:
            return True
        got = request.headers.get("authorization", "")
        return hmac.compare_digest(got.encode("utf-8"), ("Bearer " + token).encode("utf-8"))

    def _info() -> dict:
        a = state["adapter"]
        return {"model": a.name, "dim": a.dim, "emb_ver": os.getenv("KH_EMB_VER", ""),
                "query_instruction": getattr(a, "query_instruction", None),
                "max_texts": max_texts, "max_chars": max_chars}

    @app.get("/health")
    async def health():
        return {"ok": True, "model": getattr(state["adapter"], "name", None)}

    @app.get("/embed/info")
    async def info(request: Request):
        if not _authorized(request):
            return _err(401, "unauthorized", "bearer token required")
        return _info()

    @app.post("/embed")
    async def embed(request: Request):
        if not _authorized(request):
            return _err(401, "unauthorized", "bearer token required")
        size = request.headers.get("content-length")
        if size and size.isdigit() and int(size) > max_body:
            return _err(413, "too_large", f"body over {max_body} bytes")
        raw = await request.body()
        if len(raw) > max_body:
            return _err(413, "too_large", f"body over {max_body} bytes")
        try:
            import json
            body = json.loads(raw or b"{}")
        except ValueError:
            return _err(400, "invalid", "body is not JSON")
        texts = body.get("texts") if isinstance(body, dict) else None
        kind = (body.get("kind") or "passage") if isinstance(body, dict) else "passage"
        normalize = bool(body.get("normalize", True)) if isinstance(body, dict) else True
        if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
            return _err(400, "invalid", "texts must be a list of strings")
        if len(texts) > max_texts:
            return _err(413, "too_many", f"at most {max_texts} texts per request")
        if kind not in ("passage", "query"):
            return _err(400, "invalid", "kind is passage or query")
        if not texts:
            return {"vectors": [], "model": state["adapter"].name, "dim": state["adapter"].dim}
        texts = [t[:max_chars] for t in texts]
        qi = getattr(state["adapter"], "query_instruction", None)
        if kind == "query" and qi:
            texts = [qi + t for t in texts]
        vecs = await state["batcher"].submit(texts, normalize)
        return {"vectors": vecs, "model": state["adapter"].name, "dim": state["adapter"].dim}

    return app


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.embed_server", description="KH embed service")
    ap.add_argument("--host", default=os.getenv("KH_EMBED_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.getenv("PORT") or os.getenv("KH_EMBED_PORT") or "8010"))
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
    if not config.EMBED_TOKEN:
        if not (config.EMBED_ALLOW_NO_TOKEN and a.host in LOOPBACK):
            print("refusing to start: set KH_EMBED_TOKEN (or KH_EMBED_ALLOW_NO_TOKEN=true with a loopback --host "
                  "for local development)", file=sys.stderr)
            return 2
        logger.warning("embed service running WITHOUT a token on %s (local development only)", a.host)
    import uvicorn
    uvicorn.run(create_app(), host=a.host, port=a.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
