"""Actual against target, per step and for the whole process run, so the process can be managed. The targets are
data (step "target": {"kpi": {...}}, process "kpi": {...}); the engine only counts.

Counted per step (detail.gated.metrics[<step id>]):
    agent_usd, agent_calls, work_ms         what the agents of the step spent
    drafts                                  how many times the step's documents were written
    human_decisions, auto_decisions,        decisions at the step's gate (people / auto-approve), how many sent
    revisions, wait_ms                      work back, how long the gate waited for a person
    rounds, decisions_outside_plan,         build: implement-deploy-test rounds, choices the agent took that the
    mid_run_stops                           plan left open, stops for a person in the middle of execution
KPI keys a target may set (each "max_<counter>" or "max_minutes" for work_ms + wait_ms):
    max_usd (agent_usd), max_rounds, max_drafts, max_human_decisions, max_revisions, max_decisions_outside_plan,
    max_mid_run_stops, max_minutes

    add(state, step, **counts) -> state     add to a step's counters (numbers add, *_ms add)
    evaluate(definition, metrics) -> {"steps": {id: {"actual", "target", "met", "missed"}}, "process": {...}}
    text(report) -> markdown for the final gate
"""

from __future__ import annotations

from typing import Any, Dict

ALIAS = {"max_usd": "agent_usd"}


def add(metrics: Dict[str, Any], step: str, **counts: Any) -> Dict[str, Any]:
    m = dict(metrics or {})
    cur = dict(m.get(step) or {})
    for k, v in counts.items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            total = cur.get(k, 0) + v
            cur[k] = round(total, 4) if isinstance(total, float) else total
        else:
            cur[k] = v
    m[step] = cur
    return m


def _judge(actual: Dict[str, Any], kpi: Dict[str, Any]) -> Dict[str, Any]:
    missed = []
    for key, limit in (kpi or {}).items():
        if not key.startswith("max_"):
            continue
        if key == "max_minutes":
            have = (float(actual.get("work_ms", 0)) + float(actual.get("wait_ms", 0))) / 60000.0
        else:
            have = float(actual.get(ALIAS.get(key, key[4:]), 0))
        if have > float(limit):
            missed.append("%s: %g > %g" % (key, round(have, 2), float(limit)))
    return {"met": not missed, "missed": missed}


def evaluate(definition: Any, metrics: Dict[str, Any]) -> Dict[str, Any]:
    steps = {}
    total: Dict[str, Any] = {}
    for s in definition.steps():
        a = dict((metrics or {}).get(s["id"]) or {})
        kpi = dict(((s.get("target") or {}).get("kpi")) or {})
        steps[s["id"]] = dict(actual=a, target=kpi, **_judge(a, kpi))
        for k, v in a.items():
            if isinstance(v, (int, float)):
                total[k] = round(total.get(k, 0) + v, 4)
    kpi = dict(definition.data.get("kpi") or {})
    return {"steps": steps, "process": dict(actual=total, target=kpi, **_judge(total, kpi))}


def text(report: Dict[str, Any]) -> str:
    rows = ["| Step | Actual | Target | Met |", "|---|---|---|---|"]

    def fmt(d: Dict[str, Any]) -> str:
        return ", ".join("%s %s" % (k, v) for k, v in sorted(d.items()) if v not in (0, 0.0, "")) or "-"

    for sid, r in report.get("steps", {}).items():
        rows.append("| %s | %s | %s | %s |" % (sid, fmt(r["actual"]), fmt(r["target"]),
                                               "yes" if r["met"] else "no: " + "; ".join(r["missed"])))
    p = report.get("process") or {}
    rows.append("| **process** | %s | %s | %s |" % (fmt(p.get("actual") or {}), fmt(p.get("target") or {}),
                                                     "yes" if p.get("met") else "no: " + "; ".join(p.get("missed") or [])))
    return "\n".join(rows)


__all__ = ["add", "evaluate", "text"]
