"""Contract test: phase 4 of docs/roadmap-e-to-5-design.md (slice S9) - approval-gated high-risk effects
(app/caps/coord.py) and the global agent stop / resume (app/caps/lifecycle.py).

  1. Approval gate: off without settings.effects (KH_EFFECT_APPROVAL=manifest default), 428 approval_required on
     a high-risk key until a listed human confirmer approves, non-confirmers refused (agent, unlisted person,
     unlisted owner), reject keeps 428, every decision is a kh.approval revision plus kh.intervention, a confirmer
     removed from the policy no longer counts, '*' gates every key, KH_EFFECT_APPROVAL=on|off, a manifest cannot
     declare kh.approval.
  2. Global stop: maintainer only; one transaction suspends every active namespace but kh_people, saves
     stopped_from and fences every lease; RACES: two stops (no namespace stopped twice) and a stop against
     writes on a second app instance; every write answers 423 within 5 s on both instances (one of them with a
     stale state cache); reads still work.
  3. Resume: maintainer only; restores exactly the namespaces the stop suspended (a namespace suspended by hand
     stays suspended), clears stopped_from; afterwards a write fenced at the pre-stop epoch is 409 stale_epoch and
     a renew is 409 lease_lost.

    .venv\\Scripts\\python tests\\caps\\test_phase4.py
"""
import json
import os
import time

from harness import H

from fastapi.testclient import TestClient

from app import sqldb
from app.caps import core, registry
from app.caps.core import Caller

c = H.client()
c2 = TestClient(H.app())                       # a second app instance on the same database
OWNER = H.person("olga@x.io", owner=["alpha"])
UPD = {**OWNER, "If-Match": "*"}                # manifest updates need If-Match
MAINT = H.person("fen@x.io", maintainer=True)
CONF = H.person("cora@x.io", member=["alpha"])
NOBODY = H.person("nina@x.io", member=["alpha"])


def as_(principal, role="agent"):
    return {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service") if p else None


core.CALLER_RESOLVERS.insert(0, _test_resolver)

TYPES = [{"type": "unit.write", "kind_of": "event", "fenced": True}, {"type": "note", "kind_of": "event"}]
GATED = {"types": TYPES, "settings": {"effects": {"confirm_policy": {"emails": ["Cora@x.io"]}}}}
for ns in ("acme", "beta", "gamma", "delta"):
    r = c.put(f"/v1/admin/ns/{ns}", json={"projects": ["alpha"]}, headers=OWNER)
    assert r.status_code == 201, r.text
c.put("/v1/acme/manifest", headers=OWNER, json=GATED)
c.put("/v1/beta/manifest", headers=OWNER, json={"types": TYPES})
c.put("/v1/gamma/manifest", headers=OWNER, json={"types": TYPES})
c.put("/v1/delta/manifest", headers=OWNER, json={"types": TYPES, "settings": {"effects": {
    "approval_required": ["*"], "confirm_policy": {"emails": ["cora@x.io"]}}}})
with sqldb.connect() as conn:                  # kh_people as KH's people module attaches it (exempt from a stop)
    row = dict(conn.execute("SELECT * FROM kh_ns WHERE ns='beta'").fetchone())
    row["ns"] = "kh_people"
    sqldb.insert_new(conn, "kh_ns", row)
registry.invalidate()


def kh_events(ns, kind):
    with sqldb.connect() as conn:
        return [json.loads(r["body_json"]) for r in conn.execute(
            "SELECT body_json FROM kh_event WHERE ns=? AND kind=? ORDER BY seq", [ns, kind]).fetchall()]


def claim(ns, key, who="a1", client=c):
    return client.post(f"/v1/{ns}/effects/{key}:claim", json={"ttl_s": 60}, headers=as_(who))


def approve(ns, key, headers, decision="approve"):
    return c.post(f"/v1/{ns}/effects/{key}:approve", json={"decision": decision, "note": "looked at it"},
                  headers=headers)


def state_of(ns):
    with sqldb.connect() as conn:
        r = conn.execute("SELECT state, config_json FROM kh_ns WHERE ns=?", [ns]).fetchone()
    return r["state"], json.loads(r["config_json"] or "{}")


# ── 1. approval-gated high-risk effects ──────────────────────────────────────
r = claim("beta", "merge/pr-1")
H.check("OFF BY DEFAULT: no settings.effects -> a merge/ key is claimed without approval", r.status_code == 201, r.text)
r = claim("acme", "merge/pr-7")
H.check("a high-risk key (default prefix merge/) is 428 approval_required", r.status_code == 428
        and r.json()["error"] == "approval_required" and r.json()["approval"] is None, r.text)
for key in ("delete/row-1", "deploy/prod-eu", "send/external/mail-3"):
    r = claim("acme", key)
    H.check(f"default prefix gates {key}", r.status_code == 428, r.text)
r = claim("acme", "notes/x")
H.check("a low-risk key is claimed without approval", r.status_code == 201, r.text)
r = c.get("/v1/acme/effects/merge/pr-7", headers=as_("a1"))
H.check("GET shows an unclaimed gated effect with approval_required", r.status_code == 200
        and r.json()["approval_required"] is True and r.json()["state"] == "unclaimed", r.text)
r = approve("acme", "merge/pr-7", as_("a1"))
H.check("an agent cannot approve (403)", r.status_code == 403, r.text)
r = approve("acme", "merge/pr-7", as_("conf-bot", "confirmer"))
H.check("a confirmer principal (not a person) cannot approve (403)", r.status_code == 403, r.text)
r = approve("acme", "merge/pr-7", NOBODY)
H.check("a person not listed in confirm_policy cannot approve (403)", r.status_code == 403, r.text)
r = approve("acme", "merge/pr-7", OWNER)
H.check("the namespace owner, not listed in confirm_policy, cannot approve (403)", r.status_code == 403, r.text)
H.check("refused approvals write no kh.intervention", kh_events("acme", "kh.intervention") == [])
r = c.post("/v1/acme/effects/merge/pr-7:approve", json={"decision": "maybe"}, headers=CONF)
H.check("an unknown decision is 422", r.status_code == 422, r.text)
r = approve("acme", "merge/pr-7", CONF, "reject")
H.check("the listed confirmer records a reject (201, kh.approval rev 1)", r.status_code == 201
        and r.json()["type"] == "kh.approval" and r.json()["rev"] == 1 and r.json()["decision"] == "reject"
        and r.json()["approver"] == "cora@x.io", r.text)
r = claim("acme", "merge/pr-7")
H.check("after a reject the claim is still 428 with the decision", r.status_code == 428
        and r.json()["approval"]["decision"] == "reject", r.text)
r = approve("acme", "merge/pr-7", CONF)
H.check("the confirmer approves (200, rev 2)", r.status_code == 200 and r.json()["rev"] == 2
        and r.json()["state"] == "approved", r.text)
r = c.post("/v1/acme/effects/merge/pr-7:claim", json={"ttl_s": 60}, headers=CONF)
H.check("a confirmer person still cannot claim effects (403)", r.status_code == 403, r.text)
r = claim("acme", "merge/pr-7")
H.check("after approval the agent claims the effect (201)", r.status_code == 201 and r.json()["holder"] == "a1", r.text)
r = claim("acme", "merge/pr-7", "a2")
H.check("the ledger still allows one claimant (409 effect_claimed)", r.status_code == 409
        and r.json()["error"] == "effect_claimed", r.text)
ev = kh_events("acme", "kh.intervention")
H.check("each decision wrote kh.intervention (reject, approve)", [e["decision"] for e in ev] == ["reject", "approve"]
        and all(e["approver"] == "cora@x.io" and e["effect_key"] == "merge/pr-7" and e["kind"] == "approval"
                for e in ev), ev)
with sqldb.connect() as conn:
    revs = conn.execute("SELECT rev, state FROM kh_record_rev WHERE ns='acme' AND type='kh.approval' ORDER BY rev"
                        ).fetchall()
    actor = json.loads(conn.execute("SELECT actor_json FROM kh_record WHERE ns='acme' AND type='kh.approval'"
                                    ).fetchone()[0])
H.check("both decisions are kept as kh.approval revisions", [(x[0], x[1]) for x in revs]
        == [(1, "rejected"), (2, "approved")], [tuple(x) for x in revs])
H.check("the approval record is stamped with the human writer", actor.get("principal") == "cora@x.io", actor)
r = c.get("/v1/acme/effects/merge/pr-7", headers=as_("a1"))
H.check("GET shows the claimed effect and its approval", r.json().get("state") == "claimed"
        and r.json()["approval"]["decision"] == "approve", r.text)

approve("acme", "delete/old", CONF)
r = c.put("/v1/acme/manifest", headers=UPD, json={**GATED, "settings": {"effects": {"confirm_policy": {"emails": []}}}})
assert r.status_code == 200, r.text
registry.invalidate()
r = claim("acme", "delete/old")
H.check("an approval whose approver left confirm_policy no longer counts (428)", r.status_code == 428, r.text)
c.put("/v1/acme/manifest", headers=UPD, json=GATED)
registry.invalidate()
r = claim("acme", "delete/old")
H.check("restored to the policy, the approval counts again (201)", r.status_code == 201, r.text)

r = claim("delta", "anything/at-all")
H.check("SHADOW: approval_required ['*'] gates every key", r.status_code == 428, r.text)
os.environ["KH_EFFECT_APPROVAL"] = "on"
r = claim("beta", "deploy/prod-1")
H.check("KH_EFFECT_APPROVAL=on gates a namespace without settings.effects (default prefixes)",
        r.status_code == 428, r.text)
r = claim("beta", "notes/y")
H.check("... but not its low-risk keys", r.status_code == 201, r.text)
os.environ["KH_EFFECT_APPROVAL"] = "off"
r = claim("acme", "merge/pr-9")
H.check("KH_EFFECT_APPROVAL=off switches the gate off", r.status_code == 201, r.text)
os.environ.pop("KH_EFFECT_APPROVAL")
r = c.put("/v1/acme/manifest", headers=UPD, json={"types": TYPES + [{"type": "kh.approval", "kind_of": "record"}],
                                                    "settings": GATED["settings"]})
H.check("a manifest cannot declare the kh.approval type (no forged approvals)", r.status_code == 422
        and "kh. prefix is reserved" in r.text, r.text)
res = H.race(4, lambda i: approve("acme", "merge/race", CONF).status_code)
with sqldb.connect() as conn:
    n = conn.execute("SELECT rev FROM kh_record WHERE ns='acme' AND type='kh.approval' AND id=?",
                     ["ap-" + __import__("hashlib").sha256(b"merge/race").hexdigest()]).fetchone()[0]
H.check("RACE: 4 concurrent approvals -> one record, 4 revisions", sorted(res) == [200, 200, 200, 201] and n == 4,
        (res, n))

# ── 2. global stop ───────────────────────────────────────────────────────────
r = c.post("/v1/admin/ns/gamma:suspend", headers=OWNER)
H.check("gamma is suspended by hand before the stop", r.status_code == 200 and r.json()["state"] == "suspended", r.text)
r = c.post("/v1/acme/leases/unit/1:acquire", json={"ttl_s": 60}, headers=as_("a1"))
EP = r.json()["epoch"]
F_OLD = {"X-KH-Lease": "unit/1", "X-KH-Epoch": str(EP)}
r = c.post("/v1/acme/events", json={"kind": "unit.write", "body": {"n": 1}}, headers={**as_("a1"), **F_OLD})
H.check("before the stop a fenced write at the lease epoch is accepted", r.status_code == 200, r.text)
c2.post("/v1/beta/events", json={"kind": "note", "body": {}}, headers=as_("a1"))     # warm instance 2

for who, h in (("owner", OWNER), ("member", NOBODY), ("agent token", as_("a1"))):
    r = c.post("/v1/admin/agents:stop", headers=h)
    H.check(f"agents:stop by a {who} is 403", r.status_code == 403, r.text)
H.check("a refused stop changed nothing", state_of("acme")[0] == "active")

stale = registry.ns_state("acme")              # instance 2 still holds the 'active' row it read before the stop


def stop_or_write(i):
    if i < 2:
        r = c.post("/v1/admin/agents:stop", headers=MAINT)
        return ("stop", r.status_code, r.json())
    r = c2.post("/v1/beta/events", json={"kind": "note", "body": {"i": i}}, headers=as_("a1"))
    return ("write", r.status_code, None)


t0 = time.monotonic()
out = H.race(6, stop_or_write)
stops = [x for x in out if x[0] == "stop"]
stopped = [ns for s in stops for ns in s[2]["stopped"]]
H.check("RACE: both stops answer 200", [s[1] for s in stops] == [200, 200], stops)
H.check("RACE: every active namespace is stopped exactly once", sorted(stopped) == ["acme", "beta", "delta"],
        stopped)
H.check("RACE: writes racing the stop answer 200 or 423 only",
        all(x[1] in (200, 423) for x in out if x[0] == "write"), out)
registry._cache[(sqldb.location(), "acme")] = (time.monotonic() + registry.CACHE_S, stale)   # stale instance

st, cfg = state_of("acme")
H.check("acme is suspended with stopped_from=active", st == "suspended" and cfg.get("stopped_from") == "active"
        and cfg.get("stopped_by") == "fen@x.io", (st, cfg))
H.check("kh_people is exempt (still active)", state_of("kh_people")[0] == "active")
H.check("gamma (suspended by hand) carries no stopped_from", "stopped_from" not in state_of("gamma")[1])
H.check("the stop reports gamma as already suspended", any("gamma" in s[2]["already_suspended"] for s in stops),
        stops)
with sqldb.connect() as conn:
    lease = conn.execute("SELECT epoch, holder FROM kh_lease WHERE ns='acme' AND name='unit/1'").fetchone()
H.check("every lease is fenced: epoch bumped, holder cleared", lease["epoch"] == EP + 1 and lease["holder"] is None,
        dict(lease))


def until_423(client, ns, limit_s=5.0):
    start = time.monotonic()
    while time.monotonic() - start < limit_s + 1:
        r = client.post(f"/v1/{ns}/events", json={"kind": "note", "body": {}}, headers=as_("a1"))
        if r.status_code == 423:
            return time.monotonic() - t0
        time.sleep(0.1)
    return None


for name, client in (("instance 1", c), ("instance 2", c2)):
    for ns in ("acme", "beta", "delta"):
        took = until_423(client, ns)
        H.check(f"{name}: an agent write to {ns} answers 423 within 5 s of the stop", took is not None and took <= 5.0,
                took)
r = c2.post("/v1/acme/effects/notes/z:claim", json={"ttl_s": 60}, headers=as_("a1"))
H.check("an effect claim is 423 ns_suspended during the stop", r.status_code == 423
        and r.json()["error"] == "ns_suspended", r.text)
r = c2.post("/v1/acme/leases/unit/1:renew", json={"epoch": EP, "ttl_s": 60}, headers=as_("a1"))
H.check("a lease renew is 423 during the stop", r.status_code == 423, r.text)
r = c2.get("/v1/acme/effects/merge/pr-7", headers=as_("a1"))
H.check("reads still work during the stop", r.status_code == 200, r.text)
ns_ev = [e for e in kh_events(sqldb.KH_NS, "kh.ns_state") if e.get("reason") == "agents:stop"]
H.check("kh.ns_state (reason agents:stop) once per stopped namespace in _kh",
        sorted(e["ns"] for e in ns_ev) == ["acme", "beta", "delta"], ns_ev)
r = c.post("/v1/admin/agents:stop", headers=MAINT)
H.check("a second stop is a no-op", r.status_code == 200 and r.json()["stopped"] == [], r.text)

# ── 3. resume ────────────────────────────────────────────────────────────────
r = c.post("/v1/admin/agents:resume", headers=OWNER)
H.check("agents:resume by an owner is 403", r.status_code == 403, r.text)
r = c.post("/v1/admin/agents:resume", headers=MAINT)
H.check("resume restores exactly the stopped namespaces", r.status_code == 200
        and sorted(r.json()["resumed"]) == ["acme", "beta", "delta"], r.text)
H.check("states restored, stopped_from cleared", all(state_of(ns)[0] == "active" and "stopped_from" not in
                                                     state_of(ns)[1] for ns in ("acme", "beta", "delta")))
H.check("gamma, suspended by hand, stays suspended", state_of("gamma")[0] == "suspended")
H.check("kh_people untouched", state_of("kh_people")[0] == "active")
registry.invalidate()
r = c2.post("/v1/beta/events", json={"kind": "note", "body": {}}, headers=as_("a1"))
H.check("writes work again after resume", r.status_code == 200, r.text)
r = c.post("/v1/acme/events", json={"kind": "unit.write", "body": {"n": 2}}, headers={**as_("a1"), **F_OLD})
H.check("STALE EPOCH: a write fenced at the pre-stop epoch is 409 stale_epoch", r.status_code == 409
        and r.json()["error"] == "stale_epoch", r.text)
r = c.post("/v1/acme/leases/unit/1:renew", json={"epoch": EP, "ttl_s": 60}, headers=as_("a1"))
H.check("a renew at the pre-stop epoch is 409 lease_lost", r.status_code == 409 and r.json()["error"] == "lease_lost",
        r.text)
r = c.post("/v1/acme/leases/unit/1:acquire", json={"ttl_s": 60}, headers=as_("a1"))
ep2 = r.json().get("epoch")
r = c.post("/v1/acme/events", json={"kind": "unit.write", "body": {"n": 3}},
           headers={**as_("a1"), "X-KH-Lease": "unit/1", "X-KH-Epoch": str(ep2)})
H.check("a re-acquired lease (new epoch) writes again", ep2 is not None and ep2 > EP and r.status_code == 200, r.text)
r = c.post("/v1/admin/agents:resume", headers=MAINT)
H.check("a second resume is a no-op", r.status_code == 200 and r.json()["resumed"] == [], r.text)

H.done()
