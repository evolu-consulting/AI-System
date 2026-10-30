"""One connection surface for KH's own relational tables: SQLite locally, HANA in the cloud.

hook_rules, the policy action table and the project registry were written against
SQLite (config.HOOKS_DB_PATH). A Cloud Foundry container has no disk that survives a
restart, so a cloud deployment keeps the same tables in HANA instead. The stores keep
their SQL; this module absorbs the handful of places where the two dialects differ:

  * ``connect()``      - the connection a store works on. For SQLite it is EXACTLY the
                         connection the stores used to open themselves (same timeout,
                         row factory and WAL pragma), so the local install is unchanged.
                         For HANA it is a pooled connection with the same surface:
                         ``execute`` returning rows that answer ``r["col"]`` and ``r[0]``,
                         ``rowcount``, and commit-on-exit as a context manager.
  * ``create_table`` / ``create_index`` - DDL per dialect, idempotent on both
                         (HANA has no ``IF NOT EXISTS``, so it checks the catalogue).
  * ``upsert``         - SQLite ``ON CONFLICT ... DO UPDATE``; HANA update-then-insert,
                         which works for a unique key that is not the primary key
                         (hook_rules is keyed by (hook_type, name) but its PK is id).

Selected by config.STORE_BACKEND ("sqlite" default, "hana").
"""
from __future__ import annotations

import sqlite3
from typing import Any, Iterable, Sequence

from app import config


def is_hana() -> bool:
    return config.STORE_BACKEND == "hana"


def location() -> str:
    """Where the tables live, for the stats routes."""
    if is_hana():
        return f"hana:{config.HANA_HOST}/{config.HANA_SCHEMA}"
    return config.HOOKS_DB_PATH


# --------------------------------------------------------------------------- HANA side

class _Row(dict):
    """A result row readable by column name (lower case, as SQLite returns it) or index."""

    __slots__ = ("_values",)

    def __init__(self, names: Sequence[str], values: Sequence[Any]):
        super().__init__(zip(names, values))
        self._values = tuple(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

    def __iter__(self):
        """Values, like sqlite3.Row: tuple(r) and ``a, b = r`` must not yield column names.
        dict(r) and {**r} still work (they go through keys())."""
        return iter(self._values)


class _Result:
    """The rows of one statement (already fetched), read like a sqlite3 cursor: fetchone/fetchmany advance."""

    def __init__(self, rows: list[_Row], rowcount: int):
        self._rows = rows
        self._pos = 0
        self.rowcount = rowcount

    def fetchone(self):
        if self._pos >= len(self._rows):
            return None
        self._pos += 1
        return self._rows[self._pos - 1]

    def fetchmany(self, size: int = 1):
        out = self._rows[self._pos:self._pos + max(int(size), 0)]
        self._pos += len(out)
        return out

    def fetchall(self):
        out = self._rows[self._pos:]
        self._pos = len(self._rows)
        return out

    def __iter__(self):
        return iter(self._rows)


class _HanaConn:
    """Pooled HANA connection with the slice of the sqlite3 API the stores use."""

    def __init__(self):
        from app import hana_conn
        self._hc = hana_conn
        self._pool = hana_conn.pool()
        self._conn = self._pool.acquire()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> _Result:
        cur = self._conn.cursor()
        try:
            cur.execute(sql, list(params))
            rows: list[_Row] = []
            if cur.description:
                names = [d[0].lower() for d in cur.description]
                for raw in cur.fetchall():
                    rows.append(_Row(names, [self._hc.lob_to_str(v) for v in raw]))
            return _Result(rows, cur.rowcount)
        finally:
            cur.close()

    def cursor(self):
        return self._conn.cursor()

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._pool.release(self._conn)
        return False


# --------------------------------------------------------------------------- public

def connect():
    """A connection to KH's relational store. Use it as ``with connect() as c:``."""
    if is_hana():
        return _HanaConn()
    c = sqlite3.connect(config.HOOKS_DB_PATH, timeout=config.SQLITE_TIMEOUT_S)
    c.row_factory = sqlite3.Row
    if config.SQLITE_WAL:
        c.execute("PRAGMA journal_mode=WAL")
    return c


def create_table(c, name: str, sqlite_ddl: str, hana_ddl: str) -> None:
    """Create a table if absent. ``sqlite_ddl`` carries its own IF NOT EXISTS."""
    if not is_hana():
        c.execute(sqlite_ddl)
        return
    from app import hana_conn
    cur = c.cursor()
    try:
        if hana_conn.table_exists(cur, name):
            return
    finally:
        cur.close()
    c.execute(hana_ddl)


def create_index(c, name: str, table: str, columns: str, unique: bool = False) -> None:
    """Create an index (``unique=True``: a unique one) if absent, on either dialect."""
    kind = "UNIQUE INDEX" if unique else "INDEX"
    if not is_hana():
        c.execute(f"CREATE {kind} IF NOT EXISTS {name} ON {table}({columns})")
        return
    from app import hana_conn
    cur = c.cursor()
    try:
        if hana_conn.index_exists(cur, name):
            return
    finally:
        cur.close()
    c.execute(f"CREATE {kind} {name} ON {table}({columns})")


def upsert(c, table: str, keys: Sequence[str], row: dict[str, Any]) -> None:
    """Insert ``row``, or update every non-key column of the row whose ``keys`` match."""
    cols = list(row)
    rest = [k for k in cols if k not in keys]
    if not is_hana():
        c.execute(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({','.join('?' for _ in cols)}) "
            f"ON CONFLICT({', '.join(keys)}) DO UPDATE SET "
            + ", ".join(f"{k}=excluded.{k}" for k in rest),
            [row[k] for k in cols],
        )
        return
    where = " AND ".join(f"{k}=?" for k in keys)
    updated = 0
    if rest:
        updated = c.execute(
            f"UPDATE {table} SET {', '.join(f'{k}=?' for k in rest)} WHERE {where}",
            [row[k] for k in rest] + [row[k] for k in keys],
        ).rowcount
    else:
        updated = len(c.execute(f"SELECT 1 FROM {table} WHERE {where}",
                                [row[k] for k in keys]).fetchall())
    if not updated:
        c.execute(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({','.join('?' for _ in cols)})",
            [row[k] for k in cols],
        )


# =========================================================================== stage F concurrency core
#
# Every multi-instance correctness rule of KH lives below as SQL (docs/multi-agent-instance-design.md
# section 2): a conditional UPDATE whose rowcount decides, a primary-key insert whose duplicate decides,
# or a counter row updated inside the caller's transaction. Nothing here relies on a process lock, and
# every time comparison uses the DATABASE clock (now_ms_sql), never an instance clock.

import os as _os
import socket as _socket
import threading as _threading

_CORE_READY: set[str] = set()
_CORE_LOCK = _threading.Lock()


def now_ms_sql() -> str:
    """SQL expression for 'now' in UTC epoch milliseconds, evaluated by the database."""
    if is_hana():
        return "CAST(NANO100_BETWEEN(TO_TIMESTAMP('1970-01-01'), CURRENT_UTCTIMESTAMP) / 10000 AS BIGINT)"
    return "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"


def _from_dummy() -> str:
    return " FROM DUMMY" if is_hana() else ""


def now_ms(c) -> int:
    """The database clock in epoch ms (one round trip)."""
    return int(c.execute(f"SELECT {now_ms_sql()} AS t{_from_dummy()}").fetchone()[0])


def instance_id() -> str:
    """This process's identity as a lease holder: CF_INSTANCE_GUID on BTP, host:pid elsewhere."""
    return _os.getenv("CF_INSTANCE_GUID") or f"{_socket.gethostname()}:{_os.getpid()}"


def update(c, sql: str, params: Iterable[Any] = ()) -> int:
    """Run a conditional UPDATE/DELETE and return how many rows it changed (the decision)."""
    return max(int(c.execute(sql, list(params)).rowcount or 0), 0)


def is_duplicate(exc: BaseException) -> bool:
    """True when ``exc`` is a primary-key / unique violation on either backend."""
    if isinstance(exc, sqlite3.IntegrityError):
        msg = str(exc).lower()
        return "unique" in msg or "primary key" in msg
    if getattr(exc, "errorcode", None) == 301:          # HANA: unique constraint violated
        return True
    return type(exc).__name__ == "IntegrityError" and "unique" in str(exc).lower()


def insert_new(c, table: str, row: dict[str, Any]) -> bool:
    """Insert ``row``; False (not an error) when its key already exists. The first insert wins."""
    cols = list(row)
    try:
        c.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({','.join('?' for _ in cols)})",
                  [row[k] for k in cols])
        return True
    except Exception as exc:  # noqa: BLE001 - dialect-specific classes
        if is_duplicate(exc):
            return False
        raise


def column_exists(c, table: str, column: str) -> bool:
    if not is_hana():
        return any(r[1].lower() == column.lower() for r in c.execute(f"PRAGMA table_info({table})").fetchall())
    rows = c.execute("SELECT 1 FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME=CURRENT_SCHEMA AND TABLE_NAME=? "
                     "AND COLUMN_NAME=?", [table.upper(), column.upper()]).fetchall()
    return bool(rows)


def add_column(c, table: str, column: str, sqlite_type: str, hana_type: str) -> bool:
    """ALTER TABLE ADD a column when it is missing (idempotent on both backends). True when added."""
    if column_exists(c, table, column):
        return False
    if is_hana():
        c.execute(f"ALTER TABLE {table} ADD ({column} {hana_type})")
    else:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {sqlite_type}")
    return True


# --------------------------------------------------------------------------- core tables

_CORE_DDL = {
    "kh_schema_migration": (
        """CREATE TABLE IF NOT EXISTS kh_schema_migration (
               module     TEXT    NOT NULL,
               version    INTEGER NOT NULL,
               applied_ms INTEGER NOT NULL,
               PRIMARY KEY (module, version))""",
        """CREATE COLUMN TABLE kh_schema_migration (
               module     NVARCHAR(64) NOT NULL,
               version    BIGINT       NOT NULL,
               applied_ms BIGINT       NOT NULL,
               PRIMARY KEY (module, version))"""),
    "kh_counter": (
        """CREATE TABLE IF NOT EXISTS kh_counter (
               name TEXT PRIMARY KEY,
               n    INTEGER NOT NULL DEFAULT 0)""",
        """CREATE COLUMN TABLE kh_counter (
               name NVARCHAR(512) PRIMARY KEY,
               n    BIGINT        NOT NULL)"""),
    "kh_lease": (
        """CREATE TABLE IF NOT EXISTS kh_lease (
               ns       TEXT    NOT NULL,
               name     TEXT    NOT NULL,
               holder   TEXT,
               epoch    INTEGER NOT NULL DEFAULT 0,
               until_ms INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY (ns, name))""",
        """CREATE COLUMN TABLE kh_lease (
               ns       NVARCHAR(64)  NOT NULL,
               name     NVARCHAR(256) NOT NULL,
               holder   NVARCHAR(256),
               epoch    BIGINT        NOT NULL,
               until_ms BIGINT        NOT NULL,
               PRIMARY KEY (ns, name))"""),
}


def ensure_core(c=None) -> None:
    """Create kh_schema_migration, kh_counter and kh_lease once per process (and per db location)."""
    key = location()
    if key in _CORE_READY:
        return
    with _CORE_LOCK:
        if key in _CORE_READY:
            return
        if c is None:
            with connect() as cc:
                for name, (lite, hana) in _CORE_DDL.items():
                    create_table(cc, name, lite, hana)
        else:
            for name, (lite, hana) in _CORE_DDL.items():
                create_table(c, name, lite, hana)
        _CORE_READY.add(key)


def migrate(c, module: str, steps: Sequence[tuple[int, Any]]) -> list[int]:
    """Apply each ``(version, fn(c))`` of ``module`` once, in version order. Returns the versions applied.

    A step is recorded in kh_schema_migration in the same transaction as its DML (SQLite DDL is
    transactional too; HANA DDL autocommits, so every step must be idempotent - use create_table,
    create_index and add_column, which check the catalogue first). Two instances racing one step: the
    loser's ledger insert hits the primary key and the idempotent step leaves the same result.
    """
    ensure_core(c)
    done = {int(r[0]) for r in c.execute("SELECT version FROM kh_schema_migration WHERE module=?",
                                          [module]).fetchall()}
    applied = []
    for version, fn in sorted(steps, key=lambda s: s[0]):
        if version in done:
            continue
        fn(c)
        if insert_new(c, "kh_schema_migration", {"module": module, "version": int(version),
                                                 "applied_ms": now_ms(c)}):
            applied.append(version)
    return applied


# --------------------------------------------------------------------------- counters

def counter_add(c, name: str, delta: int = 1) -> int:
    """Atomically add ``delta`` to counter ``name`` inside the caller's transaction; returns the new value.

    The UPDATE takes the row lock, so concurrent callers serialize on it and every value is handed out
    exactly once. Run it in the same transaction as the write it numbers (event seq): the lock is held
    until commit, so commit order equals number order.
    """
    ensure_core(c)
    if not update(c, "UPDATE kh_counter SET n = n + ? WHERE name=?", [int(delta), name]):
        if not insert_new(c, "kh_counter", {"name": name, "n": int(delta)}):
            update(c, "UPDATE kh_counter SET n = n + ? WHERE name=?", [int(delta), name])
    return int(c.execute("SELECT n FROM kh_counter WHERE name=?", [name]).fetchone()[0])


def counter_get(c, name: str) -> int:
    ensure_core(c)
    r = c.execute("SELECT n FROM kh_counter WHERE name=?", [name]).fetchone()
    return int(r[0]) if r else 0


def counter_delete(c, name: str) -> None:
    ensure_core(c)
    c.execute("DELETE FROM kh_counter WHERE name=?", [name])


# --------------------------------------------------------------------------- leases with fencing epochs

KH_NS = "_kh"            # the namespace of KH's own jobs


def lease_acquire(c, ns: str, name: str, holder: str, ttl_ms: int) -> dict | None:
    """Acquire or renew lease ``(ns, name)`` for ``holder``. Returns {epoch, until_ms}, or None if held.

    A different holder taking a free or expired lease bumps the epoch, which fences every write the
    previous holder still has in flight. For a missing row the first INSERT wins.
    """
    ensure_core(c)
    now = now_ms_sql()
    sql = (f"UPDATE kh_lease SET holder=?, until_ms={now} + ?, "
           "epoch = CASE WHEN holder=? THEN epoch ELSE epoch + 1 END "
           f"WHERE ns=? AND name=? AND (until_ms < {now} OR holder=?)")
    params = [holder, int(ttl_ms), holder, ns, name, holder]
    if not update(c, sql, params):
        if c.execute("SELECT 1 FROM kh_lease WHERE ns=? AND name=?", [ns, name]).fetchone():
            return None
        if not insert_new(c, "kh_lease", {"ns": ns, "name": name, "holder": holder, "epoch": 1,
                                          "until_ms": now_ms(c) + int(ttl_ms)}):
            if not update(c, sql, params):
                return None
    r = c.execute("SELECT epoch, until_ms, holder FROM kh_lease WHERE ns=? AND name=?", [ns, name]).fetchone()
    if r is None or r["holder"] != holder:
        return None
    return {"epoch": int(r["epoch"]), "until_ms": int(r["until_ms"])}


def lease_renew(c, ns: str, name: str, holder: str, epoch: int, ttl_ms: int) -> dict | None:
    """Extend a lease still held at ``epoch``; None when it was lost (expired, taken or released)."""
    ensure_core(c)
    now = now_ms_sql()
    if not update(c, f"UPDATE kh_lease SET until_ms={now} + ? WHERE ns=? AND name=? AND holder=? AND epoch=? "
                     f"AND until_ms >= {now}", [int(ttl_ms), ns, name, holder, int(epoch)]):
        return None
    r = c.execute("SELECT epoch, until_ms FROM kh_lease WHERE ns=? AND name=?", [ns, name]).fetchone()
    return {"epoch": int(r["epoch"]), "until_ms": int(r["until_ms"])}


def lease_release(c, ns: str, name: str, holder: str, epoch: int) -> bool:
    """Give a lease up early. The row stays (its epoch is history); only its expiry moves."""
    ensure_core(c)
    return bool(update(c, "UPDATE kh_lease SET until_ms=0 WHERE ns=? AND name=? AND holder=? AND epoch=?",
                       [ns, name, holder, int(epoch)]))


def _lease_row(r) -> dict:
    return {"ns": r["ns"], "name": r["name"], "holder": r["holder"], "epoch": int(r["epoch"]),
            "until_ms": int(r["until_ms"]),
            "held": r["holder"] is not None and int(r["until_ms"]) >= int(r["now_ms"])}


def lease_get(c, ns: str, name: str) -> dict | None:
    ensure_core(c)
    r = c.execute(f"SELECT ns, name, holder, epoch, until_ms, {now_ms_sql()} AS now_ms FROM kh_lease "
                  "WHERE ns=? AND name=?", [ns, name]).fetchone()
    return _lease_row(r) if r else None


def lease_list(c, ns: str, prefix: str = "", limit: int = 500) -> list[dict]:
    ensure_core(c)
    esc = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = c.execute(f"SELECT ns, name, holder, epoch, until_ms, {now_ms_sql()} AS now_ms FROM kh_lease "
                     "WHERE ns=? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?",
                     [ns, esc + "%", int(limit)]).fetchall()
    return [_lease_row(r) for r in rows]


def lease_bump_all(c, ns: str) -> int:
    """Fence every lease of a namespace at once (detach): epoch+1 and holder cleared."""
    ensure_core(c)
    return update(c, "UPDATE kh_lease SET epoch = epoch + 1, holder = NULL, until_ms = 0 WHERE ns=?", [ns])


def fence_sql() -> str:
    """A predicate to AND into a fenced write: true only while (ns, name) is held at that epoch.

    Parameters, in order: ns, name, epoch. Because it is part of the write statement (or its
    transaction), a write that raced a lease steal cannot commit.
    """
    return (f"EXISTS (SELECT 1 FROM kh_lease WHERE ns=? AND name=? AND epoch=? AND holder IS NOT NULL "
            f"AND until_ms >= {now_ms_sql()})")


def fence_ok(c, ns: str, name: str, epoch: int) -> bool:
    """The fence predicate evaluated on its own, inside the caller's transaction.

    On SQLite the caller must already hold the write lock (do a write first, or call this right before
    the write in the same transaction); on HANA run it after the guarded INSERT/UPDATE or use fence_sql.
    """
    ensure_core(c)
    sql = f"SELECT 1 AS ok{_from_dummy()} WHERE {fence_sql()}"
    return c.execute(sql, [ns, name, int(epoch)]).fetchone() is not None


def run_under_lease(name: str, ttl_s: float, fn, holder: str | None = None):
    """Run ``fn()`` only while this instance holds KH lease ``('_kh', name)``. Returns (ran, result).

    Every KH cron goes through this, so a job started on each of N instances runs on one at a time.
    """
    who = holder or instance_id()
    with connect() as c:
        got = lease_acquire(c, KH_NS, name, who, int(ttl_s * 1000))
    if got is None:
        return False, None
    return True, fn()
