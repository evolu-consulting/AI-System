"""
Embedding-model abstraction.

The rest of KnowledgeHub only ever needs three things from "the model":
  - encode(texts)        → document/passage vectors (what everything stores)
  - encode_query(text)   → a query vector (may carry a model-specific instruction)
  - name / dim           → identity + dimensionality

Concrete models live behind an EmbeddingAdapter so that switching the embedding
model is "write a new adapter (or spec) and register it" — NOT a hunt-and-replace
across chunker/extractor/retriever/orchestrator/taxonomy. Call sites keep calling
`.encode(...)`; only the registry entry changes.

Duck-compatibility: `.encode(...)` mirrors SentenceTransformer.encode (same kwargs,
returns the same ndarray) so an adapter can be dropped in wherever the raw model
used to be (e.g. app.state.model) with zero changes at the call site.
"""
from __future__ import annotations

from abc import ABC, abstractmethod


class EmbeddingAdapter(ABC):
    #: registry key / model name (also the models/<name> cache dir)
    name: str = ""
    #: embedding dimensionality (filled in after load if not known up front)
    dim: int | None = None
    #: optional instruction prepended to QUERIES only (asymmetric retrieval models
    #: like bge want this; symmetric models leave it None)
    query_instruction: str | None = None

    @abstractmethod
    def load(self) -> "EmbeddingAdapter":
        """Load (download+cache on first use) the underlying model. Returns self."""

    @abstractmethod
    def encode(self, sentences, normalize_embeddings: bool = True, **kwargs):
        """Encode passage(s)/document(s). Signature mirrors SentenceTransformer.encode
        and returns the same type (ndarray for a list, 1-D ndarray for a str)."""

    def encode_query(self, text: str) -> list[float]:
        """Encode a search QUERY, applying `query_instruction` when the model defines
        one. Returns a plain list[float]. Symmetric models fall back to encode()."""
        payload = f"{self.query_instruction}{text}" if self.query_instruction else text
        vec = self.encode(payload, normalize_embeddings=True)
        return vec.tolist() if hasattr(vec, "tolist") else list(vec)

    @property
    def dimension(self) -> int | None:
        return self.dim

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"<{type(self).__name__} name={self.name!r} dim={self.dim}>"
