"""Contract test: app/caps/rules.py (stage F9, design 4.6).

  1. PUT create (If-None-Match: *) / update (If-Match): ETag, 409 write_conflict + kh.write_conflict,
     409 duplicate (same content under another id) + kh.duplicate, validation 422, links.
  2. Validity: verified needs the confirm policy (403 for an agent), :confirm by a confirmer, a content change
     drops a confirmation back to unverified, a manifest confirm_policy replaces the default.
  3. :bulk bootstrap: unverified + origin bootstrap by default, dedupe by hash (in the call and against SQL),
     all or nothing unless ?partial=true, verified refused for writers, 413 over 5,000.
  4. Projection: rules land in the (ns, project) Kuzu graph (temporary directory for this test only).
  5. :query: 3-hop bound (hops > 3 is clamped), relations / validity / min_confidence filters, generic conflict
     pairs; the graph path and the SQL path give the same answer; graph down -> SQL with fallback_reason;
     a failed projection marks it stale -> SQL until :reproject.
  6. Scans: coverage_any / coverage_verified per touched-entity set, replay, 409 on a different set.
  7. :gate: missing entities, orphans (no source, dangling DEPENDS_ON), pass.
  8. Fencing (settings.rules.fenced) and require_if_match: 428, stale epoch 409 + kh.stale_epoch.
  9. Idempotency-Key replay, roles / project grants.
 10. RACES: If-Match update, create-only PUT, concurrent bulk of the same rules.

    .venv\\Scripts\\python tests\\caps\\test_rules.py
"""
import os
import shutil
import tempfile

from harness import H

from app import config, sqldb
from app.caps import core, rules
from app.caps.core import Caller

KUZU_TMP = tempfile.mkdtemp(prefix="kh_rules_kuzu_")
config.KUZU_PROJECTS_PATH = KUZU_TMP          # this test's own graph directories

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha", "beta"])


def as_(principal, role="agent", projects=None):
    h = {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}
    if projects is not None:
        h["X-Test-Projects"] = ",".join(projects)
    return h


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    if not p:
        return None
    pr = request.headers.get("x-test-projects")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service",
                  projects=set(pr.split(",")) if pr is not None else None)


core.CALLER_RESOLVERS.append(_test_resolver)


def kh_events(ns, kind):
    with sqldb.connect() as conn:
        return conn.execute("SELECT body_json FROM kh_event WHERE ns=? AND kind=?", [ns, kind]).fetchall()


def attach_ns(ns, settings=None):
    r = c.put(f"/v1/admin/ns/{ns}", json={"projects": ["alpha", "beta"]}, headers=OWNER)
    assert r.status_code in (200, 201), r.text
    r = c.put(f"/v1/{ns}/manifest", json={"settings": {"rules": settings or {}}}, headers=OWNER)
    assert r.status_code == 200, r.text


attach_ns("acme")
attach_ns("cpol", {"confirm_policy": {"roles": ["judge"]}})
attach_ns("fence", {"fenced": True, "require_if_match": True})

AGENT = as_("a1")
CONF = as_("c1", "confirmer")
R = "/v1/acme/rules"


def rule(entity, attribute, effect, condition="", **kw):
    return {"project": "alpha", "entity": entity, "attribute": attribute, "condition": condition, "effect": effect,
            "source_text": kw.pop("source_text", f"src {entity}.{attribute}"), **kw}


# ── 1. PUT ───────────────────────────────────────────────────────────────────
r = c.put(f"{R}/r1", json=rule("Order", "status", "must be paid before shipping", "order is shipped",
                               links=[{"relation": "AFFECTS", "to_entity": "Invoice"}]),
          headers={**AGENT, "If-None-Match": "*"})
H.check("PUT create is 201 with ETag 1, unverified, origin write_back", r.status_code == 201
        and r.headers.get("etag") == '"1"' and r.json()["validity"] == "unverified"
        and r.json()["origin"] == "write_back" and r.json()["entity_key"] == "order", r.text)
H.check("the write reports the projection state", r.json().get("projection") == "ok", r.json().get("projection"))
r = c.put(f"{R}/r1", json=rule("Order", "status", "x"), headers={**AGENT, "If-None-Match": "*"})
H.check("create-only on an existing id is 409 duplicate", r.status_code == 409 and r.json()["error"] == "duplicate",
        r.text)
r = c.get(f"{R}/r1", headers=AGENT)
H.check("GET returns the rule, its links and ETag", r.status_code == 200 and r.headers.get("etag") == '"1"'
        and r.json()["links"] == [{"relation": "AFFECTS", "to_entity": "Invoice", "to_key": "invoice"}], r.text)
r = c.put(f"{R}/r1", json=rule("Order", "status", "must be paid before shipping", "order is shipped", confidence=0.9,
                               links=[{"relation": "AFFECTS", "to_entity": "Invoice"}]),
          headers={**AGENT, "If-Match": '"1"'})
H.check("PUT with the right If-Match updates to rev 2", r.status_code == 200 and r.json()["rev"] == 2
        and r.headers.get("etag") == '"2"' and r.json()["confidence"] == 0.9, r.text)
r = c.put(f"{R}/r1", json=rule("Order", "status", "other"), headers={**AGENT, "If-Match": '"1"'})
H.check("a stale If-Match is 409 write_conflict with the current row", r.status_code == 409
        and r.json()["error"] == "write_conflict" and r.json()["current"]["rev"] == 2, r.text)
H.check("the conflict wrote kh.write_conflict", len(kh_events("acme", "kh.write_conflict")) == 1)
r = c.put(f"{R}/r1-copy", json=rule("ORDER", "Status", "Must be paid   before shipping", "Order is shipped"),
          headers=AGENT)
H.check("the same content under another id is 409 duplicate naming the existing rule", r.status_code == 409
        and r.json()["existing_rule_id"] == "r1", r.text)
H.check("the duplicate wrote kh.duplicate", len(kh_events("acme", "kh.duplicate")) == 1)
r = c.put(f"{R}/bad", json={"project": "alpha", "entity": "", "effect": 3, "confidence": 2,
                            "links": [{"relation": "OWNS", "to_entity": "x"}]}, headers=AGENT)
H.check("an invalid rule is 422 with a pointer per error", r.status_code == 422
        and {"/entity", "/attribute", "/effect", "/confidence", "/links/0"} <= {e["pointer"] for e in r.json()["errors"]},
        r.text)
r = c.put(f"{R}/scans", json=rule("A", "b", "c"), headers=AGENT)
H.check("the reserved id 'scans' is refused", r.status_code == 422, r.text)
r = c.put(f"{R}/x1", json=rule("Order", "status", "z"), headers={**AGENT, "If-Match": '"1"'})
H.check("If-Match on a missing rule is 404", r.status_code == 404, r.text)

# ── 2. validity and the confirm policy ───────────────────────────────────────
r = c.put(f"{R}/r2", json=rule("Order", "total", "is positive", validity="verified"), headers=AGENT)
H.check("an agent may not write validity verified (403)", r.status_code == 403, r.text)
r = c.put(f"{R}/r2", json=rule("Order", "total", "is positive"), headers=AGENT)
H.check("the agent writes it unverified", r.status_code == 201, r.text)
r = c.post(f"{R}/r2:confirm", json={"validity": "verified"}, headers=AGENT)
H.check("an agent may not confirm (403)", r.status_code == 403, r.text)
r = c.post(f"{R}/r2:confirm", json={"validity": "verified", "run_id": "run-c"}, headers={**CONF, "If-Match": '"1"'})
H.check("a confirmer confirms with If-Match (rev 2, verified)", r.status_code == 200
        and r.json()["validity"] == "verified" and r.json()["rev"] == 2, r.text)
r = c.post(f"{R}/r2:confirm", json={"validity": "verified"}, headers={**CONF, "If-Match": '"1"'})
H.check("a stale confirm is 409 write_conflict", r.status_code == 409 and r.json()["error"] == "write_conflict", r.text)
r = c.put(f"{R}/r2", json=rule("Order", "total", "is positive"), headers=AGENT)
H.check("re-writing the same content keeps verified", r.json()["validity"] == "verified", r.text)
r = c.put(f"{R}/r2", json=rule("Order", "total", "is non-negative"), headers=AGENT)
H.check("a content change drops the confirmation to unverified", r.json()["validity"] == "unverified", r.text)
c.post(f"{R}/r2:confirm", json={"validity": "verified"}, headers=CONF)
r = c.put(f"{R}/r1", json=rule("Order", "status", "must be paid before shipping", "order is shipped",
                               validity="retired"), headers=AGENT)
H.check("a writer may retire a rule", r.json()["validity"] == "retired", r.text)
r = c.put(f"{R}/r1", json=rule("Order", "status", "must be paid before shipping", "order is shipped", confidence=0.9,
                               links=[{"relation": "AFFECTS", "to_entity": "Invoice"}], validity="unverified"),
          headers=AGENT)
r = c.put(f"{R}/r9", json=rule("Order", "status", "q", superseded_by="r1"), headers=AGENT)
H.check("superseded_by without validity superseded is 422", r.status_code == 422, r.text)
r = c.put("/v1/cpol/rules/p1", json=rule("A", "b", "c"), headers=AGENT)
r = c.post("/v1/cpol/rules/p1:confirm", json={}, headers=CONF)
H.check("with confirm_policy roles=[judge] a confirmer is refused", r.status_code == 403, r.text)
r = c.post("/v1/cpol/rules/p1:confirm", json={"validity": "contradicted"}, headers=as_("j1", "judge"))
H.check("... and a judge confirms (contradicted)", r.status_code == 200 and r.json()["validity"] == "contradicted",
        r.text)

# ── 3. bulk bootstrap ────────────────────────────────────────────────────────
B = "/v1/acme/rules:bulk"
boot = [rule("Invoice", "total", "equals the sum of lines", links=[{"relation": "DEPENDS_ON", "to_entity": "Tax"}]),
        rule("Tax", "rate", "comes from the country table"),
        rule("Invoice", "total", "Equals the sum of  lines"),                # same content as [0]
        rule("Order", "total", "is non-negative")]                           # = r2 (in SQL)
r = c.post(B, json={"project": "alpha", "rules": boot}, headers=AGENT)
j = r.json()
H.check("bulk stores the new rules and dedupes by hash", r.status_code == 200 and j["created"] == 2
        and j["duplicates"] == 2, r.text)
H.check("an in-call duplicate points at the first rule", j["accepted"][2]["rule_id"] == j["accepted"][0]["rule_id"]
        and j["accepted"][2]["duplicate"], j["accepted"])
H.check("a duplicate of a stored rule names it", j["accepted"][3]["rule_id"] == "r2", j["accepted"])
got = c.get("/v1/acme/rules?entity=tax", headers=AGENT).json()["rules"]
H.check("bootstrap rules are unverified with origin bootstrap", len(got) == 1 and got[0]["validity"] == "unverified"
        and got[0]["origin"] == "bootstrap" and got[0]["rule_id"].startswith("r_"), got)
r = c.post(B, json={"project": "alpha", "rules": [rule("Q", "a", "b"), rule("Q", "b", "c", validity="verified"),
                                                  {"entity": "x"}]}, headers=AGENT)
H.check("bulk with invalid items stores nothing (422 with pointers)", r.status_code == 422
        and [x["index"] for x in r.json()["rejected"]] == [1, 2]
        and c.get("/v1/acme/rules?entity=q", headers=AGENT).json()["rules"] == [], r.text)
r = c.post(B + "?partial=true", json={"project": "alpha", "rules": [rule("Q", "a", "b"), {"entity": "x"}]},
           headers=AGENT)
H.check("?partial=true keeps the valid ones", r.status_code == 200 and r.json()["created"] == 1
        and len(r.json()["rejected"]) == 1, r.text)
r = c.post(B, json={"project": "alpha", "rules": [rule("Q", "z", "b", validity="verified")]}, headers=OWNER)
H.check("the namespace admin may bootstrap verified rules", r.status_code == 200 and r.json()["created"] == 1, r.text)
r = c.post(B, json={"project": "alpha", "rules": [rule("Q", "a", "b")] * 5001}, headers=AGENT)
H.check("more than 5,000 rules is 413", r.status_code == 413, r.status_code)
r = c.post(B, json={"project": "alpha", "rules": [{**rule("Q", "a", "other"), "rule_id": "r1"}]}, headers=AGENT)
H.check("bulk does not overwrite an id with other content (409, nothing stored)", r.status_code == 409, r.text)

# ── 4. projection ────────────────────────────────────────────────────────────
g = rules._graph("acme", "alpha")
ON_HANA_GRAPH = config.GRAPH_BACKEND == "hana"


def fetch_nodes(graph, core_ids):
    """The adapter's node rows on either backend (HanaAdapter._fetch_nodes takes a cursor)."""
    if not ON_HANA_GRAPH:
        return graph._fetch_nodes(core_ids)
    with graph._pool.connection() as conn:
        cur = conn.cursor()
        try:
            return graph._fetch_nodes(cur, core_ids)
        finally:
            cur.close()


nodes = {n["core_id"]: n for n in fetch_nodes(g, [rules.rule_node("r1"), rules.entity_node("invoice")])}
H.check("the rule is a node of entity_type 'rule' in the (ns, project) Kuzu graph",
        nodes.get("rule__r1", {}).get("entity_type") == "rule"
        and nodes["rule__r1"]["attributes"]["effect"] == "must be paid before shipping", nodes)
if ON_HANA_GRAPH:
    from app.graph_db.hana_adapter import project_prefix  # noqa: E402
    with sqldb.connect() as conn:
        n_tabs = len(conn.execute("SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME=CURRENT_SCHEMA AND "
                                  "TABLE_NAME LIKE ?", [project_prefix(rules.graph_id("acme", "alpha")) + "%"]).fetchall())
    H.check("the graph lives in this test's HANA schema (project-prefixed tables)", n_tabs >= 2, n_tabs)
else:
    H.check("the graph lives in this test's temporary directory",
            os.path.isdir(os.path.join(KUZU_TMP, rules.graph_id("acme", "alpha"))), os.listdir(KUZU_TMP))

# ── 5. query ─────────────────────────────────────────────────────────────────
Q = "/v1/acme/rules:query"


def q(body, headers=AGENT):
    r = c.post(Q, json={"project": "alpha", **body}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def ids(res):
    return sorted(x["rule_id"] for x in res["rules"])


inv = j["accepted"][0]["rule_id"]
tax = j["accepted"][1]["rule_id"]
res1 = q({"start_entities": ["order"], "hops": 1})
H.check("hop 1: the rules of the entity (graph path)", res1["path"] == "graph" and ids(res1) == ["r1", "r2"], res1)
res3 = q({"start_entities": ["Order"], "hops": 3})
H.check("hop 3: entity -> rule -> AFFECTS entity -> its rules", ids(res3) == sorted(["r1", "r2", inv]), ids(res3))
res9 = q({"start_entities": ["Order"], "hops": 9})
H.check("hops above 3 are clamped to 3 (the Tax rule at hop 5 is not reached)", res9["hops"] == 3
        and tax not in ids(res9) and ids(res9) == ids(res3), ids(res9))
sql3 = q({"start_entities": ["Order"], "hops": 3, "path": "sql"})
H.check("the SQL path gives the same rules and edges and says so", sql3["path"] == "sql"
        and sql3["fallback_reason"] == "requested" and ids(sql3) == ids(res3) and sql3["edges"] == res3["edges"],
        (sql3["edges"], res3["edges"]))
r = q({"start_entities": ["Order"], "hops": 3, "relations": ["APPLIES_TO"]})
H.check("relations narrow the walk", ids(r) == ["r1", "r2"], ids(r))
r = q({"start_entities": ["Order"], "hops": 3, "validity_in": ["verified"]})
H.check("validity_in filters the answer", ids(r) == ["r2"], ids(r))
r = q({"start_entities": ["Order"], "hops": 3, "min_confidence": 0.95})
H.check("min_confidence drops low-confidence rules (r1 at 0.9) and the paths through them",
        ids(r) == ["r2"], ids(r))
H.check("related lists the rules touching each start entity", res3["related"]["order"] == ["r1", "r2"],
        res3["related"])

# conflict candidates: same entity + attribute, different effect, overlapping conditions
c.post(B, json={"project": "alpha", "rules": [
    rule("Cart", "limit", "max 10 items", "user is guest"),
    rule("Cart", "limit", "max 50 items", "user is guest and cart is promo"),      # subsumes
    rule("Cart", "limit", "max 99 items", "x > 5"),
    rule("Cart", "limit", "max 1 item", "x < 5"),                                 # disjoint from x > 5
    rule("Cart", "limit", "max 10 items", "user is guest; cart is promo"),         # same effect as #0
    rule("Cart", "owner", "anyone"),
    rule("Cart", "owner", "only the user")]}, headers=AGENT)                       # unconditional
res = q({"start_entities": ["cart"], "hops": 1})
kinds = sorted((x["attribute"], x["overlap"]) for x in res["conflicts"])
H.check("conflict pairs: subsumed conditions and unconditional rules, never disjoint ones",
        ("limit", "subsumes") in kinds and ("owner", "unconditional") in kinds
        and not any(set(x["validity"]) and x["overlap"] is None for x in res["conflicts"]), res["conflicts"])
lim = [x for x in res["conflicts"] if x["attribute"] == "limit"]
rule_by = {x["rule_id"]: x for x in res["rules"]}
H.check("x > 5 vs x < 5 is not a candidate (no clause containment)", not any(
    {rule_by[x["a"]]["condition"], rule_by[x["b"]]["condition"]} == {"x > 5", "x < 5"} for x in lim), lim)
H.check("rules with the same effect are not candidates", all(
    rules.squash(rule_by[x["a"]]["effect"]) != rules.squash(rule_by[x["b"]]["effect"]) for x in res["conflicts"]))
sqlres = q({"start_entities": ["cart"], "hops": 1, "path": "sql"})
H.check("conflicts are the same on the SQL path", sqlres["conflicts"] == res["conflicts"])
# independent triggers that can hold at once are 'possible' candidates; text-provable disjointness is not
ov = rules.overlap
H.check("overlap: independent conditions are 'possible' (credit limit vs VIP)",
        ov("order total exceeds the customer credit limit", "customer is VIP") == "possible"
        and ov("a and b", "a and c") == "possible", ov("order total exceeds the customer credit limit", "customer is VIP"))
H.check("overlap: provably disjoint conditions are never candidates", all(ov(a, b) is None for a, b in (
    ("x > 5", "x < 5"), ("x >= 5", "x < 5"), ("weight < 5 kg", "weight >= 5 kg"), ("x = 1", "x = 2"),
    ("customer is VIP", "customer is not VIP"), ("not paid", "paid"), ("total above limit", "total at most limit"),
    ("status = open, user is guest", "status = closed"))), [(a, b, ov(a, b)) for a, b in (("x >= 5", "x < 5"),)])
H.check("overlap: touching or same-side ranges and different units are not disjoint",
        ov("x >= 5", "x <= 5") == "possible" and ov("x > 5", "x > 7") == "possible"
        and ov("w < 5 kg", "w > 7 lb") == "possible" and ov("x != 1", "x = 2") == "possible")
c.post(B, json={"project": "alpha", "rules": [
    rule("Ord", "approval", "blocked until a manager approves", "order total exceeds the customer credit limit"),
    rule("Ord", "approval", "approved automatically", "customer is VIP"),
    rule("Ship", "speed", "express", "weight < 5 kg"), rule("Ship", "speed", "freight", "weight >= 5 kg")]},
       headers=AGENT)
res = q({"start_entities": ["ord", "ship"], "hops": 1})
H.check("a query flags credit-limit-blocked vs VIP-auto-approved as a 'possible' conflict, not the disjoint pair",
        [(x["entity"], x["overlap"]) for x in res["conflicts"]] == [("Ord", "possible")], res["conflicts"])
H.check("... and the SQL path agrees", q({"start_entities": ["ord", "ship"], "hops": 1, "path": "sql"})["conflicts"]
        == res["conflicts"])

# graph unavailable -> SQL fallback
real_graph = rules._graph


def broken(ns, project):
    raise RuntimeError("graph down")


rules._graph = broken
r = q({"start_entities": ["Order"], "hops": 3})
H.check("graph down: the query answers from SQL and reports graph_unavailable", r["path"] == "sql"
        and r["fallback_reason"] == "graph_unavailable" and ids(r) == ids(res3), r.get("fallback_reason"))
r = c.put(f"{R}/r5", json=rule("Order", "currency", "is EUR"), headers=AGENT)
H.check("a write while the graph is down still commits (projection stale)", r.status_code == 201
        and r.json()["projection"] == "stale", r.text)
rules._graph = real_graph
r = q({"start_entities": ["Order"], "hops": 1})
H.check("a stale projection keeps queries on SQL (projection_stale) and includes the new rule",
        r["path"] == "sql" and r["fallback_reason"] == "projection_stale" and "r5" in ids(r), r.get("fallback_reason"))
r = c.post("/v1/acme/rules:reproject", json={"project": "alpha"}, headers=AGENT)
H.check("an agent may not reproject (403)", r.status_code == 403, r.text)
r = c.post("/v1/acme/rules:reproject", json={"project": "alpha"}, headers=as_("o1", "orchestrator"))
H.check(":reproject rebuilds from SQL", r.status_code == 200 and r.json()["projection"] == "ok"
        and r.json()["rules"] >= 10, r.text)
r = q({"start_entities": ["Order"], "hops": 3})
H.check("after the rebuild the graph path answers again, same as SQL, with the new rule", r["path"] == "graph"
        and "r5" in ids(r) and ids(r) == ids(q({"start_entities": ["Order"], "hops": 3, "path": "sql"})), ids(r))
rules._graph = broken
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_rule_proj SET state='stale' WHERE ns='acme' AND project='alpha'")
H.check("the cron leaves a still-broken projection stale", "stale" in rules._cron_reproject())
rules._graph = real_graph
H.check("the cron rebuilds a stale projection", "acme/alpha:ok" in rules._cron_reproject())
rules.GRAPH_ENABLED = False
r = q({"start_entities": ["Order"], "hops": 1})
H.check("KH_RULES_GRAPH=false: SQL with graph_disabled", r["path"] == "sql"
        and r["fallback_reason"] == "graph_disabled", r)
rules.GRAPH_ENABLED = True
r = c.post(Q, json={"project": "alpha", "start_entities": []}, headers=AGENT)
H.check("a query without start entities is 422", r.status_code == 422, r.text)
r = c.post(Q, json={"project": "alpha", "start_entities": ["x"], "relations": ["OWNS"]}, headers=AGENT)
H.check("an unknown relation is 422", r.status_code == 422, r.text)

# ── 6. scans ─────────────────────────────────────────────────────────────────
S = "/v1/acme/rules/scans"
r = c.post(S, json={"scan_id": "s1", "project": "alpha", "entities_scanned": ["Order", "Tax", "Ghost", "Cart"]},
           headers=AGENT)
j = r.json()
H.check("scan coverage: any = entities with a live rule / scanned, verified likewise", r.status_code == 201
        and j["n_scanned"] == 4 and j["coverage_any"] == 0.75 and j["coverage_verified"] == 0.25
        and j["uncovered"] == ["Ghost"] and "Tax" in j["unverified_only"], j)
r = c.post(S, json={"scan_id": "s1", "project": "alpha", "entities_scanned": ["order", "TAX", "ghost", "cart"]},
           headers=AGENT)
H.check("the same scan again replays it (normalized names)", r.status_code == 200 and r.json()["replayed"], r.text)
r = c.post(S, json={"scan_id": "s1", "project": "alpha", "entities_scanned": ["Order"]}, headers=AGENT)
H.check("the same scan_id with another set is 409", r.status_code == 409, r.text)
r = c.get(f"{S}/s1", headers=AGENT)
H.check("GET a scan", r.status_code == 200 and r.json()["coverage_any"] == 0.75, r.text)
r = c.get(f"{S}?project=alpha", headers=AGENT)
H.check("list scans", [x["scan_id"] for x in r.json()["scans"]] == ["s1"], r.text)
r = c.post(S, json={"scan_id": "s2", "project": "alpha", "entities_scanned": []}, headers=AGENT)
H.check("an empty scan has coverage 0", r.status_code == 201 and r.json()["coverage_any"] == 0.0, r.text)

# ── 7. gate ──────────────────────────────────────────────────────────────────
G = "/v1/acme/rules:gate"
RUN = {**AGENT, "X-KH-Run": "run-7"}
c.put(f"{R}/g1", json=rule("Payment", "method", "card or transfer"), headers=RUN)
c.put(f"{R}/g2", json=rule("Refund", "window", "30 days", source_text="", quote_id=None), headers=RUN)
r = c.post(G, json={"run_id": "run-7", "project": "alpha", "entities": ["Payment", "Refund", "Order"]},
           headers=AGENT)
j = r.json()
H.check("gate fails: Order has no rule of this run, g2 has no source", r.status_code == 200 and j["pass"] is False
        and j["missing"] == ["Order"] and j["orphans"] == [{"rule_id": "g2", "reason": "no_source"}], j)
c.put(f"{R}/g2", json=rule("Refund", "window", "30 days", quote_id="Q-12",
                           links=[{"relation": "DEPENDS_ON", "to_entity": "Ledger"}]), headers=RUN)
c.post(f"{R}/r2:confirm", json={"validity": "verified", "run_id": "run-7"}, headers={**CONF})
j = c.post(G, json={"run_id": "run-7", "project": "alpha", "entities": ["Payment", "Refund", "Order"]},
           headers=AGENT).json()
H.check("a confirmation in the run covers Order; a DEPENDS_ON to a rule-less entity is an orphan",
        j["missing"] == [] and j["orphan_count"] == 1 and j["orphans"][0]["reason"] == "dangling_dependency"
        and j["orphans"][0]["to_entity"] == "Ledger" and j["pass"] is False, j)
c.put(f"{R}/g3", json=rule("Ledger", "balance", "never negative"), headers=RUN)
j = c.post(G, json={"run_id": "run-7", "project": "alpha", "entities": ["Payment", "Refund", "Order"]},
           headers=AGENT).json()
H.check("gate passes when every entity is covered and no orphan is left", j["pass"] is True and j["orphans"] == [], j)
j = c.post(G, json={"run_id": "run-other", "project": "alpha", "entities": ["Payment"]}, headers=AGENT).json()
H.check("rules of another run do not count", j["pass"] is False and j["missing"] == ["Payment"], j)
c.put(f"{R}/g1", json=rule("Payment", "method", "card or transfer", validity="retired"), headers=RUN)
j = c.post(G, json={"run_id": "run-7", "project": "alpha", "entities": ["Payment"]}, headers=AGENT).json()
H.check("a retired rule does not cover its entity", j["missing"] == ["Payment"], j)
r = c.post(G, json={"project": "alpha", "entities": ["x"]}, headers=AGENT)
H.check("gate without run_id is 422", r.status_code == 422, r.text)

# ── 8. fencing and require_if_match ──────────────────────────────────────────
F = "/v1/fence/rules"
r = c.put(f"{F}/f1", json=rule("A", "b", "c"), headers={**AGENT, "If-None-Match": "*"})
H.check("a fenced namespace refuses a write without lease headers (428)", r.status_code == 428, r.text)
r = c.post("/v1/fence/leases/rules:acquire", json={"ttl_s": 30}, headers=AGENT)
ep = r.json()["epoch"]
LEASE = {**AGENT, "X-KH-Lease": "rules", "X-KH-Epoch": str(ep)}
r = c.put(f"{F}/f1", json=rule("A", "b", "c"), headers=LEASE)
H.check("require_if_match: a PUT with neither If-Match nor If-None-Match is 428", r.status_code == 428, r.text)
r = c.put(f"{F}/f1", json=rule("A", "b", "c"), headers={**LEASE, "If-None-Match": "*"})
H.check("the lease holder creates", r.status_code == 201, r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_lease SET until_ms=0 WHERE ns='fence' AND name='rules'")
c.post("/v1/fence/leases/rules:acquire", json={"ttl_s": 30}, headers=as_("a2"))
r = c.put(f"{F}/f1", json=rule("A", "b", "d"), headers={**LEASE, "If-Match": '"1"'})
H.check("a stale epoch is 409 stale_epoch and nothing changes", r.status_code == 409
        and r.json()["error"] == "stale_epoch" and c.get(f"{F}/f1", headers=AGENT).json()["effect"] == "c", r.text)
H.check("... and writes kh.stale_epoch", len(kh_events("fence", "kh.stale_epoch")) == 1)
r = c.post("/v1/fence/rules:bulk", json={"project": "alpha", "rules": [rule("Z", "z", "z")]}, headers=LEASE)
H.check("bulk is fenced too", r.status_code == 409 and c.get("/v1/fence/rules?entity=z", headers=AGENT
                                                             ).json()["rules"] == [], r.text)

# ── 9. idempotency, roles, grants ────────────────────────────────────────────
IK = {**AGENT, "Idempotency-Key": "k-1"}
r1 = c.put(f"{R}/i1", json=rule("Idem", "a", "b"), headers=IK)
r2 = c.put(f"{R}/i1", json=rule("Idem", "a", "b"), headers=IK)
H.check("Idempotency-Key replays the stored answer", r1.status_code == 201 and r2.status_code == 201
        and r2.headers.get("idempotent-replay") == "true" and r2.json()["rev"] == 1, (r1.text, r2.headers))
r = c.put(f"{R}/i1", json=rule("Idem", "a", "other"), headers=IK)
H.check("a different body under the key is 422 idempotency_mismatch", r.status_code == 422
        and r.json()["error"] == "idempotency_mismatch", r.text)
r = c.put(f"{R}/d1", json=rule("A", "b", "c"), headers=as_("d1", "distiller"))
H.check("a distiller may not write rules (403)", r.status_code == 403, r.text)
r = c.post(Q, json={"project": "alpha", "start_entities": ["order"]}, headers=as_("d1", "distiller"))
H.check("... but may query them", r.status_code == 200, r.text)
r = c.put(f"{R}/b1", json={**rule("A", "b", "c"), "project": "beta"}, headers=as_("a9", "agent", ["alpha"]))
H.check("a principal without a grant on the project gets 403", r.status_code == 403, r.text)
r = c.get(f"{R}/r1", headers=as_("a9", "agent", ["beta"]))
H.check("... and cannot read a rule of it", r.status_code == 403, r.text)
r = c.put(f"{R}/r1", json={**rule("Order", "status", "z"), "project": "beta"}, headers=AGENT)
H.check("a rule cannot move to another project", r.status_code == 422, r.text)

# ── 9b. redaction on the rule write path ─────────────────────────────────────
r = c.put(f"{R}/secret-src", json=rule("Mailer", "contact", "send to ops", source_text="mail ana.b@x.io for access"),
          headers={**AGENT, "If-None-Match": "*"})
H.check("REDACT: a rule's source_text is masked before storage", r.status_code == 201
        and "ana.b@x.io" not in r.text and "[REDACTED:email]" in r.json().get("source_text", ""), r.text)
r = c.post(B, json={"project": "alpha", "rules": [rule("Mailer2", "contact", "x", source_text="ping c@d.io")]},
           headers=AGENT)
with sqldb.connect() as conn:
    leaked = conn.execute("SELECT COUNT(*) FROM kh_rule WHERE ns='acme' AND source_text LIKE '%c@d.io%'").fetchone()[0]
H.check("REDACT: bulk rules are masked too", r.status_code == 200 and leaked == 0, (r.status_code, leaked))

# ── 10. races ────────────────────────────────────────────────────────────────
c.put(f"{R}/race", json=rule("Race", "a", "v0"), headers=AGENT)
res = H.race(6, lambda i: c.put(f"{R}/race", json=rule("Race", "a", f"v{i + 1}"),
                                headers={**AGENT, "If-Match": '"1"'}).status_code)
H.check("RACE: If-Match update gives one winner, the rest 409", sorted(res) == [200] + [409] * 5, res)
res = H.race(6, lambda i: c.put(f"{R}/race-new", json=rule("RaceNew", "a", f"v{i}"),
                                headers={**AGENT, "If-None-Match": "*"}).status_code)
H.check("RACE: create-only gives one 201", sorted(res) == [201] + [409] * 5, res)
batch = [rule("Bulk", f"a{k}", "same") for k in range(40)]
res = H.race(4, lambda i: c.post(B, json={"project": "alpha", "rules": batch}, headers=AGENT).json())
with sqldb.connect() as conn:
    n = conn.execute("SELECT COUNT(*) FROM kh_rule WHERE ns='acme' AND entity_key='bulk'").fetchone()[0]
H.check("RACE: concurrent bulk of the same rules stores each once", n == 40
        and sum(x["created"] for x in res) == 40 and sum(x["duplicates"] for x in res) == 120,
        (n, [(x.get("created"), x.get("duplicates")) for x in res]))
r = q({"start_entities": ["Bulk", "Race"], "hops": 1})
H.check("after the races the graph and SQL agree", r["path"] == "graph" and ids(r) == ids(
    q({"start_entities": ["Bulk", "Race"], "hops": 1, "path": "sql"})) and len(ids(r)) == 41, len(ids(r)))

from app.graph_db.project_graph import close_project_graph  # noqa: E402

for gid in os.listdir(KUZU_TMP):
    close_project_graph(gid)
shutil.rmtree(KUZU_TMP, ignore_errors=True)
H.done()
