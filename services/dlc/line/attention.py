"""What a person must do for a run, in plain words, and the actions that settle it.

The board showed "Needs attention" with a code (BLOCKED_OUTSIDE_CLAIMS, NO_PROGRESS ...) and a raw event log,
and gave no way to act: questions of a parked run had no form, a failed run had no action at all, and the
warning stayed until a new run started. This module is the engine side of the run page's attention panel:

    view(store, run)                      -> {"needed", "kind", "title", "what", "why", "do", "unit", "step",
                                             "reason", "options": [...], "questions"?, "resolved"?, "explain"?}
      kind: gate (a person's decision at a step of the gated flow, line.gates) | hook (a run hook holds the run) |
            paused | questions (parked) | failed (escalated) | none
    resolve(store, cfg, run, note, actor) -> a person settled a failed run (fixed it by hand, or it is not needed):
                                             detail.resolved; the project's warning goes; the note becomes a
                                             finding in the project's knowledge (best effort)
    retry: line.reopen (POST /api/runs/{run}:retry) runs the SAME run again from the step it failed in;
                                             view() lists its earlier attempts (detail.attempts)
    explain(store, cfg, run, llm)         -> a short plain explanation of a failed run from its evidence (one
                                             cheap model call, role explainer; kept in detail.explain)

Never raises on a run it can read; an unknown code still gets a generic text.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from . import codes
from .contracts import E_ATTEMPT, E_ESCALATION, E_RUN, E_UNIT, TERMINAL_RUN_STATES, now_ms
from .statemachine import update_row

#: code -> (what happened, why it happens, what a person can do), in plain words
TEXT: Dict[str, tuple] = {
    codes.BLOCKED_OUTSIDE_CLAIMS: (
        "A builder stopped: what blocks it is outside the code it may change.",
        "The agent may only change the files of its unit. A wrong locked acceptance test, a tool missing on the "
        "machine, or code owned by another unit cannot be fixed from there, and another attempt would only spend "
        "money again.",
        "Read the reason below. Fix the test or the machine (or tell the agent how) and retry with a hint; or, "
        "if you fixed it by hand, mark it resolved."),
    codes.BLOCKED: (
        "A builder stopped and said why it cannot go on.",
        "The agent ended with BLOCKED instead of a change.",
        "Read the reason below, then retry with a hint that answers it."),
    codes.NO_PROGRESS: (
        "The same failure came back several times.",
        "Each attempt ended with the same error (or the same change), so the line stopped instead of paying for "
        "more of the same.",
        "Read the evidence below; retry with a hint about what is wrong, or change the request."),
    codes.TEST_FAIL: (
        "The unit's tests stayed red after every attempt.",
        "The builders could not make the acceptance tests pass within their attempts.",
        "Check whether the tests ask for the right thing; retry with a hint, or mark resolved after fixing by hand."),
    codes.BUILD_FAIL: (
        "The code did not build or compile.",
        "The submitted change had errors the checks found before any test ran.",
        "Retry; if it fails again, read the evidence and add a hint."),
    codes.BUDGET_EXCEEDED: (
        "The run used its whole budget.",
        "The money limit of the run (LINE_MAX_USD_RUN) was reached before the work was done.",
        "Retry with a higher budget, or split the request into smaller ones."),
    codes.LLM_ERROR: (
        "The AI model could not be reached.",
        "A model call failed: the Claude sign-in token may be revoked or expired, or the service did not answer.",
        "If the reason mentions the token, set a new one in Admin > Claude token; then retry."),
    codes.READ_DIVERGED: (
        "Two independent readings of the request disagree.",
        "The request can be read in two ways, and re-reading the unclear parts did not settle it.",
        "Make the request clearer on the points below and retry."),
    codes.TEST_UNTRACED: (
        "The acceptance tests could not be tied to the request.",
        "Every test must point to a sentence of the spec; some did not, even after one correction.",
        "Make the acceptance criteria in the request concrete and retry."),
    codes.TEST_GREEN_ON_EMPTY: (
        "An acceptance test passes even without any code.",
        "A test that passes on an empty implementation checks nothing, so it was refused.",
        "Retry; if it repeats, state the expected behaviour more precisely."),
    codes.TEST_BROKEN_HERE: (
        "An acceptance test cannot run on the test machine.",
        "Run on a copy like the QAS one before the lock, it broke for the machine (a tool, package or git), "
        "not for the missing change, and one fix round by the test author did not settle it.",
        "Read the output below; install what the tests need, or state in the request how to test it, and retry."),
    codes.SMOKE_FAIL: (
        "The built app did not start on the test environment.",
        "After merging, the deploy to QAS ran a start check that failed.",
        "Read the output below (often a missing dependency or start command); fix and retry."),
    codes.QAS_RED: (
        "Tests failed on the test environment after the fixes allowed.",
        "The QAS run stayed red after the fixer units the line may add.",
        "Read the failing tests below; retry with a hint, or fix by hand and mark resolved."),
    codes.MERGE_CONFLICT: (
        "A unit's change could not be merged into main.",
        "It changed the same lines as other work, and the merge could not be resolved.",
        "Retry; if it repeats, merge by hand and mark resolved."),
    codes.MERGE_BLOCKED: (
        "The merge agent says the unit cannot be integrated as specified.",
        "Two pieces of work contradict each other.",
        "Read the reason, decide which way is right, and retry with that as a hint."),
    codes.HOOK_STOP: (
        "A run hook stopped the run.",
        "An admin hook (Admin > Sidecars > Run hooks) answered BLOCKED and is set to stop.",
        "Fix what the hook asks for, then retry."),
    codes.CANCELLED: (
        "The run was cancelled.", "Someone (or a restart) cancelled it.", "Retry if it is still needed."),
    codes.SPEC_MISSING_FILE: (
        "The request files were not found.", "The spec pack folder or its spec.md is missing.",
        "Create the request again."),
    codes.FGRAPH_INVALID: (
        "The feature map of the request is inconsistent.",
        "Features use things no feature provides, or depend on each other in a circle.",
        "Make the request say where each piece of data comes from, and retry."),
}
GENERIC = ("The run failed.", "The line stopped at the step shown below.",
           "Read the reason; retry, or mark resolved if it is settled.")

def _detail(store: Any, run: str) -> Dict[str, Any]:
    return dict((store.get(E_RUN, run) or {}).get("detail") or {})


def _failed_unit(store: Any, run: str) -> Dict[str, Any]:
    units = [u for u in store.query(E_UNIT, run=run) if u.get("state") == "failed"]
    return units[-1] if units else {}


def _reason(unit: Dict[str, Any], esc: Dict[str, Any]) -> str:
    fails = (unit.get("detail") or {}).get("failures") or []
    if fails:
        key = str((fails[-1].get("detail") or {}).get("key") or "")
        if key.startswith("blocked:"):
            return key[len("blocked:"):].strip()
    return str((esc.get("detail") or {}).get("blocked_reason") or esc.get("message") or "")


def view(store: Any, run: str) -> Dict[str, Any]:
    row = store.get(E_RUN, run) or {}
    if not row:
        return {"needed": False, "kind": "none"}
    d = dict(row.get("detail") or {})
    state = str(row.get("state") or "")
    out: Dict[str, Any] = {"needed": False, "kind": "none", "run": run, "state": state}
    if d.get("attempts"):                       # a run retried in place (line.reopen): attempt n of the same run
        out["attempt"] = len(d["attempts"]) + 1
        out["attempts"] = [{k: a.get(k) for k in ("n", "code", "message", "by", "actor", "hint", "level", "level_up",
                                                  "ms")} for a in d["attempts"]]
    if state not in TERMINAL_RUN_STATES:
        from . import gates
        g = gates.view(store, run) if not d.get("paused") else None
        if g:
            out.update(needed=True, kind="gate", title="Step %s: %s" % (g["step"], g["title"]),
                       what="The agents finished their part; the flow waits for your decision.",
                       why="This flow asks a person at the spec, the plans and the result before it goes on.",
                       do="Read below, then decide; the run goes on by itself.", options=g["decisions"], gate=g)
        elif d.get("hook_hold"):
            h = d["hook_hold"]
            out.update(needed=True, kind="hook", title="A run hook holds this run",
                       what='Hook "%s" (%s) answered: %s' % (h.get("name") or "", h.get("event") or "",
                                                            h.get("reason") or h.get("outcome") or ""),
                       why="An admin hook (Admin > Sidecars > Run hooks) waits for something before the run goes on.",
                       do="Fix what it asks for and ask it again, or pass it by hand.",
                       options=["ask_again", "pass"], hook=h)
        elif d.get("paused"):
            p = d["paused"]
            out.update(needed=True, kind="paused", title="This run is stopped",
                       what="Stopped by %s%s." % (p.get("by") or "a person",
                                                  (": " + p["reason"]) if p.get("reason") else ""),
                       why="A stopped run keeps everything it did and waits.", do="Resume it when ready.",
                       options=["resume"])
        elif state == "parked":
            from .server import questions_view
            qv = questions_view(store, run)
            open_q = [q for q in qv.get("questions") or [] if q.get("state") in ("open", "held", "asked", None)]
            out.update(needed=True, kind="questions", title="This run waits for your answers",
                       what="%d question(s) about the request are open." % len(open_q),
                       why="The request leaves something open that the agents should not guess.",
                       do="Answer below; the run goes on by itself after the last answer.",
                       options=["answer"], questions=qv.get("questions") or [])
        return out
    if state != "escalated":
        return out
    esc = (store.query(E_ESCALATION, run=run) or [{}])[-1]
    code = str(esc.get("code") or (esc.get("detail") or {}).get("code") or "")
    unit = _failed_unit(store, run)
    what, why, do = TEXT.get(code, GENERIC)
    bk = str((esc.get("detail") or {}).get("blocked_kind") or "")
    if bk == "test":
        what = "A builder stopped: a locked acceptance test looks wrong."
    elif bk == "host":
        what = "A builder stopped: the machine or one of its tools is in the way."
    elif bk == "access":
        what = "The agent stopped: it lacks a credential, a permission or an outside system."
    elif bk == "unsafe":
        what = "The agent stopped: it judged the request unsafe to carry out."
    elif bk == "spec":
        what = "The agent stopped: it found no reasonable reading of the request."
    steps = [e for e in store.query(E_ESCALATION, run=run)]
    step = ""
    try:                                        # the board node that failed (understand, tests, build, qas ...)
        from .runview import nodes
        step = next((n["id"] for n in nodes(store, run) if n.get("state") == "failed" and n["id"] != "result"), "")
    except Exception:   # noqa: BLE001
        step = "build" if unit else ""
    out.update(needed=not d.get("resolved"), kind="failed", title="This run failed", code=code, what=what, why=why,
               do=do, unit=str(unit.get("id") or esc.get("unit") or ""), reason=_reason(unit, esc),
               step=step, options=["retry", "resolve", "explain"],
               escalations=len(steps))
    roles = (esc.get("detail") or {}).get("process_roles") or {}
    if roles.get("handler") or roles.get("supervisor"):      # line.gates: the process names who handles a stop
        out["process_roles"] = roles
        if roles.get("handler"):
            out["do"] = "Handled by %s (process %s, step %s). %s" % (roles["handler"], roles.get("process") or "",
                                                                    roles.get("step") or "", do)
    if d.get("resolved"):
        out["resolved"] = d["resolved"]
    if d.get("explain"):
        out["explain"] = d["explain"]
    if d.get("retried_by"):
        out["retried_by"] = d["retried_by"]
    if d.get("supervisor"):
        out["supervisor"] = d["supervisor"]
        if d["supervisor"].get("action") == "retry":
            out["needed"] = False             # the supervisor ran it again; the new run carries on
    return out


# ------------------------------------------------------------------ actions

def resolve(store: Any, cfg: Any, run: str, note: str, actor: str = "") -> Dict[str, Any]:
    row = store.get(E_RUN, run)
    if row is None:
        raise KeyError(run)
    if row.get("state") != "escalated":
        raise ValueError("only a failed run can be marked resolved (run %s is %s)" % (run, row.get("state")))
    note = (note or "").strip()
    if not note:
        raise ValueError("say in one line how it was settled")
    d = dict(row.get("detail") or {})
    d["resolved"] = {"by": actor or "a person", "ms": now_ms(), "note": note[:2000]}
    update_row(store, E_RUN, run, {"detail": d})
    try:                                        # what the person did is knowledge for the next runs
        from . import agent_memory
        if agent_memory.enabled(cfg):
            v = view(store, run)
            text = ("A person settled failed run %s (%s, unit %s). Reason given by the line: %s. How it was "
                    "settled: %s" % (run, v.get("code") or "?", v.get("unit") or "-", (v.get("reason") or "")[:600],
                                     note[:1200]))
            agent_memory.write(cfg, agent_memory._project(cfg, str(d.get("rag_project") or "")), "findings",
                               agent_memory.titled("FINDING", "run failure settled by a person",
                                                   "Failed run settled: %s" % (v.get("code") or "?"), text),
                               "run failure settled by a person", "person", run)
    except Exception:   # noqa: BLE001 - the note is kept on the run whatever the store says
        pass
    return {"run": run, "resolved": d["resolved"]}


EXPLAIN_SCHEMA = {"type": "object", "required": ["what", "why", "next"],
                  "properties": {"what": {"type": "string"}, "why": {"type": "string"},
                                 "next": {"type": "array", "items": {"type": "string"}}}}

EXPLAIN_PROMPT = """A delivery run of an automated software line failed. Explain it to the person who asked for the
work: someone who knows the product, not the line's internals. Plain words, no codes, no file hashes.

Return JSON: {{"what": "<what went wrong, 1-2 sentences>", "why": "<the real cause, 1-3 sentences>",
"next": ["<concrete next step the person can take>", "... at most 3"]}}

THE EVIDENCE:
{evidence}
"""


def _evidence(store: Any, run: str, limit: int = 6000) -> str:
    v = view(store, run)
    esc = (store.query(E_ESCALATION, run=run) or [{}])[-1]
    parts = ["Request: %s" % (_detail(store, run).get("name") or run), "Failure code: %s" % v.get("code"),
             "Line's message: %s" % (esc.get("message") or "")]
    ed = esc.get("detail") or {}
    out = str(ed.get("output") or ed.get("evidence") or "")
    if out:                                    # the smoke / QAS / merge output names the failing tests
        parts.append("Output of the failing check (last part):\n" + out[-3000:])
    if v.get("unit"):
        parts.append("Failed unit: %s" % v["unit"])
        for a in sorted(store.query(E_ATTEMPT, run=run), key=lambda r: int(r.get("n") or 0)):
            if a.get("unit") != v["unit"]:
                continue
            ev = str((a.get("detail") or {}).get("evidence") or "")
            parts.append("Attempt %s: %s %s %s" % (a.get("n"), a.get("outcome") or "", a.get("code") or "",
                                                   ev[:800]))
    if v.get("reason"):
        parts.append("The agent's own reason: %s" % v["reason"])
    text = "\n".join(parts)
    return text[:limit]


def explain(store: Any, cfg: Any, run: str, llm: Any) -> Dict[str, Any]:
    d = _detail(store, run)
    if d.get("explain"):
        return d["explain"]
    if (store.get(E_RUN, run) or {}).get("state") != "escalated":
        raise ValueError("only a failed run is explained")
    res = llm.complete("explainer", EXPLAIN_PROMPT.format(evidence=_evidence(store, run)), EXPLAIN_SCHEMA,
                       key="explain", run="")
    data = res.data if isinstance(res.data, dict) else {}
    out = {"what": str(data.get("what") or ""), "why": str(data.get("why") or ""),
           "next": [str(x) for x in (data.get("next") or [])][:3], "usd": round(float(res.usd or 0), 4),
           "ms": now_ms()}
    d = _detail(store, run)
    d["explain"] = out
    update_row(store, E_RUN, run, {"detail": d})
    from . import outcomes                     # a retry of this run judges the cause it named (line.outcomes)
    outcomes.record(store, run, "explainer", judged_by_retry=True, said_what=out["what"], said_why=out["why"],
                    said_next=out["next"])
    return out


__all__ = ["TEXT", "view", "resolve", "explain"]
