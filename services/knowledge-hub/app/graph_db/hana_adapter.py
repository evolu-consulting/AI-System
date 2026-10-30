"""
SAP HANA graph database adapter.

Wraps the connection pool and all DDL/DML operations that were previously
spread across app/db.py and the graph-retrieval helpers in app/retriever.py.

ONE ADAPTER PER GRAPH, ONE POOL FOR ALL (2026-09-23). An adapter is bound to a table
prefix: the default ``KH_`` gives the original global tables (KH_DOCUMENTS,
KH_GRAPH_NODES, KH_GRAPH_EDGES, workspace GRAPH_WORKSPACE); a project graph gets its
own prefix from :func:`project_prefix`, so each project owns separate tables - the
same physical isolation the per-project Kùzu directories give locally (B3). All
adapters share one connection pool, so opening many project graphs does not open
many connections.
"""

import hashlib
import json
import logging
import re
from threading import Lock

from .. import config
from ..config import GRAPH_WORKSPACE, HANA_SCHEMA
from .base import GraphDB

_logger = logging.getLogger(__name__)

#: Prefix of the global graph tables; KH_GRAPH_TABLE_PREFIX, default "KH_".
DEFAULT_PREFIX = config.GRAPH_TABLE_PREFIX

#: Containment relations a bare logic traversal does not follow (same set as Kùzu).
_DEFAULT_EXCLUDE = frozenset({
    "IS_PART_OF", "BELONGS_TO", "SUBCLASS_OF", "PART_OF",
    "SUBCATEGORY_OF", "HAS_PART", "HAS_MODULE",
})


def _lob(value):
    """NCLOB columns come back from hdbcli as LOB handles; read them to text."""
    if value is not None and hasattr(value, "read"):
        data = value.read()
        return data.decode("utf-8") if isinstance(data, bytes) else data
    return value


def _safe_attrs(raw) -> dict:
    """Parse a JSON-encoded attributes string safely, always returning a dict."""
    raw = _lob(raw)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _attrs_json(value) -> str:
    return json.dumps(value if isinstance(value, dict) else {}, ensure_ascii=False)


def _conf(value) -> float:
    try:
        return float(value if value is not None else 1.0)
    except (TypeError, ValueError):
        return 1.0


def project_prefix(project_id: str) -> str:
    """Table prefix for one project's graph: readable, and collision-proof by hash."""
    slug = re.sub(r"[^A-Z0-9]+", "_", project_id.upper()).strip("_")[:40]
    digest = hashlib.sha1(project_id.encode("utf-8")).hexdigest()[:6].upper()
    return f"{DEFAULT_PREFIX}P_{slug}_{digest}_"


# HANA settings imported from app.config (single source of truth).


# ---------------------------------------------------------------------------
# Connection pool (shared by every adapter)
# ---------------------------------------------------------------------------
# The pool class and the connect arguments live in app/hana_conn.py, so this pool and
# the stores pool read the same HANA_* settings (TLS, certificate check, connect
# timeout, overflow, recycle). This one keeps its own instance and its own wait
# timeout, and does not SET SCHEMA: bootstrap() below creates the schema when it is
# missing, and every statement here names the schema explicitly.

_SHARED_POOL = None
_SHARED_LOCK = Lock()


def _shared_pool():
    global _SHARED_POOL
    with _SHARED_LOCK:
        if _SHARED_POOL is None:
            from app import hana_conn
            _SHARED_POOL = hana_conn._Pool(
                size=max(1, config.HANA_POOL_SIZE),
                timeout=config.HANA_GRAPH_POOL_TIMEOUT_S,
                overflow=config.HANA_MAX_OVERFLOW,
                recycle=config.HANA_POOL_RECYCLE_S,
                set_schema=False,
            )
        return _SHARED_POOL


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

class HanaAdapter(GraphDB):

    _BULK_CHUNK = 1000

    def __init__(self, table_prefix: str = DEFAULT_PREFIX) -> None:
        self._pool = _shared_pool()
        self.prefix = table_prefix
        self._docs_t = f"{table_prefix}DOCUMENTS"
        self._nodes_t = f"{table_prefix}GRAPH_NODES"
        self._edges_t = f"{table_prefix}GRAPH_EDGES"
        self._ws = GRAPH_WORKSPACE if table_prefix == DEFAULT_PREFIX else f"{table_prefix}GRAPH_WS"
        s = HANA_SCHEMA
        self._docs = f'"{s}"."{self._docs_t}"'
        self._nodes = f'"{s}"."{self._nodes_t}"'
        self._edges = f'"{s}"."{self._edges_t}"'
        self._wsq = f'"{s}"."{self._ws}"'

    # ── connectivity ────────────────────────────────────────────────────────

    def probe(self) -> None:
        conn = self._pool.acquire()
        self._pool.release(conn)

    def close(self) -> None:
        """Nothing to release per graph: the connection pool is shared."""

    # ── bootstrap ────────────────────────────────────────────────────────────

    def bootstrap(self) -> None:
        conn = self._pool.acquire()
        try:
            cur = conn.cursor()
            try:
                if not self._schema_exists(cur):
                    cur.execute(f'CREATE SCHEMA "{HANA_SCHEMA}"')
                    _logger.info("Created HANA schema: %s", HANA_SCHEMA)

                if not self._table_exists(cur, self._docs_t):
                    cur.execute(f"""
                        CREATE COLUMN TABLE {self._docs} (
                            "ID"          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                            "CHECKSUM"    NVARCHAR(64) NOT NULL,
                            "SOURCE_TEXT" NCLOB NOT NULL,
                            "CREATED_AT"  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE ("CHECKSUM")
                        )
                    """)
                    _logger.info("Created table: %s", self._docs_t)

                if not self._table_exists(cur, self._nodes_t):
                    cur.execute(f"""
                        CREATE COLUMN TABLE {self._nodes} (
                            "CORE_ID"      NVARCHAR(500) NOT NULL PRIMARY KEY,
                            "ENTITY_TYPE"  NVARCHAR(100),
                            "LABEL"        NVARCHAR(500),
                            "ATTRIBUTES"   NCLOB,
                            "DOCUMENT_ID"  BIGINT,
                            "SOURCE_TEXT"  NCLOB,
                            "CREATED_AT"   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            "UPDATED_AT"   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    """)
                    _logger.info("Created table: %s", self._nodes_t)
                else:
                    self._add_col_if_missing(cur, self._nodes_t, "SOURCE_TEXT", "NCLOB")

                if not self._table_exists(cur, self._edges_t):
                    cur.execute(f"""
                        CREATE COLUMN TABLE {self._edges} (
                            "ID"             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                            "SOURCE_CORE_ID" NVARCHAR(500) NOT NULL,
                            "RELATION"       NVARCHAR(200) NOT NULL,
                            "TARGET_CORE_ID" NVARCHAR(500) NOT NULL,
                            "CREATED_AT"     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            "ATTRIBUTES"     NCLOB,
                            "SOURCE_TEXT"    NCLOB,
                            "CONFIDENCE"     DOUBLE,
                            UNIQUE ("SOURCE_CORE_ID", "RELATION", "TARGET_CORE_ID")
                        )
                    """)
                    _logger.info("Created table: %s", self._edges_t)
                else:
                    # Edge evidence, as the Kùzu edges carry it (added 2026-09-23).
                    self._add_col_if_missing(cur, self._edges_t, "ATTRIBUTES", "NCLOB")
                    self._add_col_if_missing(cur, self._edges_t, "SOURCE_TEXT", "NCLOB")
                    self._add_col_if_missing(cur, self._edges_t, "CONFIDENCE", "DOUBLE")

                # Graph Workspace: needed for multi-hop OpenCypher queries.
                # Silently skipped when Graph Engine is not licensed on this instance.
                try:
                    if not self._workspace_exists(cur):
                        cur.execute(f"""
                            CREATE GRAPH WORKSPACE {self._wsq}
                            EDGE TABLE {self._edges}
                                SOURCE COLUMN "SOURCE_CORE_ID"
                                TARGET COLUMN "TARGET_CORE_ID"
                                KEY COLUMN "ID"
                            VERTEX TABLE {self._nodes}
                                KEY COLUMN "CORE_ID"
                        """)
                        _logger.info("Created graph workspace: %s", self._ws)
                except Exception as exc:
                    _logger.warning("Graph workspace skipped (Graph Engine unavailable): %s", exc)

                conn.commit()
            finally:
                cur.close()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            self._pool.release(conn)

    def drop(self) -> bool:
        """Drop this graph's workspace and tables (delete-project). True if any existed."""
        dropped = False
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                if self._workspace_exists(cur):
                    cur.execute(f"DROP GRAPH WORKSPACE {self._wsq}")
                    dropped = True
                for name, q in ((self._edges_t, self._edges), (self._nodes_t, self._nodes),
                                (self._docs_t, self._docs)):
                    if self._table_exists(cur, name):
                        cur.execute(f"DROP TABLE {q}")
                        dropped = True
            finally:
                cur.close()
        return dropped

    def _schema_exists(self, cur) -> bool:
        cur.execute("SELECT COUNT(*) FROM SYS.SCHEMAS WHERE SCHEMA_NAME = ?", [HANA_SCHEMA.upper()])
        return cur.fetchone()[0] > 0

    def _table_exists(self, cur, table_name: str) -> bool:
        cur.execute(
            "SELECT COUNT(*) FROM SYS.TABLES WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?",
            [HANA_SCHEMA.upper(), table_name.upper()],
        )
        return cur.fetchone()[0] > 0

    def _workspace_exists(self, cur) -> bool:
        try:
            cur.execute(
                "SELECT COUNT(*) FROM SYS.GRAPH_WORKSPACES "
                "WHERE SCHEMA_NAME = ? AND WORKSPACE_NAME = ?",
                [HANA_SCHEMA.upper(), self._ws.upper()],
            )
            return cur.fetchone()[0] > 0
        except Exception:
            return False

    def _add_col_if_missing(self, cur, table: str, col: str, dtype: str) -> None:
        cur.execute(
            "SELECT COUNT(*) FROM SYS.TABLE_COLUMNS "
            "WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
            [HANA_SCHEMA.upper(), table.upper(), col.upper()],
        )
        if cur.fetchone()[0] == 0:
            cur.execute(f'ALTER TABLE "{HANA_SCHEMA}"."{table}" ADD ("{col}" {dtype})')
            _logger.info("HANA: added column %s.%s (%s)", table, col, dtype)

    # ── write operations ────────────────────────────────────────────────────

    def upsert_document(self, source_text: str) -> int | None:
        if not source_text or not source_text.strip():
            return None
        checksum = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(
                    f'INSERT INTO {self._docs} ("SOURCE_TEXT", "CHECKSUM")'
                    f' SELECT ?, ? FROM DUMMY'
                    f' WHERE NOT EXISTS ('
                    f'   SELECT 1 FROM {self._docs} WHERE "CHECKSUM" = ?'
                    f')',
                    [source_text, checksum, checksum],
                )
                cur.execute(
                    f'SELECT "ID" FROM {self._docs} WHERE "CHECKSUM" = ?',
                    [checksum],
                )
                row = cur.fetchone()
                return row[0] if row else None
            finally:
                cur.close()

    def _node_merge_sql(self) -> str:
        # MERGE INTO: on UPDATE touch only mutable fields, preserve CREATED_AT.
        # On INSERT set both CREATED_AT and UPDATED_AT to now.
        return f"""
            MERGE INTO {self._nodes} AS T
            USING (SELECT ? AS "CORE_ID", ? AS "ENTITY_TYPE",
                          ? AS "LABEL",   ? AS "ATTRIBUTES",
                          ? AS "DOCUMENT_ID", ? AS "SOURCE_TEXT" FROM DUMMY) AS S
            ON T."CORE_ID" = S."CORE_ID"
            WHEN MATCHED THEN UPDATE SET
                T."ENTITY_TYPE"  = S."ENTITY_TYPE",
                T."LABEL"        = S."LABEL",
                T."ATTRIBUTES"   = S."ATTRIBUTES",
                T."DOCUMENT_ID"  = S."DOCUMENT_ID",
                T."SOURCE_TEXT"  = S."SOURCE_TEXT",
                T."UPDATED_AT"   = CURRENT_TIMESTAMP
            WHEN NOT MATCHED THEN INSERT
                ("CORE_ID", "ENTITY_TYPE", "LABEL", "ATTRIBUTES",
                 "DOCUMENT_ID", "SOURCE_TEXT", "CREATED_AT", "UPDATED_AT")
            VALUES
                (S."CORE_ID", S."ENTITY_TYPE", S."LABEL", S."ATTRIBUTES",
                 S."DOCUMENT_ID", S."SOURCE_TEXT", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """

    @staticmethod
    def _node_row(entity: dict) -> list:
        return [
            entity["core_id"],
            entity.get("type", ""),
            entity.get("label", ""),
            _attrs_json(entity.get("attributes") or {}),
            entity.get("document_id"),
            entity.get("source_text", ""),
        ]

    def _edge_merge_sql(self) -> str:
        # Re-ingest REFRESHES an existing triple's evidence instead of dropping it,
        # matching the Kùzu adapter.
        return f"""
            MERGE INTO {self._edges} AS T
            USING (SELECT ? AS "SOURCE_CORE_ID", ? AS "RELATION", ? AS "TARGET_CORE_ID",
                          ? AS "ATTRIBUTES", ? AS "SOURCE_TEXT", ? AS "CONFIDENCE" FROM DUMMY) AS S
            ON T."SOURCE_CORE_ID" = S."SOURCE_CORE_ID" AND T."RELATION" = S."RELATION"
               AND T."TARGET_CORE_ID" = S."TARGET_CORE_ID"
            WHEN MATCHED THEN UPDATE SET
                T."ATTRIBUTES" = S."ATTRIBUTES",
                T."SOURCE_TEXT" = S."SOURCE_TEXT",
                T."CONFIDENCE" = S."CONFIDENCE"
            WHEN NOT MATCHED THEN INSERT
                ("SOURCE_CORE_ID", "RELATION", "TARGET_CORE_ID", "CREATED_AT",
                 "ATTRIBUTES", "SOURCE_TEXT", "CONFIDENCE")
            VALUES
                (S."SOURCE_CORE_ID", S."RELATION", S."TARGET_CORE_ID", CURRENT_TIMESTAMP,
                 S."ATTRIBUTES", S."SOURCE_TEXT", S."CONFIDENCE")
        """

    @staticmethod
    def _edge_row(edge: dict) -> list:
        return [
            edge["source_core_id"],
            edge["relation"],
            edge["target_core_id"],
            _attrs_json(edge.get("attributes") or {}),
            edge.get("source_text", "") or "",
            _conf(edge.get("confidence", 1.0)),
        ]

    def upsert_nodes(self, entities: list[dict]) -> None:
        sql = self._node_merge_sql()
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                for entity in entities:
                    cur.execute(sql, self._node_row(entity))
            finally:
                cur.close()

    def upsert_edges(self, edges: list[dict]) -> None:
        sql = self._edge_merge_sql()
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                for edge in edges:
                    cur.execute(sql, self._edge_row(edge))
            finally:
                cur.close()

    # ── bulk fast-paths (executemany — one round-trip per chunk) ─────────────

    def upsert_nodes_bulk(self, entities: list[dict]) -> None:
        rows = [self._node_row(e) for e in entities if e.get("core_id")]
        self._bulk(self._node_merge_sql(), rows, "nodes")

    def upsert_edges_bulk(self, edges: list[dict]) -> None:
        seen: set[tuple] = set()
        rows = []
        for e in edges:
            key = (e.get("source_core_id"), e.get("relation"), e.get("target_core_id"))
            if not all(key) or key in seen:
                continue
            seen.add(key)
            rows.append(self._edge_row(e))
        self._bulk(self._edge_merge_sql(), rows, "edges")

    def _bulk(self, sql: str, rows: list[list], what: str) -> None:
        for i in range(0, len(rows), self._BULK_CHUNK):
            with self._pool.connection() as conn:
                cur = conn.cursor()
                try:
                    cur.executemany(sql, rows[i:i + self._BULK_CHUNK])
                finally:
                    cur.close()
        _logger.info("HANA upsert_%s_bulk [%s] — %d row(s) in %d chunk(s)", what, self.prefix,
                     len(rows), (len(rows) + self._BULK_CHUNK - 1) // self._BULK_CHUNK)

    # ── delete operations ────────────────────────────────────────────────────

    def delete_nodes(self, core_ids: list[str]) -> dict:
        if not core_ids:
            return {"nodes_deleted": 0, "edges_deleted": 0}

        ph = ", ".join(["?"] * len(core_ids))
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                # Edges first — no FK cascade is defined, so detach explicitly.
                cur.execute(
                    f'DELETE FROM {self._edges} '
                    f'WHERE "SOURCE_CORE_ID" IN ({ph}) OR "TARGET_CORE_ID" IN ({ph})',
                    core_ids + core_ids,
                )
                edges_deleted = cur.rowcount if (cur.rowcount and cur.rowcount > 0) else 0

                cur.execute(
                    f'DELETE FROM {self._nodes} '
                    f'WHERE "CORE_ID" IN ({ph})',
                    core_ids,
                )
                nodes_deleted = cur.rowcount if (cur.rowcount and cur.rowcount > 0) else 0

                _logger.info(
                    "HANA delete_nodes — removed %d node(s), %d edge(s)",
                    nodes_deleted, edges_deleted,
                )
                return {"nodes_deleted": nodes_deleted, "edges_deleted": edges_deleted}
            finally:
                cur.close()

    def delete_orphan_documents(self) -> int:
        # Delete documents not referenced by any node. The subquery filters out NULL
        # DOCUMENT_IDs so the NOT IN predicate cannot be poisoned by a NULL row.
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(
                    f'DELETE FROM {self._docs} '
                    f'WHERE "ID" NOT IN ('
                    f'  SELECT DISTINCT "DOCUMENT_ID" FROM {self._nodes} '
                    f'  WHERE "DOCUMENT_ID" IS NOT NULL'
                    f')'
                )
                deleted = cur.rowcount if (cur.rowcount and cur.rowcount > 0) else 0
                _logger.info("HANA delete_orphan_documents — removed %d document(s)", deleted)
                return deleted
            finally:
                cur.close()

    # ── read / graph retrieval ───────────────────────────────────────────────

    def _execute_cypher(self, cypher: str) -> list[dict]:
        escaped = cypher.replace("'", "''")
        sql = (
            f'SELECT * FROM OPENCYPHER_TABLE('
            f'  GRAPH WORKSPACE {self._wsq},'
            f"  '{escaped}'"
            f')'
        )
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(sql)
                if cur.description is None:
                    return []
                cols = [d[0].upper() for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
            except Exception as exc:
                raise RuntimeError(f"OPENCYPHER_TABLE error: {exc}") from exc
            finally:
                cur.close()

    def _expand_ontology_cypher(
        self,
        core_ids: list[str],
        hierarchy_edges: frozenset[str],
        hops: int,
    ) -> set[str] | None:
        ids_in  = "[" + ", ".join(f'"{cid}"' for cid in core_ids) + "]"
        he_list = "[" + ", ".join(f'"{h}"' for h in hierarchy_edges) + "]"
        cypher = (
            f'MATCH (n) WHERE n.CORE_ID IN {ids_in} RETURN n.CORE_ID AS core_id '
            f'UNION '
            f'MATCH (target)<-[r*1..{hops}]-(sub) '
            f'WHERE target.CORE_ID IN {ids_in} '
            f'AND ALL(rel IN r WHERE rel.RELATION IN {he_list}) '
            f'RETURN sub.CORE_ID AS core_id'
        )
        try:
            rows = self._execute_cypher(cypher)
            expanded = {(r.get("CORE_ID") or r.get("core_id")) for r in rows} - {None}
            _logger.info(
                "HANA cypher expansion [%s]: seed=%d → expanded=%d",
                self._ws, len(core_ids), len(expanded),
            )
            return expanded or set(core_ids)
        except RuntimeError as exc:
            _logger.warning("OPENCYPHER_TABLE unavailable — SQL fallback: %s", exc)
            return None

    def _expand_ontology_sql(
        self,
        cur,
        core_ids: list[str],
        hierarchy_edges: frozenset[str],
        hops: int,
    ) -> set[str]:
        if not core_ids:
            return set()
        if not hierarchy_edges:
            return set(core_ids)
        he_ph = ", ".join(["?"] * len(hierarchy_edges))
        expanded: set[str] = set(core_ids)
        frontier: set[str] = set(core_ids)
        for hop in range(hops):
            if not frontier:
                break
            f_ph = ", ".join(["?"] * len(frontier))
            cur.execute(
                f'SELECT DISTINCT "SOURCE_CORE_ID" '
                f'FROM {self._edges} '
                f'WHERE "TARGET_CORE_ID" IN ({f_ph}) AND "RELATION" IN ({he_ph})',
                list(frontier) + list(hierarchy_edges),
            )
            new_nodes: set[str] = {r[0] for r in cur.fetchall()} - expanded
            if new_nodes:
                _logger.debug("sql ontology hop %d: +%d node(s)", hop + 1, len(new_nodes))
            expanded |= new_nodes
            frontier = new_nodes
        return expanded

    def _fetch_nodes(self, cur, core_ids: list[str]) -> list[dict]:
        if not core_ids:
            return []
        ph = ", ".join(["?"] * len(core_ids))
        cur.execute(
            f'SELECT n."CORE_ID", n."ENTITY_TYPE", n."LABEL", n."ATTRIBUTES",'
            f'       n."SOURCE_TEXT", n."CREATED_AT", n."UPDATED_AT" '
            f'FROM {self._nodes} n '
            f'WHERE n."CORE_ID" IN ({ph})',
            core_ids,
        )
        rows = []
        for row in cur.fetchall():
            if not row[0]:
                continue
            st = _lob(row[4])
            rows.append({
                "core_id":     str(row[0]),
                "entity_type": str(row[1]) if row[1] else "",
                "label":       str(row[2]) if row[2] else "",
                "attributes":  _safe_attrs(row[3]),
                "source_text": str(st) if st else "",
                "created_at":  row[5].isoformat() if row[5] else "",
                "updated_at":  row[6].isoformat() if row[6] else "",
            })
        return rows

    def _edge_dict(self, r) -> dict | None:
        src, rel, tgt = r[0], r[1], r[2]
        if not src or not rel or not tgt:
            _logger.debug("HANA: skipping edge with missing field(s) src=%r rel=%r tgt=%r", src, rel, tgt)
            return None
        st = _lob(r[5])
        return {
            "source_core_id": str(src),
            "relation":       str(rel),
            "target_core_id": str(tgt),
            "created_at":     r[3].isoformat() if r[3] else "",
            "attributes":     _safe_attrs(r[4]),
            "source_text":    str(st) if st else "",
            "confidence":     _conf(r[6]),
        }

    _EDGE_COLS = ('"SOURCE_CORE_ID", "RELATION", "TARGET_CORE_ID", "CREATED_AT", '
                  '"ATTRIBUTES", "SOURCE_TEXT", "CONFIDENCE"')

    def _fetch_edges_1hop(self, cur, core_ids: list[str]) -> list[dict]:
        if not core_ids:
            return []
        ph = ", ".join(["?"] * len(core_ids))
        cur.execute(
            f'SELECT {self._EDGE_COLS} '
            f'FROM {self._edges} '
            f'WHERE "SOURCE_CORE_ID" IN ({ph}) OR "TARGET_CORE_ID" IN ({ph})',
            core_ids + core_ids,
        )
        return [e for e in (self._edge_dict(r) for r in cur.fetchall()) if e]

    def fetch_graph(
        self,
        core_ids: list[str],
        hierarchy_edges: frozenset[str],
        ontology_hops: int,
    ) -> tuple[list[dict], list[dict]]:
        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                expanded = None
                if hierarchy_edges:
                    expanded = self._expand_ontology_cypher(core_ids, hierarchy_edges, ontology_hops)
                if expanded is None:
                    expanded = self._expand_ontology_sql(cur, core_ids, hierarchy_edges, ontology_hops)

                all_edges_raw = self._fetch_edges_1hop(cur, list(expanded))

                all_ids: set[str] = set(expanded)
                for e in all_edges_raw:
                    all_ids.add(e["source_core_id"])
                    all_ids.add(e["target_core_id"])

                nodes = self._fetch_nodes(cur, list(all_ids))

                edge_keys: set[tuple] = set()
                all_edges: list[dict] = []
                for e in all_edges_raw:
                    key = (e["source_core_id"], e["relation"], e["target_core_id"])
                    if key not in edge_keys:
                        edge_keys.add(key)
                        all_edges.append(e)

                return nodes, all_edges
            finally:
                cur.close()

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
        """Breadth-first walk along CONTENT/LOGIC edges - a SQL port of the Kùzu version.

        Same contract: `relations` whitelists labels (else everything but
        `exclude_relations`, default the containment set), `direction` is out/in/both,
        `source_prefix` confines the walk to one namespace, `min_confidence` drops weak
        edges. Returns (nodes, edges) for everything touched.
        """
        seeds = [c for c in (seed_core_ids or []) if c]
        if not seeds:
            return [], []
        if exclude_relations is None:
            exclude_relations = _DEFAULT_EXCLUDE
        whitelist = set(relations) if relations else None

        def _keep(cid: str) -> bool:
            return bool(cid) and (not source_prefix or cid.startswith(source_prefix))

        visited: set[str] = {s for s in seeds if _keep(s)} or set(seeds)
        frontier = list(visited)
        collected: dict[tuple, dict] = {}

        with self._pool.connection() as conn:
            cur = conn.cursor()
            try:
                def _hop(front: list[str], outgoing: bool) -> set[str]:
                    anchor_col = "SOURCE_CORE_ID" if outgoing else "TARGET_CORE_ID"
                    found: set[str] = set()
                    for i in range(0, len(front), 500):
                        part = front[i:i + 500]
                        cur.execute(
                            f'SELECT {self._EDGE_COLS} FROM {self._edges} '
                            f'WHERE "{anchor_col}" IN ({", ".join("?" for _ in part)})',
                            part,
                        )
                        for r in cur.fetchall():
                            e = self._edge_dict(r)
                            if e is None:
                                continue
                            rel = e["relation"]
                            if whitelist is not None:
                                if rel not in whitelist:
                                    continue
                            elif rel in exclude_relations:
                                continue
                            if e["confidence"] < min_confidence:
                                continue
                            other = e["target_core_id"] if outgoing else e["source_core_id"]
                            if not _keep(other):
                                continue
                            e["created_at"] = ""
                            collected[(e["source_core_id"], rel, e["target_core_id"])] = e
                            found.add(other)
                    return found

                for _ in range(max_hops):
                    if not frontier:
                        break
                    newly: set[str] = set()
                    if direction in ("out", "both"):
                        newly |= _hop(frontier, outgoing=True)
                    if direction in ("in", "both"):
                        newly |= _hop(frontier, outgoing=False)
                    newly -= visited
                    visited |= newly
                    frontier = list(newly)

                nodes = self._fetch_nodes(cur, list(visited))
            finally:
                cur.close()
        return nodes, list(collected.values())
