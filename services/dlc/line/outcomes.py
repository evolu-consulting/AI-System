"""What every agent of a run claimed and how it turned out, in one place, for the calibration retro (line.retro).

Every agent learns by the same mechanism (docs/dlc/learning.md 4): its persona goes in front of its prompt in the
LLM port, and the retro judges it from this record. Two sources, no per-agent code in the retro:

    ledger      automatic: every model call is already in the run's ledger (E_LLM_CALL: role, op, outcome,
                usd); an agent that only calls the model is still listed with its calls
    record()    explicit: an agent adds what it measured or claimed, e.g.
                    outcomes.record(store, run, "solo_reviewer", misses_per_round=[2, 0])
                an agent whose verdict is settled only by a LATER run (the supervisor's hint, the explainer's
                cause) records on the failed run; the retry run's retro reads the parent's record next to its
                own result (from_failed_run)

    read(store, run) -> {role: {"calls", "usd", "outcomes", ...facts, "from_failed_run"?}}

Never raises from record(); a missing record only means the retro sees the ledger part.
"""

from __future__ import annotations

from typing import Any, Dict

from .contracts import E_LLM_CALL, E_RUN

#: how much of each fact the retro gets
MAX_TEXT = 600
MAX_LIST = 8


def _trim(v: Any) -> Any:
    if isinstance(v, str):
        return v[:MAX_TEXT]
    if isinstance(v, (list, tuple)):
        return [_trim(x) for x in list(v)[:MAX_LIST]]
    if isinstance(v, dict):
        return {str(k): _trim(x) for k, x in list(v.items())[:20]}
    return v


def record(store: Any, run: str, role: str, **facts: Any) -> None:
    """Merge facts into detail.outcomes[role] of the run (later keys win)."""
    if not (store is not None and run and role and facts):
        return
    try:
        from .statemachine import update_row
        row = store.get(E_RUN, run) or {}
        if not row:
            return
        detail = dict(row.get("detail") or {})
        outs = dict(detail.get("outcomes") or {})
        outs[role] = dict(outs.get(role) or {}, **{k: _trim(v) for k, v in facts.items()})
        detail["outcomes"] = outs
        update_row(store, E_RUN, run, {"detail": detail})
    except Exception:   # noqa: BLE001 - the record helps the retro; it never fails the agent
        pass


def _ledger(store: Any, run: str) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    try:
        rows = store.query(E_LLM_CALL, run=run) or []
    except Exception:   # noqa: BLE001
        return out
    for r in rows:
        role = str(r.get("role") or "")
        if not role:
            continue
        a = out.setdefault(role, {"calls": 0, "usd": 0.0, "outcomes": []})
        a["calls"] += 1
        a["usd"] = round(a["usd"] + float(r.get("usd") or 0), 4)
        if r.get("outcome") or r.get("error"):
            a["outcomes"] = (a["outcomes"] + [str(r.get("outcome") or r.get("error"))[:80]])[-MAX_LIST:]
    return out


def read(store: Any, run: str) -> Dict[str, Dict[str, Any]]:
    """Every role that worked on the run (ledger) with its recorded facts, plus the roles that recorded on the run
    this one retried (their claim is judged by this run's result)."""
    row = store.get(E_RUN, run) or {}
    detail = row.get("detail") or {}
    out = _ledger(store, run)
    for role, facts in (detail.get("outcomes") or {}).items():
        out.setdefault(role, {"calls": 0, "usd": 0.0, "outcomes": []}).update(facts)
    parent = str(detail.get("retry_of") or "")
    if parent:
        pdetail = (store.get(E_RUN, parent) or {}).get("detail") or {}
        esc = (detail.get("escalation") or {}).get("code") or ""
        for role, facts in (pdetail.get("outcomes") or {}).items():
            if not facts.get("judged_by_retry"):
                continue
            out[role + "@" + parent] = dict(facts, role=role, from_failed_run=parent,
                                            this_run_result=row.get("state"), this_run_escalation=esc)
    return out


__all__ = ["record", "read"]
