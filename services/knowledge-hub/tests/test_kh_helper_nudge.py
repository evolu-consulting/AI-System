"""Tests for the work-log nudge in the KH helper (tools/kh-helper 1.13.2), 2026-10-16.

WHAT IS UNDER TEST
  PostToolUse adds one context line after the turn's first change, so the model stores its work log inside
  the turn and the Stop block (shown by Claude Code as 'Stop hook error') is not needed. Reads get no line,
  a log write closes the turn without one, the line comes once per turn, UserPromptSubmit opens a new turn,
  subagent tools and other CLIs get nothing, and setup wires PostToolUse with its matcher.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_nudge.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))
os.environ["KH_HELPER_OUTCOMES"] = "off"
os.environ["KH_HELPER_WORKLOG"] = "off"   # 1.15.0: the nudge is the path when the helper does not write logs
from kh_helper import hooks, quiet  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="kh_nudge_"))
hooks.HOME = TMP
quiet.HOME = TMP
quiet.LOG_PATH = TMP / "kh-helper.log"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class KH:
    """A session that must never be called by PostToolUse."""

    def __init__(self):
        self.calls = []

    def call(self, method, path, body=None, params=None):
        self.calls.append((method, path))
        return 200, {}


def post(tool, args=None, sid="s1", cli="claude-code", **extra):
    out = io.StringIO()
    payload = {"session_id": sid, "tool_name": tool, "tool_input": args or {}, **extra}
    with contextlib.redirect_stdout(out):
        rc = hooks.run_hook("PostToolUse", KH(), json.dumps(payload), cli=cli)
    text = out.getvalue().strip()
    return rc, (json.loads(text)["hookSpecificOutput"] if text else None)


def prompt(sid="s1"):
    hooks.nudge("UserPromptSubmit", json.dumps({"session_id": sid, "prompt": "next"}), "claude-code")


LOG = ("mcp__knowledge-hub__kh_call", {"method": "POST", "path": "/vector/add", "body": {"scope": "log"}})

rc, out = post("Read")
check("a read gets no line", rc == 0 and out is None, out)
rc, out = post("mcp__knowledge-hub__kh_call", {"method": "POST", "path": "/context/step"})
check("a KH lookup gets no line", out is None, out)
rc, out = post("Edit")
check("the first change gets the nudge", rc == 0 and out and out["hookEventName"] == "PostToolUse"
      and "store worklog" in out["additionalContext"], out)
rc, out = post("Bash", {"command": "ls"})
check("only once per turn", out is None, out)

prompt()
rc, out = post("Write")
check("a new prompt opens a new turn", out is not None, out)

prompt()
rc, out = post(*LOG)
check("a log write gets no line", out is None, out)
rc, out = post("Edit")
check("a change after the log in the same turn gets no line", out is None, out)

prompt("s2")
rc, out = post("Edit", sid="s2", agent_id="a1")
check("a subagent's tool gets no line", out is None, out)
rc, out = post("Edit", sid="s2")
check("the main turn still gets its own", out is not None, out)

rc, out = post("Edit", sid="s3", cli="grok")
check("other CLIs get no line", out is None, out)
rc, out = post("Edit", sid="")
check("no session id gets no line", out is None, out)

spec = hooks.HOOKS["PostToolUse"]
check("PostToolUse matcher covers changes and MCP tools",
      all(t in spec["matcher"].split("|") for t in ("Write", "Edit", "Bash", "PowerShell", "mcp__.*")), spec)

settings = TMP / "settings.json"
settings.write_text(json.dumps({"hooks": {"Stop": [{"hooks": [{"type": "command",
                    "command": "py -m kh_helper.cli hook Stop"}]}]}}), encoding="utf-8")
hooks.claude_settings_path = lambda: settings
check("hooks_note asks for setup when PostToolUse is missing", "PostToolUse" in hooks.hooks_note("claude-code"),
      hooks.hooks_note("claude-code"))
hooks.setup_claude(settings, "https://kh.invalid", mcp=False)
wired = json.loads(settings.read_text(encoding="utf-8"))["hooks"]["PostToolUse"]
check("setup wires PostToolUse with its matcher", wired[0].get("matcher") == spec["matcher"], wired)
check("hooks_note is quiet after setup", hooks.hooks_note("claude-code") == "", hooks.hooks_note("claude-code"))

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
