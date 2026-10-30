"""Leases with fencing epochs (local authority) + heartbeat.

    from line.lease import SqliteLeases, Heartbeat
    leases = SqliteLeases(store, ttl_s=cfg.lease_ttl_s)
    lease = leases.acquire(unit_lease_name("U1"), owner="builder-1")   # None if held
    hb = Heartbeat(leases, lease, interval_s=cfg.heartbeat_s, on_lost=cb).start()
    ...
    hb.stop(); leases.release(hb.lease)

Rules (contracts.LeaseManager):
  * one live holder per name; a lease past expires_ms is not live (anyone may acquire it).
  * epoch +1 on every grant, strictly increasing per name, never reused (the row is kept).
  * renew / check with a stale epoch or an expired lease -> LineError(LEASE_LOST).
  * expired() lists live-but-expired leases not yet reaped; reap() marks one handled (watchdog).

The lease table lives in the store's database, so SqliteStore.emit() can fence unit events on
it inside the same transaction.
"""

from __future__ import annotations

import threading
from typing import Any, Callable, List, Optional

from . import codes
from .codes import LineError
from .contracts import Lease
from .store import LEASE_LIVE, LEASE_REAPED, LEASE_RELEASED, SqliteStore

DEFAULT_TTL_S = 300


def _lease(r: Any) -> Lease:
    return Lease(r["name"], int(r["epoch"]), int(r["expires_ms"]), r["owner"])


class SqliteLeases:
    """contracts.LeaseManager on the lease table of a SqliteStore. Thread- and process-safe."""

    def __init__(self, store: SqliteStore, ttl_s: int = DEFAULT_TTL_S, clock: Any = None):
        self.store = store
        self.ttl_s = int(ttl_s)
        self.clock = clock or store.clock

    def _ttl_ms(self, ttl_s: Optional[int]) -> int:
        return 1000 * int(ttl_s or self.ttl_s)

    def acquire(self, name: str, owner: str, ttl_s: Optional[int] = None) -> Optional[Lease]:
        with self.store.tx() as c:
            now = self.clock.now_ms()
            r = c.execute("SELECT * FROM lease WHERE name=?", (name,)).fetchone()
            if r is not None and r["state"] == LEASE_LIVE and r["expires_ms"] > now:
                return None
            epoch = (int(r["epoch"]) if r is not None else 0) + 1
            exp = now + self._ttl_ms(ttl_s)
            c.execute("INSERT INTO lease(name, epoch, expires_ms, owner, state, granted_ms) VALUES (?,?,?,?,?,?)"
                      " ON CONFLICT(name) DO UPDATE SET epoch=excluded.epoch, expires_ms=excluded.expires_ms,"
                      " owner=excluded.owner, state=excluded.state, granted_ms=excluded.granted_ms",
                      (name, epoch, exp, owner, LEASE_LIVE, now))
            return Lease(name, epoch, exp, owner)

    def _lost(self, name: str, epoch: int, current: Optional[int]) -> LineError:
        return LineError(codes.LEASE_LOST, "lease %s epoch %d lost" % (name, epoch),
                         {"name": name, "epoch": epoch, "current": current})

    def renew(self, lease: Lease, ttl_s: Optional[int] = None) -> Lease:
        with self.store.tx() as c:
            now = self.clock.now_ms()
            r = SqliteStore.live_lease_row(c, lease.name, now)
            if r is None or r["epoch"] != lease.epoch:
                raise self._lost(lease.name, lease.epoch, r["epoch"] if r is not None else None)
            exp = now + self._ttl_ms(ttl_s)
            c.execute("UPDATE lease SET expires_ms=? WHERE name=?", (exp, lease.name))
            return Lease(lease.name, lease.epoch, exp, r["owner"])

    def release(self, lease: Lease) -> None:
        with self.store.tx() as c:
            c.execute("UPDATE lease SET state=? WHERE name=? AND epoch=? AND state=?",
                      (LEASE_RELEASED, lease.name, lease.epoch, LEASE_LIVE))

    def current(self, name: str) -> Optional[Lease]:
        with self.store._read() as c:
            r = SqliteStore.live_lease_row(c, name, self.clock.now_ms())
            return _lease(r) if r is not None else None

    def check(self, name: str, epoch: int) -> None:
        cur = self.current(name)
        if cur is None or cur.epoch != epoch:
            raise LineError(codes.LEASE_LOST, "stale epoch %d for %s" % (epoch, name),
                            {"name": name, "epoch": epoch, "current": cur.epoch if cur else None})

    def expired(self, now_ms: Optional[int] = None) -> List[Lease]:
        now = self.clock.now_ms() if now_ms is None else int(now_ms)
        with self.store._read() as c:
            rows = c.execute("SELECT * FROM lease WHERE state=? AND expires_ms<=? ORDER BY expires_ms, name",
                             (LEASE_LIVE, now)).fetchall()
            return [_lease(r) for r in rows]

    def reap(self, lease: Lease) -> None:
        with self.store.tx() as c:
            c.execute("UPDATE lease SET state=? WHERE name=? AND epoch=? AND state=?",
                      (LEASE_REAPED, lease.name, lease.epoch, LEASE_LIVE))


class Heartbeat:
    """Renews a lease every interval_s on a daemon thread until stop() or the lease is lost.

    on_lost(LineError) is called once if a renew fails (the builder must stop writing: its
    epoch is stale and the store will refuse its unit events). .lease is the latest lease.
    """

    def __init__(self, leases: Any, lease: Lease, interval_s: float = 60.0, ttl_s: Optional[int] = None,
                 on_lost: Optional[Callable[[LineError], None]] = None):
        self.leases = leases
        self.lease = lease
        self.interval_s = float(interval_s)
        self.ttl_s = ttl_s
        self.on_lost = on_lost
        self.lost: Optional[LineError] = None
        self.renewals = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> "Heartbeat":
        self._thread = threading.Thread(target=self._loop, name="heartbeat:" + self.lease.name, daemon=True)
        self._thread.start()
        return self

    def beat(self) -> bool:
        """One renew. False (and on_lost fired) when the lease is lost."""
        try:
            self.lease = self.leases.renew(self.lease, self.ttl_s)
            self.renewals += 1
            return True
        except LineError as e:
            if e.code != codes.LEASE_LOST:
                raise
            self.lost = e
            self._stop.set()
            if self.on_lost is not None:
                self.on_lost(e)
            return False

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_s):
            if not self.beat():
                return

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout)

    def __enter__(self) -> "Heartbeat":
        return self.start()

    def __exit__(self, *exc: Any) -> None:
        self.stop()


__all__ = ["SqliteLeases", "Heartbeat", "DEFAULT_TTL_S"]
