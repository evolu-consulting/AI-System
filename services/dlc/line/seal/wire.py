"""The seal wired into a run (LINE_SEAL=1). One RunSeal per Pipeline; nothing here runs when the flag is off.

    seal = RunSeal(pipeline)                      # after the pipeline's _setup (store, cfg, leases, sm)
    seal.promote()                                # PENDING -> READY on deps that are merged OR pending a seal
    dispatch(..., seal=seal)                      # claim(): per-file claims with fencing; started(): gates
    seal.on_attempt(uid, res)                     # True = handled (submitted for scoring; no merge yet)
    seal.tick()                                   # score, finalise, enqueue for merge, taint, requeue
    seal.merge_ok(run, uid, attempt)              # merge queue: only finalised seals merge
    seal.final(report, res)                       # QAS green: the run's final seal (full acceptance suite)

Subjects are "<run>:<unit>#<attempt>". Every ledger entry is persisted as a seal_entry row (hash chain);
the per-subject projection (state, score, deps, claims) as a seal row, so a resumed driver rebuilds the
ledger, the dependency table and the score queue from the store.

Mapping of the design (docs/dlc/seal-and-scan.md) onto the engine:
  gates          the unit's locked acceptance tests (id + sha), frozen at dispatch by the test author's
                 lock; approver "test_author", builder "builder" (or "fixer"), checked again at submit
  claims         one durable lease per claimed path "seal:<repo key>:<path>" (fencing epoch, TTL), plus
                 the in-memory ResourceTable for dependencies and taint
  speculation    a PENDING unit whose deps are merged or VERIFIED-and-pending-a-seal starts on top of the
                 producers' heads (merged into its worktree, base ref moved past them); depth-capped,
                 switched off by the governor; it merges only after its producers are MERGED
  scorer         the clean-context reviewer role when review is on, else the deterministic seal scorer:
                 purpose = acceptance tests passing / owned, evidence = the verifier's real command
                 output, love = 100 unless the reviewer asked for changes; never the builder
  levels         L2 when a claim matches LINE_SEAL_L2_PATHS or the unit claims nothing (unknown impact),
                 L1 when it built on pending work, else L0; L2 waits for a sign-off (human_mode ask) or
                 is decided and logged (human_mode decide)
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import threading
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .. import codes
from ..codes import LineError
from ..contracts import (
    E_ACC_TEST, E_DECISION, E_GATE, E_SEAL, E_SEAL_ENTRY, E_UNIT, UnitState, now_ms,
)
from .ledger import LedgerError, SealLedger, gates_sha
from .resources import DepthExceeded, ResourceTable
from .scheduler import ScoreQueue, SpeculationGovernor, waiting_on
from .score import Score, level_for, real_evidence

SCORER_DEFAULT = "seal-scorer"
SCORER_REVIEW = "reviewer"
SIGN_DECIDE = "line:decide"


def enabled(cfg: Any) -> bool:
    return bool(getattr(cfg, "seal_enabled", False))


def subject(run: str, uid: str, n: int) -> str:
    return "%s:%s#%d" % (run, uid, int(n))


def split(subj: str) -> tuple:
    run, rest = subj.rsplit(":", 1) if ":" in subj else ("", subj)
    uid, _, n = rest.partition("#")
    return run, uid, int(n or 0)


class RunSeal:
    def __init__(self, p: Any):
        self.p = p
        self.cfg = p.cfg
        self.run = p.run
        self._lock = threading.RLock()
        raw = getattr(p.store, "raw", p.store)
        self.raw = raw
        entries = [r for r in raw.query(E_SEAL_ENTRY, run=self.run)]
        self.ledger = SealLedger(entries=entries, sink=self._persist_entry)
        self.rt = ResourceTable(depth_limit=max(int(getattr(self.cfg, "seal_depth", 2)), 0))
        self.queue = ScoreQueue()
        self.gov = SpeculationGovernor(max_fail=float(getattr(self.cfg, "seal_governor_fail", 0.2)))
        self.repo_key = ""
        self._rebuild()

    # ------------------------------------------------------------------ persistence

    def _persist_entry(self, e: Dict[str, Any]) -> None:
        self.raw.put(E_SEAL_ENTRY, "%s:%06d" % (self.run, int(e["seq"])), dict(e, run=self.run), run=self.run)

    def row(self, subj: str) -> Dict[str, Any]:
        return dict(self.raw.get(E_SEAL, subj) or {})

    def _save(self, subj: str, **kv: Any) -> Dict[str, Any]:
        run, uid, n = split(subj)
        row = self.row(subj) or {"id": subj, "run": self.run, "unit": uid, "attempt": n, "deps": [], "claims": [],
                                 "leases": {}, "spec_on": [], "enqueued": False}
        proj = self.ledger.projection(subj)
        row.update(kv)
        row["ledger_state"] = proj.get("state", row.get("ledger_state", "new"))
        row["rt_state"] = self.rt.batch_state.get(subj, row.get("rt_state", ""))
        row["deps"] = sorted(self.rt.deps.get(subj, set(row.get("deps") or [])))
        row["updated_ms"] = now_ms()
        self.raw.put(E_SEAL, subj, row, run=self.run)
        return row

    def _rebuild(self) -> None:
        for row in self.raw.query(E_SEAL, run=self.run):
            s = row["id"]
            if row.get("rt_state"):
                self.rt.batch_state[s] = row["rt_state"]
            if row.get("deps"):
                self.rt.deps[s] = set(row["deps"])
            if self.ledger.state(s) == "pending":
                self.queue.push(s, row.get("level") or "L0", 0, float(row.get("updated_ms") or 0))

    def _emit(self, kind: str, uid: str, n: int, body: Mapping[str, Any]) -> None:
        from ..build._common import env
        try:
            self.p.sstore.emit(kind, env(self.run, self.cfg, unit=uid, attempt=n), dict(body))
        except LineError as e:   # a mirror event must not cost the run (e.g. guarded store after cancel)
            self.p.log("%s: seal event %s not written: %s" % (self.run, kind, e.code))

    # ------------------------------------------------------------------ helpers

    def _units(self) -> Dict[str, Dict[str, Any]]:
        return {u["id"]: u for u in self.p.sstore.query(E_UNIT, run=self.run)}

    def current(self, uid: str) -> str:
        u = self.p.sstore.get(E_UNIT, uid) or {}
        return subject(self.run, uid, int(u.get("attempt") or 0))

    def _gates(self, unit: Mapping[str, Any]) -> List[Dict[str, Any]]:
        out = []
        for tid in sorted(unit.get("tests") or []):
            r = self.p.sstore.get(E_ACC_TEST, tid) or {}
            out.append({"test": tid, "sha": r.get("sha", ""), "locked": bool(r.get("locked"))})
        if not out:      # a unit with no acceptance tests (contract unit): its claims are the gate
            out = [{"claims": sorted(unit.get("claims") or [])}]
        return out

    def _repo(self) -> str:
        if not self.repo_key:
            self.repo_key = hashlib.sha1(os.path.normcase(os.path.abspath(self.p.repo or "")).encode()).hexdigest()[:12]
        return self.repo_key

    def _lease_name(self, res: str) -> str:
        return "seal:%s:%s" % (self._repo(), res)

    def _l2(self, claims: Sequence[str]) -> bool:
        pats = list(getattr(self.cfg, "seal_l2_paths", None) or [])
        return any(fnmatch.fnmatch(c, p) for c in claims for p in pats)

    def _producer_ok(self, dep: Mapping[str, Any]) -> Optional[str]:
        """'merged' | 'pending' (VERIFIED, its current attempt submitted or sealed) | None (not usable)."""
        if dep.get("state") == UnitState.MERGED.value:
            return "merged"
        if dep.get("state") != UnitState.VERIFIED.value:
            return None
        s = subject(self.run, dep["id"], int(dep.get("attempt") or 0))
        if self.ledger.state(s) in ("pending", "sealed", "awaiting_signoff") and \
                self.rt.batch_state.get(s) in ("pending", "sealed"):
            return "pending"
        return None

    def speculation_allowed(self) -> bool:
        return self.rt.depth_limit > 0 and self.gov.allow() and self.queue.bp.allow_speculation(len(self.queue))

    # ------------------------------------------------------------------ scheduling

    def promote(self) -> List[str]:
        """PENDING -> READY for units whose deps are merged or pending a seal (speculative start)."""
        from ..build import graph as G
        from ..build._common import env
        from ..build.scheduler import mark_ready_ms
        from ..contracts import Unit, from_dict
        if not self.speculation_allowed():
            return []
        rows = self._units()
        units = [from_dict(Unit, r) for r in rows.values()]
        deps = G.effective_deps(units)
        out = []
        for u in units:
            if u.state != UnitState.PENDING.value or not deps[u.id]:
                continue
            kinds = {d: self._producer_ok(rows.get(d) or {}) for d in deps[u.id]}
            if any(k is None for k in kinds.values()) or all(k == "merged" for k in kinds.values()):
                continue                                      # not startable / the normal promote does it
            pend = [subject(self.run, d, int(rows[d].get("attempt") or 0)) for d, k in kinds.items() if k == "pending"]
            if any(1 + self.rt.depth(s) > self.rt.depth_limit for s in pend):
                continue
            self.p.sstore.transition(E_UNIT, u.id, UnitState.READY, UnitState.PENDING)
            mark_ready_ms(self.p.sstore, u)
            row = self.p.sstore.get(E_UNIT, u.id) or {}
            row["detail"] = dict(row.get("detail") or {}, spec_on=[d for d, k in kinds.items() if k == "pending"])
            self.p.sstore.put(E_UNIT, u.id, row)
            self.p.sstore.emit(codes.UNIT_STATE, env(self.run, self.cfg, unit=u.id),
                               {"from": UnitState.PENDING.value, "to": UnitState.READY.value, "speculative": pend})
            out.append(u.id)
        return out

    def claim(self, u: Any, n: int) -> bool:
        """Before a dispatch: its deps are still usable and every claimed path is free (durable lease with
        a fencing epoch). False = not now (nothing held)."""
        rows = self._units()
        spec = [d for d in (u.detail or {}).get("spec_on") or []]
        for d in u.deps:
            k = self._producer_ok(rows.get(d) or {})
            if k is None or (k == "pending" and d not in spec):
                if k == "pending" and self.speculation_allowed():
                    spec.append(d)
                    continue
                return False
        subj = subject(self.run, u.id, n)
        for d in spec:
            if (rows.get(d) or {}).get("state") == UnitState.MERGED.value:
                continue
            ps = subject(self.run, d, int(rows[d].get("attempt") or 0))
            if 1 + self.rt.depth(ps) > self.rt.depth_limit or not self.speculation_allowed():
                return False
        held: Dict[str, int] = {}
        for res in sorted(set(u.claims or [])):
            lease = self.p.leases.acquire(self._lease_name(res), subj, self.cfg.lease_ttl_s)
            if lease is None:
                self._release(held)
                return False
            held[res] = lease.epoch
        self._held = {"subject": subj, "leases": held, "spec": spec}
        return True

    def _release(self, held: Mapping[str, int]) -> None:
        for res, epoch in held.items():
            cur = self.p.leases.current(self._lease_name(res))
            if cur is not None and cur.epoch == epoch:
                self.p.leases.release(cur)

    def started(self, u: Any, n: int, worktree: str, builder: str = "builder") -> None:
        """After the dispatch: gates frozen, build started, producers' heads under the worktree."""
        info = getattr(self, "_held", None) or {}
        subj = subject(self.run, u.id, n)
        held = info.get("leases", {}) if info.get("subject") == subj else {}
        spec = info.get("spec", []) if info.get("subject") == subj else []
        self._held = {}
        unit = self.p.sstore.get(E_UNIT, u.id) or {}
        gates = self._gates(unit)
        with self._lock:
            self.rt.reset(subj)
            rows = self._units()
            for d in spec:
                if (rows.get(d) or {}).get("state") == UnitState.MERGED.value:
                    continue
                ps = subject(self.run, d, int(rows[d].get("attempt") or 0))
                try:
                    self.rt._depend(subj, ps)
                except DepthExceeded:
                    pass
            for res in sorted(set(u.claims or [])):
                self.rt.writes.setdefault(subj, []).append((res, subj))
            self.ledger.freeze_gates(subj, gates, approver="test_author", builder=builder)
            self.ledger.build_started(subj)
            self._save(subj, claims=sorted(set(u.claims or [])), leases=held, spec_on=spec, builder=builder,
                       gates_sha=gates_sha(gates))
        self._emit(codes.SEAL_GATED, u.id, n, {"subject": subj, "gates_sha": gates_sha(gates),
                                               "approver": "test_author", "builder": builder, "spec_on": spec})
        heads = [(d, (rows.get(d) or {}).get("detail", {}).get("head")) for d in spec
                 if (rows.get(d) or {}).get("state") != UnitState.MERGED.value]
        heads = [(d, h) for d, h in heads if h]
        if heads and worktree and os.path.isdir(worktree):
            self._stack(u, worktree, heads)

    def _stack(self, u: Any, worktree: str, heads: Sequence[tuple]) -> None:
        """Speculative start: the producers' commits under the unit's worktree; the base ref moves past
        them so the unit's diff (claims, verify) is its own work only."""
        from ..ship._util import git, git_out
        ident = ("-c", "user.name=line", "-c", "user.email=line@localhost")
        cur = git_out(worktree, "rev-parse", "HEAD")
        start = cur
        for d, head in heads:
            # merged in the object store (no working tree involved), then the worktree is reset onto it
            cp = git(self.p.repo, "merge-tree", "--write-tree", cur, head, check=False)
            if cp.returncode != 0:
                self.p.log("%s: %s could not stack %s (%s): builds without it: %s"
                           % (self.run, u.id, d, head[:12], (cp.stdout or cp.stderr or "")[-300:]))
                continue
            tree = (cp.stdout or "").split()[0]
            cur = git_out(self.p.repo, *ident, "commit-tree", tree, "-p", cur, "-p", head,
                          "-m", "line seal: %s stacked on %s %s (speculative)" % (u.id, d, head[:12]))
        if cur != start:
            git(worktree, "reset", "--hard", "-q", cur)
        git(self.p.repo, "update-ref", self.p.sandbox._base_ref(u), cur)

    # ------------------------------------------------------------------ attempts

    def evidence(self, uid: str, n: int) -> List[Dict[str, Any]]:
        g = self.p.sstore.get(E_GATE, "%s#%d:verify" % (uid, n)) or {}
        ev = g.get("evidence_item")
        return [ev] if isinstance(ev, dict) else []

    def on_attempt(self, uid: str, res: Mapping[str, Any]) -> bool:
        """After a builder attempt. True when handled here (verified: submitted for scoring)."""
        n = int(res.get("attempt") or 0)
        subj = subject(self.run, uid, n)
        if self.ledger.state(subj) not in ("building",):
            return False
        row = self.row(subj)
        if res.get("outcome") == "SUBMIT" and res.get("verified"):
            if self.rt.batch_state.get(subj) == "tainted":
                self._release(row.get("leases") or {})
                self._void(subj, "built on a producer whose seal failed")
                self._requeue(uid, codes.SEAL_TAINTED_CODE, "tainted")
                return True
            with self._lock:
                self.rt.finish_build(subj)
                unit = self.p.sstore.get(E_UNIT, uid) or {}
                try:
                    self.ledger.submit(subj, gates_sha(self._gates(unit)), self.evidence(uid, n))
                except LedgerError as e:
                    self.p.log("%s: %s: %s" % (self.run, subj, e))
                    self._void(subj, str(e))
                    self._requeue(uid, codes.SEAL_REJECTED, "gates")
                    return True
                level = level_for(touches_trunk=self._l2(row.get("claims") or []),
                                  shared_writers=len(self.rt.deps.get(subj, ())),
                                  unknown_impact=not (row.get("claims") or []))
                self.queue.push(subj, level, waiting_on(self.rt.deps, subj), float(now_ms()))
                self._save(subj, level=level, review=res.get("review", ""))
            self._release(row.get("leases") or {})
            self._emit(codes.SEAL_SUBMITTED, uid, n, {"subject": subj, "evidence": len(self.evidence(uid, n)),
                                                      "level": level})
            return True
        self._void(subj, "attempt ended %s" % (res.get("gate_code") or res.get("code") or res.get("outcome")))
        self._release(row.get("leases") or {})
        with self._lock:
            self.rt.abort(subj)
        return False

    def _void(self, subj: str, reason: str) -> None:
        with self._lock:
            if self.ledger.state(subj) in ("sealed", "rejected", "void", "new"):
                return
            self.ledger.void(subj, reason)
            self._save(subj, reason=reason)
        _, uid, n = split(subj)
        self._emit(codes.SEAL_VOIDED, uid, n, {"subject": subj, "reason": reason})

    def _requeue(self, uid: str, code: str, why: str) -> None:
        """A verified unit goes back to READY (not a ladder failure); its worktree starts fresh."""
        row = self.p.sstore.get(E_UNIT, uid) or {}
        if row.get("state") != UnitState.VERIFIED.value:
            return
        detail = dict(row.get("detail") or {})
        detail.pop("spec_on", None)
        try:
            self.p.sm.advance_unit(uid, UnitState.READY, UnitState.VERIFIED, code=code,
                                   updates={"detail": detail},
                                   extra=[(codes.UNIT_REQUEUED, {"code": code, "from": UnitState.VERIFIED.value,
                                                                "why": why})])
        except LineError as e:
            if e.code != codes.STATE_CONFLICT:
                raise
            return
        from ..contracts import unit_lease_name
        cur = self.p.sleases.current(unit_lease_name(uid))
        if cur is not None:                      # the next attempt gets a fresh grant
            self.p.sleases.release(cur)
        try:
            self.p.sandbox.cleanup(row)
        except Exception as e:   # noqa: BLE001 - a leftover worktree is only disk space
            self.p.log("%s: cleanup of %s: %s" % (self.run, uid, e))

    # ------------------------------------------------------------------ scoring

    def _fixture(self, uid: str, n: int) -> Optional[Dict[str, Any]]:
        if getattr(self.cfg, "llm", "") != "fake" or not getattr(self.cfg, "dry_pack", ""):
            return None
        try:
            from ..llm.fake import resolve_pack
            root = resolve_pack(self.cfg.dry_pack)
        except LineError:
            return None
        path = os.path.join(root, "dry", "seal", "%s#%d.json" % (uid, n))
        if not os.path.isfile(path):
            return None
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def score_for(self, subj: str) -> tuple:
        """(Score, scorer). The scorer is never the builder."""
        _, uid, n = split(subj)
        row = self.row(subj)
        ev = self.evidence(uid, n)
        fx = self._fixture(uid, n)
        scorer = SCORER_REVIEW if getattr(self.cfg, "review_enabled", False) else SCORER_DEFAULT
        if fx is not None:
            return Score(float(fx.get("purpose", 100)), float(fx.get("evidence", 100)), float(fx.get("love", 100)),
                         docked=list(fx.get("docked") or []), evidence_items=[] if fx.get("no_evidence") else ev), \
                fx.get("scorer") or scorer
        g = (self.p.sstore.get(E_GATE, "%s#%d:verify" % (uid, n)) or {}).get("gate") or {}
        d = g.get("detail") or {}
        tests, passed = int(d.get("tests") or 0), int(d.get("passed") or 0)
        docked: List[str] = []
        if tests:
            purpose = round(100.0 * min(passed, tests) / tests, 2)
            if purpose < 100:
                docked.append("-%g purpose: %d of %d acceptance tests pass" % (100 - purpose, passed, tests))
        else:
            purpose = 100.0
            docked.append("-0 purpose: owns no acceptance test (contract unit); gate = claims + compile")
        evidence = 100.0 if any(real_evidence(e) for e in ev) else 0.0
        if not evidence:
            docked.append("-100 evidence: no command output captured by the verifier")
        love = 100.0
        if row.get("review") not in ("", "skip", "approve", "approved", None):
            love = 90.0
            docked.append("-10 love: the reviewer asked for changes before (%s)" % row.get("review"))
        if not docked:
            docked.append("nothing docked: every owned acceptance test passed with captured output")
        return Score(purpose, evidence, love, docked=docked, evidence_items=ev), scorer

    def tick(self) -> Dict[str, Any]:
        """Score what is queued, finalise what can be, enqueue sealed units for merge, taint and requeue."""
        out = {"scored": [], "sealed": [], "rejected": [], "tainted": [], "enqueued": [], "signoff": []}
        self._lost_producers(out)
        self._refused(out)
        while True:
            with self._lock:
                subj = self.queue.pop()
            if subj is None:
                break
            self._score(subj, out)
        self._finalise(out)
        return out

    def _score(self, subj: str, out: Dict[str, Any]) -> None:
        _, uid, n = split(subj)
        if self.ledger.state(subj) != "pending":
            return
        sc, scorer = self.score_for(subj)
        row = self.row(subj)
        level = row.get("level") or "L0"
        with self._lock:
            v = self.ledger.score(subj, sc, scorer=scorer, level=level)
            self.gov.record(v.sealed)
            self._save(subj, total=v.total, scorer=scorer, docked=list(sc.docked or []), reasons=list(v.reasons))
        out["scored"].append(subj)
        self._emit(codes.SEAL_SCORED, uid, n, {"subject": subj, "state": self.ledger.state(subj), "total": v.total,
                                               "level": level, "scorer": scorer, "docked": list(sc.docked or []),
                                               "reasons": list(v.reasons)})
        if v.needs_signoff:
            if getattr(self.cfg, "human_mode", "ask") == "decide":
                self.sign(subj, SIGN_DECIDE, decided=True)
            else:
                out["signoff"].append(subj)
            return
        if not v.sealed:
            out["rejected"].append(subj)
            with self._lock:
                tainted = self.rt.fail(subj)
                self._save(subj)
            for t in tainted:
                self._taint(t, subj, out)
            self._requeue(uid, codes.SEAL_REJECTED, "seal: " + "; ".join(v.reasons))
            urow = self.p.sstore.get(E_UNIT, uid) or {}
            if urow.get("state") == UnitState.READY.value:
                self.p._ladder(uid, codes.SEAL_REJECTED, "seal:%s" % ",".join(sorted(v.reasons)))

    def _taint(self, t: str, producer: str, out: Dict[str, Any]) -> None:
        _, tuid, tn = split(t)
        out["tainted"].append(t)
        self._save(t, tainted_by=producer)
        self._emit(codes.SEAL_TAINTED, tuid, tn, {"subject": t, "producer": producer, "unit": tuid})
        if self.ledger.state(t) in ("pending", "awaiting_signoff"):
            self.queue.discard(t)
            self._void(t, "tainted by %s" % producer)
            self._requeue(tuid, codes.SEAL_TAINTED_CODE, "tainted by %s" % producer)
        elif self.ledger.state(t) == "sealed":
            self.ledger.correct(t, "built on %s whose seal failed" % producer, new_subject="")
            self._emit(codes.SEAL_CORRECTED, tuid, tn, {"subject": t, "reason": "producer failed", "new_subject": ""})
            self._requeue(tuid, codes.SEAL_TAINTED_CODE, "tainted by %s" % producer)
        # building: on_attempt sees the taint when the builder returns

    def _refused(self, out: Dict[str, Any]) -> None:
        """A sign-off refused through the API voids the subject: taint its readers, build the unit again."""
        units = self._units()
        for s, st in list(self.rt.batch_state.items()):
            if st != "pending" or self.ledger.state(s) != "void":
                continue
            _, uid, n = split(s)
            u = units.get(uid) or {}
            if u.get("state") != UnitState.VERIFIED.value or int(u.get("attempt") or 0) != n:
                continue
            out["rejected"].append(s)
            with self._lock:
                tainted = self.rt.fail(s)
                self._save(s)
            for t in tainted:
                self._taint(t, s, out)
            self._requeue(uid, codes.SEAL_REJECTED, "sign-off refused")
            if (self.p.sstore.get(E_UNIT, uid) or {}).get("state") == UnitState.READY.value:
                self.p._ladder(uid, codes.SEAL_REJECTED, "seal:signoff-refused")

    def _lost_producers(self, out: Dict[str, Any]) -> None:
        """A sealed producer that left VERIFIED without merging (merge conflict): what built on it is tainted."""
        units = self._units()
        for s, st in list(self.rt.batch_state.items()):
            if st not in ("sealed", "pending"):
                continue
            _, uid, n = split(s)
            u = units.get(uid) or {}
            if u.get("state") in (UnitState.VERIFIED.value, UnitState.MERGED.value) and int(u.get("attempt") or 0) == n:
                continue
            if self.ledger.state(s) in ("building", "new"):
                continue
            readers = [r for r, ps in self.rt.deps.items() if s in ps and self.rt.batch_state.get(r) not in
                       ("sealed", "failed", "tainted")]
            if not readers:
                continue
            with self._lock:
                tainted = self.rt.fail(s)
            for t in tainted:
                self._taint(t, s, out)

    def sign(self, subj: str, by: str, decided: bool = False) -> None:
        _, uid, n = split(subj)
        with self._lock:
            self.ledger.sign(subj, by)
            self._save(subj, signed_by=by)
        if decided:
            self.p.sstore.put(E_DECISION, "%s:%s:seal:%d" % (self.run, uid, n),
                              {"run": self.run, "unit": uid, "kind": "seal_signoff", "subject": subj, "by": by,
                               "ts_ms": now_ms(), "note": "human_mode=decide: the L2 seal was signed by the line"})

    def _finalise(self, out: Dict[str, Any]) -> None:
        units = self._units()
        for s in list(self.rt.batch_state):
            _, uid, n = split(s)
            u = units.get(uid) or {}
            if int(u.get("attempt") or 0) != n or u.get("state") != UnitState.VERIFIED.value:
                continue
            if self.ledger.state(s) != "sealed":
                continue
            if self.rt.batch_state.get(s) == "pending":
                if not self.rt.can_finalize(s):
                    continue
                with self._lock:
                    self.rt.seal(s)
                    self._save(s)
                out["sealed"].append(s)
                row = self.row(s)
                self._emit(codes.SEAL_SEALED, uid, n, {"subject": s, "total": row.get("total"),
                                                      "level": row.get("level"), "by": row.get("signed_by", "")})
            if self.rt.batch_state.get(s) != "sealed" or self.row(s).get("enqueued"):
                continue
            spec = self.row(s).get("spec_on") or []
            if any((units.get(d) or {}).get("state") != UnitState.MERGED.value for d in spec):
                continue                          # merges after its producers, never ahead of them
            self.p.mq.enqueue(self.run, uid)
            self._save(s, enqueued=True)
            out["enqueued"].append(s)

    def waiting_signoff(self) -> List[str]:
        units = self._units()
        return [s for s, st in self.ledger._state.items()
                if st.get("state") == "awaiting_signoff"
                and (units.get(split(s)[1]) or {}).get("state") == UnitState.VERIFIED.value]

    def unqueued(self, uid: str) -> None:
        """The merge queue refused an item whose seal is not final: the tick may enqueue it again."""
        s = self.current(uid)
        if self.row(s):
            self._save(s, enqueued=False)

    def merge_ok(self, run: str, uid: str, attempt: int) -> bool:
        return self.rt.batch_state.get(subject(run, uid, attempt)) == "sealed"

    def recover(self) -> None:
        """Resume: verified units whose attempt never reached submit are submitted now."""
        for uid, u in self._units().items():
            if u.get("state") != UnitState.VERIFIED.value:
                continue
            n = int(u.get("attempt") or 0)
            if self.ledger.state(subject(self.run, uid, n)) == "building":
                self.on_attempt(uid, {"outcome": "SUBMIT", "verified": True, "attempt": n})

    # ------------------------------------------------------------------ final seal

    def final(self, report: Any, res: Any, suite: Mapping[str, Any]) -> Any:
        """QAS green: the run's final seal over the full acceptance suite on main."""
        subj = "%s:final#1" % self.run
        if self.ledger.state(subj) == "sealed":
            return None
        tests = sorted(r["id"] for r in self.p.sstore.query(E_ACC_TEST, run=self.run) if r.get("locked"))
        gates = [{"test": t} for t in tests]
        st = self.ledger.state(subj)
        if st in ("new",):
            self.ledger.freeze_gates(subj, gates, approver="test_author", builder="line")
            st = self.ledger.state(subj)
        if st == "gated":
            self.ledger.build_started(subj)
        if self.ledger.state(subj) == "building":
            ev = [{"cmd": suite.get("cmd", ""), "output": str(suite.get("output", ""))[-3000:],
                   "exit_code": suite.get("rc")}]
            self.ledger.submit(subj, gates_sha(gates), ev)
        items = list(getattr(report, "items", []) or [])
        green = sum(1 for i in items if getattr(i, "verdict", "") in ("green", "flaky"))
        purpose = round(100.0 * green / len(items), 2) if items else 100.0
        ran, failed = int(suite.get("ran") or 0), len(suite.get("failures") or [])
        evidence = 100.0 if suite.get("rc") == 0 and ran else (0.0 if not ran else round(100.0 * (ran - failed) / ran, 2))
        love = 100.0 if getattr(res, "ok", True) else 0.0
        docked = [] if purpose == evidence == love == 100.0 else \
            ["-%g purpose" % (100 - purpose), "-%g evidence (full suite)" % (100 - evidence), "-%g love (smoke)" % (100 - love)]
        sc = Score(purpose, evidence, love, docked=docked or ["nothing docked: QAS green, full acceptance suite green"],
                   evidence_items=[{"cmd": suite.get("cmd", ""), "output": str(suite.get("output", ""))[-3000:],
                                    "exit_code": suite.get("rc")}])
        v = self.ledger.score(subj, sc, scorer="qas", level="L0")
        self._save(subj, total=v.total, scorer="qas", docked=list(sc.docked or []), reasons=list(v.reasons),
                   level="L0", final=True)
        self._emit(codes.SEAL_SCORED, "", 0, {"subject": subj, "state": self.ledger.state(subj), "total": v.total,
                                             "level": "L0", "scorer": "qas", "docked": list(sc.docked or []),
                                             "reasons": list(v.reasons), "final": True})
        if v.sealed:
            self._emit(codes.SEAL_SEALED, "", 0, {"subject": subj, "total": v.total, "level": "L0", "final": True})
        return v

    def summary(self) -> Dict[str, Any]:
        return {"subjects": len(self.ledger._state), "chain_ok": self.ledger.verify(),
                "fail_rate": round(self.gov.fail_rate(), 3), "violations": self.rt.violations()}


def view(store: Any, run: str) -> List[Dict[str, Any]]:
    """Per-subject seal rows of a run (board / API), newest attempt last."""
    rows = store.query(E_SEAL, run=run)
    return sorted(rows, key=lambda r: (str(r.get("unit", "")), int(r.get("attempt") or 0)))


def sign_subject(store: Any, run: str, subj: str, by: str, option: str = "sign") -> Dict[str, Any]:
    """API sign-off of an L2 seal (outside a running pipeline): append to the persisted chain.
    option "sign" seals it; "refuse" voids it (the resumed run builds the unit again, as a refused seal)."""
    if not str(by or "").strip():
        raise LineError(codes.SCHEMA_INVALID, "who is required", {"subject": subj})
    if option not in ("sign", "refuse"):
        raise LineError(codes.SCHEMA_INVALID, "option must be sign or refuse", {"subject": subj, "option": option})
    entries = store.query(E_SEAL_ENTRY, run=run)
    ledger = SealLedger(entries=entries, sink=lambda e: store.put(E_SEAL_ENTRY, "%s:%06d" % (run, int(e["seq"])),
                                                                     dict(e, run=run), run=run))
    if ledger.state(subj) != "awaiting_signoff":
        raise LineError(codes.STATE_CONFLICT, "%s is %s, not awaiting a sign-off" % (subj, ledger.state(subj)),
                        {"subject": subj})
    try:
        if option == "sign":
            ledger.sign(subj, by)
        else:
            ledger.void(subj, "sign-off refused by %s" % by)
    except LedgerError as e:
        raise LineError(codes.STATE_CONFLICT, str(e), {"subject": subj}) from e
    row = dict(store.get(E_SEAL, subj) or {"id": subj, "run": run})
    row.update(ledger_state=ledger.state(subj), updated_ms=now_ms(), **(
        {"signed_by": by} if option == "sign" else {"refused_by": by}))
    store.put(E_SEAL, subj, row, run=run)
    return row


__all__ = ["RunSeal", "enabled", "subject", "split", "view", "sign_subject"]
