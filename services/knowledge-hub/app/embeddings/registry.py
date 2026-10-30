"""
Embedding-model registry + factory.

To SWITCH the embedding model: set env KH_EMBEDDING_MODEL to a registered key
(config.EMBEDDING_MODEL) — nothing else in the codebase changes.

To ADD a model:
  - SentenceTransformer-family  → add one line to _REGISTRY (a spec).
  - exotic backend (ONNX/API/…) → write an EmbeddingAdapter subclass and register
    it here (or at runtime via register_model). "New adapter, plug it in."
"""
from __future__ import annotations

from typing import Callable

from .. import config
from .base import EmbeddingAdapter
from .sentence_transformer_adapter import SentenceTransformerAdapter

# key -> zero-arg factory returning an UNLOADED adapter (load() is called by main
# at startup). Factories, not instances, so nothing heavy is constructed on import.
_REGISTRY: dict[str, Callable[[], EmbeddingAdapter]] = {
    # Active default (KH is English per hook; MiniLM removed 2026-08-18).
    # English-only, lighter/faster cold start. Asymmetric: queries get an
    # instruction prefix; documents do not (bge convention).
    "bge-small-en-v1.5": lambda: SentenceTransformerAdapter(
        "bge-small-en-v1.5",
        hf_id="BAAI/bge-small-en-v1.5",
        query_instruction="Represent this sentence for searching relevant passages: ",
        dim=384,
    ),
}


def register_model(key: str, factory: Callable[[], EmbeddingAdapter]) -> None:
    """Plug a new model in at runtime without editing this file."""
    _REGISTRY[key] = factory


def available_models() -> list[str]:
    return sorted(_REGISTRY)


def get_local_embedder(name: str | None = None) -> EmbeddingAdapter:
    """The (unloaded) in-process adapter for `name` (default: config.EMBEDDING_MODEL).

    An unregistered key is treated as a plain SentenceTransformer id — most HF
    models work out of the box; only custom behaviour needs a dedicated entry.
    """
    key = name or config.EMBEDDING_MODEL
    factory = _REGISTRY.get(key)
    if factory is None:
        return SentenceTransformerAdapter(key)
    return factory()


def get_embedder(name: str | None = None, mode: str | None = None) -> EmbeddingAdapter:
    """Return the (unloaded) adapter KH should use, following KH_EMBEDDER (config.EMBEDDER):

    local  (default) - the in-process adapter, exactly as before;
    remote           - the embed service (app/embed_server.py) only, no model in this process;
    auto             - the embed service, falling back to the in-process model when it fails.
    """
    mode = (mode or config.EMBEDDER or "local").lower()
    if mode == "local":
        return get_local_embedder(name)
    from .remote import AutoEmbeddingAdapter, RemoteEmbeddingAdapter
    spec = get_local_embedder(name)              # cheap: nothing is loaded until load()
    remote = RemoteEmbeddingAdapter(name=spec.name, dim=spec.dim)
    if mode == "remote":
        return remote
    if mode == "auto":
        return AutoEmbeddingAdapter(remote, lambda: get_local_embedder(name))
    raise ValueError(f"KH_EMBEDDER={mode!r} is not one of local, remote, auto")
