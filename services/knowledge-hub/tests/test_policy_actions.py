"""Tests for the policy action table (app/policy_actions).

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_policy_actions.py

What is asserted here is the MECHANISM, not routing accuracy: routing accuracy depends on an
agent picking a label from the menu and cannot be self-graded honestly. So we prove the parts
that are objective - the same sub-action under two actions stays two distinct rules, unknown
labels fail loudly instead of falling back to a neighbour, hook_rules in the shared database is
untouched, the bulk seed refuses a partial payload, a rule lookup stays fast, and the
project column resolves per-project rows over every-project ones (including the migration of a
table written before that column existed).
"""
import json
import os
import sqlite3
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_polact_")
DB = os.path.join(TMP, "hooks.db")
os.environ["KH_HOOKS_DB"] = DB
# Keep chroma/projects state in the throwaway dir too: the project matcher reads the
# orchestrator's C4 registry, and a test must never touch the live install's store.
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")

from fastapi import FastAPI                      # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402

from app import config                           # noqa: E402
from app import policy_actions                   # noqa: E402

assert config.HOOKS_DB_PATH == DB, "test must run against a throwaway db, got %s" % config.HOOKS_DB_PATH

FAILED = []
CHECKS = 0


def check(name, cond, detail=""):
    global CHECKS
    CHECKS += 1
    print("%-4s %s%s" % ("ok" if cond else "FAIL", name, ("  <- " + str(detail)) if detail and not cond else ""))
    if not cond:
        FAILED.append(name)


# A pre-existing hook_rules row, to prove the new tables leave it alone.
c = sqlite3.connect(DB)
c.execute("""CREATE TABLE hook_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, hook_type TEXT,
             name TEXT, content TEXT, enabled INTEGER DEFAULT 1, position INTEGER DEFAULT 0,
             updated_at TEXT, UNIQUE(hook_type, name))""")
c.execute("INSERT INTO hook_rules (hook_type,name,content,updated_at) VALUES "
          "('UserPromptSubmit','intent-policy-guard','ORIGINAL TEXT','2026-08-21')")
c.commit()
c.close()

app = FastAPI()
policy_actions.attach(app)
client = TestClient(app)

SEED = os.path.join(ROOT, "seeds", "policy_action_table.seed.json")
with open(SEED, encoding="utf-8") as f:
    payload = json.load(f)

r = client.post("/policy/actions/bulk", json=payload)
check("bulk seed accepted", r.status_code == 200, r.text[:300])
check("seeded 2 actions / 22 rules",
      r.json()["table"]["db"] == DB and r.json()["table"]["actions"] == 2
      and r.json()["table"]["rules"] == 22, r.json())

menu = client.get("/policy/actions").json()
names = [a["action"] for a in menu["actions"]]
check("menu lists both actions", sorted(names) == ["review code", "scan code"], names)
check("menu carries a when-to-use line for every action",
      all(len(a["description"]) > 40 for a in menu["actions"]))
check("menu carries ordered sub-actions",
      menu["actions"][0]["sub_actions"] and isinstance(menu["actions"][0]["sub_actions"], list))

# fen's core example: one sub-action name, two actions, two different rules.
scan_rf = client.get("/policy/rule", params={"action": "scan code", "sub_action": "read files"})
rev_rf = client.get("/policy/rule", params={"action": "review code", "sub_action": "read files"})
check("'read files' resolves under both actions",
      scan_rf.status_code == 200 and rev_rf.status_code == 200)
check("the two 'read files' rules are different text",
      scan_rf.json()["content"] != rev_rf.json()["content"])
check("scan/read files is the per-group rule", "PER-GROUP" in scan_rf.json()["content"])
check("review/read files is the diff rule", "github cli" in rev_rf.json()["content"])

# Loud failure, never a nearest neighbour.
bad = client.get("/policy/plan", params={"action": "deploy app"})
check("unknown action -> 404", bad.status_code == 404, bad.status_code)
check("unknown action names UNKNOWN-ACTION and lists the real labels",
      "UNKNOWN-ACTION" in bad.text and "review code" in bad.text, bad.text[:200])
nosub = client.get("/policy/rule", params={"action": "scan code", "sub_action": "check ui"})
check("wrong sub-action -> 404 NO-RULE", nosub.status_code == 404 and "NO-RULE" in nosub.text)
check("NO-RULE lists the sub-actions that do exist", "choose tool" in nosub.text)

# plan() returns the whole action in step order.
plan = client.get("/policy/plan", params={"action": "review code"}).json()
seqs = [x["seq"] for x in plan["rules"]]
check("plan is ordered by seq", seqs == sorted(seqs), seqs)
check("plan covers every sub-action", plan["count"] == 12, plan["count"])
check("the five lenses are all present",
      all(any(s in x["sub_action"] for x in plan["rules"])
          for s in ["security", "licences", "performance", "scalability", "maintainability"]))

# A partial seed must be refused outright, not half-applied.
bad_bulk = client.post("/policy/actions/bulk", json={
    "rules": [{"action": "ship it", "sub_action": "read files", "content": "x"}]})
check("rule for an undeclared action is rejected",
      bad_bulk.status_code == 400 and "UNDECLARED-ACTION" in bad_bulk.text, bad_bulk.text[:200])
check("rejected payload changed nothing",
      client.get("/policy/actions").json()["table"]["rules"] == 22)

# Deleting an action that still owns rules is refused.
refuse = client.post("/policy/action/delete", json={"action": "scan code"})
check("delete of a populated action -> 409", refuse.status_code == 409, refuse.status_code)

# The shared database is shared safely.
c = sqlite3.connect(DB)
row = c.execute("SELECT content FROM hook_rules WHERE name='intent-policy-guard'").fetchone()
tables = sorted(t for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'"))
c.close()
check("hook_rules row untouched", row and row[0] == "ORIGINAL TEXT", row)
check("both tables created next to hook_rules",
      "policy_actions" in tables and "policy_rules" in tables, tables)

# Idempotency: re-seeding twice must not multiply rows.
client.post("/policy/actions/bulk", json=payload)
check("re-seed is idempotent", client.get("/policy/actions").json()["table"]["rules"] == 22)

# ---- project column (fen 2026-08-21) ---------------------------------------
EVERY = "every project"
check("seeded rows are every-project",
      all(r["project"] == EVERY for r in
          client.get("/policy/plan", params={"action": "scan code"}).json()["rules"]))
check("projects listing reports the sentinel tier",
      client.get("/policy/actions/projects").json()["projects"][0]["project"] == EVERY)

# A project overrides ONE step of a common action; the rest still comes from every-project.
ovr = client.post("/policy/rule/set", json={
    "action": "scan code", "sub_action": "read files", "project": "simplemdg-v1",
    "seq": 3, "clauses": "9", "content": "SMDG_V1 ONLY: scan ai-group and be-group separately."})
check("per-project rule accepted for a common action", ovr.status_code == 200, ovr.text[:200])
check("per-project rule stored under its own project",
      ovr.json()["project"] == "simplemdg-v1")

one = client.get("/policy/rule", params={"action": "scan code", "sub_action": "read files",
                                         "project": "simplemdg-v1"}).json()
check("project read gets the override", one["content"].startswith("SMDG_V1 ONLY"))
check("override is tagged with the project", one["project"] == "simplemdg-v1")
common = client.get("/policy/rule", params={"action": "scan code",
                                           "sub_action": "read files"}).json()
check("every-project rule is untouched by the override", "PER-GROUP" in common["content"])
other = client.get("/policy/rule", params={"action": "scan code", "sub_action": "read files",
                                           "project": "solace-buzz"}).json()
check("an unrelated project still gets the common rule", "PER-GROUP" in other["content"])

pplan = client.get("/policy/plan", params={"action": "scan code",
                                           "project": "simplemdg-v1"}).json()
check("project plan keeps all 10 steps", pplan["count"] == 10, pplan["count"])
check("project plan mixes one override with nine common rows",
      sum(1 for r in pplan["rules"] if r["project"] == "simplemdg-v1") == 1
      and sum(1 for r in pplan["rules"] if r["project"] == EVERY) == 9,
      [(r["sub_action"], r["project"]) for r in pplan["rules"]])
check("project plan stays in step order",
      [r["seq"] for r in pplan["rules"]] == sorted(r["seq"] for r in pplan["rules"]))

# A project-only action is invisible to the common menu and to other projects.
client.post("/policy/action/set", json={
    "action": "ship release", "project": "simplemdg-v1",
    "description": "Cut and ship a SimpleMDG V1 release - project-specific action."})
client.post("/policy/rule/set", json={
    "action": "ship release", "sub_action": "tag build", "project": "simplemdg-v1",
    "seq": 1, "content": "Tag the build before shipping."})
names_common = [a["action"] for a in client.get("/policy/actions").json()["actions"]]
names_proj = [a["action"] for a in client.get(
    "/policy/actions", params={"project": "simplemdg-v1"}).json()["actions"]]
check("project-only action hidden from the common menu", "ship release" not in names_common)
check("project-only action visible to its project", "ship release" in names_proj)
check("project-only action hidden from another project", "ship release" not in
      [a["action"] for a in client.get("/policy/actions",
                                       params={"project": "solace-buzz"}).json()["actions"]])
check("project-only action is UNKNOWN for another project",
      client.get("/policy/plan", params={"action": "ship release",
                                         "project": "solace-buzz"}).status_code == 404)

# Deleting the override falls straight back to the common rule.
client.post("/policy/rule/delete", json={"action": "scan code", "sub_action": "read files",
                                          "project": "simplemdg-v1"})
back = client.get("/policy/rule", params={"action": "scan code", "sub_action": "read files",
                                          "project": "simplemdg-v1"}).json()
check("deleting an override falls back to the common rule", "PER-GROUP" in back["content"])

# Migration: a table written before the project column must be rebuilt, not lost.
import importlib                                            # noqa: E402
MIG = os.path.join(TMP, "pre_project.db")
mc = sqlite3.connect(MIG)
mc.execute("""CREATE TABLE policy_actions (action TEXT PRIMARY KEY, description TEXT NOT NULL,
              source_policy TEXT, priority INTEGER, updated_at TEXT NOT NULL)""")
mc.execute("""CREATE TABLE policy_rules (action TEXT NOT NULL, sub_action TEXT NOT NULL,
              seq INTEGER, clauses TEXT, content TEXT NOT NULL,
              PRIMARY KEY (action, sub_action))""")
mc.execute("INSERT INTO policy_actions VALUES ('old action','desc','src',100,'2026-08-21')")
mc.execute("INSERT INTO policy_rules VALUES ('old action','old step',1,'1','OLD CONTENT')")
mc.commit()
mc.close()
os.environ["KH_HOOKS_DB"] = MIG
import app.config                                            # noqa: E402
importlib.reload(app.config)
from app.policy_actions import store as mstore               # noqa: E402
importlib.reload(mstore)
mstore.init()
migrated = mstore.get_rule("old action", "old step", "some-project")
check("pre-project table migrates instead of failing", migrated is not None, migrated)
check("migrated row is tagged every project", migrated and migrated["project"] == EVERY)
check("migrated row keeps its content", migrated and migrated["content"] == "OLD CONTENT")
check("migration is idempotent", (mstore.init(), mstore.get_rule(
    "old action", "old step"))[1]["content"] == "OLD CONTENT")
os.environ["KH_HOOKS_DB"] = DB
# Keep chroma/projects state in the throwaway dir too: the project matcher reads the
# orchestrator's C4 registry, and a test must never touch the live install's store.
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
importlib.reload(app.config)
importlib.reload(mstore)

# ---- project name matching (fen 2026-08-21) --------------------------------
# fen writes "tinh hinh con ticketing sao roi", never "ticketing-system", so mapping his words
# to an id must be a literal lookup over the manifest's aliases/keywords - no embedder.
from app import projects as kh_projects                       # noqa: E402

_real_load = kh_projects._load
kh_projects._load = lambda: {"projects": {
    "ticketing-system": {"id": "ticketing-system", "role": "project",
                         "aliases": ["ticketing system", "con ticketing"],
                         "keywords": ["ticketing", "ticket", "jira"]},
    "simplemdg-v1": {"id": "simplemdg-v1", "role": "project",
                     "aliases": ["SMDG V1", "SimpleMDG V1"], "keywords": ["mdg", "cap"]},
}}
try:
    check("exact id resolves",
          kh_projects.resolve_project_name("ticketing-system") == "ticketing-system")
    check("fen's own phrasing resolves (unaccented)",
          kh_projects.resolve_project_name("tinh hinh con ticketing sao roi")
          == "ticketing-system")
    check("fen's own phrasing resolves (with diacritics)",
          kh_projects.resolve_project_name("t\u00ecnh h\u00ecnh con ticketing sao r\u1ed3i")
          == "ticketing-system")
    check("a bare keyword resolves", kh_projects.resolve_project_name("fix cai ticket nay")
          == "ticketing-system")
    check("underscores and case fold together",
          kh_projects.resolve_project_name("scan SMDG_V1 into KH") == "simplemdg-v1")
    check("unrelated text resolves to nothing",
          kh_projects.resolve_project_name("deploy the app to production") is None)
    check("word boundaries hold (no substring bleed)",
          kh_projects.resolve_project_name("the ticketingsystem thing") is None)
    check("longer alias beats a shorter keyword",
          kh_projects.match_projects("con ticketing")[0]["matched_term"] == "con ticketing")
    check("alias resolves to the canonical id",
          kh_projects.canonical_or_none("ticketing") == "ticketing-system")
    check("an unknown project stays None",
          kh_projects.canonical_or_none("no-such-project") is None)

    # The policy endpoints must accept fen's words too, not just the canonical id.
    client.post("/policy/action/set", json={
        "action": "chase ticket", "project": "con ticketing",
        "description": "Chase a ticket in the ticketing system - project-specific action."})
    client.post("/policy/rule/set", json={
        "action": "chase ticket", "sub_action": "read files", "project": "ticketing",
        "seq": 1, "content": "Read the ticket, not the whole tree."})
    aliased = client.get("/policy/rule", params={"action": "chase ticket",
                                                 "sub_action": "read files",
                                                 "project": "con ticketing"})
    check("policy write through an alias lands on the canonical project",
          aliased.status_code == 200 and aliased.json()["project"] == "ticketing-system",
          aliased.text[:200])
    check("policy read reports which project it resolved to",
          client.get("/policy/plan", params={"action": "chase ticket",
                                            "project": "jira"}).json()["project"]
          == "ticketing-system")
    check("an unknown project string is passed through, not guessed",
          client.get("/policy/plan", params={"action": "scan code",
                                            "project": "not-a-project"}).json()["project"]
          == "not-a-project")
finally:
    kh_projects._load = _real_load

# Personal tier (kernel rule 10): the caller's own rule wins over project and common rows; others never see it.
from app import auth                                     # noqa: E402
from app import personal                                 # noqa: E402
from app.policy_actions import store as _st              # noqa: E402
_st.set_action("personal check", "test only")
_st.set_rule("personal check", "tone", "COMMON tone", seq=1)
_st.set_rule("personal check", "length", "COMMON length", seq=2)
_st.set_rule("personal check", "tone", "PROJECT tone", seq=1, project="pacific")
_hugh = personal.personal_id("hugh@example.invalid")
_st.set_rule("personal check", "tone", "HUGH tone", seq=1, project=_hugh)
_tok = auth._current.set(auth.Principal.from_claims({"email": "hugh@example.invalid", "kh": {"role": "member"}}))
try:
    _plan = {r["sub_action"]: r["content"] for r in _st.plan("personal check", "pacific")}
    check("personal tier wins over project and common rows", _plan.get("tone") == "HUGH tone", str(_plan))
    check("a step the person did not set falls back to the common row", _plan.get("length") == "COMMON length",
          str(_plan))
    check("get_rule resolves the personal row first",
          (_st.get_rule("personal check", "tone", "pacific") or {}).get("content") == "HUGH tone")
finally:
    auth._current.reset(_tok)
_tok = auth._current.set(auth.Principal.from_claims({"email": "kaity@example.invalid", "kh": {"role": "member"}}))
try:
    check("another person never reads someone else's personal tier",
          (_st.get_rule("personal check", "tone", "pacific") or {}).get("content") == "PROJECT tone")
finally:
    auth._current.reset(_tok)
check("signed out: project then common, as before",
      (_st.get_rule("personal check", "tone") or {}).get("content") == "COMMON tone")

# Latency: the whole point of the table.
t0 = time.time()
N = 200
for _ in range(N):
    client.get("/policy/rule", params={"action": "review code", "sub_action": "check licences"})
per = (time.time() - t0) / N * 1000
print("     lookup via HTTP: %.2f ms per call (%d calls, in-process client)" % (per, N))

print("\n%s  (%d checks, %d failed)"
      % ("ALL PASS" if not FAILED else "FAILURES: " + ", ".join(FAILED), CHECKS, len(FAILED)))
sys.exit(1 if FAILED else 0)
