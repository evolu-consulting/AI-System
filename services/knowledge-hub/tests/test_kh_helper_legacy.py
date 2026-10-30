"""Tests for setup over an older local KH install (tools/kh-helper 1.8.3), 2026-10-01.

WHAT IS UNDER TEST
  1. SETUP REPLACES THE OLD HOOKS. A profile that ran the local KH before the helper has hooks written
     by hand: curl or Invoke-RestMethod against /hooks/raw, /personalization/render and
     /hooks/turn_mutated. Before 1.8.3 setup kept them and added its own next to them, so every event
     ran twice and the rules reached the model twice. Now they are taken out, and counted.
  2. POSTCOMPACT IS ONE OF THE HELPER'S HOOKS, so taking the old one out does not lose the reload of
     the session rules after a compaction. Its output is the SessionStart rules, prefixed, as
     additionalContext.
  3. THE PERSON'S OWN HOOKS STAY, and setup --remove still takes out only the helper's own.
  4. Running setup twice changes nothing more.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_legacy.py

No network: the MCP registration and the KH calls are replaced.
"""
import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))

from kh_helper import hooks  # noqa: E402

hooks._claude_mcp = lambda kh_url, remove: "skipped (test)"   # never touch the real Claude Code MCP list
hooks._claude_companions = lambda remove: {}

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


def cmd(command, **extra):
    return {"type": "command", "command": command, **extra}


# The hooks of an older local install, as they were written on a real profile.
OLD = {
    "SessionStart": [
        {"hooks": [cmd('curl.exe -s "http://127.0.0.1:9000/hooks/raw?hook_type=SessionStart"', shell="powershell")]},
        {"hooks": [cmd('curl.exe -s "http://127.0.0.1:9000/personalization/render"', shell="powershell")]},
    ],
    "UserPromptSubmit": [
        {"hooks": [cmd('curl.exe -s "http://127.0.0.1:9000/hooks/raw?hook_type=UserPromptSubmit"')]},
    ],
    "PreToolUse": [
        {"matcher": "Agent|Task|Write|Edit|NotebookEdit|Bash|PowerShell",
         "hooks": [cmd('$c=(curl.exe -s "http://127.0.0.1:9000/hooks/raw?hook_type=PreToolUse" | Out-String)')]},
    ],
    "PostCompact": [
        {"hooks": [cmd('$c=(curl.exe -s "http://127.0.0.1:9000/hooks/raw?hook_type=SessionStart" | Out-String)')]},
    ],
    "Stop": [
        {"hooks": [cmd("Invoke-RestMethod -Uri 'http://127.0.0.1:9000/hooks/turn_mutated' -Method Post; "
                       'curl.exe -s "http://127.0.0.1:9000/hooks/raw?hook_type=Stop"; exit 2',
                       asyncRewake=True)]},
        {"hooks": [cmd("echo mine")]},
    ],
}


def commands(settings):
    return [h["command"] for groups in settings.get("hooks", {}).values() for g in groups for h in g["hooks"]]


def write(path, hooks_block):
    path.write_text(json.dumps({"model": "opus", "hooks": hooks_block}), encoding="utf-8")


with tempfile.TemporaryDirectory() as tmp:
    settings = Path(tmp) / "settings.json"
    write(settings, OLD)

    # ── 1. setup replaces the old hooks ──────────────────────────────────────
    result = hooks.setup_claude(settings, "https://kh.example.test", mcp=False)
    written = json.loads(settings.read_text(encoding="utf-8"))
    every = commands(written)
    ours = [c for c in every if "kh_helper.cli hook" in c]
    check("the six old hooks are counted as replaced", result.get("legacy_hooks_replaced") == 6, result)
    check("none of them is left", not any(r in c for c in every for r in hooks.LEGACY_ROUTES), every)
    check("the helper's ten hooks are there, once each", sorted(c.rsplit(" ", 1)[-1] for c in ours)
          == sorted(["SessionStart", "SessionStartPersonal", "SessionStartRest", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "PostCompactPersonal", "PostCompactRest",
                     "PostCompact"]), ours)
    check("the merged kernel is three SessionStart part hooks (1.18.3, 2026-10-29)",
          sorted(h["command"].rsplit(" ", 1)[-1] for g in written["hooks"]["SessionStart"] for h in g["hooks"]
                 if "kh_helper.cli hook" in h["command"]) == ["SessionStart", "SessionStartPersonal", "SessionStartRest"], written["hooks"])
    check("no event is left with an empty group",
          all(g["hooks"] for groups in written["hooks"].values() for g in groups), written["hooks"])
    check("other settings are kept", written.get("model") == "opus", written)

    # ── 3. the person's own hook stays ───────────────────────────────────────
    check("the person's own hook is kept", "echo mine" in every, every)

    # ── 4. idempotent ────────────────────────────────────────────────────────
    again = hooks.setup_claude(settings, "https://kh.example.test", mcp=False)
    check("a second setup finds no old hooks", again.get("legacy_hooks_replaced") == 0, again)
    check("and leaves the same hooks", commands(json.loads(settings.read_text(encoding="utf-8"))) == every)

    # ── 3b. --remove still takes out only the helper's own ───────────────────
    write(settings, OLD)
    removed = hooks.setup_claude(settings, "https://kh.example.test", remove=True, mcp=False)
    check("--remove leaves an old install's hooks alone",
          removed.get("legacy_hooks_replaced") == 0
          and commands(json.loads(settings.read_text(encoding="utf-8"))) == commands({"hooks": OLD}), removed)

    # A hook that merely mentions KH, or calls another server, is not an old KH hook.
    write(settings, {"Stop": [{"hooks": [cmd("echo knowledge hub"), cmd("curl https://example.test/raw")]}]})
    other = hooks.setup_claude(settings, "https://kh.example.test", mcp=False)
    check("unrelated hooks are not matched", other.get("legacy_hooks_replaced") == 0, other)

# ── 2. PostCompact output ────────────────────────────────────────────────────
class FakeSession:
    def call(self, method, route, body=None):
        return (200, "RULES " + route) if route == "/hooks/raw?hook_type=SessionStart" else (404, "")


out = io.StringIO()
with contextlib.redirect_stdout(out):
    code = hooks.run_hook("PostCompact", FakeSession(), "{}")
try:
    shaped = json.loads(out.getvalue())
except ValueError:
    shaped = {}
ctx = (shaped.get("hookSpecificOutput") or {})
check("PostCompact exits 0", code == 0, code)
check("PostCompact is additionalContext for PostCompact",
      ctx.get("hookEventName") == "PostCompact", out.getvalue()[:300])
check("it carries the SessionStart rules after the compaction notice",
      (ctx.get("additionalContext") or "").startswith("CONTEXT WAS JUST COMPACTED")
      and ctx["additionalContext"].endswith("RULES /hooks/raw?hook_type=SessionStart"), ctx)

# ── 5. SessionStart split (1.18.3): each hook prints one part, each under its own 10k cap ──
class SplitSession:
    actor = None

    def call(self, method, route, body=None):
        if route in ("/hooks/raw?hook_type=SessionStart", "/personalization/render"):
            return 200, "TEXT " + route
        return 404, ""


def printed(event):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        hooks.run_hook(event, SplitSession(), "{}")
    return buf.getvalue()


kernel, personal = printed("SessionStart"), printed("SessionStartPersonal")
check("the SessionStart hook prints the kernel, not the personalization",
      "TEXT /hooks/raw?hook_type=SessionStart" in kernel and "/personalization/render" not in kernel, kernel[:300])
check("the SessionStartPersonal hook prints only the personalization",
      personal.strip() == "TEXT /personalization/render", personal[:300])

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
