"""Tests for quiet failures in the KH helper (tools/kh-helper 1.9.1), 2026-10-03.

WHAT IS UNDER TEST
  A slow or unreachable KH must never reach the person as a red error.
  1. SLOW KH IN A HOOK: the hook gives up at its own deadline, exits 0, logs it, and shows one polite
     systemMessage - at most once per NOTICE_EVERY, so a slow spell does not repeat it on every tool.
  2. NETWORK ERROR IN A HOOK: same polite line, the traceback in the log.
  3. OTHER ERROR IN A HOOK: logged, nothing shown, exit 0.
  4. FAST KH: the hook prints the rules exactly as before.
  5. MCP TOOLS: a network failure answers 503 with a calm note for the assistant, logged.

Run from the repo root with the project venv (the MCP library is stubbed):
    .venv\\Scripts\\python tests\\test_kh_helper_quiet.py
"""
import contextlib
import io
import json
import sys
import tempfile
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))


class _FakeServer:
    tools: dict = {}

    def __init__(self, name, instructions=""):
        self.instructions = instructions

    def tool(self, **_kw):
        def keep(fn):
            _FakeServer.tools[fn.__name__] = fn
            return fn
        return keep


fake = types.ModuleType("mcp.server.mcpserver")
fake.MCPServer = _FakeServer
for name in ("mcp", "mcp.server"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["mcp.server.mcpserver"] = fake

import requests  # noqa: E402

from kh_helper import hooks, mcp_server, quiet  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="kh_quiet_"))
quiet.HOME = TMP
quiet.LOG_PATH = TMP / "kh-helper.log"
quiet.NOTICE_PATH = TMP / "slow-notice"
hooks.HOOK_SECONDS = 0.5

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class Session:
    def __init__(self, behaviour):
        self.behaviour = behaviour

    def call(self, method, path, body=None, params=None):
        return self.behaviour()


def hook(behaviour, event="UserPromptSubmit"):
    out = io.StringIO()
    t = time.time()
    with contextlib.redirect_stdout(out):
        rc = hooks.run_hook(event, Session(behaviour), json.dumps({"prompt": "hello"}))
    return rc, out.getvalue(), time.time() - t


def log_text():
    return quiet.LOG_PATH.read_text(encoding="utf-8") if quiet.LOG_PATH.exists() else ""


def slow():
    time.sleep(3)
    return 200, "late"


# 1. slow KH
rc, out, took = hook(slow)
check("slow: exit 0 at the deadline", rc == 0 and took < 2, (rc, round(took, 2)))
check("slow: one polite systemMessage", json.loads(out or "{}").get("systemMessage") == quiet.SLOW, out)
check("slow: logged", "did not answer within" in log_text(), log_text()[-200:])
rc, out, _ = hook(slow)
check("slow again: no repeated notice inside NOTICE_EVERY", rc == 0 and out == "", out)
rc, out, _ = hook(slow, event="Stop")
check("slow Stop: exit 0, no block and no repeat", rc == 0 and "block" not in out, out)

# 2. network error
quiet.NOTICE_PATH.unlink()


def down():
    raise requests.ConnectionError("connect timed out")


rc, out, _ = hook(down)
check("network error: exit 0 and the polite line", rc == 0 and json.loads(out or "{}").get("systemMessage")
      == quiet.SLOW, out)
check("network error: traceback in the log", "ConnectionError" in log_text() and "Traceback" in log_text())


# 3. other error
def broken():
    raise ValueError("bad payload")


quiet.NOTICE_PATH.unlink()
rc, out, _ = hook(broken)
check("other error: exit 0, nothing shown", rc == 0 and out == "", out)
check("other error: logged", "ValueError" in log_text())

# 4. fast KH
rc, out, _ = hook(lambda: (200, "RULE TEXT"))
check("fast KH: rules printed as before", rc == 0 and "RULE TEXT" in out and "systemMessage" not in out, out)

# 5. MCP tools
mcp_server._rules = lambda session, event: ""
mcp_server.build(Session(down), startup_seconds=1)
answer = json.loads(_FakeServer.tools["kh_call"]("GET", "/health"))
check("mcp: network failure answers 503 with a calm note", answer == {"status": 503, "error": quiet.SLOW_TOOL}, answer)
check("mcp: logged", "mcp tool" in log_text())
mcp_server._rules = lambda session, event: (_ for _ in ()).throw(requests.Timeout("read timed out"))
check("mcp kh_context: calm note", _FakeServer.tools["kh_context"]("Stop") == quiet.SLOW_TOOL)

check("the polite line is one short sentence pair", len(quiet.SLOW) < 140 and "error" not in quiet.SLOW.lower())

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
