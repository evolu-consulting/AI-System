"""Tests for the Stop hook's read-only skip in the KH helper (tools/kh-helper 1.8.2), 2026-09-29.

WHAT IS UNDER TEST
  The helper reads the local transcript back to the person's last prompt. A turn whose tools only read
  (or used none) skips the Stop check; any edit, shell command, KH write or unknown tool keeps it, and
  so does anything the helper cannot read - a skipped real change would lose its work log.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_turn.py
"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))
from kh_helper.hooks import turn_logged_work, turn_was_read_only  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


TMP = Path(tempfile.mkdtemp(prefix="kh_turn_"))


def transcript(*uses, earlier_edit=True, answer="done", prompt="what does it do?"):
    """A transcript: an earlier turn with an Edit, then the person's prompt, then these tool uses."""
    rows = []
    if earlier_edit:
        rows += [{"type": "user", "message": {"content": "fix the bug"}},
                 {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Edit", "input": {}}]}}]
    rows.append({"type": "user", "message": {"content": [{"type": "text", "text": prompt}]}})
    for name, args in uses:
        rows.append({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": name, "input": args}]}})
        rows.append({"type": "user", "message": {"content": [{"type": "tool_result", "content": "..."}]}})
    rows.append({"type": "assistant", "message": {"content": [{"type": "text", "text": answer}]}})
    path = TMP / f"t{len(list(TMP.iterdir()))}.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return str(path)


def _earlier_log():
    """A log stored in the previous turn, then a new prompt and an Edit with no log."""
    rows = [{"type": "user", "message": {"content": "fix it"}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "mcp__knowledge-hub__kh_call",
                                                           "input": {"method": "POST", "path": "/vector/add",
                                                                     "body": {"scope": "log"}}}]}},
            {"type": "user", "message": {"content": "now the next one"}},
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Edit", "input": {}}]}}]
    path = TMP / "earlier_log.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return str(path)


check("a turn with no tools is read-only (an edit in an earlier turn does not count)", turn_was_read_only(transcript()))
check("a long discussion with no tool is not read-only (its log is not lost, 2026-10-13)",
      not turn_was_read_only(transcript(answer="We weighed three designs for the mapping version export. " * 20)))
check("nor a long answer after reads only", not turn_was_read_only(transcript(("Read", {}), answer="x" * 900)))
check("a short reply with no tool stays read-only", turn_was_read_only(transcript(answer="Hi! Glad to help.")))
check("the person giving new information is not read-only, even when the answer is a short 'noted'",
      not turn_was_read_only(transcript(answer="Noted.", prompt="From now on the QAS tenant uses mapping version 5; "
                                        "exports to it must bump the version, and imports default to merge, not replace.")))
check("system reminders the CLI adds to a prompt do not count as the person's words",
      turn_was_read_only(transcript(prompt="<system-reminder>" + "x" * 3000 + "</system-reminder>ok", answer="Done.")))
check("a short greeting from the person stays read-only", turn_was_read_only(transcript(prompt="thanks!", answer="You're welcome.")))
check("reads and searches are read-only",
      turn_was_read_only(transcript(("Read", {}), ("Grep", {}), ("mcp__knowledge-hub__kh_call", {"method": "GET"}))))
check("kh_members people is read-only", turn_was_read_only(transcript(("mcp__knowledge-hub__kh_members", {}))))
check("an edit is a change", not turn_was_read_only(transcript(("Read", {}), ("Edit", {}))))
check("a shell command is a change", not turn_was_read_only(transcript(("Bash", {"command": "ls"}))))
check("a KH write is a change", not turn_was_read_only(transcript(("mcp__knowledge-hub__kh_call", {"method": "POST"}))))
check("sending a KH message is a change", not turn_was_read_only(transcript(("mcp__knowledge-hub__kh_message", {}))))
check("an unknown tool is a change", not turn_was_read_only(transcript(("SomethingNew", {}))))
check("no transcript path is not read-only", not turn_was_read_only(""))
check("an unreadable transcript is not read-only", not turn_was_read_only(str(TMP / "missing.jsonl")))
bad = TMP / "bad.jsonl"
bad.write_text("{not json", encoding="utf-8")
check("a corrupt transcript is not read-only", not turn_was_read_only(str(bad)))

# 1.13.1: KH lookups sent as POST only read; a turn that already stored its work log gets no Stop block.
KH = "mcp__knowledge-hub__kh_call"
check("POST /context/step, /vector/query and /vector/scroll are reads",
      turn_was_read_only(transcript((KH, {"method": "POST", "path": "/context/step"}),
                                    (KH, {"method": "POST", "path": "/vector/query?x=1"}),
                                    (KH, {"method": "POST", "path": "/vector/scroll"}))))
LOG = (KH, {"method": "POST", "path": "/vector/add", "body": {"text": "x", "scope": "log", "metadata": {"scope": "log"}}})
check("a turn that stored its work log through MCP is logged", turn_logged_work(transcript(("Edit", {}), LOG)))
check("a work log through the helper CLI counts too",
      turn_logged_work(transcript(("Bash", {"command": "python -m kh_helper.cli call POST /vector/add "
                                                       "'{\"text\":\"x\",\"scope\":\"log\"}'"}))))
check("a knowledge write is not a work log",
      not turn_logged_work(transcript((KH, {"method": "POST", "path": "/vector/add", "body": {"scope": "knowledge"}}))))
check("a change with no log is not logged", not turn_logged_work(transcript(("Edit", {}))))
check("a log written in an earlier turn does not count", not turn_logged_work(_earlier_log()))
check("no transcript path is not logged", not turn_logged_work(""))

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
