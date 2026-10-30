import logging
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

_logger = logging.getLogger(__name__)

NodeType = Literal["Action", "Artifact", "System", "State", "Actor"]
EdgeLabel = Literal["REQUIRES_ACTION", "CAN_HAVE_STATE", "TRIGGERS_ACTION", "BLOCKS_ACTION"]

_VALID_NODE_TYPES: frozenset[str] = frozenset({"Action", "Artifact", "System", "State", "Actor"})


# ---------------------------------------------------------------------------
# /api/locate_ui  (Florence-2 UI grounding — v3)
# ---------------------------------------------------------------------------

class CenterCoordinates(BaseModel):
    x: int = Field(..., description="Horizontal center of the bounding box in pixels")
    y: int = Field(..., description="Vertical center of the bounding box in pixels")


class BoundingBox(BaseModel):
    x1: int = Field(..., description="Left edge in pixels")
    y1: int = Field(..., description="Top edge in pixels")
    x2: int = Field(..., description="Right edge in pixels")
    y2: int = Field(..., description="Bottom edge in pixels")


class LocateUIResponse(BaseModel):
    status: str = Field(default="success")
    query: str = Field(..., description="The query string that was searched for")
    center_coordinates: CenterCoordinates
    bounding_box: BoundingBox


# ---------------------------------------------------------------------------
# /process  (semantic chunking — v1)
# ---------------------------------------------------------------------------

class ChunkRequest(BaseModel):
    text: str = Field(..., min_length=1)
    c: float = Field(default=1.0, ge=0.0)


class ChunkResponse(BaseModel):
    chunk_text: str
    embedding: list[float]


# ---------------------------------------------------------------------------
# /vectorlize-text  (direct embedding of a string — no LLM, no storage)
# ---------------------------------------------------------------------------

class VectorizeTextRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description=(
            "Text to encode into an embedding with the active model (bge-small-en-v1.5 by default, "
            "KH_EMBEDDING_MODEL). "
            "The vector is returned to the caller and NOT stored — use /add-vector to "
            "persist it afterwards. The default model is English-only: send English text; "
            "other languages embed poorly."
        ),
    )


class VectorizeTextResponse(BaseModel):
    status: str = Field(default="ok")
    model: str = Field(..., description="Embedding model that produced the vector")
    dimension: int = Field(..., description="Length of the returned vector")
    vector: list[float] = Field(
        ...,
        description=(
            "L2-normalised embedding of the input text (cosine space). Same vector "
            "space as every other KnowledgeHub embedding, so it can be passed straight "
            "to /add-vector."
        ),
    )


# ---------------------------------------------------------------------------
# /api/add_knowledge  (ATTR property-graph pipeline — v2)
# ---------------------------------------------------------------------------

class EntityAttr(BaseModel):
    """A single graph node in the ATTR (Attributed Property Graph) model."""
    core_id: str = Field(
        ...,
        description="Standardized snake_case identifier — stable across documents",
    )
    label: str = Field(
        ...,
        description="Human-readable node name as returned by the LLM (e.g. 'Check_Barcode')",
    )
    type: NodeType = Field(
        ...,
        description="Action | Artifact | System | State | Actor",
    )
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description="Key-value pairs describing state/properties",
    )
    source_text: str = Field(
        default="",
        description="Original /add_knowledge input text this node was extracted from",
    )

    @field_validator("type", mode="before")
    @classmethod
    def coerce_node_type(cls, v: object) -> str:
        if isinstance(v, str) and v in _VALID_NODE_TYPES:
            return v
        _logger.warning(
            "EntityAttr: invalid node type %r — falling back to 'Artifact'", v
        )
        return "Artifact"


class EdgeAttr(BaseModel):
    """A directed, labelled relationship between two graph nodes."""
    source_core_id: str = Field(..., description="core_id of the relationship origin")
    relation: str = Field(..., description="UPPER_SNAKE_CASE edge label (e.g. TRIGGERS_NEXT, EVALUATES, TARGETS)")
    target_core_id: str = Field(..., description="core_id of the relationship destination")
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional key-value properties on the edge (e.g. field name, condition, order index).",
    )
    source_text: str = Field(
        default="",
        description=(
            "Evidence for this edge — the code location / snippet it was derived from "
            "(e.g. 'be_helper_core_api/srv/derive.ts:142 buildDataAutoCorrectionV2'). "
            "Lets multi-hop traversal be audited instead of trusted blindly."
        ),
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description=(
            "Extraction confidence: 1.0 for deterministically parsed edges (AST/CDS/deps), "
            "lower for LLM-asserted edges. Traversal callers can gate on this."
        ),
    )


class KnowledgeRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description=(
            "[Accurate, slower] Raw text to ingest into the knowledge graph via the full ATTR "
            "entity/relationship extraction pipeline. Produces structured graph nodes and edges "
            "for high-precision retrieval. Use /api/add_quick_knowledge for faster ingestion "
            "when structural accuracy is less critical."
        ),
    )


class KnowledgeResponse(BaseModel):
    status: str = Field(default="ok")
    summary: str = Field(..., description="2-3 sentence summary produced by the LLM")
    entities: list[EntityAttr]
    edges: list[EdgeAttr]
    vectors_generated: int = Field(
        ...,
        description="Number of entity vectors generated and persisted to KH_VECTOR_STORE",
    )


# ---------------------------------------------------------------------------
# /api/add_quick_knowledge  (vector-only fast ingestion)
# ---------------------------------------------------------------------------

class QuickKnowledgeRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description=(
            "[Fast, lower accuracy] Text to store as quick knowledge. "
            "The LLM generates a concise summary (< 30 words) used as the vector key; "
            "the original text is stored as the value in ChromaDB. "
            "No graph DB storage — ingestion is faster but retrieval accuracy may be lower "
            "compared to /api/add_knowledge."
        ),
    )


class QuickKnowledgeResponse(BaseModel):
    status: str = Field(default="ok")
    summary: str = Field(
        ...,
        description="Concise LLM-generated summary (< 30 words) used as the vector key for semantic retrieval",
    )
    vector_id: str = Field(
        ...,
        description="ChromaDB entry ID — stable SHA-256 hash of the original text; re-adding the same text overwrites this entry",
    )


# ---------------------------------------------------------------------------
# /api/query_quick_knowledge  (direct vector search, no LLM)
# ---------------------------------------------------------------------------

class QuickQueryHit(BaseModel):
    vector_id: str = Field(..., description="ChromaDB entry ID of the matched quick knowledge entry")
    score: float = Field(..., description="Cosine similarity score (0–1, higher is closer)")
    source_text: str = Field(..., description="Original text stored via /api/add_quick_knowledge")
    summary: str = Field(default="", description="LLM-generated summary used as the vector key")
    truncated: bool = Field(default=False, description="True when source_text was clipped to max_chars")
    text_len: int | None = Field(default=None, description="Full length of source_text when it was clipped")
    piece_at: int | None = Field(default=None, description="Where the matched piece starts in the full text, "
                                 "when the snippet is the head plus that piece")


class QuickQueryRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description=(
            "[Ultra-fast] Query quick knowledge entries by semantic similarity. "
            "The text is embedded directly and matched against stored summaries — "
            "no LLM inference, no graph DB lookup. Extremely low latency."
        ),
    )
    k: int = Field(
        default=1,
        ge=1,
        le=200,
        description=(
            "Number of closest results to return (default: 1). Cap raised 50→200; "
            "for exhaustive enumeration of a partition use /vector/scroll (uncapped) "
            "rather than a large k here."
        ),
    )
    scope: str | None = Field(
        default=None,
        description=(
            "Restrict the search to one namespace (metadata.scope), e.g. 'knowledge' so "
            "logs/personalization never crowd the results. None = search all scopes "
            "(legacy behaviour). Entries stored before scoping have no scope tag and are "
            "only returned when scope is None."
        ),
    )
    project: str | None = Field(
        default=None,
        description=(
            "Search ONE project's own collection for this scope (per-project physical "
            "isolation). Omit to fan out across every project + the shared store."
        ),
    )
    where: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional ChromaDB metadata pre-filter, ANDed with the scope filter. Use for "
            "PARTITION ROUTING — restrict the vector search to a bounded slice so recall "
            "stays flat as the corpus grows, e.g. {\"topic\": {\"$eq\": \"solace-agi\"}}."
        ),
    )
    max_chars: int | None = Field(
        default=None, ge=50, le=100000,
        description="Clip each returned source_text to this many characters (a SNIPPET). The hit then "
                    "carries truncated=true and text_len; fetch the full row with /vector/scroll ids=[...]. "
                    "Omit for the full text (unchanged behaviour). A row found through a chunk past "
                    "the head comes back as its head plus the piece that matched (piece_at says where).",
    )
    min_score: float | None = Field(
        default=None, ge=0.0, le=1.0,
        description="Leave out hits scoring below this (a SCORE FLOOR), so a query returns only the rows "
                    "near the question rather than always k. Omit for every hit (unchanged behaviour).",
    )


class QuickQueryResponse(BaseModel):
    hits: list[QuickQueryHit] = Field(
        default_factory=list,
        description="Matched quick knowledge entries sorted by descending similarity score",
    )


# ---------------------------------------------------------------------------
# /vector/scroll + /vector/topics  (enumeration — deterministic, no k cap)
# ---------------------------------------------------------------------------

class ScrollRequest(BaseModel):
    scope: str | None = Field(
        default=None,
        description="Restrict to one namespace (metadata.scope), e.g. 'knowledge'. None = all scopes.",
    )
    project: str | None = Field(
        default=None,
        description="Read from ONE project's own collection for this scope (per-project "
                    "physical isolation). Omit to aggregate across every project + the shared store.",
    )
    where: dict[str, Any] | None = Field(
        default=None,
        description="Optional ChromaDB metadata filter, ANDed with scope, e.g. {\"topic\": {\"$eq\": \"kh-meta\"}}.",
    )
    limit: int = Field(default=500, ge=1, le=5000, description="Page size (rows per call). No global k cap — page via offset.")
    offset: int = Field(default=0, ge=0, description="Number of matching rows to skip (pagination cursor).")
    order: Literal["newest", "oldest"] | None = Field(
        default=None,
        description="Sort by metadata.ts on the SERVER before paging: 'newest' first or 'oldest' first. "
                    "Rows with no ts sort as oldest. Omit for store order (unchanged behaviour).",
    )
    since: str | None = Field(
        default=None,
        description="Keep only rows with metadata.ts at or after this moment (ISO-8601 or epoch seconds).",
    )
    ids: list[str] | None = Field(
        default=None, max_length=200,
        description="Fetch exactly these rows (e.g. the full text of snippets returned earlier).",
    )
    max_chars: int | None = Field(
        default=None, ge=50, le=100000,
        description="Clip each returned source_text to this many characters (a SNIPPET). The hit then "
                    "carries truncated=true and text_len; fetch the full row with /vector/scroll ids=[...]. "
                    "Omit for the full text (unchanged behaviour).",
    )


class ScrollHit(BaseModel):
    vector_id: str = Field(..., description="ChromaDB entry ID")
    source_text: str = Field(..., description="Stored text of the entry")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Full metadata of the entry")
    truncated: bool = Field(default=False, description="True when source_text was clipped to max_chars")
    text_len: int | None = Field(default=None, description="Full length of source_text when it was clipped")


class ScrollResponse(BaseModel):
    matched: int = Field(..., description="Total rows matching the filter (for paging math)")
    count: int = Field(..., description="Rows returned in this page")
    offset: int = Field(..., description="Offset used for this page")
    limit: int = Field(..., description="Limit used for this page")
    hits: list[ScrollHit] = Field(default_factory=list, description="This page of rows")


# ---------------------------------------------------------------------------
# /vector/delete  (the only way a stored row leaves — added 2026-09-22)
# ---------------------------------------------------------------------------
# BY EXPLICIT ID AND NOTHING ELSE. There is deliberately no filter-delete: a wrong
# `where` would empty a partition in one call and nothing here can be undone, while a
# wrong id removes one row somebody already had to look up. The caller finds the ids
# with /vector/query or /vector/scroll first, which is also what makes `dry_run`
# worth having — it answers "where does this row actually live" without removing it.

class VectorDeleteRequest(BaseModel):
    ids: list[str] = Field(
        ..., min_length=1, max_length=100,
        description="Exact entry IDs to remove (e.g. vec_<hash>). Found via /vector/query or /vector/scroll.",
    )
    scope: str | None = Field(
        default=None,
        description="Limit the search to one namespace's collections. Omit to SWEEP every "
                    "collection, which is what finds a row written to the wrong scope.",
    )
    project: str | None = Field(
        default=None,
        description="With `scope`, limit to that one project's part instead of every project's.",
    )
    dry_run: bool = Field(
        default=False,
        description="Report where each id lives and delete nothing. Use it before a real delete.",
    )


class VectorDeleteResponse(BaseModel):
    status: str = Field(default="ok")
    deleted: list[str] = Field(default_factory=list,
                               description="IDs that existed and were removed (empty when dry_run).")
    found: dict[str, str] = Field(default_factory=dict,
                                  description="id -> the collection that held it, for every id located.")
    not_found: list[str] = Field(default_factory=list,
                                 description="IDs no searched collection held. Not an error - deletion is idempotent.")
    searched: int = Field(..., description="How many collections were searched.")
    dry_run: bool = Field(default=False, description="Whether this call only looked.")


class TopicCount(BaseModel):
    value: str = Field(..., description="Distinct metadata value")
    count: int = Field(..., description="Number of rows carrying this value")


class TopicsResponse(BaseModel):
    field: str = Field(..., description="Metadata field grouped on (default 'topic')")
    distinct: int = Field(..., description="Number of distinct values")
    total_scanned: int = Field(..., description="Rows scanned")
    missing_field: int = Field(..., description="Rows lacking the field in metadata (hygiene signal)")
    topics: list[TopicCount] = Field(default_factory=list, description="Distinct values + counts, count desc")


# ---------------------------------------------------------------------------
# /vector/backfill-metadata  (repair topic-in-text-but-not-metadata)
# ---------------------------------------------------------------------------

class BackfillMetadataRequest(BaseModel):
    scope: str | None = Field(default=None, description="Restrict to one namespace (metadata.scope).")
    where: dict[str, Any] | None = Field(default=None, description="Optional ChromaDB metadata filter, ANDed with scope.")
    field: str = Field(default="topic", description="Metadata field to repair from the text's 'topic:<slug>' token.")
    apply: bool = Field(default=False, description="False (default) = dry-run report only; True = write corrections.")


class BackfillChange(BaseModel):
    vector_id: str
    from_: str | None = Field(default=None, alias="from", description="Previous metadata value (null if missing)")
    to: str = Field(..., description="Corrected value parsed from text")

    model_config = {"populate_by_name": True}


class BackfillMetadataResponse(BaseModel):
    scanned: int = Field(..., description="Rows scanned")
    mismatched: int = Field(..., description="Rows whose metadata field differs from the text token")
    applied: bool = Field(..., description="Whether corrections were written")
    changes: list[BackfillChange] = Field(default_factory=list, description="Per-row corrections (or would-be, if dry-run)")


# ---------------------------------------------------------------------------
# /log/backfill-author  (name the writer of worklogs stored before sign-in)
# ---------------------------------------------------------------------------

class LogBackfillAuthorRequest(BaseModel):
    author: str = Field(..., min_length=3, description="E-mail of the person who wrote these worklogs.")
    projects: list[str] = Field(..., min_length=1,
                                description="Projects whose worklogs to stamp. Required: there is no 'every project'.")
    apply: bool = Field(default=False, description="False (default) = dry-run count only; True = write.")


class LogBackfillProject(BaseModel):
    project: str
    scanned: int = Field(..., description="Worklog rows of this project read (own log + hot window)")
    missing: int = Field(..., description="Rows with no author; these are the ones stamped")


class LogBackfillAuthorResponse(BaseModel):
    author: str
    applied: bool
    missing: int = Field(..., description="Total rows stamped (or that would be, on a dry run)")
    projects: list[LogBackfillProject] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# /version  (authoritative version marker — fixes 'stale version node')
# ---------------------------------------------------------------------------

class VersionResponse(BaseModel):
    version: str = Field(..., description="Authoritative KnowledgeHub version")
    source: str = Field(..., description="Where the version was resolved from (env / VERSION file / default)")
    model: str = Field(..., description="Active embedding model")


# ---------------------------------------------------------------------------
# /add-vector  (direct vector ingestion — no LLM embedding step)
# ---------------------------------------------------------------------------

class AddVectorRequest(BaseModel):
    vector: list[float] = Field(
        ...,
        min_length=1,
        description=(
            "Pre-computed embedding to store directly — KnowledgeHub does NOT call "
            "the LLM/embedding model for this endpoint. Must match the dimension of "
            "the active embedding model (bge-small-en-v1.5 by default → 384) "
            "and live in the same vector space (cosine), otherwise retrieval is meaningless."
        ),
    )
    content: str = Field(
        ...,
        min_length=1,
        description="The value/content associated with this vector. Returned verbatim on retrieval.",
    )
    id: str | None = Field(
        default=None,
        description=(
            "Optional stable entry ID. If omitted, a content-hash ID (vec_<sha256[:12]>) "
            "is generated; re-adding the same content overwrites the previous entry."
        ),
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Optional extra metadata stored alongside the vector. By default the entry is "
            "tagged knowledge_type=\"quick\" so it is retrievable via /api/query_quick_knowledge, "
            "/api/ask and /api/query; override knowledge_type here to change that behaviour."
        ),
    )


class AddVectorResponse(BaseModel):
    status: str = Field(default="ok")
    vector_id: str = Field(..., description="ChromaDB entry ID of the stored vector")
    dimension: int = Field(..., description="Dimension of the stored vector")


# ---------------------------------------------------------------------------
# /api/ask  (RAG query — v4)
# ---------------------------------------------------------------------------

class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, description="Natural-language question to answer")


class NodeData(BaseModel):
    core_id: str
    entity_type: str = ""
    label: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)
    source_text: str = ""
    created_at: str = Field(default="", description="ISO-8601 timestamp when this node was first ingested")
    updated_at: str = Field(default="", description="ISO-8601 timestamp of the most recent update to this node")


class EdgeData(BaseModel):
    source_core_id: str
    relation: str
    target_core_id: str
    attributes: dict[str, Any] = Field(default_factory=dict, description="Edge properties (field, condition, order, ...)")
    source_text: str = Field(default="", description="Evidence: code location / snippet this edge was derived from")
    confidence: float = Field(default=1.0, description="Extraction confidence (1.0 = deterministically parsed)")
    created_at: str = Field(default="", description="ISO-8601 timestamp when this relationship was first established")


class AskResponse(BaseModel):
    status: Literal["synthesized", "raw_data", "not_found"]
    answer: str
    sources: list[str] = Field(default_factory=list, description="core_ids of matched graph nodes")
    graph_data: list[NodeData] = Field(
        default_factory=list,
        description="Graph nodes used to produce the answer, including created_at / updated_at timestamps",
    )
    edges: list[EdgeData] = Field(
        default_factory=list,
        description="1-hop edges between matched nodes, including created_at timestamp",
    )


# ---------------------------------------------------------------------------
# /api/query  (raw graph query — v5)
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, description="Query text — entities are extracted then matched against the graph")


class QueryResponse(BaseModel):
    matched_terms: list[str] = Field(default_factory=list, description="Entity labels extracted from the query")
    sources: list[str] = Field(default_factory=list, description="core_ids matched via vector search")
    nodes: list[NodeData] = Field(default_factory=list, description="Graph nodes retrieved from the graph database")
    edges: list[EdgeData] = Field(default_factory=list, description="1-hop edges between matched nodes")
    quick_knowledge: list[str] = Field(
        default_factory=list,
        description="Original texts matched from quick knowledge entries (/api/add_quick_knowledge)",
    )


# ---------------------------------------------------------------------------
# DELETE /api/knowledge  (remove stored knowledge — vector and/or graph)
# ---------------------------------------------------------------------------

DeleteScope = Literal["all", "vector", "graph"]


class DeleteKnowledgeRequest(BaseModel):
    ids: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Entry IDs to delete. An ID is a graph entity's core_id, or the vector ID "
            "used by /add-vector and quick knowledge (vec_<hash>, quick_<hash>, or a "
            "caller-supplied id). Deletion is idempotent — IDs that are absent are "
            "reported in not_found rather than raising an error."
        ),
    )
    scope: DeleteScope = Field(
        default="all",
        description=(
            "Which store(s) to delete from: 'all' (default) removes each ID from BOTH "
            "the vector store and the graph (node + every attached edge); 'vector' "
            "removes only ChromaDB vectors; 'graph' removes only graph nodes and their edges."
        ),
    )
    project: str | None = Field(default=None, description="Project bundle to scope this to (per-project isolation). Omit = orchestrator/default.")
    data_scope: str = Field(default="knowledge", description="Which per-project PART the vector ids live in (knowledge/log/findings/<custom>); picks kh_<data_scope>_<project>.")
    purge_orphan_documents: bool = Field(
        default=False,
        description=(
            "If true, after deleting run a sweep that removes any KH_DOCUMENTS no longer "
            "referenced by a node (orphans created by this or earlier deletions). It is a "
            "global GC sweep, independent of `ids`. Use the standalone DELETE "
            "/api/documents/orphans for the same sweep without deleting anything else."
        ),
    )


class DeleteKnowledgeResponse(BaseModel):
    status: str = Field(default="ok")
    requested: int = Field(..., description="Number of IDs requested for deletion")
    scope: DeleteScope = Field(..., description="The scope that was applied")
    vectors_deleted: int = Field(default=0, description="Vector entries removed from ChromaDB")
    graph_nodes_deleted: int = Field(default=0, description="Graph nodes removed")
    graph_edges_deleted: int = Field(
        default=0, description="Graph edges removed (every edge attached to a deleted node)"
    )
    documents_deleted: int = Field(
        default=0,
        description="Orphaned KH_DOCUMENTS removed (only when purge_orphan_documents=true)",
    )
    not_found: list[str] = Field(
        default_factory=list,
        description=(
            "Requested IDs that did not exist in the vector store. Only meaningful when "
            "scope includes 'vector' (every graph entity also has a vector keyed by core_id); "
            "empty for scope='graph'."
        ),
    )


class OrphanCleanupResponse(BaseModel):
    status: str = Field(default="ok")
    documents_deleted: int = Field(
        ..., description="Number of orphaned KH_DOCUMENTS removed (no node references them)"
    )


# ---------------------------------------------------------------------------
# /vector/add  — single-call text → embed → store (no LLM)
# ---------------------------------------------------------------------------

class VectorAddRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description=(
            "Text to embed and store in ChromaDB in one call. "
            "Auto-vectorised with the active embedding model (bge-small-en-v1.5 by default, "
            "English-only) — no LLM involved. "
            "Re-adding the same text overwrites the previous entry (idempotent)."
        ),
    )
    id: str | None = Field(
        default=None,
        description=(
            "Optional stable entry ID. If omitted → vec_<sha256(text)[:12]>; "
            "re-adding the same text overwrites the previous entry."
        ),
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Optional extra metadata. Entry is tagged knowledge_type='quick' by default. "
            "metadata.project is the project the row belongs to (the top-level `project` "
            "field is the same thing)."
        ),
    )
    project: str | None = Field(
        default=None,
        description=(
            "The project this row belongs to - the same top-level `project` /vector/query and "
            "/vector/delete take. Copied into metadata.project when that is empty; giving both "
            "with different values is refused (422). With neither, the write touches the "
            "orchestrator, which members may read but not change (403)."
        ),
    )
    scope: str = Field(
        default="knowledge",
        description=(
            "Logical namespace for this entry, stored as metadata.scope. Keeps distinct "
            "record classes from crowding each other at query time. Convention: "
            "'knowledge' (durable facts / C4 nodes), 'log' (REQUEST/WORK/BUG logs), "
            "'personalization' (preferences/rules — excluded from knowledge queries). "
            "A /vector/query scoped to one namespace competes only within it."
        ),
    )


class VectorAddResponse(BaseModel):
    status: str = Field(default="ok")
    vector_id: str = Field(..., description="ChromaDB entry ID of the stored vector")
    dimension: int = Field(..., description="Embedding dimension (384)")


# ---------------------------------------------------------------------------
# /graph/add  — direct structured entity/edge insertion (no LLM)
# ---------------------------------------------------------------------------

class GraphDirectAddRequest(BaseModel):
    entities: list[EntityAttr] = Field(
        ...,
        min_length=1,
        description=(
            "Pre-built entity nodes to insert. Each must have core_id, label, type, source_text. "
            "source_text is embedded and stored in ChromaDB for semantic retrieval. "
            "Duplicate core_ids are overwritten (upsert semantics)."
        ),
    )
    edges: list[EdgeAttr] = Field(
        default_factory=list,
        description="Optional directed edges between entities. Duplicate (src, relation, tgt) triples are skipped.",
    )


class GraphDirectAddResponse(BaseModel):
    status: str = Field(default="ok")
    entities_inserted: int = Field(..., description="Number of entity nodes upserted into the graph DB and ChromaDB")
    edges_inserted: int = Field(..., description="Number of edges passed for insertion (duplicates are silently skipped by the DB)")
    vectors_generated: int = Field(..., description="Number of entity vectors stored in ChromaDB")


# ---------------------------------------------------------------------------
# /graph/query  — direct graph lookup by core_ids (no LLM)
# ---------------------------------------------------------------------------

class GraphDirectQueryRequest(BaseModel):
    core_ids: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Graph node core_ids to fetch. Ontology expansion follows hierarchy edges "
            "(IS_PART_OF, BELONGS_TO, SUBCLASS_OF) up to ONTOLOGY_HOPS levels, "
            "then a 1-hop edge fetch is run over the full expanded set."
        ),
    )


class GraphDirectQueryResponse(BaseModel):
    status: str = Field(default="ok")
    nodes: list[NodeData] = Field(default_factory=list, description="Matched graph nodes including expanded sub-concepts")
    edges: list[EdgeData] = Field(default_factory=list, description="1-hop edges between all matched nodes")


# ---------------------------------------------------------------------------
# /keys/*  — canonical key / entity-resolution index (dedicated collection)
# ---------------------------------------------------------------------------

class KeyAddRequest(BaseModel):
    key: str = Field(
        ...,
        min_length=1,
        description=(
            "Canonical key (stable core_id) — lowercase english snake_case, singular "
            "(e.g. 'banana', 'solace_project'). Re-adding the same key merges aliases "
            "by default (learn-back)."
        ),
    )
    aliases: list[str] = Field(
        default_factory=list,
        description=(
            "Alternative surface forms / spellings / languages that should resolve to "
            "this key (e.g. ['qua chuoi', 'chuoi', 'banana']). Embedded together with "
            "the key so any of them retrieves it."
        ),
    )
    merge: bool = Field(
        default=True,
        description=(
            "True (default) = union the given aliases with any already stored for this "
            "key (learn-back). False = replace the alias set entirely."
        ),
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional extra metadata stored alongside the key (kind='canonical_key' is added automatically).",
    )


    project: str | None = Field(default=None, description="Project bundle to scope this to (per-project isolation). Omit = orchestrator/default.")

class KeyAddResponse(BaseModel):
    status: str = Field(default="ok")
    key: str = Field(..., description="The canonical key that was upserted")
    aliases: list[str] = Field(default_factory=list, description="Full alias set stored after merge/replace")
    dimension: int = Field(..., description="Embedding dimension (384)")


class KeyQueryRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description=(
            "A fuzzy mention to canonicalize. Embedded and matched ONLY against the keys "
            "collection — no knowledge chunks compete — so the right key ranks reliably."
        ),
    )
    k: int = Field(default=5, ge=1, le=50, description="Number of closest canonical keys to return (default: 5)")


    project: str | None = Field(default=None, description="Project bundle to scope this to (per-project isolation). Omit = orchestrator/default.")

class KeyHit(BaseModel):
    key: str = Field(..., description="Canonical key (core_id) of the matched entity")
    score: float = Field(..., description="Cosine similarity (0–1, higher is closer)")
    aliases: list[str] = Field(default_factory=list, description="Alias set stored for this key")
    source_text: str = Field(default="", description="Pipe-joined alias phrase that was embedded")


class KeyQueryResponse(BaseModel):
    hits: list[KeyHit] = Field(
        default_factory=list,
        description="Matched canonical keys sorted by descending similarity score",
    )


class KeyDeleteRequest(BaseModel):
    keys: list[str] = Field(..., min_length=1, description="Canonical keys to remove from the keys collection")


    project: str | None = Field(default=None, description="Project bundle to scope this to (per-project isolation). Omit = orchestrator/default.")

class KeyDeleteResponse(BaseModel):
    status: str = Field(default="ok")
    requested: int = Field(..., description="Number of keys requested for deletion")
    deleted: list[str] = Field(default_factory=list, description="Keys that existed and were deleted")
    not_found: list[str] = Field(default_factory=list, description="Requested keys that were absent")


# ---------------------------------------------------------------------------
# Semantic layers (C4 zoom) — additive over the vector store
# ---------------------------------------------------------------------------

class LayerAddRequest(BaseModel):
    text: str = Field(..., description="Knowledge to store. Long text is C4-decomposed into levels; short text stays one lv1.")
    kind: Literal["knowledge", "policy"] = Field(default="knowledge")
    subject_key: str = Field(default="", description="Subject this fact belongs to; long facts attach to an existing subject's tree.")
    author: str = Field(default="agent:kh", description="Provenance: 'user' (fen) or 'agent:<name>'.")
    epoch: int = Field(default=1, description="Tree epoch; bump on edit to bust compiled flows.")
    ts: str = Field(default="", description="ISO timestamp for recency-based reconcile.")
    auto_layer: bool = Field(default=True, description="Decompose long text via LLM. False = store as a single lv1.")
    project: str | None = Field(default=None, description="Project bundle this C4 tree belongs to (kh_know_<project>). Omit = orchestrator (common).")


class LayerRecordOut(BaseModel):
    id: str
    lv: int
    text: str
    parent_id: str = ""


class LayerAddResponse(BaseModel):
    tree_id: str
    subject_key: str
    kind: str
    layered: bool = Field(description="True when the text was decomposed into >1 level.")
    attached_to: str = Field(default="", description="Existing tree this fact was attached to (T096), if any.")
    records: list[LayerRecordOut] = Field(default_factory=list)


class LayerQueryRequest(BaseModel):
    text: str
    max_level: int = Field(default=1, ge=1, description="Return layers up to this depth (1 = lv1 verdicts only).")
    k: int = Field(default=5, ge=1)
    tree_id: str = Field(default="")
    kind: str = Field(default="")
    project: str | None = Field(default=None, description="Project bundle this C4 tree belongs to (kh_know_<project>). Omit = orchestrator (common).")


class LayerHit(BaseModel):
    vector_id: str
    score: float = 0.0
    text: str
    lv: int = 1
    tree_id: str = ""
    parent_id: str = ""
    subject_key: str = ""


class LayerQueryResponse(BaseModel):
    hits: list[LayerHit] = Field(default_factory=list)


class LayerGatherRequest(BaseModel):
    subject_key: str = Field(..., description="Gather EVERY fact attached to this subject (uncapped by k).")
    reconcile: bool = Field(default=True, description="Resolve conflicts by trust ladder (user>agent, verified, recency).")
    max_level: int | None = Field(default=None, description="Optional depth cap.")
    project: str | None = Field(default=None, description="Project bundle this C4 tree belongs to (kh_know_<project>). Omit = orchestrator (common).")


class LayerGatherResponse(BaseModel):
    subject_key: str
    count: int
    hits: list[LayerHit] = Field(default_factory=list)
