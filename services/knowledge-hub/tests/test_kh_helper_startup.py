"""Tests for the MCP server's start-up deadline in the KH helper (tools/kh-helper 1.9.1), 2026-10-03.

WHAT IS UNDER TEST
  The server puts KH's SessionStart rules into its instructions, which a CLI reads at the MCP handshake.
  Reading them used to have no deadline of its own; on a slow network the handshake ran past the 30 s a
  CLI waits and the whole session lost KH. Now:
  1. FAST KH: the rules are in the instructions, as before.
  2. SLOW KH: the server starts within the deadline, without the rules, and tells the assistant to call
     kh_context("SessionStart").
  3. KH ERROR: the server starts without the rules and without the late note (nothing to fetch later).

Run from the repo root with the project venv (the MCP library is stubbed, so it need not be installed):
    .venv\\Scripts\\python tests\\test_kh_helper_startup.py
"""
import sys
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))


class _FakeServer:
    """Stands in for mcp.server.mcpserver.MCPServer: records the instructions, accepts tools."""
    def __init__(self, name, instructions=""):
        self.name, self.instructions = name, instructions

    def tool(self, **_kw):
        return lambda fn: fn

    def run(self, *_a):
        pass


fake = types.ModuleType("mcp.server.mcpserver")
fake.MCPServer = _FakeServer
for name in ("mcp", "mcp.server"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["mcp.server.mcpserver"] = fake

from kh_helper import mcp_server  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


def with_rules(behaviour):
    mcp_server._rules = lambda session, event: behaviour()


# 1. fast KH
with_rules(lambda: "RULE ONE")
server = mcp_server.build(object(), startup_seconds=2)
check("fast KH: the rules are in the instructions", "KH SESSION RULES:\nRULE ONE" in server.instructions,
      server.instructions[-200:])
check("fast KH: no late note", mcp_server.LATE_RULES not in server.instructions)

# 2. slow KH
with_rules(lambda: (time.sleep(5), "TOO LATE")[1])
t = time.time()
server = mcp_server.build(object(), startup_seconds=0.5)
took = time.time() - t
check("slow KH: the server starts at the deadline", took < 2, f"{took:.2f}s")
check("slow KH: no rules, and the note to fetch them", "TOO LATE" not in server.instructions
      and mcp_server.LATE_RULES in server.instructions, server.instructions[-300:])
check("the late note names kh_context(\"SessionStart\")", 'kh_context("SessionStart")' in mcp_server.LATE_RULES)


# 3. KH error
def boom():
    raise RuntimeError("KH answered 500")


with_rules(boom)
server = mcp_server.build(object(), startup_seconds=2)
check("KH error: the server starts without rules or late note", "KH SESSION RULES" not in server.instructions
      and mcp_server.LATE_RULES not in server.instructions)
check("the default deadline leaves room inside a CLI's 30 s", 0 < mcp_server.STARTUP_SECONDS <= 15,
      mcp_server.STARTUP_SECONDS)

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
