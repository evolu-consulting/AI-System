"""EventStore: the port every event write and read goes through, with plug-in adapters (fen 2026-10-24).

A store keeps events per namespace with a gapless per-namespace ``seq``:

  append(ns, rows, guard=None) -> [{id, seq, duplicate}]   rows carry every kh_event column but ns/seq/received_ms
  read(ns, after_seq, kinds, hidden, filters, limit)        cursor read, oldest first
  get(ns, event_id)                                         one decoded event or None
  stats(ns, group_by, since, hidden)                        counts per group
  count_kind(ns, kind)

``guard(conn)`` runs inside the append transaction (the lease fence of a fenced kind). A store that has no such
transaction says ``supports_guard = False``; fenced kinds then stay refused on it.

Adapters (KH_EVENT_STORE): ``sql`` (the default) - table kh_event in KH's relational store (app/sqldb.py: HANA
Cloud on BTP, sqlite locally). A columnar store (ClickHouse, ...) is one more class with the same methods.
"""
from __future__ import annotations

import json
import os
from typing import Callable, Protocol

from app import sqldb

COLS = (["ns", "seq", "id", "project", "kind", "ts_ms", "received_ms", "run_id", "unit_id", "session_id", "attempt",
         "epoch", "actor_json", "schema_ver", "ix_s1", "ix_s2", "ix_s3", "ix_s4", "ix_n1", "ix_n2", "body_json"])
FILTERS = ("run_id", "unit_id", "session_id", "project")


class EventStore(Protocol):
    name: str
    supports_guard: bool

    def init(self) -> None: ...
    def append(self, ns: str, rows: list[dict], guard: Callable | None = None) -> list[dict]: ...
    def read(self, ns: str, after_seq: int, kinds: list[str], hidden: list[str], filters: dict,
             limit: int) -> list[dict]: ...
    def get(self, ns: str, event_id: str) -> dict | None: ...
    def stats(self, ns: str, group_by: list[str], since: int | None, hidden: list[str]) -> list[dict]: ...
    def count_kind(self, ns: str, kind: str) -> int: ...


def decode(r) -> dict:
    out = {k: r[k] for k in ("seq", "id", "project", "kind", "ts_ms", "received_ms", "run_id", "unit_id",
                             "session_id", "attempt", "epoch", "schema_ver")}
    out["actor"] = json.loads(r["actor_json"] or "{}")
    out["body"] = json.loads(r["body_json"] or "null")
    return out


class SqlEventStore:
    """kh_event in KH's relational store. The per-namespace counter row is the serialisation point of every
    append (commit order = seq order), so a cursor reader never skips a row that commits later with a smaller seq."""

    name = "sql"
    supports_guard = True

    def init(self) -> None:
        from app.caps import events          # owns the kh_event DDL and its migrations
        with sqldb.connect() as c:
            events.init(c)

    @staticmethod
    def _known(c, ns: str, ids: list[str]) -> dict[str, int]:
        out: dict[str, int] = {}
        uniq = sorted(set(ids))
        for k in range(0, len(uniq), 200):
            part = uniq[k:k + 200]
            for r in c.execute(f"SELECT id, seq FROM kh_event WHERE ns=? AND id IN ({','.join('?' for _ in part)})",
                               [ns] + part).fetchall():
                out[r[0]] = int(r[1])
        return out

    def _insert(self, c, ns: str, rows: list[dict]) -> list[dict]:
        """Duplicate ids keep their first seq; the counter lock covers only the UPDATE, its SELECT and the INSERTs."""
        now = sqldb.now_ms(c)                 # the database clock, read before the counter lock
        for r in rows:
            r["ns"] = ns
            r["received_ms"] = now
            if r.get("ts_ms") is None:
                r["ts_ms"] = now
        known = self._known(c, ns, [r["id"] for r in rows])
        out, fresh = [], []
        for row in rows:
            old = known.get(row["id"])
            if old is not None or any(f["id"] == row["id"] for f in fresh):
                out.append({"id": row["id"], "seq": old, "duplicate": True})
                continue
            fresh.append(row)
            out.append({"id": row["id"], "seq": None, "duplicate": False})
        if fresh:
            top = sqldb.counter_add(c, "ev:" + ns, len(fresh))
            first = top - len(fresh) + 1
            for n, row in enumerate(fresh):
                row["seq"] = first + n
            for o in out:
                if o["seq"] is None:
                    o["seq"] = next(r["seq"] for r in fresh if r["id"] == o["id"])
            sql = f"INSERT INTO kh_event ({', '.join(COLS)}) VALUES ({','.join('?' for _ in COLS)})"
            for row in fresh:
                c.execute(sql, [row.get(k) for k in COLS])
        return out

    def append(self, ns: str, rows: list[dict], guard: Callable | None = None) -> list[dict]:
        """One transaction (plus ``guard``), retried when a concurrent append of the same id won the unique index."""
        for attempt in range(3):
            try:
                with sqldb.connect() as c:
                    res = self._insert(c, ns, rows)
                    if guard is not None:
                        guard(c)
                return res
            except Exception as exc:  # noqa: BLE001 - dialect-specific unique-violation classes
                if attempt < 2 and sqldb.is_duplicate(exc):
                    continue
                raise
        raise RuntimeError("unreachable")

    def read(self, ns, after_seq, kinds, hidden, filters, limit):
        where, params = ["ns=?", "seq>?"], [ns, int(after_seq)]
        if kinds:
            where.append(f"kind IN ({','.join('?' for _ in kinds)})")
            params += kinds
        if hidden:
            where.append(f"kind NOT IN ({','.join('?' for _ in hidden)})")
            params += hidden
        for col in FILTERS:
            if filters.get(col):
                where.append(f"{col}=?")
                params.append(filters[col])
        with sqldb.connect() as c:
            rows = c.execute(f"SELECT * FROM kh_event WHERE {' AND '.join(where)} ORDER BY seq LIMIT ?",
                             params + [int(limit)]).fetchall()
        return [decode(r) for r in rows]

    def get(self, ns, event_id):
        with sqldb.connect() as c:
            r = c.execute("SELECT * FROM kh_event WHERE ns=? AND id=?", [ns, event_id]).fetchone()
        return decode(r) if r is not None else None

    def stats(self, ns, group_by, since, hidden):
        where, params = ["ns=?"], [ns]
        if since is not None:
            where.append("ts_ms>=?")
            params.append(int(since))
        if hidden:
            where.append(f"kind NOT IN ({','.join('?' for _ in hidden)})")
            params += hidden
        cols = ", ".join(group_by)
        with sqldb.connect() as c:
            rows = c.execute(f"SELECT {cols}, COUNT(*) AS n FROM kh_event WHERE {' AND '.join(where)} "
                             f"GROUP BY {cols} ORDER BY n DESC LIMIT 1000", params).fetchall()
        return [{**{g: r[g] for g in group_by}, "n": int(r["n"])} for r in rows]

    def count_kind(self, ns, kind):
        with sqldb.connect() as c:
            return int(c.execute("SELECT COUNT(*) FROM kh_event WHERE ns=? AND kind=?", [ns, kind]).fetchone()[0])


ADAPTERS: dict[str, type] = {"sql": SqlEventStore}
_store: EventStore | None = None


def get_store() -> EventStore:
    """The store KH_EVENT_STORE names (default sql), created once."""
    global _store
    if _store is None:
        name = (os.getenv("KH_EVENT_STORE") or "sql").strip().lower()
        if name not in ADAPTERS:
            raise ValueError(f"KH_EVENT_STORE: unknown store '{name}' (known: {', '.join(ADAPTERS)})")
        _store = ADAPTERS[name]()
    return _store


def set_store(store: EventStore | None) -> None:
    """Swap the store (tests, or a store chosen at start-up)."""
    global _store
    _store = store
