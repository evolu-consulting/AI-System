"""Contract test: app/caps/retrieval.py (stage F7, keyed per-step retrieval for namespaces).

  1. POST /v1/{ns}/context/step: the exact key tier (active, not expired, this project first, then cross),
     the wildcard tier (last dimension '*'), meaning (namespace vectors re-checked in SQL), rules (1 hop),
     packs through the provider hook; proposed / withdrawn / expired / other-project / other-stack items are
     never served.
  2. Budget: the pack stays within budget_chars, the cut is reported, dropped ids listed; tiers subset.
  3. kh.served: one event per response with serve_id, served ids, item ids and the run / unit headers.
  4. Sharing (D20 revised 2026-10-11): people lanes on by default (opt out through the manifest), people's rows
     capped at cross_share of the budget, proposed items served last and marked, triggered items only in their
     situation, the people-side agents tier, projects:match; grants (403), role matrix, validation (422).

    .venv\\Scripts\\python tests\\caps\\test_retrieval.py
"""
from harness import H

import hashlib
import json
import re

import numpy

import os
import shutil
import tempfile

from app import config, sqldb

KUZU_TMP = tempfile.mkdtemp(prefix="kh_retr_kuzu_")
config.KUZU_PROJECTS_PATH = KUZU_TMP      # the rules projection stays out of the repo
from app.caps import core, retrieval
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


class _Model:
    @staticmethod
    def _one(text):
        v = numpy.zeros(128, dtype="float32")
        for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
            if len(w) > 2:
                v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 128] += 1.0
        n = numpy.linalg.norm(v)
        return v / n if n else v

    @classmethod
    def encode(cls, text, normalize_embeddings=True):
        return cls._one(text)


c.app.state.model = _Model()

MANIFEST = {
    "types": [{"type": "lesson", "kind_of": "item", "confirm_policy": {"roles": ["confirmer"]}},
              {"type": "tick", "kind_of": "event"}],
    "keyspaces": [{"keyspace": "step", "dims": ["role", "step", "stack"], "config": {"cross_after_projects": 2}}],
    "settings": {"retrieval": {"floor": 0.3}},
}
r = c.put("/v1/admin/ns/shop", json={"projects": ["alpha", "beta"]}, headers=OWNER)
H.check("namespace attached", r.status_code in (200, 201), r.text)
r = c.put("/v1/shop/manifest", headers=OWNER, json=MANIFEST)
H.check("manifest applied", r.status_code == 200, r.text)
r = c.get("/v1/capabilities", headers=OWNER)
H.check("retrieval is listed in discovery", any(x["name"] == "retrieval" for x in r.json()["capabilities"]), r.text)

DIST = as_("dist", "distiller", run="run-1")
CONF = as_("conf", "confirmer")
JAVA = {"role": "dev", "step": "build", "stack": "java"}


def make(text, key, project="alpha", activate=True, run="run-1", **extra):
    r = c.post("/v1/shop/items", headers=as_("dist", "distiller", run=run),
               json={"kind": "lesson", "keyspace": "step", "key": key, "project": project, "text": text, **extra})
    assert r.status_code == 201, r.text
    it = r.json()["item"]
    if activate:
        r = c.patch(f"/v1/shop/items/{it['id']}", headers=CONF, json={"status": "active"})
        assert r.status_code == 200, r.text
        it = r.json()["item"]
    return it


A = make("Run the unit tests before the build.", JAVA)
B = make("Use the beta mirror for java builds.", JAVA, project="beta", run="run-b", bound="generic")
C = make("Clean the workspace before any build.", {"role": "dev", "step": "build", "stack": "*"})
D = make("Pin the python interpreter version.", {"role": "dev", "step": "build", "stack": "python"})
E = make("Check the gradle wrapper checksum.", JAVA, activate=False)
F = make("Cache docker layers to speed up deploys.", {"role": "dev", "step": "deploy", "stack": "java"})
G = make("Retry flaky integration tests once.", JAVA)
W = make("Sign the artifacts after the build.", JAVA)
c.patch(f"/v1/shop/items/{W['id']}", headers=CONF, json={"status": "withdrawn"})
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_item SET expires_ms=1 WHERE ns='shop' AND item_id=?", [G["id"]])


def step(body, headers=None):
    return c.post("/v1/shop/context/step", headers=headers or as_("agent-1", "agent", run="run-9", unit="u-3"),
                  json={"project": "alpha", "keyspace": "step", "key": JAVA, **body})


def served_kh():
    with sqldb.connect() as conn:
        return [json.loads(x["body_json"]) | {"_run": x["run_id"], "_unit": x["unit_id"]} for x in conn.execute(
            "SELECT body_json, run_id, unit_id FROM kh_event WHERE ns='shop' AND kind='kh.served' ORDER BY seq")]


# ── 1. tiers ─────────────────────────────────────────────────────────────────
r = step({"query": "cache docker layers for deploys"})
out = r.json()
H.check("STEP: 200 with a serve id and pack text", r.status_code == 200 and out["serve_id"].startswith("sv_")
        and out["pack_text"], r.text)
by_tier = {}
for s in out.get("served", []):
    by_tier.setdefault(s["tier"], []).append(s["id"])
H.check("KEY: the exact key serves the active alpha item, then the proposed one (D20 revised)",
        by_tier.get("key") == [A["id"], E["id"]], by_tier)
H.check("KEY: a proposed item is marked unverified",
        f"{E['id']} lesson [dev/build/java] [unverified] Check the gradle" in out["pack_text"], out["pack_text"])
H.check("KEY-WILDCARD: the '*' stack item follows", by_tier.get("key-wildcard") == [C["id"]], by_tier)
H.check("MEANING: the namespace item closest to the query", F["id"] in by_tier.get("meaning", []), by_tier)
ids = {s["id"] for s in out["served"]}
H.check("NEVER: withdrawn, expired, another stack, another project's item",
        not ids & {W["id"], G["id"], D["id"], B["id"]}, ids)
H.check("ORDER: key, then key-wildcard, then meaning", out["tiers"][:3] == ["key", "key-wildcard", "meaning"],
        out["tiers"])
H.check("TEXT: a line names id, kind and key", f"{A['id']} lesson [dev/build/java] Run the unit tests" in
        out["pack_text"], out["pack_text"])
H.check("SERVED: chars per row add up to the pack", sum(s["chars"] for s in out["served"]) + len(out["served"]) - 1
        == len(out["pack_text"]) == out["used_chars"], out)

ev = served_kh()
H.check("KH.SERVED: one event per response", len(ev) == 1, ev)
e = ev[-1]
H.check("KH.SERVED: serve id, key, served rows and item ids",
        e["serve_id"] == out["serve_id"] and e["key"] == JAVA and e["served"] == out["served"]
        and set(e["item_ids"]) == {A["id"], E["id"], C["id"], F["id"]}, e)
H.check("KH.SERVED: carries the run and unit headers", e["_run"] == "run-9" and e["_unit"] == "u-3", e)
H.check("STEP: the response lists the namespace item ids", set(out["item_ids"]) == set(e["item_ids"]), out)

# cross scope: B gets independent support from alpha and is promoted (cross_after_projects 2)
r = c.post(f"/v1/shop/items/{B['id']}:support", headers=DIST, json={"project": "alpha", "run_id": "run-x"})
H.check("CROSS: B promoted to cross", r.status_code == 200 and r.json()["item"]["scope"] == "cross", r.text)
out = step({}).json()
keyed = [s["id"] for s in out["served"] if s["tier"] == "key"]
H.check("CROSS: a cross item is served after the project's own, proposed ones last",
        keyed == [A["id"], B["id"], E["id"]], keyed)
H.check("NO QUERY: no meaning tier", "meaning" not in out["tiers"], out["tiers"])

# ── 2. budget and tiers ──────────────────────────────────────────────────────
for i, w in enumerate(["kestrel", "harrier", "osprey", "merlin", "falcon", "buzzard", "condor", "vulture"]):
    make(f"Verify the {w} build step keeps the {w} cache warm " + w * 15, JAVA, run=f"r{i}")
r = step({"budget_chars": 400})
out = r.json()
H.check("BUDGET: the pack stays within budget_chars", r.status_code == 200 and len(out["pack_text"]) <= 400
        and out["cut_at_budget"], (len(out["pack_text"]), out.get("cut_at_budget")))
H.check("BUDGET: rows left out are listed", out["dropped"] and all(d["id"] for d in out["dropped"]), out["dropped"])
H.check("BUDGET: kh.served lists only what was served", served_kh()[-1]["served"] == out["served"])
r = step({"tiers": ["key-wildcard"]})
H.check("TIERS: a subset runs only those tiers", r.json()["tiers"] == ["key-wildcard"], r.json()["tiers"])
r = step({"limit": 2})
H.check("LIMIT: per-tier limit", len([s for s in r.json()["served"] if s["tier"] == "key"]) == 2, r.json()["served"])

# ── rules and packs ──────────────────────────────────────────────────────────
r = c.put("/v1/shop/rules/r-billing", headers=OWNER, json={"project": "alpha", "entity": "Billing",
                                                           "attribute": "currency", "condition": "invoice issued",
                                                           "effect": "currency is EUR"})
H.check("RULES: a rule written", r.status_code in (200, 201), r.text)
r = step({"entities": ["billing"], "tiers": ["rules"]})
H.check("RULES: rules of the named entity, 1 hop", [s["id"] for s in r.json()["served"]] == ["r-billing"]
        and "currency is EUR" in r.json()["pack_text"], r.text)
retrieval.PROVIDERS["packs"] = lambda ctx, req: [{"id": "q-1", "text": f"quote for {req['key']['key']['step']}"}]
r = step({"tiers": ["packs"]})
H.check("PACKS: the provider hook fills the packs tier", r.json()["served"] == [{"tier": "packs", "id": "q-1",
                                                                                 "chars": len("quote for build")}],
        r.text)
retrieval.PROVIDERS["packs"] = lambda ctx, req: 1 / 0
r = step({"tiers": ["key", "packs"]})
H.check("PACKS: a failing provider costs only its own tier", r.status_code == 200
        and r.json().get("failed_tiers") == ["packs"] and r.json()["tiers"] == ["key"], r.text)
retrieval.PROVIDERS.pop("packs")

# ── 4. isolation and errors ──────────────────────────────────────────────────
out = step({"query": "unit tests"}).json()
H.check("SHARING: people lanes are on by default (D20 revised)", out["people_lanes"] is True, out)
m = json.loads(json.dumps(MANIFEST))
m["settings"]["retrieval"]["include_people_lanes"] = False
etag = c.get("/v1/shop/manifest", headers=OWNER).headers["etag"]
r = c.put("/v1/shop/manifest", headers={**OWNER, "If-Match": etag}, json=m)
H.check("SHARING: the manifest opts out", r.status_code == 200, r.text)
from app.caps import registry  # noqa: E402
registry.invalidate("shop")
r = step({"query": "unit tests"})
H.check("SHARING: opted out, no people lane and the key tier still served",
        r.status_code == 200 and r.json()["people_lanes"] is False and A["id"] in r.json()["item_ids"]
        and all(i.get("lane") != "people" for i in r.json()["items"]), r.text)
etag = c.get("/v1/shop/manifest", headers=OWNER).headers["etag"]
c.put("/v1/shop/manifest", headers={**OWNER, "If-Match": etag}, json=MANIFEST)
registry.invalidate("shop")

# cross_share: people's rows never take more than their share of the budget
from app import step as kh_step  # noqa: E402
_real_by_meaning = kh_step._by_meaning


async def _fake_people(text, scope, project, k, model):
    return [{"vector_id": f"vec_people_{scope}_{i}", "score": 0.9, "source_text": "P" * 300,
             "metadata": {"project": project}} for i in range(10)]
kh_step._by_meaning = _fake_people
out = step({"query": "unit tests", "budget_chars": 6000}).json()
kh_step._by_meaning = _real_by_meaning
people_chars = sum(len(i["text"]) + 1 for i in out["items"] if i.get("lane") == "people")
H.check("SHARING: people's rows stay within cross_share (0.4) of the budget",
        0 < people_chars <= 2400 and any(d.get("reason") == "cross_share" for d in out["dropped"])
        and A["id"] in out["item_ids"], (people_chars, out["dropped"][:3]))

# situations: an item with triggers is served only when the step names one
T = make("Check whether a member just ordered the worker processes stopped.", {"role": "ops"}, triggers=["crash"])
OPS_KEY = {"role": "ops", "step": "*", "stack": "*"}
r = c.post("/v1/shop/context/step", headers=as_("agent-1", "agent"),
           json={"project": "alpha", "keyspace": "step", "key": OPS_KEY})
H.check("SITUATION: a triggered item is not served without its situation", T["id"] not in r.json()["item_ids"],
        r.text)
r = c.post("/v1/shop/context/step", headers=as_("agent-1", "agent"),
           json={"project": "alpha", "keyspace": "step", "key": OPS_KEY, "situation": "crash"})
H.check("SITUATION: ... and served when the step names it", T["id"] in r.json()["item_ids"], r.text)
r = c.post("/v1/shop/context/step", headers=as_("agent-1", "agent"),
           json={"project": "alpha", "keyspace": "step", "key": OPS_KEY, "situation": "Bad Name"})
H.check("SITUATION: an invalid situation is 422", r.status_code == 422, r.text)

# the other direction: a person's step on alpha sees the namespace's findings for alpha
got = retrieval.people_items("alpha", "the service had a crash after the deploy")
H.check("PEOPLE: a person's step naming the situation gets the triggered finding",
        any(x["ns"] == "shop" and x["item"]["id"] == T["id"] and x["why"] == "trigger" for x in got), got)
got = retrieval.people_items("alpha", "the service is slow")
H.check("PEOPLE: ... and not when it does not", all(x["item"]["id"] != T["id"] for x in got), got)
got = retrieval.people_items("gamma", "the service had a crash")
H.check("PEOPLE: a project the namespace is not attached to gets nothing", got == [], got)
class _Res:
    hits = []


async def _recent(**kw):
    return _Res()
kh_step.attach(c.app, _recent)
os.environ["KH_STEP_NS_ITEMS"] = "1"
r = c.post("/context/step", headers=OWNER, json={"text": "what to check after a crash", "project": "alpha"})
os.environ.pop("KH_STEP_NS_ITEMS")
ag = [i for i in r.json().get("items", []) if i["tier"] == "agents"]
H.check("PEOPLE: /context/step packs the finding in the agents tier when KH_STEP_NS_ITEMS=1",
        r.status_code == 200 and any(i["id"] == T["id"] and i["ns"] == "shop" for i in ag), r.text[:600])
r = c.post("/context/step", headers=OWNER, json={"text": "what to check after a crash", "project": "alpha"})
H.check("PEOPLE: off by default, no agents tier", all(i["tier"] != "agents" for i in r.json().get("items", [])),
        r.text[:300])
H.check("PEOPLE: the namespace logs what people were served",
        any(e.get("lane") == "people" and T["id"] in e["item_ids"] for e in served_kh()), served_kh()[-1:])

# worklog: an agent's line lands in the project's own worklog (the lane people read)
WL = {"project": "alpha", "subject": "human questions off",
      "text": "Run R1, question Q1: decided by model:x without a person. Chosen: keep_b. Reason: the spec says so."}
r = c.post("/v1/shop/worklog", headers=as_("agent-1", "agent", run="run-w"), json=WL)
H.check("WORKLOG: an agent writes a worklog line (200, id)", r.status_code == 200 and r.json()["id"].startswith("vec_"),
        r.text)
wid = r.json().get("id")
from app import hotlog  # noqa: E402
from app.vector_store import get_ids_vt, hotlog_collection  # noqa: E402
rows = get_ids_vt([wid], collection=hotlog_collection()) if wid else []
meta = (rows[0].get("metadata") if rows else {}) or {}
H.check("WORKLOG: stored in the project's worklog lane with subject, ts and the agent as author",
        bool(rows) and meta.get("subject") == "human questions off" and meta.get("ts")
        and meta.get(hotlog.AUTHOR_KEY) == "ns:shop/agent-1" and meta.get("scope") == hotlog.config.HOTLOG_SCOPE,
        rows[:1])
r2 = c.post("/v1/shop/worklog", headers=as_("agent-1", "agent"), json=WL)
H.check("WORKLOG: the same line again is the same row", r2.status_code == 200 and r2.json()["id"] == wid, r2.text)
r = c.post("/v1/shop/worklog", headers=as_("d", "distiller"), json=WL)
H.check("WORKLOG: a role without worklog:append is 403", r.status_code == 403, r.text)
r = c.post("/v1/shop/worklog", headers=as_("agent-1", "agent"), json={**WL, "project": "zeta"})
H.check("WORKLOG: a project outside the namespace is 403", r.status_code == 403, r.text)
r = c.post("/v1/shop/worklog", headers=as_("agent-1", "agent"), json={**WL, "text": ""})
H.check("WORKLOG: text is required (422)", r.status_code == 422, r.text)

# intake: which attached project does incoming work belong to
from app import projects as kh_projects  # noqa: E402
for pid in ("alpha", "beta"):
    kh_projects.get_or_create_project(pid, descriptor=f"The {pid} test project.")
r = c.post("/v1/shop/projects:match", headers=as_("intake", "orchestrator"), json={"text": "a bug in alpha"})
H.check("MATCH: the attached project named in the text is the best match",
        r.status_code == 200 and r.json()["best"] == "alpha" and r.json()["candidates_total"] == 2, r.text)
r = c.post("/v1/shop/projects:match", headers=as_("intake", "orchestrator"), json={"text": "something unrelated"})
H.check("MATCH: no match is a real answer (best null)", r.status_code == 200 and r.json()["best"] is None, r.text)
r = c.post("/v1/shop/projects:match", headers=as_("intake", "orchestrator"), json={})
H.check("MATCH: text is required (422)", r.status_code == 422, r.text)

r = step({}, headers=as_("x", "agent", projects=["beta"]))
H.check("GRANT: a project outside the caller's grant is 403", r.status_code == 403, r.text)
r = step({}, headers=as_("g", "grader"))
H.check("ROLE: a grader has no retrieval (403)", r.status_code == 403, r.text)
r = c.post("/v1/shop/context/step", headers=as_("a"), json={"project": "alpha", "keyspace": "nope", "key": {}})
H.check("INVALID: unknown keyspace 422", r.status_code == 422, r.text)
r = step({"budget_chars": 50000})
H.check("INVALID: budget above 20000 is 422", r.status_code == 422, r.text)
r = step({"tiers": ["bogus"]})
H.check("INVALID: unknown tier 422", r.status_code == 422, r.text)
n = len(served_kh())
step({"budget_chars": 50000})
H.check("INVALID: a refused request writes no kh.served", len(served_kh()) == n)

shutil.rmtree(KUZU_TMP, ignore_errors=True)
H.done()
