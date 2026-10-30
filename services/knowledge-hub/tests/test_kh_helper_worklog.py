"""Tests for work logs written by the KH helper itself (tools/kh-helper 1.15.0), 2026-10-19.

WHAT IS UNDER TEST
  The Stop hook no longer blocks (Claude Code shows a block as 'Stop hook error'): it queues the ended turn
  and starts a detached worker, printing nothing. The worker slices the turn from the transcript (bounded,
  secrets masked), asks the summarizer for {skip, subject, text} and stores the log as the person, in the
  turn's project, or the personal project for none, a shared directory project, or a 403. A CLI without a
  summarizer keeps the old block; inside the summarizer every hook exits at once.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_worklog.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))
os.environ["KH_HELPER_OUTCOMES"] = "off"
os.environ.pop("KH_HELPER_WORKLOG", None)
from kh_helper import hooks, quiet, worklog  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="kh_worklog_"))
hooks.HOME = TMP
quiet.HOME = TMP
quiet.LOG_PATH = TMP / "kh-helper.log"
worklog.JOBS = TMP / "worklog"
worklog.SETTLE_SECONDS = 0
hooks.SESSION_PROJECTS = TMP / "session-projects.json"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class KH:
    """A signed-in session: records calls, answers /auth/me and /policy/plan, and /vector/add as told."""

    def __init__(self, add_status=200):
        self.calls, self.add_status = [], list(add_status) if isinstance(add_status, list) else [add_status]
        self._access, self._access_until = "tok", 9e12
        self.acting_token, self.sent_acting = None, []

    def _access_token(self):
        return self._access

    def current_acting_token(self):
        return self.acting_token

    def call(self, method, path, body=None, params=None):
        self.calls.append((method, path, body))
        if path == "/vector/add":
            self.sent_acting.append(self.acting_token)
        if path == "/auth/me":
            return 200, {"personal_project": "personal-me"}
        if path == "/policy/plan":
            return 200, {"rules": [{"sub_action": "gate", "content": "GATE RULE"}]}
        if path == "/vector/add":
            return (self.add_status.pop(0) if len(self.add_status) > 1 else self.add_status[0]), {}
        if path == "/hooks/raw":
            return 200, "KH: store worklog"
        return 200, "KH: store worklog"

    def adds(self):
        return [b for m, p, b in self.calls if p == "/vector/add"]


def transcript(prompt, said="", tools=()):
    rows = [{"type": "user", "message": {"role": "user", "content": "earlier"}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "old answer"}]}},
            {"type": "user", "message": {"role": "user", "content": prompt}}]
    for i, (name, args) in enumerate(tools):
        rows.append({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": f"t{i}", "name": name,
                                                                    "input": args}]}})
        rows.append({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": f"t{i}",
                                                               "content": "boom", "is_error": i == 0}]}})
    rows.append({"type": "assistant", "message": {"content": [{"type": "text", "text": said}]}})
    path = TMP / f"t{len(list(TMP.glob('t*.jsonl')))}.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return str(path)


def stop(session, path, sid="s1", cli="claude-code"):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rc = hooks.run_hook("Stop", session, json.dumps({"session_id": sid, "transcript_path": path}), cli=cli)
    return rc, out.getvalue().strip()


spawned = []
handed_acting = []
worklog.spawn = lambda access, until, acting=None: (spawned.append(access), handed_acting.append(acting))
answer = {"value": {"skip": False, "subject": "fix login", "text": "Fixed the login bug."}}
worklog.summarize = lambda cli, turn, rules: (answer.update(turn=turn, rules=rules), answer["value"])[1]
worklog.summarizer_command = lambda cli: ["fake"] if cli == "claude-code" else None

# ── Stop hook ───────────────────────────────────────────────────────────────
change = transcript("fix the login bug", "done", [("Edit", {"file_path": "a.py"})])
rc, out = stop(KH(), change)
jobs = list(worklog.JOBS.glob("*.job"))
check("a change turn: Stop prints nothing", rc == 0 and out == "", out)
check("a change turn: one job queued and a worker started with the handed token", len(jobs) == 1 and spawned == ["tok"],
      (jobs, spawned))

rc, out = stop(KH(), transcript("hi", "hello", [("Read", {"file_path": "a.py"})]))
check("a read-only turn queues nothing", out == "" and len(list(worklog.JOBS.glob("*.job"))) == 1)

rc, out = stop(KH(), change, cli="grok")
check("a CLI without a summarizer keeps the old block", '"decision": "block"' in out, out)

os.environ["KH_HELPER_WORKLOG"] = "off"
rc, out = stop(KH(), change)
check("KH_HELPER_WORKLOG=off brings the block back", '"decision": "block"' in out, out)
os.environ.pop("KH_HELPER_WORKLOG")

os.environ[worklog.GUARD_ENV] = "1"
rc, out = stop(KH(), change)
check("inside the summarizer every hook exits at once", rc == 0 and out == "", out)
os.environ.pop(worklog.GUARD_ENV)

check("no PostToolUse nudge while the helper writes logs",
      hooks.nudge("PostToolUse", json.dumps({"session_id": "s9", "tool_name": "Edit"}), "claude-code") == "")

# ── worker ──────────────────────────────────────────────────────────────────
kh = KH()
check("the worker stores the queued job", worklog.drain(kh) == 1 and not list(worklog.JOBS.glob("*")), kh.calls)
body = kh.adds()[0]
check("the log goes to the personal project when the turn had none", body["metadata"]["project"] == "personal-me", body)
check("work log metadata: scope both places, topic == subject, ts, source",
      body["scope"] == "log" and body["metadata"]["scope"] == "log"
      and body["metadata"]["topic"] == body["metadata"]["subject"] == "fix login"
      and body["metadata"]["ts"].endswith("Z") and body["metadata"]["source"] == "kh-helper auto worklog", body)
check("the summarizer gets the policy's gate rule", answer["rules"] == "GATE RULE", answer.get("rules"))
check("the turn slice starts at the last prompt and holds the failed tool",
      answer["turn"].startswith("PERSON: fix the login bug") and "TOOL FAILED: boom" in answer["turn"]
      and "old answer" not in answer["turn"], answer["turn"])


def run(project, add_status=200):
    kh = KH(add_status)
    worklog.queue(kh, {"session_id": "p", "transcript_path": change}, "claude-code", project)
    worklog.drain(kh)
    return kh.adds()


adds = run("dlc")
check("a project turn logs to that project", adds[-1]["metadata"]["project"] == "dlc", adds)
for shared in ("orchestrator", "lesson-learned", "market"):
    adds = run(shared)
    check(f"'{shared}' never gets a log: personal instead", adds[-1]["metadata"]["project"] == "personal-me", adds)
adds = run("dlc", [403, 200])
check("a 403 stores it in the personal project with intended_project",
      len(adds) == 2 and adds[1]["metadata"]["project"] == "personal-me"
      and adds[1]["metadata"]["intended_project"] == "dlc", adds)

answer["value"] = {"skip": True}
check("skip stores nothing and drops the job", run("dlc") == [] and not list(worklog.JOBS.glob("*")))
answer["value"] = {"skip": False, "subject": "x", "text": "y"}

adds = run("dlc", 503)
check("a 5xx keeps the job for the next worker", len(list(worklog.JOBS.glob("*.job"))) == 1, adds)
for leftover in worklog.JOBS.glob("*.job"):
    leftover.unlink()

# ── a turn an agent ran for one real person (technical user, KH_ACTING_TOKEN) ──
kh = KH()
kh.acting_token = "ru-token"
handed_acting.clear()
worklog.queue(kh, {"session_id": "ru", "transcript_path": change}, "claude-code", "dlc")
job = next(worklog.JOBS.glob("*.job"))
check("the person's token goes to the worker, never into the job file",
      handed_acting == [{job.stem: "ru-token"}] and "ru-token" not in job.read_text(encoding="utf-8"),
      (handed_acting, job.read_text(encoding="utf-8")))
worker = KH()
worker.acting_by_job = handed_acting[0]
worklog.drain(worker)
check("the worker stores it with the person's token", worker.sent_acting == ["ru-token"], worker.sent_acting)

kh = KH()
kh.acting_token = "ru-token"
worklog.queue(kh, {"session_id": "ru2", "transcript_path": change}, "claude-code", "dlc")
worker = KH()
worklog.drain(worker)
check("without the person's token the log is dropped, never stored for everyone",
      worker.adds() == [] and not list(worklog.JOBS.glob("*")), worker.calls)

# ── slicing ─────────────────────────────────────────────────────────────────
secret = transcript("use password: hunter22 and token=abcd1234efgh", "x" * 30000)
sliced = worklog.turn_slice(secret)
check("secrets are masked", "hunter22" not in sliced and "abcd1234efgh" not in sliced and "[masked]" in sliced, sliced[:200])
check("the slice is bounded and keeps its end", len(sliced) <= worklog.SLICE_CHARS + 10 and sliced.endswith("x"),
      len(sliced))

# ── update note (helper releases without a KH redeploy) ─────────────────────
from importlib import metadata  # noqa: E402

installed = {"v": "1.15.0"}
metadata.version = lambda name: installed["v"]


class Config:
    """KH with no versions row: the update note falls back to /auth/config (artifact store or bundled wheel)."""
    def __init__(self, version, row=None):
        self.version, self.row = version, row

    def call(self, method, path, body=None, params=None):
        if path == "/vector/scroll":
            return 200, {"hits": [{"metadata": self.row}] if self.row else []}
        return 200, {"helper_version": self.version, "helper": f"https://kh.test/auth/download/kh_helper-{self.version}"
                                                               "-py3-none-any.whl"}


note = hooks.update_note(Config("1.15.10"))
check("a newer published helper gives the upgrade line, run through kh upgrade",
      "KH HELPER UPDATE" in note and "1.15.10" in note and "kh_helper.cli upgrade" in note, note)
check("the same version gives nothing", hooks.update_note(Config("1.15.0")) == "")
check("an older published version gives nothing", hooks.update_note(Config("1.9.9")) == "")
check("KH without helper_version gives nothing", hooks.update_note(KH()) == "")
note = hooks.update_note(Config("1.0.0", {"version": "1.17.0", "download_url": "https://drive.google.com/file/d/x/view"}))
check("the versions row wins over /auth/config", "1.17.0" in note and "kh_helper.cli upgrade" in note, note)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
