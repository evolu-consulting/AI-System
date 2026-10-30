"""Retry a failed run in place (Rowan, 2026-10-25): a retry never makes a new run; the run that failed goes back
to the state it failed in and continues from the failed step, as attempt n+1 of the same run.

    reopen(store, cfg, run, hint, actor, by="person", level_up=False, rewrite_tests=()) -> {"run", "attempt", "to", ...}
    notes_text(detail) -> the people's / supervisor's notes of the earlier attempts, for the agents' prompts

What a reopen does, on the run row (detail) and its target:
  * detail.attempts += {n, code, message, from, by, actor, hint, level, spent_usd, ms}: the failure it retries;
    detail.escalation, resolved, supervisor and explain move into that entry (the run is no longer failed)
  * the hint is appended to the pack's spec.md ("## Note ... attempt n") and kept in detail.retry_notes; the
    solo / gated agents read spec.md, the team's builders get notes_text() with their frozen spec
  * the budget grows by the run's first budget (each attempt has the budget a new run used to have)
  * the lane's own counters start again; what was finished stays:
      gated: the approved gates stay; the build rounds of the failed attempt move to build.earlier
      solo: the unmerged build is dropped (built), so the agent builds again with the note
      team: failed units go back to ready on rung 0 (their failures kept in detail.failures_earlier); the fixer
            gets fresh generations (Fixer reads len(detail.attempts)); a run whose locked tests were reverted
            on main when it failed gets them back through Pipeline._earlier_tests (detail.retest), the F-items in
            rewrite_tests written again
  * level_up (the supervisor judged the failure major): detail.level = level + 1 (level_by retry) and the
    sizing is made again; when the new level leaves the solo lane, the run starts again from understanding
    (same run id; the solo attempt kept in detail.attempts)
  * the run moves escalated -> the state it failed in (run.state + run.reopened events)

Refused (ValueError): a run that is not escalated, one a person marked resolved, a run whose request is gone.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List

from . import codes
from .contracts import E_ACC_TEST, E_LLM_CALL, E_RUN, E_UNIT, RunState, UnitState, now_ms
from .scope import unit_key
from .statemachine import StateMachine, update_row

MAX_NOTES = 6
_ANALYSIS = "\n## Analysis (spec analyst)"
#: states a run may go back to (the one it failed in); anything else starts again from understanding
_BACK_TO = (RunState.UNDERSTANDING.value, RunState.PLANNING.value, RunState.BUILDING.value,
            RunState.INTEGRATING.value, RunState.QAS.value)


def _from_state(store: Any, run: str, esc: Dict[str, Any]) -> str:
    frm = str(esc.get("from") or "")
    if not frm:                                  # escalated by an engine older than esc.from: read the event
        try:
            for e in store.events_after(0, run=run, kinds=[codes.RUN_STATE], limit=100000):
                body = e.get("body") if isinstance(e, dict) else getattr(e, "body", {})
                if (body or {}).get("to") == RunState.ESCALATED.value:
                    frm = str((body or {}).get("from") or "")
        except Exception:   # noqa: BLE001
            frm = ""
    return frm if frm in _BACK_TO else RunState.UNDERSTANDING.value


def notes_text(detail: Dict[str, Any]) -> str:
    rows = [n for n in detail.get("retry_notes") or [] if str(n.get("hint") or "").strip()][-MAX_NOTES:]
    if not rows:
        return ""
    out = ["NOTES FOR THIS ATTEMPT (the run failed before and was started again; follow them):"]
    for n in rows:
        out.append("- after attempt %s failed (%s), %s: %s" % (n.get("n"), n.get("code") or "?", n.get("by") or "a person",
                                                              str(n["hint"]).strip()))
    return "\n".join(out) + "\n"


def _note_in_spec(pack: str, n: int, who: str, hint: str, cut_analysis: bool) -> None:
    path = os.path.join(pack, "spec.md")
    with open(path, encoding="utf-8") as fh:
        spec = fh.read()
    if cut_analysis:                             # the run is understood again: the analyst writes it anew
        cut = spec.find(_ANALYSIS)
        if cut >= 0:
            spec = spec[:cut].rstrip() + "\n"
    if hint.strip():
        spec = spec.rstrip() + "\n\n## Note from %s after attempt %d failed\n\n%s\n" % (who, n, hint.strip())
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(spec)


def _grow_budget(store: Any, cfg: Any, run: str, add: float) -> None:
    from .budget import SqliteBudget
    raw = getattr(store, "raw", store)
    if not hasattr(raw, "tx") or add <= 0:
        return
    SqliteBudget(raw, agent_version=getattr(cfg, "agent_version", "line-0.1"), emit=False).extend(run, add)


def _units_again(store: Any, sm: StateMachine, run: str) -> List[str]:
    """Failed units back to ready on rung 0 (FAILED is final for the ladder, so a plain versioned put)."""
    out = []
    for u in store.query(E_UNIT, run=run):
        if u.get("state") != UnitState.FAILED.value:
            continue
        d = dict(u.get("detail") or {})
        d["failures_earlier"] = list(d.get("failures_earlier") or []) + list(d.get("failures") or [])
        d["failures"] = []
        row = dict(u, state=UnitState.READY.value, rung=0, detail=d)
        key = unit_key(run, str(u["id"]))
        store.put(E_UNIT, key, row, run=run, if_version=store.version(E_UNIT, key))
        sm.em.unit_event(row, codes.UNIT_STATE, {"from": UnitState.FAILED.value, "to": UnitState.READY.value,
                                                  "code": codes.RUN_REOPENED})
        out.append(u["id"])
    return out


def _tests_reverted(repo: str, run: str, sha: str) -> bool:
    from .ship._util import git, git_out
    if not repo or not sha or not os.path.isdir(repo):
        return False
    log = git_out(repo, "log", "--format=%s", "-n", "50", "HEAD") or ""
    return ('Revert "line %s: acceptance tests (locked)"' % run) in log and \
        git(repo, "merge-base", "--is-ancestor", sha, "HEAD", check=False).returncode == 0


def reopen(store: Any, cfg: Any, run: str, hint: str = "", actor: str = "", by: str = "person",
           level_up: bool = False, rewrite_tests: Iterable[str] = ()) -> Dict[str, Any]:
    row = store.get(E_RUN, run)
    if row is None:
        raise KeyError(run)
    if row.get("state") != RunState.ESCALATED.value:
        raise ValueError("only a failed run can be run again (run %s is %s)" % (run, row.get("state")))
    d = dict(row.get("detail") or {})
    if d.get("resolved"):
        raise ValueError("run %s was marked resolved by %s" % (run, d["resolved"].get("by") or "a person"))
    pack = str(row.get("pack_path") or "")
    if not os.path.isfile(os.path.join(pack, "spec.md")):
        raise ValueError("the request of run %s is no longer on disk (%s)" % (run, pack))
    esc = dict(d.get("escalation") or {})
    to = _from_state(store, run, esc)
    attempts = list(d.get("attempts") or [])
    n = len(attempts) + 1                        # the attempt that failed
    who = actor or ("the supervisor" if by == "supervisor" else "a person")
    hint = (hint or "").strip()
    sizing = dict(d.get("sizing") or {})
    try:
        level = int(sizing.get("level") or 0)
    except (TypeError, ValueError):
        level = 0
    try:
        spent = round(sum(float(c.get("usd", 0) or 0) for c in store.query(E_LLM_CALL, run=run)), 4)
    except Exception:   # noqa: BLE001
        spent = 0.0
    entry = {"n": n, "code": esc.get("code") or "", "message": str(esc.get("message") or "")[:600], "from": to,
             "by": by, "actor": who, "hint": hint[:2000], "level": level or None, "spent_usd": spent, "ms": now_ms()}
    for k in ("supervisor", "explain"):
        if d.get(k):
            entry[k] = d.pop(k)
    d.pop("escalation", None)
    d.pop("retried_by", None)
    attempts.append(entry)
    d["attempts"] = attempts
    d["retry_notes"] = list(d.get("retry_notes") or []) + [{"n": n, "code": entry["code"], "by": who, "hint": hint}]
    out: Dict[str, Any] = {"run": run, "attempt": n + 1, "from": RunState.ESCALATED.value}

    new_level = level + 1 if level_up and 1 <= level < 4 else 0
    restart = False
    if (d.get("gated") or {}).get("on"):                     # the gated flow: approvals stay, new build rounds
        g = dict(d["gated"])
        b = dict(g.get("build") or {})
        if not b.get("merged"):
            b = {"earlier": list(b.get("earlier") or []) + [list(b.get("rounds") or [])]}
            g["build"] = b
            for k in ("findings", "report"):
                g.pop(k, None)
        d["gated"] = g
    elif sizing.get("lane") == "solo" or d.get("solo"):       # the solo lane: build again with the note
        s = dict(d.get("solo") or {})
        if not s.get("merged") and not (entry.get("supervisor") or {}).get("engine_fault"):
            s.pop("built", None)                 # an engine fault: the build was fine, QAS runs it again
        d["solo"] = s
        if new_level:
            from .understand.sizer import lane_for
            restart = lane_for(new_level, cfg) != "solo"
            if restart:
                d["solo_earlier"] = list(d.get("solo_earlier") or []) + [d.pop("solo")]
    if new_level:
        d["sizing_earlier"] = list(d.get("sizing_earlier") or []) + [sizing]
        d.pop("sizing", None)
        d["level"], d["level_by"] = str(new_level), "retry"
        entry["level_up"] = new_level
        out["level"] = new_level
    if restart:
        to = RunState.UNDERSTANDING.value
    rewrite = [str(x) for x in rewrite_tests if str(x).strip()]
    sha = str(d.get("tests_commit") or "")
    if sha and (rewrite or _tests_reverted(str(d.get("target") or ""), run, sha)):
        # the failed run's tests were reverted on main (or some must be written again): the next drive restores
        # the ones that still fit (Pipeline._earlier_tests) and the test author writes the named F-items again
        own = [r for r in store.query(E_ACC_TEST, run=run) if r.get("locked")]
        d["retest"] = {"sha": sha, "rewrite": rewrite, "note": hint, "tests": own}
        d.pop("tests_commit", None)
        for r in own:
            key = unit_key(run, str(r.get("id") or ""))
            if store.get(E_ACC_TEST, key) is not None:
                update_row(store, E_ACC_TEST, key, {"locked": False})
        if to in (RunState.BUILDING.value, RunState.INTEGRATING.value, RunState.QAS.value):
            to = RunState.PLANNING.value         # the tests are made before the build goes on
    try:
        _note_in_spec(pack, n, who, hint, cut_analysis=restart)
    except OSError as e:
        raise ValueError("the request of run %s cannot be written: %s" % (run, e))
    first = float(d.get("budget_first") or row.get("budget_usd") or getattr(cfg, "max_usd_run", 0) or 0)
    d["budget_first"] = first
    sm = StateMachine(store, getattr(cfg, "agent_version", "line-0.1"), getattr(cfg, "model", ""))
    ver = store.version(E_RUN, run)
    new = dict(store.get(E_RUN, run) or row, state=to, detail=d,
               budget_usd=round(float(row.get("budget_usd") or first) + first, 4))
    if restart:                                  # the team reads the request again: the pack (with the note) is
        new["spec_hash"] = ""                    # frozen anew, the analyst runs, the readers see the note
    store.put(E_RUN, run, new, run=run, if_version=ver)        # ESCALATED is final for the transition table
    _grow_budget(store, cfg, run, first)
    if not (d.get("gated") or {}).get("on") and not d.get("solo"):
        out["units"] = _units_again(store, sm, run)
    sm.em.run_event(run, codes.RUN_STATE, {"from": RunState.ESCALATED.value, "to": to})
    body = {"attempt": n + 1, "from": RunState.ESCALATED.value, "to": to, "by": who}
    if new_level:
        body.update(level=new_level, level_up=True)
    sm.em.run_event(run, codes.RUN_REOPENED, body)
    from . import changequeue                    # run again: a new slot at the end of the project's change queue
    slot = changequeue.requeue(store, run)
    if slot:
        out["queue_slot"] = slot["seq"]
    out["to"] = to
    return out


__all__ = ["reopen", "notes_text"]
