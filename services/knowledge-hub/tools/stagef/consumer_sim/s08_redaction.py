"""S08 redaction: secrets and e-mails in events, records, rules and items are masked before storage (kh-default),
kh.redacted names where (never the value), the scan route and the conformance vectors agree.
"""
import time

from simlib import PROJECT, env_headers, ev_body, standalone, uid

TITLE = "redaction: events, records, rules, items masked before storage"

SECRET = "AKIA" + "QWERTYUIOPASDFGH"            # an access-key shaped value (split so no scanner flags this file)
MAIL = "ops.lead@example.com"
PW = "password=" + "Hunter2-very-secret"


def run(sim, sc):
    agent = sim.principal("agent-redact", "agent")
    dist = sim.principal("distiller-redact", "distiller")
    tag = uid("r").split("-")[1][:6]
    start = sim.top_seq()
    leak = f"deploy with {SECRET} and mail {MAIL}; {PW}"

    r = sim.admin.post("/redaction:verify", route="POST /redaction:verify")
    sc.check("the selected packs pass their conformance vectors", r.status == 200 and r.j.get("all_passed") is True, r)
    r = agent.post("/redaction:scan", {"text": leak}, route="POST /redaction:scan")
    sc.check("redaction:scan masks the access key and the e-mail", r.status == 200 and SECRET not in r.text
             and MAIL not in r.text and len(r.j.get("findings", [])) >= 2, r)
    sc.numbers["scan_findings"] = sorted({f.get("name") for f in r.j.get("findings", [])})

    r = agent.post("/events", {"kind": "step.done", "project": PROJECT, "body": ev_body(msg=leak)},
                   headers=env_headers(run="run-red", unit=f"red-{tag}", attempt=1), route="POST /events")
    eid = (r.j.get("accepted") or [{}])[0].get("id")
    ev = sim.admin.get(f"/events/{eid}", route="GET /events/{id}")
    sc.check("event body: secret and e-mail masked before storage", ev.status == 200 and SECRET not in ev.text
             and MAIL not in ev.text and "Hunter2" not in ev.text and "[REDACTED:" in ev.text, ev)
    r = agent.put(f"/records/work-board/red-{tag}", {"unit": f"red-{tag}", "status": "open", "note": leak},
                  headers={"If-None-Match": "*"}, route="PUT /records/work-board")
    rec = agent.get(f"/records/work-board/red-{tag}", route="GET /records/work-board")
    sc.check("record body masked (create)", r.status == 201 and SECRET not in rec.text and MAIL not in rec.text, rec)
    r = agent.patch(f"/records/work-board/red-{tag}", {"note": f"again {MAIL}"}, headers={"If-Match": '"1"'},
                    route="PATCH /records/work-board")
    revs = agent.get(f"/records/work-board/red-{tag}:revisions", route="GET /records/{t}/{id}:revisions")
    sc.check("record merge patch masked; no revision holds a value", r.status == 200 and MAIL not in revs.text
             and SECRET not in revs.text, revs)
    r = agent.put(f"/rules/red-{tag}", {"project": PROJECT, "entity": f"Mailer{tag}", "attribute": "contact",
                                        "condition": "", "effect": "send to the ops lead", "source_text": leak},
                  headers={"If-None-Match": "*"}, route="PUT /rules/{id}")
    rule = agent.get(f"/rules/red-{tag}", route="GET /rules/{id}")
    sc.check("rule source_text masked", r.status == 201 and SECRET not in rule.text and MAIL not in rule.text, rule)
    r = dist.post("/items", {"kind": "lesson", "keyspace": "step", "key": {"role": "ops", "step": "deploy",
                                                                           "stack": f"k8s{tag}"},
                             "project": PROJECT, "text": f"Notify {MAIL} when the deploy key {SECRET} rotates."},
                  route="POST /items")
    sc.check("item text masked", r.status == 201 and SECRET not in r.text and MAIL not in r.text
             and "[REDACTED:" in (r.j.get("item") or {}).get("text", ""), r)
    r = agent.post("/metrics", {"series": "lead_time", "value": 12, "unit_id": f"red-{tag}", "project": PROJECT,
                                "dims": {"role": f"ping {MAIL}"}}, route="POST /metrics")
    m = sim.admin.get("/metrics", params={"series": "lead_time", "unit_ids": f"red-{tag}"}, route="GET /metrics")
    sc.check("metric dims masked", r.status == 200 and MAIL not in m.text, m)
    time.sleep(0.3)
    red = sim.kh_events("kh.redacted", start)
    where = sorted({e["body"].get("where", "").split("/")[0] for e in red})
    sc.numbers["kh.redacted"] = len(red)
    sc.numbers["kh.redacted_where"] = where
    sc.check("kh.redacted written per write path (events, records, rules, items, metrics)",
             {"events", "records", "rules", "items", "metrics"} <= set(where), where)
    sc.check("kh.redacted never carries the value", not any(SECRET in str(e) or MAIL in str(e) for e in red))


if __name__ == "__main__":
    standalone(run, "S08", TITLE)
