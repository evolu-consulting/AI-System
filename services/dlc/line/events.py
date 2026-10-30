"""Event helpers: envelopes, an emitter with line defaults, and the board projection.

    from line.events import Emitter, envelope, project
    em = Emitter(store, agent_version=cfg.agent_version, model=cfg.model)
    em.run_event("R1", codes.RUN_ADMITTED, {"pack": path})
    em.unit_event(unit_row, codes.UNIT_SUBMITTED, {...}, epoch=lease.epoch)
    board = project(store.events_after(0, run="R1"))

The board is a pure projection of events: run state from run.admitted / run.state, unit state
from unit.state, plus counters. Nothing on the board is read from records.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Mapping, Optional

from . import codes
from .codes import LineError
from .contracts import E_RUN, Envelope, Event, RunState, to_dict


def envelope(run: str, unit: str = "", attempt: int = 0, epoch: int = 0, agent_version: str = "",
             model: str = "", spec_hash: str = "") -> Envelope:
    """A validated Envelope (run-level events: unit="", attempt=0, epoch=0)."""
    env = Envelope(run, unit, int(attempt), int(epoch), agent_version, model, spec_hash)
    env.validate()
    return env


class Emitter:
    """Fills envelope fields the caller does not know (agent_version, model, spec_hash of the run)."""

    def __init__(self, store: Any, agent_version: str = "line-0.1", model: str = ""):
        self.store = store
        self.agent_version = agent_version
        self.model = model

    def spec_hash(self, run: str) -> str:
        row = self.store.get(E_RUN, run)
        return str((row or {}).get("spec_hash", "") or "")

    def run_env(self, run: str, model: Optional[str] = None) -> Envelope:
        return envelope(run, "", 0, 0, self.agent_version, self.model if model is None else model, self.spec_hash(run))

    def unit_env(self, unit: Mapping[str, Any], epoch: Optional[int] = None, attempt: Optional[int] = None,
                 model: Optional[str] = None) -> Envelope:
        """Envelope for a unit row (dict of contracts.Unit). epoch=None -> 0 (unfenced, e.g. watchdog)."""
        m = model if model is not None else (unit.get("model") or self.model)
        return envelope(unit["run"], unit["id"], unit.get("attempt", 0) if attempt is None else attempt,
                        0 if epoch is None else epoch, self.agent_version, m, self.spec_hash(unit["run"]))

    def run_event(self, run: str, kind: str, body: Optional[Mapping[str, Any]] = None, model: Optional[str] = None) -> int:
        return self.store.emit(kind, self.run_env(run, model), body or {})

    def unit_event(self, unit: Mapping[str, Any], kind: str, body: Optional[Mapping[str, Any]] = None,
                   epoch: Optional[int] = None, attempt: Optional[int] = None, model: Optional[str] = None) -> int:
        return self.store.emit(kind, self.unit_env(unit, epoch, attempt, model), body or {})


# ------------------------------------------------------------------ projection


def event_dict(ev: Event) -> Dict[str, Any]:
    return to_dict(ev)


def check_gapless(events: Iterable[Event], start: int = 1) -> None:
    """Raise LineError(STATE_CONFLICT) if seqs are not start, start+1, ... with no gap."""
    want = start
    for ev in events:
        if ev.seq != want:
            raise LineError(codes.STATE_CONFLICT, "event seq gap: expected %d got %d" % (want, ev.seq),
                            {"expected": want, "got": ev.seq})
        want += 1


#: unit milestone kinds -> the unit state they imply (builders emit these without a unit.state event)
_MILESTONE_STATE = {
    codes.UNIT_DISPATCHED: "leased",
    codes.UNIT_SUBMITTED: "submitted",
    codes.UNIT_BLOCKED: "waiting",
    codes.UNIT_MERGED: "merged",
}


def project(events: Iterable[Event], board: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Fold events into a board dict. Pass the previous board to fold incrementally.

    {"last_seq": int,
     "runs": {run: {"state", "spec_hash", "units": {unit: {"state", "attempt", "epoch", "model", "code"}},
                    "counts": {kind: n}, "usd_warn": [node], "escalations": [body], "degraded": bool}}}
    """
    b = board if board is not None else {"last_seq": 0, "runs": {}}
    for ev in events:
        if ev.seq <= b["last_seq"]:
            continue
        b["last_seq"] = ev.seq
        run = b["runs"].setdefault(ev.env.run, {"state": "", "spec_hash": "", "units": {}, "counts": {},
                                                "usd_warn": [], "escalations": [], "degraded": False})
        run["counts"][ev.kind] = run["counts"].get(ev.kind, 0) + 1
        if ev.env.spec_hash:
            run["spec_hash"] = ev.env.spec_hash
        body = ev.body or {}
        if ev.kind == codes.RUN_ADMITTED and not run["state"]:
            run["state"] = RunState.ADMITTED.value
        elif ev.kind == codes.RUN_STATE:
            run["state"] = body.get("to", run["state"])
        elif ev.kind == codes.BUDGET_WARN:
            run["usd_warn"].append(body.get("node"))
        elif ev.kind == codes.ESCALATED:
            run["escalations"].append(dict(body, unit=ev.env.unit))
        elif ev.kind == codes.RAG_DEGRADED_KIND:
            run["degraded"] = True
        elif ev.kind == codes.RAG_RESTORED:
            run["degraded"] = False
        if ev.env.unit:
            u = run["units"].setdefault(ev.env.unit, {"state": "", "attempt": 0, "epoch": 0, "model": "", "code": ""})
            u["attempt"] = max(u["attempt"], ev.env.attempt)
            if ev.env.epoch:
                u["epoch"] = ev.env.epoch
            if ev.env.model:
                u["model"] = ev.env.model
            if ev.kind == codes.UNIT_STATE:
                u["state"] = body.get("to", u["state"])
                if body.get("code"):
                    u["code"] = body["code"]
            elif ev.kind in _MILESTONE_STATE:      # milestones that imply a unit state
                u["state"] = _MILESTONE_STATE[ev.kind]
            elif ev.kind in (codes.VERIFY_FAILED, codes.UNIT_REQUEUED) and body.get("code"):
                u["code"] = body["code"]
    return b


__all__ = ["envelope", "Emitter", "event_dict", "check_gapless", "project"]
