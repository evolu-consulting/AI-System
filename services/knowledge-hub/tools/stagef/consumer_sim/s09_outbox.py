"""S09 outbox: the receiver gets HMAC-signed webhooks for the subscribed kinds, each event exactly once, nothing of
other kinds; the pull endpoint returns the same stream and acks move its cursor.
"""
import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor

from simlib import PROJECT, env_headers, ev_body, standalone, uid
import manifest as M
import s01_attach

TITLE = "outbox: signed webhooks exactly once for subscribed kinds, pull fallback"


def matches(kind):
    return any(kind.startswith(k[:-1]) if k.endswith("*") else kind == k for k in M.SUB_KINDS)


def verify(secret, ts, body: bytes, sig) -> bool:
    mac = hmac.new(secret.encode(), f"{int(ts)}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest("sha256=" + mac, sig or "")


def check_deliveries(sim, sc, label, timeout=60):
    """Wait until every subscribed event is delivered, then verify signature, uniqueness and kinds."""
    want = {e["seq"]: e for e in sim.events() if matches(e["kind"])}
    t0 = time.monotonic()
    while True:
        allrecv = s01_attach.received()          # one receiver may serve several namespaces
        got = [g for g in allrecv if g["headers"].get("x-kh-namespace") == sim.ns]
        seqs = [json.loads(g["body"])["event"]["seq"] for g in got]
        if set(want) <= set(seqs) or time.monotonic() - t0 > timeout:
            break
        time.sleep(1)
    lag = time.monotonic() - t0
    secret = sim.admin.get(f"/subscriptions/{M.SUB_ID}/secret", route="GET /subscriptions/{id}/secret").j.get("secret")
    bad_sig, ids = [], []
    for g in got:
        h = g["headers"]
        ids.append(h.get("x-kh-delivery"))
        if not (secret and verify(secret, h.get("x-kh-timestamp"), g["body"], h.get("x-kh-signature"))):
            bad_sig.append(h.get("x-kh-delivery"))
    dup_ids = sorted(i for i in set(ids) if ids.count(i) > 1)
    dup_seqs = sorted(s for s in set(seqs) if seqs.count(s) > 1)
    kinds = {json.loads(g["body"])["event"]["kind"] for g in got}
    sc.numbers[f"{label}_deliveries"] = len(got)
    sc.numbers[f"{label}_expected"] = len(want)
    sc.numbers[f"{label}_duplicate_deliveries"] = len(dup_ids)
    sc.numbers[f"{label}_wait_s"] = round(lag, 1)
    sc.check(f"{label}: every subscribed event delivered ({len(set(seqs) & set(want))}/{len(want)})",
             set(want) <= set(seqs), sorted(set(want) - set(seqs))[:10])
    sc.check(f"{label}: exactly once (0 duplicate X-KH-Delivery, 0 duplicate seq)", not dup_ids and not dup_seqs,
             (dup_ids[:5], dup_seqs[:5]))
    sc.check(f"{label}: every signature verifies (HMAC-SHA256 over ts.body)", got and not bad_sig, bad_sig[:5])
    sc.check(f"{label}: only subscribed kinds were pushed", all(matches(k) for k in kinds), sorted(kinds))
    sc.check(f"{label}: X-KH-Namespace equals the signed body's ns (dedupe key = namespace + delivery id)",
             got and all(json.loads(g["body"]).get("ns") == sim.ns for g in got)
             and not [g for g in allrecv if json.loads(g["body"]).get("ns") == sim.ns
                      and g["headers"].get("x-kh-namespace") != sim.ns])
    sc.check(f"{label}: X-KH-Delivery = <sub>:<seq>", all(
        g["headers"].get("x-kh-delivery") == f"{M.SUB_ID}:{json.loads(g['body'])['event']['seq']}" for g in got))
    return want, got


def run(sim, sc):
    agents = [sim.principal(f"agent-hook-{i}", "agent") for i in range(8)]
    judge = sim.principal("judge-hook", "judge")
    run_id = uid("run")

    def emit(ia):
        i, a = ia
        out = []
        for k, kind in enumerate(("run.started", "step.started", "step.done", "run.finished")):
            r = a.post("/events", {"kind": kind, "project": PROJECT, "body": ev_body(n=k)},
                       headers=env_headers(run=f"{run_id}-{i}", unit=f"hook-{i}", attempt=1), route="POST /events")
            out.append(r.status)
        return out

    with ThreadPoolExecutor(8) as ex:
        codes = [c for cs in ex.map(emit, enumerate(agents)) for c in cs]
    sc.check("8 agents emit run.* and step.* events", all(c == 200 for c in codes), codes)
    want, got = check_deliveries(sim, sc, "push")
    step_pushed = [g for g in got if json.loads(g["body"])["event"]["kind"].startswith("step.")]
    sc.check("step.* events (not subscribed) were not pushed", not step_pushed, len(step_pushed))

    r = judge.get(f"/subscriptions/{M.SUB_ID}/pull", params={"after_seq": 0, "limit": 1000},
                  route="GET /subscriptions/{id}/pull")
    pulled = {e["seq"] for e in r.j.get("events", [])}
    sc.check("pull (judge: events read) returns the subscribed stream", r.status == 200 and set(want) <= pulled
             and all(matches(e["kind"]) for e in r.j.get("events", [])), r)
    nxt = r.j.get("next_after_seq")
    r = sim.admin.post(f"/subscriptions/{M.SUB_ID}/ack", {"after_seq": nxt}, route="POST /subscriptions/{id}/ack")
    sc.check("ack moves the pull cursor", r.status == 200 and r.j.get("acked_seq") == nxt, r)
    r = agents[0].get(f"/subscriptions/{M.SUB_ID}/pull", route="GET /subscriptions/{id}/pull")
    sc.check("an agent (no events read) cannot pull (403)", r.status == 403, r)
    t0 = time.monotonic()
    import threading
    threading.Timer(0.8, lambda: agents[1].post("/events", {"kind": "run.finished", "project": PROJECT,
                                                            "body": ev_body(msg="late")},
                                                headers=env_headers(run=run_id, unit="late", attempt=1),
                                                route="POST /events")).start()
    r = judge.get(f"/subscriptions/{M.SUB_ID}/pull", params={"wait_s": 5}, route="GET /subscriptions/{id}/pull (long poll)")
    dt = time.monotonic() - t0
    sc.check("a long poll waits and returns the next subscribed event", r.status == 200 and 0.5 < dt < 4.5
             and [e["kind"] for e in r.j.get("events", [])] == ["run.finished"], (dt, r.brief()))
    sim.state["outbox_checked"] = True


if __name__ == "__main__":
    standalone(run, "S09", TITLE)
