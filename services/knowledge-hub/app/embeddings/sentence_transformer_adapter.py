"""
SentenceTransformer-backed embedding adapter.

Covers the whole SentenceTransformer model family (MiniLM, bge, e5, gte, ...) —
they differ only by (hf_id, query_instruction, dim), so a single parameterised
adapter serves them all; the registry supplies the spec. A model that needs a
fundamentally different runtime (ONNX, a remote API, ...) gets its OWN
EmbeddingAdapter subclass instead — that is the "write a new adapter" path.
"""
from __future__ import annotations

import logging

from ..config import resolve_model_dir
from .base import EmbeddingAdapter

logger = logging.getLogger(__name__)


class SentenceTransformerAdapter(EmbeddingAdapter):
    def __init__(
        self,
        name: str,
        hf_id: str | None = None,
        query_instruction: str | None = None,
        dim: int | None = None,
    ) -> None:
        self.name = name
        self.hf_id = hf_id or name          # download id (may differ from cache name)
        self.query_instruction = query_instruction
        self.dim = dim
        self._model = None
        # Resolved through config, NOT from __file__: in a frozen build the
        # weights are seeded beside the service dir, not into the bundle.
        self._dir = resolve_model_dir(name)
        # Sentinel written by SentenceTransformer.save() — confirms a complete cache.
        self._sentinel = self._dir / "config_sentence_transformers.json"

    def load(self) -> "SentenceTransformerAdapter":
        from sentence_transformers import SentenceTransformer  # lazy: heavy import

        if self._sentinel.exists():
            logger.info("Embedding model '%s' loading from local cache: %s", self.name, self._dir)
            self._model = SentenceTransformer(str(self._dir))
        else:
            logger.info("Embedding model '%s' not cached — downloading '%s' then saving to %s",
                        self.name, self.hf_id, self._dir)
            self._dir.mkdir(parents=True, exist_ok=True)
            self._model = SentenceTransformer(self.hf_id)
            self._model.save(str(self._dir))

        if self.dim is None:
            try:
                self.dim = int(self._model.get_sentence_embedding_dimension())
            except Exception:  # pragma: no cover - best effort
                pass
        return self

    def encode(self, sentences, normalize_embeddings: bool = True, **kwargs):
        if self._model is None:
            self.load()
        return self._model.encode(sentences, normalize_embeddings=normalize_embeddings, **kwargs)

    # kept so callers that used to hold a raw SentenceTransformer (which exposes
    # .save) remain drop-in compatible.
    def save(self, path) -> None:
        if self._model is not None:
            self._model.save(str(path))
