"""Per-capability degraded mode around a remote RagPort.

  * Discovery: the remote's capabilities() decides which capabilities are live. A missing capability
    is degraded on its own; the others keep working.
  * A remote call that fails with RAG_DEGRADED (transport error, 5xx, route absent ...) degrades the
    capability of that call only. Each change emits rag.degraded {capability, error} into the Store.
  * Writes of a degraded capability (append_events, put_record, freeze_pack, metric) never raise
    RAG_DEGRADED: they go to the Store outbox with their idempotency key. While a capability has
    queued writes, new writes of it queue behind them, so order is kept.
  * probe() (also run lazily every probe_interval_s before a call while something is degraded) asks
    the remote again; for every capability back it replays that capability's outbox items in id
    order with the SAME idempotency keys, then emits rag.restored {capability, replayed}.
  * Reads while degraded: retrieve -> []; get_record / events_after / quote -> the local adapter.
  * Leases: the lease authority of a run is fixed at admission (admit_run). Runs admitted while the
    leases capability is live use the RAG System for their whole life (a lease call then raises
    RAG_DEGRADED during an outage: there is no silent switch to local fencing); runs admitted while
    it is degraded use local leases. lease_port(run) gives the right one.

put_record while degraded returns a placeholder etag "queued:<idem_key>". Using it as if_match later
(queued or live) is resolved to the real etag the replay obtained.
"""

from __future__ import annotations

import inspect
import threading
import time
import uuid
from collections import Counter
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import Envelope, Lease, LeaseAuthority, OutboxItem, RagCapabilities, Span, to_dict
from .http_adapter import batch_key, wire_event_id
from .local_adapter import LocalRagAdapter

#: write op -> capability. Only these are queued.
WRITE_OPS: Dict[str, str] = {
    "append_events": "events", "put_record": "records", "freeze_pack": "packs", "metric": "metrics",
    "write_worklog": "retrieve",
}
QUEUED_ETAG_PREFIX = "queued:"
OUTBOX_SCAN = 100_000


class ResilientRag:
    def __init__(self, remote: Any, store: Any, local: Optional[LocalRagAdapter] = None, *,
                 probe_interval_s: float = 30.0, now: Optional[Callable[[], float]] = None,
                 system_run: str = "_line", agent_version: str = "", max_tries: int = 5):
        self.remote = remote
        self.store = store
        self.local = local if local is not None else LocalRagAdapter(store)
        self.probe_interval_s = float(probe_interval_s)
        self._now = now or time.monotonic
        self.system_run = system_run
        self.agent_version = agent_version
        self.max_tries = int(max_tries)
        self._lock = threading.RLock()
        self._remote_caps: Optional[RagCapabilities] = None
        self._degraded: Dict[str, str] = {}
        self._last_probe = float("-inf")
        self._authority: Dict[str, str] = {}
        self._etags: Dict[str, str] = {}          # "queued:<key>" -> real etag after replay
        self._last_etag: Dict[Tuple[str, str], str] = {}
        self.dead: List[Dict[str, Any]] = []      # outbox items dropped after max_tries permanent errors
        self._pending: Counter = Counter()
        for it in self.store.outbox_peek(OUTBOX_SCAN):
            if it.op in WRITE_OPS:
                self._pending[WRITE_OPS[it.op]] += 1

    # ------------------------------------------------------------ state

    def _emit(self, kind: str, body: Mapping[str, Any]) -> None:
        try:
            self.store.emit(kind, Envelope(run=self.system_run, agent_version=self.agent_version), dict(body))
        except Exception:  # noqa: BLE001 - telemetry must never break a RAG call
            pass

    def _degrade(self, cap: str, err: Any) -> None:
        with self._lock:
            if cap in self._degraded:
                return
            self._degraded[cap] = str(err)[:300]
        self._emit(codes.RAG_DEGRADED_KIND, {"capability": cap, "error": str(err)[:300]})

    def _restore(self, cap: str, replayed: int) -> None:
        with self._lock:
            if cap not in self._degraded:
                return
            del self._degraded[cap]
        self._emit(codes.RAG_RESTORED, {"capability": cap, "replayed": replayed})

    def _discover(self) -> Optional[RagCapabilities]:
        try:
            caps = self.remote.capabilities()
        except LineError as e:
            if e.code != codes.RAG_DEGRADED:
                raise
            for name in RagCapabilities.NAMES:
                self._degrade(name, e)
            return None
        with self._lock:
            self._remote_caps = caps
        for name in RagCapabilities.NAMES:
            if not getattr(caps, name, False):
                self._degrade(name, "capability %s not offered" % name)
        return caps

    def _ensure(self) -> None:
        """Discover on first use; while anything is degraded or queued, probe every probe_interval_s."""
        if (self._remote_caps is None or self._degraded or any(self._pending.values())) and \
                self._now() - self._last_probe >= self.probe_interval_s:
            self.probe()

    def degraded(self) -> List[str]:
        with self._lock:
            return sorted(self._degraded)

    def is_live(self, cap: str) -> bool:
        return cap not in self._degraded and self._remote_caps is not None

    def pending(self, cap: Optional[str] = None) -> int:
        with self._lock:
            return self._pending[cap] if cap else sum(self._pending.values())

    def probe(self) -> List[str]:
        """Ask the remote again; replay and restore every capability that is back. Returns restored names."""
        self._last_probe = self._now()
        caps = self._discover()
        if caps is None:
            return []
        live = {n for n in RagCapabilities.NAMES if getattr(caps, n, False)}
        want = {c for c in set(self._degraded) | {c for c, n in self._pending.items() if n} if c in live}
        replayed, failed = self._replay(want) if want else (Counter(), set())
        restored = []
        for cap in sorted(want):
            if self._pending[cap] == 0 and cap in self._degraded and cap not in failed:
                self._restore(cap, replayed[cap])
                restored.append(cap)
        # a degraded capability with nothing queued and present again
        for cap in sorted(set(self._degraded) & live - want):
            self._restore(cap, 0)
            restored.append(cap)
        return restored

    # ------------------------------------------------------------ outbox

    def _accepts(self, fn: Any, name: str) -> bool:
        try:
            return name in inspect.signature(fn).parameters
        except (TypeError, ValueError):
            return False

    def _resolve_if_match(self, type: str, id: str, if_match: Optional[str]) -> Optional[str]:
        if not if_match or not if_match.startswith(QUEUED_ETAG_PREFIX):
            return if_match
        if if_match in self._etags:
            return self._etags[if_match]
        if (type, id) in self._last_etag:
            return self._last_etag[(type, id)]
        cur = self.remote.get_record(type, id)
        return cur[1] if cur else None

    def _invoke(self, op: str, args: Mapping[str, Any], key: str) -> Any:
        r = self.remote
        if op == "append_events":
            return r.append_events(list(args["batch"]), key)
        if op == "put_record":
            if_match = self._resolve_if_match(args["type"], args["id"], args.get("if_match"))
            etag = r.put_record(args["type"], args["id"], dict(args["body"]), if_match, idem_key=key)
            self._etags[QUEUED_ETAG_PREFIX + key] = etag
            self._last_etag[(args["type"], args["id"])] = etag
            return etag
        if op == "freeze_pack":
            return r.freeze_pack(dict(args["files"]), idem_key=key)
        if op == "metric":
            if self._accepts(r.metric, "idem_key"):
                return r.metric(args["name"], args["value"], args.get("dims"), idem_key=key)
            return r.metric(args["name"], args["value"], args.get("dims"))
        if op == "write_worklog":
            return r.write_worklog(args["subject"], args["text"], idem_key=key)
        raise LineError(codes.NOT_FOUND, "unknown outbox op %r" % op, {"op": op})

    def _replay(self, caps: set) -> Tuple[Counter, set]:
        """Replay queued writes of caps in outbox id order with their original keys.
        Returns (replayed per capability, capabilities that stopped on an error)."""
        done: Counter = Counter()
        failed: set = set()
        active = set(caps)
        with self._lock:
            for it in self.store.outbox_peek(OUTBOX_SCAN):
                cap = WRITE_OPS.get(it.op)
                if cap not in active:
                    continue
                try:
                    self._invoke(it.op, it.args, it.idem_key)
                except LineError as e:
                    self.store.outbox_fail(it.id)
                    if e.code == codes.RAG_DEGRADED:
                        active.discard(cap)
                        failed.add(cap)
                        self._degrade(cap, e)
                        continue
                    if it.tries + 1 >= self.max_tries:
                        self.store.outbox_ack(it.id)
                        self._pending[cap] -= 1
                        self.dead.append({"item": to_dict(it), "error": e.to_dict()})
                        continue
                    active.discard(cap)              # keep order: retry this item at the next probe
                    failed.add(cap)
                    continue
                self.store.outbox_ack(it.id)
                self._pending[cap] -= 1
                done[cap] += 1
        return done, failed

    def _queue(self, op: str, args: Mapping[str, Any], key: str) -> int:
        with self._lock:
            i = self.store.outbox_push(op, args, key)
            self._pending[WRITE_OPS[op]] += 1
            return i

    def _write(self, op: str, args: Dict[str, Any], key: str) -> Tuple[bool, Any]:
        """(sent, result). sent=False means queued in the outbox."""
        cap = WRITE_OPS[op]
        self._ensure()
        if self.is_live(cap) and self._pending[cap]:
            self._replay({cap})
        if self.is_live(cap) and not self._pending[cap]:
            try:
                return True, self._invoke(op, args, key)
            except LineError as e:
                if e.code != codes.RAG_DEGRADED:
                    raise
                self._degrade(cap, e)
        self._queue(op, args, key)
        return False, None

    # ------------------------------------------------------------ line-side helpers

    def admit_run(self, run: str) -> str:
        """Fix the lease authority of a run at admission: RAG if the leases capability is live now."""
        self._ensure()
        auth = LeaseAuthority.RAG.value if self.is_live("leases") else LeaseAuthority.LOCAL.value
        with self._lock:
            self._authority.setdefault(run, auth)
            return self._authority[run]

    def lease_authority(self, run: str) -> str:
        return self._authority.get(run, LeaseAuthority.LOCAL.value)

    def lease_port(self, run: str) -> Any:
        """The port whose lease_* methods a run must use (fixed at admission)."""
        return self if self.lease_authority(run) == LeaseAuthority.RAG.value else self.local

    def sync_events(self, limit: int = 500) -> int:
        """Replicate unsynced Store events (sent or queued with key ev-<first>-<last>-<digest>); marks them synced.
        The digest (over the events' wire ids) keeps keys of two Stores apart: both start at seq 1."""
        evs = self.store.unsynced(limit)
        if not evs:
            return 0
        batch = [to_dict(e) for e in evs]
        self.append_events(batch, batch_key([wire_event_id(e) for e in batch], evs[0].seq, evs[-1].seq))
        self.store.mark_synced([e.seq for e in evs])
        return len(evs)

    # ------------------------------------------------------------ RagPort

    def capabilities(self) -> RagCapabilities:
        self._ensure()
        base = self._remote_caps or RagCapabilities()
        on = {n: bool(getattr(base, n, False)) for n in RagCapabilities.NAMES}
        return RagCapabilities(version=base.version, degraded=self.degraded(), **on)

    def append_events(self, batch: Sequence[Mapping[str, Any]], idem_key: str) -> Dict[str, Any]:
        sent, res = self._write("append_events", {"batch": [dict(e) for e in batch]}, idem_key or uuid.uuid4().hex)
        if sent:
            return res
        return {"accepted": 0, "last_seq": 0, "queued": len(batch)}

    def put_record(self, type: str, id: str, body: Mapping[str, Any], if_match: Optional[str] = None,
                   idem_key: str = "") -> str:
        key = idem_key or uuid.uuid4().hex
        sent, res = self._write("put_record", {"type": type, "id": id, "body": dict(body), "if_match": if_match}, key)
        return res if sent else QUEUED_ETAG_PREFIX + key

    def freeze_pack(self, files: Mapping[str, str], idem_key: str = "") -> str:
        self.local.freeze_pack(files)                     # quote() keeps working while packs/quote are down
        key = idem_key or uuid.uuid4().hex
        sent, res = self._write("freeze_pack", {"files": dict(files)}, key)
        return res if sent else ""

    def metric(self, name: str, value: float, dims: Optional[Mapping[str, Any]] = None) -> None:
        self._write("metric", {"name": name, "value": float(value), "dims": dict(dims or {})}, uuid.uuid4().hex)

    def write_worklog(self, subject: str, text: str, idem_key: str = "") -> str:
        """One line in the project's worklog (queued while the capability is down). Returns its id, or ''."""
        self.local.write_worklog(subject, text, idem_key)
        sent, res = self._write("write_worklog", {"subject": subject, "text": text}, idem_key or uuid.uuid4().hex)
        return res if sent else ""

    def _read(self, cap: str, remote_fn: Callable[[], Any], fallback: Callable[[], Any]) -> Any:
        self._ensure()
        if self.is_live(cap):
            try:
                return remote_fn()
            except LineError as e:
                if e.code != codes.RAG_DEGRADED:
                    raise
                self._degrade(cap, e)
        return fallback()

    def events_after(self, seq: int, limit: int = 500) -> List[Dict[str, Any]]:
        return self._read("events", lambda: self.remote.events_after(seq, limit),
                          lambda: self.local.events_after(seq, limit))

    def get_record(self, type: str, id: str) -> Optional[Tuple[Dict[str, Any], str]]:
        return self._read("records", lambda: self.remote.get_record(type, id),
                          lambda: self.local.get_record(type, id))

    def quote(self, path: str, text: str, version: str = "") -> Optional[Span]:
        return self._read("quote", lambda: self.remote.quote(path, text, version),
                          lambda: self.local.quote(path, text, version))

    def retrieve(self, role: str, step: str, stack: Sequence[str], max_chars: int,
                 query: str = "") -> List[Dict[str, Any]]:
        kw = {"query": query} if query else {}       # a port without query support still answers keyed calls
        return self._read("retrieve", lambda: self.remote.retrieve(role, step, stack, max_chars, **kw), lambda: [])

    def _lease(self, fn: Callable[[], Any]) -> Any:
        self._ensure()
        if not self.is_live("leases"):
            raise LineError(codes.RAG_DEGRADED, "leases capability degraded",
                            {"capability": "leases", "error": self._degraded.get("leases", "")})
        try:
            return fn()
        except LineError as e:
            if e.code == codes.RAG_DEGRADED:
                self._degrade("leases", e)
            raise

    def lease_acquire(self, name: str, ttl_s: int, owner: str) -> Optional[Lease]:
        return self._lease(lambda: self.remote.lease_acquire(name, ttl_s, owner))

    def lease_renew(self, lease: Lease, ttl_s: int) -> Lease:
        return self._lease(lambda: self.remote.lease_renew(lease, ttl_s))

    def lease_release(self, lease: Lease) -> None:
        return self._lease(lambda: self.remote.lease_release(lease))


__all__ = ["ResilientRag", "WRITE_OPS", "QUEUED_ETAG_PREFIX"]
