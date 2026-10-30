"""Tests for KH tool guards in the helper's PreToolUse hook (tools/kh-helper 1.12.0), 2026-10-11.

WHAT IS UNDER TEST
  A personalization rule tied to a tool (metadata guard_tool) is enforced right before that tool runs:
  the hook answers permissionDecision "ask" (or "deny") quoting the rule, so a rule the model forgot
  (the report-output rule vs. the Artifact tool's own "publish proactively" guidance) still holds.
  Guards that do not match the tool input, an unreadable KH, and the fast file tools never block.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_guards.py
"""
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))
from kh_helper import hooks  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


REPORT_RULE = {"id": "vec_r", "text": "Reports are local HTML files, never a published artifact unless asked.",
               "decision": "ask", "when": {"action": ["", "publish"], "asset": ["", "false"]}}


class FakeSession:
    def __init__(self, guards=None, status=200, rules=""):
        self.guards, self.status, self.rules, self.calls = guards or [], status, rules, []

    def call(self, method, route, body=None):
        self.calls.append(route)
        if route.startswith("/personalization/guards"):
            return self.status, {"guards": self.guards}
        return 200, self.rules


def payload(tool, **tool_input):
    return json.dumps({"tool_name": tool, "tool_input": tool_input, "session_id": ""})


# guard_applies
check("no filter applies", hooks.guard_applies({}, {"x": 1}))
check("missing field matches ''", hooks.guard_applies({"action": ["", "publish"]}, {}))
check("publish matches", hooks.guard_applies({"action": ["", "publish"]}, {"action": "publish"}))
check("read does not match", not hooks.guard_applies({"action": ["", "publish"]}, {"action": "read"}))
check("bool compared lower-case", not hooks.guard_applies({"asset": ["", "false"]}, {"asset": True}))

# tool_guard
s = FakeSession([REPORT_RULE])
g = hooks.tool_guard(s, payload("Artifact", file_path="r.html"))
check("artifact publish -> ask with the rule quoted", g and g["decision"] == "ask" and "never a published" in g["reason"], g)
check("guards asked for the right tool", s.calls == ["/personalization/guards?tool=Artifact"], s.calls)
check("artifact read -> no guard", hooks.tool_guard(FakeSession([REPORT_RULE]), payload("Artifact", action="read")) is None)
check("asset upload -> no guard", hooks.tool_guard(FakeSession([REPORT_RULE]), payload("Artifact", asset=True)) is None)
deny = dict(REPORT_RULE, decision="deny")
check("deny beats ask", hooks.tool_guard(FakeSession([REPORT_RULE, deny]), payload("Artifact"))["decision"] == "deny")
quick = FakeSession([REPORT_RULE])
check("file tools never ask KH for guards", hooks.tool_guard(quick, payload("Write", file_path="a")) is None and not quick.calls)
check("KH failing -> no guard", hooks.tool_guard(FakeSession([REPORT_RULE], status=503), payload("Artifact")) is None)
check("bad stdin -> no guard", hooks.tool_guard(FakeSession([REPORT_RULE]), "not json") is None)

# the hook's printed answer
out = io.StringIO()
with redirect_stdout(out):
    code = hooks._run_hook("PreToolUse", FakeSession([REPORT_RULE], rules="KH PRE-ACTION CHECK"), payload("Artifact"))
answer = json.loads(out.getvalue())["hookSpecificOutput"]
check("hook answers ask + reason + context", code == 0 and answer["permissionDecision"] == "ask"
      and "never a published" in answer["permissionDecisionReason"] and answer["additionalContext"] == "KH PRE-ACTION CHECK",
      answer)
out = io.StringIO()
with redirect_stdout(out):
    hooks._run_hook("PreToolUse", FakeSession([], rules="KH PRE-ACTION CHECK"), payload("Edit", file_path="a"))
answer = json.loads(out.getvalue())["hookSpecificOutput"]
check("no guard -> context only, no decision", "permissionDecision" not in answer, answer)
check("Artifact is in the PreToolUse matcher", "Artifact" in hooks.HOOKS["PreToolUse"]["matcher"].split("|"))

print("ALL PASS" if not FAILURES else f"FAILED: {FAILURES}")
sys.exit(1 if FAILURES else 0)
