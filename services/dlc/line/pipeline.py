"""The line end to end: one spec pack in, verified code on a dev QAS slot out, or a clean escalation.

    from line.pipeline import Pipeline, make_driver
    p = Pipeline(store, cfg)                 # optional: rag=, llm=, on_stage=, case_runner=, smoke_cmd=
    run = p.admit(pack_dir, target="")        # run.admitted (target "" -> fresh git repo under workroot)
    row = p.drive(run)                        # blocks until green or escalated; returns the run row

drive(run) chains the slices; the pipeline alone moves the RUN state and emits run-level
`escalated` (slices escalate units, never runs):

  admitted -> understanding   target repo ready; ingest + freeze (spec.frozen); readers A/B,
                              quote check, reconcile, targeted re-read (reconcile.diverged,
                              digest.done); test author + check (red on empty, traced, locked:
                              tests.approved); the approved tests are committed on main
  -> planning                 planner + graph validation (graph.valid); budget tree split
  -> building                 scheduler.next_ready -> dispatch (lease, worktree) -> builder
                              (agentic, heartbeat) -> verifier (gate + retry ladder) in up to
                              max_parallel_units threads; verified work is committed on the unit
                              branch line/<run>/<unit> and goes through the merge queue (rebase,
                              acceptance, ff main) while other units build
  -> integrating              every unit merged, queue drained
  -> qas                      deploy main to the idle QAS color (deploy windows from config),
                              smoke, switch; QAS runner x qas_repeats; flaky -> quarantine report;
                              red F-item -> fixer unit -> back to building (<= fixer_generations)
  -> green (run.green) | escalated (escalated {code, message, detail})

Per run: unit ids are scoped in the store and in lease names (line.scope); the budget tree is
opened from LINE_MAX_USD_RUN; a watchdog thread requeues units whose lease expired; the RAG port
(make_rag) gets the event log through sync_events() and run-level rag.degraded / rag.restored
mirror its capability state. Leases are local in this MVP (fencing lives in the store's lease
table) whatever authority the RAG port reports at admission.

Failure handling in the build loop (ladder rungs: 0 retry with evidence, 1 model_alt, 2 escalate):
  verify failed         verifier.verify applies the ladder
  BLOCKED / LLM error   watchdog.record_failure(code BLOCKED | LLM_ERROR) applies the same ladder
                        (one failure history per unit, unit.detail.failures: <= retry_n per rung)
  merge conflict        merge queue sends the unit back; record_failure(MERGE_CONFLICT)
  lease lost            the unit goes back to ready (LEASE_LOST); the watchdog does the same on expiry
  a unit failed         no new dispatch; once nothing is in flight the run is escalated with that code

Resume: drive() takes any non-final run. One driver per run (lease run:<id>, renewed every
heartbeat_s; a crashed driver's lease runs out after lease_ttl_s). Each stage reuses what is
persisted: frozen pack (run.spec_hash), reconciled digest (<run>:R), locked tests committed on main
(run.detail.tests_commit; locked but uncommitted ones are committed after a sha check, half-written
ones dropped and authored again), graph + units, budget split, merged units. Units mid-flight:
leased with no / expired lease -> ready (LEASE_LOST, not a ladder failure; a live lease of the dead
driver is left to the watchdog), submitted -> verified again, verified -> committed + queued,
waiting -> the BLOCKED ladder step. integrating / qas with every unit merged go straight on.
`python -m line.cli resume <run>`; the server resumes every non-final run at start with
LINE_AUTO_RESUME=1 or `serve --resume` (driver action "resume_all").

Cancel (line.cancel): one CancelToken per pipeline. The build / merge loops and every builder
thread check it between steps; builder threads, the verifier and the watchdog write through a
GuardedStore. Before the terminal event drive() joins the builder threads (cfg.cancel_join_s),
stops the watchdog and closes the guard, so no worker event can follow escalated / run.green.

make_driver(store, cfg) is the server's POST /api/runs and /api/runs/{id}:cancel.
"""

from __future__ import annotations

import concurrent.futures as cf
import dataclasses
import hashlib
import json
import os
import re
import threading
import time
import traceback
import types
import uuid
from typing import Any, Callable, Dict, List, Optional, Sequence

from . import agents_dir, codes, observe, rag_state, reconciler, stacks
from . import hooks as run_hooks
from . import understand_plus as uplus
from .budget import SqliteBudget, size_weights
from .cancel import Cancelled, CancelToken, GuardedStore
from .build import dispatch, next_ready, plan, run_builder, verify
from .build.sandbox import Sandbox
from .codes import LineError
from .config import Config, load_config
from .contracts import (
    E_ACC_TEST, E_DIGEST, E_ESCALATION, E_FGRAPH, E_GRAPH, E_MERGE, E_MIGRATION, E_PACK, E_RUN, E_UNIT,
    TERMINAL_RUN_STATES,
    AccTest,
    Digest, Graph, LeaseAuthority, PackVersion, Run, RunState, UnitState, from_dict, now_ms, to_dict,
    unit_lease_name,
)
from .lease import Heartbeat as LeaseHeartbeat, SqliteLeases
from .llm import make_llm
from .rag import make_rag
from .scope import ScopedLeases, ScopedStore
from .seal import wire as seal_wire
from .ship._util import git, git_out
from .ship.deploy import Deployer
from .ship.fixer import Fixer
from .ship import merger
from .ship.merge_queue import MergeQueue
from .ship.qas_runner import QasRunner, default_case_runner
from .statemachine import StateMachine, update_row
from .understand import author_tests, check_tests, ingest, understand
from .learn import hooks as learn_hooks, setting as learn_setting
from .review import Ctx as ReviewCtx
from .review import drift, judge, reviewer
from .understand.test_author import TEST_DIR
from .watchdog import Watchdog

LOOP_WAIT_S = 0.25
SYNC_EVERY_S = 1.0
WINDOW_POLL_S = 30.0
TARGET_DIR = "_target"
QAS_DIR = "_qas"
GITIGNORE = "__pycache__/\n*.pyc\n.pytest_cache/\n"
RUN_LEASE_PREFIX = "run:"
#: a repo-relative file named in a test (an import, a path in a string): it holds code the test exercises
_NAMED_FILE = re.compile(r"""['"`]((?:\./)?[\w][\w./-]*\.(?:py|js|jsx|mjs|cjs|ts|tsx|json|css|html))['"`]""")
#: the same, built from quoted parts: os.path.join(ROOT, "NotesApp", "client", "x.js") or ROOT / "NotesApp" / "x.js"
_JOINED_FILE = re.compile(r"""(?:['"][\w.-]+['"]\s*[,/]\s*)+['"][\w.-]+\.(?:py|js|jsx|mjs|cjs|ts|tsx|json|css|html)['"]""")
UPLUS_MAX_ROUNDS = 3       # addendum re-freezes per drive (each one re-reads the spec)


class Parked(Exception):
    """The run waits for people (open questions): drive() returns without a terminal event."""


class Escalate(Exception):
    def __init__(self, code: str, message: str = "", detail: Optional[Dict[str, Any]] = None):
        super().__init__(message or code)
        self.code, self.message, self.detail = code, message or code, dict(detail or {})


def drop_hook_hold(store: Any, run: str) -> None:
    """A stopped run (cancel, pause, urgent stop) is no longer held by a hook: its hold goes, so the run view
    and the project card do not keep offering the hook's pass. A resume asks the hook again."""
    detail = dict((store.get(E_RUN, run) or {}).get("detail") or {})
    if detail.pop("hook_hold", None) is not None:
        update_row(store, E_RUN, run, {"detail": detail})


def new_run_id() -> str:
    return "R%s-%s" % (time.strftime("%Y%m%d-%H%M%S"), uuid.uuid4().hex[:4])


def _safe(s: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in s) or "_"


def init_target(path: str) -> str:
    """A fresh git repository on branch main with one commit (.gitignore, README.md)."""
    os.makedirs(path, exist_ok=True)
    git(path, "init", "-q")
    git(path, "symbolic-ref", "HEAD", "refs/heads/main")
    with open(os.path.join(path, ".gitignore"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(GITIGNORE)
    with open(os.path.join(path, "README.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("# Target repository\n\nBuilt by the SDLC line.\n")
    git(path, "add", "-A")
    git(path, "-c", "gc.auto=0", "commit", "-q", "-m", "initial commit")
    return path


SYSTEM_RUN = "_line"     # events about a closed run (as the reconciler writes them)


class AfterRunStore:
    """Store for the run-end hooks (judge grading close, lessons, agent SLOs): an event of the closed run
    goes to the system run "_line" with body.run / body.unit, so nothing follows the run's terminal
    event. Everything else passes through."""

    def __init__(self, store: Any, run: str):
        self._store, self.run = store, run

    @property
    def raw(self) -> Any:
        return getattr(self._store, "raw", self._store)

    def emit(self, kind: str, env: Any, body: Optional[Dict[str, Any]] = None) -> int:
        from .contracts import Envelope
        e = Envelope.parse(env)
        if e.run == self.run:
            body = dict(body or {}, run=self.run, **({"unit": e.unit} if e.unit else {}))
            e = dataclasses.replace(e, run=SYSTEM_RUN, unit="", epoch=0)
        return self._store.emit(kind, e, body)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)


class RoutedLlm:
    """LlmPort wrapper: before a model call the agent directory picks the version that does the role's work
    for (run, unit) (canary share, else the version the run is pinned to) and its model is used unless the
    caller named one (the retry ladder's alternate model always wins)."""

    def __init__(self, llm: Any, directory: Any, run: str):
        self.llm, self.directory, self.run = llm, directory, run

    def __getattr__(self, name: str) -> Any:
        return getattr(self.llm, name)

    def _model(self, role: str, key: str, run: str, model: Optional[str]) -> Optional[str]:
        if model:
            return model
        unit = key.split(".", 1)[0].split("#", 1)[0] if key and key[:1] in ("U", "F") and ("." in key or "#" in key) \
            else ""
        try:
            v = self.directory.route(role, run or self.run, unit)
        except Exception:   # noqa: BLE001 - routing never blocks a call
            return model
        return (v or {}).get("model") or model

    def complete(self, role: str, prompt: str, schema: Any = None, *, key: str = "", model: Optional[str] = None,
                 run: str = "") -> Any:
        return self.llm.complete(role, prompt, schema, key=key, model=self._model(role, key, run, model), run=run)

    def agentic(self, role: str, workdir: str, prompt: str, max_turns: int, usd_cap: float, *, key: str = "",
                model: Optional[str] = None, run: str = "") -> Any:
        return self.llm.agentic(role, workdir, prompt, max_turns, usd_cap, key=key,
                                model=self._model(role, key, run, model), run=run)


class Pipeline:
    def __init__(self, store: Any, cfg: Optional[Config] = None, *, rag: Any = None, llm: Any = None,
                 on_stage: Optional[Callable[[str, str], None]] = None, case_runner: Any = None,
                 smoke_cmd: Any = None, log: Optional[Callable[[str], None]] = None):
        self.store = store
        self.cfg = cfg or load_config()
        self._rag = rag
        self._llm = llm
        self.on_stage = on_stage
        self.case_runner = case_runner
        self.smoke_cmd = smoke_cmd
        stacks.configure(getattr(cfg, "stack", "auto"))   # target stack: explicit, or detected per repo
        self.log = log or (lambda msg: None)
        self._cancel = CancelToken()
        self._in_flight: Dict[str, cf.Future] = {}
        self._quiesced = False
        self.run = ""
        self._charged = 0.0
        self._last_sync = 0.0
        self._degraded: set = set()
        self._lock = threading.RLock()
        self._pause_reason = ""
        self.run_end: Dict[str, Any] = {}      # what the run-end hooks returned (learn, agents, observe, judge)
        self.agents: Any = None
        self.obs_calls: List[Dict[str, Any]] = []
        self.seal: Any = None                  # line.seal.wire.RunSeal when LINE_SEAL=1

    # ------------------------------------------------------------------ public

    def cancel(self, reason: str = "operator") -> None:
        """Cooperative cancel: the build / verify / merge loops stop, in-flight model calls of this
        pipeline's own LLM are killed; drive() joins the builder threads (cfg.cancel_join_s) and only
        then emits the run's terminal escalated {CANCELLED}. No worker write lands after it."""
        self._cancel.cancel(reason or "operator")

    @property
    def cancel_reason(self) -> str:
        return self._cancel.reason

    @property
    def rag(self) -> Any:
        if self._rag is None:
            self._rag = make_rag(self.cfg, self.store)
        return self._rag

    def admit(self, pack: str, target: str = "", run: str = "") -> str:
        """Create the run (state admitted, run.admitted) and open its budget. Returns the run id."""
        run = run or new_run_id()
        pack = os.path.abspath(pack)
        authority = LeaseAuthority.LOCAL.value
        rag_authority = ""
        try:
            rag_authority = self.rag.admit_run(run)
        except LineError as e:
            rag_authority = "error:" + e.code
        t = now_ms()
        row = Run(id=run, pack_path=pack, budget_usd=float(self.cfg.max_usd_run), lease_authority=authority,
                  created_ms=t, updated_ms=t,
                  detail={"target": os.path.abspath(target) if target else "", "llm": self.cfg.llm,
                          "model": self.cfg.model, "rag": self.cfg.rag, "rag_lease_authority": rag_authority})
        StateMachine(self.store, self.cfg.agent_version, self.cfg.model).admit_run(
            row, {"pack_path": pack, "target": row.detail["target"], "llm": self.cfg.llm, "model": self.cfg.model,
                  "max_usd_run": float(self.cfg.max_usd_run)})
        SqliteBudget(self.store, self.cfg.budget_warn_ratio, agent_version=self.cfg.agent_version).open(
            run, float(self.cfg.max_usd_run))
        try:
            rag_state.on_admit(self.store, self.cfg, self.rag, run)      # run row as a RAG record (rag_records)
        except Exception as e:   # noqa: BLE001 - the mirror never stops the line
            self.log("%s: record mirror: %s" % (run, e))
        self.run = run
        return run

    def drive(self, run: str = "") -> Dict[str, Any]:
        """Run the line for an admitted run until green or escalated. Returns the final run row."""
        run = run or self.run
        self.run = run
        row = self.store.get(E_RUN, run)
        if row is None:
            raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
        if row["state"] in TERMINAL_RUN_STATES:
            return row
        hm = str((row.get("detail") or {}).get("human_mode") or "")
        if hm in ("ask", "decide") and hm != getattr(self.cfg, "human_mode", ""):
            self.cfg = dataclasses.replace(self.cfg, human_mode=hm)     # per-run choice (POST /api/runs human_mode)
        elif not hm and getattr(self.cfg, "human_mode", "") == "ask":
            from . import supervisor
            if supervisor.enabled(self.cfg):  # the supervisor's way: the model answers, every decision logged
                self.cfg = dataclasses.replace(self.cfg, human_mode="decide")
        self._setup(row)
        if uplus.parked(self):                 # open questions: only answers resume it
            self.log("%s: parked, waiting for answers" % run)
            return row
        self.resumed_from = row["state"] if row["state"] != RunState.ADMITTED.value else ""
        if self.resumed_from:
            try:
                rep = reconciler.on_before_drive(getattr(self.store, "raw", self.store), self.cfg, run, rag=self.rag,
                                                 log=self.log)
                if rep is not None:
                    self.log("%s: reconcile before resume: %s" % (run, rep.summary()))
            except Exception as e:   # noqa: BLE001 - a failed pass leaves the run as it was
                self.log("%s: reconcile before resume failed: %s" % (run, e))
            if reconciler.is_frozen(self.store, run):
                frozen = ((self.store.get(E_RUN, run) or {}).get("detail") or {}).get("frozen")
                raise LineError(codes.STATE_CONFLICT, "run %s is frozen by the reconciler: %s" % (run, frozen),
                                {"run": run, "frozen": frozen})
        self._hold_run_lease()
        if self.resumed_from:
            self.log("%s: resuming from %s" % (run, self.resumed_from))
        self.watchdog.start()
        outcome = None
        stopped = ""                          # non-terminal stop: parked (questions) or paused (run lease lost)
        try:
            self._stages()
        except Parked as e:
            stopped = "parked: %s" % e
        except Cancelled:
            if self._pause_reason:
                stopped = "paused: " + self._pause_reason
            else:
                outcome = (codes.CANCELLED, "cancelled: %s" % self.cancel_reason, {"reason": self.cancel_reason})
        except Escalate as e:
            outcome = (e.code, e.message, e.detail)
        except LineError as e:
            if e.code == codes.CANCELLED and self._cancel.is_set():
                if self._pause_reason:
                    stopped = "paused: " + self._pause_reason
                else:
                    outcome = (codes.CANCELLED, "cancelled: %s" % self.cancel_reason, {"reason": self.cancel_reason})
            else:
                outcome = (e.code, e.message, e.detail)
        except Exception as e:   # noqa: BLE001 - a bug still ends the run cleanly, with the trace
            outcome = (codes.BUILD_FAIL, "internal error: %s: %s" % (type(e).__name__, e),
                       {"internal": True, "trace": traceback.format_exc()[-3000:]})
        finally:
            self._quiesce()
            if outcome is not None and self._pause_reason and not stopped:
                # the run lease was lost: another driver may own the run now; never end it from here
                stopped, outcome = "paused: " + self._pause_reason, None
            if outcome is not None:
                self._escalate(*outcome)
            if self._cancel.is_set():
                drop_hook_hold(self.store, run)
            if stopped.startswith("paused"):
                self._paused()
            elif stopped:
                self.log("%s: %s; the run waits (not terminal)" % (self.run, stopped))
            self._finish()
            self._drop_run_lease()
            from . import codegraph, runboard
            codegraph.detach(run)
            runboard.unregister(run)
            if not stopped:
                self._run_end()
                self._sync(force=True, mirror=False)      # the run-end hooks' events reach the RAG System too
        return self.store.get(E_RUN, run) or {}

    def _pause(self, reason: str) -> None:
        """Non-terminal stop (the run lease was lost, e.g. the clock jumped past its TTL): the loops stop
        like a cancel, but the run keeps its state and `resume` continues it."""
        if not self._pause_reason:
            self._pause_reason = reason
        self._cancel.cancel(reason)

    def _paused(self) -> None:
        row = self.store.get(E_RUN, self.run) or {}
        if row.get("state") in TERMINAL_RUN_STATES:
            return
        cur = self.leases.current(RUN_LEASE_PREFIX + self.run)
        mine = getattr(getattr(self, "_run_hb", None), "lease", None)
        if cur is not None and (mine is None or cur.owner != mine.owner or cur.epoch != mine.epoch):
            self.log("%s: paused; %s drives it now" % (self.run, cur.owner))
            return
        self.log("%s: paused (%s); resume continues it" % (self.run, self._pause_reason))
        try:
            self.sm.em.run_event(self.run, codes.RUN_PAUSED, {"reason": self._pause_reason, "state": row.get("state")})
        except LineError as e:
            self.log("%s: run.paused: %s" % (self.run, e))

    def _run_end(self) -> None:
        """After _finish, once the run is terminal: judge grading close, lessons, agent SLOs, metrics.
        Each hook is a no-op while its flag is off and never raises."""
        row = self.store.get(E_RUN, self.run) or {}
        if row.get("state") not in TERMINAL_RUN_STATES:
            return
        from . import changequeue                  # the run leaves its project's change queue
        changequeue.release(self.store, self.run, "done" if row.get("state") == RunState.GREEN.value else
                            "escalated")
        try:                                  # Admin > Run hooks: run_done / run_failed, on their own threads
            run_hooks.fire(self, "run_done" if row.get("state") == RunState.GREEN.value else "run_failed")
        except Exception as e:   # noqa: BLE001
            self.log("%s: run end hooks: %s" % (self.run, e))
        from . import agent_memory                 # the agents' worklogs become knowledge (a background distiller)
        agent_memory.distil_after_run(self)
        from .understand import sizer              # this run's level and how it went: a precedent for the next one
        sizer.record_case(self)
        if row.get("state") == RunState.ESCALATED.value:   # a failed run: why, as a finding and a shared lesson
            self._drop_failed_tests(row)
            agent_memory.retro_after_failure(self)
        ctx = self._hook_ctx(after_run=True)
        if self.agents is not None:
            self.agents.store = ctx.store
        for name, fn in (("learn", lambda: learn_hooks.on_run_end(ctx, self.run)),
                         ("agents", lambda: agents_dir.on_run_end(ctx, self.run, directory=self.agents)),
                         ("observe", lambda: observe.on_run_end(ctx, self.run))):
            try:
                out = fn()
                if out:
                    self.run_end[name] = out
            except Exception as e:   # noqa: BLE001
                self.log("%s: run end %s: %s" % (self.run, name, e))
        if self.run_end.get("learn"):
            le = self.run_end["learn"]
            self.log("%s: learn: distilled %s judged %d" % (self.run, (le.get("distilled") or {}).get("proposed"),
                                                           len(le.get("judged") or [])))
        from . import decisions                    # people's gate decisions into the project's store (same ids)
        decisions.sync(self.cfg, self.store, self.run)
        from . import retro                        # every run, after learn: each agent's outcome back into its persona
        retro.run(self)

    def resume(self, run: str) -> Dict[str, Any]:
        """drive() a run from whatever state it was left in (same as drive; the name says why)."""
        return self.drive(run)

    # ------------------------------------------------------------------ run lease (one driver per run)

    def _hold_run_lease(self) -> None:
        """One process drives a run: lease run:<id>, renewed every heartbeat_s. A crashed driver's lease
        runs out after lease_ttl_s; until then resume is refused (STATE_CONFLICT)."""
        name = RUN_LEASE_PREFIX + self.run
        lease = self.leases.acquire(name, "pipeline:%s:%d" % (self.run, os.getpid()), int(self.cfg.lease_ttl_s))
        if lease is None:
            cur = self.leases.current(name)
            raise LineError(codes.STATE_CONFLICT, "run %s is driven by %s (lease until %s ms)"
                            % (self.run, cur.owner if cur else "?", cur.expires_ms if cur else "?"),
                            {"run": self.run, "owner": cur.owner if cur else "", "expires_ms": cur.expires_ms if cur else 0})
        self._run_hb = LeaseHeartbeat(self.leases, lease, float(self.cfg.heartbeat_s), int(self.cfg.lease_ttl_s),
                                      on_lost=lambda e: self._pause("run lease lost")).start()

    def _drop_run_lease(self) -> None:
        hb = getattr(self, "_run_hb", None)
        if hb is None:
            return
        hb.stop()
        try:
            self.leases.release(hb.lease)
        except Exception as e:   # noqa: BLE001
            self.log("%s: run lease release: %s" % (self.run, e))
        self._run_hb = None

    def _quiesce(self) -> None:
        """Before the terminal event: stop and join the builder threads (bounded), stop the watchdog,
        close the worker store guard, charge what is left. Idempotent."""
        if self._quiesced:
            return
        self._quiesced = True
        tok = self._cancel
        futs = [f for f in self._in_flight.values() if not f.done()]
        if futs:
            if not tok.is_set():
                tok.cancel("run ending")
            done, late = cf.wait(futs, timeout=max(float(self.cfg.cancel_join_s), 0.0))
            if late:
                self.log("%s: %d builder thread(s) still running after %.0fs; their writes are refused"
                         % (self.run, len(late), float(self.cfg.cancel_join_s)))
        self.watchdog.stop()
        tok.close()
        if self.pool is not None:
            self.pool.shutdown(wait=False, cancel_futures=True)
        try:
            self._charge_stage()
        except Exception as e:   # noqa: BLE001
            self.log("%s: charge: %s" % (self.run, e))

    # ------------------------------------------------------------------ setup

    def _setup(self, row: Dict[str, Any]) -> None:
        run = row["id"]
        cfg = self.cfg
        if cfg.llm == "fake" and not cfg.dry_pack:
            cfg = dataclasses.replace(cfg, dry_pack=row["pack_path"])
            self.cfg = cfg
        self.pack = row["pack_path"]
        if rag_state.records_enabled(cfg):          # run / unit / digest / test / graph rows mirrored as records
            self.store = rag_state.wrap_store(self.store, cfg, self.rag)
        raw = getattr(self.store, "raw", self.store)
        self.sstore = ScopedStore(self.store, run)
        if rag_state.leases_enabled(cfg):           # RAG System as lease authority (runs admitted with it)
            self.leases = rag_state.make_leases(cfg, raw, self.rag, run, ttl_s=cfg.lease_ttl_s)
        else:
            self.leases = SqliteLeases(raw, ttl_s=cfg.lease_ttl_s)
        self.sleases = ScopedLeases(self.leases, run)
        self.wstore = GuardedStore(self.sstore, self._cancel)    # builder threads, verifier, watchdog
        self.sm = StateMachine(self.sstore, cfg.agent_version, cfg.model)
        self.budget = SqliteBudget(raw, cfg.budget_warn_ratio, agent_version=cfg.agent_version)
        try:
            self._charged = float(self.budget.state(run, run).spent)   # resume: already charged to the tree
        except LineError:
            self.budget.open(run, float(cfg.max_usd_run))
        self.llm = self._llm if self._llm is not None else make_llm(cfg, raw)
        if self._llm is None and hasattr(self.llm, "cancel"):
            self._cancel.on_cancel(self.llm.cancel)              # kill this pipeline's model subprocesses
        if agents_dir._s(cfg, "agents_enabled"):    # agent directory: which version (model) does a role's work
            try:
                self.agents = agents_dir.AgentDirectory(learn_hooks.learn_store(self), cfg, self.sstore)
                self.agents.ensure_defaults()
                self.llm = RoutedLlm(self.llm, self.agents, run)
            except Exception as e:   # noqa: BLE001 - routing is optional; the configured models still work
                self.log("%s: agent directory off: %s" % (run, e))
                self.agents = None
        self.llm = observe.wrap_llm(self.llm, cfg, self.obs_calls, run=run)   # unchanged unless obs_enabled
        self.watchdog = Watchdog(self.wstore, self.sleases, cfg)
        from .build import arbiter
        self.watchdog.extra.append(lambda: arbiter.on_tick(self))   # units waiting for another unit's merge
        from . import agent_memory, runboard               # the run board + project messages (line.runboard)
        self.kh_project = agent_memory._project(cfg, str((row.get("detail") or {}).get("rag_project") or ""))
        runboard.register(run, raw, cfg, self.kh_project)
        if uplus.enabled(cfg):
            self.watchdog.extra.append(lambda: uplus.on_tick(self))    # reminders for open questions
        self.workdir = os.path.join(cfg.workroot, _safe(run))
        os.makedirs(self.workdir, exist_ok=True)
        self.pool: Optional[cf.ThreadPoolExecutor] = None
        self.repo = ""

    def _stage(self, name: str) -> None:
        self.log("%s: %s" % (self.run, name))
        if self.on_stage is not None:
            self.on_stage(self.run, name)
        self._check_cancel()

    def _check_cancel(self) -> None:
        self._cancel.check()

    def _advance(self, to: RunState, extra: Sequence = (), body: Optional[Dict[str, Any]] = None) -> None:
        self.sm.advance_run(self.run, to, extra=extra, body=body)
        update_row(self.store, E_RUN, self.run, {"updated_ms": now_ms()})

    def _escalate(self, code: str, message: str, detail: Optional[Dict[str, Any]] = None) -> None:
        row = self.store.get(E_RUN, self.run) or {}
        if row.get("state") in TERMINAL_RUN_STATES or not row:
            return
        if code not in codes.ALL_CODES:
            code = codes.BUILD_FAIL
        safe = json.loads(json.dumps(detail or {}, default=str))
        if len(json.dumps(safe)) > 20000:
            safe = {"truncated": json.dumps(safe)[:20000]}
        self.log("%s: escalated %s %s" % (self.run, code, message))
        self._board("build", "stopped" if self._units() else "not started", self._build_text())
        self._board("result", "failed: %s" % code, str(message)[:600])
        self.sm.escalate_run(self.run, code, message, dict(safe, spent_usd=round(self._spent(), 6)))
        if not (row.get("detail") or {}).get("tests_commit"):     # failed while reading: a retry reads afresh
            forget = getattr(self.llm, "forget_cache", None)
            n = forget(self.run) if callable(forget) else 0
            if n:
                self.log("%s: %d cached reading answer(s) voided" % (self.run, n))

    # ------------------------------------------------------------------ money

    def _spent(self) -> float:
        try:
            return float(self.llm.spent(self.run))
        except Exception:   # noqa: BLE001 - an LlmPort without a ledger
            return 0.0

    def _charge(self, node: str, usd: float) -> None:
        if usd <= 0:
            return
        with self._lock:
            self._charged += usd
            try:
                self.budget.charge(self.run, node, usd)
            except LineError:
                self.budget.charge(self.run, self.run, usd)

    def _charge_stage(self) -> None:
        """Charge the run root with ledger spend not yet charged to a unit (understand / plan calls)."""
        with self._lock:
            delta = self._spent() - self._charged
        if delta > 1e-9:
            self._charge(self.run, delta)

    # ------------------------------------------------------------------ RAG sync

    def _sync(self, force: bool = False, mirror: bool = True) -> None:
        if not force and time.monotonic() - self._last_sync < SYNC_EVERY_S:
            return
        self._last_sync = time.monotonic()
        rag = self.rag
        try:
            rag.sync_events()
            cur = set(rag.degraded()) if hasattr(rag, "degraded") else set()
        except Exception as e:   # noqa: BLE001 - the RAG port must never stop the line
            self.log("%s: rag sync failed: %s" % (self.run, e))
            return
        if not mirror:                 # after the terminal event: push the log, emit nothing
            return
        em = self.sm.em
        for cap in sorted(cur - self._degraded):
            em.run_event(self.run, codes.RAG_DEGRADED_KIND, {"capability": cap, "error": "degraded", "mirror": True})
        for cap in sorted(self._degraded - cur):
            em.run_event(self.run, codes.RAG_RESTORED, {"capability": cap, "mirror": True})
        self._degraded = cur

    def _finish(self) -> None:
        try:
            spent = self._spent()
            row = self.store.get(E_RUN, self.run) or {}
            update_row(self.store, E_RUN, self.run, {"detail": dict(row.get("detail") or {}, spent_usd=round(spent, 6)),
                                                     "updated_ms": now_ms()})
            try:
                self.rag.metric("run_usd", spent, {"run": self.run})
            except Exception:   # noqa: BLE001
                pass
            if row.get("state") in TERMINAL_RUN_STATES:
                from . import difyproc
                difyproc.on_run_end(self)                 # the Dify process hears how its 'DLC: run' task ended
                try:                                      # close this run's pending judge decisions
                    ctx = dataclasses.replace(self._rctx(), store=AfterRunStore(self.sstore, self.run))
                    g = judge.on_run_end(ctx, row["state"])
                    if g.right or g.unattributable or g.wrong:
                        self.run_end["judge"] = {"right": g.right, "wrong": g.wrong,
                                                 "unattributable": g.unattributable, "accuracy": g.accuracy}
                except Exception as e:   # noqa: BLE001
                    self.log("%s: judge run end: %s" % (self.run, e))
            self._sync(force=True, mirror=False)
        except Exception as e:   # noqa: BLE001
            self.log("%s: finish: %s" % (self.run, e))

    # ------------------------------------------------------------------ stages

    def _state(self) -> str:
        return (self.store.get(E_RUN, self.run) or {}).get("state", "")

    def _enter(self, state: RunState) -> None:
        """Stage hook + cancel check, then advance unless the run already is in `state` (resume)."""
        self._stage(state.value)
        if self._state() != state.value:
            self._advance(state)

    def _stages(self) -> None:
        """Every stage first looks for what a previous driver of this run already persisted (frozen
        pack, reconciled digest, locked + committed tests, graph, merged units) and reuses it, so
        drive() on a run left in any non-final state resumes it without redoing finished work."""
        cfg = self.cfg
        st = self._state()
        resuming = st != RunState.ADMITTED.value
        # -------- understanding
        if st in (RunState.ADMITTED.value, RunState.UNDERSTANDING.value):
            self._enter(RunState.UNDERSTANDING)
        from . import changequeue                  # a slot in the project's change queue before any design
        changequeue.reserve(self)
        self.repo = self._target(resume=resuming)
        self._code_graph()
        from . import difyproc, solo
        from .understand import sizer
        row = self.store.get(E_RUN, self.run) or {}
        if (row.get("detail") or {}).get("sizing") or not row.get("spec_hash"):   # not a run frozen before levels
            if difyproc.enabled(cfg):
                difyproc.size(self)            # the process in Dify decides the level (line.difyproc)
            else:
                sizer.run(self)                # level 1-4 -> lane (detail.sizing)
        if sizer.lane_of(self) == solo.LANE:
            solo.run(self)                     # levels 1-2: one agent, the line's gates (line.solo)
            return
        pv = self._pack()
        self.pv = pv
        self._sync()
        self._check_cancel()
        digest = self._digest(pv)
        self.digest = digest
        self._check_cancel()
        if not ((self.store.get(E_RUN, self.run) or {}).get("detail") or {}).get("tests_commit"):
            pv, digest = self._understood(pv, digest)       # settled before the tests are locked
        pv, digest, self.fgraph = self._feature_graph(pv, digest)
        self._board("understand", "done", self._digest_text(digest))
        tests = self._tests(digest, pv)
        self._board("tests", "locked", self._tests_text(tests), facts={"uses": self._test_uses(tests)})
        self._sync()
        # -------- planning
        if self._state() in (RunState.UNDERSTANDING.value, RunState.PLANNING.value):
            self._enter(RunState.PLANNING)
        graph = self._graph(digest, tests)
        self._claims_from_tests(graph)
        self._board("plan", "done", self._plan_text())
        self._hook("after_plan")
        if not (self.store.get(E_RUN, self.run) or {}).get("detail", {}).get("budget_split"):
            self._split_budget(digest, graph)
            self._set_detail(budget_split=True)
        self._sync()
        # -------- building / integrating / qas (+ fixer rounds)
        self.sandbox = Sandbox(self.repo, cfg.workroot, cfg)
        self.mq = MergeQueue(self.sstore, self.repo, cfg)
        if merger.enabled(cfg):               # builders implement; the merger agent integrates into main
            self.mq.resolver = merger.Merger(
                self.sstore, cfg, self.llm,
                spec_for=lambda row: self._spec_for(types.SimpleNamespace(f_items=row.get("f_items") or [])))
        if seal_wire.enabled(cfg):            # seal ledger, per-file claims, async scoring, sealed-only merges
            self.seal = seal_wire.RunSeal(self)
            self.mq.seal_ok = self.seal.merge_ok
        self.pool = cf.ThreadPoolExecutor(max_workers=max(int(cfg.max_parallel_units), 1),
                                          thread_name_prefix="line-builder")
        st = self._state()
        if resuming and st in (RunState.BUILDING.value, RunState.INTEGRATING.value, RunState.QAS.value):
            self._recover_units()
        all_merged = self._all_merged()
        skip_build = st in (RunState.INTEGRATING.value, RunState.QAS.value) and all_merged
        while True:
            if not skip_build:
                self._enter(RunState.BUILDING)
                self._build_loop()
            if not (skip_build and self._state() == RunState.QAS.value):
                self._enter(RunState.INTEGRATING)
                self._drain()
                self._check_cancel()
            skip_build = False
            self._hook("before_qas")
            self._enter(RunState.QAS)
            if self._qas_round():
                return

    def _code_graph(self) -> None:
        """Graphify index of the target's main (line.codegraph): the agents of this run get the code_graph tool.
        Best effort: without graphify, or when the scan fails, they read the code themselves."""
        from . import codegraph
        if not codegraph.enabled(self.cfg):
            return
        info = codegraph.refresh(self.cfg, self.repo, run=self.run, log=self.log)
        self._set_detail(code_graph={k: info.get(k) for k in ("ok", "nodes", "edges", "ms", "error") if k in info})

    # ------------------------------------------------------------------ run board (line.runboard)

    def _board(self, step: str, status: str, detail: str = "", facts: Optional[Dict[str, Any]] = None) -> None:
        try:
            from . import runboard
            runboard.post(getattr(self.store, "raw", self.store), self.cfg, getattr(self, "kh_project", ""), self.run,
                          step, status, detail, facts)
        except Exception as e:   # noqa: BLE001 - the board helps; it never stops the run
            self.log("%s: board %s: %s" % (self.run, step, e))

    @staticmethod
    def _digest_text(digest: Any) -> str:
        items = getattr(digest, "f_items", []) or []
        lines = ["%s %s (%d criteria)" % (f.id, f.title, len(f.criteria)) for f in items]
        return "F-items: " + "; ".join(lines) if lines else "no F-items"

    def _test_uses(self, tests: List[Any]) -> Dict[str, List[str]]:
        """{test file: repo files it names (imports, paths), outside tests/acceptance}: the files the code under test
        lives in, so the plan gives them to the unit that owns the tests."""
        out: Dict[str, List[str]] = {}
        for path in sorted({t.path for t in tests}):
            try:
                with open(os.path.join(self.repo, *path.split("/")), encoding="utf-8") as fh:
                    src = fh.read()
            except OSError:
                continue
            found: List[str] = []
            joined = ["/".join(re.findall(r"""['"]([\w.-]+)['"]""", m.group(0))) for m in _JOINED_FILE.finditer(src)]
            for rel in [m.group(1) for m in _NAMED_FILE.finditer(src)] + joined:
                rel = rel.replace("\\", "/")
                while rel.startswith("./"):
                    rel = rel[2:]
                if rel.startswith(TEST_DIR) or rel in found or rel.startswith("/") or ".." in rel:
                    continue
                parent = os.path.dirname(os.path.join(self.repo, *rel.split("/")))
                if "/" in rel and os.path.isdir(parent):
                    found.append(rel)
            if found:
                out[path] = found[:12]
        return out

    def _tests_text(self, tests: List[Any]) -> str:
        files = sorted({t.path for t in tests})
        lines = ["%d test(s) locked in %s" % (len(tests), ", ".join(files) or "-")]
        for f, used in self._test_uses(tests).items():
            lines.append("%s uses: %s" % (f, ", ".join(used)))
        return "\n".join(lines)

    def _claims_from_tests(self, graph: Any) -> None:
        """Every repo file a unit's locked tests name goes into that unit's claims, unless another unit claims it:
        a test author's helper module must never be a file the builder may not create (run R20261016-145816-06e4)."""
        try:
            units = self._units()
            tests = {t.id: t for t in self._locked_tests()}
            uses = self._test_uses(list(tests.values()))
            owned = {c for u in units for c in (u.get("claims") or [])}
            for u in units:
                paths = {tests[t].path for t in (u.get("tests") or []) if t in tests}
                extra = [f for p in sorted(paths) for f in uses.get(p, []) if f not in owned]
                if not extra:
                    continue
                update_row(self.sstore, E_UNIT, u["id"], {"claims": list(u.get("claims") or []) + extra})
                owned.update(extra)
                self.log("%s: %s also claims %s (named by its locked tests)" % (self.run, u["id"], ", ".join(extra)))
        except Exception as e:   # noqa: BLE001
            self.log("%s: claims from tests: %s" % (self.run, e))

    def _plan_text(self) -> str:
        return "\n".join("%s %s: claims %s; tests %s; after %s" % (
            u["id"], u.get("title") or "", ", ".join(u.get("claims") or []) or "-",
            ", ".join(u.get("tests") or []) or "-", ", ".join(u.get("deps") or []) or "-") for u in self._units())

    def _build_text(self) -> str:
        out = []
        for u in self._units():
            fails = (u.get("detail") or {}).get("failures") or []
            why = str((fails[-1].get("detail") or {}).get("key") or fails[-1].get("code") or "") if fails else ""
            out.append("%s: %s (attempt %s)%s" % (u["id"], u.get("state"), u.get("attempt") or 0,
                                                  (" - " + why[:300]) if why else ""))
        return "\n".join(out)

    def _set_detail(self, **kv: Any) -> None:
        row = self.store.get(E_RUN, self.run) or {}
        update_row(self.store, E_RUN, self.run, {"detail": dict(row.get("detail") or {}, **kv)})

    def _all_merged(self) -> bool:
        units = self._units()
        return bool(units) and all(u["state"] == UnitState.MERGED.value for u in units)

    def _pack(self) -> Any:
        """The frozen pack of the run (spec_hash), else ingest + freeze now."""
        sh = (self.store.get(E_RUN, self.run) or {}).get("spec_hash") or ""
        prow = self.store.get(E_PACK, sh) if sh else None
        if prow:
            pv = from_dict(PackVersion, prow)
            pv.root = self.pack
            self.log("%s: reusing frozen pack %s" % (self.run, sh[:12]))
            return pv
        from .understand import analyst, sizer
        sizer.run(self)                      # the lane: how much reading this change needs (detail.sizing)
        analyst.run(self)                    # links, the project's knowledge and the code, added to spec.md
        self._hook("run_start")              # Admin > Run hooks (may add to spec.md, may hold the run)
        pv = ingest(self.pack, self.sstore, self.rag, run=self.run, cfg=self.cfg)
        update_row(self.store, E_RUN, self.run, {"spec_hash": pv.version})
        return pv

    def _digest(self, pv: Any) -> Any:
        """The reconciled digest of the run, else readers A/B + reconcile now."""
        drow = self.store.get(E_DIGEST, "%s:R" % self.run)
        if drow and drow.get("pack_version", pv.version) == pv.version:
            self.log("%s: reusing digest" % self.run)
            return from_dict(Digest, drow)
        from .understand import sizer
        try:
            return understand(pv, self.llm, run=self.run, store=self.sstore, cfg=self.cfg,
                              readers=2 if sizer.two_readers(self) else 1)
        finally:
            self._charge_stage()

    def _understood(self, pv: Any, digest: Any) -> Any:
        """understand_plus after the digest (no-op unless uplus_enabled): gaps + conflicts. Open questions
        park the run (Parked: drive returns, nothing terminal); answers that re-froze the pack as an
        addendum vN.k mean a fresh digest of the new version, then the check again (bounded)."""
        for rnd in range(UPLUS_MAX_ROUNDS + 1):
            try:
                res = uplus.on_understood(self, pv, digest)
            finally:
                self._charge_stage()
            st = res.get("status")
            if st == "waiting_human":
                raise Parked("questions %s open (F-items %s)" % (",".join(res.get("questions") or []),
                                                               ",".join(res.get("f_items") or []) or "all"))
            if st != "refrozen":
                return pv, digest
            if rnd >= UPLUS_MAX_ROUNDS:
                break
            pv = res["pv"]
            pv.root = pv.root or self.pack
            self.pv = pv
            self.log("%s: spec re-frozen as %s: digest again" % (self.run, pv.version[:12]))
            digest = self._digest(pv)
            self.digest = digest
            self._check_cancel()
        raise Escalate(codes.NO_PROGRESS, "the spec was re-frozen %d times in one drive" % UPLUS_MAX_ROUNDS,
                       {"spec_hash": pv.version})

    def _feature_graph(self, pv: Any, digest: Any) -> Any:
        """line.fgraph (off unless fgraph_enabled): extract the feature graph of the frozen pack, check it,
        derive the dependency order and ask about anything used that nothing provides. Returns
        (pv, digest, graph | None). An answer that re-froze the pack means a fresh digest and graph."""
        from .fgraph.extract import extract
        from .fgraph.model import from_dict as fgraph_from
        from .fgraph.stage import enabled, on_graph
        from .understand import sizer
        if not enabled(self.cfg):
            return pv, digest, None
        if not sizer.feature_graph(self, len(getattr(digest, "f_items", []) or [])):
            self.log("%s: feature graph skipped (lane %s)" % (self.run, sizer.lane_of(self)))
            return pv, digest, None
        detail = (self.store.get(E_RUN, self.run) or {}).get("detail") or {}
        row = self.store.get(E_FGRAPH, self.run)
        if detail.get("tests_commit") and row:                # settled before the tests were locked
            return pv, digest, fgraph_from(row)
        for _ in range(UPLUS_MAX_ROUNDS + 1):
            row = self.store.get(E_FGRAPH, self.run)
            if row and row.get("pack_version") == pv.version:
                g = fgraph_from(row)
            else:
                try:
                    g = extract(pv, digest, self.llm, run=self.run, context=self._context("fgraph", "understand", query=self._digest_query(digest)))
                finally:
                    self._charge_stage()
            try:
                res = on_graph(self, pv, digest, g)
            finally:
                self._charge_stage()
            if res["status"] == "waiting_human":
                raise Parked("feature graph: questions %s open" % ",".join(res.get("questions") or []))
            if res["status"] == "ok":
                return pv, digest, res["graph"]
            sh = (self.store.get(E_RUN, self.run) or {}).get("spec_hash") or ""
            if sh and sh != pv.version and self.store.get(E_PACK, sh):
                npv = from_dict(PackVersion, self.store.get(E_PACK, sh))
                npv.root = pv.root or self.pack
                pv, self.pv = npv, npv
                self.log("%s: spec re-frozen by feature-graph answers (%s): digest again" % (self.run, sh[:12]))
                digest = self._digest(pv)
                self.digest = digest
            self._check_cancel()
        raise Escalate(codes.NO_PROGRESS, "the feature graph kept asking (%d rounds)" % UPLUS_MAX_ROUNDS,
                       {"spec_hash": pv.version})

    def _locked_tests(self) -> List[Any]:
        rows = [r for r in self.store.query(E_ACC_TEST, run=self.run) if r.get("locked")]
        return sorted((from_dict(AccTest, r) for r in rows), key=lambda t: t.id)

    def _tests(self, digest: Any, pv: Any) -> List[Any]:
        """Locked acceptance tests committed on main, else author + check + commit now."""
        detail = (self.store.get(E_RUN, self.run) or {}).get("detail") or {}
        locked = self._locked_tests()
        if locked and detail.get("tests_commit"):
            self.log("%s: reusing %d locked tests (%s)" % (self.run, len(locked), detail["tests_commit"][:12]))
            return locked
        from .understand.test_check import locked_tampered
        if locked and not locked_tampered(self.repo, locked):
            # approved before the stop, not committed yet: commit what is on disk (sha checked)
            self._commit_tests()
            return locked
        if locked or git(self.repo, "status", "--porcelain", "--", TEST_DIR).stdout.strip():
            self._clean_tests()
        kept, earlier = self._earlier_tests(digest)
        todo = [f.id for f in digest.f_items if f.id not in {t.f_item for t in kept}]
        try:
            tests = list(kept)
            if todo:
                tests += author_tests(digest, self.llm, self.repo, run=self.run, store=self.sstore, pack=pv,
                                      only=todo if kept or earlier else None, earlier=earlier)
        finally:
            self._charge_stage()
        from .understand import test_here
        if test_here.enabled(self.cfg):          # run where they will run, before the lock (a fix round if needed)
            try:
                here = test_here.settle(self.repo, tests, self.llm, run=self.run, digest=digest, cfg=self.cfg,
                                        log=self.log)
            finally:
                self._charge_stage()
            if not here.ok:
                raise Escalate(here.code, "acceptance tests break on the test machine itself (%s)" % here.code,
                               here.detail)
        gate = check_tests(self.repo, tests, digest=digest, run=self.run, store=self.sstore, spec_hash=pv.version,
                           cfg=self.cfg)
        if not gate.ok:
            raise Escalate(gate.code, "acceptance tests rejected (%s)" % gate.code, gate.detail)
        self._commit_tests()
        return tests

    def _earlier_tests(self, digest: Any) -> tuple:
        """A supervised retry keeps the locked tests of the attempt it retries, F-item by F-item: the test author
        re-wrote every test blind on each retry ($1.3-1.5 a time) and threw away what was right. Kept: the F-items
        whose criteria the old tests still trace to, their files restored from that run's tests commit (a failed
        run's tests are reverted on main). Written again: the F-items the supervisor named (detail.rewrite_tests),
        with the old file shown to the author. -> (kept AccTests of this run, {F-item: {path, content, note}})."""
        detail = (self.store.get(E_RUN, self.run) or {}).get("detail") or {}
        retest = detail.get("retest") or {}
        prev = str(detail.get("retry_of") or "")
        if retest.get("sha"):                  # this run, reopened (line.reopen): its own tests of the failed attempt
            prev, sha = self.run, str(retest["sha"])
            fields = set(AccTest.__dataclass_fields__)
            old = [from_dict(AccTest, {k: v for k, v in r.items() if k in fields}) for r in retest.get("tests") or []]
            rewrite = {str(x) for x in retest.get("rewrite") or []}
            note = str(retest.get("note") or "")
        else:
            if not prev or not detail.get("supervised"):
                return [], {}
            pdet = (self.store.get(E_RUN, prev) or {}).get("detail") or {}
            sha = str(pdet.get("tests_commit") or "")
            old = [from_dict(AccTest, r) for r in self.store.query(E_ACC_TEST, run=prev) if r.get("locked")]
            rewrite = {x for x in re.split(r"[,\s]+", str(detail.get("rewrite_tests") or "")) if x}
            note = str((pdet.get("supervisor") or {}).get("hint") or "")
        if not sha or not old:
            return [], {}
        files: Dict[str, Optional[str]] = {}

        def content(path: str) -> Optional[str]:
            if path not in files:
                cp = git(self.repo, "show", "%s:%s" % (sha, path), check=False)
                files[path] = cp.stdout if cp.returncode == 0 else None
            return files[path]

        kept: List[Any] = []
        earlier: Dict[str, Dict[str, Any]] = {}
        for f in digest.f_items:
            mine = [t for t in old if t.f_item == f.id]
            if not mine:
                continue
            if f.id in rewrite:
                p0 = mine[0].path
                earlier[f.id] = {"path": p0, "content": content(p0) or "", "note": note}
                continue
            crit = {c.id: c for c in f.criteria}
            if {t.criterion for t in mine} != set(crit) or any(
                    t.span_id != crit[t.criterion].span_id and t.span_id not in f.span_ids for t in mine):
                self.log("%s: %s: the earlier tests no longer fit its criteria; written again" % (self.run, f.id))
                continue
            ok = True
            for path in sorted({t.path for t in mine}):
                text = content(path)
                full = os.path.join(self.repo, *path.split("/"))
                if text is None:
                    ok = False
                elif os.path.isfile(full):
                    with open(full, encoding="utf-8", errors="replace", newline="") as fh:
                        ok = ok and fh.read() == text           # still on main, the same file: kept in place
                else:
                    os.makedirs(os.path.dirname(full), exist_ok=True)
                    with open(full, "w", encoding="utf-8", newline="") as fh:
                        fh.write(text)
            if not ok:
                continue
            for t in mine:
                acc = AccTest(id=t.id, f_item=t.f_item, criterion=t.criterion, span_id=t.span_id, path=t.path,
                              name=t.name)
                self.sstore.put(E_ACC_TEST, "%s:%s" % (self.run, t.id), dict(to_dict(acc), run=self.run), run=self.run)
                kept.append(acc)
        if kept or earlier:
            self.log("%s: retry of %s: kept the locked tests of %s; written again: %s" % (
                self.run, prev, ",".join(sorted({t.f_item for t in kept})) or "none",
                ",".join(sorted(earlier)) or "none"))
        return kept, earlier

    def _drop_failed_tests(self, row: Dict[str, Any]) -> bool:
        """A failed run that merged nothing takes its locked acceptance tests back off main (a revert commit, so
        history keeps them): left there, the next run and its spec analyst read them as the project's contract
        and copy their mistakes. -> reverted. Never raises."""
        try:
            sha = str((row.get("detail") or {}).get("tests_commit") or "")
            repo = getattr(self, "repo", "") or str((row.get("detail") or {}).get("target") or "")
            if not sha or not repo or any(u.get("state") == UnitState.MERGED.value
                                          for u in self.store.query(E_UNIT, run=self.run)):
                return False
            if git(repo, "merge-base", "--is-ancestor", sha, "HEAD", check=False).returncode != 0 or \
                    "acceptance tests (locked)" not in git_out(repo, "log", "-1", "--format=%s", sha):
                return False
            if git(repo, "status", "--porcelain", check=False).stdout.strip():
                self.log("%s: locked tests of the failed run left on main: the checkout is not clean" % self.run)
                return False
            cp = git(repo, "-c", "gc.auto=0", "revert", "--no-edit", sha, check=False)
            if cp.returncode != 0:
                git(repo, "revert", "--abort", check=False)
                self.log("%s: could not revert the failed run's tests: %s" % (self.run, cp.stderr.strip()[-300:]))
                return False
            self.log("%s: failed run: its locked acceptance tests were reverted on main" % self.run)
            return True
        except Exception as e:   # noqa: BLE001 - housekeeping after the run; it never changes the outcome
            self.log("%s: dropping the failed run's tests: %s" % (self.run, e))
            return False

    def _commit_tests(self) -> None:
        git(self.repo, "add", "-A", "--", "tests")
        if git(self.repo, "diff", "--cached", "--quiet", check=False).returncode != 0:
            git(self.repo, "-c", "gc.auto=0", "commit", "-q", "-m", "line %s: acceptance tests (locked)" % self.run)
        self._set_detail(tests_commit=git_out(self.repo, "rev-parse", "HEAD"))

    def _clean_tests(self) -> None:
        """Drop half-written acceptance tests of a stopped understanding stage (line's own files only)."""
        git(self.repo, "checkout", "-q", "HEAD", "--", TEST_DIR, check=False)
        git(self.repo, "clean", "-fdq", "--", TEST_DIR, check=False)

    def _graph(self, digest: Any, tests: List[Any]) -> Any:
        grow = self.store.get(E_GRAPH, self.run)
        if grow and self._units():
            self.log("%s: reusing graph (%d units)" % (self.run, len(grow.get("units") or [])))
            return from_dict(Graph, grow)
        from . import codegraph
        context = self._context("planner", "plan", query=self._digest_query(digest))
        hubs = codegraph.summary(self.cfg, self.run)          # how the existing code hangs together (no model)
        if hubs:
            context = (context + "\n\n## Code graph: the most connected code (graphify)\n" + hubs).strip()
        try:
            return plan(digest, tests, self.repo, self.llm, self.sstore, run=self.run, cfg=self.cfg,
                        context=context, fgraph=getattr(self, "fgraph", None))
        finally:
            self._charge_stage()

    def _recover_units(self) -> None:
        """Resume of a build: units left mid-flight by a stopped driver go back into the loop.
          leased, lease expired or gone  -> ready (LEASE_LOST, not a ladder failure)
          leased, lease still live       -> left to the watchdog (requeued when it expires)
          submitted                      -> verified again (the verifier never trusted the builder)
          verified, not queued           -> committed on its branch and queued for merge
          waiting (BLOCKED, no ladder)   -> the ladder step the stopped driver did not take"""
        self.watchdog.tick()
        queued = {r.get("unit") for r in self.mq.pending(self.run)}
        for u in self._units():
            uid, st = u["id"], u["state"]
            if st == UnitState.LEASED.value and self.sleases.current(unit_lease_name(uid)) is None:
                self._requeue_lost(uid, "resume")
            elif st == UnitState.SUBMITTED.value:
                self._in_flight[uid] = self.pool.submit(self._reverify, uid)
            elif st == UnitState.VERIFIED.value and uid not in queued:
                if os.path.isdir(u.get("worktree") or ""):
                    self._commit_unit(uid, int(u.get("attempt") or 0))
                if self.seal is None:
                    self.mq.enqueue(self.run, uid)     # with the seal on, the seal tick enqueues sealed units
            elif st == UnitState.WAITING.value and not (u.get("detail") or {}).get("wait_for"):
                reason = str((u.get("detail") or {}).get("blocked_reason") or "")
                self._ladder(uid, codes.BLOCKED, "blocked:" + reason[:200])
            if st not in (UnitState.MERGED.value, UnitState.PENDING.value, UnitState.READY.value):
                self.log("%s: resume %s (%s)" % (self.run, uid, st))
        if self.seal is not None:
            self.seal.recover()

    def _requeue_lost(self, uid: str, why: str) -> None:
        try:
            self.sm.advance_unit(uid, UnitState.READY, UnitState.LEASED, code=codes.LEASE_LOST,
                                 extra=[(codes.UNIT_REQUEUED, {"code": codes.LEASE_LOST, "from": UnitState.LEASED.value,
                                                              "why": why})])
        except LineError as e:
            if e.code != codes.STATE_CONFLICT:
                raise

    def _reverify(self, uid: str) -> Dict[str, Any]:
        """Builder-thread job on resume: verify a unit that was submitted when the driver stopped."""
        row = self.sstore.get(E_UNIT, uid) or {}
        n = int(row.get("attempt") or 1)
        out: Dict[str, Any] = {"outcome": "SUBMIT", "attempt": n, "usd": 0.0, "resumed": True}
        if self._cancel.is_set():
            return dict(out, outcome="CANCELLED")
        if not os.path.isdir(row.get("worktree") or self.sandbox.path(row)):
            return dict(out, outcome="NO_WORKTREE")      # the work is gone: build it again (not a failure)
        g = verify(uid, n, self.wstore, self.sandbox, self.cfg)
        out.update(verified=g.ok, gate_code=g.code)
        if not self._reviewed(uid, n, g, "SUBMIT", 0.0, out):
            return out
        if g.ok and not self._cancel.is_set():
            out["head"] = self._commit_unit(uid, n)
        return out

    # ------------------------------------------------------------------ target repo

    def _target(self, resume: bool = False) -> str:
        row = self.store.get(E_RUN, self.run) or {}
        detail = dict(row.get("detail") or {})
        target = detail.get("target") or ""
        prepared = bool(detail.get("base_sha"))
        if not target:
            fresh = os.path.join(self.workdir, TARGET_DIR)
            if resume and self._has_commit(fresh):
                target = fresh                       # made by the stopped driver: reuse it
            else:
                target = init_target(fresh)
        elif not os.path.isdir(os.path.join(target, ".git")):
            if os.path.isdir(target) and os.listdir(target):
                raise Escalate(codes.NOT_FOUND, "target %s is not a git repository" % target, {"target": target})
            init_target(target)
        head = git(target, "symbolic-ref", "-q", "HEAD", check=False).stdout.strip()
        if head != "refs/heads/main":
            raise Escalate(codes.STATE_CONFLICT, "target %s must have branch main checked out (has %s)" % (target, head),
                           {"target": target, "head": head})
        # resume before the tests commit: acceptance-test files on disk are the stopped driver's own
        # (half-written: dropped here; approved and locked: _tests() commits them after a sha check)
        tests_pending = resume and prepared and not detail.get("tests_commit")
        if tests_pending:
            self.repo = os.path.abspath(target)
            if not self._locked_tests():
                self._clean_tests()
        dirty = [l for l in git(target, "status", "--porcelain").stdout.splitlines() if l.strip()]
        if tests_pending:
            dirty = [l for l in dirty if not l[3:].strip('"').replace("\\", "/").startswith("tests/")]
        if dirty:
            raise Escalate(codes.STATE_CONFLICT, "target %s has uncommitted changes" % target,
                           {"target": target, "status": "\n".join(dirty)[:2000]})
        detail["target"] = os.path.abspath(target)
        if not prepared:
            detail["base_sha"] = git_out(target, "rev-parse", "HEAD")
        update_row(self.store, E_RUN, self.run, {"detail": detail})
        return os.path.abspath(target)

    @staticmethod
    def _has_commit(path: str) -> bool:
        return os.path.isdir(os.path.join(path, ".git")) and \
            git(path, "rev-parse", "-q", "--verify", "HEAD", check=False).returncode == 0

    def _hook(self, event: str) -> None:
        """Admin > Run hooks of this event (line.hooks): background ones start, waiting ones run here; a hook
        that holds the run parks it (Parked) or ends it (Escalate HOOK_STOP)."""
        self._check_cancel()
        act = run_hooks.fire(self, event)
        self._check_cancel()                           # a stop killed the hook's agent: no hold, the run stops
        detail = dict((self.store.get(E_RUN, self.run) or {}).get("detail") or {})
        if act is None:
            if str((detail.get("hook_hold") or {}).get("key") or "").startswith(event + ":"):
                detail.pop("hook_hold", None)          # the hook that held the run let it go
                update_row(self.store, E_RUN, self.run, {"detail": detail})
            return
        detail["hook_hold"] = dict(act["detail"], ms=now_ms())
        update_row(self.store, E_RUN, self.run, {"detail": detail})
        if act["action"] == "stop":
            raise Escalate(codes.HOOK_STOP, act["message"], act["detail"])
        raise Parked(act["message"])

    def _deliver(self) -> None:
        """The Deliver step of the process: the run's work goes back to the project's source repository as
        branch dlc/<project> (projects.deliver). A project without a git source, or with deliver 'off', is
        skipped; a refused push is reported on the step and never costs the green run. Done once per run."""
        detail = dict((self.store.get(E_RUN, self.run) or {}).get("detail") or {})
        pid = str(detail.get("project") or "")
        if not pid or detail.get("delivered"):
            return
        from . import projects
        try:
            project = projects.get(pid)
        except Exception:   # noqa: BLE001 - a run of a removed project
            return
        em = self.sm.em
        if project.get("source_kind") != "git" or project.get("deliver") == "off":
            why = "deliver is off for this project" if project.get("deliver") == "off" else \
                "no source repository: the code stays in the engine's working copy"
            em.run_event(self.run, codes.DELIVER_SKIPPED, {"project": pid, "reason": why})
            detail["delivered"] = {"skipped": why}
        else:
            try:
                out = projects.deliver(pid)
                em.run_event(self.run, codes.DELIVERED, out)
                detail["delivered"] = out
            except Exception as e:   # noqa: BLE001
                em.run_event(self.run, codes.DELIVER_FAILED, {"project": pid, "error": str(e)[:500]})
                detail["delivered"] = {"error": str(e)[:500]}
        update_row(self.store, E_RUN, self.run, {"detail": detail})

    def _hook_ctx(self, after_run: bool = False) -> Any:
        """Context of the learning / directory / metrics hooks: the run's (scoped) store, config, model port,
        RAG port. after_run: the run is closed, its events go to the system run (AfterRunStore)."""
        import types
        store = AfterRunStore(self.sstore, self.run) if after_run else self.sstore
        return types.SimpleNamespace(store=store, cfg=self.cfg, llm=self.llm, rag=self.rag, run=self.run,
                                     log=self.log)

    def _rctx(self) -> Any:
        return ReviewCtx.from_pipeline(self)

    def _context(self, role: str, step: str, unit: str = "", query: str = "") -> str:
        """Context for a prompt: the learning loop's lessons for (role, step) when learn_enabled (local
        lessons + RAG retrieval, canary arms per unit), else plain RAG retrieval. query = the situation in words
        (what the unit builds, why the last attempt failed): the RAG System also matches it by meaning, so a
        lesson that carries no key is still found."""
        if learn_setting(self.cfg, "learn_enabled"):
            return learn_hooks.on_prompt(self._hook_ctx(), role, step, self.run, unit=unit, query=query)
        try:
            kw = {"query": query} if query else {}
            hits = self.rag.retrieve(role, step, ["python"], int(self.cfg.rag_retrieve_max_chars), **kw)
        except Exception:   # noqa: BLE001 - retrieval is best effort
            return ""
        return "\n\n".join("[%s] %s" % (h.get("source", ""), h.get("text", "")) for h in hits or [])

    @staticmethod
    def _digest_query(digest: Any) -> str:
        """What the spec asks for, in words: the feature titles (retrieval matches them by meaning)."""
        titles = [str(getattr(f, "title", "") or "") for f in (getattr(digest, "f_items", None) or [])]
        return ("Features: " + "; ".join(t for t in titles if t))[:1500] if any(titles) else ""

    @staticmethod
    def _unit_query(unit: Any, nudge: str = "") -> str:
        """The unit's situation in words: what it builds and, for a fixer or a corrected retry, what went wrong."""
        parts = [str(getattr(unit, "title", "") or "")]
        claims = list(getattr(unit, "claims", None) or [])
        if claims:
            parts.append("Files: " + ", ".join(map(str, claims[:12])))
        ev = ((getattr(unit, "detail", None) or {}).get("evidence") or {})
        failing = ev.get("failing") if isinstance(ev, dict) else None
        if failing:
            parts.append("Failing: " + "; ".join(str(f)[:300] for f in list(failing)[:8]))
        if nudge:
            parts.append("Correction: " + str(nudge)[:600])
        return "\n".join(p for p in parts if p)[:3000]

    def _split_budget(self, digest: Any, graph: Any) -> None:
        f_sizes = {f.id: f.size for f in digest.f_items}
        top: Dict[str, str] = dict(f_sizes)
        under: Dict[str, Dict[str, str]] = {}
        for u in graph.units:
            parent = next((f for f in u.f_items if f in f_sizes), "")
            if parent:
                under.setdefault(parent, {})[u.id] = u.size
            else:
                top[u.id] = u.size
        try:
            self.budget.split(self.run, self.run, size_weights(top))
            for parent, sizes in under.items():
                self.budget.split(self.run, parent, size_weights(sizes))
        except LineError as e:
            self.log("%s: budget split: %s" % (self.run, e))

    # ------------------------------------------------------------------ build loop

    def _units(self) -> List[Dict[str, Any]]:
        return self.store.query(E_UNIT, run=self.run)

    def _build_loop(self) -> None:
        cfg = self.cfg
        in_flight = self._in_flight
        while True:
            self._sync()
            for uid, fut in list(in_flight.items()):
                if fut.done():
                    del in_flight[uid]
                    self._after_attempt(uid, fut.result())
            if self.mq.pending(self.run) and not self._cancel.is_set():
                for o in self._drain():
                    if not o.merged and (o.detail or {}).get("stage") == "seal":
                        if self.seal is not None:     # not final yet: the seal tick enqueues it again
                            self.seal.unqueued(o.unit)
                        continue
                    if not o.merged and o.gate.code == codes.MERGE_BLOCKED:
                        why = (o.detail.get("merger") or {}).get("reason", "")
                        raise Escalate(codes.MERGE_BLOCKED, "unit %s cannot be integrated as specified: %s"
                                       % (o.unit, why), {"unit": o.unit, "stage": o.detail.get("stage", ""),
                                                         "merger": o.detail.get("merger")})
                    if not o.merged and o.gate.code in (codes.MERGE_CONFLICT, codes.MERGE_TESTS_RED):
                        self._ladder(o.unit, o.gate.code,
                                     "merge:%s:%s" % (o.detail.get("stage", ""), ",".join(o.detail.get("files", []))))
            self._check_cancel()
            units = self._units()
            failed = [u for u in units if u["state"] == UnitState.FAILED.value]
            if not failed:
                free = max(int(cfg.max_parallel_units), 1) - len(in_flight)
                if free > 0:
                    if self.seal is not None:
                        self.seal.promote()          # speculative start on producers pending a seal
                    for u in next_ready(self.run, self.sstore, cfg, limit=free):
                        if u.id in in_flight:
                            continue
                        got = dispatch(u, self.wstore, self.sleases, self.sandbox, cfg, owner="pipeline:%s" % self.run,
                                       seal=self.seal)
                        if got is None:
                            continue
                        unit, lease = got
                        in_flight[unit.id] = self.pool.submit(self._work, unit, lease)
                units = self._units()
            if self.seal is not None:
                st_out = self.seal.tick()            # scoring beside the build: never in front of it
                if any(st_out[k] for k in ("scored", "sealed", "rejected", "tainted", "enqueued")):
                    units = self._units()
                    failed = [u for u in units if u["state"] == UnitState.FAILED.value]
            if not in_flight and not self.mq.pending(self.run):
                states = [u["state"] for u in units]
                if units and all(s == UnitState.MERGED.value for s in states):
                    return
                if failed:
                    self._unit_failed(failed)
                busy = {UnitState.READY.value, UnitState.LEASED.value, UnitState.SUBMITTED.value,
                        UnitState.VERIFIED.value}
                if not any(s in busy for s in states):
                    stuck = {u["id"]: u["state"] for u in units if u["state"] != UnitState.MERGED.value}
                    raise Escalate(codes.NO_PROGRESS, "no unit can move: %s" % stuck, {"units": stuck})
                if self.seal is not None:
                    waiting = self.seal.waiting_signoff()
                    moving = {UnitState.READY.value, UnitState.LEASED.value, UnitState.SUBMITTED.value}
                    if waiting and not any(s in moving for s in states):
                        raise Parked("seal: sign-off of %s" % ",".join(waiting))
            if in_flight:
                cf.wait(list(in_flight.values()), timeout=LOOP_WAIT_S, return_when=cf.FIRST_COMPLETED)
            else:
                time.sleep(LOOP_WAIT_S / 5)

    def _drain(self) -> List[Any]:
        """Drain the merge queue; the worktree of every merged unit is removed (its work is on main and on
        its branch). Worktrees of failed / escalated units stay as evidence."""
        outs = self.mq.drain(self.run, stop=self._cancel.is_set)
        for o in outs:
            if o.merged:
                row = self.sstore.get(E_UNIT, o.unit)
                if row:
                    try:
                        self.sandbox.cleanup(row)
                    except Exception as e:   # noqa: BLE001 - a leftover worktree is only disk space
                        self.log("%s: cleanup of %s: %s" % (self.run, o.unit, e))
        return outs

    def _unit_failed(self, failed: List[Dict[str, Any]]) -> None:
        u = failed[0]
        esc = self.store.get(E_ESCALATION, "%s:%s" % (self.run, u["id"])) or {}
        code = esc.get("code") or (u.get("detail") or {}).get("code") or codes.NO_PROGRESS
        raise Escalate(code, "unit %s failed: %s" % (u["id"], esc.get("message", "retry ladder exhausted")),
                       {"unit": u["id"], "units": [x["id"] for x in failed], "escalation": esc})

    def _work(self, unit: Any, lease: Any) -> Dict[str, Any]:
        """One attempt of one unit (builder thread): build, then verify, then commit. Checks the cancel
        token between steps; every write goes through the guarded store (refused once cancelled)."""
        cfg = self.cfg
        tok = self._cancel
        if tok.is_set():
            self.sleases.release(lease)
            return {"outcome": "CANCELLED", "attempt": unit.attempt}
        merged_contracts = [u for u in self._units() if u.get("contract") and u["state"] == UnitState.MERGED.value]
        contracts = "\n".join("- %s %s: %s" % (u["id"], u.get("title", ""), ", ".join(u.get("claims") or []))
                              for u in merged_contracts)
        fg = getattr(self, "fgraph", None)
        if fg is not None:                                     # feature graph: what this unit uses and who makes it
            from .fgraph.derive import needs_text
            needs = needs_text(fg, list(getattr(unit, "f_items", []) or []), self._units())
            if needs:
                contracts = (contracts + "\n" if contracts else "") + "Uses (from the feature graph):\n" + needs
        role = "fixer" if int(getattr(unit, "fixer_gen", 0) or 0) > 0 else "builder"
        nudge = drift.nudge_for(self.wstore, unit.id)          # drift ladder / judge ruling for this attempt
        context = self._context(role, "build", unit=unit.id, query=self._unit_query(unit, nudge))
        if nudge:
            context = (context + "\n\n" if context else "") + "Correction for this attempt: " + nudge
        br = run_builder(unit, lease, self.llm, self.wstore, leases=self.sleases, cfg=cfg, contracts=contracts,
                         context=context, spec=self._spec_for(unit))
        self._charge(unit.id, br.usd)
        out: Dict[str, Any] = {"outcome": br.outcome, "attempt": br.attempt, "code": br.code, "reason": br.reason,
                               "usd": br.usd}
        if br.outcome != "SUBMIT":
            return out
        if tok.is_set():
            return dict(out, outcome="CANCELLED")
        g = verify(unit.id, br.attempt, self.wstore, self.sandbox, cfg)
        out.update(verified=g.ok, gate_code=g.code)
        if not self._reviewed(unit.id, br.attempt, g, br.outcome, br.usd, out):
            return out
        if g.ok and not tok.is_set():
            out["head"] = self._commit_unit(unit.id, br.attempt)
        return out

    def _reviewed(self, uid: str, n: int, g: Any, outcome: str, usd: float, out: Dict[str, Any]) -> bool:
        """After verify (builder thread): drift signals of the attempt, then (verify passed) the clean-context
        reviewer. False when the unit must not be committed / merged now (out gets verified False + code)."""
        if self._cancel.is_set():
            return True
        ctx = self._rctx()
        do = drift.on_attempt(ctx, uid, n, g, builder_outcome=outcome, usd=usd)
        self._charge(uid, do.usd)
        if not do.proceed:
            out.update(verified=False, gate_code=do.code or g.code, drift=do.action)
            return False
        if not g.ok or self._cancel.is_set():
            return True
        ro = reviewer.on_verified(ctx, uid, n)
        self._charge(uid, ro.usd)
        if not ro.proceed:
            out.update(verified=False, gate_code=ro.code, review=ro.action)
            return False
        if ro.action != "skip":
            out["review"] = ro.action
        return True

    def _spec_for(self, unit: Any) -> str:
        """Frozen spec text for a builder: the shared sections (interface, storage ...) and the
        sections of the unit's F-items (all F-item sections for a unit without F-items)."""
        from .understand.test_author import shared_span_ids
        pv, digest = getattr(self, "pv", None), getattr(self, "digest", None)
        if pv is None or digest is None:
            return ""
        mine = [f for f in digest.f_items if f.id in set(unit.f_items or [])] or list(digest.f_items)
        want = set(shared_span_ids(pv, digest.f_items))
        want |= {c.span_id for f in mine for c in f.criteria} | {s for f in mine for s in f.span_ids}
        from .reopen import notes_text                 # a retried run: the notes of its earlier attempts
        notes = notes_text((self.store.get(E_RUN, self.run) or {}).get("detail") or {})
        return "\n\n".join(s.text.strip() for s in pv.spans if s.id in want) + ("\n\n" + notes if notes else "")

    def _commit_unit(self, uid: str, attempt: int) -> str:
        row = self.sstore.get(E_UNIT, uid) or {}
        wt = row.get("worktree") or self.sandbox.path(row)
        git(wt, "add", "-A", "--", ".", ":(exclude,glob)**/__pycache__/**", ":(exclude,glob)**/*.pyc")
        if git(wt, "diff", "--cached", "--quiet", check=False).returncode != 0:
            git(wt, "-c", "gc.auto=0", "commit", "-q", "-m", "line %s: unit %s attempt %d" % (self.run, uid, attempt))
        sha = git_out(wt, "rev-parse", "HEAD")
        detail = dict(row.get("detail") or {})
        detail["head"] = sha
        update_row(self.wstore, E_UNIT, uid, {"detail": detail})
        return sha

    def _after_attempt(self, uid: str, res: Dict[str, Any]) -> None:
        if self.seal is not None and self.seal.on_attempt(uid, res):
            return                                   # submitted for scoring; the seal tick enqueues it
        outcome = res.get("outcome")
        if outcome == "SUBMIT":
            if res.get("verified"):
                self.mq.enqueue(self.run, uid)
            return                                   # verify failed: the verifier applied the ladder
        if outcome == "BLOCKED":
            from .build import arbiter                 # claims granted / waited for, locked test ruled on first
            if not arbiter.resolve(self, uid, str(res.get("reason", ""))):
                self._ladder(uid, codes.BLOCKED, "blocked:" + str(res.get("reason", ""))[:200])
        elif outcome == "ERROR":
            from .claude_token import REJECTED
            if str(res.get("reason") or "").startswith(REJECTED):
                # every later call meets the same refused token: no retry, a person sets a new one
                raise Escalate(codes.LLM_ERROR, str(res["reason"]), {"unit": uid, "token_rejected": True})
            row = self.sstore.get(E_UNIT, uid) or {}
            if row.get("state") != UnitState.FAILED.value:
                self._ladder(uid, res.get("code") or codes.LLM_ERROR, "error:%s" % res.get("code"))
        elif outcome == "NO_WORKTREE":
            try:
                self.sm.advance_unit(uid, UnitState.READY, UnitState.SUBMITTED, code=codes.LEASE_LOST,
                                     extra=[(codes.UNIT_REQUEUED, {"code": codes.LEASE_LOST,
                                                                  "from": UnitState.SUBMITTED.value,
                                                                  "why": "worktree gone on resume"})])
            except LineError as e:
                if e.code != codes.STATE_CONFLICT:
                    raise
        elif outcome == "LOST":
            row = self.sstore.get(E_UNIT, uid) or {}
            if row.get("state") == UnitState.LEASED.value and self.sleases.current(unit_lease_name(uid)) is None:
                self._requeue_lost(uid, "lease lost")

    def _ladder(self, uid: str, code: str, key: str) -> None:
        fp = hashlib.sha1(key.encode("utf-8", "replace")).hexdigest()
        row = self.sstore.get(E_UNIT, uid) or {}
        if row.get("state") in (UnitState.MERGED.value, UnitState.FAILED.value):
            return
        d = self.watchdog.record_failure(uid, code, fingerprint=fp, detail={"key": key[:200]})
        self.log("%s: %s %s -> %s" % (self.run, uid, code, d.action))

    # ------------------------------------------------------------------ QAS

    def _qas_round(self) -> bool:
        """Deploy + QAS once. True when the run is green; False when fixer units were spawned."""
        cfg = self.cfg
        qas_root = os.path.join(self.workdir, QAS_DIR)
        deployer = Deployer(self.sstore, self.repo, cfg, qas_root=qas_root, smoke_cmd=self.smoke_cmd)
        while True:
            ok, why = deployer.may_deploy(queue_drained=True)
            if ok:
                break
            self.log("%s: deploy waits (%s)" % (self.run, why))
            for _ in range(int(WINDOW_POLL_S / LOOP_WAIT_S)):
                self._check_cancel()
                self._sync()
                time.sleep(LOOP_WAIT_S)
        res = self._qas_locked(lambda: deployer.deploy(self.run))
        if res.reason == "smoke_fail":
            from .retire import failing_tests
            full = str(res.detail.get("output", ""))
            raise Escalate(codes.SMOKE_FAIL, "smoke test failed on QAS %s" % res.detail.get("tried", ""),
                           {"output": full[-3000:], "failing": failing_tests(full)})
        self._sync()
        base = self.case_runner or default_case_runner
        from .dry import wrap_case_runner
        runner = wrap_case_runner(cfg, self.store, self.run, base) or base
        report = self._qas_locked(lambda: QasRunner(self.sstore, cfg, qas_root=qas_root, case_runner=runner).run(self.run))
        if report.flaky:
            self._quarantine(report)
        grade = judge.on_qas_report(self._rctx(), report)       # grade earlier judge decisions by QAS outcome
        if grade.right or grade.wrong:
            self.log("%s: judge decisions graded: right %s wrong %s" % (self.run, grade.right, grade.wrong))
        if not report.red and self.seal is not None:
            v = self._final_seal(report, res)
            if v is not None and not v.sealed:
                raise Escalate(codes.SEAL_REJECTED, "final seal refused: %s" % "; ".join(v.reasons),
                               {"total": v.total, "reasons": v.reasons})
        if not report.red:
            self._hook("before_green")
            self._deliver()
            self._quiesce()
            try:
                out = uplus.on_green(self)                       # the run's rules join the system rule graph
                if out.get("status") == "ok":
                    self.log("%s: rule graph: %s" % (self.run, {k: v for k, v in out.items() if k != "status"}))
            except Exception as e:   # noqa: BLE001 - the completion gate record must not cost a green run
                self.log("%s: rule graph commit failed: %s" % (self.run, e))
            spent = self._spent()
            self._board("qas", "green", "; ".join("%s %s" % (i.f_item, i.verdict) for i in report.items))
            self._board("result", "green", "$%.2f spent; main at %s" % (spent, res.sha or ""))
            self._advance(RunState.GREEN, extra=[(codes.RUN_GREEN, {
                "sha": res.sha or git_out(self.repo, "rev-parse", "main"), "color": res.color,
                "qas": {i.f_item: i.verdict for i in report.items}, "usd": round(spent, 6),
                "units": len(self._units()), "quarantined": [t for i in report.flaky for t in i.quarantined]})])
            return True
        outs = Fixer(self.sstore, cfg).handle(self.run, report)
        judge.attach_fixer_evidence(self._rctx(), outs, grade)   # a wrong ruling's evidence goes to its fixer
        esc = [o for o in outs if o.escalated]
        if esc:
            raise Escalate(codes.QAS_RED, "%s still red on QAS after %d fixer generation(s)"
                           % (",".join(o.f_item for o in esc), cfg.fixer_generations),
                           {"f_items": [o.f_item for o in esc], "detail": [o.detail for o in esc]})
        for o in outs:
            if o.unit:
                uid = o.unit["id"]
                try:
                    self.budget.split(self.run, o.f_item, {uid: 1.0})
                except LineError:
                    pass
        return False

    def _final_seal(self, report: Any, res: Any) -> Any:
        """LINE_SEAL=1: the full locked acceptance suite on main, then the run's final seal."""
        from .build.verifier import run_tests
        from .ship.merge_queue import test_name
        names: List[str] = []
        for r in self.sstore.query(E_ACC_TEST, run=self.run):
            n = test_name(r) if r.get("locked") else ""
            if n and n not in names:
                names.append(n)
        wt = self.mq._ensure_worktree(self.run)
        git(wt, "checkout", "-q", "--detach", "main", check=False)
        r = run_tests(wt, names) if names else {"rc": 0, "ran": 0, "failures": [], "output": "no locked tests"}
        suite = dict(r, cmd="python -m unittest " + " ".join(names))
        return self.seal.final(report, res, suite)

    def _qas_locked(self, fn: Callable[[], Any], wait_s: float = 600.0) -> Any:
        """fn(), retried while the QAS lock is held by someone else (deploy / runner of another process)."""
        t_end = time.monotonic() + wait_s
        while True:
            try:
                return fn()
            except LineError as e:
                if e.code != codes.STATE_CONFLICT or "QAS is locked" not in e.message or time.monotonic() > t_end:
                    raise
            self._check_cancel()
            time.sleep(1.0)

    def _quarantine(self, report: Any) -> None:
        items = [{"f_item": i.f_item, "tests": i.quarantined, "runs": i.runs, "per_test": i.tests} for i in report.flaky]
        path = os.path.join(self.workdir, "quarantine.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"run": self.run, "repeats": report.repeats, "flaky": items}, fh, indent=1)
        row = self.store.get(E_RUN, self.run) or {}
        update_row(self.store, E_RUN, self.run, {"detail": dict(row.get("detail") or {}, quarantine={
            "path": path, "tests": [t for i in items for t in i["tests"]]})})
        self.log("%s: quarantined %s" % (self.run, [t for i in items for t in i["tests"]]))


# ------------------------------------------------------------------ module helpers


def learn_after_stop(p: "Pipeline") -> Dict[str, Any]:
    """A run cancelled while nobody drove it (parked at a gate) gets no _run_end: its people's gate decisions still
    go to the store, and the retro still learns from them. Never raises."""
    from . import decisions, retro
    out: Dict[str, Any] = {}
    try:
        out["synced"] = decisions.sync(p.cfg, p.store, p.run)
        out["retro"] = retro.run(p)
    except Exception as e:   # noqa: BLE001
        out["error"] = str(e)[:300]
    return out


def run_pack(pack: str, store: Any = None, cfg: Optional[Config] = None, target: str = "", **kw: Any) -> Dict[str, Any]:
    """Admit and drive one run synchronously; returns the final run row."""
    cfg = cfg or load_config()
    if store is None:
        from .store import open_store
        store = open_store(cfg)
    p = Pipeline(store, cfg, **kw)
    run = p.admit(pack, target)
    return p.drive(run)


def drive(run_id: str, store: Any = None, cfg: Optional[Config] = None, **kw: Any) -> Dict[str, Any]:
    cfg = cfg or load_config()
    if store is None:
        from .store import open_store
        store = open_store(cfg)
    return Pipeline(store, cfg, **kw).drive(run_id)


def make_driver(store: Any, cfg: Optional[Config] = None, **kw: Any) -> Callable[[str, Dict[str, Any]], Dict[str, Any]]:
    """driver(action, payload) for line.server: "start" {"pack", "target"?} admits a run and drives it on a
    thread; "cancel" {"run", "reason"} stops a live run (or escalates one no pipeline is driving);
    "resume" {"run"} drives a non-final run from its persisted state on a thread; "resume_all" {} does
    that for every non-final run (server start with LINE_AUTO_RESUME / --resume)."""
    cfg = cfg or load_config()
    live: Dict[str, Pipeline] = {}
    threads: Dict[str, threading.Thread] = {}
    lock = threading.Lock()

    def _drive(p: Pipeline, run: str) -> None:
        while True:
            try:
                row = p.drive(run)
            except LineError as e:          # e.g. another process holds the run lease
                p.log("%s: not driven: %s" % (run, e))
                return
            if not _supervise(p, row):
                return
            from .ragmap import run_cfg     # the supervisor reopened the same run: drive its next attempt here
            rp = str(((store.get(E_RUN, run) or {}).get("detail") or {}).get("rag_project") or "")
            p = Pipeline(store, run_cfg(cfg, rp), **kw)
            with lock:
                live[run] = p

    def _supervise(p: Pipeline, row: Dict[str, Any]) -> bool:
        """A failed run goes to the supervisor first (line.supervisor): it runs the same run again with a hint
        (line.reopen), or leaves it to a person. -> True when the run was reopened. Never raises: without it the
        run waits for a person, as before."""
        from . import supervisor
        if (row or {}).get("state") != RunState.ESCALATED.value or not supervisor.enabled(p.cfg):
            return False
        if ((row.get("detail") or {}).get("supervisor")) or (row.get("detail") or {}).get("resolved"):
            return False
        if ((row.get("detail") or {}).get("gated") or {}).get("on"):
            return False                   # the gated flow stops at once for a person (line.gates), no retry
        try:
            d = supervisor.decide(store, p.cfg, row["id"], make_llm(p.cfg, getattr(store, "raw", store)))
            return bool(supervisor.act(store, p.cfg, row["id"], d, log=p.log).get("reopened"))
        except Exception as e:   # noqa: BLE001
            p.log("%s: supervisor failed: %s" % (row.get("id"), e))
            return False

    def _launch(p: Pipeline, run: str) -> None:
        t = threading.Thread(target=_drive, args=(p, run), name="line-run-" + run, daemon=True)
        with lock:
            live[run] = p
            threads[run] = t
        t.start()

    def start(payload: Dict[str, Any]) -> Dict[str, Any]:
        from .ragmap import run_cfg
        p = Pipeline(store, run_cfg(cfg, str(payload.get("rag_project") or "")), **kw)   # the project's store project
        run = p.admit(str(payload["pack"]), str(payload.get("target") or ""))
        extra = {k: str(payload[k])[:200] for k in ("actor", "name", "flow", "project", "rag_project", "lane", "retry_of", "supervised",
                                                     "rewrite_tests", "level", "level_by")
                 if payload.get(k)}
        if payload.get("human_mode") in ("ask", "decide"):
            extra["human_mode"] = payload["human_mode"]
        if isinstance(payload.get("process"), (str, dict)) and payload.get("process"):
            extra["process"] = payload["process"]          # line.process: an id or a whole definition for this run
        if extra:
            row = store.get(E_RUN, run) or {}
            update_row(store, E_RUN, run, {"detail": dict(row.get("detail") or {}, **extra)})
        _launch(p, run)
        return {"run": run, "state": RunState.ADMITTED.value}

    def resume(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Drive a non-final run on. A run an operator paused is only resumed by an explicit resume
        (payload "explicit": true, the :resume route); internal resumes (answers, sign-off, auto resume) skip it."""
        run = str(payload.get("run") or "")
        row = store.get(E_RUN, run)
        if row is None:
            raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
        if row.get("state") in TERMINAL_RUN_STATES:
            raise LineError(codes.STATE_CONFLICT, "run %s is already %s" % (run, row["state"]),
                            {"run": run, "state": row["state"]})
        paused = (row.get("detail") or {}).get("paused")
        if paused and not payload.get("explicit"):
            return {"run": run, "state": row["state"], "resuming": False, "paused": True}
        with lock:
            t = threads.get(run)
        if t is not None and t.is_alive():
            if paused:                       # still stopping from the pause: resume once it has stopped
                t.join(timeout=float(cfg.cancel_join_s) + 5)
            if t.is_alive():
                return {"run": run, "state": row["state"], "resuming": False, "live": True}
        if paused:
            row = store.get(E_RUN, run) or row
            detail = dict(row.get("detail") or {})
            detail.pop("paused", None)
            update_row(store, E_RUN, run, {"detail": detail})
            StateMachine(store, cfg.agent_version, cfg.model).em.run_event(
                run, codes.RUN_RESUMED, {"by": str(payload.get("actor") or ""), "state": row.get("state")})
        from .ragmap import run_cfg
        rp = str((row.get("detail") or {}).get("rag_project") or "")
        _launch(Pipeline(store, run_cfg(cfg, rp), **kw), run)
        return {"run": run, "state": row["state"], "resuming": True}

    def pause(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Operator pause at any time: no new work is dispatched, running model calls are stopped at once, the
        run keeps its state and resumes from there (also after a server restart; auto resume skips it)."""
        run = str(payload.get("run") or "")
        who = str(payload.get("actor") or "")
        row = store.get(E_RUN, run)
        if row is None:
            raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
        if row.get("state") in TERMINAL_RUN_STATES:
            raise LineError(codes.STATE_CONFLICT, "run %s is already %s" % (run, row["state"]),
                            {"run": run, "state": row["state"]})
        detail = dict(row.get("detail") or {})
        if detail.get("paused"):
            return {"run": run, "state": row["state"], "paused": True, "stopping": False}
        detail["paused"] = {"by": who, "ms": now_ms(), "reason": str(payload.get("reason") or "operator")}
        detail.pop("hook_hold", None)
        update_row(store, E_RUN, run, {"detail": detail})
        with lock:
            p, t = live.get(run), threads.get(run)
        stopping = bool(p is not None and t is not None and t.is_alive())
        if stopping:
            p._pause("operator pause" + (" by " + who if who else ""))     # the pipeline emits run.paused
        else:
            StateMachine(store, cfg.agent_version, cfg.model).em.run_event(
                run, codes.RUN_PAUSED, {"reason": "operator pause" + (" by " + who if who else ""),
                                        "state": row.get("state")})
        return {"run": run, "state": row["state"], "paused": True, "stopping": stopping}

    def pause_all(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Urgent stop: every non-final run is paused at once (its running agents are killed); each one can
        be resumed later on its own. -> {"paused": [run ids], "stopping": [those that were running]}."""
        paused, stopping = [], []
        for r in store.query(E_RUN):
            if r.get("state") in TERMINAL_RUN_STATES or (r.get("detail") or {}).get("paused"):
                continue
            try:
                out = pause({"run": r["id"], "actor": payload.get("actor") or "",
                             "reason": str(payload.get("reason") or "urgent stop")})
            except LineError:                       # finished in the meantime
                continue
            paused.append(r["id"])
            if out.get("stopping"):
                stopping.append(r["id"])
        return {"paused": paused, "stopping": stopping}

    def resume_all(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Every non-final run of the store (server start with auto-resume). A migration that is not parked
        or final is resumed as a whole (it drives its own build run, which is then skipped here)."""
        from .migrate import FINAL as MIG_FINAL
        out = []
        owned = set()
        for mrow in store.query(E_MIGRATION):
            if mrow.get("state") in MIG_FINAL:
                continue
            if mrow.get("run"):
                owned.add(mrow["run"])
            if mrow.get("state") != "parked":
                out.append(migrate_resume({"migration": mrow["id"]}))
        for r in store.query(E_RUN):
            if r.get("state") not in TERMINAL_RUN_STATES and r["id"] not in owned                     and not (r.get("detail") or {}).get("paused"):
                out.append(resume({"run": r["id"]}))
        return {"resumed": out}

    # ------------------------------------------------------------------ feature migration (flow 4)

    def _migrator() -> Any:
        from .migrate import Migrator
        return Migrator(store, cfg, log=kw.get("log"),
                        pipeline_factory=lambda c=None: Pipeline(store, c or cfg, **kw))

    def _launch_migration(mid: str) -> None:
        def go() -> None:
            try:
                _migrator().drive(mid)
            except LineError as e:
                (kw.get("log") or (lambda m: None))("%s: not driven: %s" % (mid, e))
        key = "migration:" + mid
        with lock:
            t = threads.get(key)
            if t is not None and t.is_alive():
                return
            t = threading.Thread(target=go, name="line-" + key, daemon=True)
            threads[key] = t
        t.start()

    def migrate_start(payload: Dict[str, Any]) -> Dict[str, Any]:
        mid = _migrator().admit(payload)
        _launch_migration(mid)
        return {"migration": mid, "state": "admitted"}

    def migrate_answer(payload: Dict[str, Any]) -> Dict[str, Any]:
        mid = str(payload.get("migration") or "")
        res = _migrator().answer(mid, payload.get("answers") or [], who=str(payload.get("who") or ""))
        if res["resume"]:
            _launch_migration(mid)
            res["resumed"] = True
        return res

    def migrate_resume(payload: Dict[str, Any]) -> Dict[str, Any]:
        mid = str(payload.get("migration") or "")
        if store.get(E_MIGRATION, mid) is None:
            raise LineError(codes.NOT_FOUND, "migration %s" % mid, {"migration": mid})
        res = _migrator().reopen(mid, payload.get("max_usd"), payload.get("max_usd_repo"),
                                 rescan=bool(payload.get("rescan")))
        if res.get("resuming"):
            _launch_migration(mid)
        return res

    def cancel(payload: Dict[str, Any]) -> Dict[str, Any]:
        run = str(payload.get("run") or "")
        reason = str(payload.get("reason") or "operator")
        row = store.get(E_RUN, run)
        if row is None:
            raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
        if row.get("state") in TERMINAL_RUN_STATES:
            raise LineError(codes.STATE_CONFLICT, "run %s is already %s" % (run, row["state"]),
                            {"run": run, "state": row["state"]})
        with lock:
            p, t = live.get(run), threads.get(run)
        if p is not None and t is not None and t.is_alive():
            p.cancel(reason)
            return {"run": run, "state": row["state"], "cancelling": True}
        StateMachine(store, cfg.agent_version, cfg.model).escalate_run(run, codes.CANCELLED, "cancelled: " + reason,
                                                                         {"reason": reason})
        drop_hook_hold(store, run)
        # nobody drives it (parked, or the engine restarted), so no _run_end: take its locked tests back here
        stub = types.SimpleNamespace(store=store, run=run, log=lambda m: None,
                                     repo=str((row.get("detail") or {}).get("target") or ""))
        Pipeline._drop_failed_tests(stub, store.get(E_RUN, run) or row)

        def learn() -> None:                       # what people decided at its gates still teaches the agents
            try:
                from .ragmap import run_cfg
                r0 = store.get(E_RUN, run) or row
                p = Pipeline(store, run_cfg(cfg, str((r0.get("detail") or {}).get("rag_project") or "")), **kw)
                p.run = run
                p._setup(r0)
                p.repo = str((r0.get("detail") or {}).get("target") or "")
                learn_after_stop(p)
            except Exception:   # noqa: BLE001 - learning never breaks a cancel
                pass
        threading.Thread(target=learn, name="learn-%s" % run, daemon=True).start()
        return {"run": run, "state": RunState.ESCALATED.value, "cancelling": False}

    def hook_test(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Admin > Run hooks > Test: the hook once on an existing run (line.hooks.test), on a thread."""
        run = str(payload.get("run") or "")
        row = store.get(E_RUN, run)
        if row is None:
            raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})

        def make_pipe(r: str) -> Pipeline:
            from .ragmap import run_cfg
            rp = str((row.get("detail") or {}).get("rag_project") or "")
            p = Pipeline(store, run_cfg(cfg, rp), **kw)
            p.run = r
            p._setup(store.get(E_RUN, r) or row)
            p.repo = str((row.get("detail") or {}).get("target") or "")
            return p

        try:
            return run_hooks.test(make_pipe, int(payload.get("hook") or 0), run)
        except KeyError:
            raise LineError(codes.NOT_FOUND, "hook %s" % payload.get("hook"), {"hook": payload.get("hook")})

    def retro(payload: Dict[str, Any]) -> Dict[str, Any]:
        """POST /api/runs/{run}:retro: the retrospective agent on a finished, failed run, in the background."""
        from . import agent_memory
        run = str(payload.get("run") or "")
        row = store.get(E_RUN, run)
        if row is None:
            raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
        if row.get("state") != RunState.ESCALATED.value:
            raise LineError(codes.STATE_CONFLICT, "run %s is %s: only a failed run has something to learn"
                            % (run, row.get("state")), {"run": run, "state": row.get("state")})
        from .ragmap import run_cfg
        p = Pipeline(store, run_cfg(cfg, str((row.get("detail") or {}).get("rag_project") or "")), **kw)
        p.run = run
        p._setup(row)
        p.repo = str((row.get("detail") or {}).get("target") or "")
        return dict(agent_memory.retro_after_failure(p), run=run)

    def driver(action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if action == "hook_test":
            return hook_test(payload)
        if action == "retro":
            return retro(payload)
        if action == "start":
            return start(payload)
        if action == "cancel":
            return cancel(payload)
        if action == "resume":
            return resume(payload)
        if action == "pause":
            return pause(payload)
        if action == "resume_all":
            return resume_all(payload)
        if action == "pause_all":
            return pause_all(payload)
        if action == "migrate_start":
            return migrate_start(payload)
        if action == "migrate_answer":
            return migrate_answer(payload)
        if action == "migrate_resume":
            return migrate_resume(payload)
        raise LineError(codes.NOT_FOUND, "unknown action %r" % (action,), {"action": action})

    driver.live = live            # type: ignore[attr-defined]
    driver.threads = threads      # type: ignore[attr-defined]
    from . import changequeue     # a run parked at a draft gate is woken when the queue moves under its draft
    changequeue.WAKER = lambda run: resume({"run": run})
    return driver


__all__ = ["Pipeline", "Cancelled", "Escalate", "run_pack", "drive", "make_driver", "init_target", "new_run_id",
           "learn_after_stop"]
