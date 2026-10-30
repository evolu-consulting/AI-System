"""RAG-backed state (opt-in): the RAG System as lease authority and as a mirror of the line's records.

Both parts are off by default and do nothing until the integrator wires them (hooks at the end):

  cfg.rag_leases  (proposed LINE_RAG_LEASES, default False)
      A run admitted while the RAG System's leases capability was live (rag.admit_run -> "rag") takes
      its leases from rag.lease_port(run) for its whole life: make_leases() returns RagLeases.
  cfg.rag_records (proposed LINE_RAG_RECORDS, default False)
      Store rows of run / unit / digest / acc_test / graph are written to the RAG System as records
      (manifest.RECORD_TYPES) with If-Match through the resilient port: wrap_store() returns a
      MirroringStore that pushes after every local write of those entities.

RagLeases(port, store) - contracts.LeaseManager
  * The remote grant decides: acquire() asks port.lease_acquire first; held -> None.
  * Mirror on the local store: every remote grant is mirrored into the store's lease table with a
    LOCAL epoch (strictly increasing per name, as SqliteLeases), so SqliteStore.emit keeps fencing
    unit events inside its own transaction. The remote lease is kept beside it (by name + local epoch).
    The remote epoch is not used for fencing: a RAG System that names holders after the calling
    identity may repeat epochs between owners (see rag.http_adapter).
  * Clock skew: the local expiry is computed from the LOCAL clock taken BEFORE the remote call,
    t0 + ttl - margin, never from the remote's until_ms; a skewed remote clock cannot make the line
    believe it still holds a lease the remote already let go.
  * Outage: acquire -> None (nothing new is dispatched while the authority is unreachable; no silent
    switch to local leases). renew -> the lease unchanged while its local expiry has not passed, then
    LEASE_LOST: the builder stops before the remote lease could have run out. release -> local release,
    remote best effort (it expires anyway).
  * A remote LEASE_LOST on renew releases the mirror and raises LEASE_LOST.
  * current / check / expired / reap: the mirror (local table), as SqliteLeases.

RagRecords(rag, store) - record mirror with conflict handling
  push(entity, key) writes {"entity","key","line_version","row"} as record <type>/<record_id(key)>:
    * if_match = the etag of the last write (kept in the store's meta table: "rag_mirror:<type>:<id>"),
      None for the first write; idem_key "rec-<type>-<id>-v<line_version>" (replays are no-ops);
    * VERSION_CONFLICT / PRECONDITION_REQUIRED -> read the remote record:
        remote line_version <  local  -> overwrite with If-Match = its etag (bounded retries)
        remote line_version == local, same row -> adopt its etag ("same")
        remote line_version >  local  -> "conflict": another writer is ahead; nothing is overwritten,
                                         a rag.conflict event goes to the system run "_line"
    * degraded: the resilient port queues the write (etag "queued:<key>", resolved at replay);
    * any other error -> "error" (kept in .errors), never raised into the line.
  behind(run) lists mirrored rows whose store version is newer than the mirror (the reconciler's
  rag_records check); pull(entity, key) reads the remote record back (for a restore / comparison).
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Tuple

from . import codes
from .codes import LineError
from .contracts import E_ACC_TEST, E_DIGEST, E_GRAPH, E_RUN, E_UNIT, Envelope, Lease, LeaseAuthority, now_ms, to_dict
from .lease import SqliteLeases
from .store import LEASE_LIVE, LEASE_RELEASED, SqliteStore

# ------------------------------------------------------------------ new kinds / config (integrator)

RAG_CONFLICT = "rag.conflict"     # body: {"type", "id", "key", "local_version", "remote_version", "run"}
NEW_EVENT_KINDS = (RAG_CONFLICT,)
SYSTEM_RUN = "_line"

#: line Store entity -> RAG record type (inverse of rag.manifest.RECORD_TYPES)
ENTITY_TYPES: Dict[str, str] = {E_RUN: "run", E_UNIT: "unit", E_DIGEST: "digest", E_ACC_TEST: "test", E_GRAPH: "graph"}

META_PREFIX = "rag_mirror:"
PUSH_RETRIES = 3
_ID_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]")


def leases_enabled(cfg: Any) -> bool:
    return bool(getattr(cfg, "rag_leases", False))


def records_enabled(cfg: Any) -> bool:
    return bool(getattr(cfg, "rag_records", False))


def record_id(key: str) -> str:
    """Remote record id of a store key ("<run>:U1" -> "<run>_U1"): [A-Za-z0-9_.-], <= 120 chars."""
    return _ID_UNSAFE.sub("_", key)[:120] or "_"


def skew_margin_ms(ttl_ms: int) -> int:
    """Safety margin taken off a remote lease's local expiry: 10% of the TTL, 200 ms .. 5 s."""
    return max(200, min(5000, ttl_ms // 10))


# ================================================================== leases


class RagLeases(SqliteLeases):
    """contracts.LeaseManager with the RAG System as authority, mirrored in the store's lease table."""

    def __init__(self, port: Any, store: SqliteStore, ttl_s: int = 300, clock: Any = None):
        super().__init__(store, ttl_s=ttl_s, clock=clock)
        self.port = port
        self._remote: Dict[Tuple[str, int], Lease] = {}
        self._mu = threading.Lock()
        self.outages = 0

    def _key(self, lease: Lease) -> Tuple[str, int]:
        return (lease.name, int(lease.epoch))

    def _mirror_grant(self, name: str, owner: str, expires_ms: int) -> Optional[Lease]:
        """Local grant with a fresh local epoch; None when the mirror still shows a live holder."""
        with self.store.tx() as c:
            now = self.clock.now_ms()
            r = c.execute("SELECT * FROM lease WHERE name=?", (name,)).fetchone()
            if r is not None and r["state"] == LEASE_LIVE and r["expires_ms"] > now:
                return None
            epoch = (int(r["epoch"]) if r is not None else 0) + 1
            c.execute("INSERT INTO lease(name, epoch, expires_ms, owner, state, granted_ms) VALUES (?,?,?,?,?,?)"
                      " ON CONFLICT(name) DO UPDATE SET epoch=excluded.epoch, expires_ms=excluded.expires_ms,"
                      " owner=excluded.owner, state=excluded.state, granted_ms=excluded.granted_ms",
                      (name, epoch, expires_ms, owner, LEASE_LIVE, now))
            return Lease(name, epoch, expires_ms, owner)

    def acquire(self, name: str, owner: str, ttl_s: Optional[int] = None) -> Optional[Lease]:
        ttl = int(ttl_s or self.ttl_s)
        ttl_ms = 1000 * ttl
        if self.current(name) is not None:          # the mirror says held: do not even ask
            return None
        t0 = self.clock.now_ms()
        try:
            remote = self.port.lease_acquire(name, ttl, owner)
        except LineError as e:
            if e.code != codes.RAG_DEGRADED:
                raise
            self.outages += 1
            return None
        if remote is None:
            return None
        local = self._mirror_grant(name, owner, t0 + ttl_ms - skew_margin_ms(ttl_ms))
        if local is None:                            # lost a local race: give the remote grant back
            self._remote_release(remote)
            return None
        with self._mu:
            self._remote[self._key(local)] = remote
        return local

    def renew(self, lease: Lease, ttl_s: Optional[int] = None) -> Lease:
        ttl = int(ttl_s or self.ttl_s)
        ttl_ms = 1000 * ttl
        cur = self.current(lease.name)
        if cur is None or cur.epoch != lease.epoch:
            raise self._lost(lease.name, lease.epoch, cur.epoch if cur else None)
        with self._mu:
            remote = self._remote.get(self._key(lease))
        if remote is None:                           # granted by another process / before a restart
            raise self._lost(lease.name, lease.epoch, cur.epoch)
        t0 = self.clock.now_ms()
        try:
            remote2 = self.port.lease_renew(remote, ttl)
        except LineError as e:
            if e.code == codes.LEASE_LOST:
                self._mark(lease, LEASE_RELEASED)
                with self._mu:
                    self._remote.pop(self._key(lease), None)
                raise self._lost(lease.name, lease.epoch, None)
            if e.code != codes.RAG_DEGRADED:
                raise
            self.outages += 1
            return cur                               # unchanged: runs out at its local expiry
        exp = t0 + ttl_ms - skew_margin_ms(ttl_ms)
        with self.store.tx() as c:
            r = SqliteStore.live_lease_row(c, lease.name, self.clock.now_ms())
            if r is None or r["epoch"] != lease.epoch:
                raise self._lost(lease.name, lease.epoch, r["epoch"] if r is not None else None)
            c.execute("UPDATE lease SET expires_ms=? WHERE name=? AND epoch=?", (exp, lease.name, lease.epoch))
        with self._mu:
            self._remote[self._key(lease)] = remote2
        return Lease(lease.name, lease.epoch, exp, cur.owner)

    def _mark(self, lease: Lease, state: str) -> None:
        with self.store.tx() as c:
            c.execute("UPDATE lease SET state=? WHERE name=? AND epoch=? AND state=?",
                      (state, lease.name, lease.epoch, LEASE_LIVE))

    def _remote_release(self, remote: Lease) -> None:
        try:
            self.port.lease_release(remote)
        except LineError:
            pass                                     # it expires on the remote anyway

    def release(self, lease: Lease) -> None:
        super().release(lease)
        with self._mu:
            remote = self._remote.pop(self._key(lease), None)
        if remote is not None:
            self._remote_release(remote)

    def reap(self, lease: Lease) -> None:
        super().reap(lease)
        with self._mu:
            remote = self._remote.pop(self._key(lease), None)
        if remote is not None:
            self._remote_release(remote)


# ================================================================== records


@dataclass
class PushResult:
    status: str                       # written | same | queued | conflict | error | absent
    type: str = ""
    id: str = ""
    etag: str = ""
    version: int = 0
    detail: Dict[str, Any] = field(default_factory=dict)


class RagRecords:
    def __init__(self, rag: Any, store: Any, agent_version: str = ""):
        self.rag = rag
        self.store = getattr(store, "raw", store)
        self.agent_version = agent_version
        self._mu = threading.RLock()
        self._mem: Dict[str, Dict[str, Any]] = {}        # stores without a meta table
        self.errors: List[Dict[str, Any]] = []
        self.conflicts: List[Dict[str, Any]] = []

    # ------------------------------------------------------------ mirror bookkeeping (meta table)

    def _meta_key(self, rtype: str, rid: str) -> str:
        return "%s%s:%s" % (META_PREFIX, rtype, rid)

    def mirror(self, rtype: str, rid: str) -> Optional[Dict[str, Any]]:
        """{"etag", "version", "ts_ms"} of the last write of this record, or None."""
        k = self._meta_key(rtype, rid)
        rd = getattr(self.store, "_read", None)
        if rd is None:
            return self._mem.get(k)
        with rd() as c:
            r = c.execute("SELECT value FROM meta WHERE key=?", (k,)).fetchone()
        return json.loads(r["value"]) if r is not None else None

    def _save(self, rtype: str, rid: str, etag: str, version: int) -> None:
        k = self._meta_key(rtype, rid)
        val = {"etag": etag, "version": int(version), "ts_ms": now_ms()}
        if getattr(self.store, "tx", None) is None:
            self._mem[k] = val
            return
        with self.store.tx() as c:
            c.execute("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (k, json.dumps(val)))

    # ------------------------------------------------------------ push / pull

    def _body(self, entity: str, key: str, row: Mapping[str, Any], version: int) -> Dict[str, Any]:
        return {"entity": entity, "key": key, "line_version": int(version), "row": to_dict(dict(row))}

    def push(self, entity: str, key: str) -> PushResult:
        """Write the store row <entity>/<key> as its RAG record (see module doc). Never raises."""
        rtype = ENTITY_TYPES.get(entity)
        if rtype is None:
            return PushResult("error", detail={"why": "entity %s is not mirrored" % entity})
        rid = record_id(key)
        with self._mu:
            try:
                return self._push(entity, key, rtype, rid)
            except LineError as e:
                self.errors.append({"type": rtype, "id": rid, "error": e.to_dict()})
                return PushResult("error", rtype, rid, detail=e.to_dict())
            except Exception as e:   # noqa: BLE001 - the mirror must never break the line
                self.errors.append({"type": rtype, "id": rid, "error": "%s: %s" % (type(e).__name__, e)})
                return PushResult("error", rtype, rid, detail={"error": str(e)})

    def _push(self, entity: str, key: str, rtype: str, rid: str) -> PushResult:
        ver = int(self.store.version(entity, key))
        row = self.store.get(entity, key)
        if row is None:
            return PushResult("absent", rtype, rid)
        m = self.mirror(rtype, rid)
        if m is not None and int(m.get("version", 0)) >= ver:
            return PushResult("same", rtype, rid, m.get("etag", ""), ver)
        body = self._body(entity, key, row, ver)
        if_match = (m or {}).get("etag") or None
        idem = "rec-%s-%s-v%d" % (rtype, rid, ver)
        for attempt in range(PUSH_RETRIES + 1):
            try:
                etag = self.rag.put_record(rtype, rid, body, if_match=if_match,
                                           idem_key=idem if attempt == 0 else "%s-r%d" % (idem, attempt))
            except LineError as e:
                if e.code not in (codes.VERSION_CONFLICT, codes.PRECONDITION_REQUIRED) or attempt == PUSH_RETRIES:
                    raise
                cur = self.rag.get_record(rtype, rid)
                if cur is None:
                    if_match = None
                    continue
                rbody, retag = cur
                rver = int((rbody or {}).get("line_version", 0) or 0)
                if rver > ver:
                    return self._conflict(entity, key, rtype, rid, ver, rver, row)
                if rver == ver and (rbody or {}).get("row") == body["row"]:
                    self._save(rtype, rid, retag, ver)
                    return PushResult("same", rtype, rid, retag, ver)
                if_match = retag
                continue
            status = "queued" if str(etag).startswith("queued:") else "written"
            self._save(rtype, rid, str(etag), ver)
            return PushResult(status, rtype, rid, str(etag), ver)
        raise LineError(codes.VERSION_CONFLICT, "record %s/%s: retries exhausted" % (rtype, rid))

    def _conflict(self, entity: str, key: str, rtype: str, rid: str, ver: int, rver: int,
                  row: Mapping[str, Any]) -> PushResult:
        info = {"type": rtype, "id": rid, "key": key, "local_version": ver, "remote_version": rver,
                "run": str(row.get("run", "") or (row.get("id", "") if entity == E_RUN else ""))}
        self.conflicts.append(info)
        try:
            self.store.emit(RAG_CONFLICT, Envelope(run=SYSTEM_RUN, agent_version=self.agent_version), info)
        except LineError:
            pass                                       # kind not registered yet: kept in .conflicts
        return PushResult("conflict", rtype, rid, version=ver, detail=info)

    def pull(self, entity: str, key: str) -> Optional[Tuple[Dict[str, Any], str]]:
        """(remote body, etag) of the record that mirrors <entity>/<key>, or None."""
        rtype = ENTITY_TYPES.get(entity)
        if rtype is None:
            return None
        return self.rag.get_record(rtype, record_id(key))

    def push_run(self, run: str) -> List[PushResult]:
        """Push every mirrored row of a run (run row first)."""
        out = [self.push(E_RUN, run)]
        for entity in (E_DIGEST, E_ACC_TEST, E_GRAPH, E_UNIT):
            for key in self._keys(entity, run):
                out.append(self.push(entity, key))
        return out

    def _keys(self, entity: str, run: str) -> List[str]:
        rd = getattr(self.store, "_read", None)
        if rd is not None:
            with rd() as c:
                return [r["id"] for r in c.execute("SELECT id FROM record WHERE entity=? AND run=? ORDER BY ord",
                                                   (entity, run))]
        from .scope import unit_key
        return [unit_key(run, r["id"]) if entity in (E_UNIT, E_ACC_TEST) else r.get("id", "")
                for r in self.store.query(entity, run=run)]

    def behind(self, run: str) -> List[Dict[str, Any]]:
        """Mirrored rows of a run whose store version is newer than the last write (reconciler check)."""
        out = []
        for entity in (E_RUN, E_DIGEST, E_ACC_TEST, E_GRAPH, E_UNIT):
            keys = [run] if entity == E_RUN else self._keys(entity, run)
            for key in keys:
                ver = int(self.store.version(entity, key))
                if not ver:
                    continue
                rtype = ENTITY_TYPES[entity]
                m = self.mirror(rtype, record_id(key))
                if m is None or int(m.get("version", 0)) < ver:
                    out.append({"entity": entity, "key": key, "type": rtype, "version": ver,
                                "mirrored": int((m or {}).get("version", 0)),
                                "unit": key.split(":", 1)[1] if entity == E_UNIT and ":" in key else ""})
        conflicted = {(c["type"], c["id"]) for c in self.conflicts}
        for item in out:
            if (item["type"], record_id(item["key"])) in conflicted:
                item["conflict"] = True
        return out


class MirroringStore:
    """A Store whose writes of mirrored entities are pushed to the RAG System after the local write.
    Everything else passes through (attribute access falls through to the wrapped store)."""

    def __init__(self, store: Any, records: RagRecords):
        self._store = store
        self.records = records

    @property
    def raw(self) -> Any:
        return self._store

    def put(self, entity: str, id: str, row: Any, run: str = "", if_version: Optional[int] = None) -> int:
        v = self._store.put(entity, id, row, run=run, if_version=if_version)
        if entity in ENTITY_TYPES:
            self.records.push(entity, id)
        return v

    def transition(self, entity: str, id: str, to: Any, expect_from: Any) -> Dict[str, Any]:
        row = self._store.transition(entity, id, to, expect_from)
        if entity in ENTITY_TYPES:
            self.records.push(entity, id)
        return row

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)


# ================================================================== hooks for the integrator


def make_leases(cfg: Any, store: Any, rag: Any, run: str, ttl_s: Optional[int] = None) -> Any:
    """Pipeline._setup: replaces `SqliteLeases(self.store, ttl_s=cfg.lease_ttl_s)`. Returns RagLeases when
    cfg.rag_leases is on AND the run was admitted with RAG lease authority (rag.lease_authority(run) == "rag"),
    else the plain SqliteLeases (default: unchanged behaviour). Wrap it in ScopedLeases as today."""
    ttl = int(ttl_s or getattr(cfg, "lease_ttl_s", 300))
    raw = getattr(store, "raw", store)
    if leases_enabled(cfg) and rag is not None:
        try:
            auth = rag.lease_authority(run)
        except Exception:   # noqa: BLE001
            auth = LeaseAuthority.LOCAL.value
        if auth == LeaseAuthority.RAG.value:
            return RagLeases(rag.lease_port(run), raw, ttl_s=ttl)
    return SqliteLeases(raw, ttl_s=ttl)


def wrap_store(store: Any, cfg: Any, rag: Any) -> Any:
    """Pipeline.__init__ / make_driver: `store = rag_state.wrap_store(store, cfg, rag)` before the ScopedStore
    is made. Returns a MirroringStore when cfg.rag_records is on, else the store unchanged."""
    if not records_enabled(cfg) or rag is None or isinstance(store, MirroringStore):
        return store
    return MirroringStore(store, RagRecords(rag, store, getattr(cfg, "agent_version", "")))


def on_admit(store: Any, cfg: Any, rag: Any, run: str) -> List[PushResult]:
    """Pipeline.admit, after the run row and budget exist: push the run row (no-op when records are off or the
    store is a MirroringStore already, which pushed it)."""
    if not records_enabled(cfg) or rag is None or isinstance(store, MirroringStore):
        return []
    return [RagRecords(rag, store, getattr(cfg, "agent_version", "")).push(E_RUN, run)]


def records_of(store: Any) -> Optional[RagRecords]:
    """The RagRecords behind a (possibly scoped / guarded) MirroringStore, for Reconciler(records=...)."""
    s = store
    for _ in range(5):
        if isinstance(s, MirroringStore):
            return s.records
        nxt = getattr(s, "_store", None)
        if nxt is None:
            return None
        s = nxt
    return None


__all__ = ["RagLeases", "RagRecords", "MirroringStore", "PushResult", "make_leases", "wrap_store", "on_admit",
           "records_of", "record_id", "skew_margin_ms", "leases_enabled", "records_enabled", "ENTITY_TYPES",
           "RAG_CONFLICT", "NEW_EVENT_KINDS"]
