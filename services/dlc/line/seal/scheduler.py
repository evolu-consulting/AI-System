"""Seal scheduling: scoring runs beside the build, never in front of it.

    q = ScoreQueue(backpressure=Backpressure(soft=20))
    q.push("B7", level="L1", waiting_on_it=3, now=12.0)        # critical path first
    q.pop()                                                     # -> "B7"
    start_mode(touched_reads, writes, pending_writes, contract_reads) -> "clean" | "speculative" | "wait"

Policy
  * a finished build is submitted for scoring and the builder moves on; the seal finalises later.
  * scoring order: batches that others are waiting on (speculatively) first, then L2 (a person is
    waiting), then oldest. Under load (queue above the soft limit) L1 items with nobody waiting on them
    are deferred - L1 never blocks anyone, so deferring it costs latency of review, not throughput.
  * a new batch starts CLEAN when nothing it touches is pending; SPECULATIVE when it touches pending
    work within the depth limit; WAIT only when the depth limit would be exceeded or a resource is
    being written right now.
"""

from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional, Set, Tuple

LEVEL_RANK = {"L2": 0, "L0": 1, "L1": 2}


@dataclass
class Backpressure:
    soft: int = 20                     # queue length above which L1 without waiters is deferred
    hard: int = 200                    # above this new builds start only CLEAN (no new speculation)

    def defer_l1(self, queued: int) -> bool:
        return queued > self.soft

    def allow_speculation(self, queued: int) -> bool:
        return queued <= self.hard


class ScoreQueue:
    def __init__(self, backpressure: Optional[Backpressure] = None):
        self.bp = backpressure or Backpressure()
        self._heap: List[Tuple[Tuple, int, str]] = []
        self._tick = itertools.count()
        self._live: Dict[str, Tuple] = {}

    def __len__(self) -> int:
        return len(self._live)

    def key(self, level: str, waiting_on_it: int, now: float) -> Tuple:
        deferred = 1 if (level == "L1" and waiting_on_it == 0 and self.bp.defer_l1(len(self._live))) else 0
        return (deferred, -waiting_on_it, LEVEL_RANK.get(level, 1), now)

    def push(self, subject: str, level: str = "L0", waiting_on_it: int = 0, now: float = 0.0) -> None:
        k = self.key(level, waiting_on_it, now)
        self._live[subject] = k
        heapq.heappush(self._heap, (k, next(self._tick), subject))

    def reprioritise(self, subject: str, level: str, waiting_on_it: int, now: float) -> None:
        if subject in self._live:
            self.push(subject, level, waiting_on_it, now)

    def pop(self) -> Optional[str]:
        while self._heap:
            k, _, s = heapq.heappop(self._heap)
            if self._live.get(s) == k:
                del self._live[s]
                return s
        return None

    def discard(self, subject: str) -> None:
        self._live.pop(subject, None)


class SpeculationGovernor:
    """Speculation pays only while seals mostly pass. Track the last `window` seal outcomes; above
    `max_fail` failure rate new speculation is switched off (running speculators are unaffected) until
    the rate drops again. Measured: at 30-50% failures speculation burns 28-42% more builder time for
    an 11-21% shorter run (docs/dlc/seal-and-scan.md)."""

    def __init__(self, window: int = 20, max_fail: float = 0.2, min_samples: int = 5):
        self.window, self.max_fail, self.min_samples = window, max_fail, min_samples
        self._outcomes: List[bool] = []

    def record(self, passed: bool) -> None:
        self._outcomes = (self._outcomes + [passed])[-self.window:]

    def fail_rate(self) -> float:
        return 0.0 if not self._outcomes else 1 - sum(self._outcomes) / len(self._outcomes)

    def allow(self) -> bool:
        return len(self._outcomes) < self.min_samples or self.fail_rate() <= self.max_fail


def waiting_on(deps: Mapping[str, Iterable[str]], subject: str) -> int:
    """How many batches (transitively) speculated on subject - the critical-path weight."""
    rev: Dict[str, Set[str]] = {}
    for reader, ps in deps.items():
        for p in ps:
            rev.setdefault(p, set()).add(reader)
    seen, stack = set(), [subject]
    while stack:
        for r in rev.get(stack.pop(), ()):
            if r not in seen:
                seen.add(r)
                stack.append(r)
    return len(seen)


def start_mode(reads: Iterable[str], writes: Iterable[str], pending: Mapping[str, int],
               building: Set[str], contract_reads: Iterable[str] = (), depth_limit: int = 2,
               allow_speculation: bool = True) -> str:
    """pending = {resource: speculation depth of its producer}; building = resources being written now."""
    contract = set(contract_reads)
    touched = (set(reads) - contract) | set(writes)
    if set(writes) & building:
        return "wait"
    hit = [pending[r] for r in touched if r in pending]
    if not hit:
        return "clean"
    if not allow_speculation or 1 + max(hit) > depth_limit:
        return "wait"
    return "speculative"
