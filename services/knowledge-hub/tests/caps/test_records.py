"""Contract test: app/caps/records.py (stage F6, typed records).

  1. Create with If-None-Match: * (201, ETag), duplicate 409 + kh.write_conflict, JSON Schema 422 with pointers,
     index fields promoted into ix_* columns, body size limit, bad ids.
  2. Revisions: If-Match update, 428 when the type requires If-Match, 409 write_conflict with the current record
     and ETag + kh.write_conflict, JSON merge patch, ?rev= and :revisions, final records are immutable.
  3. Per-type ACLs from the manifest: a registry type writable only by the namespace admin and read-only to
     agent / judge / distiller; the role matrix still applies (distiller and grader cannot write records).
  4. Fencing: a fenced type needs X-KH-Lease / X-KH-Epoch (428), a stale epoch is 409 stale_epoch + event.
  5. Idempotency-Key replay on PUT and PATCH.
  6. Query: where on index fields (eq/in/gte/lte), project grants, order, limit, decay weight by age,
     partition by a model-version field with per_partition, unknown fields 422.
  7. RACES (threads, one connection each): create, If-Match update, last-writer-wins PUT (no lost revision),
     PATCH without If-Match (internal CAS + retry: no lost field). 7b: redaction masks bodies and patches.
  8. Removing a record type that still has rows is 409 type_in_use.

    .venv\\Scripts\\python tests\\caps\\test_records.py
"""
from harness import H

import json

from app import sqldb
from app.caps import core
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha", "beta"])


def as_(principal, role="agent", projects=None):
    h = {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}
    if projects is not None:
        h["X-Test-Projects"] = ",".join(projects)
    return h


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    if not p:
        return None
    pr = request.headers.get("x-test-projects")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service",
                  projects=set(x for x in pr.split(",") if x) if pr is not None else None)


core.CALLER_RESOLVERS.append(_test_resolver)

DECISION_SCHEMA = {
    "type": "object", "required": ["case_kind", "model_id", "model_version", "options", "chosen"],
    "properties": {"case_kind": {"type": "string"}, "model_id": {"type": "string"},
                   "model_version": {"type": "string"}, "attribution": {"type": "string"},
                   "scored": {"type": "number"}, "decided_at": {"type": "integer"},
                   "features": {"type": "object"}, "options": {"type": "array"}, "chosen": {"type": "string"},
                   "expected": {}, "outcome": {}, "n": {"type": "integer"}, "tags": {"type": "object"}}}
MANIFEST = {
    "schemas": [{"name": "decision", "version": 1, "schema": DECISION_SCHEMA},
                {"name": "guard", "version": 1, "schema": {"type": "object", "required": ["pattern"]}}],
    "types": [
        {"type": "decision", "kind_of": "record", "schema": "decision", "require_if_match": True,
         "index_fields": {"case_kind": "s", "model_id": "s", "model_version": "s", "attribution": "s",
                          "scored": "n", "decided_at": "t"}},
        {"type": "guard", "kind_of": "record", "schema": "guard", "write_roles": ["admin"],
         "read_roles": ["agent", "judge", "distiller"], "index_fields": {"pattern": "s"}},
        {"type": "slot", "kind_of": "record", "fenced": True},
        {"type": "note", "kind_of": "record", "index_fields": {"topic": "s"}},
        {"type": "tick", "kind_of": "event"},
    ]}

r = c.put("/v1/admin/ns/acme", json={"projects": ["alpha", "beta"]}, headers=OWNER)
H.check("namespace attached", r.status_code in (200, 201), r.text)
r = c.put("/v1/acme/manifest", headers=OWNER, json=MANIFEST)
H.check("manifest with record types applied", r.status_code == 200, r.text)
r = c.get("/v1/capabilities", headers=OWNER)
H.check("records is listed in discovery", any(x["name"] == "records" for x in r.json()["capabilities"]), r.text)


def kh_events(kind):
    with sqldb.connect() as conn:
        return [json.loads(r["body_json"]) for r in conn.execute(
            "SELECT body_json FROM kh_event WHERE ns='acme' AND kind=?", [kind]).fetchall()]


def dec(**kw):
    d = {"case_kind": "triage", "model_id": "m", "model_version": "v1", "options": ["a", "b"], "chosen": "a"}
    d.update(kw)
    return d


URL = "/v1/acme/records/decision/"
CREATE = {"If-None-Match": "*"}

# ── 1. create ────────────────────────────────────────────────────────────────
r = c.put(URL + "d1?project=alpha", json=dec(decided_at=1000), headers={**as_("j1", "judge"), **CREATE})
H.check("create with If-None-Match: * is 201 with ETag 1", r.status_code == 201 and r.headers.get("etag") == '"1"'
        and r.json()["rev"] == 1 and r.json()["state"] == "open" and r.json()["project"] == "alpha", r.text)
H.check("the write is stamped with the actor", r.json()["actor"]["principal"] == "j1"
        and r.json()["actor"]["role"] == "judge", r.text)
with sqldb.connect() as conn:
    row = conn.execute("SELECT * FROM kh_record WHERE ns='acme' AND type='decision' AND id='d1'").fetchone()
H.check("index fields are promoted into ix_* columns", row["ix_s1"] is not None and "triage" in
        [row[x] for x in ("ix_s1", "ix_s2", "ix_s3", "ix_s4")] and row["ix_t1"] == 1000, dict(row))
r = c.put(URL + "d1?project=alpha", json=dec(), headers={**as_("j1", "judge"), **CREATE})
H.check("a second create is 409 duplicate with the ETag", r.status_code == 409 and r.json()["error"] == "duplicate"
        and r.headers.get("etag") == '"1"', r.text)
H.check("a duplicate create writes kh.write_conflict", any(e.get("reason") == "exists" for e in
                                                             kh_events("kh.write_conflict")), kh_events("kh.write_conflict"))
r = c.put(URL + "d2?project=alpha", json={"case_kind": 5}, headers={**as_("j1", "judge"), **CREATE})
H.check("a body that fails the schema is 422 with JSON pointers", r.status_code == 422
        and r.json()["error"] == "validation_failed" and any(e["pointer"] == "/case_kind" for e in r.json()["errors"]),
        r.text)
r = c.put(URL + "d2", json=dec(), headers={**as_("j1", "judge"), **CREATE})
H.check("a namespace with two projects needs ?project= on create", r.status_code == 422, r.text)
r = c.put(URL + "d2?project=gamma", json=dec(), headers={**as_("j1", "judge"), **CREATE})
H.check("a project outside the namespace is 403", r.status_code == 403, r.text)
r = c.put(URL + "bad%20id?project=alpha", json=dec(), headers={**as_("j1", "judge"), **CREATE})
H.check("an invalid id is 422", r.status_code == 422, r.text)
r = c.put("/v1/acme/records/note/big?project=alpha", json={"x": "y" * (257 * 1024)}, headers={**as_("a1"), **CREATE})
H.check("a body over 256 KB is 413", r.status_code == 413, r.text)
r = c.put("/v1/acme/records/nosuch/x?project=alpha", json={}, headers=as_("a1"))
H.check("an unknown type is 404", r.status_code == 404, r.text)
r = c.put("/v1/acme/records/tick/x?project=alpha", json={}, headers=as_("a1"))
H.check("an event kind is not a record type (422)", r.status_code == 422, r.text)

# ── 2. revisions ─────────────────────────────────────────────────────────────
r = c.put(URL + "d1", json=dec(chosen="b"), headers=as_("j1", "judge"))
H.check("an update without If-Match on a require_if_match type is 428", r.status_code == 428, r.text)
r = c.put(URL + "d1", json=dec(chosen="b", decided_at=1000), headers={**as_("j1", "judge"), "If-Match": '"1"'})
H.check("If-Match update is 200 with rev 2", r.status_code == 200 and r.json()["rev"] == 2
        and r.headers.get("etag") == '"2"' and r.json()["body"]["chosen"] == "b", r.text)
n_conf = len(kh_events("kh.write_conflict"))
r = c.put(URL + "d1", json=dec(chosen="a"), headers={**as_("j2", "judge"), "If-Match": '"1"'})
H.check("a stale If-Match is 409 write_conflict with the current record and ETag", r.status_code == 409
        and r.json()["error"] == "write_conflict" and r.json()["current"]["rev"] == 2
        and r.json()["current"]["body"]["chosen"] == "b" and r.headers.get("etag") == '"2"', r.text)
H.check("the conflict writes kh.write_conflict", len(kh_events("kh.write_conflict")) == n_conf + 1
        and kh_events("kh.write_conflict")[-1]["current_rev"] == 2, kh_events("kh.write_conflict"))
r = c.put(URL + "nope", json=dec(), headers={**as_("j1", "judge"), "If-Match": '"1"'})
H.check("If-Match on a missing record is 404", r.status_code == 404, r.text)
r = c.patch(URL + "d1", json={"outcome": {"ok": True}, "scored": 0.75, "attribution": "model"},
            headers={**as_("j1", "judge"), "If-Match": '"2"'})
H.check("merge patch fills in the scored outcome (rev 3)", r.status_code == 200 and r.json()["rev"] == 3
        and r.json()["body"]["scored"] == 0.75 and r.json()["body"]["chosen"] == "b", r.text)
r = c.patch(URL + "d1", json={"attribution": None}, headers={**as_("j1", "judge"), "If-Match": '"3"'})
H.check("merge patch null removes a field", r.status_code == 200 and "attribution" not in r.json()["body"], r.text)
r = c.patch(URL + "d1", json={"chosen": 7}, headers={**as_("j1", "judge"), "If-Match": '"4"'})
H.check("a patch that breaks the schema is 422", r.status_code == 422, r.text)
r = c.patch(URL + "d1", json={"chosen": "a"}, headers={**as_("j1", "judge"), "If-Match": '"2"'})
H.check("a stale patch is 409 write_conflict", r.status_code == 409 and r.json()["error"] == "write_conflict", r.text)
r = c.patch(URL + "d1", json={"chosen": "a"}, headers=as_("j1", "judge"))
H.check("a patch without If-Match on a require_if_match type is 428", r.status_code == 428, r.text)
r = c.get(URL + "d1?rev=1", headers=as_("j1", "judge"))
H.check("GET ?rev=1 returns the first revision", r.status_code == 200 and r.json()["rev"] == 1
        and r.json()["body"]["chosen"] == "a" and r.json()["current_rev"] == 4, r.text)
r = c.get(URL + "d1?rev=99", headers=as_("j1", "judge"))
H.check("an unknown revision is 404", r.status_code == 404, r.text)
r = c.get(URL + "d1:revisions", headers=as_("j1", "judge"))
H.check("every revision is kept", r.status_code == 200 and [x["rev"] for x in r.json()["revisions"]] == [1, 2, 3, 4],
        r.text)
r = c.get(URL + "d1", headers=as_("j1", "judge"))
H.check("GET returns the current record with its ETag", r.json()["rev"] == 4 and r.headers.get("etag") == '"4"',
        r.text)
r = c.patch(URL + "d1?state=final", json={}, headers={**as_("j1", "judge"), "If-Match": '"4"'})
H.check("a record can be made final", r.status_code == 200 and r.json()["state"] == "final", r.text)
r = c.patch(URL + "d1", json={"chosen": "a"}, headers={**as_("j1", "judge"), "If-Match": '"5"'})
H.check("a final record cannot be patched (409 record_final)", r.status_code == 409
        and r.json()["error"] == "record_final", r.text)
r = c.put(URL + "d1", json=dec(), headers={**as_("j1", "judge"), "If-Match": "*"})
H.check("a final record cannot be replaced (409 record_final)", r.status_code == 409
        and r.json()["error"] == "record_final", r.text)
r = c.put(URL + "d3?project=alpha&state=BAD", json=dec(), headers={**as_("j1", "judge"), **CREATE})
H.check("an invalid state is 422", r.status_code == 422, r.text)

# ── 3. per-type ACLs ─────────────────────────────────────────────────────────
G = "/v1/acme/records/guard/"
r = c.put(G + "g1?project=alpha", json={"pattern": "rm -rf"}, headers={**OWNER, **CREATE})
H.check("the namespace owner (admin) writes the guard registry", r.status_code == 201, r.text)
for role in ("agent", "judge", "orchestrator"):
    r = c.put(G + "g2?project=alpha", json={"pattern": "x"}, headers={**as_("p-" + role, role), **CREATE})
    H.check(f"{role} cannot write a write_roles:[admin] type (403)", r.status_code == 403, r.text)
r = c.patch(G + "g1", json={"pattern": "x"}, headers=as_("a1", "agent"))
H.check("agent cannot patch the guard registry either", r.status_code == 403, r.text)
for role in ("agent", "judge", "distiller"):
    r = c.get(G + "g1", headers=as_("p-" + role, role))
    H.check(f"{role} reads the guard registry", r.status_code == 200 and r.json()["body"]["pattern"] == "rm -rf",
            r.text)
r = c.post("/v1/acme/records/guard:query", json={}, headers=as_("d1", "distiller"))
H.check("distiller queries the guard registry", r.status_code == 200 and r.json()["count"] == 1, r.text)
r = c.get(G + "g1", headers=as_("o1", "orchestrator"))
H.check("a role outside read_roles cannot read it (403)", r.status_code == 403, r.text)
r = c.put("/v1/acme/records/note/n0?project=alpha", json={"topic": "t"}, headers={**as_("d1", "distiller"), **CREATE})
H.check("the role matrix still applies: distiller cannot write records", r.status_code == 403, r.text)
r = c.put("/v1/acme/records/note/n0?project=alpha", json={"topic": "t"}, headers={**as_("g1", "grader"), **CREATE})
H.check("grader cannot write records", r.status_code == 403, r.text)
r = c.get("/v1/acme/records/note/nothing", headers=as_("g1", "grader"))
H.check("grader may read records (404 for a missing one, not 403)", r.status_code == 404, r.text)

# ── 4. fencing ───────────────────────────────────────────────────────────────
S = "/v1/acme/records/slot/"
r = c.put(S + "s1?project=alpha", json={"v": 1}, headers=as_("a1"))
H.check("a fenced type without lease headers is 428", r.status_code == 428, r.text)
with sqldb.connect() as conn:
    H.check("... and nothing was stored", conn.execute("SELECT COUNT(*) FROM kh_record WHERE type='slot'"
                                                       ).fetchone()[0] == 0)
r = c.post("/v1/acme/leases/slot/s1:acquire", json={"ttl_s": 30}, headers=as_("a1"))
ep1 = r.json()["epoch"]
F1 = {"X-KH-Lease": "slot/s1", "X-KH-Epoch": str(ep1)}
r = c.put(S + "s1?project=alpha", json={"v": 1}, headers={**as_("a1"), **F1})
H.check("a fenced write with the current epoch is 201", r.status_code == 201, r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_lease SET until_ms = 0 WHERE ns='acme' AND name='slot/s1'")
r = c.post("/v1/acme/leases/slot/s1:acquire", json={"ttl_s": 30}, headers=as_("a2"))
H.check("another agent takes the lease at a higher epoch", r.status_code == 200 and r.json()["epoch"] > ep1, r.text)
n_stale = len(kh_events("kh.stale_epoch"))
r = c.put(S + "s1", json={"v": 2}, headers={**as_("a1"), **F1})
H.check("the zombie's write is 409 stale_epoch", r.status_code == 409 and r.json()["error"] == "stale_epoch", r.text)
H.check("stale_epoch writes kh.stale_epoch", len(kh_events("kh.stale_epoch")) == n_stale + 1)
r = c.get(S + "s1", headers=as_("a2"))
H.check("the fenced write was rolled back (rev 1, v 1, one revision)", r.json()["rev"] == 1
        and r.json()["body"]["v"] == 1 and len(c.get(S + "s1:revisions", headers=as_("a2")).json()["revisions"]) == 1,
        r.text)

# ── 5. idempotency ───────────────────────────────────────────────────────────
N = "/v1/acme/records/note/"
h = {**as_("a1"), **CREATE, "Idempotency-Key": "k-1"}
r1 = c.put(N + "n1?project=alpha", json={"topic": "x"}, headers=h)
r2 = c.put(N + "n1?project=alpha", json={"topic": "x"}, headers=h)
H.check("an idempotent create replays the same 201 body", r1.status_code == 201 and r2.status_code == 201
        and r2.json() == r1.json() and r2.headers.get("idempotent-replay") == "true", (r1.text, r2.text))
r = c.put(N + "n1?project=alpha", json={"topic": "y"}, headers=h)
H.check("the same key with another body is 422 idempotency_mismatch", r.status_code == 422
        and r.json()["error"] == "idempotency_mismatch", r.text)
hp = {**as_("a1"), "Idempotency-Key": "k-2"}
r1 = c.patch(N + "n1", json={"extra": 1}, headers=hp)
r2 = c.patch(N + "n1", json={"extra": 1}, headers=hp)
H.check("an idempotent patch runs once", r1.status_code == 200 and r2.json()["rev"] == r1.json()["rev"] == 2
        and c.get(N + "n1", headers=as_("a1")).json()["rev"] == 2, (r1.text, r2.text))
r = c.put(N + "n1", json={"topic": "z"}, headers=as_("a1"))
H.check("a type without require_if_match takes a last-writer-wins PUT", r.status_code == 200 and r.json()["rev"] == 3,
        r.text)
r = c.put(N + "n2?project=alpha", json={"topic": "z"}, headers=as_("a1"))
H.check("... and a PUT without headers on a new id creates it (201)", r.status_code == 201, r.text)

# ── 6. query ─────────────────────────────────────────────────────────────────
DAY = 86400000
with sqldb.connect() as conn:
    NOW = sqldb.now_ms(conn)
seed = [("q1", "v1", "alpha", 0.9, 0), ("q2", "v1", "alpha", 0.5, 10), ("q3", "v2", "alpha", 0.2, 20),
        ("q4", "v2", "beta", 0.7, 0), ("q5", "v3", "alpha", 0.1, 5)]
for rid, mv, proj, sc, age in seed:
    r = c.put(f"{URL}{rid}?project={proj}", json=dec(model_version=mv, scored=sc, case_kind="route",
                                                      decided_at=NOW - age * DAY), headers={**as_("j1", "judge"), **CREATE})
    assert r.status_code == 201, r.text
with sqldb.connect() as conn:
    for rid, _, _, _, age in seed:
        conn.execute("UPDATE kh_record SET created_ms=? WHERE ns='acme' AND type='decision' AND id=?",
                     [NOW - age * DAY, rid])
Q = "/v1/acme/records/decision:query"
r = c.post(Q, json={"where": {"case_kind": "route", "model_version": "v1"}}, headers=as_("j1", "judge"))
H.check("where on index fields", r.status_code == 200 and sorted(x["id"] for x in r.json()["records"]) == ["q1", "q2"],
        r.text)
r = c.post(Q, json={"where": {"case_kind": "route", "model_version": {"in": ["v2", "v3"]}}, "order": "id"},
           headers=as_("j1", "judge"))
H.check("in filter and order", [x["id"] for x in r.json()["records"]] == ["q3", "q4", "q5"], r.text)
r = c.post(Q, json={"where": {"case_kind": "route", "scored": {"gte": 0.5, "lte": 0.8}}, "order": "-scored"},
           headers=as_("j1", "judge"))
H.check("range filter on a numeric index field", [x["id"] for x in r.json()["records"]] == ["q4", "q2"], r.text)
r = c.post(Q, json={"where": {"case_kind": "route"}, "decay": {"field": "created_ms", "half_life_days": 10},
                    "order": "id"}, headers=as_("j1", "judge"))
w = {x["id"]: x["weight"] for x in r.json()["records"]}
H.check("decay weight = 0.5 ** (age_days / half_life)", abs(w["q1"] - 1) < 0.01 and abs(w["q2"] - 0.5) < 0.01
        and abs(w["q3"] - 0.25) < 0.01 and abs(w["q5"] - 0.7071) < 0.01, w)
r = c.post(Q, json={"where": {"case_kind": "route"}, "decay": {"field": "decided_at", "half_life_days": 20}},
           headers=as_("j1", "judge"))
H.check("decay on a time index field orders newest first by default", r.status_code == 200
        and r.json()["records"][-1]["id"] == "q3" and abs(r.json()["records"][-1]["weight"] - 0.5) < 0.01, r.text)
r = c.post(Q, json={"where": {"case_kind": "route"}, "partition_by": "model_version",
                    "decay": {"half_life_days": 10}}, headers=as_("j1", "judge"))
parts = {p["key"]: p for p in r.json()["partitions"]}
H.check("partition by model version with counts and weight sums", set(parts) == {"v1", "v2", "v3"}
        and parts["v1"]["n"] == 2 and abs(parts["v1"]["weight_sum"] - 1.5) < 0.01 and parts["v2"]["n"] == 2
        and all("partition" in x for x in r.json()["records"]), r.json()["partitions"])
r = c.post(Q, json={"where": {"case_kind": "route"}, "partition_by": "model_version", "per_partition": 1},
           headers=as_("j1", "judge"))
H.check("per_partition keeps the newest of each partition", r.json()["count"] == 3
        and all(p["n"] == 1 for p in r.json()["partitions"]), r.text)
r = c.post(Q, json={"where": {"case_kind": "route"}}, headers=as_("j9", "judge", projects=["alpha"]))
H.check("a caller granted only alpha does not see beta records", r.status_code == 200
        and "q4" not in [x["id"] for x in r.json()["records"]] and r.json()["count"] == 4, r.text)
r = c.get(URL + "q4", headers=as_("j9", "judge", projects=["alpha"]))
H.check("... and a beta record is 404 to that caller", r.status_code == 404, r.text)
r = c.post(Q, json={"where": {"case_kind": "route"}, "project": "beta"}, headers=as_("j1", "judge"))
H.check("filter by project", [x["id"] for x in r.json()["records"]] == ["q4"], r.text)
r = c.post(Q, json={"where": {"case_kind": "route"}, "limit": 2, "order": "id", "offset": 1},
           headers=as_("j1", "judge"))
H.check("limit and offset", [x["id"] for x in r.json()["records"]] == ["q2", "q3"], r.text)
r = c.post(Q, json={"where": {"chosen": "a"}}, headers=as_("j1", "judge"))
H.check("a non-index field is 422", r.status_code == 422, r.text)
r = c.post(Q, json={"where": {"scored": {"like": 1}}}, headers=as_("j1", "judge"))
H.check("an unknown operator is 422", r.status_code == 422, r.text)
r = c.post(Q, json={"decay": {"field": "model_version", "half_life_days": 3}}, headers=as_("j1", "judge"))
H.check("decay on a non-time field is 422", r.status_code == 422, r.text)
r = c.post(Q, json={"decay": {"half_life_days": 0}}, headers=as_("j1", "judge"))
H.check("decay with half_life_days 0 is 422", r.status_code == 422, r.text)
r = c.post(Q, json={"where": {"case_kind": "route"}, "state": "open"}, headers=as_("j1", "judge"))
H.check("filter by state", r.json()["count"] == 5 and r.json()["records"][0]["index"]["case_kind"] == "route", r.text)

# ── 7. races ─────────────────────────────────────────────────────────────────
res = H.race(6, lambda i: c.put(N + "race1?project=alpha", json={"topic": f"t{i}"},
                                headers={**as_(f"a{i}"), **CREATE}).status_code)
H.check("RACE create: one 201, five 409", sorted(res) == [201] + [409] * 5, res)
res = H.race(6, lambda i: c.put(N + "race1", json={"topic": f"u{i}"},
                                headers={**as_(f"a{i}"), "If-Match": '"1"'}).status_code)
H.check("RACE If-Match update: one 200, five 409", sorted(res) == [200] + [409] * 5, res)
res = H.race(6, lambda i: c.put(N + "race1", json={"topic": f"w{i}"}, headers=as_(f"a{i}")).status_code)
revs = c.get(N + "race1:revisions", headers=as_("a1")).json()["revisions"]
H.check("RACE last-writer-wins PUT: every write gets its own revision", res == [200] * 6
        and [x["rev"] for x in revs] == list(range(1, 9)), (res, [x["rev"] for x in revs]))
c.put(N + "race2?project=alpha", json={"topic": "p", "tags": {}}, headers={**as_("a1"), **CREATE})
res = H.race(6, lambda i: c.patch(N + "race2", json={"tags": {f"k{i}": i}}, headers=as_(f"a{i}")).status_code)
body = c.get(N + "race2", headers=as_("a1")).json()
H.check("RACE patch without If-Match: no field is lost", res == [200] * 6 and len(body["body"]["tags"]) == 6
        and body["rev"] == 7, (res, body))

# ── 7b. redaction write path (when app/caps/redact.py is installed) ──────────
try:
    from app.caps import redact as _redact_mod      # noqa: F401
    HAS_REDACT = True
except ImportError:
    HAS_REDACT = False
if HAS_REDACT:
    n_red = len(kh_events("kh.redacted"))
    r = c.put(N + "secret1?project=alpha", json={"topic": "mail me at ana.b@x.io please"},
              headers={**as_("a1"), **CREATE})
    H.check("REDACT: a record body is masked before storage", r.status_code == 201
            and r.json()["body"]["topic"] == "mail me at [REDACTED:email] please", r.text)
    r = c.patch(N + "secret1", json={"more": "c@d.io"}, headers=as_("a1"))
    with sqldb.connect() as conn:
        raw = " ".join(x[0] for x in conn.execute(
            "SELECT body_json FROM kh_record_rev WHERE ns='acme' AND type='note' AND id='secret1'").fetchall())
    H.check("REDACT: a merge patch is masked too, no revision holds the value", r.status_code == 200
            and r.json()["body"]["more"] == "[REDACTED:email]" and "x.io" not in raw and "d.io" not in raw, raw)
    H.check("REDACT: kh.redacted is written once per write", len(kh_events("kh.redacted")) == n_red + 2,
            kh_events("kh.redacted"))

# ── 8. type usage ────────────────────────────────────────────────────────────
m2 = {**MANIFEST, "types": [t for t in MANIFEST["types"] if t["type"] != "note"]}
etag = c.get("/v1/acme/manifest", headers=OWNER).headers["etag"]
r = c.put("/v1/acme/manifest", headers={**OWNER, "If-Match": etag}, json=m2)
H.check("removing a record type with rows is 409 type_in_use", r.status_code == 409
        and r.json()["error"] == "type_in_use", r.text)

H.done()
