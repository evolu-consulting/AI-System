"""Chaos suite (design block 4, I38 / N1): faults injected into the DRY pipeline, then invariants.

    python -m line.chaos                     # every scenario
    python -m line.chaos kill_resume skew    # some (names: SCENARIOS)
    python -m line.chaos --all-on            # every scenario with every wave 4 feature flag on (ALL_ON)
    from line.chaos import run_scenario, check_invariants

Each scenario admits the sample pack (dry fixtures, fake model, zero cost) into a fresh work root,
drives it with line.pipeline (called, never changed), injects one fault, lets the line recover
(resume, retry ladder, watchdog, outbox replay, reconciler) and then checks the invariants:

  gapless        event seq is 1..N with no gap (the whole store)
  terminal_last  the run has exactly one terminal event (run-level escalated | run.green) and no event
                 of the run follows it
  epochs         per unit, fenced events (epoch > 0) never go back to an older epoch
  projection     the store's run / unit states equal the states projected from the run's events
  merged_green   green run: every unit merged, and the acceptance tests of every merged unit pass on a
                 fresh clone of main
  outbox         (RAG port given) after the remote is back: outbox empty, nothing unsynced, the remote
                 log holds every local event exactly once
  reconciler     the reconciler converges in <= 2 passes (pass 2 changes nothing)

Scenarios (SCENARIOS):
  kill_resume        the process dies inside the builder of U2 (lease held); the reconciler requeues the
                     stuck unit once the lease ran out; a new driver resumes -> green
  cancel_resume      operator cancel while a builder runs -> escalated CANCELLED, nothing after it;
                     resume of the final run changes nothing
  rag_outage         the RAG System goes down when building starts, comes back after the run; the
                     reconciler probes, the outbox replays, the remote log is complete -> green
  lease_expiry       the unit lease of U1 runs out between the builder's state change and its fenced
                     submit event (the write is refused): the builder takes its change back (unit ready,
                     LEASE_LOST) - or, had it died there, the live reconciler would requeue it -> green
  corrupt_worktree   the process dies before U3 is verified and U3's worktree is corrupted; the
                     reconciler drops the worktree and requeues U3; resume -> green
  duplicate_delivery the synced flag of the first event batches is lost, so batches are delivered
                     again; the remote deduplicates by event id; projections are idempotent -> green
  skew_forward       the store clock jumps past the lease TTL mid-build: every lease is lost, stale
                     writes are refused; the run pauses (run.paused, not terminal) or finishes green;
                     a paused run is resumed -> green
  skew_backward      the store clock jumps back one hour mid-build -> green (seq stays gapless)
  rag_leases_skew    leases come from a RAG lease port (rag_state.RagLeases) whose clock is a day ahead
                     -> green; local expiries never come from the remote clock

The wave 4 features run with their flags as the scenario's config says (python -m line.chaos --all-on
turns every feature flag on for every scenario).
"""

from __future__ import annotations

import contextlib
import os
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple
from unittest import mock

from . import codes
from .codes import LineError
from .config import LINE_DIR, load_config
from .contracts import E_ACC_TEST, E_RUN, E_UNIT, TERMINAL_RUN_STATES, UnitState
from .events import check_gapless, project
from .reconciler import NEW_EVENT_KINDS as RECON_KINDS, Reconciler, project_states
from .rag_state import NEW_EVENT_KINDS as RAGSTATE_KINDS
from .scope import ScopedStore
from .store import SqliteStore, SystemClock

PACK = os.path.join(LINE_DIR, "samples", "todo-pack")
#: --all-on: every wave 4 feature flag (dry questions answer themselves from the pack's fixtures)
ALL_ON: Dict[str, Any] = {"reconcile": True, "uplus_enabled": True, "dry_human": "auto", "review_enabled": True,
                          "drift_enabled": True, "judge_enabled": True, "learn_enabled": True, "agents_enabled": True,
                          "obs_enabled": True}
EXTRA_KINDS = frozenset(RECON_KINDS + RAGSTATE_KINDS)
DRIVE_TIMEOUT_S = 240.0


class Crash(BaseException):
    """The process dying: not an Exception, so drive() does not escalate on it."""


# ------------------------------------------------------------------ fakes


class SkewClock:
    """Wall clock plus an offset that a scenario can move (jump forward / back)."""

    def __init__(self, offset_ms: int = 0):
        self.offset_ms = int(offset_ms)
        self._sys = SystemClock()

    def now_ms(self) -> int:
        return self._sys.now_ms() + self.offset_ms

    def jump(self, seconds: float) -> None:
        self.offset_ms += int(seconds * 1000)


def dedup_rag(clock: Any = None) -> Any:
    """A FakeRag whose event log deduplicates by event id, as the RAG System does (counts duplicates)."""
    from .rag.http_adapter import wire_event_id
    from .tests.fakes import FakeRag

    class DedupRag(FakeRag):
        def __init__(self) -> None:
            super().__init__(clock)
            self.ids: set = set()
            self.duplicates = 0

        def append_events(self, batch: Sequence[Any], idem_key: str) -> Dict[str, Any]:
            self._gate("events", "append_events", n=len(batch), idem_key=idem_key)
            with self._lock:
                acc = 0
                for ev in batch:
                    i = str(ev.get("id") or wire_event_id(ev))
                    if i in self.ids:
                        self.duplicates += 1
                        continue
                    self.ids.add(i)
                    self.events.append(dict(ev, remote_seq=len(self.events) + 1))
                    acc += 1
                return {"accepted": acc, "last_seq": len(self.events)}

    return DedupRag()


def prepare_pack(dst: str, extra_attempts: int = 3) -> str:
    """Copy the sample pack; every builder fixture gets `extra_attempts` more attempts (copies of its last
    attempt), so a unit rebuilt after a lost lease / lost worktree has a fixture for its next attempt."""
    if not os.path.isdir(dst):
        shutil.copytree(PACK, dst)
    broot = os.path.join(dst, "dry", "builder")
    for unit in os.listdir(broot):
        ud = os.path.join(broot, unit)
        nums = sorted(int(n[7:]) for n in os.listdir(ud) if n.startswith("attempt") and n[7:].isdigit())
        if not nums:
            continue
        last = os.path.join(ud, "attempt%d" % nums[-1])
        for k in range(nums[-1] + 1, nums[-1] + 1 + extra_attempts):
            p = os.path.join(ud, "attempt%d" % k)
            if not os.path.isdir(p):
                shutil.copytree(last, p)
    return dst


# ------------------------------------------------------------------ results


@dataclass
class ScenarioResult:
    name: str
    run: str = ""
    state: str = ""
    code: str = ""
    violations: List[str] = field(default_factory=list)
    notes: Dict[str, Any] = field(default_factory=dict)
    seconds: float = 0.0
    work: str = ""

    @property
    def ok(self) -> bool:
        return not self.violations

    def line(self) -> str:
        return "%-18s %s  state=%s%s  %.1fs %s" % (
            self.name, "PASS" if self.ok else "FAIL", self.state, (" code=" + self.code) if self.code else "",
            self.seconds, " ".join("%s=%s" % kv for kv in sorted(self.notes.items())))


# ------------------------------------------------------------------ invariants


def _terminal_events(evs: Sequence[Any]) -> List[int]:
    return [i for i, e in enumerate(evs)
            if (e.kind == codes.ESCALATED and not e.env.unit) or e.kind == codes.RUN_GREEN]


def tests_green_on_main(store: Any, run: str, repo: str, work: Optional[str] = None) -> Tuple[bool, str]:
    """Acceptance tests of every merged unit of the run, on a fresh clone of main."""
    from .ship._util import git
    from .ship.merge_queue import default_test_runner, test_name
    sst = ScopedStore(store, run)
    names: List[str] = []
    for u in store.query(E_UNIT, run=run, state=UnitState.MERGED.value):
        for tid in u.get("tests") or []:
            row = sst.get(E_ACC_TEST, tid)
            n = test_name(row) if row else ""
            if n and n not in names:
                names.append(n)
    if not names:
        return True, "no acceptance tests"
    tmp = tempfile.mkdtemp(prefix="line-chaos-main-", dir=work)
    try:
        dest = os.path.join(tmp, "main")
        git(tmp, "clone", "-q", "--branch", "main", repo, dest)
        res = default_test_runner(dest, names)
        return bool(res.get("ok")), str(res.get("output", ""))[-2000:]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_invariants(store: Any, run: str, *, rag: Any = None, remote: Any = None, work: Optional[str] = None,
                     merged_green: bool = True) -> List[str]:
    """The invariants of the module doc that do not need the reconciler. Returns the violations."""
    bad: List[str] = []
    all_evs = store.events_after(0, limit=10 ** 9)
    try:
        check_gapless(all_evs)
    except LineError as e:
        bad.append("gapless: %s" % e.message)
    evs = [e for e in all_evs if e.env.run == run]
    row = store.get(E_RUN, run) or {}
    term = _terminal_events(evs)
    if row.get("state") in TERMINAL_RUN_STATES:
        if len(term) != 1:
            bad.append("terminal_last: %d terminal events" % len(term))
        elif term[0] != len(evs) - 1:
            bad.append("terminal_last: events after the terminal event: %s" % [e.kind for e in evs[term[0] + 1:]])
    elif term:
        bad.append("terminal_last: terminal event but run is %s" % row.get("state"))
    last: Dict[str, int] = {}
    for e in evs:
        if e.env.unit and e.env.epoch > 0:
            if e.env.epoch < last.get(e.env.unit, 0):
                bad.append("epochs: %s seq %d epoch %d after epoch %d" % (e.env.unit, e.seq, e.env.epoch,
                                                                        last[e.env.unit]))
            last[e.env.unit] = max(last.get(e.env.unit, 0), e.env.epoch)
    proj = project_states(evs)
    if proj["run"] != row.get("state"):
        bad.append("projection: run store=%s events=%s" % (row.get("state"), proj["run"]))
    for u in store.query(E_UNIT, run=run):
        pst = proj["units"].get(u["id"], "") or UnitState.PENDING.value
        if pst != u.get("state"):
            bad.append("projection: %s store=%s events=%s" % (u["id"], u.get("state"), pst))
    if row.get("state") == "green" and merged_green:
        units = store.query(E_UNIT, run=run)
        if not units or any(u["state"] != UnitState.MERGED.value for u in units):
            bad.append("merged_green: not every unit merged: %s" % {u["id"]: u["state"] for u in units})
        repo = str((row.get("detail") or {}).get("target") or "")
        ok, out = tests_green_on_main(store, run, repo, work) if repo else (False, "no target")
        if not ok:
            bad.append("merged_green: acceptance tests red on main: %s" % out[-500:])
    if rag is not None and hasattr(rag, "remote"):
        if store.outbox_peek(1):
            bad.append("outbox: %d item(s) left" % len(store.outbox_peek(100000)))
        if store.unsynced(1):
            bad.append("outbox: events unsynced from seq %d" % store.unsynced(1)[0].seq)
        if remote is not None:
            from .rag.http_adapter import wire_event_id
            from .contracts import to_dict
            ids = [str(e.get("id") or wire_event_id(e)) for e in remote.events]
            if len(ids) != len(set(ids)):
                bad.append("outbox: remote log holds an event twice")
            local = {wire_event_id(to_dict(e)) for e in store.events_after(0, limit=10 ** 9)}
            missing = local - set(ids)
            if missing:
                bad.append("outbox: %d local event(s) missing on the remote" % len(missing))
    return bad


def check_reconciler(store: Any, cfg: Any, *, rag: Any = None, max_passes: int = 2,
                     notes: Optional[Dict[str, Any]] = None) -> List[str]:
    """Reconciler passes until clean; violation unless pass <= max_passes is clean."""
    rc = Reconciler(store, cfg, rag=rag, unsynced_s=0, lease_grace_s=0)
    reps = rc.converge(max_passes=max_passes + 1)
    if notes is not None:
        notes["recon_passes"] = len(reps)
        notes["recon_repairs"] = sum(len(r.repaired) for r in reps)
    last = reps[-1]
    if not last.clean or len(reps) > max_passes:
        return ["reconciler: not converged in %d passes: %s" % (max_passes, [r.summary() for r in reps])]
    return []


# ------------------------------------------------------------------ the lab


class Lab:
    """Temporary work root for one scenario: config, store, pack copy."""

    def __init__(self, name: str, base: Optional[str] = None, keep: bool = False, all_on: bool = False):
        root = base or os.environ.get("LINE_WORKROOT") or tempfile.gettempdir()
        os.makedirs(root, exist_ok=True)
        self.work = tempfile.mkdtemp(prefix="line-chaos-%s-" % name, dir=root)
        self.keep = keep
        self.all_on = all_on
        self.stores: List[Any] = []
        self.pack = prepare_pack(os.path.join(self.work, "pack"))

    def config(self, **kw: Any) -> Any:
        base = dict(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                    rag="off", dry_pack=self.pack, deploy_windows=[], max_parallel_units=3, qas_repeats=3)
        if self.all_on:
            base.update(ALL_ON)
        base.update(kw)
        return load_config(env={}, line_json=None, rag_local_json=None, **base)

    def store(self, cfg: Any, cls: Any = SqliteStore, **kw: Any) -> Any:
        st = cls(cfg.db, **kw)
        self.stores.append(st)
        return st

    def close(self) -> None:
        for st in self.stores:
            with contextlib.suppress(Exception):
                st.close()
        if not self.keep:
            shutil.rmtree(self.work, ignore_errors=True)


def _pipeline(store: Any, cfg: Any, **kw: Any) -> Any:
    from .pipeline import Pipeline
    return Pipeline(store, cfg, **kw)


def _drive_bounded(p: Any, run: str, timeout_s: float = DRIVE_TIMEOUT_S) -> Tuple[Dict[str, Any], bool]:
    """p.drive(run) on a thread; cancel it when it does not finish in time. -> (row, finished_in_time)."""
    box: Dict[str, Any] = {}

    def target() -> None:
        try:
            box["row"] = p.drive(run)
        except BaseException as e:   # noqa: BLE001
            box["error"] = e

    t = threading.Thread(target=target, name="chaos-drive", daemon=True)
    t.start()
    t.join(timeout_s)
    in_time = not t.is_alive()
    if not in_time:
        p.cancel("chaos: drive timed out")
        t.join(60)
    if "error" in box:
        raise box["error"]
    return box.get("row") or p.store.get(E_RUN, run) or {}, in_time


def _finish(res: ScenarioResult, store: Any, run: str, row: Dict[str, Any]) -> None:
    res.run = run
    res.state = row.get("state", "")
    res.code = str(((row.get("detail") or {}).get("escalation") or {}).get("code") or "")


# ------------------------------------------------------------------ scenarios


def sc_kill_resume(lab: Lab, res: ScenarioResult) -> None:
    import line.pipeline as P
    cfg = lab.config(lease_ttl_s=2, heartbeat_s=1, watchdog_s=1)
    store = lab.store(cfg)
    real = P.run_builder
    fired: List[str] = []

    def build_or_die(unit: Any, lease: Any, *a: Any, **kw: Any) -> Any:
        if unit.id == "U2" and not fired:
            fired.append(unit.id)
            raise Crash("builder of U2")            # dies holding the unit lease
        return real(unit, lease, *a, **kw)

    p1 = _pipeline(store, cfg)
    run = p1.admit(lab.pack)
    with mock.patch.object(P, "run_builder", side_effect=build_or_die):
        try:
            p1.drive(run)
            res.violations.append("kill_resume: the crash did not stop the driver")
        except Crash:
            pass
    left = store.get(E_RUN, run)["state"]
    res.notes["left"] = left
    time.sleep(2.5)                                 # the dead driver's leases run out
    rep = Reconciler(store, cfg, lease_grace_s=0).run_pass(run=run)
    res.notes["recon_before_resume"] = len(rep.repaired)
    if not any(d.check == "stuck_lease" and d.unit == "U2" and d.status == "repaired" for d in rep.drifts):
        res.violations.append("kill_resume: reconciler did not requeue the stuck U2: %s" % rep.summary())
    row, in_time = _drive_bounded(_pipeline(store, cfg), run)
    if not in_time:
        res.violations.append("kill_resume: resume did not finish")
    _finish(res, store, run, row)
    if row.get("state") != "green":
        res.violations.append("kill_resume: run %s" % row.get("state"))
    res.violations += check_invariants(store, run, work=lab.work)
    res.violations += check_reconciler(store, cfg, notes=res.notes)


def sc_cancel_resume(lab: Lab, res: ScenarioResult) -> None:
    cfg = lab.config(cancel_join_s=20)
    store = lab.store(cfg)
    from .llm import make_llm
    inner = make_llm(cfg, store)
    box: Dict[str, Any] = {}

    class CancellingLlm:
        def complete(self, *a: Any, **kw: Any) -> Any:
            return inner.complete(*a, **kw)

        def spent(self, run: str = "") -> float:
            return inner.spent(run)

        def agentic(self, role: str, workdir: str, prompt: str, max_turns: int, usd_cap: float, **kw: Any) -> Any:
            if not box.get("done"):
                box["done"] = True
                box["p"].cancel("chaos")
                box["p"]._cancel.wait(10)
            return inner.agentic(role, workdir, prompt, max_turns, usd_cap, **kw)

    p = _pipeline(store, cfg, llm=CancellingLlm())
    box["p"] = p
    run = p.admit(lab.pack)
    row, _ = _drive_bounded(p, run)
    _finish(res, store, run, row)
    if row.get("state") != "escalated" or res.code != codes.CANCELLED:
        res.violations.append("cancel_resume: want escalated CANCELLED, got %s %s" % (row.get("state"), res.code))
    time.sleep(0.5)
    n = store.last_seq()
    again = _pipeline(store, cfg).drive(run)        # resume of a final run: nothing happens
    if again.get("state") != row.get("state") or store.last_seq() != n:
        res.violations.append("cancel_resume: resume of the final run changed it")
    res.violations += check_invariants(store, run, work=lab.work)
    res.violations += check_reconciler(store, cfg, notes=res.notes)
    after = [e for e in store.events_after(0, run=run)][_terminal_events(store.events_after(0, run=run))[0] + 1:] \
        if _terminal_events(store.events_after(0, run=run)) else []
    if after:
        res.violations.append("cancel_resume: reconciler wrote on the closed run: %s" % [e.kind for e in after])


def sc_rag_outage(lab: Lab, res: ScenarioResult) -> None:
    from .rag import make_rag
    cfg = lab.config(rag="http", rag_url="http://rag.invalid")   # remote is an in-process fake
    store = lab.store(cfg)
    remote = dedup_rag()
    rag = make_rag(cfg, store, remote=remote, probe_interval_s=0)

    def outage(run: str, stage: str) -> None:
        if stage == "building":
            remote.down = True

    p = _pipeline(store, cfg, rag=rag, on_stage=outage)
    run = p.admit(lab.pack)
    row, _ = _drive_bounded(p, run)
    _finish(res, store, run, row)
    res.notes["outbox_during"] = len(store.outbox_peek(100000))
    if not res.notes["outbox_during"]:
        res.violations.append("rag_outage: nothing was queued during the outage")
    if row.get("state") != "green":
        res.violations.append("rag_outage: run %s" % row.get("state"))
    remote.down = False
    res.violations += check_reconciler(store, cfg, rag=rag, notes=res.notes)
    res.violations += check_invariants(store, run, rag=rag, remote=remote, work=lab.work)
    if not any(e.kind == codes.RAG_RESTORED for e in store.events_after(0, limit=10 ** 9)):
        res.violations.append("rag_outage: no rag.restored")


def sc_lease_expiry(lab: Lab, res: ScenarioResult) -> None:
    cfg = lab.config(lease_ttl_s=30, heartbeat_s=1, watchdog_s=1)
    hit: List[str] = []

    class ExpiringStore(SqliteStore):
        """The unit lease of U1 runs out right after its builder moved it to submitted, before the fenced
        unit.submitted event: that event is refused (LEASE_LOST)."""

        def transition(self, entity: str, id: str, to: Any, expect_from: Any) -> Dict[str, Any]:
            row = super().transition(entity, id, to, expect_from)
            if entity == E_UNIT and id.endswith(":U1") and getattr(to, "value", to) == "submitted" and not hit:
                hit.append(id)
                with self.tx() as c:
                    c.execute("UPDATE lease SET expires_ms=? WHERE name=?", (self.clock.now_ms() - 1,
                                                                           "unit:" + id))
            return row

    store = lab.store(cfg, ExpiringStore)
    rc = Reconciler(store, cfg, lease_grace_s=0).start(interval_s=0.5)
    try:
        p = _pipeline(store, cfg)
        run = p.admit(lab.pack)
        row, in_time = _drive_bounded(p, run, timeout_s=120)
    finally:
        rc.stop()
    _finish(res, store, run, row)
    res.notes["fault_hit"] = bool(hit)
    if not hit:
        res.violations.append("lease_expiry: the fault was not injected")
    if not in_time:
        res.violations.append("lease_expiry: run hung (stuck submitted unit not repaired)")
    if row.get("state") != "green":
        res.violations.append("lease_expiry: run %s %s" % (row.get("state"), res.code))
    refused = [e for e in store.events_after(0, run=run, kinds=[codes.UNIT_SUBMITTED]) if e.env.unit == "U1"]
    res.notes["u1_submits"] = len(refused)
    rq = [e for e in store.events_after(0, run=run, kinds=[codes.UNIT_REQUEUED])
          if e.env.unit == "U1" and (e.body or {}).get("reconciled")]
    res.notes["reconciler_requeues"] = len(rq)
    back = [e for e in store.events_after(0, run=run, kinds=[codes.UNIT_REQUEUED])
            if e.env.unit == "U1" and (e.body or {}).get("code") == codes.LEASE_LOST]
    res.notes["builder_take_backs"] = len([e for e in back if (e.body or {}).get("why") == "fenced event refused"])
    if hit and not (rq or back):
        res.violations.append("lease_expiry: U1 was not requeued (by the builder or the reconciler)")
    res.violations += check_invariants(store, run, work=lab.work)
    res.violations += check_reconciler(store, cfg, notes=res.notes)


def sc_corrupt_worktree(lab: Lab, res: ScenarioResult) -> None:
    import line.pipeline as P
    cfg = lab.config()
    store = lab.store(cfg)
    real = P.verify
    fired: List[str] = []

    def verify_or_die(uid: str, *a: Any, **kw: Any) -> Any:
        if uid == "U3" and not fired:
            fired.append(uid)
            raise Crash("before the verifier of U3")
        return real(uid, *a, **kw)

    p1 = _pipeline(store, cfg)
    run = p1.admit(lab.pack)
    with mock.patch.object(P, "verify", side_effect=verify_or_die):
        try:
            p1.drive(run)
            res.violations.append("corrupt_worktree: the crash did not stop the driver")
        except Crash:
            pass
    u3 = store.get(E_UNIT, "%s:U3" % run) or {}
    wt = u3.get("worktree") or ""
    res.notes["u3_left"] = u3.get("state")
    if os.path.isdir(wt):
        gitfile = os.path.join(wt, ".git")
        with contextlib.suppress(OSError):
            os.chmod(gitfile, 0o666)
            os.remove(gitfile)                      # (a hidden file cannot be opened for "w" on Windows)
        with open(gitfile, "w", encoding="utf-8") as fh:
            fh.write("gitdir: /nowhere/at/all\n")              # the worktree link is garbage now
    rep = Reconciler(store, cfg, lease_grace_s=0).run_pass(run=run)
    fixed = [d for d in rep.drifts if d.check == "corrupt_worktree" and d.unit == "U3"]
    res.notes["recon_before_resume"] = len(rep.repaired)
    if not fixed or fixed[0].status != "repaired":
        res.violations.append("corrupt_worktree: not repaired: %s" % rep.summary())
    if (store.get(E_UNIT, "%s:U3" % run) or {}).get("state") not in ("ready", "verified", "merged"):
        res.violations.append("corrupt_worktree: U3 left %s" % store.get(E_UNIT, "%s:U3" % run).get("state"))
    row, in_time = _drive_bounded(_pipeline(store, cfg), run)
    _finish(res, store, run, row)
    if row.get("state") != "green":
        res.violations.append("corrupt_worktree: run %s %s" % (row.get("state"), res.code))
    res.violations += check_invariants(store, run, work=lab.work)
    res.violations += check_reconciler(store, cfg, notes=res.notes)


def sc_duplicate_delivery(lab: Lab, res: ScenarioResult) -> None:
    from .rag import make_rag
    cfg = lab.config(rag="http", rag_url="http://rag.invalid")   # remote is an in-process fake
    lost = {"n": 0}

    class ForgetfulStore(SqliteStore):
        """The synced flag of the first three batches is lost (crash between send and mark)."""

        def mark_synced(self, seqs: Any) -> None:
            if lost["n"] < 3:
                lost["n"] += 1
                return
            super().mark_synced(seqs)

    store = lab.store(cfg, ForgetfulStore)
    remote = dedup_rag()
    rag = make_rag(cfg, store, remote=remote, probe_interval_s=0)
    p = _pipeline(store, cfg, rag=rag)
    run = p.admit(lab.pack)
    row, _ = _drive_bounded(p, run)
    _finish(res, store, run, row)
    if row.get("state") != "green":
        res.violations.append("duplicate_delivery: run %s" % row.get("state"))
    res.violations += check_reconciler(store, cfg, rag=rag, notes=res.notes)
    res.notes["duplicates_delivered"] = remote.duplicates
    if not remote.duplicates:
        res.violations.append("duplicate_delivery: no batch was delivered twice (fault not effective)")
    evs = store.events_after(0, run=run)
    if project(evs + evs) != project(evs):
        res.violations.append("duplicate_delivery: board projection not idempotent")
    if project_states(evs + evs) != project_states(evs):
        res.violations.append("duplicate_delivery: state projection not idempotent")
    res.violations += check_invariants(store, run, rag=rag, remote=remote, work=lab.work)


def _skew(lab: Lab, res: ScenarioResult, seconds: float, want_green: bool) -> None:
    cfg = lab.config(lease_ttl_s=5, heartbeat_s=1, watchdog_s=1, cancel_join_s=20)
    clock = SkewClock()
    store = lab.store(cfg, clock=clock)
    from .llm import make_llm
    inner = make_llm(cfg, store)
    jumped: List[float] = []

    class JumpingLlm:
        def complete(self, *a: Any, **kw: Any) -> Any:
            return inner.complete(*a, **kw)

        def spent(self, run: str = "") -> float:
            return inner.spent(run)

        def agentic(self, role: str, workdir: str, prompt: str, max_turns: int, usd_cap: float, **kw: Any) -> Any:
            if not jumped:
                jumped.append(seconds)
                clock.jump(seconds)
                time.sleep(2.5)                     # heartbeats and the watchdog see the new time
            return inner.agentic(role, workdir, prompt, max_turns, usd_cap, **kw)

    p = _pipeline(store, cfg, llm=JumpingLlm())
    run = p.admit(lab.pack)
    row, in_time = _drive_bounded(p, run, timeout_s=180)
    _finish(res, store, run, row)
    res.notes["jump_s"] = seconds
    if not in_time:
        res.violations.append("skew: run hung")
    if want_green and row.get("state") != "green":
        res.violations.append("skew: run %s %s" % (row.get("state"), res.code))
    if not want_green:
        paused = [e for e in store.events_after(0, run=run, kinds=[codes.RUN_PAUSED])]
        res.notes["outcome"] = row.get("state") + ("/paused" if paused else "")
        if row.get("state") in TERMINAL_RUN_STATES and row.get("state") != "green":
            res.violations.append("skew: a lost run lease ended the run %s %s (want paused or green)"
                                  % (row.get("state"), res.code))
        elif row.get("state") not in TERMINAL_RUN_STATES:
            if not paused:
                res.violations.append("skew: run stopped in %s without run.paused" % row.get("state"))
            time.sleep(0.5)
            row, in_time = _drive_bounded(_pipeline(store, cfg), run, timeout_s=180)   # resume the paused run
            _finish(res, store, run, row)
            res.notes["after_resume"] = row.get("state")
            if row.get("state") != "green":
                res.violations.append("skew: resume of the paused run ended %s %s" % (row.get("state"), res.code))
    res.violations += check_invariants(store, run, work=lab.work)
    res.violations += check_reconciler(store, cfg, notes=res.notes)


def sc_skew_forward(lab: Lab, res: ScenarioResult) -> None:
    _skew(lab, res, 6.0, want_green=False)


def sc_skew_backward(lab: Lab, res: ScenarioResult) -> None:
    _skew(lab, res, -3600.0, want_green=True)


def sc_rag_leases_skew(lab: Lab, res: ScenarioResult) -> None:
    import line.pipeline as P
    from .rag_state import RagLeases
    from .tests.fakes import FakeRag, ManualClock
    cfg = lab.config(lease_ttl_s=30, heartbeat_s=1, watchdog_s=1)
    store = lab.store(cfg)
    remote = FakeRag(ManualClock(start_ms=SystemClock().now_ms() + 86_400_000))   # a day ahead, frozen
    made: List[Any] = []

    def leases(st: Any, ttl_s: int = 300, clock: Any = None) -> Any:
        lm = RagLeases(remote, st, ttl_s=ttl_s, clock=clock)
        made.append(lm)
        return lm

    with mock.patch.object(P, "SqliteLeases", side_effect=leases):
        p = _pipeline(store, cfg)
        run = p.admit(lab.pack)
        row, _ = _drive_bounded(p, run)
    _finish(res, store, run, row)
    if row.get("state") != "green":
        res.violations.append("rag_leases_skew: run %s %s" % (row.get("state"), res.code))
    grants = [c for c in remote.calls if c[0] == "lease_acquire"]
    res.notes["remote_acquires"] = len(grants)
    if not grants:
        res.violations.append("rag_leases_skew: the RAG lease port was never asked")
    now = SystemClock().now_ms()
    rd = store._read
    with rd() as c:
        far = [r["name"] for r in c.execute("SELECT name, expires_ms FROM lease") if r["expires_ms"] > now + 3_600_000]
    if far:
        res.violations.append("rag_leases_skew: local expiry taken from the remote clock: %s" % far)
    res.violations += check_invariants(store, run, work=lab.work)
    res.violations += check_reconciler(store, cfg, notes=res.notes)


SCENARIOS: Dict[str, Callable[[Lab, ScenarioResult], None]] = {
    "kill_resume": sc_kill_resume,
    "cancel_resume": sc_cancel_resume,
    "rag_outage": sc_rag_outage,
    "lease_expiry": sc_lease_expiry,
    "corrupt_worktree": sc_corrupt_worktree,
    "duplicate_delivery": sc_duplicate_delivery,
    "skew_forward": sc_skew_forward,
    "skew_backward": sc_skew_backward,
    "rag_leases_skew": sc_rag_leases_skew,
}


def run_scenario(name: str, base: Optional[str] = None, keep: bool = False, all_on: bool = False) -> ScenarioResult:
    if name not in SCENARIOS:
        raise ValueError("unknown scenario %r (one of %s)" % (name, ", ".join(SCENARIOS)))
    res = ScenarioResult(name)
    lab = Lab(name, base, keep, all_on)
    res.work = lab.work
    t0 = time.monotonic()
    saved = {k: os.environ.pop(k) for k in ("LINE_DRY_FLAKY", "LINE_DRY_QAS_RED") if k in os.environ}
    try:
        SCENARIOS[name](lab, res)
    except Exception as e:   # noqa: BLE001
        import traceback
        res.violations.append("crashed: %s: %s\n%s" % (type(e).__name__, e, traceback.format_exc()[-2000:]))
    finally:
        os.environ.update(saved)
        res.seconds = time.monotonic() - t0
        lab.close()
    return res


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    keep = "--keep" in args
    all_on = "--all-on" in args
    names = [a for a in args if not a.startswith("-")] or list(SCENARIOS)
    bad = []
    for n in names:
        r = run_scenario(n, keep=keep, all_on=all_on)
        print(r.line(), flush=True)
        for v in r.violations:
            print("    - " + v, flush=True)
        if not r.ok:
            bad.append(n)
    print("chaos%s: %d/%d scenarios passed%s" % (" (all flags on)" if all_on else "", len(names) - len(bad), len(names),
                                                (" (failed: %s)" % ", ".join(bad)) if bad else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
