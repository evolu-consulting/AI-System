"""S07 vault: a grader writes holdout items; agent and judge get 403 on every vault route; a canary pasted into an
agent event (and a custom canary into a record) is stored masked and kh.canary_hit is recorded (never with the
canary itself); vault text never comes back through retrieval.
"""
import json
import time

from simlib import PROJECT, env_headers, ev_body, standalone, uid

TITLE = "vault: grader-only holdout, 403 for agents/judges, canary leak detection"
HOLDOUT_Q = "HOLDOUT case 7731: which unit test catches the off-by-one in the invoice pager?"


def run(sim, sc):
    grader = sim.principal("grader-1", "grader")
    agent = sim.principal("agent-vault", "agent")
    judge = sim.principal("judge-vault", "judge")
    tag = uid("h").split("-")[1][:6]
    V = "/vault/holdout"
    start = sim.top_seq()
    custom = f"custom-canary-{tag}-0001"
    r = grader.put(f"{V}/items/h1-{tag}", {"body": {"question": HOLDOUT_Q, "answer": "test_pager_last_page"},
                                           "canaries": [custom]}, headers={"If-None-Match": "*"},
                   route="PUT /vault/{v}/items/{id}")
    kh_can = [c["canary"] for c in r.j.get("canaries", []) if c.get("kind") == "kh"]
    sc.check("the grader writes a holdout item: 201 with a KH canary khc-<16 hex> and the custom one",
             r.status == 201 and len(kh_can) == 1 and kh_can[0].startswith("khc-") and len(kh_can[0]) == 20, r)
    r = grader.put(f"{V}/items/h2-{tag}", {"body": {"question": "HOLDOUT case 7732", "answer": "x"}},
                   headers={"If-None-Match": "*"}, route="PUT /vault/{v}/items/{id}")
    sc.check("a second holdout item", r.status == 201, r)
    r = grader.get(f"{V}/items", route="GET /vault/{v}/items")
    sc.check("the grader reads the holdout set", r.status == 200 and len(r.j.get("items", [])) >= 2, r)

    probes = [("GET", "/vault", None), ("GET", V, None), ("GET", f"{V}/items", None),
              ("GET", f"{V}/items/h1-{tag}", None), ("PUT", f"{V}/items/x-{tag}", {"body": {"q": 1}}),
              ("DELETE", f"{V}/items/h1-{tag}", None), ("POST", f"{V}:refresh", {})]
    for who in (agent, judge):
        codes = [(p, who.call(m, p, b, route=f"{m} /vault (denied)").status) for m, p, b in probes]
        sc.check(f"{who.role}: 403 on every vault route", all(s == 403 for _, s in codes), codes)

    # canary leaks
    run_id = uid("run")
    r = agent.post("/events", {"kind": "step.done", "project": PROJECT,
                               "body": ev_body(msg=f"copied from the grader notes: {kh_can[0]} (oops)")},
                   headers=env_headers(run=run_id, unit=f"leak-{tag}", attempt=1), route="POST /events")
    eid = (r.j.get("accepted") or [{}])[0].get("id")
    sc.check("an agent event carrying a KH canary is accepted (stored, not refused: D10)", r.status == 200 and eid, r)
    got = sim.admin.get(f"/events/{eid}", route="GET /events/{id}")
    sc.check("... and stored with the canary masked", got.status == 200 and kh_can[0] not in got.text
             and "[REDACTED:canary]" in got.text, got)
    r = agent.put(f"/records/work-board/leak-{tag}", {"unit": f"leak-{tag}", "status": "x", "note": f"see {custom}"},
                  headers={"If-None-Match": "*"}, route="PUT /records/work-board")
    sc.check("a record carrying a custom canary is stored masked", r.status == 201 and custom not in r.text
             and "[REDACTED:canary]" in r.text, r)
    time.sleep(0.3)
    hits = sim.kh_events("kh.canary_hit", start)
    sc.numbers["kh.canary_hit"] = len(hits)
    h0 = next((h["body"] for h in hits if h["body"].get("canary_kind") == "kh"), {})
    sc.check("kh.canary_hit names vault, item, principal and run (KH canary)", h0.get("vault") == "holdout"
             and h0.get("item") == f"h1-{tag}" and h0.get("principal") == "agent-vault" and h0.get("run_id") == run_id,
             h0)
    sc.check("kh.canary_hit for the custom canary too", any(h["body"].get("canary_kind") == "custom" for h in hits),
             hits)
    sc.check("no kh.canary_hit carries a canary string", not any(kh_can[0] in json.dumps(h) or custom in json.dumps(h)
                                                                  for h in hits))
    r = agent.post("/context/step", {"project": PROJECT, "keyspace": "step",
                                     "key": {"role": "dev", "step": "test", "stack": "any"}, "query": HOLDOUT_Q},
                   headers=env_headers(run=run_id, unit=f"retr-{tag}", attempt=1), route="POST /context/step")
    sc.check("retrieval with the holdout question returns no vault text", r.status == 200
             and "7731" not in r.text and "test_pager_last_page" not in r.text, r)
    sim.state["vault_canary_item"] = f"h1-{tag}"


if __name__ == "__main__":
    standalone(run, "S07", TITLE)
