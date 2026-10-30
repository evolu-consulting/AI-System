"""Contract test: app/caps/registry.py and discovery (stage F2).

  1. Attach: a maintainer or the owner of every named project attaches a namespace; a member cannot;
     reserved and malformed names are refused.
  2. Manifest: validated as a whole (schemas compile, limits, references), applied in one transaction,
     idempotent, If-Match on change (428 / 409), schema versions immutable, types with rows removed only
     with ?archive=true, everything stored (keyspaces, quotas, retention, redaction, vaults, subscriptions).
  3. State: detach -> 404 everywhere within the cache bound (KH_NS_CACHE_S, 1 s here; 5 s by default),
     suspend -> reads only (423), reattach; an unknown namespace is 404.
  4. Discovery: /v1/capabilities lists name + semver per loaded module; /v1/openapi.json holds /v1 only.
  5. RACE: two concurrent manifest applies with the same If-Match -> exactly one wins.

    .venv\\Scripts\\python tests\\caps\\test_registry.py
"""
import time

from harness import H

from app import sqldb
from app.caps import registry

c = H.client()
ROOT = H.person("root@x.io", maintainer=True)
OWNER = H.person("olga@x.io", owner=["alpha", "beta"])
MEMBER = H.person("max@x.io", member=["alpha"])

# ── 1. attach ────────────────────────────────────────────────────────────────
r = c.put("/v1/admin/ns/demo", json={"projects": ["alpha"], "display": "Demo engine"}, headers=MEMBER)
H.check("a member who does not own the project cannot attach", r.status_code == 403 and r.json()["error"] == "forbidden",
        r.text)
r = c.put("/v1/admin/ns/demo", json={"projects": ["alpha", "beta"], "display": "Demo engine"}, headers=OWNER)
H.check("the owner of every named project attaches a namespace (201, active)", r.status_code == 201
        and r.json()["state"] == "active" and r.json()["owner_email"] == "olga@x.io", r.text)
r = c.put("/v1/admin/ns/demo", json={"projects": ["alpha"]}, headers=MEMBER)
H.check("someone else cannot change it", r.status_code == 403, r.text)
for bad in ("khx", "_x1", "ab", "admin", "Upper"):
    r = c.put(f"/v1/admin/ns/{bad}", json={"projects": ["alpha"]}, headers=ROOT)
    H.check(f"reserved or malformed namespace '{bad}' refused", r.status_code in (404, 422), r.status_code)
r = c.put("/v1/admin/ns/other", json={"projects": ["gamma"]}, headers=ROOT)
H.check("a maintainer attaches any namespace", r.status_code == 201, r.text)
r = c.get("/v1/admin/ns", headers=OWNER)
H.check("the owner lists only her namespaces", [n["ns"] for n in r.json()["namespaces"]] == ["demo"], r.text)
r = c.get("/v1/demo/manifest")
H.check("no token is 401", r.status_code == 401, r.text)
r = c.get("/v1/demo/manifest", headers=MEMBER)
H.check("a person who is not the namespace admin gets 403 on namespace routes", r.status_code == 403, r.text)

# ── 2. manifest ──────────────────────────────────────────────────────────────
MANIFEST = {
    "manifest_version": 1,
    "schemas": [
        {"name": "run_started", "version": 1, "schema": {
            "type": "object", "required": ["agent_version", "model"],
            "properties": {"agent_version": {"type": "string"}, "model": {"type": "string"},
                           "cost": {"type": "number"}}}},
        {"name": "decision", "version": 1, "schema": {"type": "object", "required": ["case_kind"]}},
    ],
    "types": [
        {"type": "run.started", "kind_of": "event", "schema": "run_started",
         "index_fields": {"agent_version": "s", "cost": "n"}, "required_envelope": ["run_id"]},
        {"type": "decision", "kind_of": "record", "schema": "decision", "index_fields": {"case_kind": "s", "at": "t"},
         "read_roles": ["judge", "agent"], "write_roles": ["judge"], "require_if_match": True},
        {"type": "guard", "kind_of": "record", "write_roles": ["admin"], "read_roles": ["agent", "judge"]},
        {"type": "unit.write", "kind_of": "event", "fenced": True},
    ],
    "keyspaces": [{"keyspace": "step", "dims": ["role", "step", "stack"], "config": {"ttl_days": 90}}],
    "quotas": [{"name": "events_per_month", "limit": 5000000, "window_s": 2592000}],
    "retention": {"idempotency_hours": 72},
    "redaction": {"packs": ["kh-default@1"]},
    "vaults": [{"vault_id": "holdout", "refresh_days": 30}],
    "subscriptions": [{"sub_id": "main", "kinds": ["kh.*"], "url": "https://consumer.example/hook",
                       "secret_ref": "env:DEMO_HOOK"}],
    "settings": {"include_people_lanes": False},
}
r = c.put("/v1/demo/manifest", json={"types": [{"type": "x", "schema": "missing"}], "bogus": 1}, headers=OWNER)
errs = r.json().get("errors", [])
H.check("an invalid manifest is 422 with a pointer per error", r.status_code == 422
        and {e["pointer"] for e in errs} >= {"/bogus", "/types/0/schema"}, r.text)
r = c.put("/v1/demo/manifest", json={"schemas": [{"name": "s", "schema": {"type": "nope"}}]}, headers=OWNER)
H.check("a schema that does not compile is refused", r.status_code == 422 and "compile" in r.text, r.text)
r = c.put("/v1/demo/manifest", json={"schemas": [{"name": "s", "schema": {"x": "y" * 70000}}]}, headers=OWNER)
H.check("a schema over 64 KB is refused", r.status_code == 422, r.status_code)
r = c.put("/v1/demo/manifest", json={"types": [{"type": "e", "kind_of": "event", "index_fields": {"t": "t"}}]},
          headers=OWNER)
H.check("an event type cannot use time index columns", r.status_code == 422, r.text)
r = c.put("/v1/demo/manifest", json={"types": [{"type": "kh.mine"}]}, headers=OWNER)
H.check("the kh. prefix is reserved", r.status_code == 422, r.text)
r = c.put("/v1/demo/manifest", json={"types": [{"type": f"t{i}"} for i in range(201)]}, headers=OWNER)
H.check("at most 200 types", r.status_code == 422, r.status_code)

r = c.put("/v1/demo/manifest", json=MANIFEST, headers=OWNER)
H.check("a valid manifest applies (rev 1, ETag)", r.status_code == 200 and r.json()["changed"]
        and r.json()["manifest_rev"] == 1 and r.headers.get("etag") == '"1"', r.text)
r = c.put("/v1/demo/manifest", json=MANIFEST, headers=OWNER)
H.check("applying the same manifest twice changes nothing", r.json()["changed"] is False
        and r.json()["manifest_rev"] == 1, r.text)
m2 = {**MANIFEST, "keyspaces": MANIFEST["keyspaces"] + [{"keyspace": "lesson", "dims": ["kind"]}]}
r = c.put("/v1/demo/manifest", json=m2, headers=OWNER)
H.check("a change without If-Match is 428", r.status_code == 428 and r.json()["error"] == "precondition_required",
        r.text)
r = c.put("/v1/demo/manifest", json=m2, headers={**OWNER, "If-Match": '"0"'})
H.check("a stale If-Match is 409 write_conflict", r.status_code == 409 and r.json()["error"] == "write_conflict",
        r.text)
r = c.put("/v1/demo/manifest", json=m2, headers={**OWNER, "If-Match": '"1"'})
H.check("the right If-Match applies (rev 2)", r.status_code == 200 and r.json()["manifest_rev"] == 2, r.text)
r = c.get("/v1/demo/manifest", headers=OWNER)
doc = r.json()["manifest"]
H.check("GET manifest returns what is configured, with ETag", r.headers.get("etag") == '"2"'
        and len(doc["keyspaces"]) == 2 and doc["vaults"][0]["vault_id"] == "holdout"
        and doc["redaction"]["packs"] == ["kh-default@1"], doc.keys())
st = registry.ns_state("demo")
H.check("types carry the index column mapping, ACLs, fencing and If-Match flags",
        st["types"]["run.started"]["index_fields"] == {"agent_version": "ix_s1", "cost": "ix_n1"}
        and st["types"]["decision"]["index_fields"] == {"case_kind": "ix_s1", "at": "ix_t1"}
        and st["types"]["decision"]["write_roles"] == ["judge"] and st["types"]["unit.write"]["fenced"]
        and st["types"]["decision"]["require_if_match"] and st["types"]["run.started"]["retention_days"] == registry.EVENTS_DAYS, st["types"])
with sqldb.connect() as conn:
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t} WHERE ns='demo'").fetchone()[0]
              for t in ("kh_schema", "kh_type", "kh_keyspace", "kh_quota", "kh_subscription")}
H.check("schemas, types, keyspaces, quotas and subscriptions are stored as rows",
        counts == {"kh_schema": 2, "kh_type": 4, "kh_keyspace": 2, "kh_quota": 1, "kh_subscription": 1}, counts)
H.check("retention, redaction, vaults, settings are stored in the namespace config",
        st["config"]["retention"] == {"idempotency_hours": 72} and st["config"]["vaults"][0]["refresh_days"] == 30)

errs = registry.validate("demo", st["types"]["run.started"], {"agent_version": 3})
H.check("validation reports JSON pointers (wrong type + missing required)",
        {e["pointer"] for e in errs} == {"", "/agent_version"} and len(errs) == 2, errs)
H.check("a valid body has no errors", registry.validate("demo", st["types"]["run.started"],
                                                        {"agent_version": "1.2", "model": "m"}) == [])
H.check("index_values promotes typed columns", registry.index_values(
    st["types"]["run.started"], {"agent_version": "1.2", "cost": "0.5"}) == {"ix_s1": "1.2", "ix_n1": 0.5})

changed = {**m2, "schemas": [{**MANIFEST["schemas"][0], "schema": {"type": "object"}}, MANIFEST["schemas"][1]]}
r = c.put("/v1/demo/manifest", json=changed, headers={**OWNER, "If-Match": '"2"'})
H.check("a schema version is immutable (409 schema_immutable), nothing applied", r.status_code == 409
        and r.json()["error"] == "schema_immutable" and registry.get_manifest("demo")[1] == 2, r.text)
moved = {**m2, "types": [{**MANIFEST["types"][0], "index_fields": {"agent_version": "n"}}] + MANIFEST["types"][1:]}
r = c.put("/v1/demo/manifest", json=moved, headers={**OWNER, "If-Match": '"2"'})
H.check("an index field cannot change type once registered", r.status_code == 422, r.text)

registry.TYPE_USAGE.append(lambda conn, ns, t: 3 if t["type"] == "guard" else 0)
fewer = {**m2, "types": [t for t in MANIFEST["types"] if t["type"] != "guard"]}
r = c.put("/v1/demo/manifest", json=fewer, headers={**OWNER, "If-Match": '"2"'})
H.check("removing a type with rows is 409 type_in_use", r.status_code == 409 and r.json()["error"] == "type_in_use",
        r.text)
r = c.put("/v1/demo/manifest?archive=true", json=fewer, headers={**OWNER, "If-Match": '"2"'})
H.check("?archive=true hides it instead", r.status_code == 200 and r.json()["removed_types"] == ["guard"], r.text)
registry.invalidate("demo")
H.check("an archived type is no longer active", "guard" not in registry.ns_state("demo")["types"])
registry.TYPE_USAGE.clear()

# ── 5. race: two applies with the same If-Match ──────────────────────────────
cur = registry.get_manifest("demo")[1]

def apply_one(i):
    try:
        registry.apply_manifest("demo", {**fewer, "settings": {"w": i}}, cur)
        return "ok"
    except Exception as exc:  # noqa: BLE001
        return getattr(exc, "code", repr(exc))


codes = H.race(4, apply_one)
H.check("RACE: 4 concurrent manifest applies with one If-Match -> exactly one wins, the rest write_conflict",
        sorted(codes) == ["ok", "write_conflict", "write_conflict", "write_conflict"], codes)

# ── 3. lifecycle and the state cache ─────────────────────────────────────────
r = c.get("/v1/nosuch/manifest", headers=ROOT)
H.check("an unknown namespace is 404 ns_not_active", r.status_code == 404 and r.json()["error"] == "ns_not_active",
        r.text)
r = c.post("/v1/admin/ns/demo:suspend", headers=OWNER)
H.check("suspend", r.status_code == 200 and r.json()["state"] == "suspended", r.text)
r = c.get("/v1/demo/manifest", headers=OWNER)
H.check("a suspended namespace still reads", r.status_code == 200, r.text)
r = c.put("/v1/demo/manifest", json=fewer, headers=OWNER)
H.check("a suspended namespace refuses writes with 423", r.status_code == 423 and r.json()["error"] == "ns_suspended",
        r.text)
c.post("/v1/admin/ns/demo:resume", headers=OWNER)
with sqldb.connect() as conn:
    sqldb.lease_acquire(conn, "demo", "unit/1", "agent-1", 30000)
H.check("an instance caches the active state", registry.ns_state("demo")["state"] == "active")
# another instance detaches: simulate by changing the row behind this instance's cache
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_ns SET state='detached' WHERE ns='demo'")
t0 = time.monotonic()
while time.monotonic() - t0 < 6 and c.get("/v1/demo/manifest", headers=OWNER).status_code != 404:
    time.sleep(0.1)
took = time.monotonic() - t0
H.check(f"a detach made elsewhere is seen within the cache bound ({took:.1f}s <= {registry.CACHE_S + 0.5}s)",
        took <= registry.CACHE_S + 0.5, took)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_ns SET state='active' WHERE ns='demo'")
registry.invalidate("demo")
r = c.post("/v1/admin/ns/demo:detach", headers=OWNER)
H.check("detach through the API", r.status_code == 200 and r.json()["state"] == "detached"
        and r.json()["purge_after_ms"] > r.json()["detached_ms"], r.text)
r = c.get("/v1/demo/manifest", headers=OWNER)
H.check("a detached namespace answers 404 at once on the instance that detached it", r.status_code == 404, r.text)
with sqldb.connect() as conn:
    lease = sqldb.lease_get(conn, "demo", "unit/1")
H.check("detach fenced every lease (epoch+1, holder cleared)", lease["epoch"] == 2 and lease["holder"] is None, lease)
r = c.post("/v1/admin/ns/demo:reattach", headers=OWNER)
H.check("reattach within grace", r.status_code == 200 and r.json()["state"] == "active", r.text)
H.check("routes answer again after reattach", c.get("/v1/demo/manifest", headers=OWNER).status_code == 200)

# ── 4. discovery ─────────────────────────────────────────────────────────────
r = c.get("/v1/capabilities", headers=MEMBER)
caps = {x["name"]: x for x in r.json()["capabilities"]}
H.check("/v1/capabilities lists each loaded module with a semver", r.status_code == 200 and "registry" in caps
        and all(len(x["version"].split(".")) == 3 for x in caps.values()) and r.json()["api_versions"] == ["v1"],
        r.text)
H.check("/v1/capabilities needs sign-in", c.get("/v1/capabilities").status_code == 401)
r = c.get("/v1/openapi.json", headers=MEMBER)
paths = list(r.json()["paths"])
H.check("/v1/openapi.json holds only /v1 routes", r.status_code == 200 and paths
        and all(p.startswith("/v1/") for p in paths), paths[:5])

H.done()
