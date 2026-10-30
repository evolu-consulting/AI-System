"""
Vector store layer — ChromaDB (local persistent).

Responsibilities:
  - upsert_vt(core_id, vector, source_text, metadata): store entity embedding keyed by core_id,
      embedding = encode(source_text) so retrieval matches source phrases semantically
  - query_vt(query_vector, n_results): cosine-similarity nearest-neighbour search

ChromaDB runs fully in-process with a local file store (CHROMA_PATH in .env).
No separate server needed — compatible with HANA Express setup.

Architecture:
    HANA / Kùzu → KH_GRAPH_NODES + KH_GRAPH_EDGES  (graph topology)
    ChromaDB    → knowledge_hub_vectors              (source_text embeddings, keyed by core_id)
"""

import logging
import os
import re
import time
from collections import OrderedDict

import chromadb
from chromadb.config import Settings

from .config import (CHROMA_PATH, COLLECTION_NAME, KEYS_COLLECTION_NAME, EMBEDDING_MODEL,
                     KH_VERSION, VECTOR_BACKEND)

_logger = logging.getLogger(__name__)

# ── Embedding provenance stamp (SA-5) ────────────────────────────────────────
# Every vector carries the model + dim + KH version it was embedded under, so a
# later model swap (e.g. bge-small-en → a multilingual/code embedder) is detectable
# per-row instead of a silent drift, and only stale rows need re-embedding. The
# stamp is metadata KH writes locally — 0 tokens, never enters an LLM context.

def _stamp(meta: dict, vector: list[float] | None = None) -> dict:
    """Inject model/dim/version provenance into a vector's metadata (idempotent).

    dim is taken from the actual vector when available (authoritative); model/version
    default from config but are never overwritten if the caller set them explicitly.
    """
    meta.setdefault("emb_model", EMBEDDING_MODEL)
    meta.setdefault("emb_ver", KH_VERSION)
    if vector is not None:
        meta["emb_dim"] = len(vector)
    return meta

# ---------------------------------------------------------------------------
# Client + collection (initialised once at import time)
# ---------------------------------------------------------------------------

# KH_VECTOR_BACKEND=hana swaps the client for the HANA vector engine adapter, which
# answers the same collection calls (app/vector_hana.py); everything below is unchanged.
if VECTOR_BACKEND == "hana":
    from .vector_hana import HanaVectorClient
    _client = HanaVectorClient()
else:
    _client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=Settings(anonymized_telemetry=False),
    )

_collection = _client.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},  # cosine similarity for normalised embeddings
)

# Separate collection for canonical KEYS (entity-resolution index). Same client and
# embedding space as _collection, but its own namespace so key lookups never compete
# with knowledge chunks — fixes the "canonical key falls outside top-k" miss.
_keys_collection = _client.get_or_create_collection(
    name=KEYS_COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},
)

_logger.info(
    "Vector store ready — backend=%s, path=%s, collection=%s, keys_collection=%s",
    VECTOR_BACKEND, CHROMA_PATH if VECTOR_BACKEND != "hana" else "hana",
    COLLECTION_NAME, KEYS_COLLECTION_NAME,
)


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def upsert_vt(
    core_id: str,
    vector: list[float],
    source_text: str = "",
    metadata: dict | None = None,
    collection=None,
) -> None:
    """
    Upsert an entity vector into ChromaDB.

    The embedding should be encode(source_text) — the exact phrase from the original
    document that describes this entity. This allows ASK/QUERY to resolve question
    entities to stored core_ids by semantic similarity of source phrases.

    Updates existing entries so the vector always reflects the latest source_text.

    Args:
        core_id:     Unique entity identifier (matches KH_GRAPH_NODES core_id).
        vector:      L2-normalised float list (384-dim) — must be encode(source_text).
        source_text: The original phrase this embedding was generated from.
        metadata:    Additional metadata stored alongside the vector (e.g. type).
        collection:  Target Chroma collection (per-project physical isolation, B4).
                     Defaults to the shared collection for legacy/uncscoped writes.
    """
    coll = collection if collection is not None else _collection
    meta = _stamp({**(metadata or {})}, vector)
    if source_text:
        meta["source_text"] = source_text

    upsert_kwargs: dict = {
        "ids":        [core_id],
        "embeddings": [vector],
        "metadatas":  [meta],
    }
    if source_text:
        upsert_kwargs["documents"] = [source_text]

    coll.upsert(**upsert_kwargs)
    _logger.debug("upsert_vt — upserted: %s (source_text=%r)", core_id, source_text[:60] if source_text else "")


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

#: Chroma 1.x local (Rust) raises this from query() while a collection's FIRST write is in flight: the upsert has
#: already set the collection's dimension, but its HNSW segment folder is created a moment later by the same
#: write's backfill, and the knn path does not treat an uninitialized segment as empty
#: (rust/segment/src/local_hnsw.rs LocalHnswSegmentReader::from_segment -> UninitializedSegment). Reproduced on
#: chromadb 1.5.9 by querying a fresh collection from other threads during its first upsert. The same message
#: is permanent for a collection whose rows were all deleted, so a retry is bounded.
_UNSETTLED = ("Nothing found on disk", "Error creating hnsw segment reader")
QUERY_SETTLE_TRIES = 4


def query_settled(coll, kwargs: dict):
    """``coll.query(**kwargs)``, retried briefly (~0.3 s in all) while the collection's first write settles."""
    for attempt in range(QUERY_SETTLE_TRIES):
        try:
            return coll.query(**kwargs)
        except Exception as exc:  # noqa: BLE001 - chromadb raises its internal errors untyped
            if attempt == QUERY_SETTLE_TRIES - 1 or not any(m in str(exc) for m in _UNSETTLED):
                raise
            time.sleep(0.05 * (attempt + 1))
    raise RuntimeError("unreachable")


def query_vt(
    query_vector: list[float],
    n_results: int = 10,
    where: dict | None = None,
    collection=None,
) -> list[dict]:
    """
    Return the top-N most similar entities by cosine similarity.

    Args:
        query_vector: Encoded query embedding (same model as ingestion).
        n_results:    Maximum number of results to return.
        where:        Optional ChromaDB metadata filter, e.g. {"type": "PERSON"}.
        collection:   Target collection (per-project isolation); default shared.

    Returns:
        List of dicts: [{"core_id": str, "score": float, "metadata": dict}, ...]
        Sorted by descending similarity (closest first).
    """
    coll = collection if collection is not None else _collection
    if (coll.count() or 0) == 0:
        return []
    kwargs: dict = {
        "query_embeddings": [query_vector],
        "n_results": min(n_results, coll.count() or 1),
        "include": ["distances", "metadatas", "documents"],
    }
    if where:
        kwargs["where"] = where

    results = query_settled(coll, kwargs)

    return [
        {
            "core_id":     core_id,
            "score":       round(1.0 - distance, 6),  # ChromaDB cosine distance → similarity
            "source_text": (doc or meta.get("source_text", "")),
            "metadata":    meta,
        }
        for core_id, distance, meta, doc in zip(
            results["ids"][0],
            results["distances"][0],
            results["metadatas"][0],
            results["documents"][0],
        )
    ]


# ---------------------------------------------------------------------------
# Deterministic fetch by metadata (no similarity) — uncapped by k
# ---------------------------------------------------------------------------

def get_vt(where: dict, limit: int | None = None, collection=None) -> list[dict]:
    """Fetch ALL entries matching a metadata filter, ignoring similarity/k.

    Used by the semantic-layer "exhaustive gather" (collect every fact attached to
    a subject, not just the top-k most similar). ChromaDB ``get`` returns every
    matching row; ``limit`` caps only as a safety valve.

    Returns the same shape as ``query_vt`` minus ``score`` (there is no query
    vector here): [{"core_id", "source_text", "metadata"}, ...].
    """
    coll = collection if collection is not None else _collection
    kwargs: dict = {"where": where, "include": ["metadatas", "documents"]}
    if limit:
        kwargs["limit"] = limit
    res = coll.get(**kwargs)
    ids = res.get("ids", []) or []
    metas = res.get("metadatas", []) or []
    docs = res.get("documents", []) or []
    out: list[dict] = []
    for i, cid in enumerate(ids):
        meta = metas[i] if i < len(metas) else {}
        doc = docs[i] if i < len(docs) else ""
        out.append({
            "core_id": cid,
            "source_text": (doc or (meta or {}).get("source_text", "")),
            "metadata": meta or {},
        })
    return out


def get_ids_vt(ids: list[str], where: dict | None = None, collection=None) -> list[dict]:
    """Fetch exact rows by id, still inside ``where`` (so a lane's narrowing holds).

    Returns scroll-shaped hits: [{"vector_id", "source_text", "metadata"}, ...].
    """
    coll = collection if collection is not None else _collection
    kwargs: dict = {"ids": list(ids), "include": ["metadatas", "documents"]}
    if where:
        kwargs["where"] = where
    res = coll.get(**kwargs)
    out: list[dict] = []
    for i, cid in enumerate(res.get("ids", []) or []):
        meta = (res.get("metadatas") or [{}])[i] or {}
        doc = (res.get("documents") or [""])[i] or meta.get("source_text", "")
        out.append({"vector_id": cid, "source_text": doc, "metadata": meta})
    return out


def field_values_vt(field: str, where: dict | None = None, collection=None) -> list[tuple[str, object]]:
    """(id, metadata[field]) of every row matching ``where`` - no text read where the backend allows.

    For sorting a partition by one field (recency) and then reading only the page that is kept
    with ``get_ids_vt``. The HANA backend selects the one JSON value; Chroma reads metadata only.
    """
    coll = collection if collection is not None else _collection
    if hasattr(coll, "field_values"):
        return coll.field_values(field, where)
    kwargs: dict = {"include": ["metadatas"]}
    if where:
        kwargs["where"] = where
    res = coll.get(**kwargs)
    metas = res.get("metadatas") or []
    return [(cid, (metas[i] or {}).get(field) if i < len(metas) else None)
            for i, cid in enumerate(res.get("ids") or [])]


# ---------------------------------------------------------------------------
# Enumeration — list/scroll/topics (deterministic, NO similarity, NO k cap)
# ---------------------------------------------------------------------------
# These close the "no listing API" gap: /vector/query is a top-k similarity
# search capped at k=50, so it can neither enumerate a partition completely nor
# count distinct topics. The functions below use ChromaDB ``get`` (metadata
# read, no query vector) so callers can page through EVERY matching row and
# derive an exact topic registry — no high-k guessing, no cap.

_TOPIC_TOKEN_RE = re.compile(r"topic:([A-Za-z0-9_\-]+)")


def scroll_vt(
    where: dict | None = None,
    limit: int = 1000,
    offset: int = 0,
    collection=None,
) -> dict:
    """Paginated deterministic fetch — no similarity, no k cap.

    Returns every row matching ``where`` (or the whole collection), a page at a
    time. Unlike ``query_vt`` there is no top-k truncation, so this is the
    correct primitive for "give me ALL nodes in topic X" or a full audit sweep.

    Returns: {"matched": int, "count": int, "offset": int, "limit": int,
              "hits": [{"vector_id", "source_text", "metadata"}, ...]}
    ``matched`` is the total rows matching ``where`` (for paging math);
    ``count`` is how many were returned in this page.
    """
    coll = collection if collection is not None else _collection

    # Total matched (ids-only fetch is cheap) so callers know when to stop paging.
    if where:
        matched = len((coll.get(where=where, include=[]).get("ids", []) or []))
    else:
        matched = coll.count() or 0

    kwargs: dict = {"include": ["metadatas", "documents"], "limit": limit, "offset": offset}
    if where:
        kwargs["where"] = where
    try:
        res = coll.get(**kwargs)
    except TypeError:
        # Older chromadb without offset support: fall back to fetch-then-slice.
        kwargs.pop("offset", None)
        kwargs.pop("limit", None)
        if where:
            kwargs["where"] = where
        full = coll.get(**kwargs)
        for key in ("ids", "metadatas", "documents"):
            seq = full.get(key) or []
            full[key] = seq[offset:offset + limit]
        res = full

    ids = res.get("ids", []) or []
    metas = res.get("metadatas", []) or []
    docs = res.get("documents", []) or []
    hits: list[dict] = []
    for i, cid in enumerate(ids):
        meta = metas[i] if i < len(metas) else {}
        doc = docs[i] if i < len(docs) else ""
        hits.append({
            "vector_id": cid,
            "source_text": (doc or (meta or {}).get("source_text", "")),
            "metadata": meta or {},
        })
    return {"matched": matched, "count": len(hits), "offset": offset, "limit": limit, "hits": hits}


def topics_vt(field: str = "topic", where: dict | None = None, collection=None, keep=None) -> dict:
    """Exact distinct-value + counts for a metadata field (default ``topic``).

    Scans every matching row (no k cap) and groups by ``metadata[field]`` so a
    caller gets the COMPLETE topic registry with sizes — the deterministic
    replacement for guessing a topic list via high-k semantic sweeps.

    ``missing_field`` counts rows that lack ``field`` in metadata — a direct
    health signal for the "topic stored only in text, not in metadata" hygiene
    bug that breaks ``where`` partition routing.

    Returns: {"field", "distinct", "total_scanned", "missing_field",
              "topics": [{"value", "count"}, ...]}  (sorted count desc, value asc)
    """
    coll = collection if collection is not None else _collection
    kwargs: dict = {"include": ["metadatas"]}
    if where:
        kwargs["where"] = where
    res = coll.get(**kwargs)
    metas = res.get("metadatas", []) or []
    if keep is not None:                   # rows the caller may not see do not count at all
        metas = [m for m in metas if keep(m)]

    counts: dict[str, int] = {}
    missing = 0
    for m in metas:
        val = (m or {}).get(field)
        if val is None or val == "":
            missing += 1
        else:
            key = str(val)
            counts[key] = counts.get(key, 0) + 1

    items = sorted(
        ({"value": k, "count": v} for k, v in counts.items()),
        key=lambda x: (-x["count"], x["value"]),
    )
    return {
        "field": field,
        "distinct": len(items),
        "total_scanned": len(metas),
        "missing_field": missing,
        "topics": items,
    }


def backfill_topic_vt(
    where: dict | None = None,
    field: str = "topic",
    apply: bool = False,
    collection=None,
) -> dict:
    """Repair the "topic in text but not (or wrong) in metadata" hygiene bug.

    For every matching row, parse the ``topic:<slug>`` token out of the stored
    text and compare it to ``metadata[field]``. Rows where they differ (or the
    metadata is missing) are reported; when ``apply=True`` the metadata is
    corrected via ``update`` (metadata-only, NO re-embedding needed).

    ``apply`` defaults to False so this is a safe dry-run by default — the caller
    inspects ``changes`` before committing. Returns:
      {"scanned", "mismatched", "applied", "changes": [{"vector_id","from","to"}]}
    """
    coll = collection if collection is not None else _collection
    kwargs: dict = {"include": ["metadatas", "documents"]}
    if where:
        kwargs["where"] = where
    res = coll.get(**kwargs)
    ids = res.get("ids", []) or []
    metas = res.get("metadatas", []) or []
    docs = res.get("documents", []) or []

    changes: list[dict] = []
    for i, cid in enumerate(ids):
        meta = metas[i] if i < len(metas) else {}
        doc = docs[i] if i < len(docs) else ""
        text = doc or (meta or {}).get("source_text", "")
        m = _TOPIC_TOKEN_RE.search(text or "")
        if not m:
            continue
        expected = m.group(1)
        current = (meta or {}).get(field)
        if current != expected:
            changes.append({"vector_id": cid, "from": current, "to": expected})
            if apply:
                new_meta = {**(meta or {}), field: expected}
                coll.update(ids=[cid], metadatas=[new_meta])
    if apply and changes:
        _logger.info("backfill_topic_vt — corrected %d metadata rows", len(changes))
    return {
        "scanned": len(ids),
        "mismatched": len(changes),
        "applied": apply,
        "changes": changes,
    }


def fill_missing_field_vt(
    where: dict | None,
    field: str,
    value: str,
    apply: bool = False,
    collection=None,
    batch: int = 500,
) -> dict:
    """Set ``metadata[field] = value`` on every matching row that has no value for it yet.

    Rows that already carry the field are never touched, whatever they hold, so running this
    twice is harmless and a value written by the server at store time always wins. Metadata
    only: no re-embedding. ``apply`` defaults to False, a dry run that only counts.

    Returns: {"scanned", "missing", "applied"}.
    """
    coll = collection if collection is not None else _collection
    kwargs: dict = {"include": ["metadatas"]}
    if where:
        kwargs["where"] = where
    res = coll.get(**kwargs)
    ids = res.get("ids", []) or []
    metas = res.get("metadatas", []) or []

    todo_ids: list[str] = []
    todo_metas: list[dict] = []
    for i, cid in enumerate(ids):
        meta = (metas[i] if i < len(metas) else None) or {}
        if meta.get(field):
            continue
        todo_ids.append(cid)
        todo_metas.append({**meta, field: value})
    if apply:
        for start in range(0, len(todo_ids), batch):
            coll.update(ids=todo_ids[start:start + batch], metadatas=todo_metas[start:start + batch])
        if todo_ids:
            _logger.info("fill_missing_field_vt — set %s on %d rows in %s",
                         field, len(todo_ids), getattr(coll, "name", "shared"))
    return {"scanned": len(ids), "missing": len(todo_ids), "applied": apply}


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def delete_vt(ids: list[str], collection=None) -> list[str]:
    """
    Delete vector entries by ID from a collection (per-project when given).

    Args:
        ids: Entry IDs to remove — a graph entity's core_id, or the vector ID used
             by /add-vector and quick knowledge (e.g. vec_<hash>, quick_<hash>, or a
             caller-supplied id).
        collection: Target Chroma collection; defaults to the shared collection.

    Returns:
        The subset of `ids` that actually existed and were deleted. IDs that are not
        present are silently ignored (idempotent), so the caller can diff this against
        the request to report which IDs were not found.
    """
    if not ids:
        return []

    coll = collection if collection is not None else _collection
    existing = coll.get(ids=ids).get("ids", [])
    if existing:
        coll.delete(ids=existing)
        _logger.info("delete_vt — deleted %d/%d entries", len(existing), len(ids))
    return existing


# ===========================================================================
# KEYS collection — canonical/standardized entity keys (separate namespace)
# ===========================================================================
# Same embedding model and cosine space as the knowledge collection, but stored
# apart so a canonicalization query ("qua chuoi" → "banana") is ranked only against
# other keys. The vector is encode(source_text) where source_text is the pipe-joined
# alias phrase, so any alias/spelling/language of an entity resolves to its key.

def keys_collection(project: str | None = None):
    """The canonical-keys collection for a project (per-project isolation).

    Default (no project) = the shared global keys collection; a project gets its OWN
    kh_keys_<project> so a canonicalization query ranks only that project's keys.
    """
    from .projects import ORCHESTRATOR_ID
    pid = _own_project(project)
    if pid == ORCHESTRATOR_ID:
        return _keys_collection
    return get_or_create(f"kh_keys_{pid}")


def upsert_key(
    key: str,
    vector: list[float],
    source_text: str = "",
    metadata: dict | None = None,
    collection=None,
) -> None:
    """Upsert a canonical key into a keys collection (per-project when given; id = key)."""
    coll = collection if collection is not None else _keys_collection
    meta = {"kind": "canonical_key", **(metadata or {})}
    if source_text:
        meta["source_text"] = source_text

    upsert_kwargs: dict = {
        "ids":        [key],
        "embeddings": [vector],
        "metadatas":  [meta],
    }
    if source_text:
        upsert_kwargs["documents"] = [source_text]

    coll.upsert(**upsert_kwargs)
    _logger.debug("upsert_key — upserted key=%s (source_text=%r)", key, source_text[:60] if source_text else "")


def query_keys(query_vector: list[float], n_results: int = 5, collection=None) -> list[dict]:
    """Return the top-N canonical keys nearest the query, by cosine similarity.

    Returns: [{"key", "score", "source_text", "metadata"}, ...] closest first.
    """
    coll = collection if collection is not None else _keys_collection
    if (coll.count() or 0) == 0:
        return []
    results = coll.query(
        query_embeddings=[query_vector],
        n_results=min(n_results, coll.count() or 1),
        include=["distances", "metadatas", "documents"],
    )
    return [
        {
            "key":         key,
            "score":       round(1.0 - distance, 6),
            "source_text": (doc or meta.get("source_text", "")),
            "metadata":    meta,
        }
        for key, distance, meta, doc in zip(
            results["ids"][0],
            results["distances"][0],
            results["metadatas"][0],
            results["documents"][0],
        )
    ]


def get_key(key: str, collection=None) -> dict | None:
    """Fetch one canonical key by exact id, or None if absent (for alias merge/learn-back)."""
    coll = collection if collection is not None else _keys_collection
    res = coll.get(ids=[key], include=["metadatas", "documents"])
    ids = res.get("ids", []) or []
    if not ids:
        return None
    metas = res.get("metadatas", []) or [{}]
    docs = res.get("documents", []) or [""]
    meta = metas[0] or {}
    return {
        "key": ids[0],
        "source_text": (docs[0] if docs else "") or meta.get("source_text", ""),
        "metadata": meta,
    }


def delete_keys(keys: list[str], collection=None) -> list[str]:
    """Delete canonical keys by id; returns the subset that existed (idempotent)."""
    if not keys:
        return []
    coll = collection if collection is not None else _keys_collection
    existing = coll.get(ids=keys).get("ids", [])
    if existing:
        coll.delete(ids=existing)
        _logger.info("delete_keys — deleted %d/%d keys", len(existing), len(keys))
    return existing


# ===========================================================================
# ORCHESTRATOR — physical per-source collections + hub descriptor collection
# ===========================================================================
# Each ingested source gets its OWN Chroma collection ("kh_src_<id>") so two
# forks that share identical entity names live in physically separate namespaces
# — a scoped query into one can never surface the other's data. The hub holds one
# descriptor vector per source ("kh_orch_hub") used ONLY as the tier-3 recall net.

_SRC_PREFIX = "kh_src_"
_HUB_NAME = "kh_orch_hub"
# LRU-ordered handle cache (bounded in get_source_collection) so touching many
# projects in one process does not accumulate unbounded loaded HNSW indexes.
_source_collections: "OrderedDict[str, object]" = OrderedDict()


def _src_coll_name(source_id: str) -> str:
    return f"{_SRC_PREFIX}{source_id}"


# Generic cosine collection accessor (used by the policy/findings subsystems that
# manage their own physically-separate collections — same client + embedding space).
_named_collections: dict[str, object] = {}


def get_or_create(name: str):
    coll = _named_collections.get(name)
    if coll is None:
        coll = _client.get_or_create_collection(name=name, metadata={"hnsw:space": "cosine"})
        _named_collections[name] = coll
    return coll


def every_collection() -> list[tuple[str, object]]:
    """(name, handle) for every collection that exists, plus the shared one.

    THE SWEEP LANE FOR DELETE BY ID, and the reason it has to exist: a vector id does
    not say which collection holds it, and the rows most in need of removal are exactly
    the ones that landed somewhere unexpected — a row whose scope was passed only in
    `metadata` is written to the DEFAULT scope's collection while its metadata claims
    another, so every scoped read misses it and no caller can name its home. Sweeping is
    safe here because deletion is by exact id: a collection that does not hold the id is
    not touched. It is NOT a read lane - reads stay scoped.
    """
    out: list[tuple[str, object]] = [(COLLECTION_NAME, _collection)]
    for name in sorted(existing_collection_names()):
        if name == COLLECTION_NAME:
            continue
        out.append((name, get_or_create(name)))
    return out


def existing_collection_names() -> set[str]:
    """Names of collections that already exist on disk (no creation side effect)."""
    try:
        cols = _client.list_collections()
    except Exception:
        return set()
    out: set[str] = set()
    for c in cols:
        out.add(getattr(c, "name", None) or (c if isinstance(c, str) else str(c)))
    return out


# ── Per-project scope routing (B4) ───────────────────────────────────────────
# Worklogs (scope=log), C4 knowledge (scope=knowledge) and findings (scope=findings)
# each live in the OWNING project's own physical collection (kh_log_/kh_know_/
# kh_find_<project>) instead of the shared flat collection — physical isolation by
# structure, matching the design (§03/§05). Personalization + kh-meta self-info are
# COMMON (cross-project) and live in the orchestrator's knowledge collection.
_SCOPE_TO_PART = {"log": "log_collection", "knowledge": "knowledge_collection",
                  "findings": "findings_collection"}
_COMMON_SCOPES = {"personalization", "kh-meta", "self-info"}
# Not real project bundles — self-info / meta content is COMMON, owned by the
# orchestrator (design keep-list). Any project tag equal to these normalises to it.
_COMMON_PROJECT_ALIASES = {"kh-meta", "self-info", "meta", "kh_meta"}


def _own_project(project: str | None) -> str:
    from .projects import ORCHESTRATOR_ID
    pid = (project or ORCHESTRATOR_ID)
    return ORCHESTRATOR_ID if pid in _COMMON_PROJECT_ALIASES else pid


def part_collection_name(scope: str, project_id: str) -> str:
    """Physical collection name for a (scope, project) part — the EXTENSIBLE rule.

    The three basic parts keep their established short bundle names (kh_know_/kh_log_/
    kh_find_<id>); ANY other scope becomes a project-specific part kh_<scope>_<id>, so a
    project can grow custom stores (e.g. Space Survivor's 'gdscript' -> kh_gdscript_<id>)
    with NO code change — a new scope IS a new isolated part in that project's bundle.
    """
    from .projects import bundle_of, ORCHESTRATOR_ID
    part = _SCOPE_TO_PART.get(scope)
    if part is not None:
        b = bundle_of(project_id, role="manage" if project_id == ORCHESTRATOR_ID else "project")
        return getattr(b, part)
    return f"kh_{scope}_{project_id}"


def own_project(project: str | None) -> str:
    """Public form of the write-side project normalisation (orchestrator default)."""
    return _own_project(project)


# ── Hot log window ───────────────────────────────────────────────────────────
# One shared partition that sits IN FRONT of the per-project log collections. It is
# a cache, never a system of record: rows are spilled into kh_log_<project> before
# they are removed from here. See app/hotlog.py for the window policy.
HOTLOG_COLLECTION = "kh_hotlog"


def hotlog_collection():
    """The hot log window's physical collection (created on first write)."""
    return get_or_create(HOTLOG_COLLECTION)


def move_rows(ids: list[str], src, dst) -> list[str]:
    """Move rows between collections, preserving the stored embedding.

    COPY FIRST, DELETE SECOND, deliberately: a crash between the two leaves a
    duplicate that the next pass overwrites by id, whereas the reverse order would
    lose the row outright. Re-encoding is avoided by carrying the existing vector,
    so a spill costs no model time.

    Returns the ids actually moved (missing ids are skipped, so this is idempotent).
    """
    if not ids or src is None or dst is None:
        return []
    got = src.get(ids=ids, include=["embeddings", "metadatas", "documents"])
    have = list(got.get("ids", []) or [])
    if not have:
        return []
    embs = got.get("embeddings")
    metas = got.get("metadatas") or []
    docs = got.get("documents") or []
    embs = list(embs) if embs is not None else []

    payload: dict = {"ids": have,
                     "metadatas": [dict(metas[i]) if i < len(metas) and metas[i] else {}
                                   for i in range(len(have))],
                     "documents": [docs[i] if i < len(docs) else "" for i in range(len(have))]}
    if len(embs) == len(have):
        payload["embeddings"] = [list(e) for e in embs]
    dst.upsert(**payload)
    src.delete(ids=have)
    _logger.info("move_rows — moved %d rows %s -> %s", len(have),
                 getattr(src, "name", "?"), getattr(dst, "name", "?"))
    return have


def scope_collection(scope: str | None, project: str | None):
    """Resolve the physical collection for one (scope, project) WRITE, or None.

    None → caller falls back to the shared legacy collection (only when scope is empty).
    project defaults to 'orchestrator' when absent; kh-meta/self-info normalise to the
    orchestrator common knowledge. EVERY other scope maps to a per-project part
    (extensible bundle), created on first write.
    """
    from .projects import bundle_of, ORCHESTRATOR_ID
    if not scope:
        return None
    if scope in _COMMON_SCOPES:
        from .personal import is_personal, is_personal_scope
        if is_personal_scope(scope) and is_personal(project):
            return get_or_create(part_collection_name(scope, project))   # kh_personalization_<personal id>
        b = bundle_of(ORCHESTRATOR_ID, role="manage")
        return get_or_create(b.knowledge_collection)
    return get_or_create(part_collection_name(scope, _own_project(project)))


def scope_collections_all(scope: str | None) -> list:
    """Every EXISTING per-project collection for a scope (reads with no project).

    Lets recency / cross-subject reads see every project's rows for this part. Works for
    the basic parts AND any custom part (kh_<scope>_<id>). Never creates empties.
    """
    from .projects import list_projects, bundle_of, ORCHESTRATOR_ID
    if not scope:
        return []
    if scope in _COMMON_SCOPES:
        names = [bundle_of(ORCHESTRATOR_ID, role="manage").knowledge_collection]
    else:
        ids = set(list_projects().keys()) | {ORCHESTRATOR_ID}
        # With sign-in on, a read that names no project only fans out over the projects the
        # caller may read (D6): an invisible project contributes neither rows nor its name.
        from .auth import visible_projects
        visible = visible_projects("project.read")
        if visible is not None:
            ids &= visible | {ORCHESTRATOR_ID}
        names = [part_collection_name(scope, pid) for pid in ids]
    live = existing_collection_names()
    return [get_or_create(n) for n in names if n in live]


def drop_collection(name: str) -> bool:
    try:
        _client.delete_collection(name)
    except Exception:
        return False
    _named_collections.pop(name, None)
    _source_collections.pop(name, None)
    return True


def get_source_collection(source_id: str):
    """Get-or-create the dedicated Chroma collection for one source (LRU-bounded cache).

    Keeps at most ``config.MAX_OPEN_SOURCE_COLLECTIONS`` handles resident and drops the
    least-recently-used beyond that, so touching many projects in one process does not
    accumulate unbounded collection handles (each carries a loaded HNSW index)."""
    coll = _source_collections.get(source_id)
    if coll is not None:
        _source_collections.move_to_end(source_id)
        return coll
    coll = _client.get_or_create_collection(
        name=_src_coll_name(source_id),
        metadata={"hnsw:space": "cosine"},
    )
    _source_collections[source_id] = coll
    _source_collections.move_to_end(source_id)
    try:
        from . import config as _cfg
        cap = getattr(_cfg, "MAX_OPEN_SOURCE_COLLECTIONS", 16)
    except Exception:
        cap = 16
    while len(_source_collections) > cap:
        old_sid, _ = _source_collections.popitem(last=False)   # drop LRU handle
        _logger.info("source collection handle evicted (LRU): %s", old_sid)
    return coll


def _hub_collection():
    return _client.get_or_create_collection(
        name=_HUB_NAME, metadata={"hnsw:space": "cosine"},
    )


def upsert_src(source_id: str, core_id: str, vector: list[float],
               source_text: str = "", metadata: dict | None = None) -> None:
    """Upsert one vector into a source's OWN collection (physical isolation)."""
    coll = get_source_collection(source_id)
    meta = _stamp({"source_id": source_id, **(metadata or {})}, vector)
    if source_text:
        meta["source_text"] = source_text
    kwargs: dict = {"ids": [core_id], "embeddings": [vector], "metadatas": [meta]}
    if source_text:
        kwargs["documents"] = [source_text]
    coll.upsert(**kwargs)


def upsert_src_batch(source_id: str, items: list[dict], chunk: int = 1000) -> int:
    """
    Batch-upsert many vectors into a source's OWN collection in one (chunked)
    Chroma call instead of one call per item — the difference between minutes and
    seconds for large code-graph imports.

    Each item: {core_id, vector, source_text?, metadata?}. Returns count upserted.
    """
    coll = get_source_collection(source_id)
    n = 0
    for i in range(0, len(items), chunk):
        batch = items[i:i + chunk]
        ids, embs, metas, docs = [], [], [], []
        for it in batch:
            cid = it["core_id"]
            st = it.get("source_text", "") or ""
            meta = _stamp({"source_id": source_id, **(it.get("metadata") or {})}, it["vector"])
            if st:
                meta["source_text"] = st
            ids.append(cid)
            embs.append(it["vector"])
            metas.append(meta)
            docs.append(st)
        kwargs: dict = {"ids": ids, "embeddings": embs, "metadatas": metas}
        # documents must be non-empty per item if provided; only pass when all present
        if all(docs):
            kwargs["documents"] = docs
        coll.upsert(**kwargs)
        n += len(ids)
    return n


def query_src(source_id: str, query_vector: list[float], n_results: int = 10,
              where: dict | None = None) -> list[dict]:
    """Cosine search WITHIN a single source's collection — cannot leak across sources.

    Resilient: a Chroma HNSW segment can transiently fail to open
    ("Nothing found on disk: Error creating hnsw segment reader"). Rather than
    500 the whole (possibly multi-source fan-out) request, we drop the cached
    collection handle, reopen once, and finally degrade to no-hits + a log line.
    """
    def _run(coll) -> list[dict]:
        total = coll.count() or 0
        if total == 0:
            return []
        kwargs: dict = {
            "query_embeddings": [query_vector],
            "n_results": min(n_results, total),
            "include": ["distances", "metadatas", "documents"],
        }
        if where:
            kwargs["where"] = where
        r = coll.query(**kwargs)
        return [
            {"core_id": cid, "score": round(1.0 - dist, 6),
             "source_id": source_id,
             "source_text": (doc or meta.get("source_text", "")), "metadata": meta}
            for cid, dist, meta, doc in zip(
                r["ids"][0], r["distances"][0], r["metadatas"][0], r["documents"][0])
        ]

    try:
        return _run(get_source_collection(source_id))
    except Exception as exc:
        _logger.warning("query_src(%s) failed (%s); retrying with a fresh handle", source_id, exc)
        _source_collections.pop(source_id, None)
        try:
            return _run(get_source_collection(source_id))
        except Exception as exc2:
            _logger.error("query_src(%s) failed after retry (%s); degrading to no hits", source_id, exc2)
            return []


def source_count(source_id: str) -> int:
    return get_source_collection(source_id).count() or 0


# ── Hybrid retrieval lanes (SA-4) ────────────────────────────────────────────
# Cosine over an English embedder mis-ranks EXACT identifier matches — e.g.
# `company_id_for_email` vs `company_id_for_domain` land almost tied. So a second
# LEXICAL lane runs beside the vector lane and the two candidate sets are merged;
# the FINAL ranking is Claude's job (Claude-as-judge), matching the no-local-LLM
# architecture. KH only supplies candidates from both lanes — it never re-ranks.

_TERM_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{1,}")
_STOP = frozenset({"the", "and", "for", "with", "from", "that", "this", "what",
                   "how", "does", "are", "was", "into", "which", "when"})


def query_terms(text: str, limit: int = 8) -> list[str]:
    """Salient identifier-ish terms from a query for the lexical lane."""
    seen: list[str] = []
    for t in _TERM_RE.findall(text or ""):
        low = t.lower()
        if low in _STOP or len(t) < 3:
            continue
        if t not in seen:
            seen.append(t)
        if len(seen) >= limit:
            break
    return seen


def keyword_src(source_id: str, terms: list[str], n_results: int = 10) -> list[dict]:
    """Lexical lane: documents in a source containing ANY of the terms (substring).

    Chroma's full-text `where_document $contains` is a keyword filter (not scored),
    which is exactly enough for the lexical candidate set — Claude does the scoring.
    """
    if not terms:
        return []
    coll = get_source_collection(source_id)
    if (coll.count() or 0) == 0:
        return []
    wd = {"$contains": terms[0]} if len(terms) == 1 else {"$or": [{"$contains": t} for t in terms]}
    try:
        r = coll.get(where_document=wd, limit=n_results, include=["metadatas", "documents"])
    except Exception as exc:
        _logger.warning("keyword_src(%s) failed (%s); empty lexical lane", source_id, exc)
        return []
    out = []
    for cid, doc, meta in zip(r.get("ids", []), r.get("documents", []), r.get("metadatas", [])):
        meta = meta or {}
        out.append({"core_id": cid, "lane": "keyword", "score": None,
                    "source_id": source_id,
                    "source_text": (doc or meta.get("source_text", "")), "metadata": meta})
    return out


def hybrid_src(source_id: str, query_text: str, query_vector: list[float],
               k: int = 10, where: dict | None = None) -> dict:
    """Run BOTH lanes for one source and merge candidates for Claude to rank.

    Returns {vector:[...], keyword:[...], merged:[...]} where merged dedups by
    core_id and records which lane(s) surfaced each candidate (a hit in both lanes
    is a strong signal for the judge). No local re-ranking is applied.
    """
    vec = query_src(source_id, query_vector, k, where=where)
    for h in vec:
        h["lane"] = "vector"
    kw = keyword_src(source_id, query_terms(query_text), k)

    merged: dict[str, dict] = {}
    for h in vec + kw:
        cid = h["core_id"]
        m = merged.get(cid)
        if m is None:
            merged[cid] = {**h, "lanes": [h["lane"]]}
        elif h["lane"] not in m["lanes"]:
            m["lanes"].append(h["lane"])
            # keep the vector score if either lane had one
            if m.get("score") is None and h.get("score") is not None:
                m["score"] = h["score"]
    return {"vector": vec, "keyword": kw, "merged": list(merged.values())}


def delete_source_collection(source_id: str) -> bool:
    """Drop a source's entire collection (hard isolation cleanup)."""
    try:
        _client.delete_collection(_src_coll_name(source_id))
    except Exception:
        return False
    _source_collections.pop(source_id, None)
    return True


def upsert_hub_descriptor(source_id: str, vector: list[float], source_text: str) -> None:
    """Store one descriptor vector per source in the hub (tier-3 recall net)."""
    _hub_collection().upsert(
        ids=[source_id], embeddings=[vector],
        metadatas=[_stamp({"source_id": source_id, "source_text": source_text}, vector)],
        documents=[source_text],
    )


def query_hub(query_vector: list[float], n_results: int = 5) -> list[dict]:
    """Rank sources by descriptor similarity — a COARSE net, never the decider."""
    hub = _hub_collection()
    total = hub.count() or 0
    if total == 0:
        return []
    try:
        r = hub.query(query_embeddings=[query_vector], n_results=min(n_results, total),
                      include=["distances", "metadatas", "documents"])
    except Exception as exc:
        _logger.error("query_hub failed (%s); degrading to no candidates", exc)
        return []
    return [
        {"source_id": sid, "score": round(1.0 - dist, 6),
         "source_text": (doc or meta.get("source_text", ""))}
        for sid, dist, meta, doc in zip(
            r["ids"][0], r["distances"][0], r["metadatas"][0], r["documents"][0])
    ]


def delete_hub_descriptor(source_id: str) -> None:
    try:
        _hub_collection().delete(ids=[source_id])
    except Exception:
        pass
