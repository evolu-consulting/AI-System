"""Did the turn that is ending MUTATE anything? (Stop-hook read-only skip.)

## The problem this solves

The Stop hook exits 2 unconditionally, which blocks the turn and forces a full
extra model round so the work log can be checked. That is correct on a turn that
changed something and pure waste on a turn that only looked things up. Until now
the read-only exemption was written as PROSE inside the rule text - the model was
asked to notice the turn was read-only and skip. Measured cost of that design on
2026-09-07: every read-only turn still paid a complete extra round trip, because
prose in a prompt cannot stop a hook from exiting 2.

So the filter moves from the prompt into a condition. The hook asks this module.

## Why this lives in KH and not in the hook's PowerShell one-liner

Three reasons, in order of how much they hurt. The logic needs a real classifier
over a JSONL transcript, and that is not a one-liner. It needs to be TESTABLE
without ending a turn to run it. And it must exist in exactly one place: a copy
inside settings.json and a copy here would drift, which is the same defect item 4
of this upgrade set exists to remove.

## The asymmetry that drives every judgement call below

Getting this wrong is NOT symmetric.

- Say MUTATED on a read-only turn -> one wasted model round. Annoying.
- Say READ-ONLY on a turn that wrote -> the work log is silently skipped and the
  record of that work is gone. That is the exact failure the Stop hook was built
  to prevent.

Therefore this module FAILS TOWARD "mutated" everywhere: an unreadable
transcript, an unparseable row, an unknown tool, a shell command it cannot
classify, any exception at all. Only a turn it can positively account for as
read-only is reported read-only. The hook must apply the same rule to a network
error reaching KH.
"""
from __future__ import annotations

import io
import json
import logging
import re

logger = logging.getLogger(__name__)

#: Tools that change state by definition. Anything not listed here and not a
#: shell is treated as a read UNLESS it is unknown - see UNKNOWN_IS_MUTATION.
MUTATING_TOOLS = frozenset({
    "Write", "Edit", "NotebookEdit", "MultiEdit",
    "Artifact",                      # publishes a page to claude.ai
    "Agent", "Task", "Workflow",     # can do anything, including write
    "TaskCreate", "TaskUpdate",      # harness task state
    "CronCreate", "CronDelete", "ScheduleWakeup",
    "PushNotification", "RemoteTrigger", "SendMessage",
    "EnterWorktree", "ExitWorktree", "DesignSync",
})

#: Tools that only read. Listed EXPLICITLY rather than inferred, so a tool the
#: harness adds tomorrow is unknown rather than silently assumed harmless.
READONLY_TOOLS = frozenset({
    "Read", "Grep", "Glob", "WebFetch", "WebSearch",
    "TaskList", "TaskGet", "TaskOutput", "CronList",
    "ToolSearch", "Skill", "Monitor", "AskUserQuestion",
    "ReportFindings", "ExitPlanMode", "EnterPlanMode",
})

#: A tool name this module has never heard of counts as a mutation. See the
#: asymmetry note in the module docstring: unknown must not mean safe.
UNKNOWN_IS_MUTATION = True

#: Shell commands are classified by pattern because a shell can do anything.
#: These patterns are deliberately GENEROUS - a false "mutated" costs one round,
#: a false "read-only" loses a work log. Each entry is (compiled pattern, why).
_SHELL_MUTATION_PATTERNS = [
    # --- KH writes ---
    (r"/vector/add|/vector/backfill|/vector/chunk", "KH vector write"),
    (r"/hooks/(set|delete)", "KH hook rule write"),
    (r"/policy/(add|actions/bulk|action/set|action/delete|rule/set|rule/delete)",
     "KH policy write"),
    (r"/feedback/(issue|resolve|reset|tick|sweep)", "KH feedback write"),
    (r"/knowledge(/revise|/orphans)?\b", "KH knowledge write or delete"),
    (r"/projects(/registry/sync)?\b", "KH project registry write"),
    (r"/orchestrator/(shortcut|fact|switch)", "KH orchestrator write"),
    (r"/graph/add|/layers/add|/keys/(add|delete)|/codegraph/import", "KH graph or key write"),
    # --- generic HTTP writes ---
    (r"-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE)",
     "HTTP write verb"),
    (r"curl[^|;]*\s(-d|--data|--data-raw|--data-binary|-F)\b", "curl request body"),
    # --- filesystem writes (posix + powershell) ---
    (r"(^|[^>])>>?[^>]", "shell redirection"),
    (r"\b(rm|mv|cp|mkdir|rmdir|touch|tee|ln|chmod|chown|truncate)\s", "posix file mutation"),
    (r"\bsed\s+-i|\bperl\s+-i", "in-place edit"),
    (r"\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|"
     r"Rename-Item|Set-ItemProperty|New-ItemProperty|Clear-Content)\b", "powershell file mutation"),
    # --- version control and packaging ---
    # `[^|;]*?` because the verb is often NOT adjacent to the command: real
    # examples from this machine are `git -C <repo> commit` and `docker compose
    # up`. Patterns anchored on adjacency missed both (caught by test, 2026-09-07).
    (r"\bgit\b[^|;]*?\s(add|commit|push|reset|revert|checkout|switch|merge|rebase|tag|"
     r"stash|clean|rm|mv|apply|cherry-pick)\b", "git mutation"),
    (r"\b(npm|pnpm|yarn|pip|uv)\b[^|;]*?\s(install|add|remove|uninstall|publish)\b",
     "package install"),
    # --- running a local script: it can write, and we cannot see inside it ---
    (r"\bpython[0-9.]*\s+[^-\s][^\s]*\.py\b", "runs a local python script"),
    (r"\b(bash|sh|pwsh|powershell)\s+[^-\s][^\s]*\.(sh|ps1)\b", "runs a local shell script"),
    (r"\.ps1['\"]?\s", "invokes a powershell script"),
    # --- build / deploy / service control ---
    (r"\b(docker|docker-compose)\b[^|;]*?\s(run|up|build|exec|rm|stop|start|restart)\b",
     "container mutation"),
    (r"\b(Start|Stop|Restart)-(Service|Process)\b|\btaskkill\b|\bkill\s+-",
     "process or service control"),
]

_SHELL_MUTATION = [(re.compile(p, re.IGNORECASE), why) for p, why in _SHELL_MUTATION_PATTERNS]

SHELL_TOOLS = frozenset({"Bash", "PowerShell"})


def classify_shell(command: str) -> str | None:
    """Return the reason this shell command mutates, or None if it looks read-only."""
    text = command or ""
    for pat, why in _SHELL_MUTATION:
        if pat.search(text):
            return why
    return None


def _is_real_user_prompt(row: dict) -> bool:
    """True for a human turn boundary.

    Verified against a live transcript on 2026-09-07: a human prompt is
    ``type == 'user'`` carrying a message with at least one non-empty text
    block, and NO ``toolUseResult``. Tool results are also ``type == 'user'``,
    which is exactly why the toolUseResult check has to be here.
    """
    if row.get("type") != "user" or row.get("toolUseResult") is not None:
        return False
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list):
        return any(isinstance(b, dict) and b.get("type") == "text"
                   and (b.get("text") or "").strip() for b in content)
    return False


def turn_tool_calls(transcript_path: str, prompt_id: str = "") -> tuple[list[dict], str]:
    """Every tool call made in the CURRENT turn, plus how the slice was found.

    Two independent signals, and they cross-check each other (both were verified
    to agree on a live transcript, 2026-09-07):

    1. ``prompt_id`` from the Stop payload. Tool-RESULT rows carry ``promptId``;
       assistant rows do not, so this alone cannot find the tool calls - but it
       can confirm the boundary.
    2. Walking BACKWARD to the last real user prompt. This finds the slice.

    The backward walk is primary because it needs nothing from the payload.
    """
    rows: list[dict] = []
    with io.open(transcript_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                # A row we cannot parse might have been the write. Say so loudly
                # by returning a synthetic mutation rather than skipping it.
                rows.append({"type": "assistant", "_unparseable": True})

    start = 0
    for i in range(len(rows) - 1, -1, -1):
        if _is_real_user_prompt(rows[i]):
            start = i
            break
    tail = rows[start:]

    how = "backward-walk to row %d of %d" % (start, len(rows))
    if prompt_id:
        seen = {r.get("promptId") for r in tail if r.get("promptId")}
        if seen and prompt_id not in seen:
            # The payload's turn is not the slice we found. Do not guess which is
            # right - widen to the whole transcript so nothing is missed.
            tail = rows
            how += " (prompt_id %s not in slice - widened to whole transcript)" % prompt_id
        elif seen:
            how += " (prompt_id confirmed)"

    calls: list[dict] = []
    for row in tail:
        if row.get("_unparseable"):
            calls.append({"tool": "<unparseable transcript row>", "detail": ""})
            continue
        if row.get("type") != "assistant":
            continue
        for block in (row.get("message") or {}).get("content") or []:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            inp = block.get("input") or {}
            name = block.get("name") or ""
            detail = ""
            if name in SHELL_TOOLS:
                detail = inp.get("command") or ""
            elif name in ("Write", "Edit", "NotebookEdit", "MultiEdit"):
                detail = str(inp.get("file_path") or "")
            calls.append({"tool": name, "detail": detail})
    return calls, how


def turn_mutated(transcript_path: str, prompt_id: str = "") -> dict:
    """Decide whether the ending turn changed anything.

    Returns ``{mutated, reason, tool_count, how, evidence}``. ``mutated`` is True
    on ANY doubt - see the asymmetry note in the module docstring.
    """
    if not transcript_path:
        return {"mutated": True, "reason": "no transcript_path supplied",
                "tool_count": 0, "how": "n/a", "evidence": []}
    try:
        calls, how = turn_tool_calls(transcript_path, prompt_id)
    except Exception as exc:
        logger.warning("turn_mutated - cannot read transcript %s: %s", transcript_path, exc)
        return {"mutated": True, "reason": "transcript unreadable: %s" % exc,
                "tool_count": 0, "how": "n/a", "evidence": []}

    evidence: list[dict] = []
    for call in calls:
        name = call["tool"]
        if name in SHELL_TOOLS:
            why = classify_shell(call["detail"])
            if why:
                evidence.append({"tool": name, "why": why,
                                 "detail": " ".join(call["detail"].split())[:160]})
        elif name in MUTATING_TOOLS:
            evidence.append({"tool": name, "why": "mutating tool", "detail": call["detail"]})
        elif name in READONLY_TOOLS:
            continue
        elif UNKNOWN_IS_MUTATION:
            evidence.append({"tool": name, "why": "unknown tool - treated as mutating",
                             "detail": call["detail"]})

    if evidence:
        return {"mutated": True, "reason": evidence[0]["why"],
                "tool_count": len(calls), "how": how, "evidence": evidence}
    return {"mutated": False, "reason": "no mutating tool call in this turn",
            "tool_count": len(calls), "how": how, "evidence": []}
