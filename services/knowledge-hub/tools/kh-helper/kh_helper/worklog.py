"""Work logs written by the helper itself, not by the model (1.15.0).

Before, the Stop hook blocked the turn and asked the model to store its log. Claude Code shows every Stop
block as a red 'Stop hook error' line, a text meant for the model that the person had to read. Now the
Stop hook only queues the ended turn and returns silently; a detached worker (`kh worklog`) slices the
turn from the transcript, asks the cheapest model of the CLI's own provider to write the log under the
'store worklog' rules, and stores it as the person.

  Stop hook   gate in code (read-only turn, log already stored, subagent) -> job file -> spawn worker, exit 0
  worker      claim job -> turn slice (bounded, secrets masked) -> summarizer -> entry saved in the job
              -> POST /vector/add
  Ctrl+C      Stop does not fire: no log, on purpose (the person cancelled that result)

The worker holds only the short-lived access token its hook handed over (about 280 s) and cannot refresh it.
A job is therefore done in two steps (1.18.2): the summarized entry is written into the job file before it is
stored, so a token that runs out between the two leaves a job the next worker only has to store; and a job
still to summarize starts only while the token has JOB_MARGIN left. Before, such a job went back unsummarized,
was summarized again by every next worker, ran out again, and held up every newer job behind it for up to
JOB_KEEP (2026-10-26: a person's logs stopped for the rest of the day).

The summarizer runs the CLI's own headless mode, so it uses the person's own sign-in and quota and needs
no key on the KH server. SUMMARIZERS lists one command per CLI; a CLI without one keeps the old Stop block.
KH_HELPER_WORKLOG=off brings the old block back; KH_HELPER_WORKLOG_CMD (a JSON list, prompt on stdin)
replaces the command, e.g. for a CLI not listed here.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import owner, quiet
from .session import HOME, NotSignedIn, Session, actor_id

GUARD_ENV = "KH_HELPER_SUMMARIZER"     # set in the summarizer's process: every helper hook there exits at once
JOBS = HOME / "worklog"
CLAIM_STALE = 900                      # seconds after which a claimed job of a dead worker is taken again
JOB_KEEP = 3 * 86400                   # a job that keeps failing is dropped after this
SETTLE_SECONDS = 2.0                   # the CLI may still be writing the transcript when Stop fires
SLICE_CHARS = 12000                    # what the summarizer reads of one turn
SUMMARIZER_SECONDS = 180
JOB_MARGIN = SUMMARIZER_SECONDS + 60   # handed-token seconds a job needs before its summarizer starts (1.18.2)

# The cheapest model of each CLI's provider, through that CLI's headless mode. The prompt goes on stdin.
# Claude Code: the 'haiku' alias always names the cheapest Claude tier, on Anthropic, Bedrock and Vertex
# alike. Lean on purpose: no settings (so no hooks), no MCP, no tools, no skills, no saved session, a short
# system prompt of our own; a plain `claude -p` loads the person's hooks and CLAUDE.md (lesson 2c12b8f9a459).
SUMMARIZERS = {
    "claude-code": lambda exe: [exe, "-p", "--model", "haiku", "--setting-sources", "", "--strict-mcp-config",
                                "--tools", "", "--disable-slash-commands", "--no-session-persistence",
                                "--output-format", "json", "--system-prompt", SYSTEM],
}
EXECUTABLES = {"claude-code": "claude"}

SYSTEM = ("You write one work log entry for the Knowledge Hub from a slice of a coding-assistant conversation. "
          "This turn has no tools. Answer with one JSON object only, no prose, no code fence.")

RULES_FALLBACK = ("Store a log whenever the turn changed something, discussed or decided a solution, or the person "
                  "gave new information (fact, constraint, correction, requirement). Store nothing for small talk "
                  "or a plain lookup.")

def _cli_error(stdout: str) -> str:
    """The CLI's own error text from its JSON answer (result, error or message), else the raw start of it."""
    out = (stdout or "").strip()
    try:
        data = json.loads(out)
    except ValueError:
        return out
    if isinstance(data, dict):
        for key in ("result", "error", "message"):
            if data.get(key):
                return str(data[key])
    return out


_SECRET = re.compile(
    r"(?i)(bearer\s+[A-Za-z0-9._~+/=-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+"
    r"|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}"
    r"|((password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\s*[\"']?\s*[:=]\s*[\"']?)[^\s\"',}]{4,})")


def enabled(cli: str) -> bool:
    """True when this CLI's Stop hook queues a job instead of blocking the turn."""
    if os.getenv("KH_HELPER_WORKLOG", "").strip().lower() in ("off", "0", "false", "no"):
        return False
    return summarizer_command(cli) is not None


def summarizer_command(cli: str) -> list[str] | None:
    custom = os.getenv("KH_HELPER_WORKLOG_CMD", "").strip()
    if custom:
        try:
            cmd = json.loads(custom)
            return cmd if isinstance(cmd, list) and cmd and all(isinstance(c, str) for c in cmd) else None
        except ValueError:
            return None
    build, name = SUMMARIZERS.get(cli), EXECUTABLES.get(cli)
    exe = shutil.which(name) if name else None
    return build(exe) if build and exe else None


# ── Stop hook side: queue and spawn, never print ─────────────────────────────

def queue(session: Session, payload: dict, cli: str, project: str | None) -> bool:
    """Write the ended turn's job and start a worker. True when queued. Never raises."""
    try:
        if payload.get("agent_id") or payload.get("agentId"):
            return False
        access = session._access_token()       # the owner check passes here, in the CLI's own hook
        transcript = payload.get("transcript_path") or payload.get("transcriptPath") or ""
        if not transcript:
            return False
        sid = re.sub(r"[^A-Za-z0-9_.-]", "_", str(payload.get("session_id") or payload.get("sessionId") or "x"))[:120]
        JOBS.mkdir(parents=True, exist_ok=True)
        job = {"transcript": transcript, "session": sid, "cli": cli, "project": project, "at": time.time(),
               "cwd": payload.get("cwd") or ""}
        # A turn an agent ran for one real person: the person's token goes to the worker like the access token,
        # on stdin and never on disk; the job only records that it needs one.
        acting = session.current_acting_token()
        job["acting"] = bool(acting)
        path = JOBS / f"{sid}-{int(time.time() * 1000)}.job"
        path.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
        spawn(access, session._access_until, {path.stem: acting} if acting else None)
        return True
    except Exception as exc:
        quiet.log("worklog queue", exc)
        return False


def windowless(python: str) -> str:
    """pythonw.exe beside `python` on Windows (1.17.1), else `python` itself.

    A venv's Scripts/python.exe is a launcher that starts the real python.exe as its child; started detached
    it has no console to hand down, so that child opens a new, visible one (DETACHED_PROCESS wins over
    CREATE_NO_WINDOW). pythonw.exe is a GUI program and never gets a console.
    """
    if os.name == "nt":
        gui = Path(python).with_name("pythonw.exe")
        if gui.exists():
            return str(gui)
    return python


def spawn(access: str, until: float, acting: dict | None = None) -> None:
    """Start `kh worklog` detached, so the hook returns at once and the CLI never waits for the model.

    A detached process has no Claude Code among its ancestors, so owner.check would refuse it the sign-in.
    The hook, which passed that check, hands over its short-lived access token on the child's stdin: never
    on disk, never in the environment, and never the refresh token. When it expires the worker stops and
    the job waits for the next Stop, whose worker gets a fresh one.
    """
    cmd = [windowless(sys.executable), "-m", "kh_helper.cli", "worklog"]
    kwargs = dict(stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                  close_fds=True, cwd=str(JOBS))
    if os.name == "nt":
        kwargs["creationflags"] = (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
                                   | subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        kwargs["start_new_session"] = True
    child = subprocess.Popen(cmd, env={**os.environ, GUARD_ENV: "1"}, **kwargs)
    child.stdin.write(json.dumps({"access": access, "until": until, "acting": acting or {}}).encode())
    child.stdin.close()


def handed_session(stdin_text: str) -> Session:
    """The worker's session: the access token its hook handed over, or the normal sign-in when run by hand."""
    session = Session()
    try:
        handed = json.loads(stdin_text or "{}")
    except ValueError:
        handed = {}
    if isinstance(handed, dict) and handed.get("access"):
        session._access, session._access_until = handed["access"], float(handed.get("until") or 0)
        session.handed = True                  # it cannot be refreshed here: past `until` the worker stops
    session.acting_by_job = (handed.get("acting") if isinstance(handed, dict) else None) or {}
    return session


# ── worker side ──────────────────────────────────────────────────────────────

def drain(session: Session) -> int:
    """Store every queued job; leave what failed on the network for the next worker. Returns jobs stored."""
    stored = 0
    time.sleep(SETTLE_SECONDS)
    jobs = sorted(JOBS.glob("*.job")) if JOBS.exists() else []
    for i, path in enumerate(jobs):
        if getattr(session, "handed", False) and time.time() >= session._access_until:
            # The handed token has expired. Without this every remaining job failed on the owner check, one
            # traceback each (2026-10-22: 14 WrongOwner in 25 s); they wait for the next Stop's worker instead.
            quiet.log("worklog", note=f"handed token expired; {len(jobs) - i} job(s) left for the next Stop")
            break
        claimed = path.with_suffix(".claimed")
        try:
            path.replace(claimed)              # atomic: two workers never take the same job
        except OSError:
            continue
        # Too little token left to summarize: only jobs whose entry is already written are taken (1.18.2).
        may_summarize = not getattr(session, "handed", False) or session._access_until - time.time() >= JOB_MARGIN
        try:
            stored += _run_job(session, claimed, may_summarize)
        except owner.WrongOwner:
            quiet.log("worklog", note=f"handed token expired; {len(jobs) - i} job(s) left for the next Stop")
            break
    for stale in JOBS.glob("*.claimed") if JOBS.exists() else []:
        try:
            if time.time() - stale.stat().st_mtime > CLAIM_STALE:
                stale.replace(stale.with_suffix(".job"))
        except OSError:
            pass
    return stored


def _run_job(session: Session, claimed: Path, may_summarize: bool = True) -> int:
    try:
        job = json.loads(claimed.read_text(encoding="utf-8"))
    except Exception:
        claimed.unlink(missing_ok=True)
        return 0
    if not job.get("entry") and not may_summarize:
        claimed.replace(claimed.with_suffix(".job"))   # left whole for a worker with a fresh token
        return 0
    # One worker drains every queued job; a job an agent ran for one real person is stored only with that
    # person's token, never without it, or the person's work would land where everyone reads it.
    session.acting_token = (getattr(session, "acting_by_job", None) or {}).get(claimed.stem)
    # The log carries the session the turn ran in (1.18.0), never the worker's own; "x" is a job without one.
    session.actor = (actor_id(job.get("session")) if job.get("session") != "x" else None) or ""
    if job.get("acting") and not session.acting_token:
        quiet.log("worklog", note=f"{claimed.name}: the real person's token is gone; log dropped")
        claimed.unlink(missing_ok=True)
        return 0
    try:
        entry = job.get("entry")
        if entry:
            project, personal = _projects(session, job.get("project"))
        else:
            turn = turn_slice(job["transcript"])
            if not turn:
                claimed.unlink(missing_ok=True)
                return 0
            project, personal = _projects(session, job.get("project"))
            entry = summarize(job["cli"], turn, _rules(session, project or personal))
            if entry is None or entry.get("skip"):
                claimed.unlink(missing_ok=True)    # the model found nothing worth a log
                return 0
            # Saved before the store: if the token runs out there, the next worker only stores it (1.18.2).
            job["entry"] = entry
            claimed.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
        done = store(session, entry, project, personal, job)
        claimed.unlink(missing_ok=True)
        return 1 if done else 0
    except NotSignedIn as exc:
        quiet.log("worklog job", exc)
        claimed.unlink(missing_ok=True)        # nobody to store it as; a later sign-in cannot recover the turn
    except owner.WrongOwner:                   # the handed token expired mid-job: back in the queue, drain stops
        claimed.replace(claimed.with_suffix(".job"))
        raise
    except Exception as exc:
        quiet.log("worklog job", exc)
        if time.time() - float(job.get("at", 0)) > JOB_KEEP:
            claimed.unlink(missing_ok=True)
        else:
            claimed.replace(claimed.with_suffix(".job"))   # try again with the next worker
    return 0


def turn_slice(transcript_path: str) -> str:
    """The ended turn as plain text: the person's prompt, the assistant's words, each tool use in one line and
    each failed result. Bounded to SLICE_CHARS (the end is kept: it holds the outcome) with secrets masked."""
    from .hooks import _text_of, _result_text
    rows = [json.loads(line) for line in Path(transcript_path).read_text(encoding="utf-8").splitlines() if line.strip()]
    turn = []
    for row in reversed(rows):
        content = (row.get("message") or {}).get("content") if isinstance(row, dict) else None
        turn.append(row)
        if row.get("type") == "user" and not (isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "tool_result" for c in content)):
            break
    else:
        return ""
    lines = []
    for row in reversed(turn):
        content = (row.get("message") or {}).get("content")
        if row.get("type") == "user" and not (isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "tool_result" for c in content)):
            text = _text_of(content).strip()
            if text:
                lines.append("PERSON: " + text)
            continue
        if not isinstance(content, list):
            continue
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "text" and row.get("type") == "assistant":
                lines.append("ASSISTANT: " + (c.get("text") or "").strip())
            elif c.get("type") == "tool_use":
                lines.append(f"TOOL {c.get('name')}: " + json.dumps(c.get("input") or {}, ensure_ascii=False)[:400])
            elif c.get("type") == "tool_result" and c.get("is_error"):
                lines.append("TOOL FAILED: " + _result_text(c.get("content"))[:300])
    text = _SECRET.sub(lambda m: (m.group(2) or "") + "[masked]", "\n".join(lines))
    if len(text) > SLICE_CHARS:
        head = text[: SLICE_CHARS // 4]
        text = head + "\n[...]\n" + text[-(SLICE_CHARS - len(head)):]
    return text


# Shared projects that hold no one's work log (kernel rule 4): the directory, admin-verified lessons and
# public posts. A session remembered on one of them (a KH question matched 'knowledge') logs to the personal
# project instead (lesson 2a72d9e63037: knowledge must land in the project that owns it).
NO_LOG_PROJECTS = {"orchestrator", "lesson-learned", "market"}


def _projects(session: Session, project: str | None) -> tuple[str | None, str]:
    # Asked once per worker (1.18.2): each KH call eats the handed token, up to TIMEOUT when KH is slow.
    personal = getattr(session, "personal_project", None)
    if not personal:
        status, me = session.call("GET", "/auth/me")
        if status >= 300 or not isinstance(me, dict) or not me.get("personal_project"):
            raise RuntimeError(f"/auth/me answered {status}")
        personal = session.personal_project = me["personal_project"]
    return (None if project in NO_LOG_PROJECTS else project), personal


def _rules(session: Session, project: str) -> str:
    """The 'store worklog' gate as KH holds it now, so the policy stays the one source of the rule."""
    cache = session.__dict__.setdefault("worklog_rules", {})   # once per project per worker (1.18.2)
    if project in cache:
        return cache[project]
    try:
        status, body = session.call("GET", "/policy/plan", params={"action": "store worklog", "project": project})
        rules = body.get("rules") if status < 300 and isinstance(body, dict) else None
        gate = [r.get("content", "") for r in rules or [] if r.get("sub_action") == "gate"]
        cache[project] = gate[0] if gate else RULES_FALLBACK
    except Exception:
        return RULES_FALLBACK                  # a failed read is not kept: the next job asks again
    return cache[project]


def summarize(cli: str, turn: str, rules: str) -> dict | None:
    """Ask the summarizer for {skip, subject, text}; None when it gave nothing usable."""
    cmd = summarizer_command(cli)
    if cmd is None:
        raise RuntimeError(f"no summarizer for {cli}")
    prompt = (
        "RULE: " + rules + "\n\n"
        "Write the log in English even when the conversation is in another language; keep names, ids, paths, "
        "code and quoted errors verbatim. Say what was done or decided, how, and the result, in 1-5 sentences. "
        "Never copy a secret. If the rule says store nothing, answer {\"skip\": true}. Otherwise answer "
        "{\"skip\": false, \"subject\": \"<2-6 word lowercase subject>\", \"text\": \"<the log>\"}.\n\n"
        "TURN:\n" + turn)
    done = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                          timeout=SUMMARIZER_SECONDS, env={**os.environ, GUARD_ENV: "1"}, cwd=str(JOBS),
                          # the worker has no console, so without this the CLI opens its own window (1.17.1)
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if done.returncode != 0:
        # `claude -p --output-format json` reports its error on stdout and leaves stderr empty (2026-10-22). Its
        # message sits in the "result" field after ~400 chars of usage numbers, so the first 300 chars of stdout
        # never showed it (1.19.2: an expired login hid behind 1,640 identical errors on 2026-10-29).
        raise RuntimeError(f"summarizer exit {done.returncode}: stderr {done.stderr.strip()[:300]!r} "
                           f"error {_SECRET.sub('[masked]', _cli_error(done.stdout))[:500]!r}")
    out = done.stdout.strip()
    try:
        wrapped = json.loads(out)
        if isinstance(wrapped, dict) and "result" in wrapped:
            if wrapped.get("is_error"):
                raise RuntimeError(f"summarizer error: {str(wrapped.get('result'))[:300]}")
            out = str(wrapped["result"])
    except ValueError:
        pass                                   # a CLI that prints the answer as is
    found = re.search(r"\{.*\}", out, re.S)
    try:
        entry = json.loads(found.group(0)) if found else None
    except ValueError:
        entry = None
    if not isinstance(entry, dict) or (not entry.get("skip") and not str(entry.get("text") or "").strip()):
        quiet.log("worklog summarize", note=f"no usable answer: {out[:300]!r} stderr {done.stderr.strip()[:200]!r}")
        return None
    return entry


def store(session: Session, entry: dict, project: str | None, personal: str, job: dict) -> bool:
    """POST the log to its project; on 403 to the personal project with intended_project, as the policy says."""
    subject = str(entry.get("subject") or "work").strip()[:80]
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(job.get("at") or time.time())))
    text = f"{ts[:10]} {str(entry['text']).strip()}"
    meta = {"scope": "log", "project": project or personal, "subject": subject, "topic": subject, "ts": ts,
            "source": "kh-helper auto worklog"}
    status, _ = session.call("POST", "/vector/add", {"text": text, "scope": "log", "metadata": meta})
    if status == 403 and project and project != personal:
        meta.update(project=personal, intended_project=project)
        status, _ = session.call("POST", "/vector/add", {"text": text, "scope": "log", "metadata": meta})
    if status >= 500 or status in (401, 429):
        raise RuntimeError(f"/vector/add answered {status}")
    if status >= 300:
        quiet.log("worklog store", note=f"/vector/add refused {status} for {meta['project']}")
        return False
    return True
