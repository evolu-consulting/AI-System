"""S06 lessons: a lesson keyed (role, step, stack) is proposed; an agent cannot confirm; a judge (the manifest's
confirm_policy) confirms; /context/step with that key serves it and writes kh.served; metric observations where
served units are >= 10 % worse with n >= 30 make :rollback withdraw it (reason auto_rollback); a lesson whose
served units are not worse stays active.

Role matrix note (design 3.4): agents hold items:read only; proposing is the distiller role. The line's agents
hand lesson candidates to its distiller principal, which proposes them. An agent's own POST /items is 403.
"""
import time

from simlib import PROJECT, env_headers, standalone, uid

TITLE = "lessons: propose, confirm policy, keyed retrieval + kh.served, metric rollback"
N = 40


def run(sim, sc):
    dist = sim.principal("distiller-1", "distiller")
    judge = sim.principal("judge-lessons", "judge")
    agent = sim.principal("agent-lessons", "agent")
    orch = sim.principal("orch-lessons", "orchestrator")
    tag = uid("k").split("-")[1][:6]
    run_id = uid("run")
    start = sim.top_seq()
    key_bad = {"role": "dev", "step": "build", "stack": f"java{tag}"}
    key_good = {"role": "dev", "step": "build", "stack": f"go{tag}"}

    def propose(text, key, headers=None, who=None):
        body = {"kind": "lesson", "keyspace": "step", "key": key, "project": PROJECT, "text": text,
                "guard_metric": "first_pass_green", "attrs": {"severity": "high"},
                "provenance": {"event_ids": [f"ev-{tag}"]}}
        if sim.state.get("guard"):
            body["guard_names"] = [sim.state["guard"]]
        return (who or dist).post("/items", body, headers=headers or env_headers(run=run_id), route="POST /items")

    r = propose("Run the dependency audit before every build.", key_bad, who=agent)
    sc.check("an agent's own proposal is refused by the role matrix (403: items read only)", r.status == 403, r)
    r = propose("Run the dependency audit before every build.", key_bad)
    bad = (r.j.get("item") or {})
    sc.check("the distiller proposes the lesson keyed (role, step, stack): 201 proposed, lint clean",
             r.status == 201 and bad.get("status") == "proposed" and bad.get("key") == key_bad
             and r.j.get("lint") == [], r)
    r = propose("Cache the module downloads between builds.", key_good)
    good = (r.j.get("item") or {})
    sc.check("a second lesson for another stack", r.status == 201, r)
    r = propose("  run the DEPENDENCY audit before every build. ", key_bad)
    sc.check("the same lesson again merges into one item (support 2)", r.status == 200
             and r.j.get("result") == "merged" and (r.j.get("item") or {}).get("id") == bad.get("id"), r)

    r = agent.patch(f"/items/{bad['id']}", {"status": "active"}, route="PATCH /items/{id}")
    sc.check("an agent cannot confirm (403)", r.status == 403, r)
    r = dist.patch(f"/items/{bad['id']}", {"status": "active"}, route="PATCH /items/{id}")
    sc.check("the distiller cannot confirm either (not in confirm_policy)", r.status == 403, r)
    etag = judge.get(f"/items/{bad['id']}", route="GET /items/{id}").headers.get("ETag")
    r = judge.patch(f"/items/{bad['id']}", {"status": "active"}, headers={"If-Match": etag}, route="PATCH /items/{id}")
    sc.check("the judge (confirm_policy roles [judge]) activates it with If-Match", r.status == 200
             and (r.j.get("item") or {}).get("status") == "active", r)
    r = judge.patch(f"/items/{good['id']}", {"status": "active"}, route="PATCH /items/{id}")
    sc.check("... and the second lesson", r.status == 200, r)

    # keyed retrieval + kh.served
    r = agent.post("/context/step", {"project": PROJECT, "keyspace": "step", "key": key_bad},
                   headers=env_headers(run=run_id, unit=f"probe-{tag}", attempt=1), route="POST /context/step")
    served = [s for s in r.j.get("served", []) if s.get("tier") == "key"]
    sc.check("/context/step with the key serves the lesson in the key tier", r.status == 200
             and [s["id"] for s in served] == [bad["id"]] and bad["id"] in r.j.get("item_ids", []), r)
    sc.check("the pack text carries the lesson", "dependency audit" in r.j.get("pack_text", ""), r.j.get("pack_text"))
    time.sleep(0.3)
    ks = [e for e in sim.kh_events("kh.served", start) if e.get("unit_id") == f"probe-{tag}"]
    sc.check("kh.served written once with serve id, item ids, run and unit", len(ks) == 1
             and ks[0]["body"].get("serve_id") == r.j.get("serve_id") and bad["id"] in ks[0]["body"].get("item_ids", [])
             and ks[0].get("run_id") == run_id, ks)

    # serve both lessons to N units each, plus N control units with no lesson
    t0 = time.monotonic()
    for i in range(N):
        for key, name in ((key_bad, "bad"), (key_good, "good")):
            r = agent.post("/context/step", {"project": PROJECT, "keyspace": "step", "key": key},
                           headers=env_headers(run=run_id, unit=f"{name}-{tag}-{i}", attempt=1),
                           route="POST /context/step")
            if r.status != 200:
                sc.check("context/step for the served units", False, r)
                return
    sc.numbers["context_step_calls"] = 2 * N
    sc.numbers["context_step_loop_s"] = round(time.monotonic() - t0, 1)
    obs = ([{"series": "first_pass_green", "value": 1 if i % 2 else 0, "unit_id": f"bad-{tag}-{i}", "project": PROJECT,
             "dims": {"role": "dev", "stack": key_bad["stack"]}} for i in range(N)]                         # 50 %
           + [{"series": "first_pass_green", "value": 0 if i % 10 == 0 else 1, "unit_id": f"good-{tag}-{i}",
               "project": PROJECT} for i in range(N)]                                                         # 90 %
           + [{"series": "first_pass_green", "value": 0 if i % 10 == 0 else 1, "unit_id": f"ctrl-{tag}-{i}",
               "project": PROJECT} for i in range(N)]                                                         # 90 %
           + [{"series": "lead_time", "value": 30.0 + i, "unit_id": f"ctrl-{tag}-{i}", "project": PROJECT}
              for i in range(N)])
    r = agent.post("/metrics", {"observations": obs}, route="POST /metrics")
    sc.check(f"{len(obs)} metric observations recorded", r.status == 200 and r.j.get("created") == len(obs), r)
    r = orch.post("/metrics:compare", {"series": "first_pass_green", "a": {"not_served_item": bad["id"]},
                                       "b": {"served_item": bad["id"]}, "per_unit": True}, route="POST /metrics:compare")
    sc.check(":compare served vs not served for the bad lesson: 0.5 vs 0.9 (n 40 vs 80)", r.status == 200
             and r.j.get("n_b") == N and r.j.get("mean_b") == 0.5 and r.j.get("n_a") >= 2 * N, r)

    r = agent.post("/metrics:rollback", {"item_ids": [bad["id"], good["id"]]}, route="POST /metrics:rollback")
    sc.check("an agent may not run the rollback (403)", r.status == 403, r)
    r = orch.post("/metrics:rollback", {"item_ids": [bad["id"], good["id"]], "dry_run": True},
                  route="POST /metrics:rollback")
    dec = {x["item_id"]: x.get("decision") for x in r.j.get("items", [])}
    sc.check("dry run: fire for the worse lesson, not_worse for the other", dec.get(bad["id"]) == "fire"
             and dec.get(good["id"]) == "not_worse", r)
    r = orch.post("/metrics:rollback", {"item_ids": [bad["id"], good["id"]]}, route="POST /metrics:rollback")
    sc.check(":rollback fires once", r.status == 200 and r.j.get("fired") == 1, r)
    ev = next((x for x in r.j.get("items", []) if x["item_id"] == bad["id"]), {})
    sc.numbers["rollback"] = {k: ev.get(k) for k in ("n_served", "n_control", "mean_served", "mean_control",
                                                     "rel_delta", "p", "test")}
    b = judge.get(f"/items/{bad['id']}", route="GET /items/{id}").j
    g = judge.get(f"/items/{good['id']}", route="GET /items/{id}").j
    sc.check("the worse lesson is withdrawn with reason auto_rollback", b.get("status") == "withdrawn"
             and b.get("status_reason") == "auto_rollback", b)
    sc.check("the lesson whose served units are not worse stays active", g.get("status") == "active", g)
    rb = [e for e in sim.kh_events("kh.item_rollback", start) if e["body"].get("item_id") == bad["id"]]
    sc.check("kh.item_rollback written with the evidence", len(rb) == 1 and rb[0]["body"].get("n_served") == N, rb)
    r = agent.post("/context/step", {"project": PROJECT, "keyspace": "step", "key": key_bad},
                   headers=env_headers(run=run_id, unit=f"after-{tag}", attempt=1), route="POST /context/step")
    sc.check("a withdrawn lesson is no longer served", bad["id"] not in r.j.get("item_ids", []), r)
    sim.state["rolled_back_item"] = bad["id"]


if __name__ == "__main__":
    standalone(run, "S06", TITLE)
