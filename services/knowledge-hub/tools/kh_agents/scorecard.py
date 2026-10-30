"""Phase 4 scorecard: the shadow -> on gate numbers (docs/roadmap-e-to-5-design.md 6.4), computed from KH data only.

Sources, all read through /v1 with the namespace admin token: the manifest (gate thresholds and the always-human
prefixes in ``settings.pilot``), the event log (``task.step`` / ``task.done`` / ``task.blocked`` and KH's own
``kh.intervention``, ``kh.write_conflict``, ``kh.stale_epoch``, ``kh.lease_lost``, ``kh.ns_state``), the
``task_memory`` and ``handoff`` records, the effect ledger (``GET /effects/{key}`` with its approval) and the
``task_cost_usd`` metric.

Definitions:
  task                 a unit with at least one task.* event; "real" = backend other than dry
  chain unattended     a finding_chain whose 5 steps finished (task_memory facts.chain_complete) with no
                       task.blocked and no rejected effect before the PR was open; the merge approval is designed
                       human work and does not count against it
  intervention         a human act a task needed beyond the designed approvals: a task.blocked with needs_human,
                       or a kh.intervention with decision reject. Approvals of always-human keys are "designed";
                       approvals of other keys (shadow mode) are "shadow reviews". Neither counts.
  sev-1                a task.blocked with sev >= 1, or a done effect on an always-human key without an approve
                       decision by a listed confirmer (an unapproved high-risk effect)
  audit complete       every task.* event, task_memory and handoff record has actor principal, run_id and unit_id
  double / lost        > 1 task.done for a unit; task_memory rev != its write counter (each write bumps both under
                       If-Match, so a lost update shows as a gap); an effect task_memory calls done that the ledger
                       does not hold as done
Not measurable from the pilot namespace: G10 (tier-2 bench) and people's /context/step p95; pass them in with
--g10 and --p95-ms, otherwise those gates show n/a and the verdict cannot be "met".

    .venv\\Scripts\\python tools\\kh_agents\\scorecard.py [--ns ops_pilot] [--backend all|dry|claude_cli] [--run ID]
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict

DAY_MS = 86400000


def _records(sim, rtype: str) -> list[dict]:
    out, off = [], 0
    while True:
        r = sim.admin.post(f"/records/{rtype}:query", {"limit": 500, "offset": off, "order": ["created_ms"]},
                           route=f"query {rtype}")
        if r.status != 200:
            raise RuntimeError(f"query {rtype}: {r.brief()}")
        rows = r.j.get("records") or r.j.get("items") or []
        out += rows
        if len(rows) < 500:
            return out
        off += 500


def _starts(key: str, prefixes) -> bool:
    return any(p == "*" or key.startswith(p) for p in prefixes)


def compute(sim, backend: str = "all", run: str | None = None, p95_ms: float | None = None,
            g10: str | None = None, effect_checks_max: int = 400) -> dict:
    man = sim.admin.get("/manifest", route="GET /manifest").j.get("manifest") or {}
    settings = man.get("settings") or {}
    pilot = settings.get("pilot") or {}
    gates = pilot.get("gates") or {}
    always = pilot.get("always_human") or ["delete/", "deploy/prod", "send/external", "merge/"]
    confirmers = {e.lower() for e in ((settings.get("effects") or {}).get("confirm_policy") or {}).get("emails", [])}

    evs = sim.events()
    units: dict[str, dict] = {}
    for e in evs:
        if not e["kind"].startswith("task."):
            continue
        b = e.get("body") or {}
        if backend != "all" and b.get("backend") != backend:
            continue
        if run and e.get("run_id") != run:
            continue
        u = units.setdefault(e["unit_id"], {"kind": b.get("task_kind"), "chain": bool(b.get("chain")),
                                            "backend": b.get("backend"), "project": e.get("project"),
                                            "runs": set(), "ts": [], "steps": Counter(), "blocked": [],
                                            "done": 0, "cost": None, "tokens": None, "events": []})
        u["runs"].add(e.get("run_id"))
        u["ts"].append(e["ts_ms"])
        u["events"].append(e)
        if e["kind"] == "task.step":
            u["steps"][b.get("step")] += 1
        elif e["kind"] == "task.blocked":
            u["blocked"].append(b)
        elif e["kind"] == "task.done":
            u["done"] += 1
            u["cost"], u["tokens"] = b.get("cost_usd"), b.get("tokens")

    def unit_of_key(key: str) -> str | None:
        i = key.find("-t-")
        return key[i + 1:] if i >= 0 else None

    kh = Counter(e["kind"] for e in evs if e["kind"].startswith("kh."))
    inter = [e for e in evs if e["kind"] == "kh.intervention" and unit_of_key((e.get("body") or {}).get("effect_key", ""))
             in units]
    rejects = [e for e in inter if (e.get("body") or {}).get("decision") == "reject"]
    approvals = [e for e in inter if (e.get("body") or {}).get("decision") == "approve"]
    designed = [e for e in approvals if _starts(e["body"]["effect_key"], always)]
    shadow_reviews = len(approvals) - len(designed)
    rejected_by_unit = defaultdict(list)
    for e in rejects:
        rejected_by_unit[unit_of_key(e["body"]["effect_key"])].append(e["body"]["effect_key"])

    mems = {m["id"]: m for m in _records(sim, "task_memory") if m["id"] in units}
    handoffs = [h for h in _records(sim, "handoff") if (h.get("body") or {}).get("task_id") in units]

    # tasks, days, projects
    real = {u: x for u, x in units.items() if x["backend"] != "dry"}
    def span_days(xs):
        ts = [t for x in xs.values() for t in x["ts"]]
        return round((max(ts) - min(ts)) / DAY_MS, 2) if ts else 0.0

    # chains, ordered by first event
    chains = sorted(((u, x) for u, x in units.items() if x["chain"]), key=lambda ux: min(ux[1]["ts"]))
    def unattended(u, x):
        m = (mems.get(u) or {}).get("body") or {}
        if not (m.get("facts") or {}).get("chain_complete"):
            return False
        if any(b.get("step") != "merge" for b in x["blocked"]):
            return False
        return not any(not k.startswith("merge/") for k in rejected_by_unit.get(u, []))
    finished = [(u, x) for u, x in chains if ((mems.get(u) or {}).get("body") or {}).get("status") in ("done", "blocked")
                or ((mems.get(u) or {}).get("body") or {}).get("facts", {}).get("chain_complete")]
    window = int(gates.get("chain_window", 10))
    last = finished[-window:]
    chain_ok = sum(1 for u, x in last if unattended(u, x))

    # interventions
    blocked_human = sum(1 for x in units.values() for b in x["blocked"] if b.get("needs_human"))
    n_inter = blocked_human + len(rejects)
    n_tasks = len(units)

    # sev-1 and effect ledger
    sev1 = [{"unit": u, "why": "task.blocked sev>=1", "step": b.get("step")} for u, x in units.items()
            for b in x["blocked"] if int(b.get("sev") or 0) >= 1]
    lost, checked = [], 0
    for u, m in mems.items():
        for key, st in ((m.get("body") or {}).get("effects") or {}).items():
            if checked >= effect_checks_max:
                break
            checked += 1
            r = sim.admin.get(f"/effects/{key}", route="GET /effects")
            got = r.j if r.status == 200 else {}
            if st == "done" and got.get("state") != "done":
                lost.append({"unit": u, "effect": key, "ledger": got.get("state")})
            if got.get("state") == "done" and _starts(key, always):
                ap = got.get("approval") or {}
                if ap.get("decision") != "approve" or (confirmers and str(ap.get("approver", "")).lower()
                                                       not in confirmers):
                    sev1.append({"unit": u, "why": "high-risk effect done without an approval", "effect": key})

    # double deliveries and lost updates
    double = [u for u, x in units.items() if x["done"] > 1]
    lost_upd = [u for u, m in mems.items() if int((m.get("body") or {}).get("writes", -1)) != int(m.get("rev", -2))]

    # audit completeness
    def complete(actor):
        return bool(actor and actor.get("principal") and actor.get("run_id") and actor.get("unit_id"))
    writes = [e.get("actor") for x in units.values() for e in x["events"]] + \
             [m.get("actor") for m in mems.values()] + [h.get("actor") for h in handoffs]
    audit = round(sum(1 for a in writes if complete(a)) / len(writes), 4) if writes else None

    # steps, cost
    steps_done = sum(sum(x["steps"].values()) for x in units.values())
    redone = sum(c - 1 for x in units.values() for c in x["steps"].values() if c > 1)
    costs = [x["cost"] for x in units.values() if x["cost"] is not None]
    toks = [x["tokens"] for x in units.values() if x["tokens"] is not None]
    stops = [e for e in evs if e["kind"] == "kh.ns_state" and (e.get("body") or {}).get("reason") == "agents:stop"]

    numbers = {
        "namespace": sim.ns, "mode": pilot.get("mode"), "filter": {"backend": backend, "run": run},
        "runs": len({r for x in units.values() for r in x["runs"]}),
        "tasks": n_tasks, "real_tasks": len(real), "by_kind": dict(Counter(x["kind"] for x in units.values())),
        "by_backend": dict(Counter(x["backend"] for x in units.values())),
        "tasks_done": sum(1 for x in units.values() if x["done"]),
        "tasks_blocked": sum(1 for x in units.values() if x["blocked"] and not x["done"]),
        "days_span_all": span_days(units), "days_span_real": span_days(real),
        "projects": sorted({x["project"] for x in units.values()}),
        "projects_real": sorted({x["project"] for x in real.values()}),
        "chains": len(chains), "chains_finished": len(finished),
        "chain_window": f"{chain_ok}/{len(last)} unattended (last {window})",
        "interventions": n_inter, "interventions_blocked_human": blocked_human, "interventions_rejects": len(rejects),
        "interventions_per_100_tasks": round(100.0 * n_inter / n_tasks, 1) if n_tasks else None,
        "designed_approvals": len(designed), "shadow_reviews": shadow_reviews,
        "sev1": len(sev1), "sev1_detail": sev1[:10],
        "audit_completeness": audit, "audit_writes_checked": len(writes),
        "double_deliveries": len(double), "lost_updates": len(lost_upd) + len(lost),
        "effects_checked": checked,
        "handoffs": len(handoffs), "steps_done": steps_done, "steps_redone_after_stop": redone,
        "conflicts": {"kh.write_conflict": kh.get("kh.write_conflict", 0), "kh.stale_epoch": kh.get("kh.stale_epoch", 0),
                      "kh.lease_lost": kh.get("kh.lease_lost", 0), "kh.duplicate": kh.get("kh.duplicate", 0)},
        "stop_drills": len(stops),
        "cost_per_task_usd": round(sum(costs) / len(costs), 4) if costs else None,
        "tokens_per_task": round(sum(toks) / len(toks)) if toks else None,
    }

    G = gates
    def gate(name, value, target, ok):
        return {"gate": name, "value": value, "target": target, "status": "n/a" if ok is None else
                ("PASS" if ok else "FAIL")}
    rows = [
        gate("real tasks", len(real), f">= {G.get('min_tasks', 60)}", len(real) >= G.get("min_tasks", 60)),
        gate("days (real)", numbers["days_span_real"], f">= {G.get('min_days', 14)}",
             numbers["days_span_real"] >= G.get("min_days", 14)),
        gate("projects (real)", len(numbers["projects_real"]), f">= {G.get('min_projects', 2)}",
             len(numbers["projects_real"]) >= G.get("min_projects", 2)),
        gate("5-step chain unattended", f"{chain_ok}/{len(last)}",
             f">= {G.get('chain_unattended_min', 8)}/{window} consecutive",
             len(last) >= window and chain_ok >= G.get("chain_unattended_min", 8)),
        gate("interventions / 100 tasks", numbers["interventions_per_100_tasks"],
             f"<= {G.get('max_interventions_per_100', 25)}",
             None if not n_tasks else numbers["interventions_per_100_tasks"] <= G.get("max_interventions_per_100", 25)),
        gate("sev-1 incidents", len(sev1), f"= {G.get('max_sev1', 0)}", len(sev1) <= G.get("max_sev1", 0)),
        gate("audit completeness", audit, f"= {G.get('audit_completeness', 1.0)}",
             None if audit is None else audit >= G.get("audit_completeness", 1.0)),
        gate("double deliveries + lost updates", len(double) + numbers["lost_updates"],
             f"= {G.get('max_double_or_lost', 0)}", len(double) + numbers["lost_updates"] <= G.get("max_double_or_lost", 0)),
        gate("G10 (tier-2 bench)", g10 or "not measured", "pass", None if g10 is None else g10 == "pass"),
        gate("people /context/step p95 ms", p95_ms if p95_ms is not None else "not measured",
             f"< {G.get('context_step_p95_ms', 2000)}", None if p95_ms is None else p95_ms < G.get("context_step_p95_ms", 2000)),
    ]
    met = all(r["status"] == "PASS" for r in rows)
    return {"numbers": numbers, "gates": rows,
            "verdict": "shadow -> on: MET" if met else "shadow -> on: NOT MET (" + ", ".join(
                r["gate"] for r in rows if r["status"] != "PASS") + ")"}


def render(card: dict) -> str:
    n = card["numbers"]
    lines = [f"\nPHASE 4 SCORECARD  ns={n['namespace']} mode={n['mode']} filter={n['filter']}",
             f"  tasks {n['tasks']} (real {n['real_tasks']}) by kind {n['by_kind']} by backend {n['by_backend']}",
             f"  done {n['tasks_done']}, blocked {n['tasks_blocked']}, steps {n['steps_done']} "
             f"(redone after stop {n['steps_redone_after_stop']}), handoffs {n['handoffs']}, runs {n['runs']}",
             f"  chains {n['chains']} (finished {n['chains_finished']}): {n['chain_window']}",
             f"  interventions {n['interventions']} (blocked-needs-human {n['interventions_blocked_human']}, "
             f"rejects {n['interventions_rejects']}); designed approvals {n['designed_approvals']}, "
             f"shadow reviews {n['shadow_reviews']}",
             f"  conflicts {n['conflicts']}, stop drills {n['stop_drills']}",
             f"  cost/task ${n['cost_per_task_usd']}, tokens/task {n['tokens_per_task']}, "
             f"effects checked {n['effects_checked']}, audit writes {n['audit_writes_checked']}",
             "", f"  {'gate':34} {'value':>14}  {'target':>22}  status"]
    for r in card["gates"]:
        lines.append(f"  {r['gate']:34} {str(r['value']):>14}  {r['target']:>22}  {r['status']}")
    lines.append("  " + card["verdict"])
    return "\n".join(lines)


def main(argv=None):
    import runner
    ap = argparse.ArgumentParser(description="Phase 4 scorecard from KH data")
    ap.add_argument("--ns", default=runner.DEFAULT_NS)
    ap.add_argument("--backend", default="all", choices=["all", "dry", "claude_cli"])
    ap.add_argument("--run")
    ap.add_argument("--p95-ms", type=float, help="people's /context/step p95 measured by p95probe.py")
    ap.add_argument("--g10", choices=["pass", "fail"], help="the tier-2 bench verdict (G10)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    sim = runner.connect(a.ns, attach=False)
    card = compute(sim, a.backend, a.run, a.p95_ms, a.g10)
    print(json.dumps(card, indent=1, default=str) if a.json else render(card))


if __name__ == "__main__":
    main()
