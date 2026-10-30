"""Tests for the policy authoring guards (app/policy_actions/lint.py, fen 2026-10-04).

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_policy_lint.py

Asserted: budgets refuse oversize writes with 422 POLICY-LINT and accept them with allow_oversize + a
reason; overlapping when-lines warn; /policy/plan counts fetches; {menu} in a hook renders the menu;
/hooks/set refuses a hook type whose rendered text would pass its budget; the report lists all of it.
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_pollint_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ["KH_POLICY_DESC_MAX"] = "120"
os.environ["KH_POLICY_RULE_MAX"] = "200"
os.environ["KH_POLICY_PLAN_MAX"] = "300"
os.environ["KH_HOOK_MAX_USERPROMPTSUBMIT"] = "250"

from fastapi import FastAPI                      # noqa: E402
from fastapi.testclient import TestClient        # noqa: E402

from app import config, hooks, policy_actions    # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"]

app = FastAPI()
policy_actions.attach(app)
hooks.attach(app)
client = TestClient(app)

FAILS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))
    if not ok:
        FAILS.append(name)


# --- action description budget -------------------------------------------------------------------------
r = client.post("/policy/action/set", json={"action": "read worklog", "description": "Status questions about past work."})
check("short action accepted", r.status_code == 200 and r.json()["warnings"] == [], r.text)
r = client.post("/policy/action/set", json={"action": "long one", "description": "x " * 100})
check("oversize description refused", r.status_code == 422 and r.json()["detail"]["error"] == "POLICY-LINT", r.text)
r = client.post("/policy/action/set", json={"action": "long one", "description": "x " * 100, "allow_oversize": True})
check("override without a reason still refused", r.status_code == 422, r.text)
r = client.post("/policy/action/set", json={"action": "long one", "description": "x " * 100,
                                           "allow_oversize": True, "reason": "migration of a legacy row"})
check("override with a reason accepted, error kept as warning", r.status_code == 200 and r.json()["warnings"], r.text)

# --- overlap warning ----------------------------------------------------------------------------------
r = client.post("/policy/action/set", json={"action": "show worklog", "description": "Status questions about past work items."})
check("overlapping when-line warns", r.status_code == 200 and any("overlaps 'read worklog'" in w for w in r.json()["warnings"]), r.text)

# --- rule and plan budgets ----------------------------------------------------------------------------
r = client.post("/policy/rule/set", json={"action": "read worklog", "sub_action": "one", "content": "a" * 150, "seq": 1})
check("rule under budget accepted", r.status_code == 200, r.text)
r = client.post("/policy/rule/set", json={"action": "read worklog", "sub_action": "two", "content": "b" * 250, "seq": 2})
check("oversize rule refused", r.status_code == 422, r.text)
r = client.post("/policy/rule/set", json={"action": "read worklog", "sub_action": "two", "content": "b" * 180, "seq": 2})
check("plan over budget refused (150 + 180 > 300)", r.status_code == 422 and "plan of" in str(r.json()), r.text)
r = client.post("/policy/rule/set", json={"action": "read worklog", "sub_action": "one", "content": "a" * 100, "seq": 1})
check("rewriting a step counts its new size, not old + new", r.status_code == 200, r.text)
for sub, n in (("two", 200), ("three", 100)):   # one=100 + 200 + 100 = 400 > plan budget 300
    client.post("/policy/rule/set", json={"action": "read worklog", "sub_action": sub, "content": "b" * n, "seq": 2,
                                         "allow_oversize": True, "reason": "test: legacy plan over budget"})
r = client.post("/policy/rule/set", json={"action": "read worklog", "sub_action": "three", "content": "c" * 90, "seq": 3})
check("a legacy over-budget plan may be edited when the edit shrinks it", r.status_code == 200, r.text)
r = client.post("/policy/rule/set", json={"action": "read worklog", "sub_action": "three", "content": "c" * 110, "seq": 3})
check("but not grown", r.status_code == 422, r.text)
r = client.post("/policy/rule/set", json={"action": "nope", "sub_action": "x", "content": "y"})
check("unknown action still 404", r.status_code == 404, r.text)

# --- fetch counter ------------------------------------------------------------------------------------
for _ in range(3):
    client.get("/policy/plan", params={"action": "read worklog"})
from app.policy_actions import store  # noqa: E402
u = store.usage().get((store.EVERY, "read worklog"), {})
check("plan fetches are counted", u.get("fetches") == 3 and u.get("last_fetch"), u)

# --- {menu} placeholder and hook budget ---------------------------------------------------------------
r = client.post("/hooks/set", json={"hook_type": "SessionStart", "name": "kernel", "content": "KERNEL\nMENU:\n{menu}"})
check("hook with placeholder stored", r.status_code == 200, r.text)
raw = client.get("/hooks/raw", params={"hook_type": "SessionStart"}).text
check("raw hook renders the menu", "- 'read worklog': Status questions about past work." in raw and "{menu}" not in raw, raw)
got = client.get("/hooks/get", params={"hook_type": "SessionStart"}).json()["content"]
check("hooks/get renders the menu too", "- 'show worklog'" in got, got)
r = client.post("/hooks/set", json={"hook_type": "UserPromptSubmit", "name": "guard", "content": "g" * 200})
check("per-prompt hook under budget accepted", r.status_code == 200, r.text)
r = client.post("/hooks/set", json={"hook_type": "UserPromptSubmit", "name": "more", "content": "m" * 100})
check("second rule that pushes the type over budget refused", r.status_code == 422, r.text)
r = client.post("/hooks/set", json={"hook_type": "UserPromptSubmit", "name": "more", "content": "m" * 100, "enabled": False})
check("a disabled rule is not counted", r.status_code == 200, r.text)

# --- report -------------------------------------------------------------------------------------------
rep = client.get("/policy/lint").json()
check("report lists the oversize description", any(x["action"] == "long one" for x in rep["oversize_descriptions"]), rep)
check("report lists the overlap", any({x["a"], x["b"]} == {"read worklog", "show worklog"} for x in rep["overlaps"]), rep)
check("report sizes each hook type", rep["hooks"]["UserPromptSubmit"]["chars"] >= 200 and not rep["hooks"]["UserPromptSubmit"]["over"], rep["hooks"])
check("report not ok while a row is over budget", rep["ok"] is False, rep)

print("\n%d failed" % len(FAILS) if FAILS else "\nall passed")
sys.exit(1 if FAILS else 0)
