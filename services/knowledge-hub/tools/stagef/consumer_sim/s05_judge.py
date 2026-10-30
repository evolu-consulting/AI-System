"""S05 judge ledger: decision records with expected and (later) scored outcome, similar-case query with decay and
partition by judge model; the guard registry is read-only to agents (a write is 403).
"""
import time

from simlib import standalone, uid

TITLE = "judge ledger: decisions, scored outcomes, decay + partition query, guard registry ACL"
DAY = 86400000


def run(sim, sc):
    ja = sim.principal("judge-a", "judge")
    jb = sim.principal("judge-b", "judge")
    agent = sim.principal("agent-judge", "agent")
    orch = sim.principal("orch-judge", "orchestrator")
    kind = uid("triage")
    now = int(time.time() * 1000)
    L = "/records/decision-ledger"
    plan = [(ja, "judge-model-A@2026-08", 0), (ja, "judge-model-A@2026-08", 30), (ja, "judge-model-A@2026-08", 60),
            (jb, "judge-model-B@2026-10", 0), (jb, "judge-model-B@2026-10", 10)]
    ids = []
    for i, (j, model, age) in enumerate(plan):
        rid = f"{kind}-{i}"
        body = {"case_kind": kind, "judge_model": model, "features": {"test": f"t{i}", "fail_rate": 0.1 * i},
                "options": ["quarantine", "fix", "ignore"], "chosen": "quarantine" if i % 2 else "fix",
                "expected": {"green_within_runs": 2}, "decided_at": now - age * DAY}
        r = j.put(f"{L}/{rid}", body, headers={"If-None-Match": "*"}, route="PUT /records/decision-ledger")
        if r.status != 201:
            sc.check(f"judge writes decision {rid}", False, r)
            return
        ids.append((rid, j, r.headers.get("ETag")))
    sc.check("judges write 5 decisions with expected outcomes (201, rev 1)", len(ids) == 5)
    patched = 0
    for i, (rid, j, etag) in enumerate(ids):
        r = j.patch(f"{L}/{rid}", {"outcome": {"green_within_runs": 1 + i % 3}, "scored": 1.0 if i % 3 == 0 else 0.0,
                                   "attribution": "judge" if i % 2 else "agent"},
                    headers={"If-Match": etag}, route="PATCH /records/decision-ledger (If-Match)")
        patched += r.status == 200 and r.j.get("rev") == 2
    sc.check("each decision gets its scored outcome later with If-Match (rev 2)", patched == 5, patched)
    r = ja.patch(f"{L}/{ids[0][0]}", {"scored": 0.5}, route="PATCH /records/decision-ledger")
    sc.check("a scored outcome without If-Match is 428 (require_if_match)", r.status == 428, r)
    r = ja.patch(f"{L}/{ids[0][0]}", {"scored": 0.5}, headers={"If-Match": '"1"'}, route="PATCH /records/decision-ledger")
    sc.check("a stale If-Match is 409 write_conflict", r.status == 409 and r.error == "write_conflict", r)
    r = ja.get(f"{L}/{ids[0][0]}:revisions", route="GET /records/{t}/{id}:revisions")
    sc.check("both revisions are kept (audit)", [x["rev"] for x in r.j.get("revisions", [])] == [1, 2], r)

    r = orch.post(f"{L}:query", {"where": {"case_kind": kind}, "decay": {"field": "decided_at", "half_life_days": 30},
                                 "partition_by": "judge_model"}, route="POST /records/decision-ledger:query")
    parts = {p["key"]: p for p in r.j.get("partitions", [])}
    w = {x["id"]: x["weight"] for x in r.j.get("records", [])}
    sc.check("similar cases: partitioned by judge model with counts", r.status == 200
             and {k: v["n"] for k, v in parts.items()} == {"judge-model-A@2026-08": 3, "judge-model-B@2026-10": 2},
             r)
    sc.check("decay weight = 0.5 ** (age / 30 d): 1.0, 0.5, 0.25 for model A", abs(w.get(f"{kind}-0", 0) - 1) < 0.02
             and abs(w.get(f"{kind}-1", 0) - 0.5) < 0.02 and abs(w.get(f"{kind}-2", 0) - 0.25) < 0.02, w)
    sc.numbers["partitions"] = {k: {"n": v["n"], "weight_sum": round(v.get("weight_sum", 0), 3)}
                                for k, v in parts.items()}
    r = jb.post(f"{L}:query", {"where": {"case_kind": kind, "judge_model": "judge-model-B@2026-10"},
                               "decay": {"field": "decided_at", "half_life_days": 30}}, route="POST /records/decision-ledger:query")
    sc.check("a judge queries its own model's history", r.status == 200 and r.j.get("count") == 2, r)
    r = agent.put(f"{L}/{kind}-agent", {"case_kind": kind, "judge_model": "x", "options": [], "chosen": "x",
                                        "expected": {}}, headers={"If-None-Match": "*"},
                  route="PUT /records/decision-ledger")
    sc.check("an agent cannot write the decision ledger (403)", r.status == 403, r)
    r = agent.get(f"{L}/{ids[0][0]}", route="GET /records/decision-ledger")
    sc.check("... nor read it (read_roles judge, orchestrator: 403)", r.status == 403, r)

    G = "/records/guard-registry"
    gid = uid("guard")
    r = sim.admin.put(f"{G}/{gid}", {"name": gid, "pattern": "rm -rf /", "note": "never wipe the workspace root"},
                      headers={"If-None-Match": "*"}, route="PUT /records/guard-registry")
    sc.check("the namespace admin registers a guard", r.status == 201, r)
    sim.state["guard"] = gid
    for who in (agent, ja, orch):
        r = who.put(f"{G}/{gid}-x", {"name": "x", "pattern": "y"}, headers={"If-None-Match": "*"},
                    route="PUT /records/guard-registry")
        sc.check(f"{who.role} cannot write the guard registry (403)", r.status == 403, r)
    r = agent.patch(f"{G}/{gid}", {"pattern": "rm -rf /tmp"}, route="PATCH /records/guard-registry")
    sc.check("an agent cannot patch a guard either (403)", r.status == 403, r)
    r = agent.get(f"{G}/{gid}", route="GET /records/guard-registry")
    sc.check("an agent reads the guard registry", r.status == 200 and r.j.get("body", {}).get("pattern") == "rm -rf /", r)


if __name__ == "__main__":
    standalone(run, "S05", TITLE)
