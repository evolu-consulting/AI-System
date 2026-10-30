"""Contract test of the kh_people namespace (app/caps/people.py, docs/roadmap-e-to-5-design.md section 2, slice S1).

  1. Off by default: DEFAULT_ON = False keeps the module, the namespace and the worker gate away; a registered
     module whose file does not exist yet is skipped; KH_CAP_<NAME> parsing for both defaults.
  2. On: kh_people is created (reserved prefix, projects * stored as []), the manifest applied once and again only
     on a higher manifest_version (a maintainer edit survives a restart), the worker principal exists.
  3. Direct calls with a system Ctx: manifest events with their ix columns, kh.* emit, metrics with the binary
     scale and dims schema, a lesson_trial item with its attrs schema.
  4. Reading: maintainers through /v1/kh_people/*, members refused, PUT /v1/admin/ns/kh_people refused.
  5. The worker token: exactly the seven "worker": true routes, only while KH_DISTILL_WORKER is dry|on, refused
     when revoked, never another namespace's distiller; people's rules unchanged.
"""
import os

from harness import H  # noqa: I001  (must be first: throwaway db, sign-in on)

from fastapi.testclient import TestClient  # noqa: E402

from app import auth, caps, sqldb  # noqa: E402
from app.caps import core, people, principals, registry  # noqa: E402

MAINT = H.person("fen@x.io", maintainer=True)
MEMBER = H.person("mia@x.io", member=["alpha"])
os.environ.pop("KH_CAP_PEOPLE", None)
os.environ.pop("KH_DISTILL_WORKER", None)


def ns_exists():
    with sqldb.connect() as c:
        return c.execute("SELECT 1 FROM kh_ns WHERE ns=?", [people.NS]).fetchone() is not None


def app_with_stubs():
    app = H.app()
    for method, path in (("GET", "/distill/next"), ("POST", "/distill/submit"), ("GET", "/distill/cursor"),
                         ("GET", "/daily/next"), ("POST", "/daily/submit"), ("GET", "/promote/next"),
                         ("POST", "/promote/submit"), ("POST", "/distill/approve"),
                         ("GET", "/log/recent"), ("POST", "/step/outcome")):
        app.add_api_route(path, lambda: {"ok": True}, methods=[method])
    return TestClient(app)


# ── 1. off by default ────────────────────────────────────────────────────────
H.check("KH_CAP_<NAME> unset: a default-on module is on, a DEFAULT_ON = False module is off",
        caps.enabled("x_test") and caps.enabled("x_test", True) and not caps.enabled("x_test", False))
os.environ["KH_CAP_X_TEST"] = "off"
H.check("KH_CAP_<NAME>=off switches a default-on module off", not caps.enabled("x_test"))
os.environ["KH_CAP_X_TEST"] = "on"
H.check("KH_CAP_<NAME>=on switches a DEFAULT_ON = False module on", caps.enabled("x_test", False))
os.environ["KH_CAP_X_TEST"] = "maybe"
H.check("an unknown value keeps a DEFAULT_ON = False module off", not caps.enabled("x_test", False))
os.environ.pop("KH_CAP_X_TEST")
H.check("people declares DEFAULT_ON = False", people.DEFAULT_ON is False)
H.check("every roadmap module is registered after people", caps.MODULES.index("app.caps.people")
        < min(caps.MODULES.index(f"app.caps.{m}") for m in ("daily", "outcomes", "learn", "improve")))
H.check("a registered module that is not built yet is skipped", caps._import("app.caps.not_built_yet_x") is None)

off = app_with_stubs()
names = {x["name"] for x in off.get("/v1/capabilities", headers=MAINT).json()["capabilities"]}
H.check("OFF: people is not attached and not in discovery", "people" not in names and not caps.is_loaded("people"),
        names)
H.check("OFF: the namespace is not created", not ns_exists())
H.check("OFF: auth.decide is not wrapped", not getattr(auth.decide, "_kh_people", False))
H.check("OFF: active() is False", people.active() is False)
r = off.get("/v1/kh_people/events", headers=MAINT)
H.check("OFF: /v1/kh_people answers 404", r.status_code == 404, r.text)
H.check("OFF: the worker routes are still maintainer routes",
        off.get("/distill/next", headers=MAINT).status_code == 200
        and off.get("/distill/next", headers=MEMBER).status_code == 403)

# ── 2. on ────────────────────────────────────────────────────────────────────
os.environ["KH_CAP_PEOPLE"] = "on"
c = app_with_stubs()
names = {x["name"] for x in c.get("/v1/capabilities", headers=MAINT).json()["capabilities"]}
H.check("ON: people is attached and listed", "people" in names and caps.is_loaded("people"), names)
row = registry._load(people.NS)
H.check("ON: kh_people exists, active, projects * stored as [] (every project)",
        row and row["state"] == "active" and row["projects"] == [], row and row["projects"])
H.check("ON: the owner is the KH maintainers", row["owner_email"] == people.owner_email())
H.check("ON: manifest applied (event, metric and item types)",
        {"step.outcome", "worker.run", "learn.decision", "improve.decision", "step.success", "step.tokens",
         "worker.cost_usd", "daily.lag_min", "lesson_trial"} <= set(row["types"]), sorted(row["types"]))
H.check("ON: kh.* kinds are KH-written, never manifest types",
        not any(t.startswith("kh.") for t in row["types"]))
H.check("ON: people lanes are off", row["config"]["settings"]["retrieval"]["include_people_lanes"] is False)
H.check("ON: events are kept 400 days and idempotency 7 d",
        all(row["types"][k]["retention_days"] == 400 for k in ("step.outcome", "worker.run", "learn.decision"))
        and row["config"]["retention"]["idempotency_hours"] == 168)
H.check("ON: keyspace people has dims project/action/context",
        __import__("app.caps.items", fromlist=["x"]).keyspaces(row)["people"]["dims"] == ["project", "action", "context"])
H.check("ON: the daily time zone defaults to Asia/Ho_Chi_Minh", people.daily_tz("alpha") == "Asia/Ho_Chi_Minh")
H.check("ON: learn and improve thresholds are settings",
        people.settings("learn")["min_n_per_arm"] == 30 and people.settings("improve")["param_step_max"] == 0.20)
w = principals.get_principal(people.NS, "worker", fresh=True)
H.check("ON: the worker principal exists with role distiller (and nothing else)",
        w and w["role"] == "distiller" and w["state"] == "active", w)
H.check("ON: active() is True", people.active() is True)

rev = row["manifest_rev"]
res = people.ensure()
H.check("IDEMPOTENT: a second ensure changes nothing",
        not res["created"] and res["manifest"] is None and not res["principals_created"]
        and registry._load(people.NS)["manifest_rev"] == rev, res)
doc = people.load_manifest()
doc["settings"]["learn"]["min_n_per_arm"] = 31
registry.apply_manifest(people.NS, doc, expected_rev=rev, actor={"principal": "fen@x.io"})
people.ensure()
H.check("IDEMPOTENT: a maintainer's edit survives a restart with the same manifest_version",
        registry.get_manifest(people.NS)[0]["settings"]["learn"]["min_n_per_arm"] == 31)
orig = people.load_manifest
people.load_manifest = lambda: {**orig(), "manifest_version": orig()["manifest_version"] + 1}
res = people.ensure()
people.load_manifest = orig
H.check("IDEMPOTENT: a higher manifest_version re-applies the file",
        res["manifest"] and res["manifest"]["changed"]
        and registry.get_manifest(people.NS)[0]["settings"]["learn"]["min_n_per_arm"] == 30, res)
race = H.race(4, lambda i: people.ensure()["created"])
H.check("RACE: concurrent ensure never fails and never re-creates", race == [False] * 4, race)
registry.invalidate(people.NS)

# ── 3. direct calls ──────────────────────────────────────────────────────────
out = people.append_events([{"kind": "step.outcome", "project": "alpha", "session_id": "s-1",
                             "body": {"serve_id": "sv1", "outcome": "failed", "source": "tool",
                                      "error_kind": "abc123def456", "action": "build", "context": "java"}}])
eid = out["accepted"][0]["id"]
with sqldb.connect() as conn:
    ev = conn.execute("SELECT project, session_id, ix_s1, ix_s2 FROM kh_event WHERE ns=? AND id=?",
                      [people.NS, eid]).fetchone()
H.check("DIRECT: step.outcome stored with project, session and ix_s1 = error_kind",
        ev and ev["project"] == "alpha" and ev["session_id"] == "s-1" and ev["ix_s1"] == "abc123def456"
        and ev["ix_s2"] == "failed", ev and dict(ev))
try:
    people.append_events([{"kind": "step.outcome", "body": {"serve_id": "x", "outcome": "maybe", "source": "tool"}}])
    H.check("DIRECT: a body outside the schema is refused", False)
except core.CapError as exc:
    H.check("DIRECT: a body outside the schema is refused", exc.code == "validation_failed", exc.detail)
try:
    people.append_events([{"kind": "kh.served", "body": {}}])
    H.check("DIRECT: kh.* cannot go through append_events", False)
except core.CapError:
    H.check("DIRECT: kh.* cannot go through append_events", True)
seq = people.emit("kh.served", {"serve_id": "sv1", "project": "alpha", "item_ids": ["dk_1"], "withheld_ids": []},
                  session="s-1")
H.check("DIRECT: emit writes kh.served", isinstance(seq, int) and seq > 0)
m = people.record_metrics([{"series": "step.success", "value": 1, "unit_id": "s-1", "project": "alpha",
                            "dims": {"project": "alpha", "action": "build", "context": "java"}},
                           {"series": "worker.cost_usd", "value": 0.15, "unit_id": "run-1",
                            "dims": {"job": "distil", "model": "claude-opus-5-5"}}])
H.check("DIRECT: step.success and worker.cost_usd recorded", m["created"] == 2, m)
for bad, why in (({"series": "step.success", "value": 0.5}, "binary scale"),
                 ({"series": "step.tokens", "value": 3, "dims": {"colour": "red"}}, "dims schema"),
                 ({"series": "nope", "value": 1}, "unknown series")):
    try:
        people.record_metrics([bad])
        H.check(f"DIRECT: metrics refuse ({why})", False)
    except core.CapError:
        H.check(f"DIRECT: metrics refuse ({why})", True)
from app.caps import items  # noqa: E402

st, it = items.propose(people.system_ctx(), {
    "kind": "lesson_trial", "keyspace": "people", "project": "alpha",
    "key": {"project": "alpha", "action": "build", "context": "java"},
    "text": "Run the build with the offline flag when the mirror is down.",
    "attrs": {"trial_state": "proposed", "arm_salt": "s4lt", "opened_ms": 1, "source": "distill"}})
H.check("DIRECT: a lesson_trial item is proposed with its attrs", st == 201 and it["item"]["attrs"]["source"]
        == "distill", (st, it))
try:
    items.propose(people.system_ctx(), {"kind": "lesson_trial", "keyspace": "people", "project": "alpha",
                                        "key": {"project": "alpha", "action": "x", "context": "y"},
                                        "text": "Do the thing.", "attrs": {"source": "someone"}})
    H.check("DIRECT: lesson_trial attrs outside the schema are refused", False)
except core.CapError as exc:
    H.check("DIRECT: lesson_trial attrs outside the schema are refused", exc.code == "validation_failed", exc.detail)

# ── 4. reading ───────────────────────────────────────────────────────────────
r = c.get("/v1/kh_people/events", headers=MAINT, params={"kinds": "step.outcome"})
H.check("READ: a maintainer reads kh_people events", r.status_code == 200 and any(
    e["id"] == eid for e in r.json().get("events", [])), r.text[:300])
r = c.get("/v1/kh_people/events", headers=MEMBER)
H.check("READ: a member is refused", r.status_code == 403, r.text)
r = c.put("/v1/admin/ns/kh_people", headers=MAINT, json={"projects": ["alpha"]})
H.check("RESERVED: nobody attaches kh_people through the admin route", r.status_code in (400, 422), r.text)

# ── 5. the worker token ──────────────────────────────────────────────────────
H.check("RULES: exactly the seven worker routes are marked", people.worker_routes() == {
    ("GET", "/distill/next"), ("POST", "/distill/submit"), ("GET", "/distill/cursor"),
    ("GET", "/daily/next"), ("POST", "/daily/submit"), ("GET", "/promote/next"), ("POST", "/promote/submit")},
    people.worker_routes())
rules = {(r.method, r.template): r for r in auth.load_rules()}
H.check("RULES: the worker routes stay maintainer for people",
        all(rules[k].kind == "maintainer" for k in people.worker_routes()))
H.check("RULES: the new non-/v1 routes have rules", all(k in rules for k in (
    ("GET", "/log/day"), ("GET", "/log/week"), ("POST", "/step/outcome"), ("GET", "/step/outcomes"),
    ("POST", "/learn/propose"), ("GET", "/learn/trials"), ("POST", "/learn/decide"), ("POST", "/improve/propose"))))
H.check("RULES: /log/day needs project.read on the named project",
        rules[("GET", "/log/day")].kind == "project" and rules[("GET", "/log/day")].permission == "project.read")

WT = {"Authorization": "Bearer " + principals.issue(people.NS, "worker", "distiller", people.owner_email())["access_token"]}
H.check("WORKER off (default): refused on its own routes", c.get("/distill/next", headers=WT).status_code == 403)
H.check("WORKER off: refused on /v1/kh_people too", c.get("/v1/kh_people/events", headers=WT).status_code == 403)
for mode in ("dry", "on"):
    os.environ["KH_DISTILL_WORKER"] = mode
    ok = [c.request(m, p, headers=WT, json={} if m == "POST" else None).status_code for m, p in sorted(
        people.worker_routes())]
    H.check(f"WORKER {mode}: all seven routes pass", ok == [200] * 7, ok)
H.check("WORKER: /distill/approve stays refused", c.post("/distill/approve", headers=WT).status_code == 403)
H.check("WORKER: a people route is refused", c.get("/log/recent", headers=WT).status_code == 403)
H.check("WORKER: /step/outcome (authenticated, people only) is refused",
        c.post("/step/outcome", headers=WT, json={}).status_code == 403)
r = c.get("/v1/kh_people/events", headers=WT)
H.check("WORKER: reads its own namespace on /v1 (role distiller)", r.status_code == 200, r.text)
r = c.post("/v1/admin/ns/kh_people:client", headers=MAINT)
NSC0 = {"Authorization": "Bearer " + principals.issue(people.NS, "client", "admin", people.owner_email())["access_token"]}
r2 = c.post("/v1/kh_people/metrics", headers=NSC0, json={"observations": [{
    "series": "worker.cost_usd", "value": 0.12, "unit_id": "worker:distil", "run_id": "r1",
    "dims": {"job": "distil", "kind": "run", "model": "claude-opus-5-5"}}]})
H.check("WORKER: worker.cost_usd with dims {job, kind, model} is accepted (the worker's record_cost shape)",
        r2.status_code == 200, r2.text[:300])
r2 = c.post("/v1/kh_people/metrics", headers=NSC0, json={"observations": [{
    "series": "worker.cost_usd", "value": 0.1, "unit_id": "worker:distil", "dims": {"customer": "x"}}]})
H.check("WORKER: an unknown dim is still refused (additionalProperties false)", r2.status_code in (400, 422),
        r2.status_code)
H.check("WORKER: a maintainer provisions the kh_people namespace client", r.status_code == 201, r.text[:200])
NSC = {"Authorization": "Bearer " + principals.issue(people.NS, "client", "admin", people.owner_email())["access_token"]}
r = c.post("/v1/kh_people/events", headers=NSC, json={"kind": "worker.run", "project": "alpha", "id": "wr_test_1",
                                                      "body": {"job": "distil", "mode": "dry", "project": "alpha"}})
H.check("WORKER: the kh_people namespace client writes a project-tagged worker.run (every project)",
        r.status_code == 200 and (r.json().get("accepted") or [{}])[0].get("id") == "wr_test_1", r.text[:300])
H.check("WORKER: kh_people principals are every-project (None), narrowed only by their own list",
        principals.effective_projects(people.ns_row(), None, people.owner_email()) is None
        and principals.effective_projects(people.ns_row(), ["alpha"], people.owner_email()) == {"alpha"})
os.environ["KH_DISTILL_WORKER"] = "bogus"
H.check("WORKER: an unknown KH_DISTILL_WORKER value counts as off", c.get("/distill/next", headers=WT).status_code
        == 403)
os.environ["KH_DISTILL_WORKER"] = "on"
H.check("PEOPLE: maintainers still reach the worker routes, members do not",
        c.get("/daily/next", headers=MAINT).status_code == 200 and c.get("/daily/next", headers=MEMBER).status_code
        == 403)

c.put("/v1/admin/ns/shop", headers=MAINT, json={"projects": ["alpha"]})
with sqldb.connect() as conn:
    sqldb.insert_new(conn, "kh_principal", {"ns": "shop", "principal_id": "d1", "role": "distiller",
                                            "on_behalf_of": "fen@x.io", "projects_json": "[]", "state": "active",
                                            "created_by": "t", "created_ms": 1, "expires_ms": None, "rev": 1})
OTHER = {"Authorization": "Bearer " + principals.issue("shop", "d1", "distiller", "fen@x.io")["access_token"]}
H.check("WORKER: another namespace's distiller is refused", c.get("/distill/next", headers=OTHER).status_code == 403)
FAKE = {"Authorization": "Bearer " + principals.issue(people.NS, "ghost", "distiller", "x")["access_token"]}
H.check("WORKER: a token of an unknown kh_people principal is refused",
        c.get("/distill/next", headers=FAKE).status_code == 403)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_principal SET state='revoked' WHERE ns=? AND principal_id='worker'", [people.NS])
for cache in [v for k, v in vars(principals).items() if k.endswith("_cache") and isinstance(v, dict)]:
    cache.clear()
H.check("WORKER: a revoked worker is refused at once", c.get("/distill/next", headers=WT).status_code == 403)

people._unwrap_decide()
H.check("cleanup: auth.decide restored", not getattr(auth.decide, "_kh_people", False))
os.environ.pop("KH_DISTILL_WORKER", None)
os.environ.pop("KH_CAP_PEOPLE", None)
H.done()
