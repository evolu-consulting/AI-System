"""Entity embedding helper (v6+: NO local LLM).

The old ATTR/LLMHub extraction pipeline was removed — per v6+, Claude Code is the
sole reasoning layer, so KH does not call any local LLM (Ollama/LLMHub). This module
now holds only the pure-embedding helper used by the structured graph-add endpoint.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:                       # annotation only — never imported at runtime
    from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


def embed_entities(
    entities: list[dict],
    model: "SentenceTransformer",
) -> list[tuple[str, list[float]]]:
    """
    Generate a normalised embedding for each entity using its source_text.

    Encoding strategy: embed source_text (the exact phrase that describes this
    entity) so retrieval can resolve a mention to a stored core_id by semantic
    similarity. Falls back to the entity label if source_text is missing.

    Returns a list of (core_id, vector) pairs in the same order as `entities`.
    """
    def _embed_text(e: dict) -> str:
        src = (e.get("source_text") or "").strip()
        if src:
            return src
        fallback = e.get("label") or e.get("core_id", "")
        logger.warning(
            "embed_entities: source_text missing for %r — embedding label as fallback", fallback
        )
        return fallback

    texts = [_embed_text(e) for e in entities]
    vectors = model.encode(
        texts,
        normalize_embeddings=True,
        batch_size=64,
        show_progress_bar=False,
    )
    return [(entities[i]["core_id"], vectors[i].tolist()) for i in range(len(entities))]
