from __future__ import annotations

import nltk
import numpy as np

from .config import EMBEDDING_MODEL as MODEL_NAME, resolve_model_dir

# Cache dir for the active model (kept for external reference / back-compat).
# Resolved through config so it can never drift from what the embedding adapter
# actually loads — see config.resolve_model_dir.
MODEL_DIR = resolve_model_dir(MODEL_NAME)


def load_model():
    """
    Return the active embedding model as an EmbeddingAdapter (duck-compatible with
    SentenceTransformer: exposes .encode(...) so it drops into app.state.model).

    Which model is active is decided by the embeddings registry (env
    KH_EMBEDDING_MODEL). Switching models = register an adapter, not edit call sites.
    NLTK punkt data is ensured here so startup stays self-contained.
    """
    from .embeddings import get_embedder  # lazy: pulls sentence_transformers

    for resource in ("punkt", "punkt_tab"):
        nltk.download(resource, quiet=True)

    return get_embedder().load()


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    # Embeddings are L2-normalised by encode(), so dot product == cosine similarity.
    # The epsilon guard handles the degenerate all-zero vector case.
    denom = np.linalg.norm(a) * np.linalg.norm(b) + 1e-10
    return float(np.dot(a, b) / denom)


def semantic_chunk(
    text: str,
    model: SentenceTransformer,
    c: float = 1.0,
) -> list[dict]:
    """
    Split *text* into semantically coherent chunks.

    Algorithm
    ---------
    1. Tokenise into sentences.
    2. Embed every sentence.
    3. Compute cosine similarity for each adjacent pair.
    4. Derive a dynamic cutoff:  cutoff = μ − c·σ
    5. Insert a boundary wherever similarity < cutoff.
    6. Concatenate sentences inside each boundary and re-embed the full chunk.

    Returns a list of {"chunk_text": str, "embedding": list[float]}.
    """
    sentences: list[str] = nltk.sent_tokenize(text)
    if not sentences:
        return []

    # Fast path: single sentence needs no boundary detection.
    if len(sentences) == 1:
        embedding = model.encode(sentences[0], normalize_embeddings=True)
        return [{"chunk_text": sentences[0], "embedding": embedding.tolist()}]

    # Encode all sentences in one batched forward pass.
    sent_embeddings: np.ndarray = model.encode(
        sentences,
        normalize_embeddings=True,
        batch_size=64,
        show_progress_bar=False,
    )

    # Pairwise cosine similarity between sentence_i and sentence_{i+1}.
    similarities = np.array([
        _cosine_similarity(sent_embeddings[i], sent_embeddings[i + 1])
        for i in range(len(sentences) - 1)
    ])

    # Dynamic threshold — boundaries sit c standard deviations below the mean.
    cutoff: float = float(similarities.mean() - c * similarities.std())

    # Indices where a new chunk begins (i+1 because similarity[i] guards the gap
    # between sentence[i] and sentence[i+1]).
    split_starts: set[int] = {
        i + 1 for i, sim in enumerate(similarities) if sim < cutoff
    }

    # Group sentences by chunk.
    chunks: list[list[str]] = []
    current: list[str] = []
    for idx, sentence in enumerate(sentences):
        if idx in split_starts and current:
            chunks.append(current)
            current = []
        current.append(sentence)
    if current:
        chunks.append(current)

    # Build final output: one embedding per aggregated chunk.
    results: list[dict] = []
    chunk_texts = [" ".join(chunk) for chunk in chunks]
    chunk_embeddings: np.ndarray = model.encode(
        chunk_texts,
        normalize_embeddings=True,
        batch_size=64,
        show_progress_bar=False,
    )
    for text_item, emb in zip(chunk_texts, chunk_embeddings):
        results.append({"chunk_text": text_item, "embedding": emb.tolist()})

    return results
