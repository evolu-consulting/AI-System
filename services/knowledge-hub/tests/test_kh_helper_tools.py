"""Tests for the helper's task tools and the tagged-kernel hooks (tools/kh-helper, 2026-10-29).

WHAT IS UNDER TEST
  1. kh_save / kh_log build the body the kernel used to teach: scope top-level AND in metadata, a real
     ISO-8601 ts, topic == subject for a log, the session's project when none is named, and a read-back.
  2. A write whose row cannot be read back is not reported as done.
  3. The SessionStart hooks read /kernel/render parts and fall back to the old routes only when KH lacks
     the route (an older KH), never when a part is merely empty.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_tools.py

No network: the session is a fake.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))

from kh_helper import hooks, tools  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class FakeSession:
    def __init__(self, routes, bound="kh-investigate", stored=True):
        self.routes, self.bound, self.stored, self.calls = routes, bound, stored, []

    def call(self, method, path, body=None, params=None):
        self.calls.append((method, path, body))
        if path == "/session/project":
            return 200, {"binding": {"project": self.bound} if self.bound else None}
        if path == "/vector/add":
            return 200, {"status": "ok", "vector_id": "vec_1", "dimension": 384}
        if path == "/vector/scroll":
            return 200, {"hits": [{"vector_id": "vec_1"}] if self.stored else []}
        if path in self.routes:
            return self.routes[path]
        return 404, {"detail": "Not Found"}


ISO = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")

# 1. save and log
s = FakeSession({})
status, body = tools.log(s, "Merged the kernel tags branch locally. Tests pass.", subject="kernel tags")
add = next(b for m, p, b in s.calls if p == "/vector/add")
meta = add["metadata"]
check("log: scope top-level and in metadata", add["scope"] == "log" and meta["scope"] == "log", add)
check("log: topic == subject", meta["topic"] == meta["subject"] == "kernel tags", meta)
check("log: a real ISO-8601 UTC ts", bool(ISO.match(meta["ts"])), meta.get("ts"))
check("log: the session's project", meta["project"] == "kh-investigate" and add["project"] == "kh-investigate", add)
check("log: read back", status == 200 and body["read_back"] is True, body)

s = FakeSession({}, bound=None)
tools.save(s, "Rowan archives uploads as .7z with 7-Zip -mx=7.", kind="fact")
add = next(b for m, p, b in s.calls if p == "/vector/add")
check("save: no session project -> no project (KH puts it in the personal project)",
      "project" not in add and "project" not in add["metadata"], add)
check("save: unknown kind refused", tools.save(s, "x", kind="gossip")[0] == 400)

s = FakeSession({}, stored=False)
status, body = tools.save(s, "A fact.", kind="fact")
check("a row that cannot be read back is not 'done'", status == 500 and body["read_back"] is False, (status, body))

# 2. hook sources
new_kh = FakeSession({"/kernel/render?part=1": (200, "KERNEL PART 1"), "/kernel/render?part=2": (200, ""),
                      "/kernel/render?part=3": (200, "")})
old_kh = FakeSession({"/hooks/raw?hook_type=SessionStart": (200, "OLD KERNEL"),
                      "/personalization/render": (200, "OLD PERSONAL")})
src = {k: hooks.HOOKS[k]["sources"][0] for k in ("SessionStart", "SessionStartPersonal", "SessionStartRest")}
check("new KH: part 1 from /kernel/render", hooks._text(new_kh, src["SessionStart"]) == "KERNEL PART 1")
check("new KH: an empty part 2 stays empty (no double personalization)",
      hooks._text(new_kh, src["SessionStartPersonal"]) == "")
check("old KH: falls back to the one-row kernel", hooks._text(old_kh, src["SessionStart"]) == "OLD KERNEL")
check("old KH: and to the personalization", hooks._text(old_kh, src["SessionStartPersonal"]) == "OLD PERSONAL")
check("old KH: part 3 prints nothing", hooks._text(old_kh, src["SessionStartRest"]) == "")
check("all three parts run at SessionStart",
      [k for k in hooks.HOOKS if hooks.cli_event(k) == "SessionStart"] ==
      ["SessionStart", "SessionStartPersonal", "SessionStartRest"])

check("PreToolUse: new route first, old hook text on an older KH",
      hooks._text(old_kh, hooks.HOOKS["PreToolUse"]["sources"][0]) == "" and
      hooks._text(FakeSession({"/hooks/raw?hook_type=PreToolUse": (200, "OLD CHECK")}), hooks.HOOKS["PreToolUse"]["sources"][0]) == "OLD CHECK")

check("PostCompact reloads the kernel in parts, each under the cap",
      [k for k in hooks.HOOKS if hooks.cli_event(k) == "PostCompact"] == ["PostCompact", "PostCompactPersonal", "PostCompactRest"]
      and hooks._text(new_kh, hooks.HOOKS["PostCompact"]["sources"][0]) == "KERNEL PART 1"
      and hooks._text(old_kh, hooks.HOOKS["PostCompact"]["sources"][0]) == "OLD KERNEL"
      and hooks._text(old_kh, hooks.HOOKS["PostCompactPersonal"]["sources"][0]) == "")

# 3. kh_kernel_rule passes an edit slot and a guard (1.19.2)
s = FakeSession({"/kernel/rules/add": (200, {"result": "updated"})})
tools.kernel_rule(s, "Reports are local html.", ["report", "report_doc"], slot="sl_abc",
                  guard={"tool": "Artifact", "decision": "ask"})
body = s.calls[-1][2]
check("kernel_rule: slot and guard reach /kernel/rules/add",
      s.calls[-1][1] == "/kernel/rules/add" and body["slot"] == "sl_abc" and body["guard"]["tool"] == "Artifact", body)
tools.kernel_rule(s, "Reports are local html.", ["report", "report_doc"])
check("kernel_rule: no slot or guard keys when not given", "slot" not in s.calls[-1][2]
      and "guard" not in s.calls[-1][2], s.calls[-1][2])

import json                                       # noqa: E402
from kh_helper import worklog                     # noqa: E402
cli_out = json.dumps({"type": "result", "is_error": True, "duration_api_ms": 0,
                      "usage": {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0,
                                "server_tool_use": {"web_search_requests": 0}, "service_tier": "standard"},
                      "result": "OAuth session expired and could not be refreshed"})
check("summarizer error: the CLI's result field, not the first chars of stdout",
      worklog._cli_error(cli_out) == "OAuth session expired and could not be refreshed")
check("summarizer error: non-JSON stdout comes back as is", worklog._cli_error("boom") == "boom")

print("\n%d failed" % len(FAILURES))
sys.exit(1 if FAILURES else 0)
