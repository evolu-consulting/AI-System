"""Contract test: app/caps/coord.py and the core helpers (stage F4).

  1. Leases over HTTP: acquire / renew / release, 409 lease_held with the holder, 409 lease_lost (+ kh.lease_lost)
     after a steal, names with slashes, TTL bounds, prefix listing, role check.
  2. Fencing: a write carrying a stale X-KH-Epoch is 409 stale_epoch and writes kh.stale_epoch.
  3. Idempotency-Key: replay (same status and body, Idempotent-Replay header, kh.duplicate), 422
     idempotency_mismatch, 409 in_progress with Retry-After, take-over of a pending row older than 60 s.
  4. Effects ledger: first claim 201, others 409 with the recorded state, complete/fail by the holder only,
     re-claim after fail or claim expiry.
  5. If-Match helper (cas_update): 409 write_conflict with the current row and kh.write_conflict.
  6. RACES (threads, one connection each): lease acquire, effect claim, idempotent request, If-Match update.
  7. Rate quota: 429 quota with Retry-After and a kh.quota event.

    .venv\\Scripts\\python tests\\caps\\test_coord.py
"""
from harness import H

from app import sqldb
from app.caps import core, registry
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha"])


def as_(principal, role="agent"):
    """Headers acting as a namespace principal (test resolver, see below)."""
    return {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service") if p else None


core.CALLER_RESOLVERS.append(_test_resolver)

c.put("/v1/admin/ns/acme", json={"projects": ["alpha"]}, headers=OWNER)
c.put("/v1/acme/manifest", headers=OWNER, json={
    "types": [{"type": "unit.write", "kind_of": "event", "fenced": True},
              {"type": "note", "kind_of": "event"}]})


def kh_events(kind):
    with sqldb.connect() as conn:
        return [r["body_json"] for r in conn.execute("SELECT body_json FROM kh_event WHERE ns='acme' AND kind=?",
                                                     [kind]).fetchall()]


# ── 1. leases ────────────────────────────────────────────────────────────────
r = c.post("/v1/acme/leases/unit/42:acquire", json={"ttl_s": 30}, headers=as_("a1"))
H.check("acquire a lease whose name has a slash", r.status_code == 200 and r.json()["epoch"] == 1
        and r.json()["name"] == "unit/42", r.text)
r = c.post("/v1/acme/leases/unit/42:acquire", json={"ttl_s": 30}, headers=as_("a2"))
H.check("a second principal gets 409 lease_held with the holder", r.status_code == 409
        and r.json()["error"] == "lease_held" and r.json()["holder"] == "a1", r.text)
r = c.post("/v1/acme/leases/unit/42:renew", json={"epoch": 1, "ttl_s": 30}, headers=as_("a1"))
H.check("the holder renews", r.status_code == 200 and r.json()["epoch"] == 1, r.text)
r = c.post("/v1/acme/leases/unit/42:acquire", json={"ttl_s": 1}, headers=as_("a1"))
H.check("TTL below 5 s is refused", r.status_code == 422, r.text)
r = c.post("/v1/acme/leases/unit/42:frobnicate", json={}, headers=as_("a1"))
H.check("an unknown lease action is 404", r.status_code == 404, r.text)
r = c.post("/v1/acme/leases/unit/42:acquire", json={}, headers=as_("d1", "distiller"))
H.check("a role without lease rights gets 403", r.status_code == 403, r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_lease SET until_ms = 0 WHERE ns='acme' AND name='unit/42'")      # a1 stalls
r = c.post("/v1/acme/leases/unit/42:acquire", json={"ttl_s": 30}, headers=as_("a2"))
H.check("after expiry another principal takes it at epoch 2", r.status_code == 200 and r.json()["epoch"] == 2, r.text)
r = c.post("/v1/acme/leases/unit/42:renew", json={"epoch": 1, "ttl_s": 30}, headers=as_("a1"))
H.check("the old holder's renew is 409 lease_lost", r.status_code == 409 and r.json()["error"] == "lease_lost", r.text)
H.check("losing a lease writes kh.lease_lost", len(kh_events("kh.lease_lost")) == 1, kh_events("kh.lease_lost"))
r = c.get("/v1/acme/leases?prefix=unit/", headers=as_("a2"))
H.check("list by prefix", [x["name"] for x in r.json()["leases"]] == ["unit/42"], r.text)
r = c.get("/v1/acme/leases/unit/42", headers=as_("a2"))
H.check("get one lease", r.json()["holder"] == "a2" and r.json()["held"], r.text)

# ── 2. fencing ───────────────────────────────────────────────────────────────
ev = {"kind": "unit.write", "body": {"x": 1}}
r = c.post("/v1/acme/events", json=ev, headers=as_("a1"))
H.check("a fenced kind without lease headers is 428", r.status_code == 428, r.text)
r = c.post("/v1/acme/events", json=ev, headers={**as_("a1"), "X-KH-Lease": "unit/42", "X-KH-Epoch": "1"})
H.check("a write with the stale epoch is 409 stale_epoch", r.status_code == 409 and r.json()["error"] == "stale_epoch"
        and r.json()["current_epoch"] == 2, r.text)
H.check("the stale write wrote kh.stale_epoch and stored nothing", len(kh_events("kh.stale_epoch")) == 1
        and c.get("/v1/acme/events?kind=unit.write", headers=OWNER).json()["events"] == [])
r = c.post("/v1/acme/events", json=ev, headers={**as_("a2"), "X-KH-Lease": "unit/42", "X-KH-Epoch": "2"})
H.check("the current holder's epoch is accepted", r.status_code == 200 and r.json()["accepted"][0]["seq"] > 0, r.text)
r = c.post("/v1/acme/leases/unit/42:release", json={"epoch": 2}, headers=as_("a2"))
H.check("release", r.status_code == 200 and r.json()["released"], r.text)
r = c.post("/v1/acme/events", json=ev, headers={**as_("a2"), "X-KH-Lease": "unit/42", "X-KH-Epoch": "2"})
H.check("after release the epoch no longer fences in", r.status_code == 409, r.text)

# ── 3. idempotency ───────────────────────────────────────────────────────────
note = {"kind": "note", "body": {"n": 1}}
k = {**as_("a1"), "Idempotency-Key": "k-1"}
r1 = c.post("/v1/acme/events", json=note, headers=k)
r2 = c.post("/v1/acme/events", json=note, headers=k)
H.check("a repeat with the same key replays the first response", r1.status_code == r2.status_code == 200
        and r1.json() == r2.json() and r2.headers.get("idempotent-replay") == "true", (r1.text, r2.text))
H.check("the replay stored nothing new", len(c.get("/v1/acme/events?kind=note", headers=OWNER).json()["events"]) == 1)
H.check("the replay wrote kh.duplicate", len(kh_events("kh.duplicate")) >= 1)
r = c.post("/v1/acme/events", json={"kind": "note", "body": {"n": 2}}, headers=k)
H.check("the same key with another body is 422 idempotency_mismatch", r.status_code == 422
        and r.json()["error"] == "idempotency_mismatch", r.text)
r = c.post("/v1/acme/events", json=note, headers={**as_("a2"), "Idempotency-Key": "k-1"})
H.check("keys are per principal", r.status_code == 200 and r.headers.get("idempotent-replay") is None, r.text)
with sqldb.connect() as conn:
    now = sqldb.now_ms(conn)
    conn.execute("INSERT INTO kh_idem VALUES ('acme','a1','k-pending','x','pending',NULL,NULL,?,?)", [now, now])
import hashlib  # noqa: E402
body_bytes = b'{"kind":"note","body":{"n":3}}'
hsh = hashlib.sha256(b"POST /v1/acme/events?\n" + body_bytes).hexdigest()
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_idem SET request_sha256=? WHERE idem_key='k-pending'", [hsh])
hdr = {**as_("a1"), "Idempotency-Key": "k-pending", "Content-Type": "application/json"}
r = c.post("/v1/acme/events", content=body_bytes, headers=hdr)
H.check("while the first call is pending: 409 in_progress with Retry-After: 1", r.status_code == 409
        and r.json()["error"] == "in_progress" and r.headers.get("retry-after") == "1", r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_idem SET updated_ms = updated_ms - 61000 WHERE idem_key='k-pending'")
r = c.post("/v1/acme/events", content=body_bytes, headers=hdr)
H.check("a pending row older than 60 s is taken over", r.status_code == 200 and r.json()["accepted"], r.text)
r = c.post("/v1/acme/events", json={"kind": "nope"}, headers={**as_("a1"), "Idempotency-Key": "k-bad"})
r2 = c.post("/v1/acme/events", json={"kind": "nope"}, headers={**as_("a1"), "Idempotency-Key": "k-bad"})
H.check("a 422 is stored and replayed too", r.status_code == r2.status_code == 422
        and r2.headers.get("idempotent-replay") == "true", (r.text, r2.headers))

# ── 4. effects ───────────────────────────────────────────────────────────────
r = c.post("/v1/acme/effects/deploy/7:claim", json={"ttl_s": 60}, headers=as_("a1"))
H.check("the first claim gets 201", r.status_code == 201 and r.json()["state"] == "claimed", r.text)
r = c.post("/v1/acme/effects/deploy/7:claim", json={}, headers=as_("a2"))
H.check("a second claim gets 409 with the recorded state", r.status_code == 409 and r.json()["error"] == "effect_claimed"
        and r.json()["effect"]["holder"] == "a1", r.text)
r = c.post("/v1/acme/effects/deploy/7:complete", json={"result": {"ok": True}}, headers=as_("a2"))
H.check("only the holder may complete", r.status_code == 409, r.text)
r = c.post("/v1/acme/effects/deploy/7:complete", json={"result": {"url": "u"}}, headers=as_("a1"))
H.check("the holder completes it", r.status_code == 200 and r.json()["state"] == "done", r.text)
r = c.post("/v1/acme/effects/deploy/7:claim", json={}, headers=as_("a2"))
H.check("a done effect stays done (409 with its result)", r.status_code == 409
        and r.json()["effect"]["result"] == {"url": "u"}, r.text)
c.post("/v1/acme/effects/mail/1:claim", json={}, headers=as_("a1"))
c.post("/v1/acme/effects/mail/1:fail", json={"error": "smtp down"}, headers=as_("a1"))
r = c.post("/v1/acme/effects/mail/1:claim", json={}, headers=as_("a2"))
H.check("a failed effect may be claimed again", r.status_code == 201 and r.json()["attempts"] == 2, r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_effect SET claimed_until_ms = 0 WHERE effect_key='mail/1'")
r = c.post("/v1/acme/effects/mail/1:claim", json={}, headers=as_("a3"))
H.check("an expired claim (crashed holder) may be claimed again", r.status_code == 201 and r.json()["holder"] == "a3",
        r.text)
H.check("get an effect", c.get("/v1/acme/effects/deploy/7", headers=as_("a1")).json()["state"] == "done")

# ── 5. If-Match helper ───────────────────────────────────────────────────────
with sqldb.connect() as conn:
    sqldb.create_table(conn, "demo_rec",
                       "CREATE TABLE IF NOT EXISTS demo_rec (ns TEXT, id TEXT, v TEXT, rev INTEGER, PRIMARY KEY (ns, id))",
                       "CREATE COLUMN TABLE demo_rec (ns NVARCHAR(32), id NVARCHAR(64), v NVARCHAR(64), rev BIGINT, "
                       "PRIMARY KEY (ns, id))")
    conn.execute("INSERT INTO demo_rec VALUES ('acme', 'r1', 'a', 1)")
with sqldb.connect() as conn:
    rev = core.cas_update(None, conn, "demo_rec", {"ns": "acme", "id": "r1"}, {"v": "b"}, 1)
H.check("cas_update with the right rev bumps it", rev == 2, rev)
try:
    with sqldb.connect() as conn:
        core.cas_update(None, conn, "demo_rec", {"ns": "acme", "id": "r1"}, {"v": "c"}, 1)
    H.check("cas_update with a stale rev is write_conflict", False)
except core.CapError as e:
    H.check("cas_update with a stale rev is write_conflict with the current rev and ETag", e.code == "write_conflict"
            and e.extra["current"]["rev"] == 2 and e.headers["ETag"] == '"2"', e.extra)
H.check("If-Match parsing", core.etag(5) == '"5"')


class _Req:
    def __init__(self, h): self.headers = h


try:
    core.require_if_match(_Req({}), {"type": "decision", "require_if_match": True})
    H.check("require_if_match refuses a missing If-Match", False)
except core.CapError as e:
    H.check("require_if_match refuses a missing If-Match with 428", e.status == 428)
H.check("If-Match W/ and quotes", core.if_match(_Req({"if-match": 'W/"7"'})) == 7)

# ── 6. races ─────────────────────────────────────────────────────────────────
res = H.race(6, lambda i: c.post("/v1/acme/leases/race/1:acquire", json={"ttl_s": 30}, headers=as_(f"r{i}")).status_code)
H.check("RACE: 6 concurrent acquires over HTTP -> one 200, five 409", sorted(res) == [200] + [409] * 5, res)
res = H.race(6, lambda i: c.post("/v1/acme/effects/pay/9:claim", json={}, headers=as_(f"r{i}")).status_code)
H.check("RACE: 6 concurrent effect claims -> one 201", sorted(res) == [201] + [409] * 5, res)
before = len(c.get("/v1/acme/events?kind=note&limit=1000", headers=OWNER).json()["events"])
res = H.race(5, lambda i: c.post("/v1/acme/events", json={"kind": "note", "body": {"race": True}},
                                 headers={**as_("rk"), "Idempotency-Key": "race-key"}).status_code)
after = len(c.get("/v1/acme/events?kind=note&limit=1000", headers=OWNER).json()["events"])
H.check("RACE: 5 concurrent requests with one Idempotency-Key store the event once", after - before == 1
        and set(res) <= {200, 409}, (res, after - before))
with sqldb.connect() as conn:
    conn.execute("UPDATE demo_rec SET rev=10 WHERE id='r1'")


def upd(i):
    try:
        with sqldb.connect() as conn:
            core.cas_update(None, conn, "demo_rec", {"ns": "acme", "id": "r1"}, {"v": f"w{i}"}, 10)
        return "ok"
    except core.CapError as e:
        return e.code


res = H.race(4, upd)
H.check("RACE: 4 If-Match updates on one rev -> one wins, three write_conflict",
        sorted(res) == ["ok", "write_conflict", "write_conflict", "write_conflict"], res)

# ── 7. rate quota ────────────────────────────────────────────────────────────
c.put("/v1/acme/manifest", headers={**OWNER, "If-Match": '"1"'}, json={
    "types": [{"type": "unit.write", "kind_of": "event", "fenced": True}, {"type": "note", "kind_of": "event"}],
    "quotas": [{"name": "requests_per_min_principal", "limit": 3, "window_s": 60}]})
registry.invalidate("acme")
codes = [c.get("/v1/acme/leases", headers=as_("q1")).status_code for _ in range(5)]
r = c.get("/v1/acme/leases", headers=as_("q1"))
H.check("the per-principal rate quota answers 429 quota with Retry-After", codes[:3] == [200] * 3
        and r.status_code == 429 and r.json()["error"] == "quota" and int(r.headers["retry-after"]) >= 1, (codes, r.text))
H.check("exceeding a quota writes kh.quota (throttled)", len(kh_events("kh.quota")) == 1, kh_events("kh.quota"))
H.check("another principal is not limited", c.get("/v1/acme/leases", headers=as_("q2")).status_code == 200)

H.done()
