"""Contract test: app/caps/metrics.py (stage F8, metrics, baselines, :compare, automatic rollback).

  1. Statistics: two-proportion z-test and Mann-Whitney U (ties) against hand-computed values.
  2. POST /v1/{ns}/metrics: manifest series only, validation all-or-nothing (422 with index), binary scale,
     batch limit (413), redact.scrub on bodies, idempotent per (series, ts_ms, unit_id) (duplicate / conflict,
     a 6-way race inserts once), Idempotency-Key replay, roles and grants, the daily rollup.
  3. :aggregate by day / week / project / baseline (rollup) and dims / run (raw); GET raw rows.
  4. :compare: human baseline vs line, Mann-Whitney on real values, served / not-served filters.
  5. Rollback (D12) on synthetic data: fires at n >= 30 (boundary 30 fires, 29 does not), >= 10 % worse and
     p < 0.05; does not fire when only one of the three holds; metric_dir down; dry run; the real
     kh.served join through POST /context/step; contested -> withdrawn resume; per-namespace lease (busy)
     and a 2-way race withdrawing once; the cron under the KH lease; kh.item_rollback written.

    .venv\\Scripts\\python tests\\caps\\test_metrics.py
"""
from harness import H

import json

from app import sqldb
from app.caps import core, events, metrics
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha", "beta"])


def as_(principal, role="agent", projects=None, run=None, unit=None):
    h = {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}
    if projects is not None:
        h["X-Test-Projects"] = ",".join(projects)
    if run:
        h["X-KH-Run"] = run
    if unit:
        h["X-KH-Unit"] = unit
    return h


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    if not p:
        return None
    pr = request.headers.get("x-test-projects")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service",
                  projects=set(x for x in pr.split(",") if x) if pr is not None else None)


core.CALLER_RESOLVERS.append(_test_resolver)

# ── 1. statistics ────────────────────────────────────────────────────────────
z, p = metrics.two_proportion([1] * 50 + [0] * 50, [1] * 60 + [0] * 40)
H.check("two-proportion z-test matches the hand value (z 1.4213, p 0.1552)",
        abs(z - 1.4213) < 1e-3 and abs(p - 0.1552) < 1e-3, (z, p))
z, p = metrics.mann_whitney([1, 2, 3], [4, 5, 6])
H.check("Mann-Whitney U matches the hand value (z 1.9640, p 0.0495)", abs(z - 1.9640) < 1e-3 and abs(p - 0.0495) < 1e-3,
        (z, p))
z, p = metrics.mann_whitney([1, 2, 2, 3], [2, 3, 3, 4])
H.check("Mann-Whitney with ties: tie-corrected variance (z 1.5174)", abs(z - 1.5174) < 1e-3, (z, p))
H.check("identical samples: p = 1", metrics.two_proportion([1] * 5, [1] * 7)[1] == 1.0
        and metrics.mann_whitney([2] * 4, [2] * 4)[1] == 1.0)
st = metrics.compare_values([1, 0, 1, 1], [0, 0, 1, 0])
H.check("compare_values picks the proportion test for 0/1 and reports rel_delta",
        st["test"] == "proportion" and st["rel_delta"] == (0.25 - 0.75) / 0.75, st)
H.check("compare_values picks Mann-Whitney for real values", metrics.compare_values([1.5, 2], [3, 4.5])["test"]
        == "mann_whitney")
H.check("statistics are deterministic", metrics.compare_values([0.3, 1, 2], [2, 5, 1]) ==
        metrics.compare_values([0.3, 1, 2], [2, 5, 1]))

# ── setup ────────────────────────────────────────────────────────────────────
SCEN = ["fire", "edge30", "edge29", "rel", "nosig", "down", "downok", "pre", "race", "real"]
MANIFEST = {
    "schemas": [{"name": "dims", "version": 1, "schema": {"type": "object", "properties": {"lane": {"type": "string"}}}}],
    "types": [{"type": "lesson", "kind_of": "item", "confirm_policy": {"roles": ["confirmer"]}},
              {"type": "success", "kind_of": "metric", "schema": "dims"},
              {"type": "latency", "kind_of": "metric", "read_roles": ["orchestrator", "grader", "judge"]},
              {"type": "secret_metric", "kind_of": "metric", "write_roles": ["grader"]},
              {"type": "fenced_metric", "kind_of": "metric", "fenced": True}]
             + [{"type": f"g_{s}", "kind_of": "metric"} for s in SCEN],
    "keyspaces": [{"keyspace": "step", "dims": ["role", "step", "stack"]}],
    "settings": {"metrics": {"series": {"success": {"scale": "binary"}, "g_down": {"dir": "down"},
                                        "g_downok": {"dir": "down"}}}},
}
r = c.put("/v1/admin/ns/shop", json={"projects": ["alpha", "beta"]}, headers=OWNER)
H.check("namespace attached", r.status_code in (200, 201), r.text)
r = c.put("/v1/shop/manifest", headers=OWNER, json=MANIFEST)
H.check("manifest applied", r.status_code == 200, r.text)
r = c.get("/v1/capabilities", headers=OWNER)
cap = [x for x in r.json()["capabilities"] if x["name"] == "metrics"]
H.check("metrics is listed in discovery with its limits", cap and cap[0]["limits"]["rollback"]["min_n"] == 30, cap)

AGENT = as_("ag", "agent", run="run-1", unit="u-0")
ORCH = as_("orch", "orchestrator")
JUDGE = as_("jd", "judge")

# ── 2. write path ────────────────────────────────────────────────────────────
T0 = 1_760_000_000_000 - (1_760_000_000_000 % metrics.DAY_MS)       # a day boundary
obs = [{"series": "success", "value": 1, "ts_ms": T0 + 1000 * i, "unit_id": f"w{i}", "project": "alpha",
        "dims": {"lane": "a" if i % 2 else "b"}} for i in range(6)]
obs += [{"series": "success", "value": 0, "ts_ms": T0 + metrics.DAY_MS + i, "unit_id": f"h{i}", "project": "beta",
         "baseline": True, "dims": {"lane": "a"}} for i in range(4)]
r = c.post("/v1/shop/metrics", headers=AGENT, json={"observations": obs})
H.check("a batch of observations is recorded", r.status_code == 200 and r.json()["created"] == 10, r.text)
r = c.post("/v1/shop/metrics", headers=AGENT, json={"observations": obs[:2] + [{**obs[2], "value": 0}]})
H.check("a repeat is duplicate; another value under the same key is conflict (first wins)",
        r.status_code == 200 and [a["status"] for a in r.json()["accepted"]] == ["duplicate", "duplicate", "conflict"]
        and r.json()["created"] == 0, r.text)
with sqldb.connect() as conn:
    v = conn.execute("SELECT val FROM kh_metric WHERE ns='shop' AND series='success' AND unit_id='w2'").fetchone()[0]
    dup_ev = conn.execute("SELECT COUNT(*) FROM kh_event WHERE ns='shop' AND kind='kh.duplicate'").fetchone()[0]
H.check("the stored value is kept and kh.duplicate is written", v == 1.0 and dup_ev >= 1, (v, dup_ev))

r = c.post("/v1/shop/metrics", headers=AGENT,
           json=[{"series": "success", "value": 1, "unit_id": "x1"}, {"series": "nope", "value": 1},
                 {"series": "success", "value": 0.5}, {"series": "success", "value": "1"},
                 {"series": "success", "value": 1, "dims": {"lane": 3}}, {"series": "success", "value": 1, "foo": 1}])
errs = r.json().get("errors", [])
H.check("validation is all-or-nothing with index + pointer (unknown series, binary, type, dims schema, fields)",
        r.status_code == 422 and r.json()["error"] == "validation_failed"
        and sorted({e["index"] for e in errs}) == [0, 1, 2, 3, 4, 5]
        and [e["pointer"] for e in errs if e["index"] == 0] == ["/project"], r.text)
with sqldb.connect() as conn:
    n_x1 = conn.execute("SELECT COUNT(*) FROM kh_metric WHERE ns='shop' AND unit_id='x1'").fetchone()[0]
H.check("nothing of a refused batch is stored", n_x1 == 0)
r = c.post("/v1/shop/metrics", headers=AGENT, json=[{"series": "latency", "value": 1}] * 1001)
H.check("batch > 1,000 -> 413 too_large", r.status_code == 413 and r.json()["error"] == "too_large", r.text)
r = c.post("/v1/shop/metrics", headers=JUDGE, json={"series": "latency", "value": 1})
H.check("judge may not write metrics (role matrix) -> 403", r.status_code == 403, r.text)
r = c.post("/v1/shop/metrics", headers=AGENT, json={"series": "secret_metric", "value": 1})
H.check("type write_roles narrow the matrix -> 403", r.status_code == 403, r.text)
r = c.post("/v1/shop/metrics", headers=as_("ag2", "agent", projects=["alpha"]),
           json={"series": "latency", "value": 1, "project": "beta"})
H.check("a project outside the caller's grant -> 403", r.status_code == 403, r.text)
r = c.post("/v1/shop/metrics", headers=AGENT, json={"series": "fenced_metric", "value": 1, "project": "alpha"})
H.check("a fenced series without lease headers -> 428", r.status_code == 428, r.text)

r = c.post("/v1/shop/metrics", headers=AGENT, json={"series": "latency", "value": 12.5, "unit_id": "red-1",
                                                     "project": "alpha", "dims": {"who": "mail ana@x.io now"}})
with sqldb.connect() as conn:
    row = conn.execute("SELECT dims_json, run_id FROM kh_metric WHERE ns='shop' AND unit_id='red-1'").fetchone()
    red = conn.execute("SELECT COUNT(*) FROM kh_event WHERE ns='shop' AND kind='kh.redacted'").fetchone()[0]
H.check("redact.scrub masks the body before storage and writes kh.redacted",
        r.status_code == 200 and json.loads(row["dims_json"]) == {"who": "mail [REDACTED:email] now"} and red >= 1,
        (r.text, row and row["dims_json"], red))
H.check("run_id defaults to X-KH-Run", row["run_id"] == "run-1", row["run_id"])

r = c.post("/v1/shop/metrics", headers=AGENT, json={"series": "latency", "value": 3, "project": "alpha"})
with sqldb.connect() as conn:
    u = conn.execute("SELECT unit_id FROM kh_metric WHERE ns='shop' AND series='latency' AND val=3").fetchone()[0]
H.check("unit_id defaults to X-KH-Unit", u == "u-0", u)

IK = {**AGENT, "Idempotency-Key": "obs-1"}
body = {"series": "latency", "value": 7, "unit_id": "ik-1", "project": "alpha", "ts_ms": T0}
r1 = c.post("/v1/shop/metrics", headers=IK, json=body)
r2 = c.post("/v1/shop/metrics", headers=IK, json=body)
H.check("Idempotency-Key replays the first response", r2.status_code == 200 and r2.headers.get("Idempotent-Replay")
        == "true" and r2.json() == r1.json() and r1.json()["created"] == 1, (r1.text, r2.text))

res = H.race(6, lambda i: c.post("/v1/shop/metrics", headers=AGENT,
                                 json={"series": "latency", "value": 9, "unit_id": "race-u", "project": "alpha",
                                       "ts_ms": T0 + 5}).json()["accepted"][0]["status"])
with sqldb.connect() as conn:
    n_race = conn.execute("SELECT COUNT(*) FROM kh_metric WHERE ns='shop' AND unit_id='race-u'").fetchone()[0]
    day = conn.execute("SELECT n FROM kh_metric_day WHERE ns='shop' AND series='latency' AND project='alpha' "
                       "AND day_no=?", [T0 // metrics.DAY_MS]).fetchone()[0]
H.check("RACE: 6 identical observations -> one created, five duplicates, one row",
        sorted(res) == ["created"] + ["duplicate"] * 5 and n_race == 1, res)
H.check("the daily rollup counts only rows really inserted", day == 2, day)

# ── 3. aggregate ─────────────────────────────────────────────────────────────
r = c.get("/v1/shop/metrics:aggregate", headers=ORCH, params={"series": "success", "group_by": "baseline",
                                                               "window": "day"})
g = r.json()
H.check("aggregate by day x baseline reads the rollup", r.status_code == 200 and g["source"] == "rollup"
        and [(x["key"]["day"], x["key"]["baseline"], x["n"], x["mean"]) for x in g["groups"]]
        == [(T0, False, 6, 1.0), (T0 + metrics.DAY_MS, True, 4, 0.0)], r.text)
r = c.get("/v1/shop/metrics:aggregate", headers=ORCH, params={"series": "success", "window": "week"})
H.check("aggregate by week (Monday buckets)", r.status_code == 200 and sum(x["n"] for x in r.json()["groups"]) == 10
        and all((x["key"]["week"] // metrics.DAY_MS + 3) % 7 == 0 for x in r.json()["groups"]), r.text)
r = c.get("/v1/shop/metrics:aggregate", headers=ORCH, params={"series": "success", "group_by": "dims.lane,project"})
H.check("aggregate by a dimension reads the raw rows",
        r.status_code == 200 and r.json()["source"] == "raw" and {(x["key"]["dims.lane"], x["key"]["project"]): x["n"]
                                                                  for x in r.json()["groups"]}
        == {("a", "alpha"): 3, ("b", "alpha"): 3, ("a", "beta"): 4}, r.text)
r = c.get("/v1/shop/metrics:aggregate", headers=as_("o2", "orchestrator", projects=["alpha"]),
          params={"series": "success", "group_by": "project"})
H.check("aggregate sees only the caller's projects", [x["key"]["project"] for x in r.json()["groups"]] == ["alpha"],
        r.text)
r = c.get("/v1/shop/metrics:aggregate", headers=ORCH, params={"series": "success", "from": T0 + 500, "to": T0 + 3500})
H.check("a window not on day boundaries uses the raw rows", r.json()["source"] == "raw"
        and r.json()["groups"][0]["n"] == 3, r.text)
r = c.get("/v1/shop/metrics:aggregate", headers=ORCH, params={"series": "success", "group_by": "colour"})
H.check("bad group_by -> 422", r.status_code == 422, r.text)
r = c.get("/v1/shop/metrics:aggregate", headers=AGENT, params={"series": "success"})
H.check("agent may not read metrics (role matrix) -> 403", r.status_code == 403, r.text)
r = c.get("/v1/shop/metrics:aggregate", headers=as_("dist", "distiller"), params={"series": "latency"})
H.check("type read_roles narrow reads -> 403", r.status_code == 403, r.text)
r = c.get("/v1/shop/metrics", headers=ORCH, params={"series": "success", "baseline": "true"})
H.check("GET raw observations with filters", r.status_code == 200 and r.json()["total"] == 4
        and all(o["baseline"] for o in r.json()["observations"]), r.text)

# ── 4. compare ───────────────────────────────────────────────────────────────
r = c.post("/v1/shop/metrics:compare", headers=ORCH,
           json={"series": "success", "a": {"baseline": True}, "b": {"baseline": False}})
cm = r.json()
H.check("compare human baseline vs line: n, means, proportion test, p",
        r.status_code == 200 and (cm["n_a"], cm["n_b"], cm["mean_a"], cm["mean_b"], cm["test"]) == (4, 6, 0.0, 1.0,
                                                                                                       "proportion")
        and cm["p"] < 0.05 and cm["rel_delta"] == "inf", cm)
r = c.post("/v1/shop/metrics:compare", headers=ORCH,
           json={"series": "success", "a": {"dims": {"lane": "a"}, "project": "alpha"}, "b": {"dims": {"lane": "b"}}})
H.check("compare with dims / project filters", r.status_code == 200 and (r.json()["n_a"], r.json()["n_b"]) == (3, 3),
        r.text)
r = c.post("/v1/shop/metrics:compare", headers=ORCH, json={"series": "success", "a": {"colour": 1}, "b": {}})
H.check("an unknown filter key -> 422", r.status_code == 422, r.text)
r = c.post("/v1/shop/metrics:compare", headers=ORCH, json={"series": "nope", "a": {}, "b": {}})
H.check("compare an undeclared series -> 404", r.status_code == 404, r.text)

# ── 5. rollback ──────────────────────────────────────────────────────────────
DIST = as_("dist", "distiller", run="run-1")
CONF = as_("conf", "confirmer")


def make(scen, mdir=None, project="alpha"):
    body = {"kind": "lesson", "keyspace": "step", "key": {"role": "dev", "step": "build", "stack": scen},
            "project": project, "text": f"Run the {scen} checks before every build.", "guard_metric": f"g_{scen}"}
    if mdir:
        body["metric_dir"] = mdir
    r = c.post("/v1/shop/items", headers=DIST, json=body)
    assert r.status_code == 201, r.text
    r = c.patch(f"/v1/shop/items/{r.json()['item']['id']}", headers=CONF, json={"status": "active"})
    assert r.status_code == 200, r.text
    return r.json()["item"]


ITEMS = {s: make(s, "down" if s in ("down", "downok") else None) for s in SCEN}
H.check("items store guard_metric and metric_dir", ITEMS["down"]["guard_metric"] == "g_down"
        and ITEMS["down"]["metric_dir"] == "down" and ITEMS["fire"]["metric_dir"] == "up", ITEMS["down"])


def served(scen, units):
    for u in units:
        events.append_system("shop", "kh.served", {"serve_id": f"sv-{u}", "item_ids": [ITEMS[scen]["id"]],
                                                   "project": "alpha"}, {"principal": "ag", "unit_id": u})


def outcomes(scen, prefix, values):
    rows = [{"series": f"g_{scen}", "value": v, "unit_id": f"{scen}-{prefix}{i}", "project": "alpha"}
            for i, v in enumerate(values)]
    for k in range(0, len(rows), 1000):
        r = c.post("/v1/shop/metrics", headers=AGENT, json=rows[k:k + 1000])
        assert r.status_code == 200 and r.json()["created"] == len(rows[k:k + 1000]), r.text
    return [x["unit_id"] for x in rows]


def scenario(scen, served_vals, ctrl_vals):
    served(scen, outcomes(scen, "s", served_vals))
    outcomes(scen, "c", ctrl_vals)


scenario("fire", [1] * 20 + [0] * 20, [1] * 36 + [0] * 4)          # 0.50 vs 0.90, n 40 / 40
scenario("edge30", [1] * 15 + [0] * 15, [1] * 27 + [0] * 3)         # n exactly 30 per side
scenario("edge29", [1] * 14 + [0] * 15, [1] * 36 + [0] * 4)         # served n 29
scenario("rel", [1] * 170 + [0] * 30, [1] * 184 + [0] * 16)         # -7.6 % (p 0.028): not worse enough
scenario("nosig", [1] * 21 + [0] * 9, [1] * 26 + [0] * 4)           # -19 % but p 0.117
scenario("down", [200.0 + i for i in range(40)], [100.0 + i for i in range(40)])     # latency up: worse
scenario("downok", [50.0 + i for i in range(40)], [100.0 + i for i in range(40)])    # latency down: better
scenario("race", [0] * 40, [1] * 40)
outcomes("pre", "c", [1] * 40)

# the real join: kh.served written by POST /context/step with the X-KH-Unit header
real_units = []
for i in range(40):
    u = f"real-s{i}"
    r = c.post("/v1/shop/context/step", headers=as_("ag", "agent", run="run-r", unit=u),
               json={"project": "alpha", "keyspace": "step", "key": {"role": "dev", "step": "build", "stack": "real"}})
    assert r.status_code == 200 and ITEMS["real"]["id"] in r.json()["item_ids"], r.text
    real_units.append(u)
rows = [{"series": "g_real", "value": 0 if i < 25 else 1, "unit_id": u, "project": "alpha"} for i, u in enumerate(real_units)]
rows += [{"series": "g_real", "value": 1 if i < 38 else 0, "unit_id": f"real-c{i}", "project": "alpha"} for i in range(40)]
assert c.post("/v1/shop/metrics", headers=AGENT, json=rows).status_code == 200
rows = [{"series": "g_fire", "value": 1, "unit_id": f"fire-b{i}", "project": "alpha", "baseline": True}
        for i in range(500)]
assert c.post("/v1/shop/metrics", headers=AGENT, json=rows).status_code == 200      # baselines never count

r = c.post("/v1/shop/metrics:compare", headers=ORCH, json={
    "series": "g_fire", "a": {"not_served_item": ITEMS["fire"]["id"], "baseline": False},
    "b": {"served_item": ITEMS["fire"]["id"]}, "per_unit": True})
H.check(":compare joins kh.served (served vs not served) with the rollback's helper",
        r.status_code == 200 and (r.json()["n_a"], r.json()["n_b"], r.json()["mean_a"], r.json()["mean_b"])
        == (40, 40, 0.9, 0.5), r.text)

r = c.post("/v1/shop/metrics:rollback", headers=AGENT, json={})
H.check("agent may not run the rollback -> 403", r.status_code == 403, r.text)
r = c.post("/v1/shop/metrics:rollback", headers=ORCH, json={"dry_run": True})
dry = {x["item_id"]: x for x in r.json()["items"]}
H.check("dry run reports decisions and changes nothing", r.status_code == 200 and dry[ITEMS["fire"]["id"]]["decision"]
        == "fire" and c.get(f"/v1/shop/items/{ITEMS['fire']['id']}", headers=ORCH).json()["status"] == "active", r.text)

# per-namespace lease: a holder elsewhere makes the check skip
with sqldb.connect() as conn:
    other = sqldb.lease_acquire(conn, sqldb.KH_NS, "metrics_rollback:shop", "other-instance", 60_000)
r = c.post("/v1/shop/metrics:rollback", headers=ORCH, json={})
H.check("while another instance holds the namespace lease the check skips (busy)",
        r.json().get("skipped") == "busy" and r.json()["fired"] == 0, r.text)
with sqldb.connect() as conn:
    sqldb.lease_release(conn, sqldb.KH_NS, "metrics_rollback:shop", "other-instance", other["epoch"])

# the 2-way race on one item: withdrawn once, one kh.item_rollback
res = H.race(2, lambda i: c.post("/v1/shop/metrics:rollback", headers=ORCH,
                                 json={"item_ids": [ITEMS["race"]["id"]]}).json())
with sqldb.connect() as conn:
    n_rb = conn.execute("SELECT COUNT(*) FROM kh_event WHERE ns='shop' AND kind='kh.item_rollback' AND body_json LIKE ?",
                        [f'%{ITEMS["race"]["id"]}%']).fetchone()[0]
st_race = c.get(f"/v1/shop/items/{ITEMS['race']['id']}", headers=ORCH).json()
H.check("RACE: two concurrent checks withdraw the item once (one kh.item_rollback)",
        st_race["status"] == "withdrawn" and n_rb == 1 and sum(x.get("fired", 0) for x in res) == 1, (res, n_rb))

# the cron, under the KH lease
ran, msg = sqldb.run_under_lease("metrics_rollback", 60, metrics._cron_rollback, holder="test-cron")
H.check("the cron runs under the KH lease and reports what it rolled back", ran and "shop:" in (msg or ""), msg)


def item(scen):
    return c.get(f"/v1/shop/items/{ITEMS[scen]['id']}", headers=ORCH).json()


for scen in ("fire", "edge30", "down", "real"):
    it = item(scen)
    H.check(f"FIRES: {scen} -> withdrawn, reason auto_rollback", it["status"] == "withdrawn"
            and it["status_reason"] == "auto_rollback" and it["actor"]["principal"] == "kh:metrics", it)
for scen, why in (("edge29", "n 29 < 30"), ("rel", "only -7.6 %"), ("nosig", "p >= 0.05"),
                  ("downok", "better in metric_dir down"), ("pre", "never served")):
    H.check(f"does NOT fire: {scen} ({why}) stays active", item(scen)["status"] == "active", item(scen)["status"])

with sqldb.connect() as conn:
    evs = [json.loads(r[0]) for r in conn.execute(
        "SELECT body_json FROM kh_event WHERE ns='shop' AND kind='kh.item_rollback'").fetchall()]
ev = next((e for e in evs if e["item_id"] == ITEMS["fire"]["id"]), {})
H.check("kh.item_rollback carries the evidence (n, means, rel_delta, p, test, thresholds)",
        ev.get("n_served") == 40 and ev.get("n_control") == 40 and ev.get("mean_control") == 0.9
        and ev.get("mean_served") == 0.5 and ev.get("p") < 0.05 and ev.get("test") == "proportion"
        and ev.get("reason") == "auto_rollback" and ev.get("status") == "withdrawn"
        and ev.get("thresholds") == {"min_n": 30, "min_rel": 0.1, "alpha": 0.05}, ev)
H.check("Mann-Whitney is used for the real-valued series", next(e for e in evs if e["item_id"] == ITEMS["down"]["id"])
        ["test"] == "mann_whitney")
with sqldb.connect() as conn:
    hist = conn.execute("SELECT COUNT(*) FROM kh_event WHERE ns='shop' AND kind='kh.item_rollback'").fetchone()[0]
H.check("one kh.item_rollback per withdrawn item", hist == 5, hist)

# a crash between contested and withdrawn is finished by the next run
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_item SET status='contested', status_reason='auto_rollback', rev=rev+1 "
                 "WHERE ns='shop' AND item_id=?", [ITEMS["nosig"]["id"]])
r = c.post("/v1/shop/metrics:rollback", headers=ORCH, json={})
H.check("a half-done rollback (contested, auto_rollback) is completed to withdrawn",
        item("nosig")["status"] == "withdrawn" and r.json()["fired"] == 1, r.text)
H.check("a second run changes nothing more", c.post("/v1/shop/metrics:rollback", headers=ORCH, json={}).json()["fired"]
        == 0)

# the pure rule: control pre_activation, and settings disable it
it = {"item_id": "x", "guard_metric": "g_fire", "metric_dir": "up", "activated_ms": 10_000}
obs = ([{"unit_id": f"p{i}", "ts_ms": 5_000, "value": 1.0, "baseline": False} for i in range(40)]
       + [{"unit_id": f"s{i}", "ts_ms": 20_000, "value": 0.0 if i < 20 else 1.0, "baseline": False} for i in range(40)]
       + [{"unit_id": f"q{i}", "ts_ms": 20_000, "value": 0.0, "baseline": False} for i in range(40)])
conf = {**metrics.ROLLBACK_DEFAULTS, "control": "pre_activation"}
ev = metrics.evaluate({"ns": "x"}, it, obs, {f"s{i}" for i in range(40)}, conf)
H.check("control pre_activation compares served units with the units before activation only",
        ev["decision"] == "fire" and ev["n_control"] == 40 and ev["mean_control"] == 1.0, ev)
ev = metrics.evaluate({"ns": "x"}, it, obs, {f"s{i}" for i in range(40)}, {**conf, "min_n": 50})
H.check("thresholds come from settings.metrics.rollback", ev["decision"] == "insufficient", ev)
def etag():
    return c.get("/v1/shop/manifest", headers=OWNER).headers["ETag"]


r = c.put("/v1/shop/manifest", headers={**OWNER, "If-Match": etag()}, json={**MANIFEST, "settings": {
    **MANIFEST["settings"], "metrics": {**MANIFEST["settings"]["metrics"], "rollback": {"enabled": False}}}})
H.check("manifest re-applied with the rollback disabled", r.status_code == 200, r.text)
r = c.post("/v1/shop/metrics:rollback", headers=ORCH, json={})
H.check("rollback.enabled false: the check skips", r.json().get("skipped") == "disabled", r.text)

# a metric type with rows cannot be removed
r = c.put("/v1/shop/manifest", headers={**OWNER, "If-Match": etag()}, json={**MANIFEST, "types": [t for t in MANIFEST["types"]
                                                                          if t["type"] != "latency"]})
H.check("removing a metric type that has rows -> 409 type_in_use", r.status_code == 409, r.text)

H.done()
