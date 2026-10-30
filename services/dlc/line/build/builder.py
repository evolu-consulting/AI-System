"""Builder (block 11): dispatch a READY unit under a fenced lease and run one agentic attempt.

dispatch(unit, store, leases, sandbox, cfg) -> (Unit, Lease) | None
    acquire unit_lease_name(unit) (None when another holder is live), READY -> LEASED (CAS),
    create / reuse the unit's worktree, attempt += 1, model = unit.model or config.model,
    store Attempt <unit>#<n>, emit UNIT_DISPATCHED fenced with the lease epoch.

run_builder(unit, lease, llm, store, leases=..., cfg=...) -> BuildResult
    builder prompt (claims, locked tests, evidence of the previous failed attempt) ->
    llm.agentic("builder", worktree, ...) while a heartbeat thread renews the lease every
    config.heartbeat_s. Outcome:
      SUBMIT            LEASED -> SUBMITTED, UNIT_SUBMITTED (fenced), lease released
      BLOCKED:<reason>  LEASED -> WAITING,  UNIT_BLOCKED {"reason"} (fenced), lease released
      lease lost        nothing written by the stale holder; Attempt.outcome = "lost"
                        (the watchdog owns the unit now)
      LLM_ERROR         LEASED -> READY, UNIT_REQUEUED {"code","from"}
      BUDGET_EXCEEDED   LEASED -> FAILED, UNIT_STATE {"from","to","code"}
    The builder never decides "done": the verifier does (verifier.verify).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .. import codes, stacks
from ..codes import LineError
from ..config import Config
from ..contracts import (
    E_ACC_TEST, E_ATTEMPT, E_UNIT, AccTest, Attempt, Lease, Unit, UnitState, from_dict, to_dict, unit_lease_name,
)
from ._common import cfg_or_default, clock_ms, env, load_prompt, load_unit, save_unit


@dataclass
class BuildResult:
    outcome: str                 # "SUBMIT" | "BLOCKED" | "LOST" | "ERROR"
    unit: str
    attempt: int
    reason: str = ""             # BLOCKED reason or error message
    code: str = ""               # LineError code on ERROR / LOST
    usd: float = 0.0
    text: str = ""


def attempt_id(unit_id: str, n: int) -> str:
    return "%s#%d" % (unit_id, n)


def model_for_rung(rung: int, cfg: Config) -> str:
    return cfg.model_alt if rung >= 1 else cfg.model


def _update_attempt(store: Any, unit: Unit, n: int, **fields: Any) -> None:
    aid = attempt_id(unit.id, n)
    row = store.get(E_ATTEMPT, aid)
    a = from_dict(Attempt, row) if row else Attempt(unit=unit.id, n=n)
    detail = dict(a.detail)
    detail.update(fields.pop("detail", {}) or {})
    for k, v in fields.items():
        setattr(a, k, v)
    a.detail = detail
    out = to_dict(a)
    out["run"] = unit.run
    store.put(E_ATTEMPT, aid, out, run=unit.run)


def dispatch(unit: Any, store: Any, leases: Any, sandbox: Any, cfg: Optional[Config] = None,
             owner: str = "builder", seal: Any = None) -> Optional[Tuple[Unit, Lease]]:
    """seal (line.seal.wire.RunSeal, LINE_SEAL=1): claim() takes the per-file claims (fenced leases) before
    the unit lease is used; started() freezes the gates and stacks speculative producers once the worktree
    exists. None = unchanged behaviour."""
    cfg = cfg_or_default(cfg)
    u = load_unit(store, unit)
    lease = leases.acquire(unit_lease_name(u.id), owner, cfg.lease_ttl_s)
    if lease is None:
        return None
    if seal is not None and not seal.claim(u, u.attempt + 1):
        leases.release(lease)
        return None
    try:
        store.transition(E_UNIT, u.id, UnitState.LEASED, UnitState.READY)
    except LineError:
        leases.release(lease)
        raise
    worktree = sandbox.create(u)
    n = u.attempt + 1
    model = u.model or model_for_rung(u.rung, cfg)
    u = save_unit(store, u, attempt=n, epoch=lease.epoch, model=model, worktree=worktree)
    a = to_dict(Attempt(unit=u.id, n=n, model=model, epoch=lease.epoch, rung=u.rung, started_ms=clock_ms(store)))
    a["run"] = u.run
    store.put(E_ATTEMPT, attempt_id(u.id, n), a, run=u.run)
    store.emit(codes.UNIT_DISPATCHED, env(u.run, cfg, unit=u.id, attempt=n, epoch=lease.epoch, model=model),
               {"wave": u.wave, "rung": u.rung, "worktree": worktree, "owner": owner})
    if seal is not None:
        seal.started(u, n, worktree, builder="fixer" if int(u.fixer_gen or 0) > 0 else "builder")
    return u, lease


class Heartbeat:
    """Renews a lease every interval_s on a daemon thread; .lost is set when a renew fails."""

    def __init__(self, leases: Any, lease: Lease, interval_s: float, ttl_s: Optional[int] = None):
        self.leases = leases
        self.lease = lease
        self.interval_s = max(float(interval_s), 0.001)
        self.ttl_s = ttl_s
        self.lost: Optional[LineError] = None
        self.renewals = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._loop, name="heartbeat-" + lease.name, daemon=True)

    def _loop(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self.lease = self.leases.renew(self.lease, self.ttl_s)
                self.renewals += 1
            except LineError as e:
                self.lost = e
                return
            except Exception as e:  # transport trouble: try again next beat
                if self._stop.is_set():
                    return
                continue

    def __enter__(self) -> "Heartbeat":
        self._t.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        self._t.join(timeout=5)


def _tests_of(store: Any, unit: Unit) -> List[AccTest]:
    out = []
    for tid in unit.tests:
        row = store.get(E_ACC_TEST, tid)
        if row:
            out.append(from_dict(AccTest, row))
    return out


def _test_command(worktree: str, names: List[str]) -> str:
    """The command the builder may run itself (its prompt); the target stack decides (line.stacks)."""
    st = stacks.for_repo(worktree)
    if st.is_python:
        return "python -m unittest " + " ".join(names) if names else "python -m unittest"
    return st.test_cmd(names)


def test_names(tests: List[AccTest]) -> List[str]:
    names = []
    for t in tests:
        n = t.name or t.path.replace("\\", "/").rsplit(".py", 1)[0].replace("/", ".")
        if n and n not in names:
            names.append(n)
    return names


def _evidence(store: Any, unit: Unit, n: int) -> str:
    if n <= 1:
        return "(first attempt)"
    row = store.get(E_ATTEMPT, attempt_id(unit.id, n - 1))
    if not row or not row.get("code"):
        return "(previous attempt left no failure evidence)"
    ev = (row.get("detail") or {}).get("evidence") or ""
    return "Previous attempt %d failed with %s.\n%s" % (n - 1, row["code"], ev)


def judge_evidence(unit: Unit) -> str:
    """Evidence the judge attached to a fixer unit (unit.detail.judge_evidence, line.review.judge): the
    judged decision that QAS proved wrong, its quotes and the failing tests."""
    evs = (unit.detail or {}).get("judge_evidence")
    if not evs:
        return ""
    lines: List[str] = []
    for ev in evs if isinstance(evs, list) else [evs]:
        if not isinstance(ev, dict):
            continue
        lines.append("A judged decision on this F-item was proven wrong by QAS (decision %s, choice %s)."
                     % (ev.get("decision", "?"), ev.get("choice", "?")))
        if ev.get("failing"):
            lines.append("Failing tests: %s" % ", ".join(str(x) for x in ev["failing"]))
        for q in ev.get("quotes") or []:
            lines.append("Spec quote: %s" % (q.get("quote") if isinstance(q, dict) else q))
        if ev.get("instructions"):
            lines.append("The ruling said: %s" % ev["instructions"])
        for f in ev.get("overruled_findings") or []:
            lines.append("Overruled finding: %s" % (f.get("issue") if isinstance(f, dict) else f))
    return "\n".join(lines)


def _tail(text: str, n: int = 1500) -> str:
    """End of the builder's final message, kept on the attempt record for diagnosis."""
    return (text or "")[-n:]


def parse_outcome(res: Any) -> str:
    out = (getattr(res, "outcome", "") or "").strip()
    if out:
        return out
    lines = [l.strip() for l in (getattr(res, "text", "") or "").splitlines() if l.strip()]
    last = lines[-1] if lines else ""
    return last if last == "SUBMIT" or last.startswith("BLOCKED:") else "SUBMIT"


def run_builder(unit: Any, lease: Lease, llm: Any, store: Any, *, leases: Any, cfg: Optional[Config] = None,
                contracts: str = "", context: str = "", spec: str = "") -> BuildResult:
    cfg = cfg_or_default(cfg)
    u = load_unit(store, unit)
    n = max(u.attempt, 1)
    ep = lease.epoch
    tests = _tests_of(store, u)
    names = test_names(tests)
    prompt = load_prompt(
        "builder", unit_id=u.id, title=u.title or u.id, run=u.run, attempt=n,
        f_items=", ".join(u.f_items) or "(none)", claims=", ".join(u.claims) or "(none)",
        test_files=", ".join(sorted({t.path for t in tests})) or "(none)",
        tests="\n".join("- %s (%s): %s" % (t.id, t.criterion, t.name or t.path) for t in tests) or "(none)",
        test_command=_test_command(u.worktree, names),
        contracts=contracts or "(none)",
        evidence="\n\n".join(x for x in (_evidence(store, u, n), judge_evidence(u)) if x),
        context=context or "(none)",
        spec=spec or "(not given)",
    )
    e = env(u.run, cfg, unit=u.id, attempt=n, epoch=ep, model=u.model)
    try:
        with Heartbeat(leases, lease, cfg.heartbeat_s, cfg.lease_ttl_s) as hb:
            from .deps import prepare
            prepare(u.worktree)          # node_modules installed by the engine, not in the agent's paid turns
            res = llm.agentic("builder", u.worktree, prompt, cfg.builder_max_turns, cfg.max_usd_call,
                              key="%s.%d" % (u.id, n), model=u.model or None, run=u.run)
    except LineError as err:
        return _llm_failed(store, u, n, lease, leases, cfg, err)
    lost = hb.lost
    if lost is None:
        try:
            leases.check(unit_lease_name(u.id), ep)
        except LineError as err:
            lost = err
    if lost is not None:
        _update_attempt(store, u, n, outcome="lost", code=codes.LEASE_LOST, usd=res.usd, ended_ms=clock_ms(store))
        return BuildResult("LOST", u.id, n, code=codes.LEASE_LOST, reason=lost.message, usd=res.usd, text=res.text)
    outcome = parse_outcome(res)
    moved = ""
    try:
        # fence BEFORE the state change; if the lease still runs out between the change and its fenced
        # event (the store refuses the event), the change is taken back below, so the unit never stays
        # submitted / waiting without its event and nothing in flight
        leases.check(unit_lease_name(u.id), ep)
        if outcome.startswith("BLOCKED"):
            reason = outcome.partition(":")[2].strip() or "no reason given"
            store.transition(E_UNIT, u.id, UnitState.WAITING, UnitState.LEASED)
            moved = UnitState.WAITING.value
            store.emit(codes.UNIT_BLOCKED, e, {"reason": reason})
            detail = dict(load_unit(store, u).detail)
            detail["blocked_reason"] = reason
            save_unit(store, u, detail=detail)
            _update_attempt(store, u, n, outcome="blocked", code=codes.BLOCKED, usd=res.usd,
                            ended_ms=clock_ms(store), detail={"reason": reason, "final": _tail(res.text)})
            return BuildResult("BLOCKED", u.id, n, reason=reason, usd=res.usd, text=res.text)
        store.transition(E_UNIT, u.id, UnitState.SUBMITTED, UnitState.LEASED)
        moved = UnitState.SUBMITTED.value
        store.emit(codes.UNIT_SUBMITTED, e, {"usd": res.usd, "model": res.model or u.model})
        _update_attempt(store, u, n, outcome="submitted", usd=res.usd, ended_ms=clock_ms(store),
                        detail={"final": _tail(res.text)})
        return BuildResult("SUBMIT", u.id, n, usd=res.usd, text=res.text)
    except LineError as err:
        if err.code != codes.LEASE_LOST:
            raise
        if moved:
            _take_back(store, u, n, moved, cfg)
        _update_attempt(store, u, n, outcome="lost", code=codes.LEASE_LOST, usd=res.usd, ended_ms=clock_ms(store))
        return BuildResult("LOST", u.id, n, code=codes.LEASE_LOST, reason=err.message, usd=res.usd)
    finally:
        leases.release(lease)


def _take_back(store: Any, u: Unit, n: int, frm: str, cfg: Config) -> None:
    """The fenced submit / blocked event was refused after the unit moved: back to ready (CAS from the
    state this builder set; unfenced events, epoch 0). A no-op when someone else moved it already."""
    from .scheduler import mark_ready_ms
    try:
        store.transition(E_UNIT, u.id, UnitState.READY, frm)
    except LineError:
        return
    mark_ready_ms(store, u)
    e0 = env(u.run, cfg, unit=u.id, attempt=n)
    store.emit(codes.UNIT_STATE, e0, {"from": frm, "to": UnitState.READY.value, "code": codes.LEASE_LOST})
    store.emit(codes.UNIT_REQUEUED, e0, {"code": codes.LEASE_LOST, "from": frm, "why": "fenced event refused"})


def _llm_failed(store: Any, u: Unit, n: int, lease: Lease, leases: Any, cfg: Config, err: LineError) -> BuildResult:
    from .scheduler import mark_ready_ms
    _update_attempt(store, u, n, outcome="failed", code=err.code, ended_ms=clock_ms(store),
                    detail={"evidence": err.message})
    try:
        if err.code == codes.BUDGET_EXCEEDED:
            store.transition(E_UNIT, u.id, UnitState.FAILED, UnitState.LEASED)
            store.emit(codes.UNIT_STATE, env(u.run, cfg, unit=u.id, attempt=n),
                       {"from": UnitState.LEASED.value, "to": UnitState.FAILED.value, "code": err.code})
        else:
            store.transition(E_UNIT, u.id, UnitState.READY, UnitState.LEASED)
            mark_ready_ms(store, u)
            e0 = env(u.run, cfg, unit=u.id, attempt=n)
            store.emit(codes.UNIT_STATE, e0, {"from": UnitState.LEASED.value, "to": UnitState.READY.value,
                                              "code": err.code})
            store.emit(codes.UNIT_REQUEUED, e0, {"code": err.code, "from": UnitState.LEASED.value})
    finally:
        leases.release(lease)
    return BuildResult("ERROR", u.id, n, code=err.code, reason=err.message)
