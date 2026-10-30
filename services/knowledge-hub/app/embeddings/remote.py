"""
Embeddings computed by a separate embed service (app/embed_server.py), switched by KH_EMBEDDER.

WHY. The embedder is the CPU-heavy part of KH (a ~512-token passage takes 75-300 ms of CPU). Scaling
plan (docs/multi-agent-instance-design.md 2.5): when the embedder passes 50% of an instance's CPU, move
it to its own app. This module is the KH side of that move; nothing else in KH changes, because the
adapters below are drop-ins for the local SentenceTransformerAdapter:

  - encode(sentences, normalize_embeddings=True, **kwargs) returns the same ndarray shapes
    (a str gives a 1-D vector, a list gives a 2-D array; float32). Extra SentenceTransformer kwargs
    (batch_size, show_progress_bar, ...) are accepted and ignored.
  - encode_query(text) sends kind=query, so the SERVICE applies the model's query instruction - the
    same asymmetry as the local adapter.

MODES (config.EMBEDDER)
  local  - unchanged: the registry returns the local adapter.
  remote - RemoteEmbeddingAdapter only; no model in this process. A service that cannot be reached
           raises EmbedderUnavailable, which the app answers with 503 embedder_unavailable.
  auto   - AutoEmbeddingAdapter: the service first; on a failure the local model is loaded (once, lazily)
           and the call is answered locally. After EMBED_FAIL_THRESHOLD failures in a row the breaker
           opens and every call stays local for EMBED_COOLDOWN_S, then one call probes the service again.

HANDSHAKE. load() reads GET {url}/embed/info and refuses to start when the service runs another model or
dimension than KH_EMBEDDING_MODEL / the registered dimension: vectors from two models are not comparable,
and mixing them would silently break every search. That refusal is a configuration error, not an outage,
so auto mode refuses too.
"""
from __future__ import annotations

import logging
import random
import threading
import time
from typing import Callable

import numpy as np

from .. import config
from .base import EmbeddingAdapter

logger = logging.getLogger(__name__)

_RETRY_STATUS = {429, 500, 502, 503, 504}


class EmbedderUnavailable(RuntimeError):
    """The embed service cannot answer (down, timing out, overloaded after retries)."""


class EmbedderMismatch(RuntimeError):
    """The embed service runs another model or dimension than this KH stores."""


def _as_array(vectors: list, single: bool) -> np.ndarray:
    arr = np.asarray(vectors, dtype=np.float32)
    return arr[0] if single else arr


class RemoteEmbeddingAdapter(EmbeddingAdapter):
    """Vectors from the embed service over HTTP (bearer token, batching, retries)."""

    def __init__(self, url: str | None = None, token: str | None = None, *, name: str | None = None,
                 dim: int | None = None, timeout_s: float | None = None, batch_max: int | None = None,
                 retries: int | None = None, session_factory: Callable | None = None) -> None:
        self.url = (url if url is not None else config.EMBED_URL).rstrip("/")
        if not self.url:
            raise ValueError("KH_EMBEDDER=remote/auto needs KH_EMBED_URL (the embed service base URL)")
        self._token = token if token is not None else config.EMBED_TOKEN
        self.name = name or config.EMBEDDING_MODEL
        self.dim = dim                           # expected dimension (from the registry); checked at load()
        self.timeout_s = timeout_s if timeout_s is not None else config.EMBED_TIMEOUT_S
        self.batch_max = max(1, batch_max if batch_max is not None else config.EMBED_BATCH_MAX)
        self.retries = max(0, retries if retries is not None else config.EMBED_RETRIES)
        self.query_instruction = None            # applied by the service (kind=query)
        self.info: dict = {}
        self._checked = False                    # handshake done (model + dim verified)
        self._local = threading.local()
        self._session_factory = session_factory

    def __repr__(self) -> str:                   # never shows the token
        return f"<RemoteEmbeddingAdapter url={self.url!r} name={self.name!r} dim={self.dim}>"

    # ── transport ────────────────────────────────────────────────────────────────────────────────
    def _session(self):
        s = getattr(self._local, "s", None)
        if s is None:
            if self._session_factory:
                s = self._session_factory()
            else:
                import requests
                s = requests.Session()
            self._local.s = s
        return s

    def _headers(self) -> dict:
        h = {"Accept": "application/json"}
        if self._token:
            h["Authorization"] = "Bearer " + self._token
        return h

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        """One request with retries on 429 / 5xx / timeouts / connection errors. Embedding is idempotent,
        so a retry can never double anything."""
        last = ""
        for attempt in range(self.retries + 1):
            try:
                r = self._session().request(method, self.url + path, json=body, headers=self._headers(),
                                            timeout=self.timeout_s)
            except Exception as e:   # noqa: BLE001 - requests raises many types; all mean "not reached"
                last = f"{type(e).__name__}: {e}"
            else:
                if r.status_code == 200:
                    return r.json()
                last = f"HTTP {r.status_code}: {(r.text or '')[:200]}"
                if r.status_code not in _RETRY_STATUS:
                    if r.status_code in (401, 403):
                        raise EmbedderUnavailable(f"embed service refused the token ({r.status_code})")
                    raise ValueError(f"embed service rejected the request: {last}")
                ra = r.headers.get("Retry-After") if hasattr(r, "headers") else None
                if ra:
                    try:
                        time.sleep(min(float(ra), 2.0))
                        continue
                    except ValueError:
                        pass
            if attempt < self.retries:
                time.sleep(min(0.2 * (2 ** attempt), 2.0) * (0.5 + random.random()))
        raise EmbedderUnavailable(f"embed service {self.url} not available: {last}")

    # ── adapter ──────────────────────────────────────────────────────────────────────────────────
    def load(self, strict: bool = False) -> "RemoteEmbeddingAdapter":
        """Handshake with the service. A service that is DOWN does not stop KH (strict=False): the
        handshake is retried before the first vector, and until then routes answer 503. A service that
        runs ANOTHER model or dimension always stops KH (EmbedderMismatch)."""
        try:
            self._handshake()
        except EmbedderUnavailable as e:
            if strict:
                raise
            logger.error("embed service not reachable at startup (%s); routes needing a vector answer 503 "
                         "until it is", e)
        return self

    def _ensure(self) -> None:
        if not self._checked:
            self._handshake()

    def _handshake(self) -> None:
        info = self._call("GET", "/embed/info")
        model, dim = info.get("model"), info.get("dim")
        if model != self.name:
            raise EmbedderMismatch(f"embed service runs model {model!r}, this KH stores {self.name!r} "
                                   "(KH_EMBEDDING_MODEL); vectors would not be comparable")
        if self.dim is not None and dim != self.dim:
            raise EmbedderMismatch(f"embed service gives dimension {dim}, this KH stores {self.dim}")
        self.dim = int(dim) if dim is not None else self.dim
        self.info = info
        self._checked = True
        logger.info("Embeddings from the embed service %s (model %s, dim %s)", self.url, model, self.dim)

    def _vectors(self, texts: list[str], kind: str, normalize: bool) -> list:
        self._ensure()
        out: list = []
        for i in range(0, len(texts), self.batch_max):
            chunk = texts[i:i + self.batch_max]
            res = self._call("POST", "/embed", {"texts": chunk, "kind": kind, "normalize": bool(normalize)})
            vecs = res.get("vectors") or []
            if len(vecs) != len(chunk):
                raise EmbedderUnavailable(f"embed service answered {len(vecs)} vectors for {len(chunk)} texts")
            out.extend(vecs)
        return out

    def encode(self, sentences, normalize_embeddings: bool = True, **kwargs):
        single = isinstance(sentences, str)
        texts = [sentences] if single else [str(s) for s in sentences]
        if not texts:
            return np.zeros((0, self.dim or 0), dtype=np.float32)
        return _as_array(self._vectors(texts, "passage", normalize_embeddings), single)

    def encode_query(self, text: str) -> list[float]:
        return [float(x) for x in self._vectors([text], "query", True)[0]]


class AutoEmbeddingAdapter(EmbeddingAdapter):
    """The embed service with an in-process fallback and a circuit breaker."""

    def __init__(self, remote: RemoteEmbeddingAdapter, local_factory: Callable[[], EmbeddingAdapter], *,
                 fail_threshold: int | None = None, cooldown_s: float | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.remote = remote
        self._local_factory = local_factory
        self._local: EmbeddingAdapter | None = None
        self._lock = threading.Lock()
        self.fail_threshold = max(1, fail_threshold if fail_threshold is not None else config.EMBED_FAIL_THRESHOLD)
        self.cooldown_s = cooldown_s if cooldown_s is not None else config.EMBED_COOLDOWN_S
        self._clock = clock
        self.failures = 0
        self.open_until = 0.0
        self.name = remote.name
        self.dim = remote.dim
        self.query_instruction = None

    def __repr__(self) -> str:
        return f"<AutoEmbeddingAdapter remote={self.remote!r} local_loaded={self._local is not None}>"

    @property
    def local_loaded(self) -> bool:
        return self._local is not None

    def _local_adapter(self) -> EmbeddingAdapter:
        if self._local is None:
            with self._lock:
                if self._local is None:
                    logger.warning("embed service unavailable - loading the embedding model in this process")
                    self._local = self._local_factory().load()
        return self._local

    def _failed(self, err: Exception) -> None:
        with self._lock:
            self.failures += 1
            if self.failures >= self.fail_threshold:
                self.open_until = self._clock() + self.cooldown_s
                logger.warning("embed service failed %d times in a row (%s) - local for %.0f s",
                               self.failures, err, self.cooldown_s)

    def _ok(self) -> None:
        if self.failures or self.open_until:
            with self._lock:
                self.failures, self.open_until = 0, 0.0

    def _route(self, remote_fn: Callable, local_fn: Callable):
        if self.open_until and self._clock() < self.open_until:
            return local_fn(self._local_adapter())
        try:                                     # closed, or half-open after the cooldown: try the service
            out = remote_fn()
        except EmbedderUnavailable as e:
            self._failed(e)
            return local_fn(self._local_adapter())
        self._ok()
        return out

    def load(self) -> "AutoEmbeddingAdapter":
        try:
            self.remote.load(strict=True)        # a model/dim mismatch (EmbedderMismatch) still stops startup
            self.dim = self.remote.dim
        except EmbedderUnavailable as e:
            self._failed(e)
            self.dim = self._local_adapter().dim
        return self

    def encode(self, sentences, normalize_embeddings: bool = True, **kwargs):
        return self._route(lambda: self.remote.encode(sentences, normalize_embeddings=normalize_embeddings),
                           lambda m: m.encode(sentences, normalize_embeddings=normalize_embeddings, **kwargs))

    def encode_query(self, text: str) -> list[float]:
        return self._route(lambda: self.remote.encode_query(text), lambda m: m.encode_query(text))


__all__ = ["RemoteEmbeddingAdapter", "AutoEmbeddingAdapter", "EmbedderUnavailable", "EmbedderMismatch"]
