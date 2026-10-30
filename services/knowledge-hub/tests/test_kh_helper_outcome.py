"""Tests for the kh-helper step outcome signals (roadmap E-5 slice S8, docs/roadmap-e-to-5-design.md 5.2).

WHAT IS UNDER TEST
  The three code signals, from recorded hook payloads: a failed tool result after a served step labels it
  `failed` (source tool); a correction word in the next prompt within 30 min labels the previous turn's steps
  `corrected` (source correction); Stop labels the rest `done` (source stop). Precedence corrected > failed >
  done, so a later `done` never overrides. Nothing is recorded or sent unless KH lists the `outcomes`
  capability, and a slow KH never holds the hook past its short grace.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_outcome.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))
os.environ.pop("KH_HELPER_OUTCOMES", None)
from kh_helper import hooks, quiet  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="kh_outcome_"))
hooks.HOME = TMP
quiet.HOME = TMP
quiet.LOG_PATH = TMP / "kh-helper.log"
quiet.NOTICE_PATH = TMP / "slow-notice"
hooks.HOOK_SECONDS = 2

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class KH:
    """A fake signed-in session: records every call; outcomes capability on or off; optional delay."""

    def __init__(self, on=True, delay=0.0, words=None):
        self.on, self.delay, self.words = on, delay, words
        self.calls, self.outcomes = [], []
        self.lock = threading.Lock()

    def call(self, method, path, body=None, params=None):
        with self.lock:
            self.calls.append((method, path))
        if path == "/v1/capabilities":
            caps = [{"name": "events", "limits": {}}]
            if self.on:
                caps.append({"name": "outcomes", "limits": {"correction_words": self.words} if self.words else {}})
            return 200, {"capabilities": caps}
        if path == "/step/outcome":
            time.sleep(self.delay)
            with self.lock:
                self.outcomes.append(body)
            return 200, {"ok": True}
        if path == "/turn/context":
            return 200, {"text": "", "serve_id": "sv-turn"}
        return 200, ""


def reset():
    """Forget every session's state; the cached capability answer stays (as on a real machine)."""
    for p in (TMP / "outcomes").glob("s*.json") if (TMP / "outcomes").exists() else []:
        p.unlink()


def run(kh, event, payload):
    with contextlib.redirect_stdout(io.StringIO()):
        t = time.time()
        rc = hooks.run_hook(event, kh, json.dumps(payload))
        return rc, time.time() - t


def settle():
    for t in threading.enumerate():
        if t.name == "kh-outcome":
            t.join(3)


def transcript(name, rows):
    path = TMP / f"{name}.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return str(path)


def prompt_row(text):
    return {"type": "user", "message": {"content": text}}


def use_row(uid, name, args):
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": uid, "name": name, "input": args}]}}


def result_row(uid, text, error=False):
    return {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": uid, "content": text,
                                                     "is_error": error}]}}


def step_call(uid, serve_id):
    """A kh_call to /context/step and its answer, as the MCP server returns it."""
    answer = json.dumps({"status": 200, "body": {"serve_id": serve_id, "text": "pack"}})
    return [use_row(uid, "mcp__knowledge-hub__kh_call", {"method": "POST", "path": "/context/step", "body": {}}),
            result_row(uid, [{"type": "text", "text": answer}])]


def sent(kh):
    return [(o["outcome"], o["source"], tuple(sorted(o["serve_ids"]))) for o in kh.outcomes]


# 1. off by default: no capability, nothing recorded, nothing sent
reset()
kh = KH(on=False)
path = transcript("off", [prompt_row("go"), *step_call("t1", "sv-1")])
run(kh, "UserPromptSubmit", {"session_id": "s-off", "prompt": "go"})
run(kh, "Stop", {"session_id": "s-off", "transcript_path": path})
settle()
check("off: capability asked once, never /step/outcome",
      ("GET", "/v1/capabilities") in kh.calls and not kh.outcomes, kh.calls)
check("off: no session state written", not (TMP / "outcomes" / "s-off.json").exists())

# 2. Stop labels the turn's served steps done (source stop); /turn/context's serve id joins the turn
reset()
kh = KH(on=True)
(TMP / "outcomes" / "capability.json").unlink()           # the cached "off" expired (TTL)
run(kh, "SessionStart", {"session_id": "s1"})              # first hook learns the capability
settle()
check("capability cached on", hooks.outcomes_on())
run(kh, "UserPromptSubmit", {"session_id": "s1", "prompt": "add the report"})
path = transcript("done", [prompt_row("add the report"), *step_call("t1", "sv-1"),
                           use_row("t2", "Read", {"file_path": "x"}), result_row("t2", "fine")])
run(kh, "Stop", {"session_id": "s1", "transcript_path": path})
settle()
check("stop: done for the step and the turn context", sent(kh) == [("done", "stop", ("sv-1", "sv-turn"))], sent(kh))

# 3. the next prompt holds a correction word -> previous turn corrected; overrides done
kh.outcomes.clear()
run(kh, "UserPromptSubmit", {"session_id": "s1", "prompt": "No, that is wrong - use the other table"})
settle()
check("correction: previous turn corrected", sent(kh) == [("corrected", "correction", ("sv-1", "sv-turn"))], sent(kh))

# 3b. an ordinary prompt corrects nothing; a correction after 30 min corrects nothing
kh.outcomes.clear()
run(kh, "Stop", {"session_id": "s1", "transcript_path": transcript("e", [prompt_row("x")])})
run(kh, "UserPromptSubmit", {"session_id": "s1", "prompt": "thanks, go on"})
settle()
check("no correction word: nothing sent", not [o for o in kh.outcomes if o["outcome"] == "corrected"], sent(kh))
check("accent and case ignored", hooks.has_correction("Cái này SAI rồi") and not hooks.has_correction("saint"))

reset()
kh = KH(on=True)
run(kh, "UserPromptSubmit", {"session_id": "s2", "prompt": "go"})
run(kh, "Stop", {"session_id": "s2", "transcript_path": transcript("late", [prompt_row("go"), *step_call("t1", "sv-9")])})
settle()
state_path = TMP / "outcomes" / "s2.json"
state = json.loads(state_path.read_text(encoding="utf-8"))
state["prev"]["at"] -= 31 * 60
state_path.write_text(json.dumps(state), encoding="utf-8")
kh.outcomes.clear()
run(kh, "UserPromptSubmit", {"session_id": "s2", "prompt": "that was wrong"})
settle()
check("correction after 30 min: ignored", not kh.outcomes, sent(kh))

# 4. a failed tool result after the step -> failed with the first error line; Stop then sends no done
reset()
kh = KH(on=True)
run(kh, "UserPromptSubmit", {"session_id": "s3", "prompt": "deploy it"})
path = transcript("fail", [prompt_row("deploy it"), *step_call("t1", "sv-3"),
                           use_row("t2", "Bash", {"command": "cf push"}),
                           result_row("t2", "Exit code 1\nError: app crashed at /home/a/b", error=True)])
run(kh, "Stop", {"session_id": "s3", "transcript_path": path})
settle()
check("failure: failed (source tool), no done after it",
      sent(kh) == [("failed", "tool", ("sv-3", "sv-turn"))], sent(kh))
check("failure: first error line carried", kh.outcomes and kh.outcomes[0].get("error") ==
      "Exit code 1: Error: app crashed at /home/a/b", kh.outcomes)

# 4b. a failure BEFORE the step was served does not label it
reset()
kh = KH(on=True)
run(kh, "UserPromptSubmit", {"session_id": "s4", "prompt": "go"})
path = transcript("before", [prompt_row("go"), use_row("t0", "Bash", {}), result_row("t0", "boom", error=True),
                             *step_call("t1", "sv-4")])
run(kh, "Stop", {"session_id": "s4", "transcript_path": path})
settle()
check("failure labels only steps served before it",
      sent(kh) == [("failed", "tool", ("sv-turn",)), ("done", "stop", ("sv-4",))], sent(kh))

# 5. PostToolUse / PostToolUseFailure payloads (a CLI that wires them) take the same path
reset()
kh = KH(on=True)
run(kh, "UserPromptSubmit", {"session_id": "s5", "prompt": "go"})
answer = json.dumps({"status": 200, "body": {"serve_id": "sv-5"}})
rc, _ = run(kh, "PostToolUse", {"session_id": "s5", "tool_name": "mcp__knowledge-hub__kh_call",
                                "tool_input": {"method": "POST", "path": "/context/step"},
                                "tool_response": [{"type": "text", "text": answer}]})
run(kh, "PostToolUseFailure", {"session_id": "s5", "tool_name": "Bash", "tool_input": {"command": "x"},
                               "error": "Command failed with exit code 2"})
settle()
check("PostToolUse: exit 0", rc == 0)
check("PostToolUseFailure: failed for the served steps",
      sent(kh) == [("failed", "tool", ("sv-5", "sv-turn"))], sent(kh))
kh.outcomes.clear()
run(kh, "Stop", {"session_id": "s5", "transcript_path": ""})
settle()
check("Stop after failed: the model's done never overrides", not kh.outcomes, sent(kh))

# 6. a slow KH never holds the hook: grace only, and the label is sent by a later hook
reset()
kh = KH(on=True, delay=3)
run(kh, "UserPromptSubmit", {"session_id": "s6", "prompt": "go"})
hooks.HOOK_SECONDS = 2
rc, took = run(kh, "Stop", {"session_id": "s6", "transcript_path": transcript("slow", [prompt_row("go"),
                                                                                      *step_call("t1", "sv-6")])})
check("slow KH: the hook returns within the grace", rc == 0 and took < 1.0, round(took, 2))
kh.delay = 0
time.sleep(3.2)
settle()
run(kh, "SessionStart", {"session_id": "s6"})
settle()
done = [o for o in kh.outcomes if o["outcome"] == "done"]
check("slow KH: the label reaches KH (outbox retried)", done and done[-1]["serve_ids"] == ["sv-turn", "sv-6"], kh.outcomes)
state = json.loads((TMP / "outcomes" / "s6.json").read_text(encoding="utf-8"))
check("outbox empties once KH took it", state.get("outbox") == [], state.get("outbox"))

# 7. KH switched the capability off (404 on /step/outcome): stop sending, drop the outbox
reset()


class Gone(KH):
    def call(self, method, path, body=None, params=None):
        if path == "/step/outcome":
            self.calls.append((method, path))
            return 404, {"detail": "Not Found"}
        return super().call(method, path, body, params)


kh = Gone(on=True)
run(kh, "UserPromptSubmit", {"session_id": "s7", "prompt": "go"})
run(kh, "Stop", {"session_id": "s7", "transcript_path": transcript("gone", [prompt_row("go"), *step_call("t1", "sv-7")])})
settle()
check("404 from /step/outcome: capability cached off", not hooks.outcomes_on())

print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
