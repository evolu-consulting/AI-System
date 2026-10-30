"""
Kùzu embedded graph database adapter.

Kùzu is a local, file-based property graph database with full Cypher support.
It is used as the fallback backend when SAP HANA is unavailable.

Schema layout:
  Node table  KH_DOCUMENTS    — source document storage (dedup by checksum)
  Node table  KH_GRAPH_NODES  — entity nodes with typed attributes
  Rel  table  KH_GRAPH_EDGES  — directed labelled edges between graph nodes

Threading:
  The kuzu.Database object is thread-safe; kuzu.Connection is not.
  We use threading.local() so each OS thread gets its own connection,
  which is safe because asyncio.to_thread() reuses a fixed thread pool.
"""

import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone

from ..config import KUZU_PATH
from .base import GraphDB

_logger = logging.getLogger(__name__)


def _safe_attrs(raw: str | None) -> dict:
    """Parse a JSON-encoded attributes string safely, always returning a dict."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


class KuzuAdapter(GraphDB):

    def __init__(self, path: str = KUZU_PATH, buffer_pool_size: int = 0) -> None:
        import kuzu  # deferred: only required when Kùzu is the active backend
        self.path = path
        # buffer_pool_size caps this DB's page cache (bytes). 0 = Kùzu default, which
        # reserves a large % of system RAM PER database — dangerous once many
        # per-project graphs are open, so callers pass an explicit small cap.
        if buffer_pool_size and buffer_pool_size > 0:
            self._db = kuzu.Database(path, buffer_pool_size=buffer_pool_size)
        else:
            self._db = kuzu.Database(path)
        self._local = threading.local()
        _logger.info("Kùzu database opened at: %s (buffer_pool=%s)",
                     path, buffer_pool_size or "default")

    def close(self) -> None:
        """Release this DB's connection + buffer pool (LRU eviction / delete-project).

        Frees the buffer pool that the page cache holds. Best-effort across Kùzu
        versions: close the current thread's connection and the Database if they
        expose close(); otherwise drop references so GC reclaims them.
        """
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
            self._local.conn = None
        db = getattr(self, "_db", None)
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
            self._db = None

    # ── internal helpers ────────────────────────────────────────────────────

    def _conn(self):
        """Return a per-thread Kùzu connection (created on first access)."""
        import kuzu
        if not getattr(self._local, "conn", None):
            self._local.conn = kuzu.Connection(self._db)
        return self._local.conn

    def _run(self, query: str, params: dict | None = None):
        """Execute a Cypher query and return the QueryResult."""
        conn = self._conn()
        return conn.execute(query, parameters=params or {})

    @staticmethod
    def _rows(result) -> list[list]:
        """Drain a QueryResult into a list of rows."""
        rows = []
        while result.has_next():
            rows.append(result.get_next())
        return rows

    @staticmethod
    def _doc_id(checksum: str) -> int:
        """Derive a stable INT64 document ID from the SHA-256 checksum."""
        return int(checksum[:15], 16)

    # ── connectivity ────────────────────────────────────────────────────────

    def probe(self) -> None:
        self._run("RETURN 1")

    # ── schema helpers ───────────────────────────────────────────────────────

    def _add_column_if_missing(self, table: str, col: str, dtype: str = "STRING", default: str = "''") -> None:
        """
        Attempt ALTER TABLE ADD COLUMN; silently ignore if the column already exists.
        This makes bootstrap idempotent for databases created before a schema change.
        `default` is a raw Cypher literal (e.g. "''" for STRING, "1.0" for DOUBLE).
        """
        try:
            self._run(f"ALTER TABLE {table} ADD {col} {dtype} DEFAULT {default}")
            _logger.info("Kùzu: added column %s.%s (%s)", table, col, dtype)
        except Exception as exc:
            msg = str(exc).lower()
            if "already exist" in msg or "duplicate" in msg or "already has" in msg:
                pass  # column is already there — expected on re-runs
            else:
                _logger.warning("Kùzu: could not add column %s.%s — %s", table, col, exc)

    # ── bootstrap ────────────────────────────────────────────────────────────

    def bootstrap(self) -> None:
        # Create tables with the full current schema on fresh databases.
        self._run("""
            CREATE NODE TABLE IF NOT EXISTS KH_DOCUMENTS (
                id          INT64,
                checksum    STRING,
                source_text STRING,
                created_at  STRING,
                PRIMARY KEY (id)
            )
        """)
        self._run("""
            CREATE NODE TABLE IF NOT EXISTS KH_GRAPH_NODES (
                core_id     STRING,
                entity_type STRING,
                label       STRING,
                attributes  STRING,
                document_id INT64,
                source_text STRING,
                created_at  STRING,
                updated_at  STRING,
                PRIMARY KEY (core_id)
            )
        """)
        # Edges connect graph nodes; RELATION stored as a property because
        # Kùzu rel tables require a fixed FROM/TO node-table pair.
        # attributes/source_text/confidence carry per-edge evidence so multi-hop
        # logic traversal can be audited (source_text = code location) and gated
        # (confidence: 1.0 = deterministically parsed, lower = LLM-asserted).
        self._run("""
            CREATE REL TABLE IF NOT EXISTS KH_GRAPH_EDGES (
                FROM KH_GRAPH_NODES TO KH_GRAPH_NODES,
                relation    STRING,
                created_at  STRING,
                attributes  STRING,
                source_text STRING,
                confidence  DOUBLE
            )
        """)

        # Self-healing: add columns that may be missing on databases created
        # before this schema version (idempotent — skips if already present).
        self._add_column_if_missing("KH_GRAPH_NODES", "source_text")
        self._add_column_if_missing("KH_GRAPH_NODES", "created_at")
        self._add_column_if_missing("KH_GRAPH_NODES", "updated_at")
        self._add_column_if_missing("KH_GRAPH_EDGES", "created_at")
        self._add_column_if_missing("KH_GRAPH_EDGES", "attributes")
        self._add_column_if_missing("KH_GRAPH_EDGES", "source_text")
        self._add_column_if_missing("KH_GRAPH_EDGES", "confidence", "DOUBLE", "1.0")

        _logger.info("Kùzu schema ready at: %s", self.path)

    # ── write operations ────────────────────────────────────────────────────

    def upsert_document(self, source_text: str) -> int | None:
        if not source_text or not source_text.strip():
            return None

        checksum = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
        doc_id   = self._doc_id(checksum)

        # Idempotent: skip if already present
        result = self._run(
            "MATCH (d:KH_DOCUMENTS {checksum: $cs}) RETURN d.id LIMIT 1",
            {"cs": checksum},
        )
        if result.has_next():
            return result.get_next()[0]

        now = datetime.now(timezone.utc).isoformat()
        self._run(
            """
            CREATE (d:KH_DOCUMENTS {
                id: $id, checksum: $cs, source_text: $txt, created_at: $ts
            })
            """,
            {"id": doc_id, "cs": checksum, "txt": source_text, "ts": now},
        )
        return doc_id

    def upsert_nodes(self, entities: list[dict]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        for entity in entities:
            cid     = entity["core_id"]
            etype   = entity.get("type", "")
            label   = entity.get("label", "")
            raw_attrs = entity.get("attributes") or {}
            attrs   = json.dumps(raw_attrs if isinstance(raw_attrs, dict) else {}, ensure_ascii=False)
            doc_id  = entity.get("document_id") or 0
            src     = entity.get("source_text", "")

            exists = self._rows(self._run(
                "MATCH (n:KH_GRAPH_NODES {core_id: $cid}) RETURN n.core_id LIMIT 1",
                {"cid": cid},
            ))
            if exists:
                # On update: refresh mutable fields only — preserve created_at.
                self._run(
                    """
                    MATCH (n:KH_GRAPH_NODES {core_id: $cid})
                    SET n.entity_type = $et,
                        n.label       = $lbl,
                        n.attributes  = $attrs,
                        n.document_id = $doc_id,
                        n.source_text = $src,
                        n.updated_at  = $ts
                    """,
                    {"cid": cid, "et": etype, "lbl": label,
                     "attrs": attrs, "doc_id": doc_id, "src": src, "ts": now},
                )
            else:
                # On insert: set both created_at and updated_at.
                self._run(
                    """
                    CREATE (n:KH_GRAPH_NODES {
                        core_id:     $cid,
                        entity_type: $et,
                        label:       $lbl,
                        attributes:  $attrs,
                        document_id: $doc_id,
                        source_text: $src,
                        created_at:  $ts,
                        updated_at:  $ts
                    })
                    """,
                    {"cid": cid, "et": etype, "lbl": label,
                     "attrs": attrs, "doc_id": doc_id, "src": src, "ts": now},
                )

    def upsert_edges(self, edges: list[dict]) -> None:
        for edge in edges:
            src = edge["source_core_id"]
            rel = edge["relation"]
            tgt = edge["target_core_id"]
            raw_attrs = edge.get("attributes") or {}
            attrs = json.dumps(raw_attrs if isinstance(raw_attrs, dict) else {}, ensure_ascii=False)
            st = edge.get("source_text", "") or ""
            try:
                conf = float(edge.get("confidence", 1.0))
            except (TypeError, ValueError):
                conf = 1.0

            # If this (src, relation, tgt) triple already exists, REFRESH its
            # evidence/attributes/confidence (re-ingest refines an edge) rather
            # than silently dropping the new evidence.
            dup = self._rows(self._run(
                """
                MATCH (s:KH_GRAPH_NODES {core_id: $src})
                      -[r:KH_GRAPH_EDGES]->
                      (t:KH_GRAPH_NODES {core_id: $tgt})
                WHERE r.relation = $rel
                RETURN count(r) AS cnt
                """,
                {"src": src, "rel": rel, "tgt": tgt},
            ))
            if dup and dup[0][0] > 0:
                self._run(
                    """
                    MATCH (s:KH_GRAPH_NODES {core_id: $src})
                          -[r:KH_GRAPH_EDGES]->
                          (t:KH_GRAPH_NODES {core_id: $tgt})
                    WHERE r.relation = $rel
                    SET r.attributes = $attrs, r.source_text = $st, r.confidence = $conf
                    """,
                    {"src": src, "rel": rel, "tgt": tgt, "attrs": attrs, "st": st, "conf": conf},
                )
                continue

            now = datetime.now(timezone.utc).isoformat()
            self._run(
                """
                MATCH (s:KH_GRAPH_NODES {core_id: $src}),
                      (t:KH_GRAPH_NODES {core_id: $tgt})
                CREATE (s)-[:KH_GRAPH_EDGES {
                    relation: $rel, created_at: $ts,
                    attributes: $attrs, source_text: $st, confidence: $conf
                }]->(t)
                """,
                {"src": src, "rel": rel, "tgt": tgt, "ts": now,
                 "attrs": attrs, "st": st, "conf": conf},
            )

    # ── bulk fast-paths (UNWIND — one round-trip per chunk) ───────────────────
    # Used by high-volume ingestion (code-graph import): replaces N per-row queries
    # with N/chunk set-based queries. Kùzu ≥0.11 supports UNWIND + MERGE.

    _BULK_CHUNK = 1000
    # Edges commit in SMALLER chunks than nodes (SA-7): a crash/power-loss mid-import
    # (e.g. laptop lid closed on the 125k-edge solace-buzz) then loses at most one
    # small chunk, and the WAL resume stays clean. Re-import is idempotent (MERGE).
    _EDGE_BULK_CHUNK = 300

    def upsert_nodes_bulk(self, entities: list[dict]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        rows = []
        for e in entities:
            raw_attrs = e.get("attributes") or {}
            rows.append({
                "cid": e["core_id"],
                "et": e.get("type", ""),
                "lbl": e.get("label", ""),
                "attrs": json.dumps(raw_attrs if isinstance(raw_attrs, dict) else {}, ensure_ascii=False),
                "doc": e.get("document_id") or 0,
                "src": e.get("source_text", "") or "",
                "ts": now,
            })
        # MERGE keeps re-import idempotent; coalesce preserves created_at on updates.
        q = """
            UNWIND $rows AS r
            MERGE (n:KH_GRAPH_NODES {core_id: r.cid})
            SET n.entity_type = r.et, n.label = r.lbl, n.attributes = r.attrs,
                n.document_id = r.doc, n.source_text = r.src,
                n.created_at = coalesce(n.created_at, r.ts), n.updated_at = r.ts
        """
        for i in range(0, len(rows), self._BULK_CHUNK):
            self._run(q, {"rows": rows[i:i + self._BULK_CHUNK]})
        _logger.info("Kùzu upsert_nodes_bulk — %d node(s) in %d chunk(s)",
                     len(rows), (len(rows) + self._BULK_CHUNK - 1) // self._BULK_CHUNK)

    def upsert_edges_bulk(self, edges: list[dict]) -> None:
        # Caller guarantees uniqueness within `edges` (fresh import). We de-dup
        # defensively so a re-run does not double-insert the same triple.
        now = datetime.now(timezone.utc).isoformat()
        seen: set[tuple] = set()
        rows = []
        for e in edges:
            src, rel, tgt = e.get("source_core_id"), e.get("relation"), e.get("target_core_id")
            if not src or not rel or not tgt:
                continue
            key = (src, rel, tgt)
            if key in seen:
                continue
            seen.add(key)
            raw_attrs = e.get("attributes") or {}
            try:
                conf = float(e.get("confidence", 1.0))
            except (TypeError, ValueError):
                conf = 1.0
            rows.append({
                "src": src, "rel": rel, "tgt": tgt,
                "attrs": json.dumps(raw_attrs if isinstance(raw_attrs, dict) else {}, ensure_ascii=False),
                "st": e.get("source_text", "") or "", "conf": conf, "ts": now,
            })
        # MERGE on the (typed) edge keyed by relation prevents duplicate triples.
        q = """
            UNWIND $rows AS r
            MATCH (s:KH_GRAPH_NODES {core_id: r.src}), (t:KH_GRAPH_NODES {core_id: r.tgt})
            MERGE (s)-[e:KH_GRAPH_EDGES {relation: r.rel}]->(t)
            SET e.created_at = coalesce(e.created_at, r.ts),
                e.attributes = r.attrs, e.source_text = r.st, e.confidence = r.conf
        """
        for i in range(0, len(rows), self._EDGE_BULK_CHUNK):
            self._run(q, {"rows": rows[i:i + self._EDGE_BULK_CHUNK]})
        _logger.info("Kùzu upsert_edges_bulk — %d edge(s) in %d chunk(s)",
                     len(rows), (len(rows) + self._EDGE_BULK_CHUNK - 1) // self._EDGE_BULK_CHUNK)

    # ── delete operations ────────────────────────────────────────────────────

    def delete_nodes(self, core_ids: list[str]) -> dict:
        if not core_ids:
            return {"nodes_deleted": 0, "edges_deleted": 0}

        # Count what will be removed BEFORE deleting (DETACH DELETE returns nothing).
        node_rows = self._rows(self._run(
            "MATCH (n:KH_GRAPH_NODES) WHERE n.core_id IN $ids RETURN count(n)",
            {"ids": core_ids},
        ))
        nodes_deleted = int(node_rows[0][0]) if node_rows else 0

        edge_rows = self._rows(self._run(
            """
            MATCH (s:KH_GRAPH_NODES)-[r:KH_GRAPH_EDGES]->(t:KH_GRAPH_NODES)
            WHERE s.core_id IN $ids OR t.core_id IN $ids
            RETURN count(r)
            """,
            {"ids": core_ids},
        ))
        edges_deleted = int(edge_rows[0][0]) if edge_rows else 0

        # DETACH DELETE removes the node and every edge connected to it atomically.
        self._run(
            "MATCH (n:KH_GRAPH_NODES) WHERE n.core_id IN $ids DETACH DELETE n",
            {"ids": core_ids},
        )
        _logger.info(
            "Kùzu delete_nodes — removed %d node(s), %d edge(s)",
            nodes_deleted, edges_deleted,
        )
        return {"nodes_deleted": nodes_deleted, "edges_deleted": edges_deleted}

    def delete_orphan_documents(self) -> int:
        # Documents referenced by at least one node are kept; the rest are orphans.
        # Computed in Python (set difference) to stay portable across Kùzu versions
        # that vary in NOT EXISTS / anti-join subquery support.
        referenced = {
            row[0] for row in self._rows(self._run(
                "MATCH (n:KH_GRAPH_NODES) WHERE n.document_id IS NOT NULL "
                "RETURN DISTINCT n.document_id"
            ))
            if row[0] is not None
        }
        all_doc_ids = [
            row[0] for row in self._rows(self._run("MATCH (d:KH_DOCUMENTS) RETURN d.id"))
            if row[0] is not None
        ]
        orphans = [doc_id for doc_id in all_doc_ids if doc_id not in referenced]
        if orphans:
            self._run(
                "MATCH (d:KH_DOCUMENTS) WHERE d.id IN $ids DETACH DELETE d",
                {"ids": orphans},
            )
        _logger.info("Kùzu delete_orphan_documents — removed %d document(s)", len(orphans))
        return len(orphans)

    # ── read / graph retrieval ───────────────────────────────────────────────

    def _expand_ontology(
        self,
        core_ids: list[str],
        hierarchy_edges: frozenset[str],
        hops: int,
    ) -> set[str]:
        """
        Follow hierarchy edges in reverse (child → parent direction) to discover
        all sub-concepts of the seed nodes, up to `hops` levels deep.

        Edge direction convention (same as HANA):
          child -[:KH_GRAPH_EDGES {relation: 'IS_PART_OF'}]-> parent

        So "reverse traversal to find children" means:
          (child) -[r]-> (parent)  WHERE parent IN frontier AND r.relation IN hierarchy_edges

        Iterates hop-by-hop to avoid variable-length path list comprehension syntax
        that is not supported in all Kùzu versions.
        """
        if not core_ids:
            return set(core_ids)

        expanded: set[str] = set(core_ids)
        frontier: list[str] = list(core_ids)
        he = list(hierarchy_edges)

        for hop in range(hops):
            if not frontier:
                break
            try:
                result = self._run(
                    """
                    MATCH (sub:KH_GRAPH_NODES)-[r:KH_GRAPH_EDGES]->(target:KH_GRAPH_NODES)
                    WHERE target.core_id IN $ids AND r.relation IN $he
                    RETURN DISTINCT sub.core_id AS core_id
                    """,
                    {"ids": frontier, "he": he},
                )
                new_nodes = {row[0] for row in self._rows(result) if row[0]} - expanded
                expanded |= new_nodes
                frontier = list(new_nodes)
            except Exception as exc:
                _logger.warning("Kùzu ontology hop %d failed: %s", hop + 1, exc)
                break

        _logger.info(
            "Kùzu ontology expansion: seed=%d → expanded=%d",
            len(core_ids), len(expanded),
        )
        return expanded

    def _fetch_edges_1hop(self, core_ids: list[str]) -> list[dict]:
        if not core_ids:
            return []
        # Try full schema (edge evidence columns). Fall back to legacy edges
        # (relation + created_at only) if the columns don't exist yet.
        try:
            result = self._run(
                """
                MATCH (s:KH_GRAPH_NODES)-[r:KH_GRAPH_EDGES]->(t:KH_GRAPH_NODES)
                WHERE s.core_id IN $ids OR t.core_id IN $ids
                RETURN s.core_id AS src, r.relation AS rel, t.core_id AS tgt,
                       r.created_at AS created_at, r.attributes AS attrs,
                       r.source_text AS st, r.confidence AS conf
                """,
                {"ids": core_ids},
            )
            rows = self._rows(result)
            has_evidence = True
        except Exception as exc:
            if "attributes" in str(exc) or "source_text" in str(exc) or "confidence" in str(exc) \
               or "cannot find property" in str(exc).lower():
                result = self._run(
                    """
                    MATCH (s:KH_GRAPH_NODES)-[r:KH_GRAPH_EDGES]->(t:KH_GRAPH_NODES)
                    WHERE s.core_id IN $ids OR t.core_id IN $ids
                    RETURN s.core_id AS src, r.relation AS rel, t.core_id AS tgt,
                           r.created_at AS created_at
                    """,
                    {"ids": core_ids},
                )
                rows = self._rows(result)
                has_evidence = False
            else:
                raise
        edges = []
        for row in rows:
            src, rel, tgt = row[0], row[1], row[2]
            if not src or not rel or not tgt:
                _logger.debug("Kùzu: skipping edge with missing field(s) src=%r rel=%r tgt=%r", src, rel, tgt)
                continue
            edge = {
                "source_core_id": str(src),
                "relation":       str(rel),
                "target_core_id": str(tgt),
                "created_at":     str(row[3]) if row[3] else "",
            }
            if has_evidence:
                edge["attributes"]  = _safe_attrs(row[4])
                edge["source_text"] = str(row[5]) if row[5] else ""
                try:
                    edge["confidence"] = float(row[6]) if row[6] is not None else 1.0
                except (TypeError, ValueError):
                    edge["confidence"] = 1.0
            else:
                edge["attributes"], edge["source_text"], edge["confidence"] = {}, "", 1.0
            edges.append(edge)
        return edges

    # ── logic multi-hop traversal (source-scoped) ─────────────────────────────

    def traverse_logic(
        self,
        seed_core_ids: list[str],
        relations: list[str] | None = None,
        max_hops: int = 4,
        direction: str = "out",
        source_prefix: str | None = None,
        exclude_relations: frozenset[str] | None = None,
        min_confidence: float = 0.0,
    ) -> tuple[list[dict], list[dict]]:
        """
        Breadth-first traversal along CONTENT/LOGIC edges (NOT the hierarchy
        expansion of fetch_graph). Follows edges hop-by-hop up to `max_hops`.

        - relations: whitelist of relation labels to follow. None → follow every
          relation EXCEPT `exclude_relations` (defaults to the containment set so
          a bare traversal does not explode down PART_OF trees).
        - direction: 'out' (source→target), 'in' (target→source), or 'both'.
        - source_prefix: confine the walk to one source's namespace — nodes whose
          core_id does not start with the prefix are never crossed. This is what
          keeps two conflicting forks from blending during a logic trace.
        - min_confidence: skip edges below this confidence.

        Returns (nodes, edges) covering everything the walk touched.
        """
        seeds = [c for c in (seed_core_ids or []) if c]
        if not seeds:
            return [], []
        if exclude_relations is None:
            exclude_relations = frozenset({
                "IS_PART_OF", "BELONGS_TO", "SUBCLASS_OF", "PART_OF",
                "SUBCATEGORY_OF", "HAS_PART", "HAS_MODULE",
            })
        rel_whitelist = list(relations) if relations else None

        def _keep(core_id: str) -> bool:
            if not core_id:
                return False
            if source_prefix and not core_id.startswith(source_prefix):
                return False
            return True

        visited: set[str] = {s for s in seeds if _keep(s)} or set(seeds)
        frontier: list[str] = list(visited)
        collected: dict[tuple, dict] = {}

        def _run_hop(front: list[str], outgoing: bool) -> set[str]:
            if not front:
                return set()
            if outgoing:
                pattern = "(a:KH_GRAPH_NODES)-[r:KH_GRAPH_EDGES]->(b:KH_GRAPH_NODES) WHERE a.core_id IN $ids"
            else:
                pattern = "(b:KH_GRAPH_NODES)-[r:KH_GRAPH_EDGES]->(a:KH_GRAPH_NODES) WHERE a.core_id IN $ids"
            q = (
                f"MATCH {pattern} "
                "RETURN a.core_id AS anchor, b.core_id AS other, r.relation AS rel, "
                "r.attributes AS attrs, r.source_text AS st, r.confidence AS conf"
            )
            try:
                rows = self._rows(self._run(q, {"ids": front}))
            except Exception as exc:
                _logger.warning("Kùzu traverse hop failed (%s): %s", "out" if outgoing else "in", exc)
                return set()
            discovered: set[str] = set()
            for row in rows:
                anchor, other, rel = row[0], row[1], row[2]
                if not other or not rel:
                    continue
                if rel_whitelist is not None:
                    if rel not in rel_whitelist:
                        continue
                elif rel in exclude_relations:
                    continue
                try:
                    conf = float(row[5]) if row[5] is not None else 1.0
                except (TypeError, ValueError):
                    conf = 1.0
                if conf < min_confidence:
                    continue
                if not _keep(other):
                    continue
                src_id, tgt_id = (anchor, other) if outgoing else (other, anchor)
                collected[(src_id, rel, tgt_id)] = {
                    "source_core_id": str(src_id),
                    "relation": str(rel),
                    "target_core_id": str(tgt_id),
                    "attributes": _safe_attrs(row[3]),
                    "source_text": str(row[4]) if row[4] else "",
                    "confidence": conf,
                    "created_at": "",
                }
                discovered.add(other)
            return discovered

        for _ in range(max_hops):
            if not frontier:
                break
            newly: set[str] = set()
            if direction in ("out", "both"):
                newly |= _run_hop(frontier, outgoing=True)
            if direction in ("in", "both"):
                newly |= _run_hop(frontier, outgoing=False)
            newly -= visited
            visited |= newly
            frontier = list(newly)

        nodes = self._fetch_nodes(list(visited))
        return nodes, list(collected.values())

    def _fetch_nodes(self, core_ids: list[str]) -> list[dict]:
        if not core_ids:
            return []
        # Try full schema (v5+: includes source_text column).
        # Fall back to legacy schema if the column doesn't exist yet (run run_migration_v5.py to upgrade).
        try:
            raw = self._rows(self._run(
                """
                MATCH (n:KH_GRAPH_NODES)
                WHERE n.core_id IN $ids
                RETURN n.core_id, n.entity_type, n.label, n.attributes,
                       n.source_text, n.created_at, n.updated_at
                """,
                {"ids": core_ids},
            ))
            src_col, ca_col, ua_col = 4, 5, 6
        except Exception as exc:
            if "source_text" in str(exc) or "Cannot find property" in str(exc).lower():
                _logger.warning(
                    "Kùzu: source_text column missing — falling back to legacy fetch "
                    "(run run_migration_v5.py to upgrade existing databases)"
                )
                raw = self._rows(self._run(
                    """
                    MATCH (n:KH_GRAPH_NODES)
                    WHERE n.core_id IN $ids
                    RETURN n.core_id, n.entity_type, n.label, n.attributes,
                           n.created_at, n.updated_at
                    """,
                    {"ids": core_ids},
                ))
                src_col, ca_col, ua_col = None, 4, 5
            else:
                raise

        nodes = []
        for row in raw:
            if not row[0]:
                continue
            nodes.append({
                "core_id":     str(row[0]),
                "entity_type": str(row[1]) if row[1] else "",
                "label":       str(row[2]) if row[2] else "",
                "attributes":  _safe_attrs(row[3]),
                "source_text": str(row[src_col]) if src_col is not None and row[src_col] else "",
                "created_at":  str(row[ca_col]) if row[ca_col] else "",
                "updated_at":  str(row[ua_col]) if row[ua_col] else "",
            })
        return nodes

    def fetch_graph(
        self,
        core_ids: list[str],
        hierarchy_edges: frozenset[str],
        ontology_hops: int,
    ) -> tuple[list[dict], list[dict]]:
        # Phase 1: ontology expansion
        expanded = self._expand_ontology(core_ids, hierarchy_edges, ontology_hops)

        # Phase 2: 1-hop content edges from the full expanded set
        all_edges_raw = self._fetch_edges_1hop(list(expanded))

        all_ids: set[str] = set(expanded)
        for e in all_edges_raw:
            all_ids.add(e["source_core_id"])
            all_ids.add(e["target_core_id"])

        nodes = self._fetch_nodes(list(all_ids))

        edge_keys: set[tuple] = set()
        all_edges: list[dict] = []
        for e in all_edges_raw:
            key = (e["source_core_id"], e["relation"], e["target_core_id"])
            if key not in edge_keys:
                edge_keys.add(key)
                all_edges.append(e)

        return nodes, all_edges
