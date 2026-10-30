"""Contract test: app/caps/items.py (stage F7, knowledge-item lifecycle).

  1. Propose: 201 proposed / scope project / evidence 1, kinds are manifest item types, keyspace + key dims,
     unknown fields, attrs JSON Schema with pointers, role matrix + ACL, redaction masks, leak gate 422.
  2. Duplicates: same key + kind + normalized text = merged support (same id); by meaning with an embedder.
  3. Staged scope: independent support from N=3 projects (a run shared by two projects counts once) promotes
     to cross + kh.item_promoted; a project-scoped item is invisible outside its project until then.
  4. Lint before active (imperative first word, hedges, length, guard registry) + :lint dry run.
  5. confirm_policy: roles, a human confirmer by e-mail, quorum 2, auto_after_evidence; withdraw, supersede,
     reopen, invalid transitions 409, If-Match 409 write_conflict + event, require_if_match 428.
  6. contradicts / updates; TTL expiry sweep; list filters (unproven alias), :patterns; Idempotency-Key.
  7. RACES: identical proposals from 6 threads (one 201, one id, 6 supports); 6 confirms with the same If-Match.
  8. Vectors rebuilt from SQL (:reindex, vec_rev); type_in_use.

    .venv\\Scripts\\python tests\\caps\\test_items.py
"""
from harness import H

import hashlib
import json
import re

import numpy

from app import sqldb
from app.caps import core, items
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha", "beta", "gamma", "delta"])
HANA = H.person("hana@x.io", member=["alpha"])
BOB = H.person("bob@x.io", member=["alpha"])


def as_(principal, role="distiller", projects=None, run=None):
    h = {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}
    if projects is not None:
        h["X-Test-Projects"] = ",".join(projects)
    if run:
        h["X-KH-Run"] = run
    return h


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    if not p:
        return None
    pr = request.headers.get("x-test-projects")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service",
                  on_behalf_of=request.headers.get("x-test-obo"),
                  projects=set(x for x in pr.split(",") if x) if pr is not None else None)


core.CALLER_RESOLVERS.append(_test_resolver)

MANIFEST = {
    "schemas": [{"name": "lesson_attrs", "version": 1,
                 "schema": {"type": "object", "properties": {"severity": {"type": "string"}}}},
                {"name": "guard", "version": 1, "schema": {"type": "object"}}],
    "types": [
        {"type": "lesson", "kind_of": "item", "schema": "lesson_attrs",
         "confirm_policy": {"roles": ["confirmer"], "emails": ["hana@x.io"]}},
        {"type": "fact", "kind_of": "item", "confirm_policy": {"roles": ["confirmer"], "quorum": 2}},
        {"type": "habit", "kind_of": "item", "confirm_policy": {"auto_after_evidence": 2}},
        {"type": "note", "kind_of": "item", "require_if_match": True, "write_roles": ["admin"]},
        {"type": "guard", "kind_of": "record", "schema": "guard", "write_roles": ["admin"],
         "read_roles": ["agent", "distiller"]},
        {"type": "tick", "kind_of": "event"},
    ],
    "keyspaces": [{"keyspace": "step", "dims": ["role", "step", "stack"]},
                  {"keyspace": "tiny", "dims": ["topic"], "config": {"ttl_days": 1, "cross_after_projects": 2}}],
    "settings": {"items": {"guard_type": "guard"}},
}
r = c.put("/v1/admin/ns/acme", json={"projects": ["alpha", "beta", "gamma", "delta"]}, headers=OWNER)
H.check("namespace attached", r.status_code in (200, 201), r.text)
r = c.put("/v1/acme/manifest", headers=OWNER, json=MANIFEST)
H.check("manifest with item types and keyspaces applied", r.status_code == 200, r.text)
r = c.get("/v1/capabilities", headers=OWNER)
H.check("items is listed in discovery", any(x["name"] == "items" for x in r.json()["capabilities"]), r.text)


def kh_events(kind):
    with sqldb.connect() as conn:
        return [json.loads(x["body_json"]) for x in conn.execute(
            "SELECT body_json FROM kh_event WHERE ns='acme' AND kind=? ORDER BY seq", [kind]).fetchall()]


JAVA = {"role": "dev", "step": "build", "stack": "java"}


def item(text, key=None, kind="lesson", project="alpha", keyspace="step", **extra):
    return {"kind": kind, "keyspace": keyspace, "key": key or JAVA, "project": project, "text": text, **extra}


DIST = as_("dist-1", "distiller", run="run-a")
CONF = as_("conf-1", "confirmer")

# ── 1. propose ───────────────────────────────────────────────────────────────
r = c.post("/v1/acme/items", headers=DIST, json=item("Run the unit tests before every build.",
                                                       attrs={"severity": "high"}, guard_names=[], bound="generic",
                                                       provenance={"event_ids": ["ev1"]}))
H.check("PROPOSE: 201 with an ETag", r.status_code == 201 and r.headers.get("etag") == '"2"', (r.status_code, r.text))
L1 = r.json()["item"]
H.check("PROPOSE: proposed, scope project, evidence 1, lint clean",
        L1["status"] == "proposed" and L1["scope"] == "project" and L1["evidence_count"] == 1
        and r.json()["lint"] == [] and r.json()["result"] == "accepted", r.json())
H.check("PROPOSE: provenance holds the run header and the event ids",
        L1["provenance"] == {"runs": ["run-a"], "event_ids": ["ev1"]}, L1["provenance"])
H.check("PROPOSE: the key is stored with every dimension", L1["key"] == JAVA and L1["keyspace"] == "step", L1)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", key={"role": "dev"}))
H.check("PROPOSE: a missing key dimension is '*'", r.status_code == 201
        and r.json()["item"]["key"] == {"role": "dev", "step": "*", "stack": "*"}, r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", kind="nope"))
H.check("PROPOSE: unknown kind 404", r.status_code == 404, r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", kind="guard"))
H.check("PROPOSE: a record type is not an item kind (422)", r.status_code == 422, r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", keyspace="nope"))
H.check("PROPOSE: unknown keyspace 422", r.status_code == 422 and "keyspace" in r.json()["detail"], r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", key={"role": "dev", "colour": "red"}))
H.check("PROPOSE: unknown key dimension 422", r.status_code == 422 and "colour" in r.json()["detail"], r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", attrs={"severity": 3}, bogus=1))
errs = r.json().get("errors") or []
H.check("PROPOSE: unknown field and attrs schema errors with pointers (422)",
        r.status_code == 422 and {"/bogus", "/attrs/severity"} <= {e["pointer"] for e in errs}, r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item(""))
H.check("PROPOSE: text is required", r.status_code == 422, r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", project="zeta"))
H.check("PROPOSE: a project outside the namespace is 403", r.status_code == 403, r.text)
for role in ("confirmer", "judge"):
    r = c.post("/v1/acme/items", headers=as_("x", role), json=item("Run it again."))
    H.check(f"PROPOSE: role {role} may not propose (403)", r.status_code == 403, r.text)
# D20 revised: an agent records a finding itself (proposed; a confirmer activates it), with a trigger
OPS = {"role": "ops"}
r = c.post("/v1/acme/items", headers=as_("agent-1", "agent"),
           json=item("Check whether a member just ordered the worker processes stopped.", key=OPS,
                     triggers=["crash"]))
H.check("PROPOSE: an agent may propose a finding (proposed, bound project by default, triggers kept)",
        r.status_code == 201 and r.json()["item"]["status"] == "proposed" and r.json()["item"]["bound"] == "project"
        and r.json()["item"]["triggers"] == ["crash"], r.text)
FIND = r.json()["item"]
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", key=OPS, bound="nope", triggers=["Bad Name"]))
H.check("PROPOSE: bound and triggers are validated (422 with pointers)",
        r.status_code == 422 and {"/bound", "/triggers"} <= {e["pointer"] for e in r.json().get("errors") or []},
        r.text)
H.check("TRIGGERS: an item with triggers is served only in a named situation",
        items.triggered(FIND, "crash") and not items.triggered(FIND, None) and not items.triggered(FIND, "deploy")
        and items.triggered({"triggers": []}, None))
r = c.post("/v1/acme/items", headers=DIST, json=item("Pin it.", kind="note"))
H.check("PROPOSE: a type ACL (write_roles admin) narrows the distiller (403)", r.status_code == 403, r.text)
r = c.post("/v1/acme/items", headers=OWNER, json=item("Pin the note.", kind="note"))
H.check("PROPOSE: the namespace admin passes the ACL", r.status_code == 201, r.text)
NOTE = r.json()["item"]

r = c.post("/v1/acme/items", headers=DIST, json=item("Notify ops@example.com when the build fails."))
H.check("REDACT: an e-mail is masked before storage (kh-default)",
        r.status_code == 201 and "ops@example.com" not in r.json()["item"]["text"]
        and "REDACTED" in r.json()["item"]["text"], r.text)
H.check("REDACT: kh.redacted names the items write path",
        any(e["where"] == "items/lesson" for e in kh_events("kh.redacted")), kh_events("kh.redacted")[-1:])
_real_leak = items._leak
items._leak = lambda text: "secret-thing" if "zebra" in text else None
r = c.post("/v1/acme/items", headers=DIST, json=item("Never print the zebra token."))
items._leak = _real_leak
H.check("LEAK GATE: refused with 422 leak_refused", r.status_code == 422 and r.json()["error"] == "leak_refused",
        r.text)

# ── 2. duplicates ────────────────────────────────────────────────────────────
r = c.post("/v1/acme/items", headers=as_("dist-2", "distiller", run="run-b"),
           json=item("  run the UNIT tests   before every build. ", project="beta"))
H.check("DUPLICATE: same key + normalized text is merged (200, same id)",
        r.status_code == 200 and r.json()["result"] == "merged" and r.json()["item"]["id"] == L1["id"], r.text)
d = r.json()["item"]
H.check("DUPLICATE: support and provenance merged", d["evidence_count"] == 2 and d["support_projects"] ==
        ["alpha", "beta"] and d["provenance"]["runs"] == ["run-a", "run-b"], d)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run the unit tests before every build.",
                                                       key={"role": "dev", "step": "test", "stack": "java"}))
H.check("DUPLICATE: the same text under another key is another item", r.status_code == 201
        and r.json()["item"]["id"] != L1["id"], r.text)

# ── 3. staged scope ──────────────────────────────────────────────────────────
BETA_ONLY = as_("reader", "agent", projects=["beta"])
r = c.get(f"/v1/acme/items/{L1['id']}", headers=BETA_ONLY)
H.check("SCOPE: a project-scoped item is invisible outside its project (404)", r.status_code == 404, r.text)
r = c.get(f"/v1/acme/items/{L1['id']}", headers=as_("reader", "agent", projects=["alpha"]))
H.check("SCOPE: ... and visible inside it", r.status_code == 200, r.text)
r = c.post(f"/v1/acme/items/{L1['id']}:support", headers=DIST, json={"project": "gamma", "run_id": "run-a"})
H.check("SCOPE: a run already cited by another project is not independent (no promotion)",
        r.status_code == 200 and not r.json()["promoted"] and r.json()["item"]["scope"] == "project", r.text)
r = c.post(f"/v1/acme/items/{L1['id']}:support", headers=DIST, json={"project": "gamma", "run_id": "run-a"})
H.check("SCOPE: the same support twice is not new", r.status_code == 200 and not r.json()["new_support"], r.text)
r = c.post(f"/v1/acme/items/{L1['id']}:support", headers=DIST, json={"project": "delta", "run_id": "run-d"})
H.check("SCOPE: 2 independent projects (beta, delta) of 3 do not promote",
        r.status_code == 200 and r.json()["item"]["scope"] == "project", r.text)
r = c.post(f"/v1/acme/items/{L1['id']}:support", headers=DIST, json={"project": "gamma", "run_id": "run-g",
                                                                      "event_ids": ["ev9"]})
H.check("SCOPE: a third independent project promotes to cross",
        r.status_code == 200 and r.json()["promoted"] and r.json()["item"]["scope"] == "cross", r.text)
prom = kh_events("kh.item_promoted")
H.check("SCOPE: kh.item_promoted written once with the projects",
        len(prom) == 1 and prom[0]["id"] == L1["id"] and len(prom[0]["projects"]) >= 3, prom)
H.check("SCOPE: independent_projects ignores shared runs",
        items.independent_projects([("a", "r1"), ("b", "r1"), ("c", "r2"), ("d", "")]) == ["c", "d"])
r = c.get(f"/v1/acme/items/{L1['id']}", headers=BETA_ONLY)
H.check("SCOPE: a cross item is visible from every project", r.status_code == 200, r.text)
r = c.post(f"/v1/acme/items/{L1['id']}:support", headers=as_("reader", "judge"), json={"project": "beta"})
H.check("SUPPORT: needs items:propose (403 for a judge)", r.status_code == 403, r.text)
# D20 revised: a project-bound item (business, systems, people) never leaves its project
for p, run in (("beta", "run-pb"), ("gamma", "run-pg"), ("delta", "run-pd")):
    r = c.post(f"/v1/acme/items/{FIND['id']}:support", headers=DIST, json={"project": p, "run_id": run})
H.check("SCOPE: a project-bound item stays in its project after 3 independent projects",
        r.status_code == 200 and not r.json()["promoted"] and r.json()["item"]["scope"] == "project", r.text)

# ── 4. lint ──────────────────────────────────────────────────────────────────
r = c.post("/v1/acme/items:lint", headers=DIST, json={"text": "Maybe consider caching the layers."})
H.check("LINT: a hedge and a non-imperative first word", r.status_code == 200 and not r.json()["ok"]
        and any("hedge" in e for e in r.json()["errors"]) and any("first word" in e for e in r.json()["errors"]),
        r.text)
r = c.post("/v1/acme/items:lint", headers=DIST, json={"text": "Never skip the tests. " + "x" * 400})
H.check("LINT: more than 400 characters", any("400" in e for e in r.json()["errors"]), r.text)
r = c.post("/v1/acme/items:lint", headers=DIST, json={"text": "Always pin versions.", "guard_names": ["g-ok"]})
H.check("LINT: an unknown guard name", any("g-ok" in e for e in r.json()["errors"]), r.text)
r = c.put("/v1/acme/records/guard/g-ok?project=alpha", headers=OWNER, json={"pattern": "x"})
H.check("LINT: guard registered by the admin", r.status_code in (200, 201), r.text)
r = c.post("/v1/acme/items:lint", headers=DIST, json={"text": "Always pin versions.", "guard_names": ["g-ok"]})
H.check("LINT: a registered guard and an imperative text pass", r.json() == {"ok": True, "errors": []}, r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Maybe the cache is stale."))
BAD = r.json()["item"]
H.check("LINT: a proposal is stored with its lint report", r.status_code == 201 and r.json()["lint"], r.text)
r = c.patch(f"/v1/acme/items/{BAD['id']}", headers=CONF, json={"status": "active"})
H.check("LINT: activation refused with 422 lint_failed and the list",
        r.status_code == 422 and r.json()["error"] == "lint_failed" and r.json()["lint"], r.text)

# ── 5. confirm policy and transitions ────────────────────────────────────────
for hdr, who in ((as_("a", "agent"), "agent"), (DIST, "distiller (not in roles)")):
    r = c.patch(f"/v1/acme/items/{L1['id']}", headers=hdr, json={"status": "active"})
    H.check(f"CONFIRM: {who} may not confirm (403)", r.status_code == 403, r.text)
r = c.get(f"/v1/acme/items/{L1['id']}", headers=CONF)
etag = r.headers["etag"]
r = c.patch(f"/v1/acme/items/{L1['id']}", headers={**CONF, "If-Match": '"1"'}, json={"status": "active"})
H.check("IF-MATCH: a stale ETag is 409 write_conflict with the current item",
        r.status_code == 409 and r.json()["error"] == "write_conflict" and r.json()["current"]["id"] == L1["id"],
        r.text)
H.check("IF-MATCH: kh.write_conflict written", any(e.get("id") == L1["id"] for e in kh_events("kh.write_conflict")))
r = c.patch(f"/v1/acme/items/{L1['id']}", headers={**CONF, "If-Match": etag}, json={"status": "active"})
A1 = r.json().get("item") or {}
H.check("CONFIRM: the confirmer role activates (If-Match)", r.status_code == 200 and A1["status"] == "active", r.text)
H.check("TTL: expires 90 days after the confirmation", A1["expires_ms"] - A1["last_confirmed_ms"] == 90 * 86400000
        and A1["activated_ms"] == A1["last_confirmed_ms"], A1)
r = c.patch(f"/v1/acme/items/{NOTE['id']}", headers=OWNER, json={"status": "withdrawn"})
H.check("IF-MATCH: a require_if_match type answers 428 without If-Match", r.status_code == 428, r.text)

r = c.post("/v1/acme/items", headers=DIST, json=item("Cache the dependency folder between builds."))
L2 = r.json()["item"]
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=BOB, json={"status": "active"})
H.check("HUMAN: a person not in the policy has no access to the namespace (403)", r.status_code == 403, r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=HANA, json={"status": "active"})
H.check("HUMAN: a person listed by e-mail in confirm_policy confirms", r.status_code == 200
        and r.json()["item"]["status"] == "active" and r.json()["item"]["actor"]["principal"] == "hana@x.io", r.text)
r = c.post("/v1/acme/items", headers=HANA, json=item("Run the linter first."))
H.check("HUMAN: ... as role confirmer only (cannot propose)", r.status_code == 403, r.text)

r = c.post("/v1/acme/items", headers=DIST, json=item("Use the staging database for load tests.", kind="fact"))
F1 = r.json()["item"]
r = c.patch(f"/v1/acme/items/{F1['id']}", headers=CONF, json={"status": "active"})
H.check("QUORUM: the first of 2 confirmations is 202 pending",
        r.status_code == 202 and r.json()["pending"] == {"confirmations": 1, "quorum": 2}
        and r.json()["item"]["status"] == "proposed", r.text)
r = c.patch(f"/v1/acme/items/{F1['id']}", headers=CONF, json={"status": "active"})
H.check("QUORUM: the same confirmer twice still counts once", r.status_code == 202
        and r.json()["pending"]["confirmations"] == 1, r.text)
r = c.patch(f"/v1/acme/items/{F1['id']}", headers=as_("conf-2", "confirmer"), json={"status": "active"})
H.check("QUORUM: a second confirmer activates", r.status_code == 200 and r.json()["item"]["status"] == "active",
        r.text)

r = c.post("/v1/acme/items", headers=as_("d", "distiller", run="h1"), json=item("Squash commits before merge.",
                                                                                 kind="habit"))
HB = r.json()["item"]
H.check("AUTO: one piece of evidence leaves it proposed", HB["status"] == "proposed", HB)
r = c.post(f"/v1/acme/items/{HB['id']}:support", headers=DIST, json={"project": "beta", "run_id": "h2"})
H.check("AUTO: auto_after_evidence 2 activates without a confirmer",
        r.status_code == 200 and r.json()["auto_active"] and r.json()["item"]["status"] == "active"
        and r.json()["item"]["expires_ms"], r.text)

r = c.patch(f"/v1/acme/items/{L2['id']}", headers=DIST, json={"status": "withdrawn"})
H.check("WITHDRAW: a distiller (no items:withdraw, not in policy) is 403", r.status_code == 403, r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=DIST, json={"status": "contested", "reason": "build broke"})
H.check("CONTEST: a distiller (items:write) may contest", r.status_code == 200
        and r.json()["item"]["status"] == "contested" and r.json()["item"]["status_reason"] == "build broke", r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=CONF, json={"status": "withdrawn", "reason": "wrong"})
H.check("WITHDRAW: the confirmer withdraws", r.status_code == 200 and r.json()["item"]["status"] == "withdrawn",
        r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=CONF, json={"status": "active"})
H.check("TRANSITION: withdrawn -> active is 409 invalid_transition",
        r.status_code == 409 and r.json()["error"] == "invalid_transition", r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=CONF, json={"status": "unproven"})
H.check("REOPEN: withdrawn -> unproven (alias of proposed)", r.status_code == 200
        and r.json()["item"]["status"] == "proposed", r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=CONF, json={"status": "bogus"})
H.check("TRANSITION: an unknown status is 422", r.status_code == 422, r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=CONF, json={"status": "superseded"})
H.check("SUPERSEDE: needs superseded_by (422)", r.status_code == 422, r.text)
r = c.patch(f"/v1/acme/items/{L2['id']}", headers=CONF, json={"status": "superseded", "superseded_by": L1["id"]})
H.check("SUPERSEDE: with a live successor", r.status_code == 200 and r.json()["item"]["status"] == "superseded"
        and r.json()["item"]["superseded_by"] == L1["id"], r.text)
r = c.patch("/v1/acme/items/nope", headers=CONF, json={"status": "active"})
H.check("TRANSITION: unknown item 404", r.status_code == 404, r.text)

# ── 6. contradicts / updates / TTL / lists ───────────────────────────────────
r = c.post("/v1/acme/items", headers=DIST, json=item("Skip the unit tests on hotfix builds.", contradicts=L1["id"]))
H.check("CONTRADICTS: the new item is contested", r.status_code == 201 and r.json()["result"] == "contested"
        and r.json()["item"]["status"] == "contested" and r.json()["with"] == [L1["id"]], r.text)
CX = r.json()["item"]
r = c.get(f"/v1/acme/items/{L1['id']}", headers=CONF)
H.check("CONTRADICTS: ... and so is the target", r.json()["status"] == "contested"
        and CX["id"] in r.json()["status_reason"], r.json())
r = c.post("/v1/acme/items", headers=DIST, json=item("Skip the unit tests only on hotfix builds.", updates=CX["id"]))
H.check("UPDATES: rewrites the live item in place", r.status_code == 200 and r.json()["result"] == "updated"
        and r.json()["item"]["id"] == CX["id"] and "only" in r.json()["item"]["text"]
        and r.json()["item"]["rev"] > CX["rev"], r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run it.", updates="nope"))
H.check("UPDATES: an unknown target is 404", r.status_code == 404, r.text)

r = c.post("/v1/acme/items", headers=DIST, json=item("Rotate the keys monthly.", keyspace="tiny", key={"topic": "sec"}))
T1 = r.json()["item"]
r = c.patch(f"/v1/acme/items/{T1['id']}", headers=CONF, json={"status": "active"})
H.check("TTL: the keyspace ttl_days (1) applies", r.json()["item"]["expires_ms"] - r.json()["item"][
    "last_confirmed_ms"] == 86400000, r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_item SET expires_ms=expires_ms-2*86400000 WHERE ns='acme' AND item_id=?", [T1["id"]])
r = c.post("/v1/acme/items:expire", headers=CONF, json={})
H.check("TTL: :expire is for the admin or an orchestrator", r.status_code == 403, r.text)
r = c.post("/v1/acme/items:expire", headers=OWNER, json={})
H.check("TTL: the sweep withdraws the expired item", r.status_code == 200 and r.json()["expired"] == 1, r.text)
r = c.get(f"/v1/acme/items/{T1['id']}", headers=CONF)
H.check("TTL: withdrawn with reason expired", r.json()["status"] == "withdrawn"
        and r.json()["status_reason"] == "expired", r.json())
H.check("TTL: the cron function finds nothing more", items._cron_expire() == "")

r = c.get("/v1/acme/items", headers=CONF, params={"keyspace": "step", "key": "role=dev;step=build;stack=java",
                                                  "status": "unproven"})
ids = [x["id"] for x in r.json()["items"]]
H.check("LIST: key + status alias filter", r.status_code == 200 and BAD["id"] in ids and L1["id"] not in ids
        and all(x["status"] == "proposed" for x in r.json()["items"]), r.text)
r = c.get("/v1/acme/items", headers=CONF, params={"keyspace": "step", "key": json.dumps(JAVA), "status": "active,contested"})
H.check("LIST: key as JSON, two statuses", {L1["id"], CX["id"]} <= {x["id"] for x in r.json()["items"]}, r.text)
r = c.get("/v1/acme/items", headers=as_("reader", "agent", projects=["delta"]))
H.check("LIST: only cross items from a project without own items",
        all(x["scope"] == "cross" for x in r.json()["items"]) and r.json()["items"], r.text)
r = c.get("/v1/acme/items", headers=CONF, params={"key": "role=dev"})
H.check("LIST: key without keyspace is 422", r.status_code == 422, r.text)
r = c.get("/v1/acme/items:patterns", headers=CONF, params={"keyspace": "step"})
pat = r.json()
H.check("PATTERNS: counts per key and kind with a status breakdown", r.status_code == 200 and any(
    p["key"] == JAVA and p["kind"] == "lesson" and p["count"] >= 3 and p["by_status"].get("contested") == 2
    for p in pat["patterns"]), pat)

body = item("Document every new flag in the README.")
h = {**DIST, "Idempotency-Key": "idem-1"}
r1 = c.post("/v1/acme/items", headers=h, json=body)
r2 = c.post("/v1/acme/items", headers=h, json=body)
H.check("IDEMPOTENCY: the replay returns the stored 201", r1.status_code == r2.status_code == 201
        and r2.headers.get("idempotent-replay") == "true" and r1.json() == r2.json(), (r1.text, r2.text))

# ── 7. races ─────────────────────────────────────────────────────────────────
res = H.race(6, lambda i: c.post("/v1/acme/items", headers=as_(f"d{i}", "distiller", run=f"race-{i}"),
                                 json=item("Freeze dependencies before the release build.")))
codes = sorted(x.status_code for x in res)
rid = {x.json()["item"]["id"] for x in res if x.status_code in (200, 201)}
H.check("RACE: identical proposals - one 201, the rest merged", codes == [200] * 5 + [201], [x.text for x in res])
H.check("RACE: ... into one item", len(rid) == 1, rid)
r = c.get(f"/v1/acme/items/{rid.pop()}", headers=CONF)
H.check("RACE: no support lost (6 runs)", r.json()["evidence_count"] == 6
        and len(r.json()["provenance"]["runs"]) == 6, r.json())

r = c.post("/v1/acme/items", headers=DIST, json=item("Tag every release in git."))
RC = r.json()["item"]
etag = c.get(f"/v1/acme/items/{RC['id']}", headers=CONF).headers["etag"]
res = H.race(6, lambda i: c.patch(f"/v1/acme/items/{RC['id']}", headers={**as_(f"c{i}", "confirmer"),
                                                                         "If-Match": etag},
                                  json={"status": "active"}).status_code)
H.check("RACE: 6 confirms with one If-Match - one 200, five 409", sorted(res) == [200] + [409] * 5, res)


# ── 8. vectors and type usage ────────────────────────────────────────────────
class _Model:
    @staticmethod
    def _one(text):
        v = numpy.zeros(64, dtype="float32")
        for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 64] += 1.0
        n = numpy.linalg.norm(v)
        return v / n if n else v

    @classmethod
    def encode(cls, text, normalize_embeddings=True):
        return cls._one(text)


r = c.post("/v1/acme/items:reindex", headers=OWNER, json={})
H.check("VECTORS: without an embedder nothing is indexed (stale rows counted)",
        r.status_code == 200 and r.json()["indexed"] == 0 and r.json()["stale"] > 0, r.text)
c.app.state.model = _Model()
r = c.post("/v1/acme/items:reindex", headers=as_("o", "orchestrator"), json={})
H.check("VECTORS: :reindex rebuilds every stale row from SQL", r.status_code == 200
        and r.json()["indexed"] == r.json()["stale"] > 0, r.text)
r = c.post("/v1/acme/items:reindex", headers=OWNER, json={})
H.check("VECTORS: then nothing is stale (vec_rev = rev)", r.json()["stale"] == 0, r.text)
found = items.search("acme", "staging database for load tests", 3)
H.check("VECTORS: search finds an active item by meaning", found and found[0][0] == F1["id"], found)
r = c.post("/v1/acme/items", headers=DIST, json=item("Run the unit tests before every build!"))
H.check("VECTORS: a near-identical rewording is merged by meaning",
        r.status_code == 200 and r.json()["result"] == "merged" and r.json()["item"]["id"] == L1["id"], r.text)
r = c.post("/v1/acme/items", headers=DIST, json=item("Mirror the artifact registry nightly."))
NEW = r.json()["item"]
with sqldb.connect() as conn:
    vr = conn.execute("SELECT vec_rev, rev FROM kh_item WHERE ns='acme' AND item_id=?", [NEW["id"]]).fetchone()
H.check("VECTORS: a write indexes after commit (vec_rev = rev)", vr["vec_rev"] == vr["rev"], dict(vr))
r = c.post("/v1/acme/items:reindex", headers=DIST, json={})
H.check("VECTORS: :reindex is for the admin or an orchestrator", r.status_code == 403, r.text)

# people-bound findings: never promoted, TTL capped at 90 days however it is set
r = c.post("/v1/acme/items", headers=DIST, json=item("Check the last stop order before restarting the workers.",
                                                     key={"role": "ops", "step": "restart"}, bound="people",
                                                     ttl_days=400, triggers=["crash"]))
H.check("PEOPLE: a people-bound finding is accepted", r.status_code == 201 and r.json()["item"]["bound"] == "people",
        r.text)
PF = r.json()["item"]
for p, run in (("beta", "run-qb"), ("gamma", "run-qg"), ("delta", "run-qd")):
    r = c.post(f"/v1/acme/items/{PF['id']}:support", headers=DIST, json={"project": p, "run_id": run})
H.check("PEOPLE: never promoted cross-project", r.json()["item"]["scope"] == "project", r.text)
r = c.patch(f"/v1/acme/items/{PF['id']}", headers={**CONF, "If-Match": f'"{r.json()["item"]["rev"]}"'},
            json={"status": "active"})
pf = r.json().get("item") or {}
H.check("PEOPLE: TTL capped at 90 days although 400 were asked",
        r.status_code == 200 and pf["expires_ms"] - pf["last_confirmed_ms"] == items.PEOPLE_TTL_DAYS * 86400000,
        r.text)

m = json.loads(json.dumps(MANIFEST))
m["types"] = [t for t in m["types"] if t["type"] != "lesson"]
etag = c.get("/v1/acme/manifest", headers=OWNER).headers["etag"]
r = c.put("/v1/acme/manifest", headers={**OWNER, "If-Match": etag}, json=m)
H.check("TYPE USAGE: removing an item type with rows is 409 type_in_use",
        r.status_code == 409 and r.json()["error"] == "type_in_use", r.text)

H.done()
