"""SQLite implementation of contracts.Store (line/line.db, WAL).

    from line.store import SqliteStore, open_store
    store = open_store(cfg)              # or SqliteStore(path, clock=..., leases=...)

Semantics are the ones of contracts.Store and tests/fakes.FakeStore:
  * emit(): kind closed (UNKNOWN_KIND), envelope strict (ENVELOPE_INVALID), unit events with
    epoch > 0 fenced on unit_lease_name(unit) (LEASE_LOST); seq gapless from 1.
  * put()/get()/version()/query(): JSON rows with a CAS version (STATE_CONFLICT on if_version miss).
  * transition(): CAS on row.state + TRANSITIONS table, atomic.
  * outbox_*: durable queue for RAG System writes while degraded.

Concurrency: one connection per thread for a file database (WAL lets readers run beside the
writer); every write runs in BEGIN IMMEDIATE under a per-instance lock, so several SqliteStore
instances / processes on the same file also serialise correctly (busy_timeout). A ":memory:"
database uses one shared connection and the lock for everything.

Fencing: by default against the lease table of this same database, inside the emit transaction
(so check-and-append is atomic). Pass leases=<LeaseManager> to fence on another authority
(e.g. RAG System leases); then the check runs just before the append.
"""

from __future__ import annotations

import contextlib
import dataclasses
import enum
import json
import os
import sqlite3
import threading
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Union

from . import codes
from .codes import LineError
from .contracts import (
    ENTITIES, TRANSITIONS, Envelope, Event, OutboxItem, to_dict, unit_lease_name,
)

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema_line.sql")

LEASE_LIVE = "live"
LEASE_RELEASED = "released"
LEASE_REAPED = "reaped"


def _sv(x: Any) -> str:
    return x.value if isinstance(x, enum.Enum) else str(x)


def _json(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), sort_keys=False)


class SystemClock:
    def now_ms(self) -> int:
        from .contracts import now_ms
        return now_ms()


class SqliteStore:
    """contracts.Store over SQLite. Thread-safe."""

    def __init__(self, path: str = ":memory:", clock: Any = None, leases: Any = None,
                 busy_timeout_ms: int = 30000):
        self.path = path
        self.clock = clock or SystemClock()
        self._fence = leases               # external LeaseManager, or None = lease table here
        self._busy_ms = int(busy_timeout_ms)
        self._lock = threading.RLock()
        self._local = threading.local()
        self._memory = path in ("", ":memory:")
        self._shared: Optional[sqlite3.Connection] = None
        self._all: List[sqlite3.Connection] = []
        self._leases = None
        if not self._memory:
            d = os.path.dirname(os.path.abspath(path))
            os.makedirs(d, exist_ok=True)
        with self._lock:
            c = self._conn()
            with open(SCHEMA_PATH, encoding="utf-8") as fh:
                c.executescript(fh.read())

    # ------------------------------------------------------------ connections

    def _connect(self) -> sqlite3.Connection:
        c = sqlite3.connect(":memory:" if self._memory else self.path, timeout=self._busy_ms / 1000.0,
                            isolation_level=None, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA busy_timeout=%d" % self._busy_ms)
        if not self._memory:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA synchronous=NORMAL")
        self._all.append(c)
        return c

    def _conn(self) -> sqlite3.Connection:
        if self._memory:
            if self._shared is None:
                self._shared = self._connect()
            return self._shared
        c = getattr(self._local, "conn", None)
        if c is None:
            c = self._local.conn = self._connect()
        return c

    @contextlib.contextmanager
    def _read(self) -> Iterator[sqlite3.Connection]:
        if self._memory:
            with self._lock:
                yield self._conn()
        else:
            yield self._conn()

    @contextlib.contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Write transaction (BEGIN IMMEDIATE). Re-entrant on the same thread."""
        with self._lock:
            c = self._conn()
            depth = getattr(self._local, "depth", 0)
            if depth:
                self._local.depth = depth + 1
                try:
                    yield c
                finally:
                    self._local.depth = depth
                return
            c.execute("BEGIN IMMEDIATE")
            self._local.depth = 1
            try:
                yield c
            except BaseException:
                self._local.depth = 0
                c.execute("ROLLBACK")
                raise
            self._local.depth = 0
            c.execute("COMMIT")

    def close(self) -> None:
        with self._lock:
            for c in self._all:
                try:
                    c.close()
                except sqlite3.Error:
                    pass
            self._all = []
            self._shared = None
            self._local = threading.local()

    # ------------------------------------------------------------ leases / fencing

    @property
    def leases(self) -> Any:
        """The LeaseManager this store fences on (lease table of this database by default)."""
        if self._fence is not None:
            return self._fence
        if self._leases is None:
            from .lease import SqliteLeases
            self._leases = SqliteLeases(self)
        return self._leases

    @staticmethod
    def live_lease_row(c: sqlite3.Connection, name: str, now: int) -> Optional[sqlite3.Row]:
        r = c.execute("SELECT * FROM lease WHERE name=?", (name,)).fetchone()
        if r is None or r["state"] != LEASE_LIVE or r["expires_ms"] <= now:
            return None
        return r

    def _check_epoch(self, c: sqlite3.Connection, name: str, epoch: int) -> None:
        r = self.live_lease_row(c, name, self.clock.now_ms())
        if r is None or r["epoch"] != epoch:
            raise LineError(codes.LEASE_LOST, "stale epoch %d for %s" % (epoch, name),
                            {"name": name, "epoch": epoch, "current": r["epoch"] if r is not None else None})

    # ------------------------------------------------------------ events

    def emit(self, kind: str, env: Union[Envelope, Mapping[str, Any]], body: Optional[Mapping[str, Any]] = None) -> int:
        if kind not in codes.EVENT_KINDS:
            raise LineError(codes.UNKNOWN_KIND, "unknown event kind %r" % (kind,), {"kind": kind})
        e = Envelope.parse(env)
        try:
            body_s = _json(to_dict(dict(body or {})))
        except (TypeError, ValueError) as ex:
            raise LineError(codes.SCHEMA_INVALID, "event body is not JSON: %s" % ex, {"kind": kind}) from ex
        fenced = bool(e.unit) and e.epoch > 0
        # run-scoped unit lease "unit:<run>:<unit>" (line.scope) when the run holds one, else "unit:<unit>"
        scoped_name = unit_lease_name("%s:%s" % (e.run, e.unit)) if fenced else ""
        if fenced and self._fence is not None:
            cur = getattr(self._fence, "current", None)
            name = scoped_name if cur is not None and cur(scoped_name) is not None else unit_lease_name(e.unit)
            self._fence.check(name, e.epoch)
        with self.tx() as c:
            if fenced and self._fence is None:
                has_scoped = c.execute("SELECT 1 FROM lease WHERE name=?", (scoped_name,)).fetchone()
                self._check_epoch(c, scoped_name if has_scoped else unit_lease_name(e.unit), e.epoch)
            seq = c.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM event").fetchone()[0]
            c.execute("INSERT INTO event(seq, kind, run, unit, attempt, epoch, agent_version, model, spec_hash,"
                      " body, ts_ms, synced) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)",
                      (seq, kind, e.run, e.unit, e.attempt, e.epoch, e.agent_version, e.model, e.spec_hash,
                       body_s, self.clock.now_ms()))
            return int(seq)

    @staticmethod
    def _event(r: sqlite3.Row) -> Event:
        env = Envelope(r["run"], r["unit"], r["attempt"], r["epoch"], r["agent_version"], r["model"], r["spec_hash"])
        return Event(r["seq"], r["kind"], env, json.loads(r["body"]), r["ts_ms"], bool(r["synced"]))

    def events_after(self, seq: int, run: Optional[str] = None, kinds: Optional[Iterable[str]] = None,
                     limit: int = 1000) -> List[Event]:
        sql, args = "SELECT * FROM event WHERE seq > ?", [int(seq)]
        if run is not None:
            sql += " AND run = ?"
            args.append(run)
        if kinds is not None:
            ks = list(kinds)
            if not ks:
                return []
            sql += " AND kind IN (%s)" % ",".join("?" * len(ks))
            args.extend(ks)
        sql += " ORDER BY seq LIMIT ?"
        args.append(int(limit))
        with self._read() as c:
            return [self._event(r) for r in c.execute(sql, args).fetchall()]

    def last_seq(self) -> int:
        with self._read() as c:
            return int(c.execute("SELECT COALESCE(MAX(seq), 0) FROM event").fetchone()[0])

    def unsynced(self, limit: int = 500) -> List[Event]:
        with self._read() as c:
            rows = c.execute("SELECT * FROM event WHERE synced = 0 ORDER BY seq LIMIT ?", (int(limit),)).fetchall()
            return [self._event(r) for r in rows]

    def mark_synced(self, seqs: Iterable[int]) -> None:
        ss = [(int(s),) for s in seqs]
        if not ss:
            return
        with self.tx() as c:
            c.executemany("UPDATE event SET synced = 1 WHERE seq = ?", ss)

    # ------------------------------------------------------------ records

    @staticmethod
    def _check_entity(entity: str) -> None:
        if entity not in ENTITIES:
            raise LineError(codes.NOT_FOUND, "unknown entity %r" % (entity,), {"entity": entity})

    def put(self, entity: str, id: str, row: Union[Mapping[str, Any], Any], run: str = "",
            if_version: Optional[int] = None) -> int:
        self._check_entity(entity)
        data = to_dict(row if dataclasses.is_dataclass(row) and not isinstance(row, type) else dict(row))
        data_s = _json(data)
        state = data.get("state") if isinstance(data.get("state"), str) else None
        with self.tx() as c:
            cur = c.execute("SELECT version, run FROM record WHERE entity=? AND id=?", (entity, id)).fetchone()
            ver = cur["version"] if cur is not None else 0
            if if_version is not None and if_version != ver:
                raise LineError(codes.STATE_CONFLICT, "%s/%s version %d != %d" % (entity, id, ver, if_version),
                                {"entity": entity, "id": id, "version": ver, "expected": if_version})
            now = self.clock.now_ms()
            if cur is None:
                rrun = run or str(data.get("run", "") or "")
                ord_ = c.execute("SELECT COALESCE(MAX(ord), 0) + 1 FROM record").fetchone()[0]
                c.execute("INSERT INTO record(entity, id, run, version, ord, state, row, updated_ms)"
                          " VALUES (?,?,?,?,?,?,?,?)", (entity, id, rrun, 1, ord_, state, data_s, now))
            else:
                rrun = run or cur["run"] or str(data.get("run", "") or "")
                c.execute("UPDATE record SET run=?, version=?, state=?, row=?, updated_ms=? WHERE entity=? AND id=?",
                          (rrun, ver + 1, state, data_s, now, entity, id))
            return ver + 1

    def get(self, entity: str, id: str) -> Optional[Dict[str, Any]]:
        with self._read() as c:
            r = c.execute("SELECT row FROM record WHERE entity=? AND id=?", (entity, id)).fetchone()
            return json.loads(r["row"]) if r is not None else None

    def get_with_version(self, entity: str, id: str) -> Optional[tuple]:
        """(row, version) read in one statement, or None. Extra to the port (handy for CAS updates)."""
        with self._read() as c:
            r = c.execute("SELECT row, version FROM record WHERE entity=? AND id=?", (entity, id)).fetchone()
            return (json.loads(r["row"]), int(r["version"])) if r is not None else None

    def version(self, entity: str, id: str) -> int:
        with self._read() as c:
            r = c.execute("SELECT version FROM record WHERE entity=? AND id=?", (entity, id)).fetchone()
            return int(r["version"]) if r is not None else 0

    def query(self, entity: str, run: Optional[str] = None, **eq: Any) -> List[Dict[str, Any]]:
        sql, args = "SELECT row FROM record WHERE entity = ?", [entity]
        if run is not None:
            sql += " AND run = ?"
            args.append(run)
        want = {k: (_sv(v) if isinstance(v, enum.Enum) else v) for k, v in eq.items()}
        if isinstance(want.get("state"), str):
            sql += " AND state = ?"
            args.append(want["state"])
        sql += " ORDER BY ord"
        with self._read() as c:
            rows = [json.loads(r["row"]) for r in c.execute(sql, args).fetchall()]
        return [r for r in rows if all(r.get(k) == v for k, v in want.items())]

    # ------------------------------------------------------------ state machine

    def transition(self, entity: str, id: str, to: Any, expect_from: Any) -> Dict[str, Any]:
        table = TRANSITIONS.get(entity)
        if table is None:
            raise LineError(codes.ILLEGAL_TRANSITION, "entity %r has no state machine" % (entity,), {"entity": entity})
        to = _sv(to)
        if isinstance(expect_from, (str, enum.Enum)):
            exp = {_sv(expect_from)}
        else:
            exp = {_sv(x) for x in expect_from}
        with self.tx() as c:
            cur = c.execute("SELECT row, version FROM record WHERE entity=? AND id=?", (entity, id)).fetchone()
            if cur is None:
                raise LineError(codes.NOT_FOUND, "%s/%s" % (entity, id), {"entity": entity, "id": id})
            row = json.loads(cur["row"])
            frm = row.get("state")
            if frm not in exp:
                raise LineError(codes.STATE_CONFLICT, "%s/%s is %s, expected %s" % (entity, id, frm, sorted(exp)),
                                {"entity": entity, "id": id, "state": frm, "expected": sorted(exp)})
            if to not in table.get(frm, frozenset()):
                raise LineError(codes.ILLEGAL_TRANSITION, "%s/%s %s -> %s" % (entity, id, frm, to),
                                {"entity": entity, "id": id, "from": frm, "to": to})
            now = self.clock.now_ms()
            row["state"] = to
            if "updated_ms" in row:
                row["updated_ms"] = now
            c.execute("UPDATE record SET version = version + 1, state=?, row=?, updated_ms=? WHERE entity=? AND id=?",
                      (to, _json(row), now, entity, id))
            return row

    # ------------------------------------------------------------ outbox

    def outbox_push(self, op: str, args: Mapping[str, Any], idem_key: str) -> int:
        with self.tx() as c:
            cur = c.execute("INSERT INTO outbox(op, args, idem_key, created_ms, tries) VALUES (?,?,?,?,0)",
                            (op, _json(to_dict(dict(args))), idem_key, self.clock.now_ms()))
            return int(cur.lastrowid)

    def outbox_peek(self, limit: int = 100) -> List[OutboxItem]:
        with self._read() as c:
            rows = c.execute("SELECT * FROM outbox ORDER BY id LIMIT ?", (int(limit),)).fetchall()
            return [OutboxItem(r["id"], r["op"], json.loads(r["args"]), r["idem_key"], r["created_ms"], r["tries"])
                    for r in rows]

    def outbox_ack(self, id: int) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM outbox WHERE id = ?", (int(id),))

    def outbox_fail(self, id: int) -> None:
        with self.tx() as c:
            c.execute("UPDATE outbox SET tries = tries + 1 WHERE id = ?", (int(id),))


def open_store(cfg: Any = None, clock: Any = None, leases: Any = None) -> SqliteStore:
    """SqliteStore on cfg.db. cfg is a line.config.Config, a database path, or None (load_config())."""
    if isinstance(cfg, (str, os.PathLike)):
        return SqliteStore(os.fspath(cfg), clock=clock, leases=leases)
    if cfg is None:
        from .config import load_config
        cfg = load_config()
    return SqliteStore(cfg.db, clock=clock, leases=leases)


__all__ = ["SqliteStore", "SystemClock", "open_store", "SCHEMA_PATH", "LEASE_LIVE", "LEASE_RELEASED", "LEASE_REAPED"]
