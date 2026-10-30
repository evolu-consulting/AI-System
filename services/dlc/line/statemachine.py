"""Run / unit state machine helpers: CAS transition + event emission (works on any contracts.Store).

    from line.statemachine import StateMachine
    sm = StateMachine(store, agent_version=cfg.agent_version, model=cfg.model)
    sm.admit_run(Run("R1", pack_path))                              # put + run.admitted
    sm.advance_run("R1", RunState.UNDERSTANDING)                     # CAS from current + run.state
    sm.advance_run("R1", RunState.GREEN, extra=[(codes.RUN_GREEN, {})])
    lease = sm.dispatch_unit("U1", leases, owner="builder-1")       # ready -> leased, unit.dispatched
    sm.advance_unit("U1", UnitState.SUBMITTED, epoch=lease.epoch,
                    extra=[(codes.UNIT_SUBMITTED, {...})])          # fenced on the lease epoch

Every state change emits RUN_STATE / UNIT_STATE {"from","to"[,"code"]} (the board projection
reads those) followed by the caller's extra milestone events. Unit rows are keyed by Unit.id
(contracts.unit_lease_name(unit.id) is the unit's lease).

Ordering: a fenced unit change (epoch > 0) checks the lease BEFORE the transition, so a builder
with a stale epoch changes nothing; the store re-checks on emit. Row updates that ride along with
a transition (updates=...) are applied with a CAS put right after it.
"""

from __future__ import annotations

import enum
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

from . import codes
from .codes import LineError
from .contracts import (
    E_ESCALATION, E_RUN, E_UNIT, Lease, Run, RunState, Unit, UnitState, to_dict, unit_lease_name,
)
from .events import Emitter

State = Union[str, enum.Enum]
Extra = Sequence[Tuple[str, Mapping[str, Any]]]


def _sv(x: Any) -> str:
    return x.value if isinstance(x, enum.Enum) else str(x)


def _exp(expect_from: Any, current: str) -> List[str]:
    if expect_from is None:
        return [current]
    if isinstance(expect_from, (str, enum.Enum)):
        return [_sv(expect_from)]
    return [_sv(x) for x in expect_from]


def update_row(store: Any, entity: str, id: str, updates: Mapping[str, Any], retries: int = 5) -> Dict[str, Any]:
    """Merge top-level fields into a row with a CAS put (retried on STATE_CONFLICT)."""
    for _ in range(max(retries, 1)):
        ver = store.version(entity, id)
        row = store.get(entity, id)
        if row is None:
            raise LineError(codes.NOT_FOUND, "%s/%s" % (entity, id), {"entity": entity, "id": id})
        row.update(to_dict(dict(updates)))
        try:
            store.put(entity, id, row, if_version=ver)
            return row
        except LineError as e:
            if e.code != codes.STATE_CONFLICT:
                raise
    raise LineError(codes.STATE_CONFLICT, "could not update %s/%s" % (entity, id), {"entity": entity, "id": id})


class StateMachine:
    def __init__(self, store: Any, agent_version: str = "line-0.1", model: str = ""):
        self.store = store
        self.em = Emitter(store, agent_version, model)

    # ------------------------------------------------------------ runs

    def admit_run(self, run: Union[Run, Mapping[str, Any]], body: Optional[Mapping[str, Any]] = None) -> int:
        """Create the run row in state admitted and emit run.admitted. Returns its seq."""
        row = to_dict(run) if isinstance(run, Run) else dict(run)
        row["state"] = RunState.ADMITTED.value
        if self.store.get(E_RUN, row["id"]) is not None:
            raise LineError(codes.STATE_CONFLICT, "run %s exists" % row["id"], {"id": row["id"]})
        self.store.put(E_RUN, row["id"], row, run=row["id"], if_version=0)
        return self.em.run_event(row["id"], codes.RUN_ADMITTED, dict(body or {"pack_path": row.get("pack_path", "")}))

    def advance_run(self, run_id: str, to: State, expect_from: Any = None, *, extra: Extra = (),
                    updates: Optional[Mapping[str, Any]] = None, body: Optional[Mapping[str, Any]] = None
                    ) -> Dict[str, Any]:
        """CAS run_id from expect_from (default: its current state) to `to`; emit run.state + extra.
        Raises NOT_FOUND / STATE_CONFLICT / ILLEGAL_TRANSITION."""
        cur = self.store.get(E_RUN, run_id)
        if cur is None:
            raise LineError(codes.NOT_FOUND, "run/%s" % run_id, {"entity": E_RUN, "id": run_id})
        row = self.store.transition(E_RUN, run_id, to, _exp(expect_from, cur["state"]))
        frm, to_s = cur["state"], _sv(to)
        if updates:
            row = update_row(self.store, E_RUN, run_id, updates)
        self.em.run_event(run_id, codes.RUN_STATE, dict(body or {}, **{"from": frm, "to": to_s}))
        for kind, b in extra:
            self.em.run_event(run_id, kind, b)
        return row

    def escalate_run(self, run_id: str, code: str, message: str = "", detail: Optional[Mapping[str, Any]] = None
                     ) -> Dict[str, Any]:
        """Any non-terminal run -> escalated, with an escalation record and the escalated event."""
        if code not in codes.ALL_CODES:
            raise ValueError("unknown code %r" % (code,))
        cur = self.store.get(E_RUN, run_id)
        if cur is None:
            raise LineError(codes.NOT_FOUND, "run/%s" % run_id, {"entity": E_RUN, "id": run_id})
        esc = {"code": code, "message": message or code, "detail": dict(detail or {}), "run": run_id,
               "from": cur["state"]}           # line.reopen takes a retried run back to this state
        row = self.advance_run(run_id, RunState.ESCALATED, cur["state"],
                               updates={"detail": dict(cur.get("detail") or {}, escalation=esc)},
                               body={"code": code}, extra=[(codes.ESCALATED, esc)])
        self.store.put(E_ESCALATION, "%s:run" % run_id, esc, run=run_id)
        return row

    # ------------------------------------------------------------ units

    def put_unit(self, unit: Union[Unit, Mapping[str, Any]]) -> int:
        row = to_dict(unit) if isinstance(unit, Unit) else dict(unit)
        return self.store.put(E_UNIT, row["id"], row, run=row["run"])

    def _fence(self, unit_id: str, epoch: int) -> None:
        if epoch > 0:
            leases = getattr(self.store, "leases", None)
            if leases is not None:
                leases.check(unit_lease_name(unit_id), epoch)

    def advance_unit(self, unit_id: str, to: State, expect_from: Any = None, *, epoch: int = 0,
                     code: str = "", extra: Extra = (), updates: Optional[Mapping[str, Any]] = None
                     ) -> Dict[str, Any]:
        """CAS unit_id to `to`; emit unit.state {"from","to"[,"code"]} + extra, fenced on epoch (> 0)."""
        cur = self.store.get(E_UNIT, unit_id)
        if cur is None:
            raise LineError(codes.NOT_FOUND, "unit/%s" % unit_id, {"entity": E_UNIT, "id": unit_id})
        self._fence(unit_id, epoch)
        row = self.store.transition(E_UNIT, unit_id, to, _exp(expect_from, cur["state"]))
        if updates:
            row = update_row(self.store, E_UNIT, unit_id, updates)
        body: Dict[str, Any] = {"from": cur["state"], "to": _sv(to)}
        if code:
            body["code"] = code
        self.em.unit_event(row, codes.UNIT_STATE, body, epoch=epoch)
        for kind, b in extra:
            self.em.unit_event(row, kind, b, epoch=epoch)
        return row

    def release_ready(self, run_id: str, merged: Optional[Iterable[str]] = None) -> List[str]:
        """pending units whose deps are all merged -> ready. Returns the unit ids moved."""
        units = self.store.query(E_UNIT, run=run_id)
        done = set(merged) if merged is not None else {u["id"] for u in units if u["state"] == UnitState.MERGED.value}
        moved = []
        for u in units:
            if u["state"] == UnitState.PENDING.value and all(d in done for d in u.get("deps") or []):
                try:
                    self.advance_unit(u["id"], UnitState.READY, UnitState.PENDING)
                    moved.append(u["id"])
                except LineError as e:
                    if e.code != codes.STATE_CONFLICT:
                        raise
        return moved

    def dispatch_unit(self, unit_id: str, leases: Any, owner: str, ttl_s: Optional[int] = None,
                      model: Optional[str] = None) -> Optional[Lease]:
        """Lease a ready unit: acquire unit_lease_name(unit) (None if held), ready -> leased,
        attempt += 1, epoch = lease epoch, emit unit.state + unit.dispatched (fenced).
        The lease is released again if the unit was not ready (STATE_CONFLICT re-raised)."""
        lease = leases.acquire(unit_lease_name(unit_id), owner, ttl_s)
        if lease is None:
            return None
        moved = False
        try:
            cur = self.store.get(E_UNIT, unit_id)
            if cur is None:
                raise LineError(codes.NOT_FOUND, "unit/%s" % unit_id, {"entity": E_UNIT, "id": unit_id})
            m = model or cur.get("model") or self.em.model
            self.store.transition(E_UNIT, unit_id, UnitState.LEASED, UnitState.READY)
            moved = True
            row = update_row(self.store, E_UNIT, unit_id,
                             {"attempt": int(cur.get("attempt", 0)) + 1, "epoch": lease.epoch, "model": m})
            self.em.unit_event(row, codes.UNIT_STATE, {"from": UnitState.READY.value, "to": UnitState.LEASED.value},
                               epoch=lease.epoch)
            self.em.unit_event(row, codes.UNIT_DISPATCHED, {"owner": owner, "rung": row.get("rung", 0),
                                                           "expires_ms": lease.expires_ms}, epoch=lease.epoch)
            return lease
        except BaseException:
            if not moved:            # once leased, expiry + watchdog own the recovery
                leases.release(lease)
            raise


__all__ = ["StateMachine", "update_row"]
