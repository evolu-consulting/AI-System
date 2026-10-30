"""Embedding-model abstraction — swap models by registering an adapter, not by
editing call sites. See base.EmbeddingAdapter + registry.get_embedder.

Where vectors are computed is a separate switch, KH_EMBEDDER = local | remote | auto: remote/auto send
the texts to the embed service (app/embed_server.py) through remote.RemoteEmbeddingAdapter /
remote.AutoEmbeddingAdapter, which are drop-ins for the local adapter."""
from .base import EmbeddingAdapter
from .sentence_transformer_adapter import SentenceTransformerAdapter
from .registry import get_embedder, get_local_embedder, register_model, available_models

__all__ = [
    "EmbeddingAdapter",
    "SentenceTransformerAdapter",
    "get_embedder",
    "get_local_embedder",
    "register_model",
    "available_models",
]
