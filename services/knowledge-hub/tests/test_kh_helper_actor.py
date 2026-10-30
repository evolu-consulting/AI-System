"""Tests for sessions as actors in the KH helper (tools/kh-helper 1.18.0), 2026-10-24.

WHAT IS UNDER TEST
  Several CLI sessions share one sign-in. Every KH call names its session in X-KH-Actor (KH app/auth.py
  ACTORS): a hook takes the id from its own input, a worklog job from the turn it logs (never the worker's
  own), KH_ACTOR overrides the environment, and the MCP server, whose environment keeps the id it started
  with, follows the latest id the hooks saw for the same CLI process (CLAUDE_PID). kh_message takes to_actor.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_actor.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))
os.environ["KH_HELPER_OUTCOMES"] = "off"
for name in ("KH_ACTOR", "CLAUDE_PID", "CLAUDE_CODE_SESSION_ID"):
    os.environ.pop(name, None)
from kh_helper import hooks, quiet, session as ses, worklog  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="kh_actor_"))
ses.ACTORS_PATH = TMP / "session-actors.json"
hooks.HOME = quiet.HOME = TMP
quiet.LOG_PATH = TMP / "kh-helper.log"
hooks.SESSION_PROJECTS = TMP / "session-projects.json"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


def headers(s):
    s._access_token = lambda: "tok"
    return ses.Session._headers(s)


def bare():
    s = ses.Session.__new__(ses.Session)
    s.acting_token, s.actor = None, None
    return s


# ── ids ─────────────────────────────────────────────────────────────────────
check("a uuid is taken as it is", ses.actor_id("69c53622-fb83-408c-8b3d-9687290a34f7")
      == "69c53622-fb83-408c-8b3d-9687290a34f7")
check("other characters become _", ses.actor_id("a b/c") == "a_b_c")
check("empty or punctuation-first is none", ses.actor_id("") is None and ses.actor_id("-x") is None)
check("at most 128 characters", len(ses.actor_id("a" * 300)) == 128)

# ── where the id comes from ─────────────────────────────────────────────────
s = bare()
check("no id anywhere: no header", "X-KH-Actor" not in headers(s), headers(s))
os.environ["CLAUDE_CODE_SESSION_ID"] = "env-session"
check("the CLI's environment names it", headers(s).get("X-KH-Actor") == "env-session")
os.environ["CLAUDE_PID"] = "4242"
ses.remember_actor("after-clear")
check("the hook's latest id for this CLI process wins over the environment",
      headers(s).get("X-KH-Actor") == "after-clear", headers(s))
os.environ["CLAUDE_PID"] = "999"
check("another CLI process keeps its own", headers(s).get("X-KH-Actor") == "env-session")
os.environ["KH_ACTOR"] = "agent-set"
check("KH_ACTOR overrides the environment", headers(s).get("X-KH-Actor") == "agent-set")
s.actor = "from-hook"
check("an id the session was given wins", headers(s).get("X-KH-Actor") == "from-hook")
s.actor = ""
check("'' means this call has no session, whatever the environment says", "X-KH-Actor" not in headers(s))
for name in ("KH_ACTOR", "CLAUDE_PID", "CLAUDE_CODE_SESSION_ID"):
    os.environ.pop(name, None)


# ── hooks and the worklog worker ────────────────────────────────────────────
class KH:
    def __init__(self):
        self.calls, self.actor, self.acting_token = [], None, None
        self._access, self._access_until = "tok", 9e12

    def current_acting_token(self):
        return None

    def call(self, method, path, body=None, params=None):
        self.calls.append((path, self.actor, body))
        return 200, {"messages": []} if path == "/messages/inbox" else {}


kh = KH()
os.environ["CLAUDE_PID"] = "7777"
hooks._run_hook("UserPromptSubmit", kh, json.dumps({"session_id": "sess-abc", "prompt": "hi"}))
inbox = [c for c in kh.calls if c[0] == "/messages/inbox"]
check("a hook's calls carry its session", inbox and inbox[0][1] == "sess-abc", kh.calls)
check("the inbox call names the working folder", inbox and inbox[0][2].get("label") == Path.cwd().name, inbox)
check("and the MCP server of the same CLI follows it",
      json.loads(ses.ACTORS_PATH.read_text(encoding="utf-8"))["7777"]["actor"] == "sess-abc")
os.environ.pop("CLAUDE_PID", None)

worklog.JOBS = TMP / "worklog"
worklog.JOBS.mkdir(parents=True, exist_ok=True)
seen = []
worklog.turn_slice = lambda path: seen.append(kh.actor) or None
for name, sid in (("a.job", "sess-one"), ("b.job", "x")):
    p = worklog.JOBS / name
    p.write_text(json.dumps({"transcript": "t", "session": sid}), encoding="utf-8")
    worklog._run_job(kh, p)
check("a worklog job carries the session of its turn, a job with none carries none", seen == ["sess-one", ""], seen)

# ── kh_message ──────────────────────────────────────────────────────────────
try:
    from kh_helper import mcp_server
    import inspect
    src = inspect.getsource(mcp_server.build)
    check("kh_message takes to_actor and sends it to /messages/direct",
          "to_actor: str" in src and 'body["to_actor"] = to_actor' in src)
except ImportError as exc:                # the mcp library is not in every venv
    print(f"skip kh_message check: {exc}")

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
