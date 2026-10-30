"""A KH helper sign-in answers only the CLI and profile that made it (kh-helper 1.4.0, owner.py).

WHAT IS UNDER TEST
  1. THE RULES. A Claude Code HOME refuses any other CLI and any other Claude Code profile; another
     CLI's HOME refuses Claude Code; a HOME from before 1.4.0 is recognised by its folder.
  2. THE CALLER. Claude Code counts only when CLAUDECODE=1 AND CLAUDE_PID is a real ancestor, so a
     copied environment is not enough. Real child processes, nothing mocked.
  3. THE CLI. status / mcp / setup refuse with exit code 3; logout (which only takes access away)
     still works; a sign-in records its owner.
  2026-09-26: a Grok CLI used the live sign-in in ~/.claude/kh-helper without logging in.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_owner.py
No network: nobody is signed in, and the sign-in case uses an in-memory credential store.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "tools" / "kh-helper"
sys.path.insert(0, str(HELPER))
from kh_helper import owner  # noqa: E402

FAILURES = []
CLAUDE_VARS = ("CLAUDECODE", "CLAUDE_PID", "CLAUDE_CONFIG_DIR", "KH_HELPER_HOME")


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


def env_for(as_claude=None, **extra):
    """A child environment: as_claude=<profile> makes it Claude Code with this process as CLAUDE_PID."""
    env = {k: v for k, v in os.environ.items() if k not in CLAUDE_VARS}
    env["PYTHONPATH"] = str(HELPER)
    env["PYTHONIOENCODING"] = "utf-8"
    if as_claude is not None:
        env.update({"CLAUDECODE": "1", "CLAUDE_PID": str(os.getpid()), "CLAUDE_CONFIG_DIR": str(as_claude)})
    env.update(extra)
    return env


def kh(args, env):
    return subprocess.run([sys.executable, "-m", "kh_helper.cli", *args], env=env, capture_output=True,
                          text=True, timeout=60)


base = Path(tempfile.mkdtemp(prefix="kh_owner_"))
claude = base / ".claude"
claude_other = base / ".claude_other"
grok = base / ".grok"
custom = base / "my-claude"
for folder in (claude, claude_other, grok, custom):
    (folder / "kh-helper").mkdir(parents=True)
(custom / ".credentials.json").write_text("{}")
CLAUDE_HOME = claude / "kh-helper"
R = owner._resolve


def who_claude(profile):
    return {"cli": owner.CLAUDE_CODE, "profile": R(profile)}


OTHER = {"cli": owner.OTHER}

# ── 1. the rules ─────────────────────────────────────────────────────────────
check("a Claude Code home refuses another CLI", owner.refusal(CLAUDE_HOME, {}, OTHER) is not None)
check("a Claude Code home answers Claude Code in that profile", owner.refusal(CLAUDE_HOME, {}, who_claude(claude)) is None)
check("a Claude Code home refuses another Claude Code profile",
      owner.refusal(CLAUDE_HOME, {}, who_claude(claude_other)) is not None)
grok_state = {"owner": {"cli": owner.OTHER, "profile": R(grok)}}
check("another CLI's home refuses Claude Code", owner.refusal(grok / "kh-helper", grok_state, who_claude(claude)) is not None)
check("another CLI's home answers that CLI", owner.refusal(grok / "kh-helper", grok_state, OTHER) is None)
check("a pre-1.4.0 home in a custom-named Claude profile is recognised by its files",
      owner.refusal(custom / "kh-helper", {}, OTHER) is not None)
plain = base / "plain" / "kh-helper"
plain.mkdir(parents=True)
check("a pre-1.4.0 home inside the calling Claude profile answers it",
      owner.refusal(plain, {}, who_claude(plain.parent)) is None)
check("a recorded owner wins over the folder name",
      owner.refusal(CLAUDE_HOME, {"owner": {"cli": owner.OTHER, "profile": R(claude)}}, OTHER) is None)

# ── 2. the caller, in real child processes ───────────────────────────────────
PROBE = "import json; from kh_helper import owner; print(json.dumps(owner.caller()))"
# The same probe with the parent-process walk switched off: these tests run from Claude Code's own shell, whose
# claude.exe a 1.17.2 walk now finds through the shells, so only CLAUDE_PID decides here.
PROBE_PID_ONLY = ("import json; from kh_helper import owner; owner.launched_by_claude = lambda: False; "
                  "print(json.dumps(owner.caller()))")


def caller_in(env, probe=PROBE):
    out = subprocess.run([sys.executable, "-c", probe], env=env, capture_output=True, text=True, timeout=60)
    try:
        return json.loads(out.stdout)
    except ValueError:
        return {"error": out.stderr[-300:]}


c = caller_in(env_for(as_claude=claude))
check("Claude Code is recognised when CLAUDE_PID is an ancestor",
      c.get("cli") == owner.CLAUDE_CODE and c.get("profile") == R(claude), c)
stranger = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
try:
    c = caller_in(env_for(as_claude=claude, CLAUDE_PID=str(stranger.pid)), PROBE_PID_ONLY)
    check("a copied environment with a CLAUDE_PID that is not an ancestor is not Claude Code",
          c.get("cli") == owner.OTHER, c)
finally:
    stranger.kill()
check("no CLAUDECODE is not Claude Code", caller_in(env_for()).get("cli") == owner.OTHER)

# ── 3. the CLI ───────────────────────────────────────────────────────────────
at_claude_home = {"KH_HELPER_HOME": str(CLAUDE_HOME)}
r = kh(["status"], env_for(**at_claude_home))
check("status from another CLI on Claude's home: refused with exit 3",
      r.returncode == 3 and "Refused" in r.stderr, (r.returncode, r.stderr[-300:]))
r = kh(["status"], env_for(as_claude=claude, **at_claude_home))
check("status from Claude Code in that profile works", r.returncode == 0 and '"owner"' in r.stdout,
      (r.returncode, r.stderr[-300:]))
r = kh(["status"], env_for(as_claude=claude_other, **at_claude_home))
check("status from another Claude Code profile: refused", r.returncode == 3, (r.returncode, r.stderr[-300:]))
r = kh(["mcp"], env_for(**at_claude_home))
check("the MCP server will not start for another CLI", r.returncode == 3, (r.returncode, r.stderr[-300:]))
r = kh(["call", "GET", "/auth/me"], env_for(**at_claude_home))
check("a call from another CLI: refused before any request", r.returncode == 3, (r.returncode, r.stderr[-300:]))
r = kh(["setup", "--settings", str(base / "s.json"), "--no-mcp"], env_for(**at_claude_home))
check("setup from another CLI: refused", r.returncode == 3 and not (base / "s.json").exists(),
      (r.returncode, r.stderr[-300:]))
r = kh(["setup", "--settings", str(base / "s.json"), "--no-mcp"], env_for(as_claude=claude_other, **at_claude_home))
check("setup from Claude Code with a helper outside its profile: refused", r.returncode == 3,
      (r.returncode, r.stderr[-300:]))
r = kh(["setup", "--settings", str(base / "s.json"), "--no-mcp"], env_for(as_claude=claude, **at_claude_home))
hooks = json.loads((base / "s.json").read_text()).get("hooks", {}) if (base / "s.json").exists() else {}
check("setup from Claude Code with its own copy works", r.returncode == 0 and len(hooks) == 6,
      (r.returncode, r.stderr[-300:]))
r = kh(["logout"], env_for(**at_claude_home))
check("logout still works from anywhere (it only takes access away)", r.returncode == 0, (r.returncode, r.stderr[-300:]))

SIGN_IN = r"""
import json, os
from kh_helper import owner, session
store = {}
class FakeKeyring:
    def set_password(self, service, account, value): store[(service, account)] = value
    def get_password(self, service, account): return store.get((service, account))
    def delete_password(self, service, account): store.pop((service, account), None)
session._keyring = lambda: FakeKeyring()
s = session.Session("https://kh.example.test")
s._store(session.AuthConfig("https://id.example.test/realms/kh", "kh-cli"),
         {"refresh_token": "a.e30.b", "access_token": "a.eyJlbWFpbCI6InhAeS56In0.b", "expires_in": 300})
print(json.dumps(json.loads(session.STATE_PATH.read_text()).get("owner")))
"""
g = subprocess.run([sys.executable, "-c", SIGN_IN], env=env_for(KH_HELPER_HOME=str(grok / "kh-helper")),
                   capture_output=True, text=True, timeout=60)
rec = json.loads(g.stdout or "null") or {}
check("a sign-in from another CLI records that CLI as the owner",
      rec.get("cli") == owner.OTHER and rec.get("profile") == R(grok), (rec, g.stderr[-300:]))
r = kh(["status"], env_for(as_claude=claude, KH_HELPER_HOME=str(grok / "kh-helper")))
check("Claude Code is refused on that recorded home", r.returncode == 3, (r.returncode, r.stderr[-300:]))
r = kh(["login"], env_for(as_claude=claude, KH_HELPER_HOME=str(grok / "kh-helper")))
check("Claude Code cannot sign in over another CLI's sign-in", r.returncode == 3, (r.returncode, r.stderr[-300:]))

# ── 1.8.2: an MCP server started by Claude Code has no usable CLAUDE_PID; its direct parent decides ────
real_processes, real_pid = owner._processes, os.getpid
try:
    owner.os.getpid = lambda: 100
    owner._processes = lambda: {100: (90, "python.exe"), 90: (80, "claude.exe"), 80: (1, "explorer.exe")}
    check("launched straight from claude.exe counts as Claude Code", owner.launched_by_claude())
    owner._processes = lambda: {100: (95, "python.exe"), 95: (90, "python.exe"), 90: (80, "claude.exe")}
    check("a venv python launcher in between still counts", owner.launched_by_claude())
    owner._processes = lambda: {100: (95, "python.exe"), 95: (91, "bash.exe"), 91: (90, "grok.exe"),
                                90: (80, "claude.exe")}
    check("another program between us and claude.exe does not count", not owner.launched_by_claude())
    owner._processes = lambda: {100: (90, "python.exe"), 90: (80, "node.exe")}
    check("no claude.exe parent does not count", not owner.launched_by_claude())
    owner._processes = lambda: {100: (95, "python.exe"), 95: (94, "bash.exe"), 94: (93, "bash.exe"),
                                93: (90, "pwsh.exe"), 90: (80, "claude.exe")}
    check("1.17.2: Claude Code's own Bash / PowerShell tool shells are stepped over", owner.launched_by_claude())
    owner._processes = lambda: {i: (i - 1, "bash.exe") for i in range(91, 101)} | {90: (80, "claude.exe")}
    check("1.17.2: but not without end (MAX_HOPS)", not owner.launched_by_claude())
finally:
    owner._processes, owner.os.getpid = real_processes, real_pid

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
