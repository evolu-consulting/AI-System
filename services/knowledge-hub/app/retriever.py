"""Retrieval — quick-knowledge vector search + structured graph fetch.

v6+: NO local LLM. Claude Code is the sole reasoning layer, so the old LLMHub/Ollama
entity-extraction / answer-synthesis pipelines (run_query_pipeline / run_ask_pipeline)
were removed. What remains is pure, deterministic retrieval:
  - query_quick_knowledge : cosine search over quick-knowledge vectors (scope/partition aware)
  - fetch_graph           : ontology-expanded multi-hop node/edge fetch by core_id
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import TYPE_CHECKING

from .config import ONTOLOGY_HOPS, CLIP_HEAD_CHARS, CHUNK_WORD_THRESHOLD as _LONG_TEXT_WORD_THRESHOLD
from .graph_db import graph_db
from .vector_store import query_vt, get_ids_vt as vs_get_ids

if TYPE_CHECKING:                       # annotation only — never imported at runtime
    from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

# Edge labels that form the ontology hierarchy (child → parent). When querying a
# PARENT concept, these are traversed in reverse to discover children.
HIERARCHY_EDGES: frozenset[str] = frozenset({
    "IS_PART_OF", "BELONGS_TO", "SUBCLASS_OF", "PART_OF", "SUBCATEGORY_OF",
})


# ---------------------------------------------------------------------------
# Quick-knowledge vector search  (/vector/query) — no LLM, no graph DB
# ---------------------------------------------------------------------------

def _build_quick_where(scope: str | None = None, where: dict | None = None) -> dict:
    """Combine the base quick-knowledge filter with an optional scope namespace and an
    optional caller metadata pre-filter (partition routing), ANDed together for Chroma."""
    clauses: list[dict] = [{"knowledge_type": {"$eq": "quick"}}]
    if scope:
        clauses.append({"scope": {"$eq": scope}})
    if where:
        clauses.append(where)
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def _quick_collections(scope: str | None, project: str | None) -> list:
    """Collections a quick-knowledge query should search (B4 per-project isolation).

    A ``None`` entry = the shared legacy collection. Isolated scopes fan out across
    every project's own collection (or one, if ``project`` is given) plus the shared
    store so un-migrated rows stay visible; unscoped queries keep the shared store.
    """
    from . import vector_store as vs
    common = ("personalization", "kh-meta", "self-info")
    if not scope:
        return [None]
    from . import personal
    project = personal.target(scope, project)
    if personal.is_personal(project):
        return [vs.scope_collection(scope, project)]
    if scope in common:
        return [vs.scope_collection(scope, None), None]
    if project:
        return [vs.scope_collection(scope, project)]
    return vs.scope_collections_all(scope) + [None]


def _query_quick_knowledge_sync(
    text: str,
    k: int,
    model: "SentenceTransformer",
    scope: str | None = None,
    where: dict | None = None,
    project: str | None = None,
) -> list[dict]:
    """Pure vector search over quick-knowledge entries. Long text (> threshold) is
    semantic-chunked and results are merged by best score per vector_id."""
    from .chunker import semantic_chunk

    where_filter = _build_quick_where(scope, where)
    # One lane per collection, each with its own filter. The hot log window is a
    # shared partition, so its lane is narrowed to the named project; without this
    # lane a semantic search over scope=log would silently miss everything recent.
    lanes: list[tuple] = [(coll, where_filter) for coll in _quick_collections(scope, project)]
    from . import hotlog
    hot = hotlog.read_lane(scope, project, where_filter)
    if hot is not None:
        lanes.append(hot)
    # Chunk sidecars (app/chunks.py): the tail of a long row, searched alongside the rows.
    from . import chunks, personal
    chunk_project = personal.target(scope, project)
    if scope in ("personalization", "kh-meta", "self-info") and not personal.is_personal(chunk_project):
        from .projects import ORCHESTRATOR_ID
        chunk_project = ORCHESTRATOR_ID
    chunk_lanes = chunks.lanes(chunk_project, where_filter) if scope else []
    word_count = len(text.split())

    def _search(vec) -> list[dict]:
        out: list[dict] = []
        for coll, lane_where in lanes:
            try:
                out.extend(query_vt(vec, n_results=k, where=lane_where, collection=coll))
            except Exception as exc:
                logger.warning("query_quick_knowledge lane failed (%s): %s",
                               getattr(coll, "name", "shared"), exc)
        for coll, lane_where in chunk_lanes:
            try:
                # several chunks of one row can crowd the top k, so ask for more and dedupe by row
                for hit in query_vt(vec, n_results=k * 3, where=lane_where, collection=coll):
                    parent = (hit.get("metadata") or {}).get(chunks.PARENT_KEY)
                    if parent:     # a chunk ranks its row; the row's text is read back below
                        # the chunk's own text travels with it, so a snippet can show what matched
                        out.append({"core_id": parent, "score": hit["score"], "source_text": None,
                                    "metadata": {}, "piece": hit.get("source_text")})
            except Exception as exc:
                logger.warning("query_quick_knowledge chunk lane failed (%s): %s",
                               getattr(coll, "name", "shared"), exc)
        return out

    def _resolve(best: dict[str, dict]) -> dict[str, dict]:
        """Fill in rows found only through a chunk, reading them through the query's own lanes."""
        missing = [vid for vid, h in best.items() if h.get("source_text") is None]
        if missing:
            found: dict[str, dict] = {}
            for coll, lane_where in lanes:
                try:
                    for row in vs_get_ids(missing, lane_where, coll):
                        found.setdefault(row["vector_id"], row)
                except Exception as exc:
                    logger.warning("query_quick_knowledge chunk resolve failed: %s", exc)
            for vid in missing:
                if vid in found:
                    best[vid] = {**best[vid], "source_text": found[vid]["source_text"],
                                 "metadata": found[vid]["metadata"]}
                else:
                    best.pop(vid)        # not visible through these lanes, or deleted since
        # Before the top k is cut: the hits leave without metadata, so a worklog of another real
        # person (app/auth.py TECHNICAL USERS) can only be dropped here.
        from . import auth
        return {vid: h for vid, h in best.items() if auth.acting_visible(h.get("metadata"))}

    if word_count > _LONG_TEXT_WORD_THRESHOLD:
        chunks = semantic_chunk(text, model)
        best: dict[str, dict] = {}
        for chunk in chunks:
            for hit in _search(chunk["embedding"]):
                vid = hit["core_id"]
                if vid not in best or hit["score"] > best[vid]["score"]:
                    best[vid] = hit
        raw_hits = sorted(_resolve(best).values(), key=lambda h: h["score"], reverse=True)[:k]
    else:
        vector = model.encode(text, normalize_embeddings=True).tolist()
        best2: dict[str, dict] = {}
        for hit in _search(vector):
            vid = hit["core_id"]
            if vid not in best2 or hit["score"] > best2[vid]["score"]:
                best2[vid] = hit
        raw_hits = sorted(_resolve(best2).values(), key=lambda h: h["score"], reverse=True)[:k]

    return [
        {
            "vector_id":   hit["core_id"],
            "score":       hit["score"],
            "source_text": hit.get("source_text", ""),
            "summary":     hit.get("metadata", {}).get("summary", ""),
            # the chunk that ranked this row, or None when the row's own vector did
            "piece":       hit.get("piece"),
        }
        for hit in raw_hits
    ]


async def query_quick_knowledge(
    text: str,
    k: int,
    model: "SentenceTransformer",
    scope: str | None = None,
    where: dict | None = None,
    project: str | None = None,
) -> list[dict]:
    return await asyncio.to_thread(_query_quick_knowledge_sync, text, k, model, scope, where, project)


_CLIP_GAP = " [...] "     # marks where a head-plus-piece snippet skips text


_OFFSET_STEP = 50          # how finely _best_offset slides its window over a piece


def _best_offset(piece: str, room: int, query: str | None) -> int:
    """Where, inside a piece longer than ``room``, the window holding most of the query's words starts.

    A chunk is 800 characters and a 600-character snippet has room for about 430 of them, so the
    words that ranked the chunk may sit past the cut. Counting the query's words is enough to keep
    them: the chunk is already the closest by meaning, this only picks which part of it to show.
    """
    words = {w for w in re.findall(r"\w+", (query or "").lower()) if len(w) > 3}
    if len(piece) <= room or not words:
        return 0
    low = piece.lower()
    best, best_hits = 0, -1
    for off in range(0, len(piece) - room + _OFFSET_STEP, _OFFSET_STEP):
        hits = sum(w in low[off:off + room] for w in words)
        if hits > best_hits:
            best, best_hits = off, hits
    return min(best, len(piece) - room)


def clip_hit(hit: dict, max_chars: int | None, query: str | None = None) -> dict:
    """A hit whose source_text is cut to ``max_chars`` (a snippet), marked so the caller knows.

    Snippets keep a read small however long the stored rows are (log rows run to 13 KB); the
    caller fetches the full text of the few rows it uses with /vector/scroll ids=[...].

    A row found through one of its chunks (``piece``, app/chunks.py) whose piece lies past the
    first ``max_chars`` characters is cut to its head plus that piece, so the part that matched
    the question is the part that comes back (roadmap item C, fix 1). When the piece is longer
    than the room left, the part of it holding most of ``query``'s words is kept. ``piece_at`` is
    where the returned part starts in the full text. Every other row keeps the plain head cut.
    """
    piece = hit.get("piece")
    hit = {k: v for k, v in hit.items() if k != "piece"}
    text = hit.get("source_text") or ""
    if not max_chars or len(text) <= max_chars:
        return hit
    at = text.find(piece) if piece else -1
    head = CLIP_HEAD_CHARS
    room = max_chars - head - len(_CLIP_GAP)
    if at < 0 or at + len(piece) <= max_chars or room < 100:
        return {**hit, "source_text": text[:max_chars], "truncated": True, "text_len": len(text)}
    at += _best_offset(piece, room, query)
    clipped = text[:head] + _CLIP_GAP + text[at:at + room]
    return {**hit, "source_text": clipped, "truncated": True, "text_len": len(text), "piece_at": at}


# ---------------------------------------------------------------------------
# Graph retrieval (multi-hop)  (/graph/query) — no LLM
# ---------------------------------------------------------------------------

def _fetch_graph_sync(core_ids: list[str]) -> tuple[list[dict], list[dict]]:
    return graph_db.fetch_graph(core_ids, HIERARCHY_EDGES, ONTOLOGY_HOPS)


async def fetch_graph(core_ids: list[str]) -> tuple[list[dict], list[dict]]:
    if not core_ids:
        return [], []
    try:
        nodes, edges = await asyncio.to_thread(_fetch_graph_sync, core_ids)
        logger.info("Graph retrieval: core_ids=%d → nodes=%d edges=%d",
                    len(core_ids), len(nodes), len(edges))
        return nodes, edges
    except Exception as exc:
        logger.warning("Graph retrieval failed: %s", exc, exc_info=True)
        return [], []
