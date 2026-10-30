"""The run's events as sentences a person reads (the node page's worklog), the raw record kept aside.

The worklog used to show each event as its kind and its JSON body ("graph.valid {"attempts": 1, ...}"). Here every
known kind gets a title and a sentence; an unknown kind still reads as "Some kind" plus "key: value" lines,
never JSON. The raw body stays in the entry's "raw" field for the technical view.

    title, text = event_text("graph.valid", body, unit)
    title, text = call_text(llm_call_row)
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Tuple

ROLE_NAME = {
    "reader_a": "Reader A", "reader_b": "Reader B", "reader_reread": "Re-reader", "test_author": "Test author",
    "planner": "Planner", "builder": "Builder", "fixer": "Fixer", "merger": "Merge agent", "reviewer": "Reviewer",
    "judge": "Judge", "spec_analyst": "Spec analyst", "change_sizer": "Change sizer", "fgraph": "Feature mapper",
    "hook": "Run hook", "human_decider": "Decider", "explainer": "Explainer", "gaps": "Gap checker",
    "conflicts": "Conflict checker", "distiller": "Lesson distiller",
}


def role_name(role: str) -> str:
    return ROLE_NAME.get(role or "", (role or "agent").replace("_", " ").capitalize())


def _n(x: Any) -> int:
    return len(x) if isinstance(x, (list, tuple, dict)) else int(x or 0) if str(x or "0").isdigit() else 0


def _list(x: Any, limit: int = 8) -> str:
    items = [str(i) for i in (x or [])] if isinstance(x, (list, tuple)) else [str(x)] if x else []
    s = ", ".join(items[:limit])
    return s + (" and %d more" % (len(items) - limit) if len(items) > limit else "")


def _lines(body: Mapping[str, Any], limit: int = 8) -> str:
    out = []
    for k, v in list(body.items())[:limit]:
        if isinstance(v, (dict, list)) and len(str(v)) > 160:
            v = "%d item(s)" % len(v)
        out.append("- %s: %s" % (k.replace("_", " "), str(v)[:200]))
    return "\n".join(out)


def _waves(w: Any) -> str:
    try:
        return " then ".join("(" + ", ".join(map(str, wave)) + ")" for wave in w)
    except TypeError:
        return str(w)


def event_text(kind: str, body: Mapping[str, Any], unit: str = "") -> Tuple[str, str]:
    b = dict(body or {})
    u = unit or str(b.get("unit") or "")
    f = _FORMATS.get(kind)
    if f is not None:
        try:
            return f(b, u)
        except Exception:   # noqa: BLE001 - an odd body falls back to the plain form below
            pass
    title = kind.replace(".", " ").replace("_", " ").capitalize() + ((" · " + u) if u else "")
    return title, _lines(b)


def _reason_from(b: Mapping[str, Any]) -> str:
    return str(b.get("reason") or b.get("message") or b.get("error") or "")


_FORMATS: Dict[str, Any] = {
    "run.admitted": lambda b, u: ("Run started", "The request was accepted and the run began."),
    "spec.frozen": lambda b, u: ("Request frozen", "The request was read in and fixed as version %s (%d part(s))."
                                 % (str(b.get("version") or b.get("spec_hash") or "")[:12], _n(b.get("spans")))),
    "digest.done": lambda b, u: ("Request understood",
                                 "%d feature(s) with %d acceptance criteria, %d rule(s) and %d number(s) found%s."
                                 % (_n(b.get("f_items")), _n(b.get("criteria")), _n(b.get("rules")),
                                    _n(b.get("numbers")),
                                    "; %d unclear part(s) re-read" % _n(b.get("rereads")) if _n(b.get("rereads")) else "")),
    "reconcile.diverged": lambda b, u: ("Readers disagreed",
                                        "The two independent readings differ on %d point(s); those parts are read again."
                                        % _n(b.get("fields"))),
    "tests.approved": lambda b, u: ("Acceptance tests locked",
                                    "%d test(s) written from the request, checked to fail without code, and locked."
                                    % _n(b.get("tests"))),
    "graph.valid": lambda b, u: ("Work planned",
                                 "%d unit(s) of work: %s. Build order: %s%s."
                                 % (_n(b.get("units")), _list(b.get("units")), _waves(b.get("waves") or []),
                                    "" if int(b.get("attempts") or 1) <= 1 else " (planned on the 2nd try)")),
    "unit.dispatched": lambda b, u: ("%s started" % (u or "Unit"),
                                     "A builder started on %s (attempt on %s)." % (u or "the unit",
                                                                                   "the alternate model" if int(b.get("rung") or 0) else "the main model")),
    "unit.submitted": lambda b, u: ("%s handed in" % (u or "Unit"), "The builder says its change is ready; the checks run next."),
    "verify.failed": lambda b, u: ("%s did not pass the checks" % (u or "Unit"),
                                   "%s. Next: %s.%s" % (str(b.get("code") or "check failed").replace("_", " ").lower().capitalize(),
                                                        {"retry": "another attempt", "switch_model": "another attempt on the alternate model",
                                                         "escalate": "stop and ask a person"}.get(str(b.get("decision") or ""), str(b.get("decision") or "")),
                                                        ("\n\n" + str(b.get("evidence"))[:600]) if b.get("evidence") else "")),
    "unit.blocked": lambda b, u: ("%s is blocked" % (u or "Unit"), "The builder says: " + _reason_from(b)),
    "unit.requeued": lambda b, u: ("%s goes again" % (u or "Unit"),
                                   "Back in line for another attempt (%s)." % str(b.get("code") or b.get("reason") or "").replace("_", " ").lower()),
    "unit.merged": lambda b, u: ("%s merged" % (u or "Unit"), "The change passed the checks and is now on main."),
    "unit.state": lambda b, u: ("%s: %s" % (u or "Unit", str(b.get("to") or "")),
                                "From %s to %s%s." % (b.get("from") or "?", b.get("to") or "?",
                                                      " (%s)" % b.get("code") if b.get("code") else "")),
    "run.state": lambda b, u: ("Run: %s" % (b.get("to") or ""), "The run moved from %s to %s." % (b.get("from") or "?", b.get("to") or "?")),
    "escalated": lambda b, u: ("Stopped: a person is needed" + ((" · " + u) if u else ""),
                               "%s%s" % (str(b.get("code") or "").replace("_", " ").lower().capitalize(),
                                         (". " + _reason_from(b)) if _reason_from(b) else "")),
    "deploy.done": lambda b, u: ("Deployed to the test environment", "Main was deployed to QAS slot %s." % (b.get("color") or "")),
    "qas.result": lambda b, u: ("Test environment: %s" % (b.get("verdict") or ""),
                                "Feature %s: %s." % (b.get("f_item") or "?", b.get("verdict") or "?")),
    "run.green": lambda b, u: ("Run finished green", "Everything passed; the work is done."),
    "run.paused": lambda b, u: ("Run stopped", "Stopped: %s." % (b.get("reason") or "by a person")),
    "run.resumed": lambda b, u: ("Run resumed", "Resumed by %s." % (b.get("by") or "a person")),
    "run.parked": lambda b, u: ("Waiting for answers", "The run waits until the open questions are answered."),
    "run.unparked": lambda b, u: ("Answers received", "The run goes on."),
    "human.question": lambda b, u: ("Question for a person", str(b.get("decision") or b.get("text") or b.get("qid") or "")),
    "human.answered": lambda b, u: ("Question answered", "%s answered %s." % (b.get("who") or "Someone", b.get("qid") or "")),
    "human.decided": lambda b, u: ("Decided without a person", "%s: %s" % (b.get("qid") or "", b.get("choice") or b.get("option") or "")),
    "spec.addendum": lambda b, u: ("Request amended", "Version %s of the request adds the answers." % (b.get("version") or "")),
    "budget.warn": lambda b, u: ("Budget almost used", "$%.2f of $%.2f spent." % (float(b.get("spent") or 0), float(b.get("limit") or 0))),
    "lease.expired": lambda b, u: ("A worker timed out", "%s stopped answering; its work goes back in line." % (u or b.get("name") or "A unit")),
    "hook.ran": lambda b, u: ('Run hook "%s"' % (b.get("name") or ""), "%s: %s" % (b.get("status") or "", b.get("reason") or b.get("outcome") or "")),
    "hook.blocked": lambda b, u: ('Run hook "%s" holds the run' % (b.get("name") or ""), _reason_from(b)),
    "merger.ran": lambda b, u: ("Merge agent on %s" % (b.get("unit") or u), "%s (%s)." % (b.get("outcome") or "", "resolved" if b.get("resolved") else "not resolved")),
    "fgraph.checked": lambda b, u: ("Feature map checked", "%d feature node(s), %d link(s); %d gap(s)." % (_n(b.get("nodes")), _n(b.get("edges")), _n(b.get("gaps")))),
    "review.done": lambda b, u: ("Review of %s" % u if u else "Review", "%s; %d finding(s)." % (b.get("verdict") or "", _n(b.get("findings")))),
    "deliver.pushed": lambda b, u: ("Delivered", "Pushed to branch %s of the source." % (b.get("branch") or "")),
    "deliver.failed": lambda b, u: ("Delivery failed", _reason_from(b)),
    "deliver.skipped": lambda b, u: ("Not delivered", _reason_from(b)),
}


def call_text(c: Mapping[str, Any]) -> Tuple[str, str]:
    role = str(c.get("role") or "")
    key = str(c.get("key") or "")
    who = role_name(role)
    unit, _, n = key.partition(".")
    title = "%s · %s" % (who, ("%s attempt %s" % (unit, n)) if n.isdigit() else (key or "call"))
    if c.get("cached"):
        return title, "Answered from the store (same question as before): $0, saved $%.2f." % float(c.get("saved_usd") or 0)
    if not c.get("ok", True):
        return title, "The call failed: %s ($%.2f spent)." % (c.get("error") or "?", float(c.get("usd") or 0))
    out = str(c.get("outcome") or "")
    head = "%s on %s, $%.2f." % ({"SUBMIT": "Finished", "": "Answered"}.get(out, "Stopped" if out.startswith("BLOCKED") else out),
                                 c.get("model") or "?", float(c.get("usd") or 0))
    summary = str(c.get("summary") or "").strip()
    return title, head + (("\n\n" + summary) if summary else "")


def gate_text(g: Mapping[str, Any]) -> Tuple[str, str]:
    gate = g.get("gate") or {}
    name = {"verify": "Checks", "merge": "Merge check", "smoke": "Start check", "qas": "Test environment"}.get(str(g.get("name") or ""), str(g.get("name") or "Check"))
    who = ("%s attempt %s" % (g.get("unit"), g.get("attempt"))) if g.get("unit") else ""
    title = "%s%s" % (name, (" · " + who) if who else "")
    if gate.get("ok"):
        d = gate.get("detail") or {}
        return title, "Passed%s." % ((" (%s test(s))" % d.get("passed")) if d.get("passed") else "")
    d = gate.get("detail") or {}
    ev = str(d.get("evidence") or "")
    return title, "Failed: %s.%s" % (str(gate.get("code") or "").replace("_", " ").lower(), ("\n\n" + ev[:800]) if ev else "")


def attempt_text(a: Mapping[str, Any]) -> Tuple[str, str]:
    out = str(a.get("outcome") or "")
    title = "%s attempt %s: %s" % (a.get("unit") or "", a.get("n") or "", {"verified": "passed", "failed": "failed",
                                                                           "blocked": "blocked", "lost": "timed out",
                                                                           "submitted": "handed in"}.get(out, out or "running"))
    text = "On %s, $%.2f%s." % (a.get("model") or "?", float(a.get("usd") or 0),
                                (", " + str(a.get("code")).replace("_", " ").lower()) if a.get("code") else "")
    return title, text


__all__ = ["event_text", "call_text", "gate_text", "attempt_text", "role_name"]
