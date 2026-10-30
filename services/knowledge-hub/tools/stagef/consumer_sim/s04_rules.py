"""S04 rule graph: bootstrap legacy rules (unverified), add new spec rules, a 3-hop query returns a conflict pair
('orders over the credit limit -> blocked' vs 'VIP orders -> auto-approved'), scan coverage, and the write-back
gate fails, then passes.
"""
import time

from simlib import PROJECT, env_headers, standalone, uid

TITLE = "rule graph: bootstrap, spec rules, 3-hop conflict, coverage, gate"


def rule(entity, attribute, effect, condition="", **kw):
    return {"project": PROJECT, "entity": entity, "attribute": attribute, "condition": condition, "effect": effect,
            **kw}


def run(sim, sc):
    agent = sim.principal("agent-rules", "agent")
    conf = sim.principal("confirmer-rules", "confirmer")
    run_id = uid("run")
    RUN = env_headers(run=run_id, unit="rules", attempt=1)
    tag = uid("g").split("-")[1][:6]           # keeps entity names unique per simulator run
    E = {k: f"{k}{tag}" for k in ("Customer", "Order", "Invoice", "Tax", "Shipment", "Refund", "Ledger")}

    legacy = [
        rule(E["Customer"], "tier", "VIP tier is granted after 12 months of orders",
             source_text="legacy test: test_vip_after_12_months",
             links=[{"relation": "AFFECTS", "to_entity": E["Order"]}]),
        rule(E["Order"], "payment", "must be paid before shipping", "order is shipped",
             source_text="legacy code: OrderService.ship()", links=[{"relation": "AFFECTS", "to_entity": E["Invoice"]}]),
        rule(E["Invoice"], "total", "equals the sum of the lines", source_text="legacy test: test_invoice_total",
             links=[{"relation": "DEPENDS_ON", "to_entity": E["Tax"]}]),
        rule(E["Tax"], "rate", "comes from the country table", source_text="legacy code: TaxTable"),
        rule(E["Invoice"], "total", "Equals the sum of  the lines", source_text="duplicate from another test"),
    ]
    r = agent.post("/rules:bulk", {"project": PROJECT, "rules": legacy}, headers=RUN, route="POST /rules:bulk")
    sc.check("bootstrap :bulk stores 4 legacy rules and dedupes the 5th", r.status == 200 and r.j.get("created") == 4
             and r.j.get("duplicates") == 1, r)
    got = agent.get("/rules", params={"entity": E["Tax"]}, route="GET /rules").j.get("rules", [])
    sc.check("legacy rules are unverified with origin bootstrap", got and got[0]["validity"] == "unverified"
             and got[0]["origin"] == "bootstrap", got)
    r = agent.post("/rules:bulk", {"project": PROJECT, "rules": [rule("X" + tag, "a", "b", validity="verified")]},
                   route="POST /rules:bulk")
    sc.check("an agent cannot bootstrap verified rules (422/403)", r.status in (403, 422), r)

    blocked = rule(E["Order"], "approval", "order is blocked until a manager approves it",
                   "order total exceeds the customer credit limit", quote_id=sim.state.get("quote_blocked", "spec#1#0"),
                   source_text="spec/orders.md: credit limit rule")
    vip = rule(E["Order"], "approval", "order is approved automatically", "customer is VIP",
               source_text="spec/vip.md: VIP orders are approved automatically")
    r1 = agent.put(f"/rules/blocked-{tag}", blocked, headers={**RUN, "If-None-Match": "*"}, route="PUT /rules/{id}")
    r2 = agent.put(f"/rules/vip-{tag}", vip, headers={**RUN, "If-None-Match": "*"}, route="PUT /rules/{id}")
    sc.check("two new spec rules written back (201, origin write_back)", r1.status == 201 and r2.status == 201
             and r1.j.get("origin") == "write_back", (r1.brief(), r2.brief()))

    t0 = time.perf_counter()
    r = agent.post("/rules:query", {"project": PROJECT, "start_entities": [E["Customer"]], "hops": 3},
                   route="POST /rules:query (3 hops)")
    ms = (time.perf_counter() - t0) * 1000
    ids = {x["rule_id"] for x in r.j.get("rules", [])}
    sc.check("3-hop query from Customer reaches the Order rules through AFFECTS", r.status == 200
             and {f"blocked-{tag}", f"vip-{tag}"} <= ids, r)
    sc.numbers["query_3hop_ms"] = round(ms, 1)
    sc.numbers["query_path"] = r.j.get("path")
    pair = [c for c in r.j.get("conflicts", []) if {c["a"], c["b"]} == {f"blocked-{tag}", f"vip-{tag}"}]
    sc.check("the 3-hop answer flags 'over the credit limit -> blocked' vs 'VIP -> auto-approved' as a conflict pair",
             len(pair) == 1, r.j.get("conflicts"))
    sc.numbers["conflict_pair"] = pair[0] if pair else None
    disjoint = [rule(E["Shipment"], "speed", "express", "weight < 5 kg", source_text="s"),
                rule(E["Shipment"], "speed", "freight", "weight >= 5 kg", source_text="s")]
    agent.post("/rules:bulk", {"project": PROJECT, "rules": disjoint}, headers=RUN, route="POST /rules:bulk")
    r = agent.post("/rules:query", {"project": PROJECT, "start_entities": [E["Shipment"]], "hops": 1},
                   route="POST /rules:query (1 hop)")
    sc.check("disjoint conditions (weight < 5 kg vs >= 5 kg) are not a conflict", r.status == 200
             and not r.j.get("conflicts"), r.j.get("conflicts"))
    r = agent.post("/rules:query", {"project": PROJECT, "start_entities": [E["Customer"]], "hops": 3, "path": "sql"},
                   route="POST /rules:query (sql)")
    sc.check("the SQL path agrees with the graph path on rules and conflicts",
             {x["rule_id"] for x in r.j.get("rules", [])} == ids and any(
                 {c["a"], c["b"]} == {f"blocked-{tag}", f"vip-{tag}"} for c in r.j.get("conflicts", [])), r)

    # coverage
    r = conf.post(f"/rules/blocked-{tag}:confirm", {"validity": "verified", "run_id": run_id},
                  route="POST /rules/{id}:confirm")
    sc.check("a confirmer verifies the credit-limit rule", r.status == 200 and r.j.get("validity") == "verified", r)
    r = agent.post(f"/rules/vip-{tag}:confirm", {"validity": "verified"}, route="POST /rules/{id}:confirm")
    sc.check("an agent cannot confirm (403)", r.status == 403, r)
    scanned = [E["Order"], E["Customer"], E["Invoice"], E["Refund"]]
    r = agent.post("/rules/scans", {"scan_id": f"scan-{tag}", "project": PROJECT, "entities_scanned": scanned},
                   route="POST /rules/scans")
    sc.check("scan coverage: any 0.75 (Refund uncovered), verified 0.25", r.status == 201
             and r.j.get("coverage_any") == 0.75 and r.j.get("coverage_verified") == 0.25
             and r.j.get("uncovered") == [E["Refund"]], r)
    sc.numbers["coverage"] = {"any": r.j.get("coverage_any"), "verified": r.j.get("coverage_verified")}

    # write-back gate
    G = {"run_id": run_id, "project": PROJECT, "entities": [E["Order"], E["Refund"]]}
    r = agent.post("/rules:gate", G, route="POST /rules:gate")
    sc.check("gate fails: Refund has no rule of this run", r.status == 200 and r.j.get("pass") is False
             and r.j.get("missing") == [E["Refund"]], r)
    agent.put(f"/rules/refund-{tag}", rule(E["Refund"], "approval", "needs a second approval", "refund above the limit",
                                           source_text="spec/vip.md: refund rule",
                                           links=[{"relation": "DEPENDS_ON", "to_entity": E["Ledger"]}]),
              headers=RUN, route="PUT /rules/{id}")
    r = agent.post("/rules:gate", G, route="POST /rules:gate")
    sc.check("gate still fails: the refund rule DEPENDS_ON a rule-less Ledger (orphan)", r.j.get("pass") is False
             and r.j.get("missing") == [] and any(o.get("reason") == "dangling_dependency"
                                                   for o in r.j.get("orphans", [])), r)
    agent.put(f"/rules/ledger-{tag}", rule(E["Ledger"], "balance", "never negative", source_text="spec ledger"),
              headers=RUN, route="PUT /rules/{id}")
    r = agent.post("/rules:gate", G, route="POST /rules:gate")
    sc.check("gate passes once every entity is covered in the run and no orphan is left", r.j.get("pass") is True, r)


if __name__ == "__main__":
    standalone(run, "S04", TITLE)
