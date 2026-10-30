"""S02 concurrent agents: >= 20 principals in threads. Leases per unit with fencing epochs, fenced writes, a
forced lease steal (the old holder gets stale_epoch), If-Match conflicts (409 + kh.write_conflict), idempotent
retries replay, events with required fields (a missing field is rejected), gapless seq.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from simlib import PROJECT, env_headers, ev_body, standalone, uid

TITLE = "concurrent agents: leases, fencing, If-Match, idempotency, required fields, seq"
N_AGENTS = 24
WRITES_PER_UNIT = 5


def run(sim, sc):
    start_seq = sim.top_seq()
    run_id = uid("run")
    t0 = time.monotonic()
    with ThreadPoolExecutor(N_AGENTS) as ex:
        agents = list(ex.map(lambda i: sim.principal(f"agent-{i:02d}", "agent"), range(1, N_AGENTS + 1)))
        list(ex.map(lambda a: a.token(), agents))
    sc.numbers["agents"] = len(agents)
    sc.numbers["principals_ready_s"] = round(time.monotonic() - t0, 2)
    sc.check(f"{N_AGENTS} agent principals created with tokens", len(agents) == N_AGENTS)

    # ── per-unit work: lease, fenced record writes, fenced events, idempotent events ──────────────────
    results = {}

    def work(i, a):
        unit = f"u-{run_id}-{i:02d}"
        lease = f"unit/{unit}"
        out = {"errors": []}
        r = a.post(f"/leases/{lease}:acquire", {"ttl_s": 30}, route="POST /leases/{name}:acquire")
        if r.status != 200:
            out["errors"].append(("acquire", r.brief()))
            return out
        ep = r.j["epoch"]
        fh = env_headers(run=run_id, unit=unit, attempt=1, lease=lease, epoch=ep)
        r = a.put(f"/records/unit-state/{unit}", {"unit": unit, "status": "claimed", "owner": a.name, "n": 0},
                  headers={**fh, "If-None-Match": "*"}, route="PUT /records/unit-state (fenced)")
        if r.status != 201:
            out["errors"].append(("create", r.brief()))
            return out
        etag = r.headers.get("ETag")
        for n in range(1, WRITES_PER_UNIT + 1):
            r = a.put(f"/records/unit-state/{unit}", {"unit": unit, "status": "working", "owner": a.name, "n": n},
                      headers={**fh, "If-Match": etag}, route="PUT /records/unit-state (fenced)")
            if r.status != 200:
                out["errors"].append(("update", r.brief()))
                break
            etag = r.headers.get("ETag")
        out["final_rev"] = int(etag.strip('"')) if etag else None
        r = a.post("/events", {"kind": "unit.write", "project": PROJECT, "body": ev_body(msg="fenced write", n=i)},
                   headers=fh, route="POST /events (fenced)")
        out["fenced_event"] = r.status
        key = uid("idem")
        evb = {"kind": "step.done", "project": PROJECT, "body": ev_body(step="build", n=i)}
        h = {**env_headers(run=run_id, unit=unit, attempt=1), "Idempotency-Key": key}
        r1 = a.post("/events", evb, headers=h, route="POST /events")
        r2 = a.post("/events", evb, headers=h, route="POST /events")          # a retry after a lost answer
        out["idem"] = (r1.status, r2.status, r2.headers.get("Idempotent-Replay"),
                       r1.j.get("accepted") == r2.j.get("accepted"), (r1.j.get("accepted") or [{}])[0].get("seq"))
        out["seqs"] = [x.get("seq") for x in (r1.j.get("accepted") or [])]
        r = a.post(f"/leases/{lease}:release", {"epoch": ep}, route="POST /leases/{name}:release")
        out["released"] = r.status == 200
        return out

    t0 = time.monotonic()
    with ThreadPoolExecutor(N_AGENTS) as ex:
        res = list(ex.map(lambda ia: work(*ia), enumerate(agents, 1)))
    sc.numbers["unit_work_s"] = round(time.monotonic() - t0, 2)
    errs = [e for r in res for e in r["errors"]]
    sc.check("every agent: lease acquired, fenced create + 5 If-Match updates (rev 6) under its epoch",
             not errs and all(r.get("final_rev") == WRITES_PER_UNIT + 1 for r in res), errs[:3])
    sc.check("every agent: fenced event with lease + epoch accepted", all(r.get("fenced_event") == 200 for r in res),
             [r.get("fenced_event") for r in res])
    sc.check("idempotent retry: same status and body, Idempotent-Replay: true",
             all(r["idem"][0] == 200 and r["idem"][1] == 200 and r["idem"][2] == "true" and r["idem"][3]
                 for r in res if "idem" in r), [r.get("idem") for r in res][:4])
    sc.check("leases released", all(r.get("released") for r in res))

    # ── a lease race: every agent acquires the same lease at once ─────────────────────────────────────
    barrier = threading.Barrier(N_AGENTS)
    race_name = f"race/{run_id}"

    def acq(a):
        barrier.wait()
        return a.post(f"/leases/{race_name}:acquire", {"ttl_s": 10}, route="POST /leases/{name}:acquire").status

    with ThreadPoolExecutor(N_AGENTS) as ex:
        codes = sorted(ex.map(acq, agents))
    sc.check(f"RACE: {N_AGENTS} concurrent acquires of one lease -> one 200, the rest 409",
             codes == [200] + [409] * (N_AGENTS - 1), codes)

    # ── If-Match conflicts on a shared board record ──────────────────────────────────────────────────
    board = f"board-{run_id}"
    r = agents[0].put(f"/records/work-board/{board}", {"unit": board, "status": "open", "n": 0},
                      headers={"If-None-Match": "*"}, route="PUT /records/work-board")
    sc.check("shared board record created", r.status == 201, r)
    barrier2 = threading.Barrier(N_AGENTS)

    def bump(ia):
        i, a = ia
        barrier2.wait()
        return a.put(f"/records/work-board/{board}", {"unit": board, "status": "taken", "owner": a.name, "n": i},
                     headers={"If-Match": '"1"'}, route="PUT /records/work-board (If-Match)")

    with ThreadPoolExecutor(N_AGENTS) as ex:
        rs = list(ex.map(bump, enumerate(agents)))
    codes = sorted(r.status for r in rs)
    losers = [r for r in rs if r.status == 409]
    sc.check(f"RACE: {N_AGENTS} If-Match writes on one rev -> one 200, {N_AGENTS - 1} x 409 write_conflict",
             codes == [200] + [409] * (N_AGENTS - 1) and all(r.error == "write_conflict" for r in losers), codes)
    sc.check("each 409 carries the current record and its ETag", all(
        (r.j.get("current") or {}).get("rev") == 2 and r.headers.get("ETag") == '"2"' for r in losers),
        losers[0].brief() if losers else None)
    r = agents[1].put(f"/records/work-board/{board}", {"unit": board, "status": "x"}, route="PUT /records/work-board")
    sc.check("a write without If-Match on a require_if_match type is 428", r.status == 428, r)

    # ── required fields ───────────────────────────────────────────────────────────────────────────────
    a = agents[2]
    unit = f"u-{run_id}-req"
    body = ev_body()
    body.pop("spec_hash")
    r = a.post("/events", {"kind": "step.done", "project": PROJECT, "body": body},
               headers=env_headers(run=run_id, unit=unit, attempt=1), route="POST /events")
    sc.check("an event without spec_hash is 422 with the pointer /body",
             r.status == 422 and any(e.get("pointer") == "/body" and "spec_hash" in str(e)
                                     for x in r.j.get("rejected", []) for e in x.get("errors", [])), r)
    r = a.post("/events", {"kind": "step.done", "project": PROJECT, "body": ev_body()},
               headers=env_headers(run=run_id, unit=unit), route="POST /events")
    sc.check("an event without the attempt envelope is 422 (/attempt)", r.status == 422 and any(
        e.get("pointer") == "/attempt" for x in r.j.get("rejected", []) for e in x.get("errors", [])), r)
    r = a.post("/events", {"kind": "step.done", "project": PROJECT, "body": ev_body(), "run_id": run_id,
                           "unit_id": unit, "attempt": 2}, route="POST /events")
    sc.check("... and accepted when the envelope comes in the event itself", r.status == 200, r)
    r = a.post("/events", {"kind": "unit.write", "project": PROJECT, "body": ev_body()},
               headers=env_headers(run=run_id, unit=unit, attempt=1), route="POST /events")
    sc.check("a fenced kind without lease headers is 428", r.status == 428, r)

    # ── a forced lease steal ──────────────────────────────────────────────────────────────────────────
    old, new = agents[3], agents[4]
    lease = f"unit/steal-{run_id}"
    r = old.post(f"/leases/{lease}:acquire", {"ttl_s": 5}, route="POST /leases/{name}:acquire")
    ep1 = r.j.get("epoch")
    fh_old = env_headers(run=run_id, unit="steal", attempt=1, lease=lease, epoch=ep1)
    r = old.put(f"/records/unit-state/steal-{run_id}", {"unit": "steal", "status": "claimed", "owner": old.name},
                headers={**fh_old, "If-None-Match": "*"}, route="PUT /records/unit-state (fenced)")
    sc.check("the first holder writes under epoch 1", r.status == 201 and ep1 == 1, r)
    r = new.post(f"/leases/{lease}:acquire", {"ttl_s": 30}, route="POST /leases/{name}:acquire")
    sc.check("while the lease is live the second agent gets 409 lease_held", r.status == 409
             and r.error == "lease_held" and r.j.get("holder") == old.name, r)
    time.sleep(5.6)                                                        # the old holder stalls: no renew
    r = new.post(f"/leases/{lease}:acquire", {"ttl_s": 30}, route="POST /leases/{name}:acquire")
    ep2 = r.j.get("epoch")
    sc.check("after the TTL the second agent steals the lease at epoch 2", r.status == 200 and ep2 == ep1 + 1, r)
    r = old.put(f"/records/unit-state/steal-{run_id}", {"unit": "steal", "status": "zombie", "owner": old.name},
                headers={**fh_old, "If-Match": '"1"'}, route="PUT /records/unit-state (fenced)")
    sc.check("the zombie's fenced record write is 409 stale_epoch", r.status == 409 and r.error == "stale_epoch", r)
    r = old.post("/events", {"kind": "unit.write", "project": PROJECT, "body": ev_body(msg="zombie")},
                 headers=fh_old, route="POST /events (fenced)")
    sc.check("the zombie's fenced event is 409 stale_epoch", r.status == 409 and r.error == "stale_epoch", r)
    r = old.post(f"/leases/{lease}:renew", {"epoch": ep1, "ttl_s": 30}, route="POST /leases/{name}:renew")
    sc.check("the zombie's renew is 409 lease_lost", r.status == 409 and r.error == "lease_lost", r)
    fh_new = env_headers(run=run_id, unit="steal", attempt=2, lease=lease, epoch=ep2)
    r = new.put(f"/records/unit-state/steal-{run_id}", {"unit": "steal", "status": "working", "owner": new.name},
                headers={**fh_new, "If-Match": '"1"'}, route="PUT /records/unit-state (fenced)")
    sc.check("the new holder's write under epoch 2 succeeds (rev 2, nothing of the zombie stored)",
             r.status == 200 and r.j.get("rev") == 2 and r.j.get("body", {}).get("owner") == new.name, r)

    # ── kh.* evidence and the seq check ────────────────────────────────────────────────────────────────
    time.sleep(0.5)
    wc = sim.kh_events("kh.write_conflict", start_seq)
    se = sim.kh_events("kh.stale_epoch", start_seq)
    ll = sim.kh_events("kh.lease_lost", start_seq)
    dup = sim.kh_events("kh.duplicate", start_seq)
    sc.numbers.update({"kh.write_conflict": len(wc), "kh.stale_epoch": len(se), "kh.lease_lost": len(ll),
                       "kh.duplicate": len(dup)})
    sc.check(f"every 409 write_conflict has its kh.write_conflict ({len(wc)} >= {len(losers)})", len(wc) >= len(losers),
             len(wc))
    sc.check("both zombie writes wrote kh.stale_epoch", len(se) >= 2, len(se))
    sc.check("the steal wrote kh.lease_lost", len(ll) >= 1, len(ll))
    sc.check(f"every idempotent replay wrote kh.duplicate ({len(dup)} >= {N_AGENTS})", len(dup) >= N_AGENTS, len(dup))
    evs = sim.events(after_seq=0)
    seqs = [e["seq"] for e in evs]
    ids = [e["id"] for e in evs]
    sc.numbers["events_total"] = len(evs)
    sc.check(f"seq is gapless and unique over the whole namespace (1..{seqs[-1] if seqs else 0})",
             seqs == list(range(1, len(seqs) + 1)) and len(set(ids)) == len(ids), (len(seqs), seqs[-3:]))
    ok_seqs = [s for r in res for s in r.get("seqs", [])]
    sc.check("every accepted seq is readable back", set(ok_seqs) <= set(seqs))


if __name__ == "__main__":
    standalone(run, "S02", TITLE)
