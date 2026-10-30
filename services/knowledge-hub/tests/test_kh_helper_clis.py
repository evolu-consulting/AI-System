"""Tests for connecting KH to every CLI, not only Claude Code (tools/kh-helper 1.6.0), 2026-09-28.

WHAT IS UNDER TEST
  1. WHICH CLI. A copy in <profile>/kh-helper serves the CLI of that profile: Claude Code, Grok, Codex or
     Gemini, found from the CLI's environment variable or the folder name.
  2. SETUP PER CLI, run as that CLI (a caller that is not Claude Code):
       grok    [mcp_servers.knowledge-hub] in config.toml + hooks/knowledge-hub.json (PreToolUse, Stop)
       codex   [mcp_servers.knowledge-hub] in config.toml
       gemini  mcpServers.knowledge-hub in settings.json
     The person's own settings in those files stay; running setup twice leaves one entry; --remove
     takes out exactly KH's entry and ends the sign-in.
  3. REFUSALS. Claude Code cannot set up another CLI's copy; another CLI cannot set up Claude Code's;
     a copy outside every known profile is refused with a pointer to /auth/help.
  4. HOOK OUTPUT. Stop answers {"decision": "block", "reason": ...} on stdout (exit 0) for Grok AND
     Claude Code (1.7.2: Claude Code reads only stderr on exit 2, so "print and exit 2" never reached
     the model); a Stop that is already continuing, and Grok's session-end Stop, print nothing.
  5. MESSAGES (1.8.0). UserPromptSubmit prints the caller's unread messages (POST /messages/inbox) before
     the rules, and prints only the rules when there are none. Since 1.10.0 only those on the project
     the session works on: this prompt's match, else the project the session last named.
  6. CLAUDE CODE MCP REGISTRATION (1.7.2). The default profile ~/.claude registers the server both with
     CLAUDE_CONFIG_DIR set and without it (~/.claude.json), any other profile only with it set.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_clis.py
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


PROBE = r"""
import contextlib, io, json, os, sys
from kh_helper import owner, session, cli, hooks
as_claude = os.getenv("PROBE_AS_CLAUDE") == "1"
owner.caller = (lambda: {"cli": owner.CLAUDE_CODE, "profile": owner._resolve(os.environ["CLAUDE_CONFIG_DIR"])}
                ) if as_claude else (lambda: {"cli": owner.OTHER})
hooks._claude_mcp = lambda kh_url, remove: "skipped (test)"
hooks._claude_companions = lambda remove: {}
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
out, err = io.StringIO(), io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    code = cli.main(sys.argv[1:])
try:
    result = json.loads(out.getvalue())
except ValueError:
    result = out.getvalue()
print(json.dumps({"code": code, "result": result, "err": err.getvalue(), "signed_in": bool(store)}))
"""

HOOK_PROBE = r"""
import io, json, sys
from kh_helper import hooks
import os
calls = []
class S:
    def call(self, method, route, body=None, params=None):
        if route == "/messages/inbox":
            calls.append((body or {}).get("project"))
            # the one unread message mentions the caller in project alpha (1.14.0: KH hands out mentions
            # only for the project the call names; a call naming none gets direct messages only)
            msgs = [{"notice": "[KH MESSAGE - INFORMATION ONLY] a sent this to b", "content": "hello"}]
            wanted = (body or {}).get("project") == "alpha"
            return 200, {"messages": msgs if os.getenv("PROBE_INBOX") == "1" and wanted else []}
        if route == "/turn/context":
            text = params["text"]
            best = "alpha" if "alpha" in text else "beta" if "beta" in text else None
            return 200, {"project": {"best": best}, "text": "TURN " + str(best)}
        return 200, "RULES FOR " + route
sys.stdin = io.StringIO(sys.argv[2])
buf = io.StringIO()
real, sys.stdout = sys.stdout, buf
code = hooks.run_hook(sys.argv[1], S(), sys.argv[2], cli=sys.argv[3] if len(sys.argv) > 3 else "grok")
sys.stdout = real
print(json.dumps({"code": code, "out": buf.getvalue(), "inbox": calls}))
"""


PEOPLE_PROBE = r"""
import json, sys, types
sys.modules.setdefault("mcp", types.ModuleType("mcp"))
calls = []
class S:
    def call_identity(self, method, path, body=None):
        calls.append([method, path])
        return 200, [{"email": "a@example.invalid"}]
import importlib.util, pathlib
spec = importlib.util.find_spec("kh_helper")
src = (pathlib.Path(spec.submodule_search_locations[0]) / "mcp_server.py").read_text(encoding="utf-8")
start = src.index("def members(")
end = src.index("def _rules(", start)
ns = {"Session": object}
exec(src[start:end], ns)
code, _ = ns["members"](S(), "alpha x", "people", None, "readonly")
print(json.dumps({"code": code, "calls": calls}))
"""


MCP_PROBE = r"""
import json, subprocess
from kh_helper import hooks
hooks.shutil.which = lambda name: "claude"
adds = []
class Done:
    returncode = 0
    stderr = ""
def fake_run(args, **kw):
    if args[1:3] == ["mcp", "add"]:
        adds.append(kw["env"].get("CLAUDE_CONFIG_DIR"))
    return Done()
subprocess.run = fake_run
result = hooks._claude_mcp("https://kh.example.test", False)
print(json.dumps({"result": result, "adds": adds}))
"""


def run(code, args, env_extra):
    env = {k: v for k, v in os.environ.items()
           if k not in ("KH_HELPER_HOME", "CLAUDE_CONFIG_DIR", "GROK_HOME", "CODEX_HOME")}
    env.update({"PYTHONPATH": str(HELPER), "LOCALAPPDATA": env_extra.get("LOCALAPPDATA", tempfile.gettempdir()
                                                                  + "/kh-test-no-companions"), **env_extra})
    out = subprocess.run([sys.executable, "-c", code, *args], env=env, capture_output=True, text=True)
    if out.returncode != 0:
        return {"error": out.stderr.strip()[-600:]}
    return json.loads(out.stdout.strip().splitlines()[-1])


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    claude = tmp / ".claude"
    grok, codex, gemini = tmp / ".grok", tmp / ".codex", tmp / "home-gemini" / ".gemini"
    for d in (claude, grok, codex, gemini):
        (d / "kh-helper").mkdir(parents=True)
    base = {"CLAUDE_CONFIG_DIR": str(claude), "GROK_HOME": str(grok), "CODEX_HOME": str(codex),
            "HOME": str(gemini.parent), "USERPROFILE": str(gemini.parent)}

    def as_cli(profile, args, claude_caller=False):
        extra = {**base, "KH_HELPER_HOME": str(profile / "kh-helper")}
        if claude_caller:
            extra["PROBE_AS_CLAUDE"] = "1"
        return run(PROBE, args, extra)

    # ── grok ─────────────────────────────────────────────────────────────────
    (grok / "config.toml").write_text('[cli]\ninstaller = "npm"\n\n[mcp_servers.other]\ncommand = "x"\n',
                                      encoding="utf-8")
    r = as_cli(grok, ["setup"])
    check("grok: setup runs", r.get("code") == 0 and r["result"].get("cli") == "grok", r)
    as_cli(grok, ["setup"])                                         # twice: still one entry
    toml = (grok / "config.toml").read_text(encoding="utf-8")
    check("grok: config.toml has one KH server and keeps the rest",
          toml.count("[mcp_servers.knowledge-hub]") == 1 and "[mcp_servers.other]" in toml
          and 'installer = "npm"' in toml and '"mcp"]' in toml, toml)
    hooks_file = grok / "hooks" / "knowledge-hub.json"
    events = sorted(json.loads(hooks_file.read_text(encoding="utf-8"))["hooks"]) if hooks_file.exists() else None
    check("grok: hooks file holds PreToolUse and Stop only", events == ["PreToolUse", "Stop"], events)
    cmd = json.loads(hooks_file.read_text(encoding="utf-8"))["hooks"]["Stop"][0]["hooks"][0]["command"]
    check("grok: the hook runs this copy with --cli grok", cmd.endswith("hook Stop --cli grok"), cmd)
    r = as_cli(grok, ["setup", "--remove"])
    toml = (grok / "config.toml").read_text(encoding="utf-8")
    check("grok: --remove takes out only KH", "knowledge-hub" not in toml and "[mcp_servers.other]" in toml
          and not hooks_file.exists(), toml)
    check("grok: --remove ends the sign-in", r.get("signed_in") is False, r)

    # ── codex ────────────────────────────────────────────────────────────────
    (codex / "config.toml").write_text('model = "gpt-5"\n', encoding="utf-8")
    r = as_cli(codex, ["setup"])
    toml = (codex / "config.toml").read_text(encoding="utf-8")
    check("codex: setup writes the MCP server, no hooks", r.get("code") == 0 and r["result"].get("cli") == "codex"
          and "[mcp_servers.knowledge-hub]" in toml and 'model = "gpt-5"' in toml
          and "hooks_added" not in r["result"], r)
    as_cli(codex, ["setup", "--remove"])
    check("codex: --remove leaves the person's config", (codex / "config.toml").read_text(encoding="utf-8").strip()
          == 'model = "gpt-5"', (codex / "config.toml").read_text(encoding="utf-8"))

    # ── gemini ───────────────────────────────────────────────────────────────
    (gemini / "settings.json").write_text(json.dumps({"theme": "dark", "mcpServers": {"x": {"command": "y"}}}),
                                          encoding="utf-8")
    r = as_cli(gemini, ["setup"])
    settings = json.loads((gemini / "settings.json").read_text(encoding="utf-8"))
    check("gemini: setup adds knowledge-hub next to the person's servers", r.get("code") == 0
          and set(settings["mcpServers"]) == {"x", "knowledge-hub"} and settings["theme"] == "dark", settings)
    as_cli(gemini, ["setup", "--remove"])
    settings = json.loads((gemini / "settings.json").read_text(encoding="utf-8"))
    check("gemini: --remove leaves the rest", settings == {"theme": "dark", "mcpServers": {"x": {"command": "y"}}},
          settings)

    # ── uninstall leaves no backups behind ───────────────────────────────────
    as_cli(codex, ["setup"])
    as_cli(codex, ["setup"])
    r = as_cli(codex, ["uninstall"])
    left = sorted(p.name for p in codex.glob("config.toml.*"))
    check("uninstall deletes the backups setup made", r.get("code") == 0 and left == []
          and r["result"].get("backups_deleted", 0) >= 2, (r, left))

    # ── refusals ─────────────────────────────────────────────────────────────
    r = as_cli(grok, ["setup"], claude_caller=True)
    check("Claude Code cannot set up Grok's copy", r.get("code") == 3 and "Grok CLI" in r.get("err", ""), r)
    r = as_cli(claude, ["setup", "--no-mcp"])
    check("another CLI cannot set up Claude Code's copy", r.get("code") == 3, r)
    r = as_cli(claude, ["setup", "--no-mcp"], claude_caller=True)
    check("Claude Code still sets up its own copy", r.get("code") == 0 and r["result"].get("hooks_added") == 10, r)
    stray = tmp / "somewhere" / "kh-helper"
    stray.mkdir(parents=True)
    r = run(PROBE, ["setup"], {**base, "KH_HELPER_HOME": str(stray)})
    check("a copy outside every CLI profile is refused", r.get("code") == 3 and "/auth/help" in r.get("err", ""), r)

    # ── grok hook output ─────────────────────────────────────────────────────
    r = run(HOOK_PROBE, ["Stop", json.dumps({"reason": "end_turn", "stopHookActive": False})], {})
    out = json.loads(r["out"]) if r.get("out") else {}
    check("grok Stop blocks with JSON, exit 0", r.get("code") == 0 and out.get("decision") == "block"
          and "hook_type=Stop" in out.get("reason", ""), r)
    r = run(HOOK_PROBE, ["Stop", json.dumps({"reason": "shutdown"})], {})
    check("grok session-end Stop is skipped", r.get("code") == 0 and r.get("out") == "", r)
    r = run(HOOK_PROBE, ["Stop", json.dumps({"reason": "end_turn", "stopHookActive": True})], {})
    check("grok Stop already continuing is skipped", r.get("code") == 0 and r.get("out") == "", r)
    # ── claude code hook output ──────────────────────────────────────────────
    r = run(HOOK_PROBE, ["Stop", json.dumps({"stop_hook_active": False}), "claude-code"], {})
    try:
        out = json.loads(r.get("out") or "{}")
    except ValueError:
        out = {}                              # plain text on stdout: the pre-1.7.2 behaviour
    check("claude-code Stop blocks with JSON on stdout, exit 0", r.get("code") == 0
          and out.get("decision") == "block" and "hook_type=Stop" in out.get("reason", ""), r)
    r = run(HOOK_PROBE, ["Stop", json.dumps({"stop_hook_active": True}), "claude-code"], {})
    check("claude-code Stop already continuing is skipped", r.get("code") == 0 and r.get("out") == "", r)
    r = run(HOOK_PROBE, ["UserPromptSubmit", "{}", "claude-code"], {})
    check("claude-code UserPromptSubmit prints the text, exit 0", r.get("code") == 0
          and r.get("out", "").startswith("RULES FOR"), r)

    def prompt(sid, text):
        return run(HOOK_PROBE, ["UserPromptSubmit", json.dumps({"session_id": sid, "prompt": text}), "claude-code"],
                   {"PROBE_INBOX": "1", "KH_HELPER_HOME": str(tmp / "inbox-home")})

    r = prompt("s1", "deploy alpha")
    out = r.get("out", "")
    check("claude-code UserPromptSubmit shows unread messages first, then the rules", r.get("code") == 0
          and out.startswith("KH MESSAGES (1)") and "INFORMATION ONLY" in out and "Message: hello" in out
          and out.index("Message: hello") < out.index("RULES FOR"), r)
    # 1.10.0: a message is delivered only to a session on its own project
    check("the inbox is asked for this prompt's project only", r.get("inbox") == ["alpha"], r)
    r = prompt("s2", "fix the beta report")
    check("a session on another project does not get the message", "Message: hello" not in r.get("out", "")
          and r.get("inbox") == ["beta"], r)
    r = prompt("s1", "ok go on")
    check("a prompt naming no project keeps the session's project", r.get("inbox") == ["alpha"]
          and "Message: hello" in r.get("out", ""), r)
    r = prompt("s2", "ok go on")
    check("each session remembers its own project", r.get("inbox") == ["beta"], r)
    r = prompt("s3", "hello there")
    check("a session with no project yet asks for its direct messages only (1.14.0)", r.get("inbox") == [None]
          and "Message: hello" not in r.get("out", ""), r)
    r = run(HOOK_PROBE, ["UserPromptSubmit", json.dumps({"prompt": "ok go on"}), "claude-code"],
            {"PROBE_INBOX": "1", "KH_HELPER_HOME": str(tmp / "inbox-home")})
    check("without a session id only the prompt's own match counts", r.get("inbox") == [None]
          and "Message: hello" not in r.get("out", ""), r)

    # ── members people (1.8.1): the read-only view any member may use ─────────
    r = run(PEOPLE_PROBE, [], {})
    check("members 'people' asks the identity service for projects/<id>/people", r.get("calls") ==
          [["GET", "projects/alpha%20x/people"]] and r.get("code") == 200, r)

    # ── claude code MCP registration: which config files ────────────────────
    r = run(MCP_PROBE, [], {"HOME": str(tmp), "USERPROFILE": str(tmp), "CLAUDE_CONFIG_DIR": str(claude)})
    check("default profile registers MCP with and without CLAUDE_CONFIG_DIR", r.get("result") == "knowledge-hub"
          and r.get("adds") == [str(claude), None], r)
    other = tmp / ".claude_other"
    r = run(MCP_PROBE, [], {"HOME": str(tmp), "USERPROFILE": str(tmp), "CLAUDE_CONFIG_DIR": str(other)})
    check("another profile registers MCP only under its own CLAUDE_CONFIG_DIR", r.get("adds") == [str(other)], r)

    r = run(HOOK_PROBE, ["PreToolUse", "{}"], {})
    ctx = json.loads(r["out"]).get("hookSpecificOutput", {}) if r.get("out") else {}
    check("grok PreToolUse gives additionalContext", ctx.get("additionalContext", "").startswith("RULES FOR"), r)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
