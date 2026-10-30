"""Watchdog (expired leases) and the loop breaker (retry ladder).

    from line.watchdog import Watchdog
    wd = Watchdog(store, leases, cfg)          # cfg: line.config.Config (retry_n, model, model_alt, ...)
    wd.tick()                                  # every cfg.watchdog_s (or wd.start() for a thread)
    d = wd.record_failure("U3", codes.TEST_FAIL, fingerprint=gate.fingerprint)
    d.action                                   # "retry" | "switch_model" | "escalate"

Expired lease of a unit (name unit:<id>, see contracts.unit_lease_name):
  lease.expired {"name","epoch"} -> unit leased -> ready (unit.state code LEASE_LOST) with
  detail.resume_from = detail.checkpoint -> unit.requeued {"code": LEASE_LOST, "from": "leased"}
  -> attempt record (if any) outcome "lost" -> lease reaped. Watchdog events carry epoch 0 (the
  expired epoch is in the body), so they are not fenced by the dead lease.

Retry ladder (plan blocks 3 + 12), one rung per stage:
  rung 0 RETRY        same model, retry with evidence
  rung 1 SWITCH_MODEL cfg.model_alt
  rung 2 ESCALATE     unit -> failed, escalated event + escalation record
A rung allows up to retry_n failures; a failure whose fingerprint already occurred on the
current rung moves to the next rung at once (the loop breaker: same fingerprint twice). An
escalation caused by a repeated fingerprint carries code NO_PROGRESS, otherwise the last failure
code. The rung and the failure history (detail.failures) are recorded on the unit row.

A unit BLOCKED because a locked acceptance test is wrong or the machine stops it (blocked_kind 'test' /
'host') escalates at the first BLOCKED with BLOCKED_OUTSIDE_CLAIMS and detail.blocked_kind; BLOCKED never
climbs to the alternate model (switching model does not change what stops the agent).
A unit BLOCKED twice in a row for the same cause (same_block: the agent's own words differ from one
attempt to the next, so the fingerprint does not catch it) escalates at once with
BLOCKED_OUTSIDE_CLAIMS: the cause lies outside what the unit may change (the host, locked acceptance
tests, another unit's work), and another attempt or a pricier model only spends the budget again.

ONE ladder for every failure kind: the verifier (gate failures), the pipeline (BLOCKED, LLM error,
merge conflict) and Watchdog.record_failure all go through plan_failure / apply_failure on the same
detail.failures history, so the failed attempts on a rung never exceed retry_n whatever mix of
failures caused them. A lost lease is not a failure of the attempt (requeue only, not counted).
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

from . import codes
from .codes import LineError
from .contracts import E_ATTEMPT, E_ESCALATION, E_UNIT, Lease, UnitState, unit_lease_name
from .statemachine import StateMachine, update_row

RUNG_RETRY = 0
RUNG_SWITCH_MODEL = 1
RUNG_ESCALATE = 2
RUNG_NAMES = {RUNG_RETRY: "retry", RUNG_SWITCH_MODEL: "switch_model", RUNG_ESCALATE: "escalate"}

UNIT_LEASE_PREFIX = unit_lease_name("")


@dataclass
class LadderDecision:
    action: str                 # "retry" | "switch_model" | "escalate"
    rung: int                   # rung the next attempt runs on (2 = escalated)
    reason: str                 # "retry" | "repeat" (same fingerprint) | "exhausted" (retry_n reached)
    code: str                   # failure code (NO_PROGRESS for a repeat escalation)
    model: str = ""             # model of the next attempt ("" when escalated)
    failures: List[Dict[str, Any]] = field(default_factory=list)
    from_rung: int = 0          # rung the failed attempt ran on
    failure_code: str = ""      # code of the failure itself
    fingerprint: str = ""


def decide(history: Sequence[Mapping[str, Any]], fingerprint: str, rung: int, retry_n: int) -> tuple:
    """Pure ladder step. history = earlier failures [{"rung","fingerprint",...}] of the unit.
    Returns (next_rung, reason)."""
    on_rung = [h for h in history if int(h.get("rung", 0)) == rung]
    if fingerprint and any(h.get("fingerprint") == fingerprint for h in on_rung):
        return min(rung + 1, RUNG_ESCALATE), "repeat"
    if len(on_rung) + 1 >= max(int(retry_n), 1):
        return min(rung + 1, RUNG_ESCALATE), "exhausted"
    return rung, "retry"


_WORD = re.compile(r"winerror \d+|[a-z][a-z0-9_./-]*[a-z0-9]")
_FILLER = frozenset("the and that this with from which both are can not cannot can't for its it's into when while "
                    "has have was were will via also none does doesn't don't yet".split())
_OUTSIDE = re.compile(r"outside (my|the unit'?s|\w+'s) claims|not fixable in|none of which (is|are) (fixable|mine)",
                      re.I)
SAME_BLOCK = 0.4            # share of the shorter reason's words found in the other one


def _words(text: str) -> set:
    return {w for w in _WORD.findall((text or "").lower()) if len(w) >= 3 and w not in _FILLER}


def same_block(a: str, b: str) -> bool:
    """Do two BLOCKED reasons of one unit name the same cause? Most of the words of the shorter one are in the
    other, or both say the fix lies outside the unit's claims."""
    if _OUTSIDE.search(a or "") and _OUTSIDE.search(b or ""):
        return True
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= SAME_BLOCK


_LOCKED_TEST = re.compile(r"(locked|acceptance)\s+tests?\b|tests/acceptance/|\btest_\w+\.py\b.*\b(locked|outside)|"
                          r"the (fix|test) (must|has to|belongs).{0,40}\btest", re.I)
_HOST = re.compile(r"winerror \d+|not installed|command not found|is not recognized|no such (file|command).{0,20}"
                   r"(npm|node|python|java)|permission denied|on this host|cannot (start|run|launch) the app|"
                   r"enoent|eacces|network (is )?(down|unreachable)|could not resolve host", re.I)


def blocked_kind(reason: str) -> str:
    """What a BLOCKED reason says stops the unit, when no retry of it can help: 'test' (a locked acceptance test
    is wrong), 'host' (the machine or tools), 'claims' (the fix lies in files of another unit). '' otherwise."""
    r = reason or ""
    if _LOCKED_TEST.search(r):
        return "test"
    if _HOST.search(r):
        return "host"
    if _OUTSIDE.search(r):
        return "claims"
    return ""


#: one lock for every ladder step of the process (watchdog thread, builder threads, pipeline loop)
LADDER_LOCK = threading.RLock()


def plan_failure(unit: Mapping[str, Any], code: str, fingerprint: str, retry_n: int, model: str = "",
                 model_alt: str = "", detail: Optional[Mapping[str, Any]] = None) -> LadderDecision:
    """Pure: the ladder decision for one more failure of `unit` (a unit row). The ONE per-unit failure
    history is unit.detail.failures, whatever failed (verify gate, BLOCKED, LLM error, merge conflict),
    so at most retry_n failed attempts run on a rung. decision.failures is the history including this one."""
    udetail = dict(unit.get("detail") or {})
    history = list(udetail.get("failures") or [])
    rung = int(unit.get("rung", 0) or 0)
    nxt, reason = decide(history, fingerprint, rung, retry_n)
    last = history[-1] if history else {}
    detail = dict(detail or {})
    kind = blocked_kind(str(detail.get("key") or "")) if code == codes.BLOCKED else ""
    if kind:
        detail["blocked_kind"] = kind
    if kind in ("test", "host"):
        nxt, reason = RUNG_ESCALATE, "blocked_outside"       # a retry cannot fix a locked test or the machine
    elif code == codes.BLOCKED and last.get("code") == codes.BLOCKED and same_block(
            str((last.get("detail") or {}).get("key") or ""), str(detail.get("key") or "")):
        nxt, reason = RUNG_ESCALATE, "blocked_again"
    history.append({"attempt": int(unit.get("attempt", 0) or 0), "rung": rung, "fingerprint": fingerprint,
                    "code": code, "detail": detail})
    if nxt >= RUNG_ESCALATE:
        esc_code = {"repeat": codes.NO_PROGRESS, "blocked_again": codes.BLOCKED_OUTSIDE_CLAIMS,
                    "blocked_outside": codes.BLOCKED_OUTSIDE_CLAIMS}.get(reason, code)
        return LadderDecision("escalate", RUNG_ESCALATE, reason, esc_code, "", history, rung, code, fingerprint)
    # BLOCKED never climbs to the alternate model: the agent said what stops it, a pricier model reads the same
    m = model_alt if nxt >= RUNG_SWITCH_MODEL and model_alt and code != codes.BLOCKED else (unit.get("model") or model)
    action = RUNG_NAMES[nxt] if nxt != rung else "retry"
    return LadderDecision(action, nxt, reason, code, m, history, rung, code, fingerprint)


def apply_failure(store: Any, unit_id: str, d: LadderDecision, *, sm: Any = None, leases: Any = None,
                  esc_code: str = "", message: str = "", ready_ms: Optional[int] = None) -> Dict[str, Any]:
    """Write a plan_failure() decision: release the unit lease, then unit -> ready (rung, model,
    failures, ready_ms; unit.requeued) or unit -> failed (escalated event + escalation record).
    Returns the unit row."""
    sm = sm or StateMachine(store)
    unit = store.get(E_UNIT, unit_id)
    if unit is None:
        raise LineError(codes.NOT_FOUND, "unit/%s" % unit_id, {"entity": E_UNIT, "id": unit_id})
    udetail = dict(unit.get("detail") or {})
    udetail["failures"] = list(d.failures)
    state = unit.get("state")
    if leases is not None:
        # the failed attempt's lease (held from dispatch until now) ends here: its epoch is
        # fenced out and the next attempt gets a fresh grant
        cur = leases.current(unit_lease_name(unit_id))
        if cur is not None:
            leases.release(cur)
    if d.action == "escalate":
        code = esc_code or d.code
        if code == codes.BLOCKED_OUTSIDE_CLAIMS and not message:
            fd = d.failures[-1].get("detail") or {}
            why = str(fd.get("key") or "")
            why = why[len("blocked:"):] if why.startswith("blocked:") else why
            what = {"test": "a locked acceptance test is wrong", "host": "the machine or its tools stop it",
                    "claims": "the fix lies in another unit's files"}.get(str(fd.get("blocked_kind") or ""))
            message = ("unit %s is BLOCKED: %s; another attempt cannot fix that, a person decides: %s"
                       % (unit_id, what, why) if what else
                       "unit %s was BLOCKED twice for the same cause, which it cannot fix within its claims (the "
                       "host, locked acceptance tests or another unit's work); a person decides: %s" % (unit_id, why))
        body = {"code": code, "failure_code": d.failure_code, "reason": d.reason, "fingerprint": d.fingerprint,
                "rung": d.from_rung, "attempts": len(d.failures)}
        bk = (d.failures[-1].get("detail") or {}).get("blocked_kind") if d.failures else ""
        if bk:
            body["blocked_kind"] = bk
        row = sm.advance_unit(unit_id, UnitState.FAILED, state, code=code,
                              updates={"rung": RUNG_ESCALATE, "detail": udetail}, extra=[(codes.ESCALATED, body)])
        store.put(E_ESCALATION, "%s:%s" % (unit.get("run", ""), unit_id),
                  {"code": code, "message": message or "unit %s escalated (%s)" % (unit_id, d.reason),
                   "detail": body, "unit": unit_id, "run": unit.get("run", "")}, run=unit.get("run", ""))
        return row
    if ready_ms is not None:
        udetail["ready_ms"] = int(ready_ms)
    updates = {"rung": d.rung, "model": d.model, "detail": udetail}
    if state in (UnitState.SUBMITTED.value, UnitState.LEASED.value, UnitState.WAITING.value):
        return sm.advance_unit(unit_id, UnitState.READY, state, code=d.failure_code, updates=updates,
                               extra=[(codes.UNIT_REQUEUED, {"code": d.failure_code, "from": state, "rung": d.rung,
                                                             "model": d.model, "reason": d.reason,
                                                             "fingerprint": d.fingerprint})])
    return update_row(store, E_UNIT, unit_id, updates)


def record_failure(store: Any, unit_id: str, code: str, fingerprint: str = "",
                   detail: Optional[Mapping[str, Any]] = None, *, retry_n: int = 3, model: str = "",
                   model_alt: str = "", sm: Any = None, leases: Any = None) -> LadderDecision:
    """plan_failure + apply_failure under LADDER_LOCK."""
    if code not in codes.ALL_CODES:
        raise ValueError("unknown code %r" % (code,))
    with LADDER_LOCK:
        unit = store.get(E_UNIT, unit_id)
        if unit is None:
            raise LineError(codes.NOT_FOUND, "unit/%s" % unit_id, {"entity": E_UNIT, "id": unit_id})
        d = plan_failure(unit, code, fingerprint, retry_n, model, model_alt, detail)
        apply_failure(store, unit_id, d, sm=sm, leases=leases)
        return d


def failures_on_rung(unit: Mapping[str, Any], rung: Optional[int] = None) -> int:
    """Failed attempts recorded on `rung` (default: the unit's current rung)."""
    r = int(unit.get("rung", 0) or 0) if rung is None else int(rung)
    return sum(1 for h in (unit.get("detail") or {}).get("failures") or [] if int(h.get("rung", 0)) == r)


class Watchdog:
    def __init__(self, store: Any, leases: Any, cfg: Any = None, *, retry_n: Optional[int] = None,
                 model: Optional[str] = None, model_alt: Optional[str] = None,
                 agent_version: Optional[str] = None, interval_s: Optional[float] = None):
        self.store = store
        self.leases = leases
        self.retry_n = int(retry_n if retry_n is not None else getattr(cfg, "retry_n", 3))
        self.model = model if model is not None else getattr(cfg, "model", "")
        self.model_alt = model_alt if model_alt is not None else getattr(cfg, "model_alt", "")
        av = agent_version if agent_version is not None else getattr(cfg, "agent_version", "line-0.1")
        self.interval_s = float(interval_s if interval_s is not None else getattr(cfg, "watchdog_s", 15))
        self.sm = StateMachine(store, av, self.model)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        #: extra jobs run after every tick of the thread (e.g. understand_plus.on_tick: question reminders)
        self.extra: List[Any] = []

    # ------------------------------------------------------------ lookups

    def _unit(self, unit_id: str) -> Optional[Dict[str, Any]]:
        row = self.store.get(E_UNIT, unit_id)
        if row is not None:
            return row
        hits = [u for u in self.store.query(E_UNIT, id=unit_id)]
        live = [u for u in hits if u.get("state") == UnitState.LEASED.value]
        return (live or hits or [None])[-1]

    # ------------------------------------------------------------ expiry

    def tick(self, now_ms: Optional[int] = None) -> List[Dict[str, Any]]:
        """Handle every expired, unreaped lease. Returns one report dict per lease."""
        out = []
        with self._lock:
            for lease in self.leases.expired(now_ms):
                out.append(self._expire(lease))
        return out

    def _expire(self, lease: Lease) -> Dict[str, Any]:
        rep: Dict[str, Any] = {"lease": lease.name, "epoch": lease.epoch, "unit": "", "action": "reaped"}
        try:
            if not lease.name.startswith(UNIT_LEASE_PREFIX):
                return rep
            unit_id = lease.name[len(UNIT_LEASE_PREFIX):]
            rep["unit"] = unit_id
            unit = self._unit(unit_id)
            if unit is None:
                rep["action"] = "no_unit"
                return rep
            # store key of the unit: the lease's id when it names the row directly (run-scoped
            # "unit:<run>:<unit>" leases, see line.scope), else the row's own id
            key = unit_id if self.store.get(E_UNIT, unit_id) is not None else unit["id"]
            self.sm.em.unit_event(unit, codes.LEASE_EXPIRED, {"name": lease.name, "epoch": lease.epoch}, epoch=0)
            if unit.get("state") != UnitState.LEASED.value or int(unit.get("epoch", 0)) not in (0, lease.epoch):
                rep["action"] = "stale"          # unit already moved on (submitted, re-leased ...)
                return rep
            detail = dict(unit.get("detail") or {})
            ckpt = detail.get("checkpoint")
            detail["resume_from"] = ckpt
            detail.setdefault("lost_epochs", []).append(lease.epoch)
            try:
                self.sm.advance_unit(key, UnitState.READY, UnitState.LEASED, code=codes.LEASE_LOST,
                                     updates={"detail": detail},
                                     extra=[(codes.UNIT_REQUEUED, {"code": codes.LEASE_LOST, "from": UnitState.LEASED.value,
                                                                   "epoch": lease.epoch, "checkpoint": ckpt})])
            except LineError as e:
                if e.code != codes.STATE_CONFLICT:
                    raise
                rep["action"] = "stale"
                return rep
            att_id = "%s#%d" % (key, int(unit.get("attempt", 0)))
            if self.store.get(E_ATTEMPT, att_id) is not None:
                update_row(self.store, E_ATTEMPT, att_id, {"outcome": "lost", "code": codes.LEASE_LOST,
                                                           "ended_ms": lease.expires_ms})
            rep["action"] = "requeued"
            return rep
        finally:
            self.leases.reap(lease)

    # ------------------------------------------------------------ loop breaker

    def record_failure(self, unit_id: str, code: str, fingerprint: str = "",
                       detail: Optional[Mapping[str, Any]] = None) -> LadderDecision:
        """Record a failed attempt of unit_id and move it along the ladder (module record_failure()).

        The unit lease (if live) is released. retry / switch_model: unit -> ready (from submitted|leased|waiting),
        rung + model recorded, unit.requeued emitted. escalate: unit -> failed + escalated event +
        escalation record."""
        return record_failure(self.store, unit_id, code, fingerprint, detail, retry_n=self.retry_n,
                              model=self.model, model_alt=self.model_alt, sm=self.sm, leases=self.leases)

    # ------------------------------------------------------------ thread

    def start(self) -> "Watchdog":
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="line-watchdog", daemon=True)
        self._thread.start()
        return self

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self.tick()
            except Exception:   # keep the watchdog alive; next tick retries
                pass
            for job in list(self.extra):
                try:
                    job()
                except Exception:   # noqa: BLE001 - an extra job never stops the watchdog
                    pass

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)


__all__ = ["Watchdog", "LadderDecision", "decide", "plan_failure", "apply_failure", "record_failure",
           "failures_on_rung", "same_block", "LADDER_LOCK", "RUNG_RETRY", "RUNG_SWITCH_MODEL", "RUNG_ESCALATE", "RUNG_NAMES"]
