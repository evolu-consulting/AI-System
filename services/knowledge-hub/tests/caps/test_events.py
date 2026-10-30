"""Contract test: app/caps/events.py (stage F4).

  1. Append one or a batch; ids generated or client-supplied; index fields promoted; actor stamped.
  2. Required fields: JSON Schema `required` and the type's required_envelope (from the event or the
     X-KH-Run/Unit/Session headers) -> 422 with a JSON pointer; unknown kinds and kh.* refused; 256 KB limit.
  3. All or nothing by default, ?partial=true keeps the valid ones.
  4. A repeated id is a duplicate: same seq, kh.duplicate.
  5. Cursor reads (after_seq, kind, run_id, unit_id, limit), one by id, long poll, stats.
  6. ACL: a role outside a type's read_roles does not see that kind; agent cannot read events (matrix).
  7. RACE: 8 writers x 25 appends with a concurrent cursor reader -> seq 1..N without gaps, every id once,
     and the reader sees every seq exactly once and in order (commit order = seq order).
  8. A type with events cannot be removed from the manifest without ?archive=true.

    .venv\\Scripts\\python tests\\caps\\test_events.py
"""
import threading
import time

from harness import H

from app import sqldb
from app.caps import core
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha", "beta"])


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service") if p else None


core.CALLER_RESOLVERS.append(_test_resolver)


def as_(principal, role="agent", **extra):
    return {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role, **extra}


c.put("/v1/admin/ns/line", json={"projects": ["alpha", "beta"]}, headers=OWNER)
MAN = {
    "schemas": [{"name": "run_started", "version": 1, "schema": {
        "type": "object", "required": ["agent_version", "model"],
        "properties": {"agent_version": {"type": "string"}, "model": {"type": "string"}, "cost": {"type": "number"}}}}],
    "types": [
        {"type": "run.started", "kind_of": "event", "schema": "run_started",
         "index_fields": {"agent_version": "s", "cost": "n"}, "required_envelope": ["run_id"]},
        {"type": "step.done", "kind_of": "event"},
        {"type": "secret.audit", "kind_of": "event", "read_roles": ["grader"]},
    ]}
r = c.put("/v1/line/manifest", json=MAN, headers=OWNER)
assert r.status_code == 200, r.text
GOOD = {"kind": "run.started", "project": "alpha", "run_id": "R1",
        "body": {"agent_version": "1.4", "model": "m-2026", "cost": 0.25}}

# ── 1. append ────────────────────────────────────────────────────────────────
r = c.post("/v1/line/events", json=GOOD, headers=as_("a1", **{"X-KH-Unit": "U9", "X-KH-Session": "S1"}))
acc = r.json()["accepted"]
H.check("append one event: 200 with id and seq 1", r.status_code == 200 and acc[0]["seq"] == 1 and acc[0]["id"], r.text)
ev = c.get(f"/v1/line/events/{acc[0]['id']}", headers=OWNER).json()
H.check("envelope from headers, actor stamped, ts and received set", ev["unit_id"] == "U9" and ev["session_id"] == "S1"
        and ev["actor"]["principal"] == "a1" and ev["actor"]["role"] == "agent" and ev["ts_ms"] > 0, ev)
with sqldb.connect() as conn:
    ix = dict(conn.execute("SELECT ix_s1, ix_n1, project FROM kh_event WHERE id=?", [acc[0]["id"]]).fetchone())
H.check("index fields are promoted into typed columns", ix == {"ix_s1": "1.4", "ix_n1": 0.25, "project": "alpha"}, ix)
batch = {"events": [{**GOOD, "id": f"b-{i}"} for i in range(3)] + [{"kind": "step.done", "project": "beta",
                                                                   "body": {"step": "test"}}]}
r = c.post("/v1/line/events", json=batch, headers=as_("a1"))
H.check("a batch gets consecutive seqs", [a["seq"] for a in r.json()["accepted"]] == [2, 3, 4, 5], r.text)

# ── 2. required fields ───────────────────────────────────────────────────────
r = c.post("/v1/line/events", json={**GOOD, "body": {"agent_version": "1.4"}}, headers=as_("a1"))
H.check("a missing schema-required field is 422 with its pointer", r.status_code == 422
        and r.json()["rejected"][0]["errors"][0]["pointer"] == "/body", r.text)
r = c.post("/v1/line/events", json={**GOOD, "run_id": None}, headers=as_("a1"))
H.check("a missing required envelope field (run_id) is 422", r.status_code == 422
        and r.json()["rejected"][0]["errors"][0]["pointer"] == "/run_id", r.text)
r = c.post("/v1/line/events", json={**GOOD, "run_id": None}, headers=as_("a1", **{"X-KH-Run": "R2"}))
H.check("... and accepted when X-KH-Run supplies it", r.status_code == 200, r.text)
r = c.post("/v1/line/events", json={"kind": "nope", "body": {}}, headers=as_("a1"))
H.check("an unregistered kind is 422", r.status_code == 422, r.text)
r = c.post("/v1/line/events", json={"kind": "kh.duplicate", "body": {}}, headers=as_("a1"))
H.check("a consumer cannot write kh.* events", r.status_code == 422, r.text)
r = c.post("/v1/line/events", json={"kind": "step.done", "project": "gamma", "body": {}}, headers=as_("a1"))
H.check("a project outside the namespace is refused", r.status_code == 422 and "gamma" in r.text, r.text)
r = c.post("/v1/line/events", json={"kind": "step.done", "project": "alpha", "body": {"x": "y" * 270000}},
           headers=as_("a1"))
H.check("a body over 256 KB is refused", r.status_code == 422 and "larger" in r.text, r.status_code)
r = c.post("/v1/line/events", json={"events": [{}] * 501}, headers=as_("a1"))
H.check("more than 500 events in a batch is 413", r.status_code == 413, r.status_code)

# ── 3. all or nothing ────────────────────────────────────────────────────────
mixed = {"events": [{**GOOD, "id": "m-ok"}, {**GOOD, "id": "m-bad", "body": {}}]}
r = c.post("/v1/line/events", json=mixed, headers=as_("a1"))
H.check("a batch with one invalid event stores nothing by default", r.status_code == 422
        and r.json()["accepted"] == [] and r.json()["rejected"][0]["index"] == 1
        and c.get("/v1/line/events/m-ok", headers=OWNER).status_code == 404, r.text)
r = c.post("/v1/line/events?partial=true", json=mixed, headers=as_("a1"))
H.check("?partial=true keeps the valid ones", r.status_code == 200 and [a["id"] for a in r.json()["accepted"]] == ["m-ok"]
        and len(r.json()["rejected"]) == 1, r.text)

# ── 4. duplicates ────────────────────────────────────────────────────────────
seq0 = c.get("/v1/line/events/b-0", headers=OWNER).json()["seq"]
r = c.post("/v1/line/events", json={**GOOD, "id": "b-0"}, headers=as_("a1"))
H.check("a repeated id is a duplicate with the original seq", r.status_code == 200
        and r.json()["accepted"][0] == {"index": 0, "id": "b-0", "seq": seq0, "duplicate": True}, r.text)
dups = c.get("/v1/line/events?kind=kh.duplicate", headers=OWNER).json()["events"]
H.check("the duplicate wrote kh.duplicate", dups and "b-0" in dups[-1]["body"]["event_ids"], dups)

# ── 5. reads ─────────────────────────────────────────────────────────────────
r = c.get("/v1/line/events?after_seq=2&limit=2", headers=OWNER).json()
H.check("cursor read after_seq + limit + next_after_seq", [e["seq"] for e in r["events"]] == [3, 4]
        and r["next_after_seq"] == 4, r)
r = c.get("/v1/line/events?kind=step.done", headers=OWNER).json()
H.check("filter by kind", [e["kind"] for e in r["events"]] == ["step.done"], r)
r = c.get("/v1/line/events?run_id=R2", headers=OWNER).json()
H.check("filter by run_id", len(r["events"]) == 1 and r["events"][0]["run_id"] == "R2", r)
r = c.get("/v1/line/events?unit_id=U9", headers=OWNER).json()
H.check("filter by unit_id", len(r["events"]) == 1, r)
r = c.get("/v1/line/events:stats?group_by=kind", headers=OWNER).json()
H.check("stats by kind", {g["kind"]: g["n"] for g in r["groups"]}.get("run.started") >= 5, r)
r = c.get("/v1/line/events:stats?group_by=body_json", headers=OWNER)
H.check("stats refuse arbitrary columns", r.status_code == 422, r.text)
top = c.get("/v1/line/events?after_seq=0&limit=1000", headers=OWNER).json()["next_after_seq"]
got = {}


def poll():
    t0 = time.monotonic()
    got["r"] = c.get(f"/v1/line/events?after_seq={top}&wait_s=5", headers=OWNER).json()
    got["t"] = time.monotonic() - t0


th = threading.Thread(target=poll)
th.start()
time.sleep(0.6)
c.post("/v1/line/events", json={"kind": "step.done", "project": "alpha", "body": {}}, headers=as_("a1"))
th.join()
H.check("a long poll returns as soon as an event arrives", len(got["r"]["events"]) == 1 and got["t"] < 3, got)

# ── 6. ACL ───────────────────────────────────────────────────────────────────
c.post("/v1/line/events", json={"kind": "secret.audit", "project": "alpha", "body": {"s": 1}}, headers=as_("a1"))
r = c.get("/v1/line/events?kind=secret.audit", headers=as_("j1", "judge")).json()
H.check("a judge outside the type's read_roles does not see that kind", r["events"] == [], r)
r = c.get("/v1/line/events?kind=secret.audit", headers=as_("g1", "grader")).json()
H.check("a grader in read_roles sees it", len(r["events"]) == 1, r)
H.check("an agent may not read events (role matrix: append only)",
        c.get("/v1/line/events", headers=as_("a1")).status_code == 403)
H.check("a distiller may not append", c.post("/v1/line/events", json=GOOD, headers=as_("d1", "distiller")).status_code == 403)

# ── 7. race: gapless seq with a concurrent cursor reader ─────────────────────
with sqldb.connect() as conn:
    start = sqldb.counter_get(conn, "ev:line")
seen = []
stop = threading.Event()


def reader():
    cur = start
    while not stop.is_set() or cur < start + 200:
        rows = c.get(f"/v1/line/events?after_seq={cur}&limit=1000", headers=OWNER).json()["events"]
        for e in rows:
            seen.append(e["seq"])
        if rows:
            cur = rows[-1]["seq"]
        elif stop.is_set():
            # writers finished; anything not seen by now would be a skipped row
            more = c.get(f"/v1/line/events?after_seq={cur}&limit=1000", headers=OWNER).json()["events"]
            if not more:
                break


rt = threading.Thread(target=reader)
rt.start()
H.race(8, lambda i: [c.post("/v1/line/events", json={"kind": "step.done", "project": "alpha", "id": f"w{i}-{k}",
                                                      "body": {"w": i, "k": k}}, headers=as_(f"w{i}"))
                     for k in range(25)])
stop.set()
rt.join(timeout=30)
with sqldb.connect() as conn:
    seqs = [r[0] for r in conn.execute("SELECT seq FROM kh_event WHERE ns='line' AND seq>? ORDER BY seq", [start])]
    ids = conn.execute("SELECT COUNT(DISTINCT id) FROM kh_event WHERE ns='line' AND id LIKE 'w%-%'").fetchone()[0]
writes = [s for s in seqs]
H.check("RACE: 8 writers x 25 appends -> seq is gapless and every id stored once",
        ids == 200 and writes == list(range(start + 1, start + 1 + len(writes))) and len(writes) >= 200,
        (ids, len(writes), writes[:3], writes[-3:]))
H.check("RACE: a concurrent cursor reader saw every seq exactly once, in order (never skipped a later commit)",
        seen == list(range(start + 1, start + 1 + len(seen))) and len(seen) >= 200, (len(seen), seen[:5]))

# ── 7b. the counter lock is short; same-id races resolve on the unique index ──
from app.caps import events as events_mod  # noqa: E402

LOG = []
# The SQL of an append lives in the EventStore's sql adapter since 2026-10-24 (app/eventing/store.py).
import app.eventing.store as store_mod  # noqa: E402

_real_connect = store_mod.sqldb.connect


class _Spy:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        LOG.append(" ".join(sql.split())[:48])
        return self.conn.execute(sql, params)

    def __enter__(self):
        self.conn.__enter__()
        return self

    def __exit__(self, *a):
        return self.conn.__exit__(*a)

    def __getattr__(self, name):
        return getattr(self.conn, name)


CONNECTS = []


class _SpySqldb:
    def __getattr__(self, name):
        if name == "connect":
            CONNECTS.append(1)
            return lambda: _Spy(_real_connect())
        return getattr(sqldb, name)


store_mod.sqldb = _SpySqldb()
r = c.post("/v1/line/events", json={"kind": "step.done", "project": "alpha", "body": {"spy": 1}}, headers=as_("sp"))
store_mod.sqldb = sqldb
lock_at = next((i for i, s in enumerate(LOG) if s.startswith("UPDATE kh_counter")), None)
H.check("LOCK: one append takes ONE store connection (the clock is read inside the insert transaction)",
        len(CONNECTS) == 1 and LOG[0].startswith("SELECT"), (len(CONNECTS), LOG[:2]))
H.check("LOCK: the duplicate-id check runs before the counter row is locked", r.status_code == 200
        and lock_at is not None and any(s.startswith("SELECT id, seq FROM kh_event") for s in LOG[:lock_at]), LOG)
H.check("LOCK: while the counter row is locked only its SELECT and the INSERT run",
        lock_at is not None and len(LOG) - lock_at - 1 == 2 and LOG[lock_at + 1].startswith("SELECT n FROM kh_counter")
        and LOG[lock_at + 2].startswith("INSERT INTO kh_event"), LOG[lock_at:] if lock_at is not None else LOG)
with sqldb.connect() as conn:
    top0 = sqldb.counter_get(conn, "ev:line")
res = H.race(6, lambda i: c.post("/v1/line/events", json={"id": "same-id-race", "kind": "step.done", "project": "alpha",
                                                          "body": {"i": i}}, headers=as_(f"sr{i}")).json())
acc = [x["accepted"][0] for x in res]
H.check("RACE same id: 6 appends -> one stored, five duplicates, all with the same seq",
        sum(1 for a in acc if not a["duplicate"]) == 1 and len({a["seq"] for a in acc}) == 1, acc)
with sqldb.connect() as conn:
    after = [r[0] for r in conn.execute("SELECT seq FROM kh_event WHERE ns='line' AND seq>? ORDER BY seq", [top0])]
    top1 = sqldb.counter_get(conn, "ev:line")
H.check("RACE same id: no seq burned by the losers (gapless, counter = last seq; the rest are kh.duplicate)",
        after == list(range(top0 + 1, top1 + 1)) and len(after) == 1 + 5, (top0, top1, after))
r = c.post("/v1/line/events", json={"events": [{"id": "twin-1", "kind": "step.done", "project": "alpha", "body": {}},
                                               {"id": "twin-1", "kind": "step.done", "project": "alpha", "body": {}}]},
           headers=as_("sr"))
a0, a1 = r.json()["accepted"]
H.check("an id repeated inside one batch is stored once; the repeat is a duplicate with the same seq",
        r.status_code == 200 and not a0["duplicate"] and a1["duplicate"] and a1["seq"] == a0["seq"], r.text)

# ── 8. removal guarded by usage ──────────────────────────────────────────────
less = {**MAN, "types": [t for t in MAN["types"] if t["type"] != "step.done"]}
r = c.put("/v1/line/manifest", json=less, headers={**OWNER, "If-Match": '"1"'})
H.check("a kind with events cannot be removed without ?archive=true", r.status_code == 409
        and r.json()["error"] == "type_in_use", r.text)

# ── a buffered namespace (KH_EVENTS_BUFFERED_NS, app/eventing/queue.py) ──────────
import os  # noqa: E402

from app.eventing import queue as event_queue  # noqa: E402

mq = event_queue.MemoryQueue(flush_s=60)            # no writer thread: the test drains it by hand
event_queue.set_buffer(mq)
os.environ["KH_EVENTS_BUFFERED_NS"] = "line"
r = c.post("/v1/line/events", json={"id": "queued-1", "kind": "step.done", "project": "alpha", "body": {"q": 1}},
           headers=as_("a1"))
acc = (r.json().get("accepted") or [{}])[0] if r.status_code == 202 else {}
H.check("BUFFERED: an unfenced event of a buffered namespace is queued (202, no seq yet)",
        r.status_code == 202 and acc.get("queued") is True and acc.get("seq") is None and mq.depth() == 1, r.text)
H.check("BUFFERED: it is not readable before the writer runs", "queued-1" not in [
    e["id"] for e in c.get("/v1/line/events?limit=1000", headers=OWNER).json()["events"]])
H.check("BUFFERED: the writer stores it", mq.flush_once() == 1 and "queued-1" in [
    e["id"] for e in c.get("/v1/line/events?limit=1000", headers=OWNER).json()["events"]])
os.environ.pop("KH_EVENTS_BUFFERED_NS")
event_queue.set_buffer(None)
r = c.post("/v1/line/events", json={"id": "direct-again", "kind": "step.done", "project": "alpha", "body": {}},
           headers=as_("a1"))
H.check("BUFFERED: off again, the answer carries the seq", r.status_code == 200
        and isinstance(r.json()["accepted"][0]["seq"], int), r.text)

H.done()
