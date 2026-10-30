"""Tests for companion MCP servers (tools/kh-helper 1.11.0), 2026-10-07.

WHAT IS UNDER TEST
  1. DISCOVERY. companions.find() reads %LOCALAPPDATA%/AppSessionManager/mcp.json and returns the
     server only when the file names it and its command and script still exist (a stale file is ignored).
  2. SETUP PER CLI. `kh setup` writes the companion's MCP server next to knowledge-hub (Codex and Grok
     config.toml, Gemini settings.json) and keeps the person's own servers; twice leaves one entry;
     --remove takes it out. With nothing installed, setup writes no companion.
  3. CLAUDE CODE. _claude_companions registers it with `claude mcp add -s user <name> -- <command> <args>`
     per config file, and on remove calls `claude mcp remove` for every known name.
  4. LATE INSTALL. The SessionStart note asks to run setup again when the companion is installed but the
     CLI does not name it, and says nothing once it is registered.

Run from the repo root:
    python tests\\test_kh_helper_companions.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "tools" / "kh-helper"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


SETUP_PROBE = r"""
import contextlib, io, json, os, sys
from kh_helper import owner, session, cli, hooks
owner.caller = lambda: {"cli": owner.OTHER}
hooks._claude_mcp = lambda kh_url, remove: "skipped (test)"
store = {}
class FakeKeyring:
    def set_password(self, service, account, value): store[(service, account)] = value
    def get_password(self, service, account): return store.get((service, account))
    def delete_password(self, service, account): store.pop((service, account), None)
session._keyring = lambda: FakeKeyring()
class Resp:
    status_code = 200
session.requests.post = lambda url, **kw: Resp()
URL = "https://kh.example.test"
s = session.Session(URL)
store[(session.SERVICE, s._account)] = "refresh"
session._save_state({"kh_url": URL, "issuer": "https://id.example.test/realms/kh", "client_id": "kh-cli",
                     "signed_in_to": [URL]})
out = io.StringIO()
with contextlib.redirect_stdout(out):
    code = cli.main(sys.argv[1:])
print(json.dumps({"code": code, "result": json.loads(out.getvalue())}))
"""

CLAUDE_PROBE = r"""
import json, subprocess, sys
from kh_helper import hooks
hooks.shutil.which = lambda name: "claude"
calls = []
class Done:
    returncode = 0
    stderr = ""
def fake_run(args, **kw):
    calls.append(args[1:])
    return Done()
subprocess.run = fake_run
result = hooks._claude_companions(sys.argv[1] == "remove")
print(json.dumps({"result": result, "calls": calls}))
"""

NOTE_PROBE = r"""
import json
from kh_helper import hooks
print(json.dumps({"note": hooks.companion_note("claude-code")}))
"""

FIND_PROBE = r"""
import json
from kh_helper import companions
print(json.dumps(companions.find()))
"""


def run(code, args, env_extra):
    env = {k: v for k, v in os.environ.items()
           if k not in ("KH_HELPER_HOME", "CLAUDE_CONFIG_DIR", "GROK_HOME", "CODEX_HOME")}
    env.update({"PYTHONPATH": str(HELPER), **env_extra})
    out = subprocess.run([sys.executable, "-c", code, *args], env=env, capture_output=True, text=True)
    if out.returncode != 0:
        return {"error": out.stderr.strip()[-600:]}
    return json.loads(out.stdout.strip().splitlines()[-1])


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    appdata, empty = tmp / "appdata", tmp / "appdata-empty"
    tool = tmp / "asm" / "windows"
    tool.mkdir(parents=True)
    (tool / "mcp_server.py").write_text("", encoding="utf-8")
    discovery = appdata / "AppSessionManager" / "mcp.json"
    discovery.parent.mkdir(parents=True)
    spec = {"name": "app-session-manager", "command": sys.executable, "args": [str(tool / "mcp_server.py")]}
    discovery.write_text(json.dumps(spec), encoding="utf-8")
    claude, codex, gemini = tmp / ".claude", tmp / ".codex", tmp / "home-gemini" / ".gemini"
    for d in (claude, codex, gemini):
        (d / "kh-helper").mkdir(parents=True)
    base = {"CLAUDE_CONFIG_DIR": str(claude), "CODEX_HOME": str(codex), "HOME": str(gemini.parent),
            "USERPROFILE": str(gemini.parent), "LOCALAPPDATA": str(appdata)}

    # ── 1. discovery ─────────────────────────────────────────────────────────
    r = run(FIND_PROBE, [], base)
    check("find: installed companion is found", r == [spec], r)
    r = run(FIND_PROBE, [], {**base, "LOCALAPPDATA": str(empty)})
    check("find: nothing installed -> nothing", r == [], r)
    discovery.write_text(json.dumps({**spec, "args": [str(tool / "gone.py")]}), encoding="utf-8")
    r = run(FIND_PROBE, [], base)
    check("find: stale file (script gone) is ignored", r == [], r)
    discovery.write_text(json.dumps(spec), encoding="utf-8")

    # ── 2. setup per CLI ─────────────────────────────────────────────────────
    def as_cli(profile, args, extra=None):
        return run(SETUP_PROBE, args, {**base, **(extra or {}), "KH_HELPER_HOME": str(profile / "kh-helper")})

    (codex / "config.toml").write_text('model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n', encoding="utf-8")
    r = as_cli(codex, ["setup"])
    check("codex: setup reports the companion",
          r.get("result", {}).get("companions") == {"app-session-manager": "app-session-manager"}, r)
    as_cli(codex, ["setup"])
    toml = (codex / "config.toml").read_text(encoding="utf-8")
    check("codex: one companion table, KH and the person's own kept",
          toml.count("[mcp_servers.app-session-manager]") == 1 and "[mcp_servers.knowledge-hub]" in toml
          and "[mcp_servers.other]" in toml and "mcp_server.py" in toml, toml)
    as_cli(codex, ["setup", "--remove"])
    toml = (codex / "config.toml").read_text(encoding="utf-8")
    check("codex: --remove takes the companion out too",
          "app-session-manager" not in toml and "[mcp_servers.other]" in toml, toml)

    r = as_cli(gemini, ["setup"])
    servers = json.loads((gemini / "settings.json").read_text(encoding="utf-8")).get("mcpServers", {})
    check("gemini: settings.json has the companion next to KH",
          servers.get("app-session-manager", {}).get("args") == spec["args"] and "knowledge-hub" in servers, servers)
    as_cli(gemini, ["setup", "--remove"])
    servers = json.loads((gemini / "settings.json").read_text(encoding="utf-8")).get("mcpServers", {})
    check("gemini: --remove takes both out", servers == {}, servers)

    (codex / "config.toml").write_text('model = "gpt-5"\n', encoding="utf-8")
    r = as_cli(codex, ["setup"], {"LOCALAPPDATA": str(empty)})
    toml = (codex / "config.toml").read_text(encoding="utf-8")
    check("codex: nothing installed -> no companion written",
          r.get("result", {}).get("companions") == {} and "app-session-manager" not in toml, r)

    # ── 3. claude code ───────────────────────────────────────────────────────
    r = run(CLAUDE_PROBE, ["add"], base)
    adds = [c for c in r.get("calls", []) if c[:2] == ["mcp", "add"]]
    check("claude: registers with claude mcp add -s user <name> -- <command> <script>",
          r.get("result") == {"app-session-manager": "registered"}
          and adds == [["mcp", "add", "-s", "user", "app-session-manager", "--", sys.executable, spec["args"][0]]], r)
    r = run(CLAUDE_PROBE, ["remove"], {**base, "LOCALAPPDATA": str(empty)})
    check("claude: remove takes out every known companion, installed or not",
          r.get("result") == {"app-session-manager": "removed"}
          and r.get("calls") == [["mcp", "remove", "-s", "user", "app-session-manager"]], r)

    # ── 4. late install note ─────────────────────────────────────────────────
    r = run(NOTE_PROBE, [], base)
    check("note: installed but not registered -> ask to run setup",
          "app-session-manager" in r.get("note", "") and "kh_helper.cli setup" in r.get("note", ""), r)
    (claude / ".claude.json").write_text(json.dumps({"mcpServers": {"app-session-manager": {}}}), encoding="utf-8")
    r = run(NOTE_PROBE, [], base)
    check("note: registered -> silent", r.get("note") == "", r)
    r = run(NOTE_PROBE, [], {**base, "LOCALAPPDATA": str(empty)})
    check("note: not installed -> silent", r.get("note") == "", r)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
