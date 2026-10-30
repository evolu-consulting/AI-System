"""Contract test: app/caps/outbox.py (stage F12).

  1. Kind filters: exact, prefix ``run.*``, ``kh.*``, ``*``.
  2. SSRF guard: https only (http only for 127.0.0.1 with KH_OUTBOX_ALLOW_LOCAL=1), private / loopback /
     link-local / metadata / CGNAT / IPv4-mapped addresses refused after resolution, host allowlist.
  3. Fan-out from the event store: every matching event once per subscription; repeat = no new rows.
  4. Delivery to a local receiver thread: signed (HMAC-SHA256 over timestamp + body), X-KH-Delivery, done rows.
  5. RACE fan-out: 4 fan-out workers while 4 writers append -> each (sub, seq) exactly once, none missing.
  6. RACE claim: 4 workers claim concurrently -> disjoint sets covering every due row; expired claim taken
     over and the old holder cannot finish.
  7. Retries with exponential backoff, flaky target recovers, dead after 12 attempts, unsafe target dead at once,
     dead -> pending through the retry route.
  8. Secrets: generated (readable, rotatable) or env: (409 secret_external), signature uses the env secret.
  9. Long-poll pull with kind filter and an acked server-side cursor; agent role (no events read) 403.
 10. Detach: pending rows dead with reason detached; nothing fanned out or claimed while detached.

    .venv\\Scripts\\python tests\\caps\\test_outbox.py
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ["KH_OUTBOX_ALLOW_LOCAL"] = "1"
os.environ["KH_CAPS_CRONS"] = "false"
os.environ["KH_TEST_HOOK_SECRET"] = "env-secret-123"

from harness import H  # noqa: E402

from app import sqldb  # noqa: E402
from app.caps import core, outbox  # noqa: E402
from app.caps.core import CapError, Caller  # noqa: E402

# ── the receiver ─────────────────────────────────────────────────────────────
GOT: list[dict] = []
FLAKY: dict[str, int] = {}
LOCK = threading.Lock()


class Recv(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        did = self.headers.get("X-KH-Delivery")
        with LOCK:
            GOT.append({"path": self.path, "headers": dict(self.headers), "body": body})
            n = FLAKY[did] = FLAKY.get(did, 0) + 1
        status = 200
        if self.path.startswith("/fail"):
            status = 500
        elif self.path.startswith("/flaky") and n <= 2:
            status = 503
        self.send_response(status)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *a):
        pass


SRV = ThreadingHTTPServer(("127.0.0.1", 0), Recv)
threading.Thread(target=SRV.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{SRV.server_address[1]}"


def got(path_prefix):
    with LOCK:
        return [g for g in GOT if g["path"].startswith(path_prefix)]


c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha"])


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service") if p else None


core.CALLER_RESOLVERS.append(_test_resolver)


def as_(principal, role="agent"):
    return {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}


def sql(q, p=()):
    with sqldb.connect() as conn:
        return [dict(r) for r in conn.execute(q, list(p)).fetchall()]


def force_due(ns):
    with sqldb.connect() as conn:
        conn.execute("UPDATE kh_outbox SET next_ms=0 WHERE ns=? AND state='pending'", [ns])


H.check("http(s) receiver thread is up", BASE.startswith("http://127.0.0.1:"))

# ── 1. kind filters ──────────────────────────────────────────────────────────
m = outbox.matches
H.check("filters: exact, prefix, kh.*, *", m(["run.started"], "run.started") and not m(["run.started"], "run.x")
        and m(["run.*"], "run.x") and not m(["run.*"], "runner") and m(["kh.*"], "kh.duplicate")
        and not m(["kh.*"], "step.done") and m(["*"], "anything") and not m([], "a"))

# ── 2. SSRF guard ────────────────────────────────────────────────────────────


def fake(*ips):
    return lambda host, port, proto=None: [(2, 1, 6, "", (ip, port)) for ip in ips]


def refused(url, resolve=None, allow=None):
    try:
        outbox.check_target(url, allow, **({"resolve": resolve} if resolve else {}))
        return False
    except CapError as exc:
        return exc.code == "unsafe_target" and exc.status == 422


H.check("SSRF: http to a public host is refused", refused("http://example.com/x", fake("93.184.216.34")))
H.check("SSRF: http://localhost is refused even with ALLOW_LOCAL", refused("http://localhost:9/x"))
H.check("SSRF: http://127.0.0.1 allowed only with KH_OUTBOX_ALLOW_LOCAL=1",
        outbox.check_target("http://127.0.0.1:9/x")[3] == "127.0.0.1")
os.environ["KH_OUTBOX_ALLOW_LOCAL"] = "0"
H.check("... and refused without it", refused("http://127.0.0.1:9/x"))
os.environ["KH_OUTBOX_ALLOW_LOCAL"] = "1"
for name, ips in (("private 10/8", ["10.0.0.5"]), ("private 192.168", ["192.168.1.1"]), ("loopback", ["127.0.0.1"]),
                  ("link-local / metadata", ["169.254.169.254"]), ("CGNAT 100.64", ["100.64.0.1"]),
                  ("IPv6 loopback", ["::1"]), ("IPv6 ULA", ["fd00:ec2::254"]), ("IPv4-mapped private", ["::ffff:10.0.0.1"]),
                  ("one bad address among good ones", ["93.184.216.34", "10.1.2.3"]), ("unspecified", ["0.0.0.0"])):
    H.check(f"SSRF: https host resolving to {name} is refused", refused("https://hooks.example/x", fake(*ips)))
H.check("SSRF: https literal private IP is refused", refused("https://10.0.0.1/x"))
H.check("SSRF: credentials in the url are refused", refused("https://u:p@hooks.example/x", fake("93.184.216.34")))
ok = outbox.check_target("https://hooks.example/x", ["hooks.example"], resolve=fake("93.184.216.34"))
H.check("SSRF: a public address passes and is pinned", ok == ("https", "hooks.example", 443, "93.184.216.34"), ok)
H.check("SSRF: host not on the webhook_hosts allowlist is refused",
        refused("https://other.example/x", fake("93.184.216.34"), ["hooks.example"]))

# ── setup: namespace, manifest with subscriptions ────────────────────────────
c.put("/v1/admin/ns/hooks", json={"projects": ["alpha"]}, headers=OWNER)
MAN = {"types": [{"type": "run.started", "kind_of": "event"}, {"type": "run.ended", "kind_of": "event"},
                 {"type": "step.done", "kind_of": "event"}],
       "subscriptions": [
           {"sub_id": "all", "kinds": ["*"], "url": "https://hooks.example/all"},
           {"sub_id": "runs", "kinds": ["run.*"], "url": "https://hooks.example/runs"},
           {"sub_id": "khsub", "kinds": ["kh.*"], "url": "https://hooks.example/kh", "secret_ref": "env:KH_TEST_HOOK_SECRET"},
           {"sub_id": "failing", "kinds": ["step.done"], "url": "https://hooks.example/fail"},
           {"sub_id": "flaky", "kinds": ["run.ended"], "url": "https://hooks.example/flaky"},
           {"sub_id": "unsafe", "kinds": ["run.ended"], "url": "https://10.0.0.1/x"},
       ]}
r = c.put("/v1/hooks/manifest", json=MAN, headers=OWNER)
assert r.status_code == 200, r.text
H.check("each subscription's cursor is created in the apply transaction (no gap before the first fan-out)",
        sql("SELECT COUNT(*) AS n FROM kh_outbox_cursor WHERE ns='hooks'")[0]["n"] == len(MAN["subscriptions"]))
from app.caps import registry as _registry  # noqa: E402
H.check("the manifest accepts http://127.0.0.1 only with KH_OUTBOX_ALLOW_LOCAL=1",
        _registry._sub_url_ok("http://127.0.0.1:9/x") and not _registry._sub_url_ok("http://example.com/x"))
# The registry accepts https urls only; point the test subscriptions at the local receiver.
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_subscription SET url=REPLACE(url, 'https://hooks.example', ?) WHERE ns='hooks'", [BASE])
H.check("new subscriptions start at the end of the stream", outbox.fanout_all() == 0)


def post(kind, n=1, **extra):
    evs = [{"kind": kind, "project": "alpha", "body": {"i": i}, **extra} for i in range(n)]
    r = c.post("/v1/hooks/events", json={"events": evs}, headers=OWNER)
    assert r.status_code == 200, r.text
    return [a["seq"] for a in r.json()["accepted"]]


# ── 3/4. fan-out and signed delivery ─────────────────────────────────────────
s_run = post("run.started", 3)
s_step = post("step.done", 2)
c.post("/v1/hooks/events", json={"id": "dup1", "kind": "step.done", "project": "alpha", "body": {}}, headers=OWNER)
c.post("/v1/hooks/events", json={"id": "dup1", "kind": "step.done", "project": "alpha", "body": {}}, headers=OWNER)
kh_seqs = [r["seq"] for r in sql("SELECT seq FROM kh_event WHERE ns='hooks' AND kind LIKE 'kh.%'")]
H.check("a kh.duplicate event exists to deliver", len(kh_seqs) >= 1, kh_seqs)
made = outbox.fanout_all()
by_sub = {}
for row in sql("SELECT sub_id, event_seq FROM kh_outbox WHERE ns='hooks'"):
    by_sub.setdefault(row["sub_id"], []).append(row["event_seq"])
top = max(r["seq"] for r in sql("SELECT seq FROM kh_event WHERE ns='hooks'"))
H.check("fan-out: '*' gets every event", sorted(by_sub["all"]) == list(range(1, top + 1)), by_sub.get("all"))
H.check("fan-out: 'run.*' gets only run events", sorted(by_sub["runs"]) == s_run, by_sub.get("runs"))
H.check("fan-out: 'kh.*' gets only kh events", sorted(by_sub["khsub"]) == kh_seqs, by_sub.get("khsub"))
H.check("fan-out: exact kind filter", sorted(by_sub["failing"]) == s_step + [s_step[-1] + 1], by_sub.get("failing"))
H.check("fan-out again creates no row", outbox.fanout_all() == 0)

res = outbox.deliver_all()
H.check("delivery: done for every good row", res.get("done") == len(by_sub["all"]) + 3 + len(kh_seqs), res)
all_got = got("/all")
H.check("each delivery arrives once", sorted(json.loads(g["body"])["event"]["seq"] for g in all_got)
        == list(range(1, top + 1)), len(all_got))
secret = c.get("/v1/hooks/subscriptions/all/secret", headers=OWNER).json()["secret"]
g0 = all_got[0]
hd = {k.lower(): v for k, v in g0["headers"].items()}
body0 = json.loads(g0["body"])
H.check("headers: X-KH-Namespace names the namespace (dedupe key = namespace + delivery id), as the signed body",
        hd.get("x-kh-namespace") == "hooks" == body0["ns"], hd)
H.check("headers: X-KH-Delivery = <sub>:<seq>, subscription, seq, timestamp",
        hd["x-kh-delivery"] == f"all:{body0['event']['seq']}" == body0["delivery_id"] and hd["x-kh-subscription"] == "all"
        and hd["x-kh-event-seq"] == str(body0["event"]["seq"]) and int(hd["x-kh-timestamp"]) > 0, hd)
H.check("signature verifies: HMAC-SHA256(secret, ts + '.' + body)",
        outbox.verify(secret, hd["x-kh-timestamp"], g0["body"], hd["x-kh-signature"])
        and hd["x-kh-signature"].startswith("sha256="), hd.get("x-kh-signature"))
H.check("signature fails with a tampered body or wrong secret",
        not outbox.verify(secret, hd["x-kh-timestamp"], g0["body"] + b" ", hd["x-kh-signature"])
        and not outbox.verify("nope", hd["x-kh-timestamp"], g0["body"], hd["x-kh-signature"]))
H.check("signature fails outside the timestamp window",
        not outbox.verify(secret, hd["x-kh-timestamp"], g0["body"], hd["x-kh-signature"],
                          now_ms=int(hd["x-kh-timestamp"]) + 301_000))
kg = got("/kh")[0]
khd = {k.lower(): v for k, v in kg["headers"].items()}
H.check("env: secret signs the kh.* subscription",
        outbox.verify("env-secret-123", khd["x-kh-timestamp"], kg["body"], khd["x-kh-signature"]))
r = c.get("/v1/hooks/subscriptions/khsub/secret", headers=OWNER)
H.check("an env: secret is not readable: 409 secret_external", r.status_code == 409
        and r.json()["error"] == "secret_external", r.text)
r2 = c.post("/v1/hooks/subscriptions/all/secret/rotate", headers=OWNER)
H.check("rotate gives a new secret", r2.status_code == 200 and r2.json()["secret"] != secret, r2.text)
H.check("delivering again sends nothing", outbox.deliver_all() == {} and len(got("/all")) == len(all_got))

# ── 7. retries, backoff, dead ────────────────────────────────────────────────
H.check("backoff: 1 s, 2 s, 4 s ... capped at 1 h", [outbox.backoff_ms(a) for a in (1, 2, 3, 12, 20)]
        == [1000, 2000, 4000, 2048000, 3600000])
fail = sql("SELECT * FROM kh_outbox WHERE ns='hooks' AND sub_id='failing'")
with sqldb.connect() as conn:
    now = sqldb.now_ms(conn)
H.check("a 500 is retried later (pending, attempts 1, next_ms ~ now + 1 s)",
        all(f["state"] == "pending" and f["attempts"] == 1 and f["last_status"] == 500
            and 0 < f["next_ms"] - now <= 1500 for f in fail), fail)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_outbox SET attempts=11, next_ms=0 WHERE ns='hooks' AND sub_id='failing'")
outbox.deliver_all()
fail = sql("SELECT * FROM kh_outbox WHERE ns='hooks' AND sub_id='failing'")
H.check("after 12 attempts the row is dead", all(f["state"] == "dead" and f["attempts"] == 12 for f in fail), fail)

s_end = post("run.ended", 1)
outbox.fanout_all()
outbox.deliver_all()
uns = sql("SELECT * FROM kh_outbox WHERE ns='hooks' AND sub_id='unsafe'")
H.check("an unsafe target is dead at once (unsafe_target)", len(uns) == 1 and uns[0]["state"] == "dead"
        and uns[0]["attempts"] == 1 and uns[0]["last_error"].startswith("unsafe_target"), uns)
for _ in range(3):
    force_due("hooks")
    outbox.deliver_all()
fl = sql("SELECT * FROM kh_outbox WHERE ns='hooks' AND sub_id='flaky'")
H.check("a flaky target recovers: done after 3 attempts", len(fl) == 1 and fl[0]["state"] == "done"
        and fl[0]["attempts"] == 3 and fl[0]["last_status"] == 200, fl)
H.check("... and the consumer saw the same X-KH-Delivery 3 times (dedupe key)",
        [g["headers"].get("X-KH-Delivery") for g in got("/flaky")] == [f"flaky:{s_end[0]}"] * 3)

did = fail[0]["delivery_id"]
r = c.post(f"/v1/hooks/outbox/{did}/retry", headers=OWNER)
H.check("retry route: dead -> pending", r.status_code == 200 and sql(
    "SELECT state, attempts FROM kh_outbox WHERE ns='hooks' AND delivery_id=?", [did])[0] == {"state": "pending",
                                                                                          "attempts": 0}, r.text)
r = c.post(f"/v1/hooks/outbox/{did}/retry", headers=OWNER)
H.check("retry of a non-dead row: 409 invalid_transition", r.status_code == 409, r.text)
r = c.get("/v1/hooks/outbox?state=dead", headers=OWNER)
H.check("outbox listing filters by state", r.status_code == 200 and all(d["state"] == "dead" for d in r.json()[
    "deliveries"]) and len(r.json()["deliveries"]) >= 1, r.text)
r = c.get("/v1/hooks/subscriptions", headers=OWNER)
subs = {s["sub_id"]: s for s in r.json()["subscriptions"]}
H.check("subscription listing: cursor at the end of the stream", subs["all"]["cursor"] == s_end[0], subs.get("all"))
H.check("subscription listing counts done rows (3 run.started + 1 run.ended)", subs["runs"]["outbox"]["done"] == 4,
        subs.get("runs"))
r = c.get("/v1/hooks/subscriptions", headers=as_("a1", "orchestrator"))
H.check("non-admin cannot list subscriptions (403)", r.status_code == 403, r.text)
with sqldb.connect() as conn:                                     # park the failing subscription's row
    conn.execute("UPDATE kh_outbox SET state='dead' WHERE ns='hooks' AND sub_id='failing'")

# ── 5. RACE fan-out ──────────────────────────────────────────────────────────
before = top_before = max(r["seq"] for r in sql("SELECT seq FROM kh_event WHERE ns='hooks'"))
stop = threading.Event()


def fanner(i):
    n = 0
    while not stop.is_set():
        n += outbox.fanout_all()
    return n + outbox.fanout_all()


def writer(i):
    for _ in range(10):
        post("run.started", 3)
    return 0


fan_threads = []
fan_out = []
for i in range(4):
    t = threading.Thread(target=lambda i=i: fan_out.append(fanner(i)))
    t.start()
    fan_threads.append(t)
H.race(4, writer)
stop.set()
for t in fan_threads:
    t.join()
outbox.fanout_all()
top = max(r["seq"] for r in sql("SELECT seq FROM kh_event WHERE ns='hooks'"))
rows = sql("SELECT event_seq FROM kh_outbox WHERE ns='hooks' AND sub_id='all' AND event_seq>?", [before])
seqs = sorted(r["event_seq"] for r in rows)
H.check("RACE fan-out: every new event once for '*' (none lost, none twice)",
        seqs == list(range(before + 1, top + 1)), (len(seqs), top - before))
runs = sorted(r["event_seq"] for r in sql("SELECT event_seq FROM kh_outbox WHERE ns='hooks' AND sub_id='runs' "
                                          "AND event_seq>?", [before]))
H.check("RACE fan-out: 120 run events once for 'run.*'", len(runs) == 120 and len(set(runs)) == 120, len(runs))
H.check("RACE fan-out: workers together created exactly those rows",
        sum(fan_out) == len(seqs) + len(runs) + len(sql("SELECT 1 FROM kh_outbox WHERE ns='hooks' AND sub_id='khsub' "
                                                        "AND event_seq>?", [before])), (sum(fan_out), len(seqs)))

# ── 6. RACE claim ────────────────────────────────────────────────────────────
due = sql("SELECT delivery_id FROM kh_outbox WHERE ns='hooks' AND state='pending'")
claims = H.race(4, lambda i: outbox.claim(100)[1])
ids = [r["delivery_id"] for cl in claims for r in cl]
H.check("RACE claim: claimed sets are disjoint", len(ids) == len(set(ids)), len(ids))
H.check("RACE claim: together they cover every due row (up to 4 x 100)",
        set(ids) == {d["delivery_id"] for d in due} or len(ids) == 400, (len(ids), len(due)))
victim = claims[0][0] if claims[0] else next(cl[0] for cl in claims if cl)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_outbox SET claimed_until_ms=0 WHERE ns='hooks' AND delivery_id=?", [victim["delivery_id"]])
tok_b, rows_b = outbox.claim(100)
H.check("an expired claim is taken over by the next claimer", [r["delivery_id"] for r in rows_b]
        == [victim["delivery_id"]], [r["delivery_id"] for r in rows_b])
H.check("the old holder cannot finish the row any more", not outbox._finish(victim, victim["claim_token"], True, 200,
                                                                            None))
H.check("the new holder can", outbox._finish(rows_b[0], tok_b, True, 200, None))
with sqldb.connect() as conn:                                     # release every claim for the next parts
    conn.execute("UPDATE kh_outbox SET claimed_until_ms=0 WHERE ns='hooks' AND state='claimed'")
res = outbox.deliver_all()
H.check("the claimed backlog is delivered", sql("SELECT COUNT(*) AS n FROM kh_outbox WHERE ns='hooks' AND "
                                                "state IN ('pending','claimed')")[0]["n"] == 0, res)

# ── 9. long-poll pull ────────────────────────────────────────────────────────
r = c.get("/v1/hooks/subscriptions/runs/pull?limit=1000", headers=OWNER)
pj = r.json()
H.check("pull: default cursor 0 returns the run events only", r.status_code == 200 and pj["acked_seq"] == 0
        and pj["events"] and all(e["kind"].startswith("run.") for e in pj["events"]), r.text[:300])
r = c.post("/v1/hooks/subscriptions/runs/ack", json={"after_seq": pj["next_after_seq"]}, headers=OWNER)
H.check("ack moves the pull cursor", r.status_code == 200 and r.json()["acked_seq"] == pj["next_after_seq"], r.text)
r = c.post("/v1/hooks/subscriptions/runs/ack", json={"after_seq": 1}, headers=OWNER)
H.check("ack never moves backwards", r.json()["acked_seq"] == pj["next_after_seq"], r.text)
r = c.post("/v1/hooks/subscriptions/runs/ack", json={"after_seq": 10 ** 9}, headers=OWNER)
H.check("ack beyond the stream is 422", r.status_code == 422, r.text)
threading.Timer(0.6, lambda: (post("step.done", 1), post("run.ended", 1))).start()
t0 = time.monotonic()
r = c.get("/v1/hooks/subscriptions/runs/pull?wait_s=5", headers=OWNER)
dt = time.monotonic() - t0
ev = r.json()["events"]
H.check("long poll waits, then returns the next matching event (step.done skipped)",
        0.4 < dt < 4.5 and [e["kind"] for e in ev] == ["run.ended"], (dt, [e["kind"] for e in ev]))
t0 = time.monotonic()
r = c.get(f"/v1/hooks/subscriptions/runs/pull?after_seq={ev[0]['seq']}&wait_s=0.6", headers=OWNER)
H.check("long poll with nothing new returns empty after wait_s", r.json()["events"] == []
        and time.monotonic() - t0 >= 0.5, r.text)
r = c.get("/v1/hooks/subscriptions/runs/pull", headers=as_("a1", "agent"))
H.check("pull needs events read: agent gets 403", r.status_code == 403, r.text)
r = c.get("/v1/hooks/subscriptions/runs/pull", headers=as_("j1", "judge"))
H.check("judge (events read) may pull", r.status_code == 200, r.text)
r = c.get("/v1/hooks/subscriptions/nope/pull", headers=OWNER)
H.check("pull of an unknown subscription is 404", r.status_code == 404, r.text)

# ── 10. detach ───────────────────────────────────────────────────────────────
post("run.started", 2)
outbox.fanout_all()
pend = sql("SELECT delivery_id FROM kh_outbox WHERE ns='hooks' AND state='pending'")
H.check("rows are pending before the detach", len(pend) >= 4, len(pend))
r = c.post("/v1/admin/ns/hooks:detach", headers=OWNER)
H.check("detach ok", r.status_code == 200, r.text)
dead = sql("SELECT state, last_error FROM kh_outbox WHERE ns='hooks' AND delivery_id IN (%s)"
           % ",".join("?" for _ in pend), [p["delivery_id"] for p in pend])
H.check("detach: pending rows dead with reason detached", all(d == {"state": "dead", "last_error": "detached"}
                                                              for d in dead), dead)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_outbox SET state='pending', next_ms=0 WHERE ns='hooks' AND delivery_id=?",
                 [pend[0]["delivery_id"]])
n_before = len(sql("SELECT 1 FROM kh_outbox WHERE ns='hooks'"))
H.check("detached: nothing is claimed or fanned out", outbox.claim(100)[1] == [] and outbox.fanout_all() == 0
        and len(sql("SELECT 1 FROM kh_outbox WHERE ns='hooks'")) == n_before)
other_dead = sql("SELECT delivery_id, last_error FROM kh_outbox WHERE ns='hooks' AND state='dead' "
                 "AND last_error<>'detached'")
r = c.post("/v1/admin/ns/hooks:reattach", headers=OWNER)
revived = sql("SELECT state, last_error FROM kh_outbox WHERE ns='hooks' AND delivery_id IN (%s)"
              % ",".join("?" for _ in pend[1:]), [p["delivery_id"] for p in pend[1:]])
H.check("reattach: every row the detach killed is due again (pending, reason cleared)", r.status_code == 200
        and revived and all(x == {"state": "pending", "last_error": None} for x in revived), revived)
for _ in range(3):
    force_due("hooks")
    outbox.deliver_all()
states = sql("SELECT sub_id, state FROM kh_outbox WHERE ns='hooks' AND sub_id IN ('all', 'runs') AND delivery_id IN (%s)"
             % ",".join("?" for _ in pend), [p["delivery_id"] for p in pend])
H.check("reattach: the events in flight at the detach are delivered to the healthy targets (at least once "
        "survives a plug-out)", len(states) >= 4 and all(x["state"] == "done" for x in states), states)
still = sql("SELECT delivery_id, last_error FROM kh_outbox WHERE ns='hooks' AND state='dead' AND last_error<>'detached'")
H.check("reattach: rows dead for another reason (failed target, unsafe url) stay dead",
        other_dead and {x["delivery_id"] for x in other_dead} <= {x["delivery_id"] for x in still}, (other_dead, still))

caps = c.get("/v1/capabilities", headers=OWNER).json()["capabilities"]
H.check("outbox is listed in discovery", any(x["name"] == "outbox" for x in caps))
SRV.shutdown()
H.done()
