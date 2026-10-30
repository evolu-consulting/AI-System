"""Deterministic discrete-event simulation: blocking seal + full rescans vs the optimised seal.

    python -m line.seal.sim                       # table over traffic x failure rate x seeds
    python -m line.seal.sim --batches 40 --seeds 1 2 3 --json out.json

Both modes run the SAME batches (same repos, files, arrival times, work sizes) and the same failure
draw per (batch, attempt). Both use the real ResourceTable, SealLedger and (optimised) ScoreQueue from
this package, so the correctness invariants are checked on the code, not on a model of it.

BASELINE   every seal triggers a full rescan of its repo (serial per repo); nothing on that repo starts
           while its graph is stale; a builder waits for its own seal; a resource that is building or
           pending blocks everyone else; every gate runs the full suite; scoring is FIFO.
OPTIMISED  rescans are incremental (changed files only), coalesced and single-flight per repo; a batch
           only re-reads the files it touches that changed since the graph version (lazy freshness);
           a builder hands its work to the scorer and moves on; pending work may be read or written
           speculatively within the depth limit (reads of a frozen contract carry no dependency);
           gates run impact-selected tests, the full suite runs once per repo at the end; scoring is
           critical-path first with L1 deferral under backpressure; a failed seal taints its speculators.
"""

from __future__ import annotations

import argparse
import hashlib
import heapq
import itertools
import json
import random
import statistics
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from .ledger import SealLedger
from .resources import DepthExceeded, ResourceTable
from .scheduler import Backpressure, ScoreQueue, SpeculationGovernor, start_mode, waiting_on
from .score import Score

PASS = Score(95, 98, 97, docked=["-3 purpose: no load test"],
             evidence_items=[{"cmd": "python -m unittest", "exit_code": 0, "output": "OK"}])
FAIL = Score(95, 0, 97, docked=["evidence: gate red"],
             evidence_items=[{"cmd": "python -m unittest", "exit_code": 1, "output": "FAILED (failures=1)"}])


@dataclass
class Params:
    repos: int = 5
    files: int = 300
    batches: int = 40
    interarrival: float = 5.0          # mean time between batch arrivals (traffic)
    workers: int = 8
    scorers: int = 3
    score_time: float = 6.0
    signoff_time: float = 30.0         # L2 human sign-off
    scan_per_file: float = 0.05
    full_suite: float = 8.0
    fail_rate: float = 0.1
    depth_limit: int = 2
    contract_share: float = 0.4        # share of reads that bind to a frozen contract (optimised)
    hot_share: float = 0.1             # share of files that take most of the traffic
    seed: int = 1
    adaptive: bool = False             # optimised: SpeculationGovernor switches speculation off on high failure


@dataclass
class Batch:
    id: str
    repo: int
    writes: List[str]
    reads: List[str]
    contract_reads: List[str]
    arrival: float
    build: float
    level: str
    attempt: int = 0
    state: str = "waiting"             # waiting building scoring scored_ok signoff sealed
    worker: bool = False
    sealed_at: float = 0.0
    work: float = 0.0
    redo_fail: int = 0
    redo_taint: int = 0


def make_batches(p: Params) -> List[Batch]:
    rng = random.Random(p.seed)
    hot = max(1, int(p.files * p.hot_share))

    def pick(n: int) -> List[str]:
        out: Set[int] = set()
        while len(out) < n:
            out.add(rng.randrange(hot) if rng.random() < 0.7 else rng.randrange(p.files))
        return sorted("f%03d" % i for i in out)

    t, out = 0.0, []
    for i in range(p.batches):
        t += rng.expovariate(1.0 / p.interarrival)
        repo = rng.randrange(p.repos)
        w = pick(rng.randint(2, 6))
        r = [f for f in pick(rng.randint(4, 12)) if f not in w]
        cr = [f for f in r if rng.random() < p.contract_share]
        level = "L2" if len(w) >= 6 else ("L1" if rng.random() < 0.5 else "L0")
        out.append(Batch("B%02d" % i, repo, ["r%d/%s" % (repo, f) for f in w], ["r%d/%s" % (repo, f) for f in r],
                         ["r%d/%s" % (repo, f) for f in cr], round(t, 3), 10.0 + 2 * len(w), level))
    return out


def fails(seed: int, bid: str, attempt: int, rate: float) -> bool:
    h = int(hashlib.sha256(("%d|%s|%d" % (seed, bid, attempt)).encode()).hexdigest()[:8], 16)
    return (h / 0xFFFFFFFF) < rate


class Sim:
    def __init__(self, p: Params, optimised: bool):
        self.p, self.opt = p, optimised
        self.batches = {b.id: b for b in make_batches(p)}
        self.order = list(self.batches)
        self.table = ResourceTable(depth_limit=p.depth_limit, speculation=optimised)
        self.ledger = SealLedger()
        self.q = ScoreQueue(Backpressure(soft=6, hard=60)) if optimised else None
        self.gov = SpeculationGovernor() if (optimised and p.adaptive) else None
        self.fifo: List[str] = []
        self.now = 0.0
        self.events: List[Tuple[float, int, str, str, int]] = []
        self.tick = itertools.count()
        self.free_workers = p.workers
        self.free_scorers = p.scorers
        # scanning
        self.seals_log: Dict[int, List[Tuple[int, Set[str]]]] = {r: [] for r in range(p.repos)}  # (seq, files)
        self.graph_seq = {r: 0 for r in range(p.repos)}
        self.scan_busy = {r: False for r in range(p.repos)}
        self.scan_queue: Dict[int, List[int]] = {r: [] for r in range(p.repos)}   # baseline: one entry per seal
        self.scan_want = {r: 0 for r in range(p.repos)}                           # optimised: coalesced target
        self.files_scanned = 0
        self.scans_run = 0
        self.max_cascade = 0
        self.compute = 0.0                                                          # builder time spent, wasted redo included
        self.claims: List[Tuple[str, str, float, float]] = []                     # res, owner, start, end
        self._open_claims: Dict[Tuple[str, str], float] = {}
        for res in {r for b in self.batches.values() for r in b.reads + b.writes}:
            self.table.freeze_contract(res, "c1")
        for b in self.batches.values():
            self.push(b.arrival, "arrive", b.id, 0)

    # ---------------------------------------------------------------- helpers

    def push(self, t: float, kind: str, bid: str, attempt: int) -> None:
        heapq.heappush(self.events, (round(t, 6), next(self.tick), kind, bid, attempt))

    def subject(self, b: Batch) -> str:
        return "%s#%d" % (b.id, b.attempt)

    def _claim_close(self, owner: str) -> None:
        for (res, o), start in list(self._open_claims.items()):
            if o == owner:
                self.claims.append((res, o, start, self.now))
                del self._open_claims[(res, o)]

    def touched(self, b: Batch) -> Set[str]:
        return set(b.writes) | set(b.reads)

    def building_by_others(self, b: Batch) -> Set[str]:
        out = set()
        for r in self.touched(b):
            top = self.table.latest(r)
            if top["state"] == "building" and top["batch"] != b.id:
                out.add(r)
            if any(o != b.id for o in self.table.live_writers(r, self.now)):
                out.add(r)
        return out

    # ---------------------------------------------------------------- start

    def try_start(self) -> None:
        for bid in self.order:
            b = self.batches[bid]
            if b.state != "waiting" or self.now < b.arrival or self.free_workers <= 0:
                continue
            if self.opt:
                self._start_opt(b)
            else:
                self._start_base(b)

    def _start_base(self, b: Batch) -> None:
        if self.scan_busy[b.repo] or self.scan_queue[b.repo]:
            return                                              # graph stale: wait for the full rescan
        for r in self.touched(b):
            top = self.table.latest(r)
            if top["state"] in ("building", "pending") and top["batch"] != b.id:
                return
            if any(o != b.id for o in self.table.live_writers(r, self.now)):
                return
        self._begin(b, gate=self.p.full_suite, extra_scan=0, reads_mode={r: "sealed" for r in b.reads})

    def _start_opt(self, b: Batch) -> None:
        busy = self.building_by_others(b)
        pending = {}
        for r in self.touched(b):
            top = self.table.latest(r)
            if top["state"] == "pending" and top["batch"] != b.id:
                pending[r] = self.table.depth(top["batch"])
        mode = start_mode(b.reads, b.writes, pending, busy, b.contract_reads, self.p.depth_limit,
                          self.q.bp.allow_speculation(len(self.q)) and (self.gov is None or self.gov.allow()))
        if mode == "wait":
            return
        # lazy freshness: re-read only the touched files that changed after the graph version
        changed = set()
        for seq, files in self.seals_log[b.repo]:
            if seq > self.graph_seq[b.repo]:
                changed |= files
        stale = self.touched(b) & changed
        reads_mode = {}
        for r in b.reads:
            if r in b.contract_reads:
                reads_mode[r] = "contract"
            elif r in pending:
                reads_mode[r] = "speculative"
            else:
                reads_mode[r] = "sealed"
        gate = 2.0 + 0.5 * len(b.writes)
        self._begin(b, gate=gate, extra_scan=len(stale), reads_mode=reads_mode)

    def _begin(self, b: Batch, gate: float, extra_scan: int, reads_mode: Dict[str, str]) -> None:
        self.table.reset(b.id)
        claims = []
        try:
            for w in b.writes:
                c = self.table.claim(w, b.id, self.now, ttl=10 ** 6)
                if c is None:
                    raise DepthExceeded("claim refused")
                claims.append(c)
            for c in claims:
                self.table.begin_write(c, b.id, self.now)
            for r, m in reads_mode.items():
                self.table.read(r, b.id, m)
        except DepthExceeded:
            self.table.abort(b.id)                              # roll back the partial start
            return
        for c in claims:
            self._open_claims[(c.resource, b.id)] = self.now
        subj = self.subject(b)
        self.ledger.freeze_gates(subj, [{"batch": b.id, "attempt": b.attempt}], approver="judge", builder="forge")
        self.ledger.build_started(subj)
        self.files_scanned += extra_scan
        dur = b.build + gate + extra_scan * self.p.scan_per_file
        b.work = dur + self.p.score_time
        self.compute += dur
        b.state, b.worker = "building", True
        self.free_workers -= 1
        self.push(self.now + dur, "built", b.id, b.attempt)

    # ---------------------------------------------------------------- build done -> scoring

    def built(self, b: Batch) -> None:
        self.table.finish_build(b.id)
        self._claim_close(b.id)
        subj = self.subject(b)
        from .ledger import gates_sha
        self.ledger.submit(subj, gates_sha([{"batch": b.id, "attempt": b.attempt}]),
                           evidence=PASS.evidence_items)
        b.state = "scoring"
        if self.opt:                                            # builder moves on
            b.worker = False
            self.free_workers += 1
            self.q.push(b.id, b.level, waiting_on(self.table.deps, b.id), self.now)
        else:
            self.fifo.append(b.id)
        self.dispatch_scores()

    def dispatch_scores(self) -> None:
        while self.free_scorers > 0:
            if self.opt:
                for bid in list(self.q._live):
                    bb = self.batches[bid]
                    self.q.reprioritise(bid, bb.level, waiting_on(self.table.deps, bid), bb.arrival)
                bid = self.q.pop()
            else:
                bid = self.fifo.pop(0) if self.fifo else None
            if bid is None:
                return
            b = self.batches[bid]
            self.free_scorers -= 1
            self.push(self.now + self.p.score_time, "scored", b.id, b.attempt)

    def scored(self, b: Batch) -> None:
        subj = self.subject(b)
        failed = fails(self.p.seed, b.id, b.attempt, self.p.fail_rate)
        if self.gov:
            self.gov.record(not failed)
        if failed:
            self.ledger.score(subj, FAIL, scorer="assay", level=b.level)
            tainted = self.table.fail(b.id)
            self._claim_close(b.id)
            self.max_cascade = max(self.max_cascade, len(tainted))
            self._redo(b, "fail")
            for t in tainted:
                self._redo(self.batches[t], "taint", by=b.id)
            return
        b.state = "signoff" if b.level == "L2" else "scored_ok"
        if b.level == "L2":
            self.push(self.now + self.p.signoff_time, "signed", b.id, b.attempt)
        else:
            self.finalize()

    def _redo(self, b: Batch, why: str, by: str = "") -> None:
        old = self.subject(b)
        st = self.ledger.state(old)
        if st not in ("sealed", "rejected", "void", "new"):
            self.ledger.void(old, "tainted by %s" % by if why == "taint" else why)
        if b.worker:
            b.worker = False
            self.free_workers += 1
        if self.opt:
            self.q.discard(b.id)
        elif b.id in self.fifo:
            self.fifo.remove(b.id)
        self._claim_close(b.id)
        b.attempt += 1
        self.ledger.correct(old, why, self.subject(b))
        b.state = "waiting"
        if why == "taint":
            b.redo_taint += 1
        else:
            b.redo_fail += 1

    def finalize(self) -> None:
        """Seal every scored batch whose producers have all sealed (cascading)."""
        progress = True
        while progress:
            progress = False
            for bid in self.order:
                b = self.batches[bid]
                if b.state == "scored_ok" and self.table.can_finalize(bid):
                    self.ledger.score(self.subject(b), PASS, scorer="assay", level=b.level)
                    if b.level == "L2":
                        self.ledger.sign(self.subject(b), by="rowan")
                    self.table.seal(bid)
                    b.state, b.sealed_at = "sealed", self.now
                    if b.worker:
                        b.worker = False
                        self.free_workers += 1
                    self.on_seal(b)
                    progress = True

    # ---------------------------------------------------------------- rescans

    def on_seal(self, b: Batch) -> None:
        log = self.seals_log[b.repo]
        seq = (log[-1][0] if log else 0) + 1
        log.append((seq, set(b.writes)))
        if self.opt:
            self.scan_want[b.repo] = seq
        else:
            self.scan_queue[b.repo].append(seq)
        self.run_scans()

    def run_scans(self) -> None:
        for r in range(self.p.repos):
            if self.scan_busy[r]:
                continue
            if self.opt:
                target = self.scan_want[r]
                if target <= self.graph_seq[r]:
                    continue
                changed = set()
                for seq, files in self.seals_log[r]:
                    if self.graph_seq[r] < seq <= target:
                        changed |= files
                n = len(changed)
            else:
                if not self.scan_queue[r]:
                    continue
                target = self.scan_queue[r][0]
                n = self.p.files
            self.scan_busy[r] = True
            self.scans_run += 1
            self.files_scanned += n
            self.push(self.now + n * self.p.scan_per_file, "scanned:%d:%d" % (r, target), "", 0)

    # ---------------------------------------------------------------- loop

    def run(self) -> Dict[str, Any]:
        guard = 0
        while self.events:
            guard += 1
            if guard > 200000:
                raise RuntimeError("simulation did not converge")
            t, _, kind, bid, attempt = heapq.heappop(self.events)
            self.now = t
            if kind.startswith("scanned:"):
                _, r, target = kind.split(":")
                r, target = int(r), int(target)
                self.scan_busy[r] = False
                self.graph_seq[r] = max(self.graph_seq[r], target)
                if not self.opt:
                    self.scan_queue[r].pop(0)
                self.run_scans()
            elif kind == "arrive":
                pass
            else:
                b = self.batches[bid]
                if attempt != b.attempt:                         # stale event of an aborted attempt
                    if kind == "scored":
                        self.free_scorers += 1
                        self.dispatch_scores()
                    self.try_start()
                    continue
                if kind == "built" and b.state == "building":
                    self.built(b)
                elif kind == "scored":
                    self.free_scorers += 1
                    if b.state == "scoring":
                        self.scored(b)
                    self.dispatch_scores()
                elif kind == "signed" and b.state == "signoff":
                    b.state = "scored_ok"                          # ledger score + sign land at finalisation
                    self.finalize()
            self.try_start()
            self.dispatch_scores()
        return self.result()

    def result(self) -> Dict[str, Any]:
        bs = list(self.batches.values())
        unfinished = [b.id for b in bs if b.state != "sealed"]
        end = max((b.sealed_at for b in bs), default=0.0)
        if self.opt:                                            # full suite once per repo at the final seal
            end += self.p.full_suite
        lat = [b.sealed_at - b.arrival for b in bs if b.state == "sealed"]
        wait = [max(0.0, (b.sealed_at - b.arrival) - b.work) for b in bs if b.state == "sealed"]
        overlaps = 0
        by_res: Dict[str, List[Tuple[float, float, str]]] = {}
        for res, o, s, e in self.claims:
            by_res.setdefault(res, []).append((s, e, o))
        for ivs in by_res.values():
            ivs.sort()
            for (s1, e1, o1), (s2, e2, o2) in zip(ivs, ivs[1:]):
                if o1 != o2 and s2 < e1 - 1e-9:
                    overlaps += 1
        unresolved = [b for b, ps in self.table.deps.items()
                      for pr in ps if self.table.batch_state.get(pr) != "sealed"]
        return {
            "mode": "optimised" if self.opt else "baseline",
            "wall": round(end, 1),
            "lat_mean": round(statistics.mean(lat), 1) if lat else 0,
            "wait_mean": round(statistics.mean(wait), 1) if wait else 0,
            "wait_p95": round(sorted(wait)[int(0.95 * (len(wait) - 1))], 1) if wait else 0,
            "files_scanned": self.files_scanned,
            "scans_run": self.scans_run,
            "redo_fail": sum(b.redo_fail for b in bs),
            "redo_taint": sum(b.redo_taint for b in bs),
            "max_cascade": self.max_cascade,
            "compute": round(self.compute, 1),
            "unfinished": len(unfinished),
            "ok_sealed_on_failed": not self.table.violations(),
            "ok_one_writer": overlaps == 0,
            "ok_pending_reads_resolved": not unresolved,
            "ok_ratchet": self.ledger.verify(),
        }


TRAFFIC = {"low": 20.0, "high": 5.0, "very_high": 1.0}


def run_matrix(seeds=(1, 2, 3), fail_rates=(0.0, 0.1, 0.3), batches: int = 40) -> List[Dict[str, Any]]:
    rows = []
    for tname, ia in TRAFFIC.items():
        for fr in fail_rates:
            agg: Dict[str, List[Dict[str, Any]]] = {"baseline": [], "optimised": []}
            for s in seeds:
                p = Params(batches=batches, interarrival=ia, fail_rate=fr, seed=s)
                for opt in (False, True):
                    r = Sim(p, opt).run()
                    agg[r["mode"]].append(r)
            for mode, rs in agg.items():
                row = {"traffic": tname, "fail": fr, "mode": mode}
                for k in ("wall", "lat_mean", "wait_mean", "wait_p95", "compute", "files_scanned", "scans_run",
                          "redo_fail", "redo_taint", "max_cascade", "unfinished"):
                    vals = [r[k] for r in rs]
                    row[k] = round(statistics.mean(vals), 1) if k != "max_cascade" else max(vals)
                row["invariants_ok"] = all(r[k] for r in rs for k in r if k.startswith("ok_"))
                rows.append(row)
    return rows


def fmt(rows: List[Dict[str, Any]]) -> str:
    cols = ["traffic", "fail", "mode", "wall", "lat_mean", "wait_mean", "wait_p95", "compute", "files_scanned", "scans_run",
            "redo_fail", "redo_taint", "max_cascade", "unfinished", "invariants_ok"]
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        out.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    return "\n".join(out)


def stress(seeds=(1, 2, 3)) -> List[Dict[str, Any]]:
    """Contended and unreliable: 120 batches, 3% hot files, very high traffic; plus an ablation with
    speculation off (depth 0) to separate what speculation buys from what incremental scans buy."""
    rows = []
    for fr in (0.0, 0.3, 0.5):
        for label, opt, depth, adaptive in (("baseline", False, 2, False), ("opt_no_spec", True, 0, False),
                                            ("optimised", True, 2, False), ("opt_adaptive", True, 2, True)):
            rs = [Sim(Params(batches=120, interarrival=1.0, hot_share=0.03, fail_rate=fr, seed=s,
                             depth_limit=depth, adaptive=adaptive), opt).run() for s in seeds]
            row = {"traffic": "stress", "fail": fr, "mode": label}
            for k in ("wall", "lat_mean", "wait_mean", "wait_p95", "compute", "files_scanned", "scans_run",
                      "redo_fail", "redo_taint", "max_cascade", "unfinished"):
                vals = [r[k] for r in rs]
                row[k] = round(statistics.mean(vals), 1) if k != "max_cascade" else max(vals)
            row["invariants_ok"] = all(r[k] for r in rs for k in r if k.startswith("ok_"))
            rows.append(row)
    return rows


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batches", type=int, default=40)
    ap.add_argument("--seeds", type=int, nargs="*", default=[1, 2, 3])
    ap.add_argument("--stress", action="store_true", help="also run the contended / unreliable scenario")
    ap.add_argument("--json", default="")
    a = ap.parse_args(argv)
    rows = run_matrix(tuple(a.seeds), batches=a.batches)
    if a.stress:
        rows += stress(tuple(a.seeds))
    print(fmt(rows))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=1)
    return 0 if all(r["invariants_ok"] and r["unfinished"] == 0 for r in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
