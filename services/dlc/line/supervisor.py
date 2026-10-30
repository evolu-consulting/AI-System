"""The supervisor: an agent that settles a failed run before a person is asked; people only for what matters.

Most stops of a run are small decisions (two readings of the spec disagree, a locked acceptance test is wrong,
the same failure came back, the app did not start on QAS, a merge conflict). A person used to have to open the
run, read the evidence and start it again. Now, when a run ends escalated, the driver asks the supervisor:

    d = decide(store, cfg, run, llm)   -> {"action": "retry" | "person", "impact", "severity", "reason", "hint", ...}
    act(store, cfg, run, d)            -> retry: the SAME run again (line.reopen, Rowan 2026-10-25: never a new run),
                                          back to the step it failed in with the hint; the driver drives it on

SEVERITY decides the level of the retry (Rowan, 2026-10-25: not every retry goes one level up). minor = a slip
of the attempt that the hint removes (a command line, a path, a missing install or env var, a flaky or wrong
test, a typo): the run continues at its level. major = the level was not enough (the agent misread the request,
the design or approach was wrong, the change is bigger than sized, the same failure came back): one level up.
Rule over the model: the same failure code as the attempt before is major.

A PERSON decides, whatever the model says (rule, no model call):
  * the line's own guards: secrets found, a revoked Claude token, the budget used up, a cancel, a stop or
    approval gate an admin configured (run hooks), missing request files, a run another driver holds
  * an agent that stopped BLOCKED for a reason a retry cannot remove (BLOCKED_FOR_PERSON: the host, missing
    access, an unsafe request, a request with no reasonable reading)
  * after SUPERVISE_MAX_RETRIES supervised retries of one request, or when they already spent supervise_max_usd
  * the model says the impact is high: production, delivery to the source, credentials, deleting data, or a
    decision that changes the scope of the request (adding or dropping a feature)
With a retry it may also retire locked acceptance tests of EARLIER runs that the request deliberately contradicts
(line.retire: a skip with the reason, one commit on main; never the failed run's own tests). The retry keeps the
failed run's OWN locked tests (Pipeline._earlier_tests), except the F-items it names in rewrite_tests: those
the test author writes again, shown the old file and the hint.
Every decision is kept on the run (detail.supervisor) and shown on its attention panel; a person can still run it
again or mark it resolved. Open questions of a parked run are answered by the model (human_mode decide) while the
supervisor is on, unless a run asked for human_mode ask itself.

LINE_SUPERVISOR: auto (on with a real model) | 1 | 0.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from . import codes
from .contracts import E_ACC_TEST, E_ESCALATION, E_RUN, now_ms
from .statemachine import update_row

ROLE = "supervisor"

#: failure codes a person settles, whatever the model would say
PERSON_CODES = frozenset({
    codes.SECRET_FOUND, codes.BUDGET_EXCEEDED, codes.CANCELLED, codes.HOOK_STOP, codes.SPEC_MISSING_FILE,
    codes.STATE_CONFLICT, codes.CONFIG_INVALID, codes.NOT_FOUND, codes.QUEUE_SLOT_LOST,
})

#: markers of a crash of the line's own built program in a failure's output (the QAS smoke runs `dlc suite`):
#: runs R20261025-123732-8c48 / -124714-1c99 were retried, one level up, for an engine encoding bug
LINE_CRASH = ("Failed to execute script 'dlc_entry'", 'File "dlc_entry.py"')

#: an agent's BLOCKED kind (watchdog.blocked_kind, solo.BLOCK_KINDS) a person settles -> the reason shown
BLOCKED_FOR_PERSON = {
    "host": "the machine or one of its tools stops the work: a person fixes the host",
    "access": "the agent lacks a credential, a permission or an outside system: a person grants or provides it",
    "unsafe": "the agent judged the request unsafe: a person decides whether it goes ahead",
    "spec": "the agent found no reasonable reading of the request: a person makes the request clear",
}

SCHEMA = {"type": "object", "required": ["impact", "action", "reason"],
          "properties": {"impact": {"type": "string", "enum": ["low", "high"]},
                         "severity": {"type": "string", "enum": ["minor", "major"]},
                         "action": {"type": "string", "enum": ["retry", "person"]},
                         "reason": {"type": "string"}, "hint": {"type": "string"},
                         "retire_tests": {"type": "array", "items": {"type": "string"}},
                         "rewrite_tests": {"type": "array", "items": {"type": "string"}}}}

PROMPT = """You supervise an automated software delivery line. One of its runs failed. Decide whether the line
should run the same request again with a hint from you, or whether a person must decide.

Choose "retry" for small, technical decisions you can settle from the evidence, for example:
- the two readings of the request disagree: pick the most sensible reading and say it in the hint;
- a locked acceptance test is wrong or too strict: say exactly what the test must do differently;
- the same failure came back, the app did not start on the test environment, a merge conflict: say what the
  next attempt must do differently (a concrete instruction, not "try again").
Choose "person" (impact "high") only when the decision touches production, delivery to the source repository,
credentials or secrets, deleting data, money beyond the run's budget, or changes the scope of the request
(adding or dropping a feature), or when the evidence is not enough to give a concrete hint.

For a retry, say how big the failure is in "severity" (it decides whether the run goes one level up):
- "minor": a slip of this attempt that your hint removes, the plan and the level were right. Examples: a
  wrong command line or shell quoting, a wrong path, a missing install / package / env var, a port in use, a
  flaky or wrongly written test, a typo, a forgotten file. The run continues at the same level.
- "major": the level was not enough. Examples: the agent misread the request, the design or approach is
  wrong, the change is much bigger or touches more of the system than sized, the same failure came back after
  a hint. The run goes one level up (more reading, more agents) and continues.

The run continues from the step it failed in (the same run, not a new one).
The hint goes into the request of the run, read by every agent: imperative, specific, at most 8 lines.
A hint may ADD what the next attempt needs (files, a step, a check); it never tells the agents to limit their
work to fewer files than the plan gave them (a narrowing hint made a re-run block on the very file it left out).

Locked acceptance tests of EARLIER runs (listed below, when any fails now) protect what earlier requests
asked for, and no agent may edit them. When this run's request deliberately changes the behaviour such a test
locks in (e.g. it asserts a bug this request fixes), list that test in "retire_tests": the line skips it with
your reason before the new run. Never retire a test only because it is red; only when the new request
contradicts it.

The failed run's OWN acceptance tests (listed below by F-item) are KEPT for the retry: writing them again costs
money and loses what was right. When some of them are wrong (they assert the wrong behaviour, or cannot run on
the test machine), list their F-item ids in "rewrite_tests" and say in the hint what the new tests must do
differently; only those are written again.

Return JSON: {{"impact": "low" | "high", "action": "retry" | "person", "severity": "minor" | "major",
"reason": "<one or two sentences>",
"hint": "<the hint, for retry>", "retire_tests": ["<test id from the list below>", "..."],
"rewrite_tests": ["<F-item id of this run's own tests>", "..."]}}

EVIDENCE OF THE FAILED RUN:
{evidence}

THE RUN BOARD (what every step of the failed run settled):
{board}

LOCKED TESTS OF EARLIER RUNS THAT FAIL NOW:
{earlier}

THIS RUN'S OWN LOCKED TESTS (kept for the retry unless their F-item is in rewrite_tests):
{own}

EARLIER ATTEMPTS OF THIS RUN (failure, who started it again, hint):
{history}
"""


def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "supervisor", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    if mode in ("1", "on", "true", "yes"):
        return True
    return str(getattr(cfg, "llm", "fake")) != "fake"


def _row(store: Any, run: str) -> Dict[str, Any]:
    return store.get(E_RUN, run) or {}


def chain(store: Any, run: str, limit: int = 20) -> List[Dict[str, Any]]:
    """The run and the runs it retried, newest first (detail.retry_of links)."""
    out, seen = [], set()
    while run and run not in seen and len(out) < limit:
        seen.add(run)
        row = _row(store, run)
        if not row:
            break
        out.append(row)
        run = str((row.get("detail") or {}).get("retry_of") or "")
    return out


def _person(reason: str, code: str = "", **kw: Any) -> Dict[str, Any]:
    return dict({"action": "person", "impact": "high", "reason": reason, "by": "rule", "code": code}, **kw)


def _f_items_of(named: List[Any], rows: List[Dict[str, Any]]) -> List[str]:
    """The F-items of the run's own tests the supervisor named (an F-item id, a test id or a test name)."""
    out: List[str] = []
    for x in named:
        x = str(x).strip()
        for r in rows:
            f = str(r.get("f_item") or "")
            if f and x in (f, str(r.get("id") or ""), str(r.get("name") or "")) and f not in out:
                out.append(f)
    return out


def decide(store: Any, cfg: Any, run: str, llm: Any) -> Dict[str, Any]:
    row = _row(store, run)
    if row.get("state") != "escalated":
        return _person("the run did not fail")
    d = dict(row.get("detail") or {})
    esc = (store.query(E_ESCALATION, run=run) or [{}])[-1]
    code = str(esc.get("code") or "")
    edetail = esc.get("detail") or {}
    if code in PERSON_CODES:
        return _person("%s is settled by a person (the line's own guard)" % code, code)
    if code == codes.LLM_ERROR and (edetail.get("token_rejected") or "token" in str(esc.get("message") or "").lower()):
        return _person("the Claude sign-in token was refused: a person sets a new one", code)
    trace = str(edetail.get("output") or "") + str(edetail.get("trace") or "")
    if any(m in trace for m in LINE_CRASH):      # the line's own program broke: no hint to the agents can fix it
        return _person("the line's own program failed (not the request's code): a person fixes the engine", code,
                       engine_fault=True)
    bk = str(edetail.get("blocked_kind") or "")
    if bk in BLOCKED_FOR_PERSON:                 # a retry one level up cannot supply what the agent said is missing
        return _person(BLOCKED_FOR_PERSON[bk], code, blocked_kind=bk)
    runs = chain(store, run)                     # runs retried as new runs before 2026-10-25 (retry_of)
    attempts = list(d.get("attempts") or [])     # attempts of this run (line.reopen)
    supervised = [r for r in runs if (r.get("detail") or {}).get("supervised")]
    mine = [a for a in attempts if a.get("by") == "supervisor"]
    max_n = int(getattr(cfg, "supervise_max_retries", 2) or 0)
    if len(supervised) + len(mine) >= max_n:
        return _person("already run again %d time(s) by the supervisor" % (len(supervised) + len(mine)), code)
    extra = sum(float((r.get("detail") or {}).get("spent_usd") or 0) for r in supervised)
    if mine:                                     # spent since the supervisor first started this run again
        extra += max(_spent(store, run) - float(mine[0].get("spent_usd") or 0), 0.0)
    cap = float(getattr(cfg, "supervise_max_usd", 3.0) or 0)
    if cap and extra >= cap:
        return _person("the supervised retries already spent $%.2f (cap $%.2f)" % (extra, cap), code)
    from .attention import _evidence
    history = "\n".join(["- attempt %s failed (%s: %s); %s: %s" % (a.get("n"), a.get("code") or "?",
                                                                   str(a.get("message") or "")[:200], a.get("actor"),
                                                                   a.get("hint") or "(no hint)") for a in attempts] +
                        ["- %s: %s" % (r.get("id"), ((r.get("detail") or {}).get("supervisor") or {}).get("hint") or "")
                         for r in runs[1:] if (r.get("detail") or {}).get("supervisor")]) or "(none)"
    from . import retire as retire_mod
    failing = list(edetail.get("failing") or []) or         retire_mod.failing_tests(str(edetail.get("output") or edetail.get("evidence") or ""))
    earlier = {t: r for t, r in retire_mod.owners(store, failing).items() if r and r != run}
    earlier_text = "\n".join("- %s (locked by run %s: %s)" % (t, r, (_row(store, r).get("detail") or {}).get("name") or "")
                             for t, r in earlier.items()) or "(none)"
    own_rows = [r for r in store.query(E_ACC_TEST, run=run) if r.get("locked")]
    own_f: Dict[str, List[str]] = {}
    for r in own_rows:
        own_f.setdefault(str(r.get("f_item") or ""), []).append(str(r.get("name") or r.get("id") or ""))
    own_text = "\n".join("- %s: %s" % (f, ", ".join(n[:120] for n in names[:8])) for f, names in sorted(own_f.items())
                         if f) or "(none)"
    out: Dict[str, Any] = {"code": code, "by": "model"}
    try:
        from .runboard import text as board_text
        res = llm.complete(ROLE, PROMPT.format(evidence=_evidence(store, run, 8000), history=history,
                                               earlier=earlier_text, own=own_text,
                                               board=board_text(store, run) or "(empty)"),
                           SCHEMA, key="supervise", run="")
        data = res.data if isinstance(res.data, dict) else {}
        out["usd"] = round(float(res.usd or 0), 4)
    except Exception as e:   # noqa: BLE001 - no answer: a person decides
        return _person("the supervisor could not decide: %s" % str(e)[:200], code)
    action = str(data.get("action") or "person")
    impact = str(data.get("impact") or "high")
    hint = str(data.get("hint") or "").strip()
    severity = "major" if str(data.get("severity") or "").lower() == "major" else "minor"
    if attempts and code and str(attempts[-1].get("code") or "") == code:
        severity = "major"                       # the same failure came back: the level was not enough
    out.update(impact=impact, severity=severity, reason=str(data.get("reason") or "")[:600], hint=hint[:2000])
    retire = [str(t) for t in (data.get("retire_tests") or []) if str(t) in earlier]   # earlier runs' tests only
    if retire:
        out["retire_tests"] = retire
    rewrite = _f_items_of(data.get("rewrite_tests") or [], own_rows)
    if rewrite:
        out["rewrite_tests"] = rewrite
    if action != "retry" or impact != "low" or not hint:
        out["action"] = "person"
        if action == "retry" and not hint:
            out["reason"] = (out["reason"] + " (no concrete hint, so a person decides)").strip()
        return out
    out["action"] = "retry"
    return out


def act(store: Any, cfg: Any, run: str, d: Dict[str, Any], start: Any = None,
        log: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    """Keep the decision on the run; for retry, reopen the same run (line.reopen), one level up when the failure is
    major. Returns the decision (reopened = the attempt the run is now on); the caller drives the run on.
    `start` is not used any more (a retry never starts a new run)."""
    say = log or (lambda m: None)
    d = dict(d, ms=now_ms())
    if d.get("action") == "retry":
        try:
            if d.get("retire_tests"):            # earlier runs' locked tests this request supersedes, before the run
                from .retire import retire
                repo = str((_row(store, run).get("detail") or {}).get("target") or "")
                d["retired"] = [retire(repo, t, d.get("reason") or "", run) for t in d["retire_tests"]]
            det = dict(_row(store, run).get("detail") or {})
            det["supervisor"] = d                # moves into the attempt the reopen records
            update_row(store, E_RUN, run, {"detail": det})
            from .reopen import reopen
            out = reopen(store, cfg, run, d.get("hint") or "", "the supervisor", by="supervisor",
                         level_up=d.get("severity") == "major", rewrite_tests=d.get("rewrite_tests") or [])
            d["reopened"] = out["attempt"]
            if out.get("level"):
                d["level"] = out["level"]
        except Exception as e:   # noqa: BLE001 - could not run it again: a person decides
            d.update(action="person", reason="the supervisor could not run it again: %s" % str(e)[:300])
    row = _row(store, run)
    if d.get("action") == "retry" and d.get("reopened"):
        det = dict(row.get("detail") or {})
        attempts = list(det.get("attempts") or [])
        if attempts:                             # the decision lives in the attempt it settled
            attempts[-1] = dict(attempts[-1], supervisor=d)
            update_row(store, E_RUN, run, {"detail": dict(det, attempts=attempts)})
        from . import outcomes                   # the run's next result judges the hint (line.outcomes)
        outcomes.record(store, run, ROLE, judged_by_retry=True, failed_code=d.get("code") or "",
                        reason=d.get("reason") or "", hint=d.get("hint") or "", severity=d.get("severity") or "",
                        retired_tests=d.get("retire_tests") or [], retry_run=run, attempt=d["reopened"])
    else:
        det = dict(row.get("detail") or {})
        det["supervisor"] = d
        update_row(store, E_RUN, run, {"detail": det})
    say("%s: supervisor %s (%s%s)%s" % (run, d.get("action"), d.get("reason"),
                                        ("; " + d["severity"]) if d.get("severity") else "",
                                        (" -> attempt %s" % d["reopened"]) if d.get("reopened") else ""))
    return d


def _spent(store: Any, run: str) -> float:
    from .contracts import E_LLM_CALL
    return sum(float(c.get("usd", 0) or 0) for c in store.query(E_LLM_CALL, run=run))


__all__ = ["ROLE", "PERSON_CODES", "BLOCKED_FOR_PERSON", "enabled", "chain", "decide", "act"]
