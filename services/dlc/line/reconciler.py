"""Reconciler (design block 4, N1): compare desired with actual state and repair the drift.

    from line.reconciler import Reconciler
    rc = Reconciler(store, cfg, rag=rag)            # rag / records optional
    rep = rc.run_pass()                             # every run of the store; rc.run_pass(run="R1") for one
    rep = rc.run_pass(dry_run=True)                 # report only: no write, no event, no file touched
    reps = rc.converge(max_passes=2)                # passes until one changes nothing
    rc.start(interval_s=cfg.reconcile_s); rc.stop() # periodic thread

Sources compared per run: the store rows (run, units, merge items), the state projected from the
run's events, the unit worktrees on disk, the git branches / main of the target repository, the
QAS pointer, the lease table, the budget tables and (when given) the RAG System: the remote event
log, the outbox and the mirrored records (line.rag_state).

Checks (Drift.check) and their repair:

  projection        store row state != state projected from events. The store is the CAS truth.
                    unit submitted|waiting in the store but leased in the events: the fenced
                    submit / blocked event was refused (lease lost between transition and emit),
                    so the unit goes back to ready (LEASE_LOST, unit.requeued). Anything else: a
                    catch-up unit.state / run.state event {"from","to","reconciled": true}; a run
                    terminal in the store without its terminal event gets run.state + escalated /
                    run.green (reconciled). Nothing is emitted on a run whose terminal event exists.
  stuck_lease       unit leased, its lease released / reaped / absent, or expired past the grace
                    and no driver alive -> unit ready (LEASE_LOST, unit.requeued), lease reaped.
  leaked_lease      live unit lease of a terminal run -> released.
  orphan_worktree   unit worktree of a merged / unknown unit, of any unit of a green run, or the
                    merge-queue integration worktree of a terminal run -> removed (git worktree
                    remove + prune). Worktrees of failed / unfinished units of an escalated run are
                    kept (evidence for the human).
  stale_registration git still lists a worktree whose directory is gone -> git worktree prune.
  orphan_branch     line/<run>/<unit> branch of a unit the store does not know -> deleted.
  corrupt_worktree  a worktree directory git no longer recognises -> removed; a submitted unit in
                    it loses its unverified work -> ready (NOT_FOUND).
  lost_work         submitted unit without worktree, verified unit whose head commit and branch
                    are gone -> ready (NOT_FOUND).
  merged_off_main   merged unit (detail.merged_sha) or the locked-tests commit not on main. When one
                    known commit contains all of them and main is its ancestor, main is
                    fast-forwarded; otherwise the run is FROZEN.
  qas_pointer       QAS pointer names a color directory that is missing or empty -> the pointed sha
                    is exported again; sha unknown -> pointer switched to the other color when that
                    one is populated; else FROZEN.
  budget_reserved   reservation never charged: any reservation of a terminal run, a reservation on
                    the node of a merged / failed unit -> released; node.reserved != sum of its
                    reservations -> recomputed.
  events_unsynced   (remote RAG port only) events unsynced longer than unsynced_s, or outbox items
                    waiting while the remote is reachable -> probe (replays the outbox) + sync.
  remote_events     (remote RAG port only, deep) events marked synced that the remote log does not
                    have -> appended again (same event ids: the remote deduplicates).
  rag_records       (line.rag_state records given) mirrored record behind its store row -> pushed
                    (If-Match); a remote record newer than the store -> noted as a conflict.

FROZEN: drift the reconciler must not guess about. run.detail.frozen[<check>] is set and one
reconcile.frozen event is emitted (design t1: "lệch -> đóng băng run"); is_frozen(store, run) is the
hook the driver can check before it continues a run.

Safety with a live driver (run lease run:<id> live): repairs that race a builder thread
(projection, corrupt worktree, lost work) are applied only when the same drift was seen by the
previous pass of this Reconciler (status "deferred" the first time). Expired-but-unreaped leases
are the driver's watchdog's job while it is alive.

Events: reconcile.repaired {check, action, unit?, detail} and reconcile.frozen {check, reason,
detail} on the run while it is not closed (no terminal event yet), else on the system run "_line"
with body.run. Every repair is idempotent: it is decided from current state, so a second pass finds
nothing (converged). dry_run makes no change at all.

Hook API for the integrator (see on_server_start / on_before_drive at the end).
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from . import codes
from .codes import LineError
from .contracts import (
    E_ACC_TEST, E_RUN, E_UNIT, TERMINAL_RUN_STATES, Envelope, RunState, UnitState, now_ms, to_dict,
    unit_lease_name,
)
from .events import Emitter
from .scope import ScopedStore

# ------------------------------------------------------------------ new event kinds (integrator: add to codes)

RECONCILE_REPAIRED = "reconcile.repaired"   # body: {"check", "action", "unit"?, "detail", "run"?}
RECONCILE_FROZEN = "reconcile.frozen"       # body: {"check", "reason", "detail", "run"?}
NEW_EVENT_KINDS = (RECONCILE_REPAIRED, RECONCILE_FROZEN)

SYSTEM_RUN = "_line"

# ------------------------------------------------------------------ checks

C_PROJECTION = "projection"
C_STUCK_LEASE = "stuck_lease"
C_LEAKED_LEASE = "leaked_lease"
C_ORPHAN_WORKTREE = "orphan_worktree"
C_STALE_REG = "stale_registration"
C_ORPHAN_BRANCH = "orphan_branch"
C_CORRUPT_WORKTREE = "corrupt_worktree"
C_LOST_WORK = "lost_work"
C_MERGED_OFF_MAIN = "merged_off_main"
C_QAS_POINTER = "qas_pointer"
C_BUDGET = "budget_reserved"
C_UNSYNCED = "events_unsynced"
C_REMOTE_EVENTS = "remote_events"
C_RAG_RECORDS = "rag_records"

CHECKS = (C_PROJECTION, C_STUCK_LEASE, C_LEAKED_LEASE, C_ORPHAN_WORKTREE, C_STALE_REG, C_ORPHAN_BRANCH,
          C_CORRUPT_WORKTREE, C_LOST_WORK, C_MERGED_OFF_MAIN, C_QAS_POINTER, C_BUDGET, C_UNSYNCED,
          C_REMOTE_EVENTS, C_RAG_RECORDS)

# Drift.status
S_REPAIRED = "repaired"
S_WOULD = "would_repair"     # dry run
S_DEFERRED = "deferred"      # needs a second sighting (live driver) or the remote is down
S_FROZEN = "frozen"          # newly frozen this pass
S_NOTED = "noted"            # accepted / informational (terminal run, already frozen, remote conflict)
S_FAILED = "failed"          # the repair raised

UNSETTLED = frozenset({S_REPAIRED, S_WOULD, S_DEFERRED, S_FROZEN, S_FAILED})

TARGET_DIR = "_target"       # same names as line.pipeline (not imported: pipeline imports a lot)
QAS_DIR = "_qas"
RUN_LEASE_PREFIX = "run:"
DEFAULT_UNSYNCED_S = 600
DEFAULT_INTERVAL_S = 300
REMOTE_SCAN_MAX = 20000


def _safe(s: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in s) or "_"


@dataclass
class Drift:
    check: str
    run: str
    unit: str = ""
    detail: Dict[str, Any] = field(default_factory=dict)
    status: str = ""
    action: str = ""

    def key(self) -> Tuple[str, str, str, str]:
        return (self.check, self.run, self.unit, json.dumps(self.detail.get("sig", ""), sort_keys=True, default=str))


@dataclass
class Report:
    dry_run: bool = False
    started_ms: int = 0
    ended_ms: int = 0
    runs: List[str] = field(default_factory=list)
    drifts: List[Drift] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)

    def by_status(self, *statuses: str) -> List[Drift]:
        return [d for d in self.drifts if d.status in statuses]

    @property
    def repaired(self) -> List[Drift]:
        return self.by_status(S_REPAIRED)

    @property
    def clean(self) -> bool:
        """Nothing but accepted (noted) drift."""
        return not self.by_status(*UNSETTLED) and not self.errors

    @property
    def converged(self) -> bool:
        """This pass changed nothing and has nothing left to do (dry run: would do nothing)."""
        return self.clean

    def summary(self) -> Dict[str, Any]:
        out: Dict[str, int] = {}
        for d in self.drifts:
            k = "%s:%s" % (d.check, d.status)
            out[k] = out.get(k, 0) + 1
        return {"runs": len(self.runs), "drifts": out, "errors": len(self.errors), "clean": self.clean}


# ------------------------------------------------------------------ git helpers


def _git(repo: str, *args: str, check: bool = False, timeout: float = 60) -> Any:
    from .ship._util import git
    try:
        return git(repo, *args, check=check, timeout=timeout)
    except LineError:
        if check:
            raise
        return None


def _git_ok(repo: str, *args: str) -> bool:
    cp = _git(repo, *args)
    return cp is not None and cp.returncode == 0


def _git_out(repo: str, *args: str) -> str:
    cp = _git(repo, *args)
    return cp.stdout.strip() if cp is not None and cp.returncode == 0 else ""


def _norm(p: str) -> str:
    """Comparable path: realpath resolves Windows 8.3 short names (git prints long names)."""
    return os.path.normcase(os.path.realpath(os.path.abspath(p)))


def _registered_worktrees(repo: str) -> Dict[str, Dict[str, str]]:
    """normcase path -> {"path", "head", "branch", "prunable"?} of `git worktree list --porcelain`."""
    out: Dict[str, Dict[str, str]] = {}
    cp = _git(repo, "worktree", "list", "--porcelain")
    if cp is None or cp.returncode != 0:
        return out
    cur: Dict[str, str] = {}
    for line in cp.stdout.splitlines() + [""]:
        if not line.strip():
            if cur.get("path"):
                out[_norm(cur["path"])] = cur
            cur = {}
            continue
        k, _, v = line.partition(" ")
        if k == "worktree":
            cur["path"] = v.strip()
        elif k in ("HEAD", "branch", "prunable"):
            cur[k.lower()] = v.strip() or "1"
    return out


def _worktree_ok(path: str) -> bool:
    """git recognises the directory as a work tree with a HEAD."""
    if not os.path.isdir(path):
        return False
    gitp = os.path.join(path, ".git")
    if not os.path.exists(gitp):
        return False
    return _git_ok(path, "rev-parse", "--verify", "-q", "HEAD")


def _rmtree(path: str) -> None:
    def onerr(fn: Any, p: str, exc: Any) -> None:
        try:
            os.chmod(p, 0o700)
            fn(p)
        except OSError:
            pass
    if os.path.isdir(path):
        shutil.rmtree(path, onerror=onerr)
    elif os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


# ------------------------------------------------------------------ projection


_UNIT_MILESTONE = {
    codes.UNIT_DISPATCHED: UnitState.LEASED.value,
    codes.UNIT_SUBMITTED: UnitState.SUBMITTED.value,
    codes.UNIT_BLOCKED: UnitState.WAITING.value,
    codes.UNIT_MERGED: UnitState.MERGED.value,
    codes.UNIT_REQUEUED: UnitState.READY.value,
}


def project_states(events: Iterable[Any]) -> Dict[str, Any]:
    """{"run": state, "closed": bool, "units": {unit: state}} from a run's events (unit.state "to",
    milestones, unit.requeued = ready). closed: the run's terminal event (escalated without unit /
    run.green) exists."""
    run_state, closed = "", False
    units: Dict[str, str] = {}
    for ev in events:
        body = ev.body or {}
        if ev.env.unit:
            if ev.kind == codes.UNIT_STATE and body.get("to"):
                units[ev.env.unit] = body["to"]
            elif ev.kind in _UNIT_MILESTONE:
                units[ev.env.unit] = _UNIT_MILESTONE[ev.kind]
            elif ev.kind == codes.ESCALATED:
                units[ev.env.unit] = UnitState.FAILED.value
            continue
        if ev.kind == codes.RUN_ADMITTED and not run_state:
            run_state = RunState.ADMITTED.value
        elif ev.kind == codes.RUN_STATE and body.get("to"):
            run_state = body["to"]
        elif ev.kind == codes.ESCALATED:
            run_state, closed = RunState.ESCALATED.value, True
        elif ev.kind == codes.RUN_GREEN:
            run_state, closed = RunState.GREEN.value, True
    return {"run": run_state, "closed": closed, "units": units}


def is_frozen(store: Any, run: str) -> bool:
    """Hook: True when the reconciler froze the run (run.detail.frozen non-empty)."""
    row = store.get(E_RUN, run) or {}
    return bool((row.get("detail") or {}).get("frozen"))


# ------------------------------------------------------------------ reconciler


class Reconciler:
    def __init__(self, store: Any, cfg: Any = None, *, rag: Any = None, records: Any = None,
                 log: Optional[Callable[[str], None]] = None, dry_run: bool = False,
                 unsynced_s: Optional[float] = None, lease_grace_s: Optional[float] = None,
                 deep_remote: bool = True, workroot: Optional[str] = None):
        if cfg is None:
            from .config import load_config
            cfg = load_config()
        self.store = store.raw if isinstance(store, ScopedStore) else store
        self.cfg = cfg
        self.rag = rag
        self.records = records
        self.log = log or (lambda m: None)
        self.dry_run = bool(dry_run)
        self.unsynced_s = float(unsynced_s if unsynced_s is not None
                                else getattr(cfg, "reconcile_unsynced_s", DEFAULT_UNSYNCED_S))
        self.lease_grace_s = float(lease_grace_s if lease_grace_s is not None
                                   else 2 * max(int(getattr(cfg, "watchdog_s", 15)), 1))
        self.deep_remote = deep_remote
        self.workroot = os.path.abspath(workroot or cfg.workroot)
        self.em = Emitter(self.store, getattr(cfg, "agent_version", "line-0.1"), "")
        self._seen: Set[Tuple[str, str, str, str]] = set()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.last: Optional[Report] = None

    # ------------------------------------------------------------ public

    def run_pass(self, run: Optional[str] = None, dry_run: Optional[bool] = None) -> Report:
        """One reconcile pass over one run or every run of the store (plus the global event checks)."""
        dry = self.dry_run if dry_run is None else bool(dry_run)
        with self._lock:
            rep = Report(dry_run=dry, started_ms=now_ms())
            self._rep = rep
            self._dry = dry
            self._next_seen: Set[Tuple[str, str, str, str]] = set()
            rows = [self.store.get(E_RUN, run)] if run else self.store.query(E_RUN)
            for row in rows:
                if not row or str(row.get("id", "")).startswith("_"):
                    continue
                rep.runs.append(row["id"])
                try:
                    self._run(row)
                except Exception as e:   # noqa: BLE001 - one bad run must not stop the pass
                    rep.errors.append({"run": row.get("id"), "error": "%s: %s" % (type(e).__name__, e)})
            try:
                self._events()
            except Exception as e:   # noqa: BLE001
                rep.errors.append({"run": "", "error": "events: %s: %s" % (type(e).__name__, e)})
            if not dry:
                self._seen = self._next_seen
            rep.ended_ms = now_ms()
            self.last = rep
            if rep.drifts or rep.errors:
                self.log("reconcile: %s" % json.dumps(rep.summary(), sort_keys=True))
            return rep

    def converge(self, max_passes: int = 2, run: Optional[str] = None) -> List[Report]:
        """Passes until one is clean (or max_passes). The last report tells whether it converged."""
        out = []
        for _ in range(max(int(max_passes), 1)):
            rep = self.run_pass(run)
            out.append(rep)
            if rep.clean:
                break
        return out

    def start(self, interval_s: Optional[float] = None) -> "Reconciler":
        iv = float(interval_s if interval_s is not None else getattr(self.cfg, "reconcile_s", DEFAULT_INTERVAL_S))
        self._stop.clear()

        def loop() -> None:
            while not self._stop.wait(iv):
                try:
                    self.run_pass()
                except Exception as e:   # noqa: BLE001 - keep the thread alive
                    self.log("reconcile pass failed: %s" % e)

        self._thread = threading.Thread(target=loop, name="line-reconciler", daemon=True)
        self._thread.start()
        return self

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout)
        self._thread = None

    # ------------------------------------------------------------ bookkeeping

    def _drift(self, check: str, run: str, unit: str = "", **detail: Any) -> Drift:
        d = Drift(check, run, unit, dict(detail))
        self._rep.drifts.append(d)
        return d

    def _confirmed(self, d: Drift, live: bool) -> bool:
        """With a live driver a racy repair needs the same drift seen by the previous pass."""
        if not live:
            return True
        k = d.key()
        self._next_seen.add(k)
        return k in self._seen

    def _apply(self, d: Drift, action: str, fn: Optional[Callable[[], Any]] = None, *, live: bool = False,
               racy: bool = False, closed: bool = False, event: bool = True) -> bool:
        """Run one repair (or record what it would do). Emits reconcile.repaired on success."""
        d.action = action
        if self._dry:
            d.status = S_WOULD
            return False
        if racy and not self._confirmed(d, live):
            d.status = S_DEFERRED
            return False
        try:
            if fn is not None:
                fn()
        except Exception as e:   # noqa: BLE001
            d.status = S_FAILED
            d.detail["error"] = "%s: %s" % (type(e).__name__, e)
            return False
        d.status = S_REPAIRED
        if event:
            body = {"check": d.check, "action": action, "detail": _jsonable(d.detail)}
            if d.unit:
                body["unit"] = d.unit
            self._event(d.run, closed, RECONCILE_REPAIRED, body)
        return True

    def _event(self, run: str, closed: bool, kind: str, body: Dict[str, Any]) -> None:
        """On the run while it is open, else on the system run with body.run."""
        try:
            if run and not closed:
                self.em.run_event(run, kind, body)
            else:
                self.store.emit(kind, Envelope(run=SYSTEM_RUN, agent_version=self.em.agent_version),
                                dict(body, run=run))
        except LineError as e:
            self._rep.errors.append({"run": run, "error": "emit %s: %s" % (kind, e.code)})

    def _freeze(self, d: Drift, reason: str, row: Dict[str, Any], closed: bool) -> None:
        run = d.run
        d.action = "freeze"
        frozen = dict(((row.get("detail") or {}).get("frozen")) or {})
        if d.check in frozen or closed or row.get("state") in TERMINAL_RUN_STATES:
            d.status = S_NOTED
            return
        if self._dry:
            d.status = S_WOULD
            return
        from .statemachine import update_row
        cur = self.store.get(E_RUN, run) or {}
        fz = dict(((cur.get("detail") or {}).get("frozen")) or {})
        fz[d.check] = {"reason": reason, "ts_ms": now_ms(), "detail": _jsonable(d.detail)}
        update_row(self.store, E_RUN, run, {"detail": dict(cur.get("detail") or {}, frozen=fz)})
        d.status = S_FROZEN
        self._event(run, closed, RECONCILE_FROZEN, {"check": d.check, "reason": reason,
                                                     "detail": _jsonable(d.detail)})

    # ------------------------------------------------------------ leases

    def _lease_row(self, name: str) -> Optional[Dict[str, Any]]:
        rd = getattr(self.store, "_read", None)
        if rd is None:
            cur = getattr(self.store, "leases", None)
            lease = cur.current(name) if cur is not None else None
            return None if lease is None else {"name": name, "epoch": lease.epoch, "expires_ms": lease.expires_ms,
                                               "owner": lease.owner, "state": "live"}
        with rd() as c:
            r = c.execute("SELECT * FROM lease WHERE name=?", (name,)).fetchone()
            return dict(r) if r is not None else None

    def _lease_rows(self, prefix: str) -> List[Dict[str, Any]]:
        rd = getattr(self.store, "_read", None)
        if rd is None:
            return []
        with rd() as c:
            rows = c.execute("SELECT * FROM lease WHERE name LIKE ? ESCAPE '\\'",
                             (prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%",)).fetchall()
            return [dict(r) for r in rows]

    def _now(self) -> int:
        clock = getattr(self.store, "clock", None)
        return int(clock.now_ms()) if clock is not None else now_ms()

    def _live(self, r: Optional[Dict[str, Any]]) -> bool:
        return bool(r) and r.get("state") == "live" and int(r.get("expires_ms", 0)) > self._now()

    def _leases(self) -> Any:
        from .lease import SqliteLeases
        lm = getattr(self.store, "leases", None)
        return lm if lm is not None else SqliteLeases(self.store)

    # ------------------------------------------------------------ one run

    def _run(self, row: Dict[str, Any]) -> None:
        run = row["id"]
        evs = self.store.events_after(0, run=run, limit=10 ** 9)
        proj = project_states(evs)
        live = self._live(self._lease_row(RUN_LEASE_PREFIX + run))
        ctx = {"row": row, "run": run, "proj": proj, "live": live, "closed": proj["closed"],
               "terminal": row.get("state") in TERMINAL_RUN_STATES,
               "sst": ScopedStore(self.store, run)}
        self._projection(ctx)
        ctx["row"] = self.store.get(E_RUN, run) or row
        ctx["closed"] = project_states(self.store.events_after(0, run=run, limit=10 ** 9))["closed"] \
            if not self._dry else ctx["closed"]
        self._unit_leases(ctx)
        self._worktrees(ctx)
        self._main(ctx)
        self._qas(ctx)
        self._budget(ctx)
        if self.records is not None:
            self._records(ctx)

    def _units(self, run: str) -> List[Dict[str, Any]]:
        return self.store.query(E_UNIT, run=run)

    def _sm(self, ctx: Dict[str, Any]) -> Any:
        from .statemachine import StateMachine
        return StateMachine(ctx["sst"], self.em.agent_version, "")

    def _requeue(self, ctx: Dict[str, Any], uid: str, frm: str, code: str, why: str) -> None:
        self._sm(ctx).advance_unit(uid, UnitState.READY, frm, code=code,
                                   extra=[(codes.UNIT_REQUEUED, {"code": code, "from": frm, "why": why,
                                                                "reconciled": True})])

    # ------------------------------------------------------------ projection

    def _projection(self, ctx: Dict[str, Any]) -> None:
        run, row, proj, live = ctx["run"], ctx["row"], ctx["proj"], ctx["live"]
        closed = ctx["closed"]
        for u in self._units(run):
            uid, st = u["id"], u.get("state", "")
            pst = proj["units"].get(uid, "") or UnitState.PENDING.value
            if pst == st:
                continue
            d = self._drift(C_PROJECTION, run, uid, store=st, events=pst, sig=[st, pst, u.get("attempt", 0)])
            if closed:
                d.status = S_NOTED          # the run's log is closed: nothing may follow its terminal event
                continue
            if st in (UnitState.SUBMITTED.value, UnitState.WAITING.value) and pst == UnitState.LEASED.value:
                self._apply(d, "requeue", lambda uid=uid, st=st: self._requeue(
                    ctx, uid, st, codes.LEASE_LOST, "%s not in the event log (fenced write refused)" % st),
                    live=live, racy=True, closed=closed, event=True)
            else:
                def catch_up(u=u, pst=pst, st=st) -> None:
                    self.em.unit_event(u, codes.UNIT_STATE, {"from": pst, "to": st, "reconciled": True}, epoch=0)
                self._apply(d, "catch_up_event", catch_up, live=live, racy=True, closed=closed)
        st, pst = row.get("state", ""), proj["run"]
        if st != pst and not closed:
            d = self._drift(C_PROJECTION, run, store=st, events=pst, sig=[st, pst])

            def catch_up_run(st=st, pst=pst) -> None:
                self.em.run_event(run, codes.RUN_STATE, {"from": pst, "to": st, "reconciled": True})
                if st == RunState.ESCALATED.value:
                    esc = dict((row.get("detail") or {}).get("escalation") or {})
                    esc.setdefault("code", codes.NO_PROGRESS)
                    esc.setdefault("message", "escalated (reconciled)")
                    esc.update(run=run, reconciled=True)
                    self.em.run_event(run, codes.ESCALATED, esc)
                elif st == RunState.GREEN.value:
                    self.em.run_event(run, codes.RUN_GREEN, {"reconciled": True})
            # the terminal catch-up closes the log: reconcile.repaired then goes to the system run
            ok = self._apply(d, "catch_up_event", catch_up_run, live=live, racy=True, closed=closed, event=False)
            if ok:
                self._event(run, st in TERMINAL_RUN_STATES, RECONCILE_REPAIRED,
                            {"check": d.check, "action": d.action, "detail": _jsonable(d.detail)})

    # ------------------------------------------------------------ leases

    def _unit_leases(self, ctx: Dict[str, Any]) -> None:
        run, live, closed = ctx["run"], ctx["live"], ctx["closed"]
        terminal = ctx["terminal"] or ctx["row"].get("state") in TERMINAL_RUN_STATES
        prefix = unit_lease_name(run + ":")
        if terminal:
            for r in self._lease_rows(prefix):
                if not self._live(r):
                    continue
                uid = r["name"][len(prefix):]
                d = self._drift(C_LEAKED_LEASE, run, uid, name=r["name"], epoch=r["epoch"])
                lease = _lease_of(r)
                self._apply(d, "release", lambda lease=lease: self._leases().release(lease), closed=closed)
            return
        now = self._now()
        for u in self._units(run):
            if u.get("state") != UnitState.LEASED.value:
                continue
            uid = u["id"]
            name = unit_lease_name("%s:%s" % (run, uid))
            r = self._lease_row(name) or self._lease_row(unit_lease_name(uid))
            if self._live(r):
                continue
            if r is not None and r.get("state") == "live":
                # expired, not reaped yet: the live driver's watchdog requeues it; else after the grace
                if live or now - int(r.get("expires_ms", 0)) < 1000 * self.lease_grace_s:
                    continue
            d = self._drift(C_STUCK_LEASE, run, uid, lease=(r or {}).get("state", "absent"),
                            epoch=(r or {}).get("epoch", 0), unit_epoch=u.get("epoch", 0))

            def fix(uid=uid, r=r) -> None:
                if r is not None and r.get("state") == "live":
                    self._leases().reap(_lease_of(r))
                self._requeue(ctx, uid, UnitState.LEASED.value, codes.LEASE_LOST, "stuck: lease %s"
                              % ((r or {}).get("state", "absent")))
            d.detail["sig"] = [(r or {}).get("state", "absent"), (r or {}).get("epoch", 0), u.get("attempt", 0)]
            self._apply(d, "requeue", fix, live=live, racy=True, closed=closed)

    # ------------------------------------------------------------ worktrees / branches

    def _repo(self, row: Dict[str, Any]) -> str:
        t = str((row.get("detail") or {}).get("target") or "")
        if t and os.path.isdir(os.path.join(t, ".git")):
            return t
        fresh = os.path.join(self.workroot, _safe(row["id"]), TARGET_DIR)
        return fresh if os.path.isdir(os.path.join(fresh, ".git")) else ""

    def _remove_worktree(self, repo: str, path: str) -> None:
        if repo and os.path.isdir(path):
            _git(repo, "worktree", "remove", "--force", path)
        _rmtree(path)
        if repo:
            _git(repo, "worktree", "prune")

    def _worktrees(self, ctx: Dict[str, Any]) -> None:
        run, row, live, closed = ctx["run"], ctx["row"], ctx["live"], ctx["closed"]
        state = row.get("state")
        repo = self._repo(row)
        rdir = os.path.join(self.workroot, _safe(run))
        units = {u["id"]: u for u in self._units(run)}
        by_dir = {_safe(uid): u for uid, u in units.items()}
        reg = _registered_worktrees(repo) if repo else {}
        # registrations whose directory is gone (only ours: under the run dir or merge/<run>)
        mine = (_norm(rdir) + os.sep, _norm(os.path.join(self.workroot, "merge", _safe(run))))
        stale = [p for p, w in reg.items() if (p.startswith(mine[0]) or p == mine[1]) and not os.path.isdir(w["path"])]
        if stale:
            d = self._drift(C_STALE_REG, run, paths=sorted(stale))
            self._apply(d, "prune", lambda: _git(repo, "worktree", "prune"), closed=closed)
        # unit worktree directories
        handled: Set[str] = set()
        if os.path.isdir(rdir):
            for name in sorted(os.listdir(rdir)):
                path = os.path.join(rdir, name)
                if name in (TARGET_DIR, QAS_DIR) or not os.path.isdir(path):
                    continue
                u = by_dir.get(name)
                ust = (u or {}).get("state", "")
                orphan = (u is None or ust == UnitState.MERGED.value or state == RunState.GREEN.value)
                if orphan:
                    d = self._drift(C_ORPHAN_WORKTREE, run, (u or {}).get("id", name), path=path,
                                    unit_state=ust or "unknown")
                    self._apply(d, "remove", lambda path=path: self._remove_worktree(repo, path), closed=closed)
                    continue
                if state in TERMINAL_RUN_STATES:
                    continue                  # escalated run: unfinished worktrees are evidence
                if _worktree_ok(path) and (not repo or _norm(path) in reg):
                    continue
                uid = u["id"]
                handled.add(uid)
                d = self._drift(C_CORRUPT_WORKTREE, run, uid, path=path, unit_state=ust,
                                registered=_norm(path) in reg, sig=[ust, int(u.get("attempt", 0))])
                if ust == UnitState.LEASED.value and live:
                    d.status, d.action = S_NOTED, "left to the builder / verifier of the live driver"
                    continue

                def fix(uid=uid, ust=ust, path=path) -> None:
                    self._remove_worktree(repo, path)
                    if ust == UnitState.SUBMITTED.value:
                        self._requeue(ctx, uid, ust, codes.NOT_FOUND, "corrupt worktree: unverified work lost")
                self._apply(d, "remove" + ("+requeue" if ust == UnitState.SUBMITTED.value else ""), fix,
                            live=live, racy=True, closed=closed)
        # integration worktree of the merge queue
        mpath = os.path.join(self.workroot, "merge", _safe(run))
        if state in TERMINAL_RUN_STATES and os.path.isdir(mpath):
            d = self._drift(C_ORPHAN_WORKTREE, run, "", path=mpath, unit_state="integration")
            self._apply(d, "remove", lambda: self._remove_worktree(repo, mpath), closed=closed)
        if state not in TERMINAL_RUN_STATES:
            # units that need their work but lost it (rows read again: the checks above may have moved them)
            for u in self._units(run):
                uid, ust = u["id"], u.get("state")
                if uid in handled:
                    continue
                path = u.get("worktree") or os.path.join(rdir, _safe(uid))
                if ust == UnitState.SUBMITTED.value and not os.path.isdir(path):
                    d = self._drift(C_LOST_WORK, run, uid, path=path, unit_state=ust, sig=[ust, u.get("attempt", 0)])
                    self._apply(d, "requeue", lambda uid=uid: self._requeue(
                        ctx, uid, UnitState.SUBMITTED.value, codes.NOT_FOUND, "worktree gone: unverified work lost"),
                        live=live, racy=True, closed=closed)
                elif ust == UnitState.VERIFIED.value and repo and not self._has_head(repo, run, u):
                    d = self._drift(C_LOST_WORK, run, uid, unit_state=ust, sig=[ust, u.get("attempt", 0)])
                    self._apply(d, "requeue", lambda uid=uid: self._requeue(
                        ctx, uid, UnitState.VERIFIED.value, codes.NOT_FOUND, "verified head commit and branch gone"),
                        live=live, racy=True, closed=closed)
        # branches of units the store does not know
        if repo:
            pre = "refs/heads/line/%s/" % _safe(run)
            for ref in _git_out(repo, "for-each-ref", "--format=%(refname)", pre).splitlines():
                name = ref[len(pre):]
                if not name or name in by_dir:
                    continue
                d = self._drift(C_ORPHAN_BRANCH, run, name, ref=ref)

                def drop(ref=ref, name=name) -> None:
                    _git(repo, "update-ref", "-d", ref)
                    _git(repo, "update-ref", "-d", "refs/line-base/%s/%s" % (_safe(run), name))
                self._apply(d, "delete", drop, closed=closed)

    def _has_head(self, repo: str, run: str, u: Dict[str, Any]) -> bool:
        detail = u.get("detail") or {}
        for ref in (detail.get("branch"), detail.get("head"), "line/%s/%s" % (_safe(run), _safe(u["id"]))):
            if ref and _git_ok(repo, "rev-parse", "--verify", "-q", "%s^{commit}" % ref):
                return True
        wt = u.get("worktree") or ""
        return bool(wt) and _worktree_ok(wt)

    # ------------------------------------------------------------ main

    def _main(self, ctx: Dict[str, Any]) -> None:
        run, row, closed = ctx["run"], ctx["row"], ctx["closed"]
        repo = self._repo(row)
        if not repo:
            return
        main = _git_out(repo, "rev-parse", "--verify", "-q", "refs/heads/main")
        if not main:
            return
        want: Dict[str, str] = {}
        tc = str((row.get("detail") or {}).get("tests_commit") or "")
        if tc:
            want["tests"] = tc
        for u in self._units(run):
            if u.get("state") == UnitState.MERGED.value:
                sha = str((u.get("detail") or {}).get("merged_sha") or "")
                if sha:
                    want[u["id"]] = sha
        off = {k: s for k, s in want.items() if not _git_ok(repo, "merge-base", "--is-ancestor", s, main)}
        if not off:
            return
        d = self._drift(C_MERGED_OFF_MAIN, run, ",".join(sorted(off)), main=main, missing=off)
        known = {k: s for k, s in off.items() if _git_ok(repo, "cat-file", "-e", "%s^{commit}" % s)}
        tip = ""
        if len(known) == len(off):
            for s in set(known.values()):
                if all(_git_ok(repo, "merge-base", "--is-ancestor", o, s) for o in known.values()):
                    tip = s
                    break
        clean = not _git_out(repo, "status", "--porcelain", "--untracked-files=no")
        on_main = _git_out(repo, "symbolic-ref", "-q", "HEAD") == "refs/heads/main"
        if tip and _git_ok(repo, "merge-base", "--is-ancestor", main, tip) and (clean or not on_main):
            def ff() -> None:
                if on_main:
                    _git(repo, "merge", "--ff-only", "-q", tip, check=True)
                else:
                    _git(repo, "update-ref", "refs/heads/main", tip, main, check=True)
            d.detail["tip"] = tip
            self._apply(d, "fast_forward_main", ff, closed=closed)
            return
        self._freeze(d, "merged work is not on main and main cannot be fast-forwarded to it", row, closed)

    # ------------------------------------------------------------ QAS pointer

    def _qas(self, ctx: Dict[str, Any]) -> None:
        from .ship.deploy import COLORS, Deployer, other_color, qas_lock, read_current, write_current
        run, row, closed = ctx["run"], ctx["row"], ctx["closed"]
        qas_root = os.path.join(self.workroot, _safe(run), QAS_DIR)
        ptr_path = os.path.join(qas_root, "current")
        if not os.path.isfile(ptr_path):
            return
        cur = read_current(qas_root)
        color = (cur or {}).get("color", "")

        def populated(c: str) -> bool:
            p = os.path.join(qas_root, c)
            return os.path.isdir(p) and bool(os.listdir(p))

        if cur is not None and populated(color):
            return
        repo = self._repo(row)
        sha = str((cur or {}).get("sha") or "")
        d = self._drift(C_QAS_POINTER, run, color=color or "?", sha=sha, pointer_valid=cur is not None)
        have_sha = bool(repo and sha and _git_ok(repo, "cat-file", "-e", "%s^{commit}" % sha))
        if cur is not None and have_sha:
            def export() -> None:
                with qas_lock(qas_root, "reconciler"):
                    Deployer(self.store, repo, self.cfg, qas_root=qas_root)._export(sha, os.path.join(qas_root, color))
            self._apply(d, "export_again", export, closed=closed)
            return
        other = other_color(color) if color in COLORS else ""
        alt = [c for c in COLORS if populated(c)]
        if other and populated(other) or (cur is None and alt):
            to = other if other and populated(other) else alt[0]

            def switch() -> None:
                with qas_lock(qas_root, "reconciler"):
                    write_current(qas_root, {"color": to, "sha": "", "run": run, "ts_ms": now_ms(),
                                             "reconciled": True})
            d.detail["to"] = to
            self._apply(d, "switch_pointer", switch, closed=closed)
            return
        self._freeze(d, "QAS pointer names a missing directory and nothing can be restored", row, closed)

    # ------------------------------------------------------------ budget

    def _budget(self, ctx: Dict[str, Any]) -> None:
        run, row, closed = ctx["run"], ctx["row"], ctx["closed"]
        rd = getattr(self.store, "_read", None)
        if rd is None:
            return
        with rd() as c:
            nodes = {r["node"]: dict(r) for r in c.execute("SELECT * FROM budget_node WHERE run=?", (run,))}
            res = [dict(r) for r in c.execute("SELECT * FROM budget_res WHERE run=?", (run,))]
        if not nodes:
            return
        units = {u["id"]: u.get("state") for u in self._units(run)}
        terminal = row.get("state") in TERMINAL_RUN_STATES
        done = {UnitState.MERGED.value, UnitState.FAILED.value}
        from .budget import SqliteBudget
        b = SqliteBudget(self.store, emit=False)
        for r in res:
            if terminal or units.get(r["node"]) in done:
                d = self._drift(C_BUDGET, run, r["node"] if r["node"] in units else "", reservation="r%d" % r["id"],
                                node=r["node"], usd=r["usd"], why="run %s" % row.get("state") if terminal
                                else "unit %s" % units.get(r["node"]))
                self._apply(d, "release", lambda rid="r%d" % r["id"]: b.release(run, rid), closed=closed)
        # reserved column vs the open reservations (a reservation counts on its node and every ancestor)
        if self._dry:
            res_left = [r for r in res if not (terminal or units.get(r["node"]) in done)]
        else:
            with rd() as c:
                res_left = [dict(r) for r in c.execute("SELECT * FROM budget_res WHERE run=?", (run,))]
        want = {n: 0.0 for n in nodes}
        for r in res_left:
            n, seen = r["node"], set()
            while n and n in nodes and n not in seen:
                seen.add(n)
                want[n] += float(r["usd"])
                n = nodes[n]["parent"]
        if not self._dry:
            with rd() as c:
                nodes = {r["node"]: dict(r) for r in c.execute("SELECT * FROM budget_node WHERE run=?", (run,))}
        bad = {n: (round(nodes[n]["reserved"], 9), round(w, 9)) for n, w in want.items()
               if abs(float(nodes[n]["reserved"]) - w) > 1e-9}
        if bad:
            d = self._drift(C_BUDGET, run, "", nodes={n: {"reserved": a, "open": w} for n, (a, w) in bad.items()})

            def recompute() -> None:
                with self.store.tx() as c:
                    for n, (_, w) in bad.items():
                        c.execute("UPDATE budget_node SET reserved=? WHERE run=? AND node=?", (w, run, n))
            self._apply(d, "recompute_reserved", recompute, closed=closed)

    # ------------------------------------------------------------ RAG records

    def _records(self, ctx: Dict[str, Any]) -> None:
        run, closed = ctx["run"], ctx["closed"]
        try:
            behind = self.records.behind(run)
        except Exception as e:   # noqa: BLE001
            self._rep.errors.append({"run": run, "error": "records: %s" % e})
            return
        for item in behind:
            d = self._drift(C_RAG_RECORDS, run, item.get("unit", ""),
                            **{k: v for k, v in item.items() if k != "unit"})
            if item.get("conflict"):
                d.status, d.action = S_NOTED, "remote newer than the store (another writer)"
                continue

            def push(item=item) -> None:
                r = self.records.push(item["entity"], item["key"])
                if r.status in ("error", "conflict"):
                    raise LineError(codes.VERSION_CONFLICT if r.status == "conflict" else codes.RAG_DEGRADED,
                                    "record push %s" % r.status, {"key": item["key"]})
            self._apply(d, "push", push, closed=closed)

    # ------------------------------------------------------------ events / outbox (global)

    def _remote(self) -> bool:
        return self.rag is not None and hasattr(self.rag, "remote") and hasattr(self.rag, "probe")

    def _events(self) -> None:
        if not self._remote():
            return
        rag = self.rag
        now = self._now()
        old = [e for e in self.store.unsynced(1) if now - int(e.ts_ms or 0) >= 1000 * self.unsynced_s]
        outbox = self.store.outbox_peek(1)
        if old or outbox:
            d = self._drift(C_UNSYNCED, "", oldest_seq=old[0].seq if old else 0, outbox=bool(outbox),
                            degraded=list(rag.degraded()))

            def sync() -> None:
                rag.probe()
                for _ in range(1000):
                    if not rag.sync_events():
                        break
                if rag.degraded() and (self.store.outbox_peek(1) or self.store.unsynced(1)):
                    raise LineError(codes.RAG_DEGRADED, "remote still degraded: %s" % rag.degraded())
            self._apply(d, "probe+sync", sync, closed=True)
            if d.status == S_FAILED and "RAG_DEGRADED" in d.detail.get("error", ""):
                d.status = S_DEFERRED          # degraded mode is expected: next pass tries again
        if self.deep_remote and not self._dry and rag.is_live("events") and not rag.degraded():
            self._remote_events()
        if not self._dry and not rag.degraded():
            try:                                   # push this pass's own reconcile events too
                rag.sync_events()
            except Exception:   # noqa: BLE001
                pass

    def _remote_events(self) -> None:
        from .rag.http_adapter import batch_key, wire_event_id
        have: Set[str] = set()
        cursor, pages = 0, 0
        while pages * 500 < REMOTE_SCAN_MAX:
            page = self.rag.events_after(cursor, 500)
            pages += 1
            if not page:
                break
            for e in page:
                have.add(str(e.get("id") or wire_event_id(e)))
            nxt = max(int(e.get("remote_seq") or e.get("seq") or 0) for e in page)
            if nxt <= cursor or len(page) < 500:
                break
            cursor = nxt
        missing = []
        last = 0
        while True:
            evs = self.store.events_after(last, limit=1000)
            if not evs:
                break
            last = evs[-1].seq
            for ev in evs:
                if ev.synced:
                    w = to_dict(ev)
                    if wire_event_id(w) not in have:
                        missing.append(w)
        if not missing:
            return
        d = self._drift(C_REMOTE_EVENTS, "", count=len(missing), first=missing[0]["seq"], last=missing[-1]["seq"])

        def resend() -> None:
            for i in range(0, len(missing), 200):
                chunk = missing[i:i + 200]
                ids = [wire_event_id(e) for e in chunk]
                self.rag.append_events(chunk, "rc-" + batch_key(ids, chunk[0]["seq"], chunk[-1]["seq"]))
        self._apply(d, "append_again", resend, closed=True)


def _lease_of(r: Dict[str, Any]) -> Any:
    from .contracts import Lease
    return Lease(r["name"], int(r["epoch"]), int(r["expires_ms"]), r.get("owner", ""))


def _jsonable(x: Any) -> Any:
    return json.loads(json.dumps(x, default=str))


# ------------------------------------------------------------------ hooks for the integrator


def enabled(cfg: Any) -> bool:
    """Config flag `reconcile` (proposed LINE_RECONCILE, default False)."""
    return bool(getattr(cfg, "reconcile", False))


def on_server_start(store: Any, cfg: Any, rag: Any = None, log: Optional[Callable[[str], None]] = None
                    ) -> Optional[Reconciler]:
    """line.server start (after the driver is made): start the periodic reconciler when cfg.reconcile is on
    (every cfg.reconcile_s, dry run with cfg.reconcile_dry_run). Returns it (call .stop() at shutdown) or None."""
    if not enabled(cfg):
        return None
    rc = Reconciler(store, cfg, rag=rag, log=log, dry_run=bool(getattr(cfg, "reconcile_dry_run", False)))
    return rc.start()


def on_before_drive(store: Any, cfg: Any, run: str, rag: Any = None,
                    log: Optional[Callable[[str], None]] = None) -> Optional[Report]:
    """Pipeline.drive(), after _setup and before _hold_run_lease, for a run that is being RESUMED: one pass
    on that run so the new driver starts from repaired state. No-op (None) unless cfg.reconcile is on.
    The driver may then refuse a frozen run (is_frozen)."""
    if not enabled(cfg):
        return None
    return Reconciler(store, cfg, rag=rag, log=log, dry_run=bool(getattr(cfg, "reconcile_dry_run", False))
                      ).run_pass(run=run)


__all__ = ["Reconciler", "Report", "Drift", "project_states", "is_frozen", "enabled", "on_server_start",
           "on_before_drive", "RECONCILE_REPAIRED", "RECONCILE_FROZEN", "NEW_EVENT_KINDS", "CHECKS", "SYSTEM_RUN"]
