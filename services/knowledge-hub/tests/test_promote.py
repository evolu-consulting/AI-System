"""Tests for the two layers and their nightly promotion (app/promote.py, kernel rule 10), 2026-10-27.

WHAT IS UNDER TEST
  1. WHO WRITES WHAT. A member cannot write the common tier (/policy/rule/set on 'every project', /hooks/set);
     they can write a rule in their own personal tier, and only they read it.
  2. /promote/next. Maintainers only, and only with KH_PROMOTE on: every person's personalization rows and every
     project's 'feedback' rows, each owner shown as an alias, never the e-mail or the personal project id.
  3. /promote/submit. A proposal must target a common action, cite rows of at least KH_PROMOTE_MIN_PEOPLE owners
     and pass the leak gate; it is stored as a proposed item in the orchestrator, never applied by itself.
  4. APPROVAL. /distill/approve on a promotion writes the 'every project' tier, keeping the step's seq; a person's
     own row for the same step still wins for them.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_promote.py
"""
import hashlib
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_promote_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"
os.environ["KH_PROMOTE"] = "on"
os.environ["KH_LEARNBACK_LLM"] = "dry"

import jwt  # noqa: E402
import numpy  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, personal, projects  # noqa: E402
from app.policy_actions import store as policy_store  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    """Stand-in embedder: one vector per distinct text, so two different proposals are not 'the same item'."""
    @staticmethod
    def encode(text, normalize_embeddings=True):
        v = numpy.zeros(384, dtype="float32")
        v[int(hashlib.sha256(text.encode()).hexdigest(), 16) % 384] = 1.0
        return v


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
auth.register_project = lambda pid, *rest: None
auth.unregister_project = lambda pid: None


def token(email, projects_=None, admin=False):
    now = int(time.time())
    perms = ["project.read", "project.write", "project.log"]
    kh = {"role": "maintainer" if admin else "member", "permissions": ["project.create"],
          "all_projects": perms if admin else [],
          "projects": {p: list(v) for p, v in (projects_ or {}).items()}}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


W = ["project.read", "project.write", "project.log"]
HUGH = token("hugh@example.invalid", {"alpha": W})
ANA = token("ana@example.invalid", {"alpha": W})
ADMIN = token("root@example.invalid", admin=True)
HUGH_PID = personal.personal_id("hugh@example.invalid")

main.app.state.model = _Model()
client = TestClient(main.app)
projects.get_or_create_project("alpha")

policy_store.set_action("write message to people", "Draft text a person reads.")
policy_store.set_rule("write message to people", "tone", "COMMON: neutral tone.", seq=3)


def pref(text, headers):
    return client.post("/vector/add", json={"text": text, "scope": "personalization",
                                            "metadata": {"scope": "personalization", "kind": "preference"}},
                       headers=headers)


# ── 1. who writes what ──────────────────────────────────────────────────────
r = client.post("/policy/rule/set", json={"action": "write message to people", "sub_action": "tone", "seq": 3,
                                          "content": "HUGH: no emoji.", "project": "every project"}, headers=HUGH)
check("a member cannot write the common policy tier", r.status_code == 403, r.status_code)
r = client.post("/hooks/set", json={"hook_type": "SessionStart", "name": "kernel", "content": "x"}, headers=HUGH)
check("a member cannot write the kernel", r.status_code == 403, r.status_code)
r = client.post("/policy/rule/set", json={"action": "write message to people", "sub_action": "tone", "seq": 3,
                                          "content": "HUGH: no emoji.", "project": HUGH_PID}, headers=HUGH)
check("a member writes a rule in their own personal tier", r.status_code == 200, r.text[:200])
plan = client.get("/policy/plan", params={"action": "write message to people", "project": "alpha"}, headers=HUGH)
check("their plan shows their own rule", "HUGH: no emoji." in plan.text, plan.text[:300])
plan = client.get("/policy/plan", params={"action": "write message to people", "project": "alpha"}, headers=ANA)
check("someone else's plan shows the common rule", "COMMON: neutral tone." in plan.text and "HUGH" not in plan.text,
      plan.text[:300])
r = client.post("/policy/rule/set", json={"action": "write message to people", "sub_action": "tone", "seq": 3,
                                          "content": "x", "project": HUGH_PID}, headers=ANA)
check("a member cannot write someone else's personal tier", r.status_code == 403, r.status_code)

# ── 2. /promote/next ────────────────────────────────────────────────────────
check("hugh stores feedback in his personalization", pref("Never use emoji in messages to colleagues.", HUGH).status_code == 200)
check("ana stores feedback in her personalization", pref("No emoji in team chat messages, please.", ANA).status_code == 200)
r = client.post("/vector/add", json={"text": "In alpha, QC wants the environment named in every handoff.",
                                     "scope": "knowledge", "project": "alpha",
                                     "metadata": {"scope": "knowledge", "project": "alpha", "kind": "feedback"}},
                headers=HUGH)
check("project feedback goes to the project's knowledge", r.status_code == 200, r.text[:200])
check("a member cannot read /promote/next", client.get("/promote/next", headers=HUGH).status_code == 403)
nxt = client.get("/promote/next", headers=ADMIN)
check("a maintainer reads /promote/next", nxt.status_code == 200, nxt.text[:300])
body = nxt.json()
rows = body.get("rows") or []
texts = {r["text"]: r for r in rows}
check("it lists both people's rows and the project feedback",
      "Never use emoji in messages to colleagues." in texts and "No emoji in team chat messages, please." in texts
      and any("environment named" in t for t in texts), list(texts))
check("owners are aliases, never e-mails or personal ids",
      all(r["owner"].startswith(("person-", "project:")) for r in rows) and "hugh" not in nxt.text.lower(),
      [r["owner"] for r in rows])
check("the common tier comes with its step text",
      any(a["action"] == "write message to people" and any(s["content"] == "COMMON: neutral tone." for s in a["steps"])
          for a in body.get("common") or []))
check("a personal row is not shown as common",
      all("HUGH" not in s["content"] for a in body["common"] for s in a["steps"]))

# ── 3. /promote/submit ──────────────────────────────────────────────────────
hugh_row = texts["Never use emoji in messages to colleagues."]["id"]
ana_row = texts["No emoji in team chat messages, please."]["id"]
item = {"title": "No emoji in messages to people", "text": "Write messages to colleagues without emoji.",
        "target_action": "write message to people", "target_sub_action": "tone", "sources": [hugh_row, ana_row]}
r = client.post("/promote/submit", json={"items": [dict(item, sources=[hugh_row])]}, headers=ADMIN)
check("one person's rule alone is refused", r.json()["results"][0]["result"] == "rejected", r.text)
r = client.post("/promote/submit", json={"items": [dict(item, target_action="no such action")]}, headers=ADMIN)
check("a target outside the common tier is refused", r.json()["results"][0]["result"] == "rejected", r.text)
r = client.post("/promote/submit", json={"items": [dict(item, text="Ask root@example.invalid before sending.")]},
                headers=ADMIN)
check("the leak gate refuses a named person", r.json()["results"][0]["result"] == "rejected", r.text)
r = client.post("/promote/submit", json={"items": [item], "dry_run": True}, headers=ADMIN)
check("dry run answers without storing", r.json()["results"][0]["result"] == "accepted"
      and client.get("/distill/pending", params={"project": "orchestrator"}, headers=ADMIN).json()["count"] == 0,
      r.text)
check("a member cannot submit", client.post("/promote/submit", json={"items": [item]}, headers=HUGH).status_code == 403)
r = client.post("/promote/submit", json={"items": [item]}, headers=ADMIN)
res = r.json()["results"][0]
check("two people's rule is stored as a proposal", res["result"] == "accepted" and res["people"] == 2, r.text)
pend = client.get("/distill/pending", params={"project": "orchestrator"}, headers=ADMIN).json()
check("it waits on the orchestrator's pending list", pend["count"] == 1 and res["id"] in pend["lines"][0], pend)
check("the common tier is unchanged until approval",
      policy_store.get_rule("write message to people", "tone")["content"] == "COMMON: neutral tone.")
r = client.post("/promote/submit", json={"items": [item]}, headers=ADMIN)
check("the same proposal again merges, not a second row", r.json()["results"][0]["result"] == "merged", r.text)
check("past proposals come back in /promote/next",
      any(p["id"] == res["id"] for p in client.get("/promote/next", headers=ADMIN).json()["proposals"]))

# ── 4. approval ─────────────────────────────────────────────────────────────
r = client.post("/distill/approve", json={"project": "orchestrator", "ids": [res["id"]]}, headers=ADMIN)
check("approval applies the proposal", r.json()["results"][0]["result"] == "applied as policy rule", r.text)
rule = policy_store.get_rule("write message to people", "tone")
check("the common tier now holds it, same seq", rule["content"] == item["text"] and rule["seq"] == 3
      and rule["project"] == policy_store.EVERY, rule)
plan = client.get("/policy/plan", params={"action": "write message to people", "project": "alpha"}, headers=HUGH)
check("hugh's own row still wins for him", "HUGH: no emoji." in plan.text, plan.text[:300])
plan = client.get("/policy/plan", params={"action": "write message to people", "project": "alpha"}, headers=ANA)
check("everyone else gets the promoted rule", item["text"] in plan.text, plan.text[:300])

# ── 5. learn back runs the promote job for the pseudo project 'common' ───────
from app import learnback  # noqa: E402

out = learnback._execute("lbr_test", ["common"], "root@example.invalid")
check("learn back with only 'common' skips distil and runs promote",
      out.get("promote", {}).get("status") == "ok" and out["promote"]["rows"] >= 3, out)
out = learnback._execute("lbr_test", ["alpha"], "root@example.invalid")
check("learn back without 'common' does not promote", "promote" not in out, out)

print("\nALL PASS" if not FAILURES else f"\nFAILURES: {FAILURES}", f" ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
