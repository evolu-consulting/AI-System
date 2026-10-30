from abc import ABC, abstractmethod


class GraphDB(ABC):
    """
    Abstract interface for the graph persistence backend.
    Concrete implementations: HanaAdapter (SAP HANA) and KuzuAdapter (Kùzu embedded).
    """

    @abstractmethod
    def probe(self) -> None:
        """Test connectivity — raise on failure."""

    @abstractmethod
    def bootstrap(self) -> None:
        """Create schema / tables if absent. Must be idempotent."""

    @abstractmethod
    def upsert_document(self, source_text: str) -> int | None:
        """
        Persist source text with SHA-256 deduplication.
        Returns a stable integer document ID, or None for blank input.
        """

    @abstractmethod
    def upsert_nodes(self, entities: list[dict]) -> None:
        """
        Upsert a batch of graph nodes.
        Required keys per dict: core_id, type, label, attributes (dict), document_id.
        On conflict (same core_id), overwrite attributes and label.
        """

    @abstractmethod
    def upsert_edges(self, edges: list[dict]) -> None:
        """
        Insert directed edges, silently skipping duplicates.
        Required keys: source_core_id, relation, target_core_id.
        """

    # ── bulk fast-paths (optional; default = per-item) ───────────────────────
    # Backends that can insert a whole batch in one round-trip override these.
    # The default just delegates so every backend stays correct; only speed differs.

    def upsert_nodes_bulk(self, entities: list[dict]) -> None:
        """Bulk node upsert. Default: per-item. Override for a set-based fast path."""
        self.upsert_nodes(entities)

    def upsert_edges_bulk(self, edges: list[dict]) -> None:
        """Bulk edge insert (caller guarantees no duplicates within `edges`).
        Default: per-item. Override for a set-based fast path."""
        self.upsert_edges(edges)

    @abstractmethod
    def delete_nodes(self, core_ids: list[str]) -> dict:
        """
        Delete graph nodes by core_id together with every edge attached to them
        (incoming or outgoing). Idempotent: core_ids that are absent are ignored.

        Returns {"nodes_deleted": int, "edges_deleted": int}.
        """

    @abstractmethod
    def delete_orphan_documents(self) -> int:
        """
        Delete documents in KH_DOCUMENTS that are no longer referenced by any node
        (no KH_GRAPH_NODES row points to their id). Returns the number removed.

        A no-op-safe garbage-collection sweep — typically run after delete_nodes to
        reclaim source documents whose every node has been removed.
        """

    @abstractmethod
    def fetch_graph(
        self,
        core_ids: list[str],
        hierarchy_edges: frozenset[str],
        ontology_hops: int,
    ) -> tuple[list[dict], list[dict]]:
        """
        Two-phase graph retrieval:
          Phase 1 — Ontology expansion: follow hierarchy_edges in reverse
                    (child → parent direction) up to ontology_hops hops to
                    discover all sub-concepts of the seed core_ids.
          Phase 2 — Content retrieval: collect all 1-hop edges attached to
                    the expanded set, then return every involved node.

        Returns (nodes, edges) where each node dict has:
          core_id, entity_type, label, attributes (dict), source_text
        and each edge dict has:
          source_core_id, relation, target_core_id
        """

    # Not abstract: backends that don't implement logic traversal inherit this
    # stub so they still instantiate. Kùzu overrides it.
    def traverse_logic(
        self,
        seed_core_ids: list[str],
        relations: list[str] | None = None,
        max_hops: int = 4,
        direction: str = "out",
        source_prefix: str | None = None,
        exclude_relations: "frozenset[str] | None" = None,
        min_confidence: float = 0.0,
    ) -> tuple[list[dict], list[dict]]:
        """
        Breadth-first walk along CONTENT/LOGIC edges (see KuzuAdapter for the
        reference implementation). Confined to `source_prefix` when given so a
        trace never crosses source boundaries.
        """
        raise NotImplementedError("traverse_logic not implemented for this backend")
