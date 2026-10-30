"""
SAP HANA Express persistence layer for KnowledgeHub.

Responsibilities (graph only — vectors live in ChromaDB):
  - bootstrap_db():    ensure schema + KH_GRAPH_NODES + KH_GRAPH_EDGES exist
  - upsert_gr_nodes(): upsert entity nodes with attributes/context as JSON
  - upsert_gr_edges(): upsert directed edges (insert-only on unique triple)
"""

import hashlib
import json
import logging
import os
from contextlib import contextmanager
from queue import Empty, Queue
from threading import Lock
from time import monotonic

from .config import (
    GRAPH_WORKSPACE, HANA_ENCRYPT, HANA_HOST, HANA_PASSWORD, HANA_POOL_SIZE,
    HANA_PORT, HANA_SCHEMA, HANA_USER,
)

_logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Connection pool
# ---------------------------------------------------------------------------

class _HanaPool:
    """
    Thread-safe connection pool for SAP HANA (hdbcli).
    Modelled after the reference HanaConnectionFactory — acquire → use → release.
    """

    def __init__(self, size: int = HANA_POOL_SIZE, timeout: float = 10.0):
        self._pool: Queue = Queue(maxsize=size)
        self._lock = Lock()
        self._created = 0
        self._size = size
        self._timeout = timeout

    def _new_conn(self):
        from hdbcli import dbapi
        return dbapi.connect(
            address=HANA_HOST,
            port=HANA_PORT,
            user=HANA_USER,
            password=HANA_PASSWORD,
            encrypt=HANA_ENCRYPT,
            autocommit=False,
        )

    def acquire(self):
        deadline = monotonic() + self._timeout
        while True:
            try:
                return self._pool.get_nowait()
            except Empty:
                with self._lock:
                    if self._created < self._size:
                        conn = self._new_conn()
                        self._created += 1
                        return conn
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise TimeoutError("Timed out waiting for a HANA connection")
                try:
                    return self._pool.get(timeout=remaining)
                except Empty:
                    raise TimeoutError("Timed out waiting for a HANA connection")

    def release(self, conn) -> None:
        try:
            self._pool.put_nowait(conn)
        except Exception:
            _logger.warning("Pool full — discarding connection", exc_info=True)
            try:
                conn.close()
            except Exception:
                pass
            with self._lock:
                self._created = max(0, self._created - 1)

    @contextmanager
    def connection(self):
        """Acquire, auto-commit on success, rollback + release on error."""
        conn = self.acquire()
        try:
            yield conn
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            self.release(conn)


_pool = _HanaPool()


def get_pool() -> _HanaPool:
    return _pool


# ---------------------------------------------------------------------------
# Bootstrap — called once at app startup
# ---------------------------------------------------------------------------

def _schema_exists(cur) -> bool:
    cur.execute(
        "SELECT COUNT(*) FROM SYS.SCHEMAS WHERE SCHEMA_NAME = ?",
        [HANA_SCHEMA.upper()],
    )
    return cur.fetchone()[0] > 0


def _table_exists(cur, table_name: str) -> bool:
    cur.execute(
        "SELECT COUNT(*) FROM SYS.TABLES WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?",
        [HANA_SCHEMA.upper(), table_name.upper()],
    )
    return cur.fetchone()[0] > 0


def _workspace_exists(cur) -> bool:
    try:
        cur.execute(
            "SELECT COUNT(*) FROM SYS.GRAPH_WORKSPACES "
            "WHERE SCHEMA_NAME = ? AND WORKSPACE_NAME = ?",
            [HANA_SCHEMA.upper(), GRAPH_WORKSPACE.upper()],
        )
        return cur.fetchone()[0] > 0
    except Exception:
        return False


def bootstrap_db() -> None:
    """
    Idempotent startup check: create schema and graph tables if absent.
    Safe to call multiple times — each DDL is guarded by an existence check.

    Tables managed:
      KH_GRAPH_NODES — entity nodes with typed attributes (NCLOB JSON)
      KH_GRAPH_EDGES — directed labelled relationships between core_ids

    Note: vectors are stored in ChromaDB, not HANA. See app/vector_store.py.
    """
    conn = _pool.acquire()
    try:
        cur = conn.cursor()
        try:
            if not _schema_exists(cur):
                cur.execute(f'CREATE SCHEMA "{HANA_SCHEMA}"')
                _logger.info("Created HANA schema: %s", HANA_SCHEMA)

            if not _table_exists(cur, "KH_DOCUMENTS"):
                cur.execute(f"""
                    CREATE COLUMN TABLE "{HANA_SCHEMA}"."KH_DOCUMENTS" (
                        "ID"          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "CHECKSUM"    NVARCHAR(64) NOT NULL,
                        "SOURCE_TEXT" NCLOB NOT NULL,
                        "CREATED_AT"  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE ("CHECKSUM")
                    )
                """)
                _logger.info("Created table: KH_DOCUMENTS")

            if not _table_exists(cur, "KH_GRAPH_NODES"):
                cur.execute(f"""
                    CREATE COLUMN TABLE "{HANA_SCHEMA}"."KH_GRAPH_NODES" (
                        "CORE_ID"      NVARCHAR(500) NOT NULL PRIMARY KEY,
                        "ENTITY_TYPE"  NVARCHAR(100),
                        "LABEL"        NVARCHAR(500),
                        "ATTRIBUTES"   NCLOB,
                        "DOCUMENT_ID"  BIGINT,
                        "UPDATED_AT"   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                _logger.info("Created table: KH_GRAPH_NODES")

            if not _table_exists(cur, "KH_GRAPH_EDGES"):
                cur.execute(f"""
                    CREATE COLUMN TABLE "{HANA_SCHEMA}"."KH_GRAPH_EDGES" (
                        "ID"             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "SOURCE_CORE_ID" NVARCHAR(500) NOT NULL,
                        "RELATION"       NVARCHAR(200) NOT NULL,
                        "TARGET_CORE_ID" NVARCHAR(500) NOT NULL,
                        UNIQUE ("SOURCE_CORE_ID", "RELATION", "TARGET_CORE_ID")
                    )
                """)
                _logger.info("Created table: KH_GRAPH_EDGES")

            # Graph Workspace — required for OPENCYPHER_TABLE multi-hop queries.
            # Silently skipped if the Graph Engine is not licensed/available on this HXE instance.
            try:
                if not _workspace_exists(cur):
                    cur.execute(f"""
                        CREATE GRAPH WORKSPACE "{HANA_SCHEMA}"."{GRAPH_WORKSPACE}"
                        EDGE TABLE "{HANA_SCHEMA}"."KH_GRAPH_EDGES"
                            SOURCE COLUMN "SOURCE_CORE_ID"
                            TARGET COLUMN "TARGET_CORE_ID"
                            KEY COLUMN "ID"
                        VERTEX TABLE "{HANA_SCHEMA}"."KH_GRAPH_NODES"
                            KEY COLUMN "CORE_ID"
                    """)
                    _logger.info("Created graph workspace: %s", GRAPH_WORKSPACE)
            except Exception as _gw_exc:
                _logger.warning(
                    "Graph workspace creation skipped (Graph Engine may be unavailable on this HXE): %s",
                    _gw_exc,
                )

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
        _pool.release(conn)


# ---------------------------------------------------------------------------
# Graph upsert operations
# ---------------------------------------------------------------------------

def execute_cypher(cypher: str) -> list[dict]:
    """
    Execute an openCypher query against the HANA Graph Workspace via OPENCYPHER_TABLE.

    The Cypher string is embedded as a SQL string literal (single-quotes escaped).
    Returns a list of row dicts; keys are uppercased to match HANA's output convention.

    Raises RuntimeError if the Graph Engine is unavailable or the query is invalid.
    This allows callers to catch the error and fall back to SQL-based retrieval.
    """
    escaped = cypher.replace("'", "''")
    sql = (
        f'SELECT * FROM OPENCYPHER_TABLE('
        f'  GRAPH WORKSPACE "{HANA_SCHEMA}"."{GRAPH_WORKSPACE}",'
        f"  '{escaped}'"
        f')'
    )
    with _pool.connection() as conn:
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


def upsert_document(source_text: str) -> int | None:
    """
    Insert source_text into KH_DOCUMENTS if a document with the same SHA-256
    checksum does not already exist. Returns the document ID in all cases.
    Returns None for empty/blank source text.
    """
    if not source_text or not source_text.strip():
        return None
    checksum = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
    with _pool.connection() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                f'INSERT INTO "{HANA_SCHEMA}"."KH_DOCUMENTS" ("SOURCE_TEXT", "CHECKSUM")'
                f' SELECT ?, ? FROM DUMMY'
                f' WHERE NOT EXISTS ('
                f'   SELECT 1 FROM "{HANA_SCHEMA}"."KH_DOCUMENTS" WHERE "CHECKSUM" = ?'
                f')',
                [source_text, checksum, checksum],
            )
            cur.execute(
                f'SELECT "ID" FROM "{HANA_SCHEMA}"."KH_DOCUMENTS" WHERE "CHECKSUM" = ?',
                [checksum],
            )
            row = cur.fetchone()
            return row[0] if row else None
        finally:
            cur.close()


def upsert_gr_nodes(entities: list[dict]) -> None:
    """
    Upsert a batch of entity nodes into KH_GRAPH_NODES.
    On conflict (same core_id), attributes and context are refreshed.

    Each entity dict must contain:
        core_id, type, original_text, attributes (dict), context (str)
    """
    with _pool.connection() as conn:
        cur = conn.cursor()
        try:
            for entity in entities:
                cur.execute(
                    f"""
                    UPSERT "{HANA_SCHEMA}"."KH_GRAPH_NODES"
                        ("CORE_ID", "ENTITY_TYPE", "LABEL", "ATTRIBUTES", "DOCUMENT_ID", "UPDATED_AT")
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    WITH PRIMARY KEY
                    """,
                    [
                        entity["core_id"],
                        entity.get("type", ""),
                        entity.get("label", ""),
                        json.dumps(entity.get("attributes", {}), ensure_ascii=False),
                        entity.get("document_id"),
                    ],
                )
        finally:
            cur.close()


def upsert_gr_edges(edges: list[dict]) -> None:
    """
    Insert graph edges into KH_GRAPH_EDGES.
    Skips any (source, relation, target) triple that already exists.

    Each edge dict must contain:
        source_core_id, relation, target_core_id
    """
    with _pool.connection() as conn:
        cur = conn.cursor()
        try:
            for edge in edges:
                src = edge["source_core_id"]
                rel = edge["relation"]
                tgt = edge["target_core_id"]
                cur.execute(
                    f"""
                    INSERT INTO "{HANA_SCHEMA}"."KH_GRAPH_EDGES"
                        ("SOURCE_CORE_ID", "RELATION", "TARGET_CORE_ID")
                    SELECT ?, ?, ?
                    FROM DUMMY
                    WHERE NOT EXISTS (
                        SELECT 1 FROM "{HANA_SCHEMA}"."KH_GRAPH_EDGES"
                        WHERE "SOURCE_CORE_ID" = ?
                          AND "RELATION"       = ?
                          AND "TARGET_CORE_ID" = ?
                    )
                    """,
                    [src, rel, tgt, src, rel, tgt],
                )
        finally:
            cur.close()
