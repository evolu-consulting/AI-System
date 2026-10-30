"""Run-scoped views of the Store and of the lease manager.

Unit ids are short and only unique within a run ("U1", "T_F2_C1", attempt "U1#2"). Several runs
share one store, so the pipeline gives every slice a per-run view:

  ScopedStore(store, run)    records of SCOPED entities are keyed "<run>:<id>" in the store; the
                             row's own "id" field stays the display id ("U1"). Everything else
                             (events, other entities, outbox, tx) passes through unchanged.
  ScopedLeases(leases, run)  unit lease "unit:U1" is held as "unit:<run>:U1"; expired() lists only
                             this run's unit leases, under their display names, so a run-scoped
                             Watchdog requeues the right unit.

An id that already starts with "<run>:" is used as is (slices that scope their own keys, e.g.
acceptance tests "<run>:T_F1_C1", keep working). Event envelopes keep the display unit id; the
store fences a unit event on "unit:<run>:<unit>" when that lease exists (see SqliteStore.emit).
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional

from .contracts import E_ACC_TEST, E_ATTEMPT, E_GATE, E_UNIT, Lease, unit_lease_name

#: entities whose ids are only unique within a run
SCOPED = frozenset({E_UNIT, E_ATTEMPT, E_ACC_TEST, E_GATE})

UNIT_PREFIX = unit_lease_name("")


def unit_key(run: str, id: str) -> str:
    """Store key of a run-local id: "<run>:<id>" (unchanged when already scoped)."""
    p = run + ":"
    return id if not run or id.startswith(p) else p + id


def scoped_lease_name(run: str, name: str) -> str:
    """"unit:U1" -> "unit:<run>:U1"; other names unchanged."""
    if not run or not name.startswith(UNIT_PREFIX):
        return name
    return UNIT_PREFIX + unit_key(run, name[len(UNIT_PREFIX):])


class ScopedStore:
    """contracts.Store for one run (see module doc). Attribute access falls through to the store."""

    def __init__(self, store: Any, run: str):
        self._store = store
        self.run = run
        self._leases: Optional[ScopedLeases] = None

    @property
    def raw(self) -> Any:
        return self._store

    def key(self, entity: str, id: str) -> str:
        return unit_key(self.run, id) if entity in SCOPED else id

    # records
    def put(self, entity: str, id: str, row: Any, run: str = "", if_version: Optional[int] = None) -> int:
        return self._store.put(entity, self.key(entity, id), row, run=run or self.run, if_version=if_version)

    def get(self, entity: str, id: str) -> Optional[Dict[str, Any]]:
        return self._store.get(entity, self.key(entity, id))

    def version(self, entity: str, id: str) -> int:
        return self._store.version(entity, self.key(entity, id))

    def transition(self, entity: str, id: str, to: Any, expect_from: Any) -> Dict[str, Any]:
        return self._store.transition(entity, self.key(entity, id), to, expect_from)

    def query(self, entity: str, run: Optional[str] = None, **eq: Any) -> List[Dict[str, Any]]:
        return self._store.query(entity, run=run, **eq)

    # events / outbox: unchanged
    def emit(self, kind: str, env: Any, body: Optional[Mapping[str, Any]] = None) -> int:
        return self._store.emit(kind, env, body)

    @property
    def leases(self) -> "ScopedLeases":
        if self._leases is None:
            self._leases = ScopedLeases(self._store.leases, self.run)
        return self._leases

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)


class ScopedLeases:
    """contracts.LeaseManager for one run: unit leases carry the run in their name."""

    def __init__(self, leases: Any, run: str):
        self._leases = leases
        self.run = run
        self._prefix = UNIT_PREFIX + run + ":"

    def full(self, name: str) -> str:
        return scoped_lease_name(self.run, name)

    def _bare(self, lease: Lease) -> Lease:
        if lease.name.startswith(self._prefix):
            return Lease(UNIT_PREFIX + lease.name[len(self._prefix):], lease.epoch, lease.expires_ms, lease.owner)
        return lease

    def _as_full(self, lease: Lease) -> Lease:
        return Lease(self.full(lease.name), lease.epoch, lease.expires_ms, lease.owner)

    def acquire(self, name: str, owner: str, ttl_s: Optional[int] = None) -> Optional[Lease]:
        return self._leases.acquire(self.full(name), owner, ttl_s)

    def renew(self, lease: Lease, ttl_s: Optional[int] = None) -> Lease:
        return self._leases.renew(self._as_full(lease), ttl_s)

    def release(self, lease: Lease) -> None:
        self._leases.release(self._as_full(lease))

    def current(self, name: str) -> Optional[Lease]:
        return self._leases.current(self.full(name))

    def check(self, name: str, epoch: int) -> None:
        self._leases.check(self.full(name), epoch)

    def expired(self, now_ms: Optional[int] = None) -> List[Lease]:
        return [self._bare(l) for l in self._leases.expired(now_ms) if l.name.startswith(self._prefix)]

    def reap(self, lease: Lease) -> None:
        self._leases.reap(self._as_full(lease))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._leases, name)


def scoped(store: Any, run: str) -> ScopedStore:
    return store if isinstance(store, ScopedStore) and store.run == run else ScopedStore(
        store.raw if isinstance(store, ScopedStore) else store, run)


__all__ = ["SCOPED", "ScopedStore", "ScopedLeases", "unit_key", "scoped_lease_name", "scoped"]
