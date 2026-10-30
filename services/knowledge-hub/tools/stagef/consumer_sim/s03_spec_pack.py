"""S03 spec pack: v1.0 created and frozen, quotes with stable ids, assumptions ASSUMED-n, duplicate-question
lookup (a true paraphrase is found; 'above the limit' vs 'below the limit' is NOT a duplicate), a human answer
becomes addendum v1.1, and quotes re-anchor when an amendment v1.2 shifts or removes text.
"""
from urllib.parse import quote as urlq

from simlib import PROJECT, standalone, uid

TITLE = "spec pack: versions, freeze, quotes, assumptions, duplicate questions, addendum, re-anchoring"

INTRO = ("Orders are accepted from registered customers only. Every order must be paid before it ships. "
         "An order whose total exceeds the customer's credit limit is blocked until a manager approves it.")
VIP = ("Orders placed by VIP customers are approved automatically. A refund above the limit needs a second "
       "approval.")
PAID = "Every order must be paid before it ships."
REFUND = "A refund above the limit needs a second approval."
BLOCKED = "An order whose total exceeds the customer's credit limit is blocked until a manager approves it."


def run(sim, sc):
    orch = sim.principal("orch-spec", "orchestrator")
    agent = sim.principal("agent-spec", "agent")
    pack = uid("spec").replace("-", "_")
    P = f"/packs/{pack}"
    sim.state["pack"] = pack

    r = orch.post(f"{P}/versions", {"project": PROJECT, "title": "Order handling spec",
                                    "parts": [{"path": "spec/orders.md", "page": 1, "text": INTRO},
                                              {"path": "spec/vip.md", "page": 1, "text": VIP}]},
                  route="POST /packs/{id}/versions")
    sc.check("v1.0 uploaded as a draft with a sha256", r.status == 201 and r.j.get("version") == "v1.0"
             and r.j.get("state") == "draft" and len(r.j.get("sha256", "")) == 64, r)
    sha_draft = r.j.get("sha256")
    r = agent.post(f"{P}/versions", {"project": PROJECT, "parts": [{"path": "x", "text": "y"}]},
                   route="POST /packs/{id}/versions")
    sc.check("an agent cannot upload a pack version (403)", r.status == 403, r)
    r = orch.post(f"{P}/versions/v1.0:freeze", route="POST /packs/{id}/versions/{v}:freeze")
    sc.check("freeze v1.0: frozen, chunk quotes, vectors indexed", r.status == 200 and r.j.get("state") == "frozen"
             and r.j.get("quotes", 0) >= 1, r)
    sc.numbers["freeze_ms"] = round(r.ms)
    r = orch.patch(f"{P}/versions/v1.0", {"parts": [{"path": "spec/x.md", "text": "y"}]},
                   route="PATCH /packs/{id}/versions/{v}")
    sc.check("a frozen version is immutable (409 pack_immutable)", r.status == 409 and r.error == "pack_immutable", r)
    g = agent.get(P, params={"version": "v1.0"}, route="GET /packs/{id}")
    sc.check("an agent reads the frozen pack, same sha256", g.status == 200 and g.j.get("sha256") == sha_draft, g)

    # quotes with stable ids
    r = orch.post(f"{P}/quotes", {"path": "spec/orders.md", "text": PAID}, route="POST /packs/{id}/quotes")
    q_paid = r.j.get("quote_id")
    sc.check("cite by text: quote id path#page#offset", r.status == 201
             and q_paid == f"spec/orders.md#1#{INTRO.find(PAID)}", r)
    r2 = orch.post(f"{P}/quotes", {"path": "spec/orders.md", "text": PAID}, route="POST /packs/{id}/quotes")
    sc.check("citing the same span again gives the same id (stable)", r2.status == 200
             and r2.j.get("quote_id") == q_paid, r2)
    q_ref = orch.post(f"{P}/quotes", {"path": "spec/vip.md", "text": REFUND}, route="POST /packs/{id}/quotes"
                      ).j.get("quote_id")
    q_blk = orch.post(f"{P}/quotes", {"path": "spec/orders.md", "text": BLOCKED}, route="POST /packs/{id}/quotes"
                      ).j.get("quote_id")
    sim.state["quote_blocked"] = q_blk
    r = agent.get(f"/quotes/{urlq(q_paid, safe='/')}", params={"pack": pack}, route="GET /quotes/{id}")
    sc.check("GET /quotes/{id}: current, exact text", r.status == 200 and r.j.get("status") == "current"
             and (r.j.get("latest") or {}).get("text") == PAID, r)

    # assumptions
    codes = []
    for text in ("Managers approve blocked orders within one business day.",
                 "The credit limit is stored per customer, not per account."):
        r = orch.post(f"{P}/assumptions", {"text": text, **({"quote_id": q_blk, "version": "v1.0"}
                                                            if "Managers" in text else {})},
                      route="POST /packs/{id}/assumptions")
        codes.append(r.j.get("code"))
    sc.check("assumptions get ASSUMED-1, ASSUMED-2 (open, the first cites a quote)",
             codes == ["ASSUMED-1", "ASSUMED-2"], codes)
    r = agent.post(f"{P}/assumptions", {"text": "Agents may not add assumptions."},
                   route="POST /packs/{id}/assumptions")
    sc.check("an agent cannot register an assumption (403)", r.status == 403, r)

    # duplicate questions
    QL = f"{P}/questions:lookup"
    r = agent.post(QL, {"text": "Who approves a refund above the limit?"}, route="POST /questions:lookup")
    q1 = r.j.get("question_id")
    sc.check("a new question is stored (201, open)", r.status == 201 and q1 and r.j.get("status") == "open", r)
    r = agent.post(QL, {"text": "Who must approve refunds that exceed the limit?"}, route="POST /questions:lookup")
    sc.check("a true paraphrase is found as a duplicate (score >= 0.92)", r.status == 200
             and r.j.get("duplicate_of") == q1 and (r.j.get("score") or 0) >= 0.92, r)
    sc.numbers["duplicate_score"] = r.j.get("score")
    r = agent.post(QL, {"text": "Who approves a refund below the limit?"}, route="POST /questions:lookup")
    sc.check("'below the limit' is NOT a duplicate of 'above the limit' (stored as new)", r.status == 201
             and r.j.get("duplicate_of") is None and r.j.get("question_id") not in (None, q1), r)
    near = (r.j.get("candidates") or [{}])[0]
    sc.numbers["contrast_near_miss"] = {"score": near.get("score"), "contrast": near.get("contrast")}
    r = agent.post(QL, {"text": "  WHO approves a refund above the limit?  "}, route="POST /questions:lookup")
    sc.check("an exact repeat is a duplicate (match exact)", r.status == 200 and r.j.get("duplicate_of") == q1
             and r.j.get("match") == "exact", r)

    # a human answer becomes addendum v1.1
    answer = "Refunds above the limit are approved by the finance lead and then by the account owner."
    r = sim.person.patch(f"{P}/questions/{q1}", {"answer": answer}, route="PATCH /questions/{id}")
    sc.check("a human (person token) answers the question", r.status == 200 and r.j.get("status") == "answered", r)
    q_etag = r.headers.get("ETag")
    r = orch.post(f"{P}/versions/v1.0/addenda", {"parts": [{"path": f"answers/{q1}.md", "page": 1,
                                                           "text": f"Answer to {q1}: {answer}"}], "freeze": True},
                  route="POST /packs/{id}/versions/{v}/addenda")
    sc.check("the answer becomes addendum v1.1 (frozen, v1.0 superseded)", r.status == 201
             and r.j.get("version") == "v1.1" and r.j.get("state") == "frozen", r)
    r = orch.post(f"{P}/quotes", {"version": "v1.1", "path": f"answers/{q1}.md", "text": answer},
                  route="POST /packs/{id}/quotes")
    q_ans = r.j.get("quote_id")
    sc.check("the answer is citable in v1.1", r.status == 201 and r.j.get("version") == "v1.1", r)
    r = sim.person.patch(f"{P}/questions/{q1}", {"quote_id": q_ans, "version": "v1.1"},
                         headers={"If-Match": q_etag}, route="PATCH /questions/{id}")
    sc.check("the question links its answer quote in v1.1", r.status == 200 and r.j.get("quote_version") == "v1.1", r)
    r = agent.post(QL, {"text": "Who must approve refunds that exceed the limit?"}, route="POST /questions:lookup")
    sc.check("the paraphrase now returns the answer", r.status == 200 and r.j.get("answer") == answer, r)
    vers = agent.get(f"{P}/versions", route="GET /packs/{id}/versions").j.get("versions", [])
    sc.check("versions: v1.0 superseded, v1.1 frozen", [(v["version"], v["state"]) for v in vers]
             == [("v1.0", "superseded"), ("v1.1", "frozen")], vers)

    # re-anchoring: amendment v1.2 shifts orders.md and drops the refund sentence from vip.md
    new_orders = "Scope: this section was amended in v1.2. " + INTRO
    new_vip = VIP.replace(REFUND, "Refunds need one approval.")
    r = orch.post(f"{P}/versions/v1.1/addenda", {"parts": [{"path": "spec/orders.md", "page": 1, "text": new_orders},
                                                          {"path": "spec/vip.md", "page": 1, "text": new_vip}],
                                                "freeze": True}, route="POST /packs/{id}/versions/{v}/addenda")
    sc.check("amendment v1.2 frozen", r.status == 201 and r.j.get("version") == "v1.2"
             and r.j.get("state") == "frozen", r)
    r = agent.get(f"/quotes/{urlq(q_paid, safe='/')}", params={"pack": pack, "version": "v1.0"},
                  route="GET /quotes/{id}")
    lat = r.j.get("latest") or {}
    sc.check("a v1.0 quote re-anchors to its shifted offset in v1.2 (same text)", r.status == 200
             and r.j.get("status") == "reanchored" and lat.get("version") == "v1.2" and lat.get("text") == PAID
             and lat.get("offset") == new_orders.find(PAID), r)
    r = agent.get(f"/quotes/{urlq(q_ref, safe='/')}", params={"pack": pack, "version": "v1.0"},
                  route="GET /quotes/{id}")
    sc.check("a quote whose sentence was removed is orphaned at v1.2", r.j.get("status") == "orphaned"
             and r.j.get("orphaned_at") == "v1.2", r)
    r = agent.get(f"/quotes/{urlq(q_ans, safe='/')}", params={"pack": pack, "version": "v1.1"},
                  route="GET /quotes/{id}")
    sc.check("the answer quote of v1.1 is still valid in v1.2 (unchanged part)",
             (r.j.get("latest") or {}).get("version") == "v1.2" and (r.j.get("latest") or {}).get("text") == answer, r)


if __name__ == "__main__":
    standalone(run, "S03", TITLE)
