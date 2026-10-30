"""Tests for KH events (app/eventing): store port, in-house queue, kh-events sidecar, KH's own events (2026-10-24).

WHAT IS UNDER TEST
  1. STORE. The sql adapter keeps a gapless seq per namespace, keeps the first copy of a repeated id, reads after a
     cursor with filters, counts groups, gets one event. An unknown KH_EVENT_STORE fails loudly.
  2. QUEUE. The memory queue refuses past its size (QueueFull), writes in batches grouped by namespace, keeps a batch
     the store refused and writes it on a later tick, drains on stop.
  3. SIDECAR. Only KH's bearer token may publish; 202 with the depth, 503 + Retry-After when full, 400 on a bad
     batch; stats; a graceful stop drains. HttpBuffer -> sidecar -> store end to end.
  4. KH EVENTS. With KH_EVENTS=on a signed-in call emits kh.api.call with the caller's e-mail, the session id,
     status and latency; a message emits kh.message.sent; the flusher hands them over; GET /events reads them
     (maintainers only). A buffer that refuses keeps the events; the outbox is bounded. Off: nothing is emitted.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_eventing.py
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_ev_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = "sqlite"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, messages  # noqa: E402
from app.eventing import emit, queue, sidecar, store  # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"], "test must run against a throwaway db"
FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


S = store.get_store()
S.init()


def ev(i, kind="t.one", **kw):
    r = emit.row(kind, {"i": i}, project=kw.pop("project", "p1"), email=kw.pop("email", "a@x.invalid"),
                 actor=kw.pop("actor", "sess-1"))
    r["id"] = kw.pop("id", f"e{i}")
    return r


# ── 1. store ────────────────────────────────────────────────────────────────
res = S.append("t1", [ev(1), ev(2), ev(3, kind="t.two", actor="sess-2")])
check("STORE: a batch gets gapless seqs 1..3", [r["seq"] for r in res] == [1, 2, 3], res)
res = S.append("t1", [ev(2), ev(4)])
check("STORE: a repeated id keeps its seq, the new one continues", res == [
    {"id": "e2", "seq": 2, "duplicate": True}, {"id": "e4", "seq": 4, "duplicate": False}], res)
check("STORE: each namespace counts on its own", S.append("t2", [ev(9)])[0]["seq"] == 1)
rows = S.read("t1", 1, [], [], {}, 10)
check("STORE: read after a cursor, oldest first", [r["seq"] for r in rows] == [2, 3, 4], [r["seq"] for r in rows])
check("STORE: filter by kind and by session", [r["id"] for r in S.read("t1", 0, ["t.two"], [], {}, 10)] == ["e3"]
      and [r["id"] for r in S.read("t1", 0, [], [], {"session_id": "sess-2"}, 10)] == ["e3"])
check("STORE: hidden kinds are left out", "e3" not in [r["id"] for r in S.read("t1", 0, [], ["t.two"], {}, 10)])
g = {x["kind"]: x["n"] for x in S.stats("t1", ["kind"], None, [])}
check("STORE: stats count per group", g == {"t.one": 3, "t.two": 1}, g)
one = S.get("t1", "e3")
check("STORE: get decodes body and actor", one and one["body"] == {"i": 3} and one["actor"]["actor"] == "sess-2", one)
check("STORE: count_kind", S.count_kind("t1", "t.one") == 3)
os.environ["KH_EVENT_STORE"] = "nope"
store.set_store(None)
try:
    store.get_store()
    check("STORE: an unknown KH_EVENT_STORE fails loudly", False)
except ValueError:
    check("STORE: an unknown KH_EVENT_STORE fails loudly", True)
os.environ.pop("KH_EVENT_STORE")
store.set_store(S)


# ── 2. queue ────────────────────────────────────────────────────────────────
class Flaky:
    """The sql store, but the first `fail` appends raise."""
    name, supports_guard = "flaky", False

    def __init__(self, fail):
        self.fail = fail

    def append(self, ns, rows, guard=None):
        if self.fail:
            self.fail -= 1
            raise RuntimeError("store down")
        return S.append(ns, rows)


mq = queue.MemoryQueue(store=S, max_events=5, batch_max=3, flush_s=60)
mq.publish("q1", [ev(i, id=f"q{i}") for i in range(4)])
try:
    mq.publish("q1", [ev(9, id="q9"), ev(10, id="q10")])
    check("QUEUE: past its size it refuses the batch", False)
except queue.QueueFull:
    check("QUEUE: past its size it refuses the batch", mq.depth() == 4 and mq.stats["refused_full"] == 2)
check("QUEUE: the writer stores at most batch_max at a time", mq.flush_once() == 3 and mq.depth() == 1)
check("QUEUE: and the rest on the next tick", mq.flush_once() == 1 and S.count_kind("q1", "t.one") == 4)
fq = queue.MemoryQueue(store=Flaky(1), batch_max=10, flush_s=60)
fq.publish("q2", [ev(1, id="f1"), ev(2, id="f2")])
check("QUEUE: a batch the store refused is kept, in order", fq.flush_once() == 0 and fq.depth() == 2
      and fq.stats["write_errors"] == 1)
check("QUEUE: and written on the next tick", fq.flush_once() == 2 and [r["id"] for r in S.read("q2", 0, [], [], {}, 10)]
      == ["f1", "f2"])
dq = queue.MemoryQueue(store=S, batch_max=2, flush_s=60)
dq.publish("q3", [ev(i, id=f"d{i}") for i in range(5)])
check("QUEUE: stop drains everything", dq.stop(3) == 5 and dq.depth() == 0 and S.count_kind("q3", "t.one") == 5)

# ── 3. sidecar ──────────────────────────────────────────────────────────────
smq = queue.MemoryQueue(store=S, max_events=4, batch_max=100, flush_s=60)
TOKEN = "sidecar-secret"
with TestClient(sidecar.create_app(token=TOKEN, mq=smq)) as sc:
    BEAR = {"Authorization": f"Bearer {TOKEN}"}
    batch = {"events": [{"ns": "sc", "row": ev(i, id=f"s{i}")} for i in range(3)]}
    check("SIDECAR: health needs no token", sc.get("/health").status_code == 200)
    check("SIDECAR: publishing needs KH's token", sc.post("/queue/publish", json=batch).status_code == 401
          and sc.post("/queue/publish", json=batch, headers={"Authorization": "Bearer wrong"}).status_code == 401)
    r = sc.post("/queue/publish", json=batch, headers=BEAR)
    check("SIDECAR: a batch is accepted (202, depth)", r.status_code == 202 and r.json() == {"accepted": 3, "depth": 3},
          r.text)
    r = sc.post("/queue/publish", json={"events": [{"ns": "sc", "row": ev(7, id="s7")}, {"ns": "sc", "row": ev(8, id="s8")}]},
                headers=BEAR)
    check("SIDECAR: full is 503 with Retry-After, nothing half-taken", r.status_code == 503
          and r.headers.get("retry-after") == "5" and smq.depth() == 3, (r.status_code, smq.depth()))
    r = sc.post("/queue/publish", json={"events": [{"ns": "sc", "row": {"kind": "x"}}]}, headers=BEAR)
    check("SIDECAR: a row without id is 400", r.status_code == 400, r.text)
    st = sc.get("/queue/stats", headers=BEAR).json()
    check("SIDECAR: stats", st["depth"] == 3 and st["accepted"] == 3 and st["store"] == "sql", st)
check("SIDECAR: a graceful stop drains the queue into the store", S.count_kind("sc", "t.one") == 3 and smq.depth() == 0)

hq = queue.MemoryQueue(store=S, flush_s=60)
with TestClient(sidecar.create_app(token=TOKEN, mq=hq)) as sc:
    import requests
    real_post = requests.post
    requests.post = lambda url, **kw: sc.post(url.replace("http://kh-events.test", ""), json=kw.get("json"),
                                              headers=kw.get("headers"))
    try:
        queue.HttpBuffer("http://kh-events.test", TOKEN).publish("hb", [ev(1, id="h1")])
        check("HTTP BUFFER: KH -> sidecar queue", hq.depth() == 1)
        try:
            queue.HttpBuffer("http://kh-events.test", "wrong").publish("hb", [ev(2, id="h2")])
            check("HTTP BUFFER: a refused post raises (the caller keeps the batch)", False)
        except RuntimeError:
            check("HTTP BUFFER: a refused post raises (the caller keeps the batch)", True)
    finally:
        requests.post = real_post
check("HTTP BUFFER: -> store after the sidecar's writer", [r["id"] for r in S.read("hb", 0, [], [], {}, 10)] == ["h1"])

# ── 4. KH's own events ──────────────────────────────────────────────────────
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None


def token(email, admin=False):
    now = int(time.time())
    kh = {"role": "maintainer" if admin else "member", "permissions": [], "all_projects": [], "projects": {}}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


ANA = {**token("ana@example.invalid"), "X-KH-Actor": "sess-ana"}
ADMIN = token("root@example.invalid", admin=True)
app = FastAPI()
auth.install(app)
messages.attach(app)
emit.attach(app)
client = TestClient(app)
queue.set_buffer(queue.DirectBuffer(S))

os.environ["KH_EVENTS"] = "off"
client.post("/messages/inbox", json={}, headers=ANA)
check("KH EVENTS off: nothing is emitted", emit.pending() == 0 and emit.STATS["emitted"] == 0)
os.environ["KH_EVENTS"] = "on"
client.post("/messages/inbox", json={}, headers=ANA)
client.post("/messages/direct", json={"to_actor": "sess-other", "content": "hi"}, headers=ANA)
check("KH EVENTS: the calls are queued in the outbox, not written inline", emit.pending() >= 3, emit.pending())
emit.flush()
rows = S.read(emit.namespace(), 0, [], [], {"session_id": "sess-ana"}, 50)
calls = [r for r in rows if r["kind"] == "kh.api.call"]
call = next((r for r in calls if r["body"]["path"] == "/messages/direct"), {})
check("KH EVENTS: kh.api.call carries e-mail, session, status and latency",
      call and call["actor"]["email"] == "ana@example.invalid" and call["session_id"] == "sess-ana"
      and call["body"]["status"] == 200 and isinstance(call["body"]["ms"], float), call)
sent = [r for r in rows if r["kind"] == "kh.message.sent"]
check("KH EVENTS: a message emits kh.message.sent with its session filter",
      sent and sent[0]["body"]["to_actor"] == "sess-other" and sent[0]["body"]["channel"] == "direct", sent)
r = client.get("/events?kind=kh.message.sent", headers=ADMIN)
check("KH EVENTS: GET /events reads them (maintainers)", r.status_code == 200
      and [e["kind"] for e in r.json()["events"]] == ["kh.message.sent"], r.text[:300])
check("KH EVENTS: not for members", client.get("/events", headers=ANA).status_code == 403)
r = client.get("/events:stats?group_by=kind", headers=ADMIN)
check("KH EVENTS: stats by kind", r.status_code == 200 and any(g["kind"] == "kh.api.call" for g in r.json()["groups"]),
      r.text[:300])


class Refusing:
    name = "refusing"

    def publish(self, ns, rows):
        raise queue.QueueFull("full")


queue.set_buffer(Refusing())
before = emit.pending()
client.post("/messages/inbox", json={}, headers=ANA)
check("KH EVENTS: a refusing buffer keeps the events for later", emit.flush() == 0 and emit.pending() > before)
os.environ["KH_EVENTS_OUTBOX_MAX"] = "3"
for _ in range(5):
    client.post("/messages/inbox", json={}, headers=ANA)
check("KH EVENTS: the outbox is bounded; the oldest are dropped and counted", emit.pending() <= 3
      and emit.STATS["dropped"] > 0, (emit.pending(), emit.STATS))
os.environ.pop("KH_EVENTS_OUTBOX_MAX")
queue.set_buffer(queue.DirectBuffer(S))
check("KH EVENTS: once the buffer takes them again they are sent", emit.flush() > 0)
os.environ["KH_EVENTS"] = "off"

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
