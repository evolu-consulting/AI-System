"""KH hooks for assistant CLIs, through the helper.

`kh hook <event>` is what a CLI hook runs. It asks KH (signed in, as the person) for the rule text
of that hook type and prints it the way the CLI expects, exactly as the older `curl` hooks against
a local KH did. It never fails the CLI: without a sign-in it prints a one-line reminder instead.

`kh setup` writes those hooks into the CLI's settings, and registers the MCP server, without touching the
person's own hooks, and `kh setup --remove` takes out only what it added. The one exception is the
hooks an older local KH install wrote by hand (curl against /hooks/raw): setup replaces them, since
left in place every event ran twice (1.8.3). The events and their
output shapes live in HOOKS below; a new CLI is a new writer, not a new hook logic.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import threading
import urllib.parse
import time
from pathlib import Path

from . import quiet, worklog
from .session import HOME, NotSignedIn, Session, actor_id, profile_dir, remember_actor

MARKER = "kh hook"          # every command this helper writes starts with it; that is how --remove finds them

# event -> how the Claude Code hook is written and how its output is shaped.
#   sources: KH routes whose text is printed, in order
#   event:   the CLI event it is written under, when that differs from the key (two hooks on one event)
#   matcher: Claude Code tool matcher (PreToolUse only)
#   shape:   "text" = print as is; "pretool" = wrap as additionalContext JSON;
#            "stop" = {"decision": "block", "reason": ...} on stdout, exit 0
#            "postcompact" = the SessionStart rules again, prefixed, as additionalContext JSON
#   guards:  PreToolUse only: also ask KH for the person's tool guards (/personalization/guards) and, when one
#            matches the tool input, answer permissionDecision ask / deny quoting the rule (1.12.0)
HOOKS = {
    # 1.18.3: the kernel and the person's personalization are two hooks. Claude Code keeps at most 10,000
    # characters of one hook's output in context and swaps the rest for a file the model never reads, so the
    # two together (over 10k) lost the personalization; each hook has a cap of its own.
    # 2026-10-29: the tagged kernel. KH merges common, project and personal rules in code (/kernel/render) and
    # cuts the result at rule boundaries into parts under that cap; each hook prints one part. "a||b": the first
    # route KH has (status < 300) wins, even when its text is empty, so an older KH keeps the two-row kernel.
    "SessionStart": {"sources": ["/kernel/render?part=1||/hooks/raw?hook_type=SessionStart"], "shape": "text"},
    "SessionStartPersonal": {"event": "SessionStart",
                             "sources": ["/kernel/render?part=2||/personalization/render"], "shape": "text"},
    "SessionStartRest": {"event": "SessionStart", "sources": ["/kernel/render?part=3||"], "shape": "text"},
    # inbox: also deliver the caller's unread messages from the projects' message stacks (1.8.0)
    # turn: also the prompt's turn context from /turn/context - project, actions, findings, entities and
    # lessons in one call, so the model no longer makes those calls itself (1.9.0, roadmap item B)
    "UserPromptSubmit": {"sources": ["/hooks/raw?hook_type=UserPromptSubmit"], "shape": "text", "inbox": True,
                         "turn": True},
    "PreToolUse": {"sources": ["/kernel/pretool||/hooks/raw?hook_type=PreToolUse"], "shape": "pretool",
                   "matcher": "Agent|Task|Write|Edit|NotebookEdit|Artifact", "guards": True},
    # 1.13.2: after the turn's first change, remind the model to store its work log before it finishes, so
    # the Stop check finds the log and stays silent (Claude Code shows every Stop block as a red error line).
    # Local only, no KH call: it runs after every matched tool.
    "PostToolUse": {"sources": [], "shape": "nudge",
                    "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Agent|Task|Artifact|mcp__.*"},
    "Stop": {"sources": ["/hooks/raw?hook_type=Stop"], "shape": "stop"},
    # 1.8.3: the old local install had it; without it the rules loaded at start can be summarised away.
    # 1.19.1: the merged kernel reloads in the same parts as at session start. One hook with all of it (9.9k chars plus
    # the COMPACTED prefix on prod, 2026-10-30) went over the 10k cap. An older KH: the one-row kernel, as before.
    "PostCompact": {"sources": ["/kernel/render?part=1||/hooks/raw?hook_type=SessionStart"], "shape": "postcompact"},
    "PostCompactPersonal": {"event": "PostCompact", "sources": ["/kernel/render?part=2||"], "shape": "postcompact"},
    "PostCompactRest": {"event": "PostCompact", "sources": ["/kernel/render?part=3||"], "shape": "postcompact"},
}
COMPACTED = ("CONTEXT WAS JUST COMPACTED. The standing rules below were loaded at session start and may have "
             "been summarised away. They are authoritative and reloaded verbatim from KH - obey them as if "
             "freshly read.\n\n")

# What the hooks of an older, local KH install call (written by hand into settings.json as curl or
# Invoke-RestMethod against the KH on this machine). Only these KH routes are matched, never a
# person's own hook.
LEGACY_ROUTES = ("/hooks/raw?hook_type=", "/personalization/render", "/hooks/turn_mutated")


def cli_event(key: str) -> str:
    """The CLI event a HOOKS entry is written under."""
    return HOOKS[key].get("event", key)


def _text(session: Session, route: str) -> str:
    for one in route.split("||"):
        if not one:
            return ""
        status, body = session.call("GET", one)
        if status < 300:
            return body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    return ""


def guard_applies(when: dict, tool_input: dict) -> bool:
    """A guard's optional input filter: every named field must hold one of its listed values ("" = missing)."""
    for field, allowed in (when or {}).items():
        allowed = allowed if isinstance(allowed, list) else [allowed]
        value = tool_input.get(field) if isinstance(tool_input, dict) else None
        if ("" if value is None else str(value) if not isinstance(value, bool) else str(value).lower()) not in [str(a) for a in allowed]:
            return False
    return True


def tool_guard(session: Session, stdin_text: str) -> dict | None:
    """The decision of the person's KH tool guards for the tool about to run, or None (1.12.0).

    A guard is a personalization rule tied to one tool. "deny" beats "ask"; the reason quotes every
    matching rule so the model and the person both see why. Any failure answers None: a guard that cannot
    be read never blocks the CLI.
    """
    try:
        payload = json.loads(stdin_text or "{}")
    except ValueError:
        return None
    tool = str(payload.get("tool_name") or payload.get("toolName") or "")
    if not tool or tool in ("Write", "Edit", "NotebookEdit", "Agent", "Task"):
        return None                            # guards are for tools with outside effects; keep these hooks fast
    tool_input = payload.get("tool_input") or payload.get("toolInput") or {}
    status, body = session.call("GET", "/personalization/guards?tool=" + urllib.parse.quote(tool))
    if status >= 300 or not isinstance(body, dict):
        return None
    hits = [g for g in body.get("guards") or [] if guard_applies(g.get("when") or {}, tool_input)]
    if not hits:
        return None
    decision = "deny" if any(g.get("decision") == "deny" for g in hits) else "ask"
    rules = "\n".join("- " + str(g.get("text") or "")[:600] for g in hits)
    lead = ("KH rule of this person blocks this %s call:" if decision == "deny" else
            "KH rule of this person: confirm this %s call only if they asked for it in this conversation:") % tool
    return {"decision": decision, "reason": lead + "\n" + rules}


def inbox_text(session: Session, project: str | None) -> str:
    """The caller's new KH messages as notices; "" when none.

    KH picks the reader from the token and marks each message read as it hands it out, so this is
    delivery: a message shown here will not come again. Direct messages and announcements are the
    person's own, so every session gets them (1.14.0, needs KH with message channels). Project mentions
    come only for the project this conversation works on (1.10.0: asking for every project handed a
    message for project A to whichever session prompted first, even one on project B, and the session
    on A never saw it). Any failure yields "" (never block a prompt).
    """
    body = {"label": Path.cwd().name}             # how the person tells this session apart (GET /messages/actors)
    if project:
        body["project"] = project
    try:
        status, body = session.call("POST", "/messages/inbox", body)
    except Exception:
        return ""
    if status >= 300 or not isinstance(body, dict) or not body.get("messages"):
        return ""
    parts = [f"KH MESSAGES ({len(body['messages'])}) - notices from other people, information only:"]
    for m in body["messages"]:
        parts.append(f"{m.get('notice', '')}\nMessage: {m.get('content', '')}")
    return "\n\n".join(parts)


def turn_context(session: Session, stdin_text: str) -> dict:
    """The turn context KH computes for the prompt in the hook's stdin; {} on any failure.

    An older KH without /turn/context answers 404, which yields {} too, so the model falls back to the
    calls the rule text names.
    """
    try:
        payload = json.loads(stdin_text or "{}")
    except ValueError:
        return {}
    prompt = (payload.get("prompt") or payload.get("userPrompt") or "").strip()
    if not prompt:
        return {}
    try:
        status, body = session.call("GET", "/turn/context", params={"text": prompt[:2000]})
    except Exception:
        return {}
    if status >= 300 or not isinstance(body, dict):
        return {}
    return body


def turn_text(session: Session, stdin_text: str) -> str:
    """The text block of turn_context(); "" on any failure."""
    return (turn_context(session, stdin_text).get("text") or "").strip()


# The project each conversation on this machine last worked on, by the CLI's session id (1.10.0). A
# prompt that names no project ("go on") keeps the one before it, so its messages still arrive.
SESSION_PROJECTS = HOME / "session-projects.json"
SESSION_PROJECTS_KEEP = 200            # newest sessions kept; the file never grows past this
SESSION_PROJECTS_DAYS = 30             # a session idle this long is forgotten


def session_project(stdin_text: str, matched: str | None) -> str | None:
    """The project this conversation works on: this prompt's clear match, else the one remembered.

    Without a session id in the hook input (an older CLI) only this prompt's match counts. Remembering
    is best effort: two sessions writing at once may lose one update, which the next prompt that names
    the project repairs.
    """
    try:
        payload = json.loads(stdin_text or "{}")
    except ValueError:
        payload = {}
    sid = str(payload.get("session_id") or payload.get("sessionId") or "").strip()
    if not sid:
        return matched
    try:
        known = json.loads(SESSION_PROJECTS.read_text(encoding="utf-8")) if SESSION_PROJECTS.exists() else {}
        if not isinstance(known, dict):
            known = {}
    except Exception:
        known = {}
    if not matched:
        return (known.get(sid) or {}).get("project")
    now = time.time()
    known[sid] = {"project": matched, "at": now}
    fresh = [(k, v) for k, v in known.items()
             if isinstance(v, dict) and now - v.get("at", 0) < SESSION_PROJECTS_DAYS * 86400]
    fresh = sorted(fresh, key=lambda kv: kv[1]["at"])[-SESSION_PROJECTS_KEEP:]
    try:
        HOME.mkdir(parents=True, exist_ok=True)
        tmp = SESSION_PROJECTS.with_name(f"{SESSION_PROJECTS.name}.{os.getpid()}.tmp")
        tmp.write_text(json.dumps(dict(fresh)), encoding="utf-8")
        tmp.replace(SESSION_PROJECTS)
    except Exception as exc:
        quiet.log("session project", exc)
    return matched


# Tools that only read. A turn that used nothing else changed nothing, so the Stop check is skipped.
# Anything not listed - an edit, a shell command, any other MCP tool - counts as a change.
READ_ONLY_TOOLS = {"Read", "Glob", "Grep", "WebFetch", "WebSearch", "ToolSearch", "TodoWrite", "AskUserQuestion",
                   "mcp__knowledge-hub__kh_me", "mcp__knowledge-hub__kh_status", "mcp__knowledge-hub__kh_catalog",
                   "mcp__knowledge-hub__kh_help", "mcp__knowledge-hub__kh_context"}


# KH routes that answer with a POST body but only read (1.13.1: a turn of KH lookups counted as a change).
READ_ONLY_POSTS = {"/context/step", "/vector/query", "/vector/scroll"}


def _kh_path(args: dict) -> str:
    return str(args.get("path", "")).split("?", 1)[0].rstrip("/")


def _read_only_use(name: str, args: dict) -> bool:
    if name in READ_ONLY_TOOLS:
        return True
    if name == "mcp__knowledge-hub__kh_call":
        method = str(args.get("method", "")).upper()
        return method == "GET" or (method == "POST" and _kh_path(args) in READ_ONLY_POSTS)
    if name == "mcp__knowledge-hub__kh_members":
        return args.get("action", "people") in ("people", "list")
    return False


# An answer this long is a discussion, not small talk: it may have decided or learned something, so the Stop
# check runs even when no tool changed anything (2026-10-13: a design talk with no tool use never got its log).
DISCUSSION_CHARS = int(os.getenv("KH_HELPER_DISCUSSION_CHARS", "800"))
# A prompt this long usually carries new information (a fact, a constraint, a correction, a requirement) even
# when the answer is a short "noted": the check runs and the work-log rule decides (fen 2026-10-13).
PROMPT_CHARS = int(os.getenv("KH_HELPER_PROMPT_CHARS", "120"))


_INJECTED = re.compile(r"<(system-reminder|command-[a-z-]+|local-command-[a-z-]+)>.*?</\1>", re.S)


def _text_of(content) -> str:
    """What the person typed: the CLI's own injected blocks (system reminders, command echoes) do not count."""
    if isinstance(content, list):
        content = " ".join(c.get("text") or "" for c in content if isinstance(c, dict) and c.get("type") == "text")
    return _INJECTED.sub(" ", content) if isinstance(content, str) else ""


def turn_was_read_only(transcript_path: str) -> bool:
    """True only when the ending turn provably changed nothing; any doubt answers False.

    Reads the local transcript (the server cannot see it) back to the person's last prompt and checks
    every tool the assistant used since. Unreadable file, odd rows, an unknown tool: not read-only, so
    the Stop check still runs - skipping a real change would lose its work log.
    """
    if not transcript_path:
        return False
    try:
        rows = [json.loads(line) for line in Path(transcript_path).read_text(encoding="utf-8").splitlines() if line.strip()]
    except Exception:
        return False
    uses, said = [], 0
    for row in reversed(rows):
        message = row.get("message") or {}
        content = message.get("content")
        if row.get("type") == "user":
            is_tool_result = isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "tool_result" for c in content)
            if not is_tool_result:
                if len(_text_of(content).strip()) >= PROMPT_CHARS:
                    return False               # the person told something: let the work-log rule decide
                break                          # the person's prompt: the turn starts here
        elif row.get("type") == "assistant" and isinstance(content, list):
            uses += [c for c in content if isinstance(c, dict) and c.get("type") == "tool_use"]
            said += sum(len(c.get("text") or "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    else:
        return False                           # never found the prompt: cannot tell
    if said >= DISCUSSION_CHARS:
        return False                           # a discussion: let the work-log rule decide
    return all(_read_only_use(u.get("name", ""), u.get("input") or {}) for u in uses)


_CLI_LOG_WRITE = re.compile(r"/vector/add.*['\"]scope['\"]\s*:\s*['\"]log['\"]", re.S)


def _log_write(name: str, args: dict) -> bool:
    """A tool use that stored a work log: POST /vector/add with scope 'log', through MCP or the helper CLI."""
    if name == "mcp__knowledge-hub__kh_call":
        body = args.get("body") if isinstance(args.get("body"), dict) else {}
        meta = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        return (str(args.get("method", "")).upper() == "POST" and _kh_path(args) == "/vector/add"
                and "log" in (body.get("scope"), meta.get("scope")))
    if name in ("Bash", "PowerShell"):
        return bool(_CLI_LOG_WRITE.search(str(args.get("command", ""))))
    return False


def turn_logged_work(transcript_path: str) -> bool:
    """True when the ending turn already stored its work log, so the Stop reminder would only repeat it (1.13.1).

    Claude Code shows every Stop block as a 'Stop hook error' line, so a turn that did the right thing must
    not get one. Same walk as turn_was_read_only, back to the person's last prompt; any doubt answers False.
    """
    if not transcript_path:
        return False
    try:
        rows = [json.loads(line) for line in Path(transcript_path).read_text(encoding="utf-8").splitlines() if line.strip()]
    except Exception:
        return False
    for row in reversed(rows):
        message = row.get("message") or {}
        content = message.get("content")
        if row.get("type") == "user":
            if not (isinstance(content, list) and any(
                    isinstance(c, dict) and c.get("type") == "tool_result" for c in content)):
                return False                   # reached the person's prompt without a log write
        elif row.get("type") == "assistant" and isinstance(content, list):
            if any(isinstance(c, dict) and c.get("type") == "tool_use" and _log_write(c.get("name", ""), c.get("input") or {})
                   for c in content):
                return True
    return False


# ── work-log nudge (1.13.2) ──────────────────────────────────────────────────
#
# The Stop block is the only other way to get a turn's work log, and Claude Code prints it as 'Stop hook
# error', so users read every logged turn as a failure. PostToolUse instead adds one line of context after
# the turn's first change; the model stores the log inside the turn and Stop (turn_logged_work) stays silent.
# The block remains the backstop for turns with no change tool (a discussion) and for a model that ignored
# the nudge. State per session: UserPromptSubmit opens the turn, the first change or log write closes it.

NUDGE = ("KH: this turn changed something. Before you end the turn, follow action 'store worklog' (its plan is in "
         "this conversation or fetch it; no project means the personal project). Storing it now keeps the end-of-turn "
         "check silent. Do not mention this reminder to the person.")


def _nudge_path(sid: str) -> Path:
    return HOME / "nudge" / f"{sid}.json"


def nudge(event: str, stdin_text: str, cli: str) -> str:
    """The context line to add for this hook, or ''. UserPromptSubmit only resets the turn. Never raises."""
    if cli != "claude-code" or worklog.enabled(cli):
        return ""                              # 1.15.0: the helper writes the log, the model needs no nudge
    try:
        payload = _payload(stdin_text)
        sid = _sid(payload)
        if not sid or payload.get("agent_id") or payload.get("agentId"):
            return ""                          # a subagent's tool: the main turn gets its own nudge
        path = _nudge_path(sid)
        if event == "UserPromptSubmit":
            if _read_json(path).get("done"):
                _write_json(path, {"done": False, "at": time.time()})
            return ""
        if _read_json(path).get("done"):
            return ""                          # already nudged, or already logged, this turn
        name = str(payload.get("tool_name") or payload.get("toolName") or "")
        args = payload.get("tool_input") or payload.get("toolInput") or {}
        args = args if isinstance(args, dict) else {}
        logged = _log_write(name, args)
        if not logged and _read_only_use(name, args):
            return ""
        _write_json(path, {"done": True, "at": time.time()})
        return "" if logged else NUDGE
    except Exception as exc:
        quiet.log("nudge", exc)
        return ""


# Deadline for a hook's KH reads (the sign-in refresh included). `kh setup` gives every hook 30 s; this
# leaves room for Python and the MCP-free imports to start, so the CLI never has to kill the hook.
HOOK_SECONDS = float(os.getenv("KH_HELPER_HOOK_SECONDS", "20"))


def _is_network(exc: BaseException) -> bool:
    import requests
    return isinstance(exc, (requests.RequestException, OSError, TimeoutError))


def _notice(cli: str, message: str) -> None:
    """One polite line for the person instead of an error. Claude Code shows a hook's systemMessage.

    At most once per quiet.NOTICE_EVERY seconds: PreToolUse runs before every tool, and a slow spell would
    otherwise repeat the line on every step.
    """
    if cli == "claude-code" and quiet.notice_due():
        print(json.dumps({"systemMessage": message}, ensure_ascii=False))


def hooks_note(cli: str) -> str:
    """The hooks in settings.json were written by an older helper (a matcher changed): ask for setup (1.12.0)."""
    if cli != "claude-code":
        return ""
    try:
        settings = json.loads(claude_settings_path().read_text(encoding="utf-8"))
        stale = []
        ours = any(_is_ours(h) for groups in (settings.get("hooks") or {}).values()
                   for g in groups for h in g.get("hooks", []))
        for event, spec in HOOKS.items():
            groups = [g for g in (settings.get("hooks") or {}).get(cli_event(event), [])
                      if any(_is_ours(h) for h in g.get("hooks", []))]
            if ours and not groups:
                stale.append(event)            # an event added by a newer helper (1.13.2: PostToolUse)
            elif groups and spec.get("matcher") and all(g.get("matcher") != spec["matcher"] for g in groups):
                stale.append(event)
            elif groups and all(h.get("command") != _hook_command(event) for g in groups
                                for h in g.get("hooks", []) if _is_ours(h)):
                stale.append(event)            # 1.18.1: the quoted form PowerShell cannot run
        if not stale:
            return ""
        return (f"KH HOOKS OUT OF DATE: the {', '.join(stale)} hook on this machine was written by an older KH helper "
                f"and misses what KH now does there. Run \"{sys.executable}\" -m kh_helper.cli setup now (safe to repeat) "
                f"and tell the person to restart this app so the new hooks load.")
    except Exception as exc:                   # a local file check must never cost the session its rules
        quiet.log("hooks note", exc)
        return ""


def _version_key(version: str) -> tuple:
    return tuple(int(p) if p.isdigit() else -1 for p in re.split(r"[.+-]", version or "0"))


def update_note(session: Session) -> str:
    """A newer helper is published: one line asking the assistant to upgrade this copy (1.15.0). Since 1.17.0
    the release is the versions row ver_kh-helper (a public zip, e.g. on Drive), else KH's /auth/config
    (app release.latest); either way no KH redeploy, so this is how releases reach people."""
    try:
        from . import release
        installed = release.installed_version()
        found = release.latest(session)
        if not found or not release.newer(found["version"], installed):
            return ""
        return (f"KH HELPER UPDATE: kh-helper {found['version']} is published (this machine has {installed}). "
                f"Tell the person in one line, then, unless they decline, run: \"{sys.executable}\" -m kh_helper.cli "
                f"upgrade and ask them to restart this app so the new version loads.")
    except Exception as exc:                   # a version check must never cost the session its rules
        quiet.log("update note", exc)
        return ""


def companion_note(cli: str) -> str:
    """A companion installed after setup ran (1.11.0): one line asking the assistant to run setup again."""
    try:
        from . import clis, companions
        return companions.note(cli, clis.profile(cli), sys.executable)
    except Exception as exc:                   # a local file check must never cost the session its rules
        quiet.log("companion note", exc)
        return ""


# ── step outcomes (roadmap E-5 slice S8, docs/roadmap-e-to-5-design.md 5.2) ─────
#
# Every served step (a `serve_id` from /context/step or /turn/context) gets a label from code signals only,
# never from the model's own word, and the person does nothing extra:
#   failed     a tool result of the turn failed (is_error, non-zero exit) after the step was served; source tool
#   corrected  the next prompt, within 30 min, holds a correction word; source correction
#   done       Stop came and the step had no label yet; source stop
# Precedence corrected > failed > done: a label is sent only when it outranks the one already sent. The
# signals come from the turn's transcript at Stop (it holds every tool use and result), and from a
# PostToolUse / PostToolUseFailure payload when a CLI wires those events; both go through _record_tool.
#
# Off unless KH lists the `outcomes` capability (KH_CAP_OUTCOMES=on) in GET /v1/capabilities, and its limits
# do not say helper: off. KH_HELPER_OUTCOMES=on|off on this machine overrides it. Labels go to an outbox in
# the session's state file and are POSTed to /step/outcome on a daemon thread; the hook waits at most
# OUTCOME_GRACE seconds for it, so a slow KH never delays the turn. What is not sent is retried by the next hook.

OUTCOME_GRACE = float(os.getenv("KH_HELPER_OUTCOME_GRACE", "0.25"))
OUTCOME_CAP_TTL = 3600                 # seconds the capability answer is trusted
OUTCOME_CORRECTION_SECONDS = 1800      # a correction counts for the previous turn within 30 min
OUTCOME_KEEP_SECONDS = 86400           # unsent labels older than this are dropped (KH's override window)
OUTCOME_OUTBOX_MAX = 50
OUTCOME_ERROR_CHARS = 300
OUTCOME_RANK = {"done": 1, "failed": 2, "corrected": 3}
# The `correction` kind of KH's distill_signal seed (app/config.DISTILL_SIGNAL_SEED). The capability's limits
# may carry `correction_words`, which then replace this list.
CORRECTION_WORDS = ("correction", "wrong", "instead", "never", "always", "sai", "khong duoc", "luon luon", "tu gio")
_SERVE_ID = re.compile(r'\\*"serve_id\\*"\s*:\s*\\*"([A-Za-z0-9_.:-]{1,200})')   # plain or escaped JSON
_outcome_lock = threading.Lock()


def _outcome_dir() -> Path:
    return HOME / "outcomes"


def _payload(stdin_text: str) -> dict:
    try:
        payload = json.loads(stdin_text or "{}")
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _sid(payload: dict) -> str:
    sid = str(payload.get("session_id") or payload.get("sessionId") or "").strip()
    return re.sub(r"[^A-Za-z0-9_.-]", "_", sid)[:120]


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except Exception as exc:
        quiet.log("outcome state", exc)


def outcome_capability() -> dict:
    """The cached answer {on, words, at}; {} when never asked."""
    return _read_json(_outcome_dir() / "capability.json")


def outcomes_on() -> bool:
    forced = os.getenv("KH_HELPER_OUTCOMES", "").strip().lower()
    if forced in ("on", "off"):
        return forced == "on"
    return bool(outcome_capability().get("on"))


def _refresh_capability(session: Session) -> None:
    """Ask KH whether it records outcomes; cache only a clear answer (a list, or 404 from an older KH)."""
    status, body = session.call("GET", "/v1/capabilities")
    if status == 404:
        cap = {"on": False}
    elif status < 300 and isinstance(body, dict) and isinstance(body.get("capabilities"), list):
        found = next((c for c in body["capabilities"] if isinstance(c, dict) and c.get("name") == "outcomes"), None)
        limits = (found or {}).get("limits") or {}
        helper = str(limits.get("helper", "on")).strip().lower()
        cap = {"on": found is not None and helper not in ("off", "false", "0", "no")}
        words = limits.get("correction_words")
        if isinstance(words, list) and all(isinstance(w, str) for w in words) and words:
            cap["words"] = words[:200]
    else:
        return
    cap["at"] = time.time()
    _write_json(_outcome_dir() / "capability.json", cap)


def _norm(text: str) -> str:
    import unicodedata
    text = text.replace("đ", "d").replace("Đ", "D")
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch))
    return " ".join(text.casefold().split())


def has_correction(prompt: str, words=None) -> bool:
    """True when the prompt holds a correction word or phrase as whole words (accents and case ignored)."""
    text = _norm(prompt or "")
    for word in words or CORRECTION_WORDS:
        w = _norm(word)
        if w and re.search(r"(?<!\w)" + re.escape(w) + r"(?!\w)", text):
            return True
    return False


def _result_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(_result_text(c.get("text", "") if isinstance(c, dict) else c) for c in content)
    if isinstance(content, dict):
        for key in ("text", "content", "error", "stderr", "stdout"):
            if isinstance(content.get(key), (str, list)):
                return _result_text(content[key])
        return json.dumps(content, ensure_ascii=False)
    return "" if content is None else str(content)


def _error_line(text: str) -> str:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return "tool failed"
    line = lines[0]
    if re.fullmatch(r"(?i)exit code -?\d+", line) and len(lines) > 1:
        line = f"{line}: {lines[1]}"
    return line[:OUTCOME_ERROR_CHARS]


def _failed(response, failure_event: bool) -> bool:
    if failure_event:
        return True
    if isinstance(response, dict):
        if response.get("is_error") or response.get("isError"):
            return True
        for key in ("exit_code", "exitCode", "returncode", "code"):
            code = response.get(key)
            if isinstance(code, int) and not isinstance(code, bool) and code != 0:
                return True
    return False


def _label(state: dict, ids, outcome: str, source: str, error: str | None = None) -> None:
    """Label these serve ids unless they already hold an equal or stronger label; queue what changed."""
    labels = state.setdefault("labels", {})
    now = time.time()
    fresh = [i for i in dict.fromkeys(ids)
             if OUTCOME_RANK[outcome] > OUTCOME_RANK.get((labels.get(i) or [None])[0], 0)]
    if not fresh:
        return
    for i in fresh:
        labels[i] = [outcome, now]
    entry = {"serve_ids": fresh, "outcome": outcome, "source": source, "at": now}
    if error:
        entry["error"] = error[:OUTCOME_ERROR_CHARS]
    state.setdefault("outbox", []).append(entry)


def _record_tool(state: dict, name: str, args: dict, response, failure_event: bool = False) -> None:
    """One tool use: a /context/step answer adds its serve_id to the turn; a failure labels the turn's steps."""
    text = _result_text(response)
    if name.endswith("kh_call") and "/context/step" in str((args or {}).get("path", "")):
        for sid in _SERVE_ID.findall(text):
            if sid not in state.setdefault("turn", []):
                state["turn"].append(sid)
    if _failed(response, failure_event) and state.get("turn"):
        _label(state, state["turn"], "failed", "tool", _error_line(text))


def _scan_transcript(state: dict, transcript_path: str) -> None:
    """Replay the ending turn's tool uses and results (since the person's last prompt) through _record_tool."""
    try:
        rows = [json.loads(line) for line in Path(transcript_path).read_text(encoding="utf-8").splitlines()
                if line.strip()]
    except Exception:
        return
    turn = []
    for row in reversed(rows):
        content = (row.get("message") or {}).get("content") if isinstance(row, dict) else None
        if row.get("type") == "user" and not (isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "tool_result" for c in content)):
            break
        turn.append(row)
    uses = {}
    for row in reversed(turn):
        content = (row.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use":
                uses[c.get("id")] = (c.get("name") or "", c.get("input") or {})
            elif c.get("type") == "tool_result" and c.get("tool_use_id") in uses:
                name, args = uses[c["tool_use_id"]]
                _record_tool(state, name, args, {"content": c.get("content"), "is_error": bool(c.get("is_error"))})


def _outcome_local(event: str, payload: dict) -> bool:
    """The local part of a hook (file reads and writes only). True when there is something to send."""
    sid = _sid(payload)
    if not sid:
        return False
    path = _outcome_dir() / f"{sid}.json"
    with _outcome_lock:
        state = _read_json(path)
        now = time.time()
        if event == "UserPromptSubmit":
            prompt = payload.get("prompt") or payload.get("userPrompt") or ""
            prev = state.get("prev") or {}
            if (prev.get("ids") and now - prev.get("at", 0) <= OUTCOME_CORRECTION_SECONDS
                    and has_correction(prompt, outcome_capability().get("words"))):
                _label(state, prev["ids"], "corrected", "correction")
            state["prev"] = {}
            state["turn"] = []
        elif event in ("PostToolUse", "PostToolUseFailure"):
            _record_tool(state, str(payload.get("tool_name") or payload.get("toolName") or ""),
                         payload.get("tool_input") or payload.get("toolInput") or {},
                         payload.get("tool_response", payload.get("toolResponse", payload.get("error"))),
                         failure_event=event == "PostToolUseFailure")
        elif event == "Stop":
            transcript = payload.get("transcript_path") or payload.get("transcriptPath") or ""
            if transcript:
                _scan_transcript(state, transcript)
            ids = state.get("turn") or []
            _label(state, [i for i in ids if i not in state.get("labels", {})], "done", "stop")
            if ids:
                state["prev"] = {"ids": list(dict.fromkeys((state.get("prev") or {}).get("ids", []) + ids)),
                                 "at": now}
        state["labels"] = {k: v for k, v in (state.get("labels") or {}).items()
                           if isinstance(v, list) and len(v) == 2 and now - v[1] < OUTCOME_KEEP_SECONDS}
        state["outbox"] = [e for e in state.get("outbox") or [] if now - e.get("at", 0) < OUTCOME_KEEP_SECONDS
                           ][-OUTCOME_OUTBOX_MAX:]
        _write_json(path, state)
        return bool(state["outbox"])


def outcome_served(stdin_text: str, serve_id) -> None:
    """The serve_id /turn/context gave this prompt joins the turn's steps. Never raises."""
    try:
        if not serve_id or not outcomes_on():
            return
        sid = _sid(_payload(stdin_text))
        if not sid:
            return
        path = _outcome_dir() / f"{sid}.json"
        with _outcome_lock:
            state = _read_json(path)
            if str(serve_id) not in state.setdefault("turn", []):
                state["turn"].append(str(serve_id))
                _write_json(path, state)
    except Exception as exc:
        quiet.log("outcome served", exc)


def _flush(session: Session, sid: str, refresh: bool) -> None:
    """POST the session's outbox to /step/outcome; drop what KH took or refused for good."""
    try:
        if refresh:
            _refresh_capability(session)
        if not sid or not outcomes_on():
            return
        path = _outcome_dir() / f"{sid}.json"
        with _outcome_lock:
            outbox = list(_read_json(path).get("outbox") or [])
        done = []
        for entry in outbox:
            body = {k: entry[k] for k in ("serve_ids", "outcome", "source", "error") if k in entry}
            status, _ = session.call("POST", "/step/outcome", body)
            if status == 404 and not os.getenv("KH_HELPER_OUTCOMES"):
                _write_json(_outcome_dir() / "capability.json", {"on": False, "at": time.time()})
                done = outbox
                break
            if status < 500 and status != 401 and status != 429:
                done.append(entry)               # taken, or refused for good (4xx): never resend
            else:
                break
        if done:
            with _outcome_lock:
                state = _read_json(path)
                state["outbox"] = [e for e in state.get("outbox") or [] if e not in done]
                _write_json(path, state)
    except Exception as exc:                     # fire and forget: a failure only leaves the outbox for later
        if not _is_network(exc) and not isinstance(exc, NotSignedIn):
            quiet.log("outcome send", exc)


def outcome_start(event: str, session: Session, stdin_text: str) -> threading.Thread | None:
    """Record this hook's signal locally and start the background send; None when there is nothing to do."""
    try:
        refresh = time.time() - outcome_capability().get("at", 0) > OUTCOME_CAP_TTL \
            and not os.getenv("KH_HELPER_OUTCOMES")
        payload = _payload(stdin_text)
        pending = outcomes_on() and _outcome_local(event, payload)
        if not (pending or refresh):
            return None
        thread = threading.Thread(target=_flush, args=(session, _sid(payload), refresh),
                                  name="kh-outcome", daemon=True)
        thread.start()
        return thread
    except Exception as exc:
        quiet.log("outcome", exc)
        return None


def outcome_end(thread: threading.Thread | None) -> None:
    """Give the background send a short grace; a daemon thread still running is dropped with the process."""
    if thread is not None:
        thread.join(OUTCOME_GRACE)


OUTCOME_EVENTS = ("PostToolUse", "PostToolUseFailure")


def run_hook(event: str, session: Session, stdin_text: str = "", cli: str = "claude-code") -> int:
    """Print what the CLI should see for this hook event; return the exit code to use.

    Step outcomes are recorded first (local and fast) and sent in the background; see outcome_start.
    """
    if os.getenv(worklog.GUARD_ENV):
        return 0                               # inside the work-log summarizer: its own CLI must not loop back
    sender = outcome_start(event, session, stdin_text)
    try:
        if event in ("UserPromptSubmit", "PostToolUse"):
            line = nudge(event, stdin_text, cli)
            if line:
                print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": line}},
                                 ensure_ascii=False))
                return 0
        if event in OUTCOME_EVENTS:
            return 0                           # outcome signal only: nothing to print
        return _run_hook(event, session, stdin_text, cli)
    finally:
        outcome_end(sender)


def _run_hook(event: str, session: Session, stdin_text: str = "", cli: str = "claude-code") -> int:
    """Print what the CLI should see for this hook event; return the exit code to use.

    cli="grok": Grok sends camelCase input and fires an extra Stop at session end, so only that differs.
    Both CLIs take a Stop block as JSON on stdout with exit 0. Claude Code reads stderr, not stdout, when a
    hook exits 2, so the old "print and exit 2" reached the model as "No stderr output" (fixed in 1.7.2).
    """
    spec = HOOKS.get(event)
    if spec is None:
        return 0
    # Every KH call of this hook is for this CLI session (1.18.0); its MCP server learns the id from here.
    session.actor = actor_id(_payload(stdin_text).get("session_id") or _payload(stdin_text).get("sessionId"))
    remember_actor(session.actor)
    try:
        sys.stdout.reconfigure(encoding="utf-8")   # hook texts are not ASCII; a Windows console default would crash
    except Exception:
        pass
    if spec["shape"] == "stop":
        try:
            payload = json.loads(stdin_text or "{}")
            if payload.get("stop_hook_active") or payload.get("stopHookActive"):
                return 0                       # the CLI is already continuing because of this hook
            if cli == "grok" and payload.get("reason", "end_turn") != "end_turn":
                return 0                       # Grok's session-end Stop: there is no turn left to continue
            transcript_path = payload.get("transcript_path") or payload.get("transcriptPath") or ""
            if turn_was_read_only(transcript_path):
                return 0                       # nothing changed this turn: no work log to check (1.8.2)
            if turn_logged_work(transcript_path):
                return 0                       # the turn already stored its work log (1.13.1)
            if worklog.enabled(cli) and worklog.queue(session, payload, cli, session_project(stdin_text, None)):
                return 0                       # the helper writes the log itself, nothing shown (1.15.0)
        except ValueError:
            pass

    def fetch() -> str:
        if spec.get("guards"):
            got["guard"] = tool_guard(session, stdin_text)
        text = "\n\n".join(t for t in (_text(session, r).strip() for r in spec["sources"]) if t)
        if event == "SessionStart":
            text = "\n\n".join(t for t in (text, companion_note(cli), hooks_note(cli), update_note(session)) if t)
        turn = turn_context(session, stdin_text) if spec.get("turn") else {}
        if turn.get("serve_id"):
            outcome_served(stdin_text, turn["serve_id"])
        if spec.get("inbox"):
            project = session_project(stdin_text, (turn.get("project") or {}).get("best"))
            text = "\n\n".join(t for t in (inbox_text(session, project), text) if t)
        if spec.get("turn"):
            text = "\n\n".join(t for t in (text, (turn.get("text") or "").strip()) if t)
        return text

    # The CLI kills a hook that runs past its own timeout and shows that as a red error. Several KH calls on
    # a slow network can get there, so the reads have a deadline of their own, well inside the CLI's (1.9.1).
    got: dict = {}

    def worker() -> None:
        try:
            got["text"] = fetch()
        except BaseException as exc:           # handed back to the main thread below
            got["error"] = exc

    thread = threading.Thread(target=worker, name=f"kh-hook-{event}", daemon=True)
    thread.start()
    thread.join(HOOK_SECONDS)
    if thread.is_alive():
        quiet.log(f"hook {event}", note=f"KH did not answer within {HOOK_SECONDS:g} s")
        _notice(cli, quiet.SLOW_STOP if spec["shape"] == "stop" else quiet.SLOW)
        return 0
    if isinstance(got.get("error"), NotSignedIn):
        if event == "SessionStart":
            print("Knowledge Hub: nobody is signed in on this machine. Ask the person to run `kh login`.")
        return 0
    if "error" in got:                         # KH unreachable or failing: log it, never block the CLI
        quiet.log(f"hook {event}", got["error"])
        if _is_network(got["error"]):
            _notice(cli, quiet.SLOW_STOP if spec["shape"] == "stop" else quiet.SLOW)
        return 0
    text = got.get("text", "")
    guard = got.get("guard")
    if spec["shape"] == "pretool" and guard:
        out = {"hookEventName": "PreToolUse", "permissionDecision": guard["decision"],
               "permissionDecisionReason": guard["reason"]}
        if text:
            out["additionalContext"] = text
        print(json.dumps({"hookSpecificOutput": out}, ensure_ascii=False))
        return 0
    if not text:
        return 0
    if spec["shape"] == "pretool":
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": text}},
                         ensure_ascii=False))
        return 0
    if spec["shape"] == "stop":
        print(json.dumps({"decision": "block", "reason": text}, ensure_ascii=False))
        return 0
    if spec["shape"] == "postcompact":
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostCompact",
                                                 "additionalContext": COMPACTED + text}}, ensure_ascii=False))
        return 0
    print(text)
    return 0


# ── settings writers ─────────────────────────────────────────────────────────

def claude_settings_path() -> Path:
    return profile_dir() / "settings.json"


def _git_bash() -> str | None:
    """The bash.exe Claude Code runs hooks with on Windows, or None (then it runs them with PowerShell)."""
    found = os.environ.get("CLAUDE_CODE_GIT_BASH_PATH")
    if found and Path(found).is_file():
        return found
    git = shutil.which("git")
    if git:
        for up in (Path(git).parent.parent, Path(git).parent.parent.parent):
            bash = up / "bin" / "bash.exe"
            if bash.is_file():
                return str(bash)
    return None


def _short_path(path: str) -> str:
    """The 8.3 form of a Windows path (no spaces), or the path itself when the volume has no short names."""
    try:
        import ctypes
        size = ctypes.windll.kernel32.GetShortPathNameW(path, None, 0)
        buffer = ctypes.create_unicode_buffer(size)
        if size and ctypes.windll.kernel32.GetShortPathNameW(path, buffer, size):
            return buffer.value
    except Exception as exc:
        quiet.log("short path", exc)
    return path


def hook_exe() -> str:
    """The helper's python as a hook command starts it, in a form the hook's shell can run (1.18.1).

    Claude Code on Windows runs hooks with Git Bash, or with PowerShell when Git for Windows is missing.
    PowerShell reads a leading quoted path as a string, not a command ("Unexpected token '-m'", 2026-10-26),
    so every hook failed there. A path with forward slashes and no spaces, unquoted, runs in PowerShell,
    bash and cmd alike; spaces are avoided with the 8.3 name, and only when that fails is the shell guessed.
    """
    exe = sys.executable
    if os.name != "nt":
        return f'"{exe}"'
    if " " in exe:
        exe = _short_path(exe)
    exe = exe.replace("\\", "/")
    if " " not in exe:
        return exe
    return f'"{exe}"' if _git_bash() else f'& "{exe}"'


def _hook_command(event: str) -> str:
    # The module form works whether or not the `kh` script is on PATH.
    return f"{hook_exe()} -m kh_helper.cli hook {event}"


def hook_check() -> dict:
    """Run the hook command's start (python --version) in each shell Claude Code may use for hooks here.

    {"shell": "ok" | "failed: ..."}; setup reports it, so an install that writes hooks the CLI cannot run
    says so at once instead of as a red line in every session."""
    import subprocess
    probe = f"{hook_exe()} --version"
    shells = {}
    if os.name == "nt":
        bash = _git_bash()
        if bash:
            shells["git-bash"] = [bash, "-c", probe]
        powershell = shutil.which("pwsh") or shutil.which("powershell")
        if powershell:
            shells["powershell"] = [powershell, "-NoProfile", "-NonInteractive", "-Command", probe]
    else:
        shells["sh"] = ["/bin/sh", "-c", probe]
    result = {}
    for name, argv in shells.items():
        try:
            done = subprocess.run(argv, capture_output=True, text=True, timeout=30)
            ok = done.returncode == 0 and "Python" in (done.stdout + done.stderr)
            result[name] = "ok" if ok else f"failed: {(done.stderr or done.stdout).strip()[:200]}"
        except Exception as exc:
            result[name] = f"failed: {exc}"[:200]
    return result


def _is_ours(hook: dict) -> bool:
    return "kh_helper.cli hook" in (hook.get("command") or "")


def _is_legacy(hook: dict) -> bool:
    command = hook.get("command") or ""
    return not _is_ours(hook) and any(route in command for route in LEGACY_ROUTES)


def setup_claude(path: Path, kh_url: str, remove: bool = False, mcp: bool = True) -> dict:
    settings = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if path.exists():
        backup = path.with_name(f"{path.name}.kh-bak-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(path, backup)
    else:
        backup = None
    hooks = settings.setdefault("hooks", {})
    removed = legacy = 0
    # Take out our own entries first (all events), so setup is idempotent and --remove is exact.
    # setup (not --remove) also replaces an older local install's hooks, which would otherwise run twice.
    for event in list(hooks):
        kept_groups = []
        for group in hooks[event]:
            before = len(group.get("hooks", []))
            group["hooks"] = [h for h in group.get("hooks", []) if not _is_ours(h)]
            removed += before - len(group["hooks"])
            if not remove:
                before = len(group["hooks"])
                group["hooks"] = [h for h in group["hooks"] if not _is_legacy(h)]
                legacy += before - len(group["hooks"])
            if group["hooks"]:
                kept_groups.append(group)
        if kept_groups:
            hooks[event] = kept_groups
        else:
            del hooks[event]
    added = 0
    if not remove:
        for event, spec in HOOKS.items():
            group = {"hooks": [{"type": "command", "command": _hook_command(event), "timeout": 30}]}
            if spec.get("matcher"):
                group["matcher"] = spec["matcher"]
            hooks.setdefault(cli_event(event), []).append(group)
            added += 1
    if not hooks:
        settings.pop("hooks", None)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"settings": str(path), "backup": str(backup) if backup else None, "hooks_added": added,
            "hooks_removed": removed, "hook_shells": hook_check() if added else {}, "legacy_hooks_replaced": legacy, "mcp_server": _claude_mcp(kh_url, remove) if mcp else "skipped",
            "companions": _claude_companions(remove) if mcp else {}}


def _claude_config_envs(profile: Path) -> list[dict]:
    """One environment per user config file a Claude Code of this profile may read MCP servers from.

    Claude Code keeps user-scope MCP servers in $CLAUDE_CONFIG_DIR/.claude.json when the variable is set,
    and in ~/.claude.json when it is not. The default profile (~/.claude) is started both ways, so it gets
    both files; before 1.7.2 the server went only where the shell running setup happened to point, and a
    Claude Code started the other way had KH's hooks but no kh_call tool.
    """
    base = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CONFIG_DIR", "CLAUDECODE", "CLAUDE_PID")}
    envs = [{**base, "CLAUDE_CONFIG_DIR": str(profile)}]
    if os.path.normcase(str(profile.expanduser().resolve())) == os.path.normcase(str((Path.home() / ".claude").resolve())):
        envs.append(base)
    return envs


def _claude_mcp(kh_url: str, remove: bool) -> str:
    """Register the MCP server with Claude Code's own command (user scope), when it is installed."""
    import subprocess
    claude = shutil.which("claude")
    if claude is None:
        return ("claude CLI not found; add it by hand: claude mcp add -s user knowledge-hub -- "
                f'"{sys.executable}" -m kh_helper.cli --kh-url {kh_url} mcp')
    failures = []
    for env in _claude_config_envs(profile_dir()):
        subprocess.run([claude, "mcp", "remove", "-s", "user", "knowledge-hub"], capture_output=True, env=env)
        if remove:
            continue
        done = subprocess.run([claude, "mcp", "add", "-s", "user", "knowledge-hub", "--", sys.executable, "-m",
                               "kh_helper.cli", "--kh-url", kh_url, "mcp"], capture_output=True, text=True, env=env)
        if done.returncode != 0:
            failures.append(done.stderr.strip()[:200])
    if remove:
        return "removed"
    return "knowledge-hub" if not failures else f"claude mcp add failed: {'; '.join(failures)}"


def _claude_companions(remove: bool) -> dict:
    """Register each installed companion MCP server (companions.py) the way knowledge-hub is; on remove,
    take out every known one. {name: "registered" | "removed" | "claude mcp add failed: ..."} (1.11.0)."""
    import subprocess
    from .clis import _companions
    todo = _companions(remove)
    claude = shutil.which("claude") if todo else None
    if claude is None:
        return {c["name"]: "claude CLI not found" for c in todo if not remove}
    result = {}
    for c in todo:
        failures = []
        for env in _claude_config_envs(profile_dir()):
            subprocess.run([claude, "mcp", "remove", "-s", "user", c["name"]], capture_output=True, env=env)
            if remove:
                continue
            done = subprocess.run([claude, "mcp", "add", "-s", "user", c["name"], "--", c["command"], *c["args"]],
                                  capture_output=True, text=True, env=env)
            if done.returncode != 0:
                failures.append(done.stderr.strip()[:200])
        result[c["name"]] = ("removed" if remove else "registered" if not failures
                             else f"claude mcp add failed: {'; '.join(failures)}")
    return result
