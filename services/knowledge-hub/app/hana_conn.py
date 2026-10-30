"""Shared SAP HANA connection pool for KH's own stores (relational + vector).

The graph adapter (app/graph_db/hana_adapter.py) keeps its own pool; this one serves
the stores that moved onto HANA for a cloud deployment: the relational tables behind
app/sqldb.py and the vector engine behind app/vector_hana.py.

A cold connect to HANA Cloud costs about 1.5 s (TLS + auth, measured from Cloud Run
on 2026-09-09), so connections are pooled and reused rather than opened per call.
Every connection is pointed at HANA_SCHEMA on creation, so the SQL above this layer
uses bare table names exactly as it does against SQLite.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from queue import Empty, Queue
from threading import Lock
from time import monotonic

from app import config

_logger = logging.getLogger(__name__)


def connect_kwargs() -> dict:
    """The hdbcli.connect arguments every KH pool uses, all taken from app.config.

    One definition for both pools (this one and the graph adapter's), so TLS, certificate
    checking and the connect timeout cannot drift between them - the graph pool used to
    skip certificate settings entirely."""
    kwargs = dict(
        address=config.HANA_HOST,
        port=config.HANA_PORT,
        user=config.HANA_USER,
        password=config.HANA_PASSWORD,
        encrypt=config.HANA_ENCRYPT,
        autocommit=False,
    )
    if config.HANA_ENCRYPT:
        kwargs["sslValidateCertificate"] = config.HANA_SSL_VALIDATE
    if config.HANA_CONNECT_TIMEOUT_MS > 0:
        kwargs["connectTimeout"] = config.HANA_CONNECT_TIMEOUT_MS
    return kwargs


class _Pool:
    """A bounded pool: ``size`` kept idle, up to ``overflow`` more opened under load.

    An overflow connection is closed when it comes back and the idle queue is full, so
    the pool shrinks back to ``size`` by itself. A connection older than ``recycle``
    seconds (0 = never) is closed instead of handed out again. ``set_schema`` points each
    new connection at HANA_SCHEMA; the graph pool turns it off because it creates that
    schema itself when it is missing, and SET SCHEMA on a schema that does not exist
    fails.
    """

    def __init__(self, size: int, timeout: float = 30.0, overflow: int = 0,
                 recycle: float = 0, set_schema: bool = True, connect=None):
        self._idle: Queue = Queue(maxsize=size)
        self._lock = Lock()
        self._created = 0
        self._size = size
        self._cap = size + max(0, overflow)
        self._timeout = timeout
        self._recycle = recycle
        self._set_schema = set_schema
        self._born: dict[int, float] = {}
        self._connect = connect

    def _new(self):
        if self._connect is not None:
            conn = self._connect()
        else:
            from hdbcli import dbapi
            conn = dbapi.connect(**connect_kwargs())
        if self._set_schema:
            cur = conn.cursor()
            try:
                cur.execute(f'SET SCHEMA "{config.HANA_SCHEMA}"')
            finally:
                cur.close()
        self._born[id(conn)] = monotonic()
        return conn

    def _usable(self, conn) -> bool:
        if not _alive(conn):
            return False
        if self._recycle > 0:
            born = self._born.get(id(conn))
            if born is not None and monotonic() - born > self._recycle:
                return False
        return True

    def acquire(self):
        deadline = monotonic() + self._timeout
        while True:
            try:
                conn = self._idle.get_nowait()
                if self._usable(conn):
                    return conn
                self._discard(conn)
                continue
            except Empty:
                pass
            with self._lock:
                if self._created < self._cap:
                    self._created += 1
                    try:
                        return self._new()
                    except Exception:
                        self._created -= 1
                        raise
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise TimeoutError("Timed out waiting for a HANA connection")
            try:
                conn = self._idle.get(timeout=remaining)
            except Empty:
                raise TimeoutError("Timed out waiting for a HANA connection")
            if self._usable(conn):
                return conn
            self._discard(conn)

    def release(self, conn) -> None:
        try:
            self._idle.put_nowait(conn)
        except Exception:
            self._discard(conn)

    @contextmanager
    def connection(self):
        """One pooled connection for one unit of work: commit on success, roll back on error."""
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

    def _discard(self, conn) -> None:
        self._born.pop(id(conn), None)
        try:
            conn.close()
        except Exception:
            pass
        with self._lock:
            self._created = max(0, self._created - 1)


def _alive(conn) -> bool:
    try:
        return bool(conn.isconnected())
    except Exception:
        return False


_POOL: _Pool | None = None
_POOL_LOCK = Lock()


def pool() -> _Pool:
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = _Pool(size=max(1, config.HANA_POOL_SIZE),
                          timeout=config.HANA_POOL_TIMEOUT_S,
                          overflow=config.HANA_MAX_OVERFLOW,
                          recycle=config.HANA_POOL_RECYCLE_S)
            _logger.info("HANA store pool ready: %s:%s schema=%s",
                         config.HANA_HOST, config.HANA_PORT, config.HANA_SCHEMA)
        return _POOL


def connection():
    """One pooled connection for one unit of work: commit on success, roll back on error."""
    return pool().connection()


def table_exists(cur, table: str) -> bool:
    cur.execute("SELECT COUNT(*) FROM SYS.TABLES WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?",
                [config.HANA_SCHEMA.upper(), table.upper()])
    return cur.fetchone()[0] > 0


def index_exists(cur, index: str) -> bool:
    cur.execute("SELECT COUNT(*) FROM SYS.INDEXES WHERE SCHEMA_NAME = ? AND INDEX_NAME = ?",
                [config.HANA_SCHEMA.upper(), index.upper()])
    return cur.fetchone()[0] > 0


def lob_to_str(value):
    """An NCLOB comes back from hdbcli as a LOB handle; the stores want plain text."""
    if value is not None and hasattr(value, "read"):
        data = value.read()
        return data.decode("utf-8") if isinstance(data, bytes) else data
    return value
