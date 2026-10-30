"""Unsealed resources, MVCC-style: who may write, what a reader sees, what a failed seal takes down.

A resource is anything a batch writes or reads (a file, an entity, a graph node). Each has a version
chain; every version belongs to the batch that wrote it and is building -> pending -> sealed | failed.

    T = ResourceTable(depth_limit=2)
    c = T.claim("db/bp.cds", owner="B7", now=0, ttl=300)        # one writer per resource, fenced by epoch
    T.begin_write(c, "B7", now=1)                                # stale epoch / expired claim -> StaleClaim
    T.finish_build("B7")                                         # versions -> pending, claims released
    T.read("db/bp.cds", "B9", mode="sealed")                     # default: last sealed version, no dependency
    T.read("db/bp.cds", "B9", mode="speculative")                # declared: records B9 -> B7
    T.read("db/bp.cds", "B9", mode="contract")                   # binds to the frozen contract, no dependency
    T.can_finalize("B9")                                         # False until B7 seals
    T.seal("B7"); T.seal("B9")
    T.fail("B7")  -> ["B9", ...]                                 # taint cascade (never a sealed batch)

Rules
  * writes need a live claim; the epoch grows on every grant; a write with an old epoch is refused.
  * reads default to the last sealed version. Reading or writing over a pending version is a declared
    speculative dependency; the reader cannot seal before its producers seal.
  * speculation depth (longest chain of unsealed producers) is capped: DepthExceeded -> the caller waits.
  * a contract frozen at gate time lets a dependent bind to the interface, not the pending implementation.
  * fail(batch) fails its versions and taints every batch that (transitively) speculated on it.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

BASE = "base"


class StaleClaim(Exception):
    pass


class DepthExceeded(Exception):
    pass


@dataclass(frozen=True)
class Claim:
    resource: str
    owner: str
    epoch: int
    expires: float


class ResourceTable:
    def __init__(self, depth_limit: int = 2, speculation: bool = True):
        self.depth_limit = depth_limit
        self.speculation = speculation
        self._lock = threading.RLock()
        self._versions: Dict[str, List[Dict[str, str]]] = {}        # res -> [{vid, batch, state}]
        self._claims: Dict[str, Claim] = {}
        self._epoch: Dict[str, int] = {}
        self._contract: Dict[str, str] = {}
        self.batch_state: Dict[str, str] = {}                       # building | pending | sealed | failed | tainted
        self.deps: Dict[str, Set[str]] = {}                         # reader -> producers it speculated on
        self.reads: Dict[str, List[Tuple[str, str, str]]] = {}      # batch -> [(res, vid, mode)]
        self.writes: Dict[str, List[Tuple[str, str]]] = {}          # batch -> [(res, vid)]
        self.claim_log: List[Tuple[str, str, int, float]] = []      # (res, owner, epoch, granted_at)

    # ------------------------------------------------------------------ versions

    def _chain(self, res: str) -> List[Dict[str, str]]:
        return self._versions.setdefault(res, [{"vid": BASE, "batch": "", "state": "sealed"}])

    def latest(self, res: str) -> Dict[str, str]:
        return [v for v in self._chain(res) if v["state"] != "failed"][-1]

    def latest_sealed(self, res: str) -> str:
        return [v for v in self._chain(res) if v["state"] == "sealed"][-1]["vid"]

    def freeze_contract(self, res: str, contract_id: str) -> None:
        with self._lock:
            self._contract[res] = contract_id

    # ------------------------------------------------------------------ claims

    def claim(self, res: str, owner: str, now: float, ttl: float = 300.0) -> Optional[Claim]:
        with self._lock:
            cur = self._claims.get(res)
            if cur and cur.owner != owner and cur.expires > now:
                return None
            top = self.latest(res)
            if not self.speculation and top["state"] in ("building", "pending") and top["batch"] != owner:
                return None                                         # baseline: wait for the seal
            ep = self._epoch.get(res, 0) + 1
            self._epoch[res] = ep
            c = Claim(res, owner, ep, now + ttl)
            self._claims[res] = c
            self.claim_log.append((res, owner, ep, now))
            return c

    def check(self, c: Claim, now: float) -> None:
        cur = self._claims.get(c.resource)
        if not cur or cur.epoch != c.epoch or cur.owner != c.owner or cur.expires <= now:
            raise StaleClaim("%s: claim epoch %d of %s is no longer valid" % (c.resource, c.epoch, c.owner))

    def release_claims(self, owner: str) -> None:
        with self._lock:
            for r in [r for r, c in self._claims.items() if c.owner == owner]:
                del self._claims[r]

    def live_writers(self, res: str, now: float) -> List[str]:
        c = self._claims.get(res)
        return [c.owner] if c and c.expires > now else []

    # ------------------------------------------------------------------ dependencies

    def depth(self, batch: str) -> int:
        open_deps = [p for p in self.deps.get(batch, ()) if self.batch_state.get(p) != "sealed"]
        return 0 if not open_deps else 1 + max(self.depth(p) for p in open_deps)

    def _depend(self, batch: str, producer: str) -> None:
        if not producer or producer == batch or self.batch_state.get(producer) == "sealed":
            return
        if not self.speculation:
            raise DepthExceeded("speculation is off")
        if 1 + self.depth(producer) > self.depth_limit:
            raise DepthExceeded("%s on %s: speculation depth %d > %d"
                                % (batch, producer, 1 + self.depth(producer), self.depth_limit))
        self.deps.setdefault(batch, set()).add(producer)

    # ------------------------------------------------------------------ writes and reads

    def begin_write(self, c: Claim, batch: str, now: float) -> str:
        with self._lock:
            self.check(c, now)
            top = self.latest(c.resource)
            if top["state"] == "building" and top["batch"] != batch:
                raise StaleClaim("%s is being written by %s" % (c.resource, top["batch"]))
            if top["state"] == "pending":
                self._depend(batch, top["batch"])                  # writing over unsealed work
            vid = "%s@%s" % (batch, len(self._chain(c.resource)))
            self._chain(c.resource).append({"vid": vid, "batch": batch, "state": "building"})
            self.writes.setdefault(batch, []).append((c.resource, vid))
            self.batch_state[batch] = "building"
            return vid

    def read(self, res: str, batch: str, mode: str = "sealed") -> str:
        with self._lock:
            if mode == "contract" and res in self._contract:
                vid = "contract:" + self._contract[res]
            elif mode == "speculative":
                top = self.latest(res)
                if top["state"] == "building" and top["batch"] != batch:
                    raise DepthExceeded("%s is still being built by %s" % (res, top["batch"]))
                if top["state"] == "pending":
                    self._depend(batch, top["batch"])
                vid = top["vid"]
            else:
                vid = self.latest_sealed(res)
            self.reads.setdefault(batch, []).append((res, vid, mode))
            return vid

    # ------------------------------------------------------------------ lifecycle

    def finish_build(self, batch: str) -> None:
        with self._lock:
            for res, vid in self.writes.get(batch, []):
                for v in self._chain(res):
                    if v["vid"] == vid and v["state"] == "building":
                        v["state"] = "pending"
            self.batch_state[batch] = "pending"
            self.release_claims(batch)

    def can_finalize(self, batch: str) -> bool:
        return all(self.batch_state.get(p) == "sealed" for p in self.deps.get(batch, ()))

    def seal(self, batch: str) -> None:
        with self._lock:
            if self.batch_state.get(batch) != "pending":
                raise ValueError("%s is %s, not pending" % (batch, self.batch_state.get(batch)))
            if not self.can_finalize(batch):
                raise ValueError("%s speculated on unsealed work" % batch)
            self._set(batch, "sealed")

    def _set(self, batch: str, state: str) -> None:
        for res, vid in self.writes.get(batch, []):
            for v in self._chain(res):
                if v["vid"] == vid:
                    v["state"] = "sealed" if state == "sealed" else "failed"
        self.batch_state[batch] = state

    def fail(self, batch: str) -> List[str]:
        """Fail the batch and taint every unsealed batch that speculated on it, transitively."""
        with self._lock:
            self._set(batch, "failed")
            self.release_claims(batch)
            tainted, frontier = [], [batch]
            while frontier:
                b = frontier.pop()
                for reader, ps in self.deps.items():
                    if b in ps and self.batch_state.get(reader) not in ("sealed", "failed", "tainted"):
                        self._set(reader, "tainted")
                        self.release_claims(reader)
                        tainted.append(reader)
                        frontier.append(reader)
            return tainted

    def abort(self, batch: str) -> None:
        """Undo a start that could not complete (nothing can depend on building versions)."""
        with self._lock:
            for res, vid in self.writes.get(batch, []):
                self._versions[res] = [v for v in self._chain(res) if v["vid"] != vid]
            self.release_claims(batch)
            self.deps.pop(batch, None)
            self.reads.pop(batch, None)
            self.writes.pop(batch, None)
            self.batch_state.pop(batch, None)

    def reset(self, batch: str) -> None:
        """Before a redo: forget the old attempt's dependencies and reads (its versions stay failed)."""
        with self._lock:
            self.deps.pop(batch, None)
            self.reads.pop(batch, None)
            self.writes.pop(batch, None)
            self.batch_state[batch] = "building"

    # ------------------------------------------------------------------ invariants

    def violations(self) -> List[str]:
        out = []
        for b, st in self.batch_state.items():
            if st == "sealed":
                for p in self.deps.get(b, ()):
                    if self.batch_state.get(p) != "sealed":
                        out.append("%s sealed on %s which is %s" % (b, p, self.batch_state.get(p)))
        for b, rs in self.reads.items():
            for res, vid, mode in rs:
                if mode != "speculative" or vid == BASE or vid.startswith("contract:"):
                    continue
                producer = vid.split("@")[0]
                if producer != b and producer not in self.deps.get(b, ()) and \
                        self.batch_state.get(producer) != "sealed":
                    out.append("%s read unsealed %s without recording it" % (b, vid))
        return out
