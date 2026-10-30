"""Pure local RagPort over the line's Store, for LINE_RAG=off and for degraded capabilities.

  events      events_after() reads the Store's own event log; append_events() is a no-op
              (the Store already holds every event) that reports the batch as accepted.
  leases      a LeaseManager (the Store's ``leases`` attribute, the one passed in, or an in-memory one).
  records     in-memory rows with etags (same rules as the RAG System: create-only without
              if_match, VERSION_CONFLICT on a stale etag); reads fall back to the Store entity the
              record type mirrors (manifest.RECORD_TYPES), etag "v<store version>".
  packs/quote frozen files kept in memory; quote() finds the literal text and returns its Span.
  retrieve    always [] (there is no local corpus).
  metrics     kept in memory (``self.metrics``).
"""

from __future__ import annotations

import copy
import hashlib
import json
import threading
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import Lease, LeaseAuthority, RagCapabilities, Span, now_ms, span_id, to_dict
from .manifest import RECORD_TYPES


class MemLeases:
    """Minimal in-memory LeaseManager (fencing epochs, expiry by clock)."""

    def __init__(self, clock: Any = None, ttl_s: int = 300):
        self._now = clock.now_ms if clock is not None else now_ms
        self.ttl_s = ttl_s
        self._lock = threading.Lock()
        self._live: Dict[str, Lease] = {}
        self._epoch: Dict[str, int] = {}
        self._reaped: set = set()

    def _alive(self, lease: Optional[Lease]) -> bool:
        return lease is not None and lease.expires_ms > self._now()

    def acquire(self, name: str, owner: str, ttl_s: Optional[int] = None) -> Optional[Lease]:
        with self._lock:
            if self._alive(self._live.get(name)):
                return None
            epoch = self._epoch.get(name, 0) + 1
            self._epoch[name] = epoch
            lease = Lease(name, epoch, self._now() + 1000 * (ttl_s or self.ttl_s), owner)
            self._live[name] = lease
            return copy.copy(lease)

    def renew(self, lease: Lease, ttl_s: Optional[int] = None) -> Lease:
        with self._lock:
            cur = self._live.get(lease.name)
            if not self._alive(cur) or cur.epoch != lease.epoch:
                raise LineError(codes.LEASE_LOST, "lease %s epoch %d lost" % (lease.name, lease.epoch),
                                {"name": lease.name, "epoch": lease.epoch})
            cur.expires_ms = self._now() + 1000 * (ttl_s or self.ttl_s)
            return copy.copy(cur)

    def release(self, lease: Lease) -> None:
        with self._lock:
            cur = self._live.get(lease.name)
            if cur is not None and cur.epoch == lease.epoch:
                del self._live[lease.name]

    def current(self, name: str) -> Optional[Lease]:
        with self._lock:
            cur = self._live.get(name)
            return copy.copy(cur) if self._alive(cur) else None

    def check(self, name: str, epoch: int) -> None:
        cur = self.current(name)
        if cur is None or cur.epoch != epoch:
            raise LineError(codes.LEASE_LOST, "stale epoch %d for %s" % (epoch, name),
                            {"name": name, "epoch": epoch, "current": cur.epoch if cur else None})

    def expired(self, now_ms_: Optional[int] = None) -> List[Lease]:
        now = self._now() if now_ms_ is None else now_ms_
        with self._lock:
            return [copy.copy(l) for l in self._live.values()
                    if l.expires_ms <= now and (l.name, l.epoch) not in self._reaped]

    def reap(self, lease: Lease) -> None:
        with self._lock:
            self._reaped.add((lease.name, lease.epoch))
            cur = self._live.get(lease.name)
            if cur is not None and cur.epoch == lease.epoch:
                del self._live[lease.name]


def etag_of(body: Mapping[str, Any]) -> str:
    return hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]


def pack_version_of(files: Mapping[str, str]) -> str:
    h = hashlib.sha256()
    for p in sorted(files):
        h.update(p.encode("utf-8") + b"\0" + files[p].encode("utf-8") + b"\0")
    return "local-" + h.hexdigest()[:16]


def find_span(files: Mapping[str, str], path: str, text: str) -> Optional[Span]:
    """Span (whole lines) of the first literal occurrence of text in files[path]."""
    body = files.get(path)
    if body is None or not text:
        return None
    i = body.find(text)
    if i < 0:
        return None
    start = body.count("\n", 0, i) + 1
    end = body.count("\n", 0, i + len(text)) + 1
    seg = "\n".join(body.split("\n")[start - 1:end])
    return Span(span_id(path, start, end), path, start, end, "", seg, hashlib.sha256(seg.encode("utf-8")).hexdigest())


class LocalRagAdapter:
    """RagPort that never leaves the process. authority is always LOCAL."""

    def __init__(self, store: Any, leases: Any = None, clock: Any = None):
        self.store = store
        self.leases = leases if leases is not None else (getattr(store, "leases", None) or MemLeases(clock))
        self._lock = threading.RLock()
        self.records: Dict[Tuple[str, str], Tuple[Dict[str, Any], str]] = {}
        self.packs: Dict[str, Dict[str, str]] = {}
        self.metrics: List[Tuple[str, float, Dict[str, Any]]] = []
        self.worklog: List[Dict[str, str]] = []
        self._authority: Dict[str, str] = {}

    # --- line-side helpers shared with ResilientRag
    def admit_run(self, run: str) -> str:
        self._authority[run] = LeaseAuthority.LOCAL.value
        return LeaseAuthority.LOCAL.value

    def lease_authority(self, run: str) -> str:
        return self._authority.get(run, LeaseAuthority.LOCAL.value)

    def lease_port(self, run: str) -> "LocalRagAdapter":
        return self

    def degraded(self) -> List[str]:
        return []

    def probe(self) -> List[str]:
        return []

    def sync_events(self, limit: int = 500) -> int:
        """Nothing to replicate to: events stay in the Store."""
        return 0

    # --- RagPort
    def capabilities(self) -> RagCapabilities:
        return RagCapabilities(events=True, leases=True, records=True, packs=True, quote=True,
                               retrieve=True, metrics=True, version="local")

    def write_worklog(self, subject: str, text: str, idem_key: str = "") -> str:
        """Kept in memory (and in the human.decided events): there is no project worklog without the RAG System."""
        with self._lock:
            if idem_key and any(w["key"] == idem_key for w in self.worklog):
                return "local:" + idem_key
            self.worklog.append({"key": idem_key, "subject": subject, "text": text})
            return "local:" + (idem_key or str(len(self.worklog)))

    def append_events(self, batch: Sequence[Mapping[str, Any]], idem_key: str) -> Dict[str, Any]:
        seqs = [int(e.get("seq", 0)) for e in batch if isinstance(e, Mapping)]
        return {"accepted": len(batch), "last_seq": max(seqs) if seqs else 0}

    def events_after(self, seq: int, limit: int = 500) -> List[Dict[str, Any]]:
        return [to_dict(e) for e in self.store.events_after(seq, limit=limit)]

    def lease_acquire(self, name: str, ttl_s: int, owner: str) -> Optional[Lease]:
        return self.leases.acquire(name, owner, ttl_s)

    def lease_renew(self, lease: Lease, ttl_s: int) -> Lease:
        return self.leases.renew(lease, ttl_s)

    def lease_release(self, lease: Lease) -> None:
        self.leases.release(lease)

    def put_record(self, type: str, id: str, body: Mapping[str, Any], if_match: Optional[str] = None,
                   idem_key: str = "") -> str:
        data = json.loads(json.dumps(dict(body), default=str))
        with self._lock:
            cur = self.records.get((type, id))
            cur_etag = cur[1] if cur else None
            if cur is None:
                mirrored = self._mirror(type, id)
                cur_etag = mirrored[1] if mirrored else None
            if cur_etag is not None and if_match is None:
                raise LineError(codes.PRECONDITION_REQUIRED, "if_match required to update %s/%s" % (type, id),
                                {"type": type, "id": id})
            if if_match is not None and cur_etag != if_match:
                raise LineError(codes.VERSION_CONFLICT, "etag mismatch on %s/%s" % (type, id),
                                {"type": type, "id": id, "etag": cur_etag})
            etag = etag_of(data)
            self.records[(type, id)] = (data, etag)
            return etag

    def _mirror(self, type: str, id: str) -> Optional[Tuple[Dict[str, Any], str]]:
        entity = RECORD_TYPES.get(type)
        if not entity:
            return None
        try:
            row = self.store.get(entity, id)
        except LineError:
            return None
        if row is None:
            return None
        return row, "v%d" % self.store.version(entity, id)

    def get_record(self, type: str, id: str) -> Optional[Tuple[Dict[str, Any], str]]:
        with self._lock:
            cur = self.records.get((type, id))
            if cur is not None:
                return copy.deepcopy(cur[0]), cur[1]
        return self._mirror(type, id)

    def freeze_pack(self, files: Mapping[str, str], idem_key: str = "") -> str:
        ver = pack_version_of(files)
        with self._lock:
            self.packs[ver] = dict(files)
        return ver

    def quote(self, path: str, text: str, version: str = "") -> Optional[Span]:
        with self._lock:
            packs = [self.packs[version]] if version in self.packs else list(self.packs.values())[::-1]
        for files in packs:
            sp = find_span(files, path, text)
            if sp is not None:
                return sp
        return None

    def retrieve(self, role: str, step: str, stack: Sequence[str], max_chars: int,
                 query: str = "") -> List[Dict[str, Any]]:
        return []

    def metric(self, name: str, value: float, dims: Optional[Mapping[str, Any]] = None) -> None:
        with self._lock:
            self.metrics.append((name, float(value), dict(dims or {})))


__all__ = ["LocalRagAdapter", "MemLeases", "etag_of", "pack_version_of", "find_span"]
