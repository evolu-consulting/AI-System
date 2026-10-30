"""S11 load: 30 agents for ~3 minutes mixing events (with idempotent retries), lease cycles with fenced writes,
records with If-Match (including a contended shared board), /context/step and metrics, plus one forced lease steal
per minute. Reports p50/p95 per route, error counts, duplicate webhook deliveries and seq gaps.

    KH_SIM_LOAD_S=180 KH_SIM_LOAD_AGENTS=30
"""
import json
import os
import random
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from simlib import PROJECT, env_headers, ev_body, standalone, uid
import s09_outbox

TITLE = "load: 30 agents x ~3 min, latency per route, errors, deliveries, seq"
DURATION = float(os.getenv("KH_SIM_LOAD_S", "180"))
N = int(os.getenv("KH_SIM_LOAD_AGENTS", "30"))
STACKS = ["java", "go", "py", "ts"]
STEPS = ["plan", "build", "test", "review"]
#: statuses that are the expected outcome of a contended operation, per route label
EXPECTED = {"PUT /records/work-board (contended)": {409}, "POST /leases/{name}:acquire (contended)": {409}}


def run(sim, sc):
    tag = uid("L").split("-")[1][:6]
    run_id = f"load-{tag}"
    t0 = time.monotonic()
    with ThreadPoolExecutor(N) as ex:
        agents = list(ex.map(lambda i: sim.principal(f"load-{tag}-{i:02d}", "agent"), range(N)))
        list(ex.map(lambda a: a.token(), agents))
    orch = sim.principal(f"load-orch-{tag}", "orchestrator")
    sc.numbers["setup_s"] = round(time.monotonic() - t0, 1)
    start_seq = sim.top_seq()
    shared = f"shared-{tag}"
    r = agents[0].put(f"/records/work-board/{shared}", {"unit": shared, "status": "open", "n": 0},
                      headers={"If-None-Match": "*"}, route="PUT /records/work-board")
    sc.check("shared contended board created", r.status == 201, r)
    counts = Counter()
    errors = Counter()
    idem_bad = []
    accepted_ids = []
    lock = threading.Lock()
    deadline = time.monotonic() + DURATION

    def note(label, resp, expected=(200, 201)):
        ok = resp.status in expected or resp.status in EXPECTED.get(label, set())
        with lock:
            counts[label] += 1
            if not ok:
                errors[f"{label} -> {resp.status} {resp.error or ''}".strip()] += 1
        return ok

    def agent_loop(i, a):
        rnd = random.Random(i)
        unit_no = 0
        own = f"own-{tag}-{i:02d}"
        r = a.put(f"/records/work-board/{own}", {"unit": own, "status": "open", "n": 0},
                  headers={"If-None-Match": "*"}, route="PUT /records/work-board")
        note("PUT /records/work-board", r)
        etag = r.headers.get("ETag")
        while time.monotonic() < deadline:
            x = rnd.random()
            unit_no += 1
            unit = f"{run_id}-{i:02d}-{unit_no}"
            H = env_headers(run=run_id, unit=unit, attempt=1)
            if x < 0.45:                                            # events, sometimes a batch, with retries
                key = uid("ik")
                if rnd.random() < 0.2:
                    body = {"events": [{"kind": rnd.choice(["step.started", "step.done", "run.started"]),
                                        "project": PROJECT, "body": ev_body(n=k)} for k in range(5)]}
                    label = "POST /events (batch 5)"
                else:
                    body = {"kind": rnd.choice(["step.started", "step.done", "unit.claimed", "unit.done",
                                                "run.started", "run.finished"]), "project": PROJECT,
                            "body": ev_body(step=rnd.choice(STEPS))}
                    label = "POST /events"
                r = a.post("/events", body, headers={**H, "Idempotency-Key": key}, route=label)
                if note(label, r):
                    with lock:
                        accepted_ids.extend(x["id"] for x in r.j.get("accepted", []))
                if rnd.random() < 0.1:                              # the answer was "lost": retry the same key
                    r2 = a.post("/events", body, headers={**H, "Idempotency-Key": key}, route="POST /events (retry)")
                    note("POST /events (retry)", r2)
                    if r2.status == 200 and (r2.headers.get("Idempotent-Replay") != "true"
                                             or r2.j.get("accepted") != r.j.get("accepted")):
                        with lock:
                            idem_bad.append(key)
            elif x < 0.62:                                          # a lease cycle with fenced writes
                lease = f"unit/{unit}"
                r = a.post(f"/leases/{lease}:acquire", {"ttl_s": 30}, route="POST /leases/{name}:acquire")
                if not note("POST /leases/{name}:acquire", r):
                    continue
                ep = r.j["epoch"]
                FH = env_headers(run=run_id, unit=unit, attempt=1, lease=lease, epoch=ep)
                r = a.put(f"/records/unit-state/{unit}", {"unit": unit, "status": "claimed", "owner": a.name},
                          headers={**FH, "If-None-Match": "*"}, route="PUT /records/unit-state (fenced)")
                note("PUT /records/unit-state (fenced)", r)
                r = a.put(f"/records/unit-state/{unit}", {"unit": unit, "status": "done", "owner": a.name, "n": 1},
                          headers={**FH, "If-Match": r.headers.get("ETag") or '"1"'},
                          route="PUT /records/unit-state (fenced)")
                note("PUT /records/unit-state (fenced)", r)
                r = a.post("/events", {"kind": "unit.write", "project": PROJECT, "body": ev_body(msg="done")},
                           headers=FH, route="POST /events (fenced)")
                if note("POST /events (fenced)", r):
                    with lock:
                        accepted_ids.extend(x["id"] for x in r.j.get("accepted", []))
                r = a.post(f"/leases/{lease}:release", {"epoch": ep}, route="POST /leases/{name}:release")
                note("POST /leases/{name}:release", r)
            elif x < 0.74:                                          # records with If-Match
                if rnd.random() < 0.3:
                    cur = a.get(f"/records/work-board/{shared}", route="GET /records/work-board")
                    note("GET /records/work-board", cur)
                    r = a.put(f"/records/work-board/{shared}", {"unit": shared, "status": "taken", "owner": a.name},
                              headers={"If-Match": cur.headers.get("ETag") or '"1"'},
                              route="PUT /records/work-board (contended)")
                    note("PUT /records/work-board (contended)", r)
                else:
                    r = a.put(f"/records/work-board/{own}", {"unit": own, "status": "working", "n": unit_no},
                              headers={"If-Match": etag or '"1"'}, route="PUT /records/work-board (If-Match)")
                    if note("PUT /records/work-board (If-Match)", r):
                        etag = r.headers.get("ETag")
            elif x < 0.92:                                          # per-step retrieval
                body = {"project": PROJECT, "keyspace": "step",
                        "key": {"role": "dev", "step": rnd.choice(STEPS), "stack": rnd.choice(STACKS)}}
                if rnd.random() < 0.3:
                    body["query"] = "how do we keep the build green"
                r = a.post("/context/step", body, headers=H, route="POST /context/step")
                note("POST /context/step", r)
            else:                                                   # outcome metrics
                r = a.post("/metrics", [{"series": "lead_time", "value": rnd.uniform(5, 90), "unit_id": unit,
                                         "project": PROJECT},
                                        {"series": "first_pass_green", "value": int(rnd.random() < 0.8),
                                         "unit_id": unit, "project": PROJECT}], route="POST /metrics")
                note("POST /metrics", r)
            time.sleep(rnd.uniform(0.05, 0.25))

    steals = []

    def stealer():
        a, b = agents[0], agents[1]
        k = 0
        while time.monotonic() < deadline - 8:
            k += 1
            lease = f"unit/steal-{tag}-{k}"
            r = a.post(f"/leases/{lease}:acquire", {"ttl_s": 5}, route="POST /leases/{name}:acquire (steal)")
            ep = r.j.get("epoch")
            time.sleep(5.5)
            r2 = b.post(f"/leases/{lease}:acquire", {"ttl_s": 30}, route="POST /leases/{name}:acquire (steal)")
            r3 = a.post("/events", {"kind": "unit.write", "project": PROJECT, "body": ev_body(msg="zombie")},
                        headers=env_headers(run=run_id, unit="steal", attempt=1, lease=lease, epoch=ep),
                        route="POST /events (zombie)")
            steals.append((r.status, r2.status, r2.j.get("epoch"), r3.status, r3.error))
            for _ in range(int(min(60, max(0, deadline - time.monotonic() - 8)))):
                if time.monotonic() >= deadline - 8:
                    break
                time.sleep(1)

    t_load = time.monotonic()
    st = threading.Thread(target=stealer, daemon=True)
    st.start()
    with ThreadPoolExecutor(N) as ex:
        list(ex.map(lambda ia: agent_loop(*ia), enumerate(agents)))
    st.join(15)
    elapsed = time.monotonic() - t_load
    total = sum(counts.values())
    sc.numbers.update({"agents": N, "duration_s": round(elapsed, 1), "requests": total,
                       "req_per_s": round(total / elapsed, 1),
                       "events_accepted": len(accepted_ids), "events_per_s": round(len(accepted_ids) / elapsed, 1),
                       "ops": dict(counts), "unexpected_errors": dict(errors), "steals": steals})
    err_total = sum(errors.values())
    sc.check(f"{total} requests in {elapsed:.0f} s from {N} agents: 0 unexpected errors ({err_total})",
             err_total == 0, dict(errors.most_common(8)))
    sc.check("idempotent retries replayed the first answer every time", not idem_bad, idem_bad[:5])
    sc.check("every forced steal: the zombie's fenced event is 409 stale_epoch",
             steals and all(s[0] == 200 and s[1] == 200 and s[3] == 409 and s[4] == "stale_epoch" for s in steals),
             steals)

    # after the load: seq, ids, kh.* evidence, deliveries
    evs = sim.events(after_seq=0)
    seqs = [e["seq"] for e in evs]
    ids = [e["id"] for e in evs]
    gaps = len(seqs) and (seqs[-1] - len(seqs))
    sc.numbers["events_total"] = len(evs)
    sc.numbers["seq_gaps"] = gaps
    sc.check(f"0 seq gaps over {len(seqs)} events (1..{seqs[-1] if seqs else 0}), every id once",
             seqs == list(range(1, len(seqs) + 1)) and len(set(ids)) == len(ids), (len(seqs), seqs[-1:]))
    sc.check("every accepted event id is stored exactly once", set(accepted_ids) <= set(ids)
             and len(accepted_ids) == len(set(accepted_ids)), len(set(accepted_ids) - set(ids)))
    contended = Counter()
    for k, v in errors.items():
        contended[k] += v
    wc = sim.kh_events("kh.write_conflict", start_seq)
    n409 = sim.stats.codes.get("PUT /records/work-board (contended)", {}).get(409, 0)
    sc.numbers["contended_409"] = n409
    sc.numbers["kh.write_conflict"] = len(wc)
    sc.check(f"every contended 409 has its kh.write_conflict ({len(wc)} >= {n409})", len(wc) >= n409, (len(wc), n409))
    s09_outbox.check_deliveries(sim, sc, "load_push", timeout=120)
    lat = sim.stats.summary()
    ev = lat.get("POST /events", {})
    cs = lat.get("POST /context/step", {})
    sc.numbers["p95_events_ms"] = ev.get("p95_ms")
    sc.numbers["p95_context_step_ms"] = cs.get("p95_ms")
    # G2 is defined for a sized 3-instance deployment at 200 events/s; this is one dev instance on the default
    # HANA_POOL_SIZE, so the comparison is reported, not asserted (docs/cloud-deployment.md, pool sizing).
    for name, v, budget in (("POST /events", ev, 150), ("POST /context/step", cs, 2000)):
        p95 = v.get("p95_ms")
        sc.note(f"G2 {name}: p95 {p95} ms vs budget {budget} ms -> {'met' if p95 is not None and p95 < budget else 'MISSED'}"
                f" (one instance, HANA_POOL_SIZE as configured)")


if __name__ == "__main__":
    standalone(run, "S11", TITLE)
