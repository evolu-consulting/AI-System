"""`dlc hook guard`: the PreToolUse hook every agent's Claude CLI runs before a shell command.

Agents get the full Claude Code tool set (Bash, PowerShell, web, subagents) and run with the rights of the
account the engine runs as. The engine keeps the delivery decisions, so a few commands are refused here:

  - git push to main / master (or a push that names no branch): the engine merges and delivers
    (Push to source); agents work on their own branches
  - recursive deletes (rm -r / rm -rf / rmdir /s / Remove-Item -Recurse / del /s) of a path outside the
    agent's working folder, or of a drive / home root
  - commands an agent hook of Admin > Hooks refuses (scope agent, event before_tool: a pattern per role)
  - for builders and fixers, git commands that write history or move branches (commit, rebase, merge,
    reset, checkout, switch, stash, cherry-pick, revert, am, push): builders only implement; the engine
    commits their work and the merger agent (line.ship.merger) integrates it
  - deploys that name production, and `cf target` of a production space (cf push / cf deploy / gcloud ... deploy / kubectl / helm / npm|pnpm run
    deploy / mbt ... with prod, production or prd in the command)
  - commands that never exit (dev servers, watchers: npm run dev, vite, nodemon, cds watch, --watch ...) in the
    foreground; with run_in_background they run, and the call's job object ends them with the call (line.procjob)

Protocol (Claude Code hooks): the call arrives as JSON on stdin ({"tool_name", "tool_input": {"command"},
"cwd"}); exit 2 with the reason on stderr refuses it and tells the agent why; exit 0 lets it run.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from typing import List

SHELL_TOOLS = ("Bash", "PowerShell")

_PUSH = re.compile(r"\bgit\b[^|;&]*?\bpush\b([^|;&]*)", re.I)
_PROTECTED = re.compile(r"(^|[\s:+/])(main|master)(\s|$)", re.I)
_RM = re.compile(r"(\brm\s+(-[a-z]*r[a-z]*|--recursive)\b|\brmdir\s+/s\b|\brd\s+/s\b|\bdel\s+/s\b|"
                 r"\bRemove-Item\b[^|;&]*-Recurse\b)([^|;&]*)", re.I)
_DEPLOY = re.compile(r"\b(cf\s+(push|deploy|bg-deploy|blue-green-deploy)|gcloud\b[^|;&]*\bdeploy\b|kubectl\s+(apply|rollout|"
                     r"set|delete)|helm\s+(upgrade|install)|(npm|pnpm|yarn)\s+(run\s+)?deploy|mbt\s+build|"
                     r"az\s+webapp\s+deploy|firebase\s+deploy)\b", re.I)
_TARGET = re.compile(r"cf\s+target", re.I)          # pointing cf at a production space
_PROD = re.compile(r"(?<![a-z])(prod|production|prd)(?![a-z])", re.I)
_GIT_WRITE = re.compile(r"\bgit\b(\s+-[cC]\s+\S+|\s+--?[\w.-]+(=\S+)?)*\s+(commit|rebase|merge|reset|checkout|switch|"
                        r"stash|cherry-pick|revert|am|push|pull|branch\s+-[dDmMfC])\b", re.I)
IMPLEMENT_ONLY = ("builder", "fixer")              # roles that leave git to the line and the merger
#: commands that never exit on their own (dev servers, watchers): in the foreground they hold the agent's whole
#: call until a tool timeout (finding 14: a one-line fix took 25.6 min). Allowed with run_in_background.
_LONG = re.compile(r"\b((npm|pnpm|yarn)(\s+run)?\s+(dev|start|serve|watch)\b|(npx\s+)?vite(\s+(dev|serve|preview))?(\s|$)(?!.*\bbuild\b)|"
                   r"next\s+(dev|start)\b|ng\s+serve\b|nodemon\b|webpack(-dev-server|\s+serve)\b|cds\s+(watch|serve|run)\b|"
                   r"python[\d.]*\s+-m\s+http\.server\b|flask\s+run\b|uvicorn\b|http-server\b|live-server\b|"
                   r"ui5\s+serve\b|\S+\s--watch(All)?\b(?!=false))", re.I)


def long_running(command: str, background: bool = False) -> str:
    """'' when the command ends on its own (or runs in the background), else why it is refused."""
    if background:
        return ""
    for seg in re.split(r"&&|\|\||;|\n", command or ""):
        m = _LONG.search(seg)
        if m:
            return ("'%s' does not exit on its own: in the foreground it holds your whole call. Run checks that exit "
                    "(the test command, a build), or start the server with run_in_background and stop it when done."
                    % m.group(0).strip())
    return ""


def _paths(arg_text: str) -> List[str]:
    try:
        parts = shlex.split(arg_text, posix=False)
    except ValueError:
        parts = arg_text.split()
    return [p.strip("'\"") for p in parts if p and not p.startswith("-") and not p.startswith("/s")]


def _outside(path: str, cwd: str) -> bool:
    if not path or path in (".", "./") or path.startswith("$") or path.startswith("%"):
        return False
    if path in ("/", "\\", "~", "*") or re.match(r"^[A-Za-z]:[\\/]?$", path) or path.startswith("~"):
        return True
    full = os.path.normcase(os.path.abspath(os.path.join(cwd, os.path.expandvars(path))))
    base = os.path.normcase(os.path.abspath(cwd))
    return not (full == base or full.startswith(base.rstrip("\\/") + os.sep))


def check(command: str, cwd: str, role: str = "") -> str:
    """'' when the command may run, else why not."""
    for seg in re.split(r"&&|\|\||;|\n", command or ""):
        m = _GIT_WRITE.search(seg) if (role or "").lower() in IMPLEMENT_ONLY else None
        if m:
            return ("git %s is not for builders: you only implement. The line commits your work and the merger "
                    "integrates it into main (read-only git such as status, diff and log is fine)." % m.group(3).split()[0])
        m = _PUSH.search(seg)
        if m:
            rest = m.group(1)
            refs = [a for a in rest.split() if not a.startswith("-")]
            if len(refs) < 2 or _PROTECTED.search(" " + " ".join(refs[1:]) + " "):
                return ("git push to main / master (or without a branch) is refused: the engine merges and delivers "
                        "the work. Commit on your branch and finish.")
        m = _RM.search(seg)
        if m:
            bad = [p for p in _paths(m.group(m.lastindex)) if _outside(p, cwd)]
            if bad:
                return "recursive delete outside the working folder is refused: %s" % ", ".join(bad[:3])
        if (_DEPLOY.search(seg) and _PROD.search(command)) or (_TARGET.search(seg) and _PROD.search(seg)):
            return "deploying to production is refused for agents: production deploys are done by people."
    return ""


def _hook_refusal(command: str) -> str:
    """Admin > Hooks, agent scope, event before_tool (line.hooks.tool_refusal) for this agent's role: the engine
    puts the role of the call in DLC_AGENT_ROLE. Never raises: a broken hook file lets the command run."""
    try:
        try:
            from line import hooks
        except ImportError:                     # run as a script (source checkout): line/ is not a package root
            sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            from line import hooks
        return hooks.tool_refusal(os.environ.get("DLC_AGENT_ROLE", ""), command)
    except Exception:   # noqa: BLE001
        return ""


def main() -> int:
    try:
        call = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return 0
    if call.get("tool_name") not in SHELL_TOOLS:
        return 0
    ti = call.get("tool_input") or {}
    command = str(ti.get("command") or "")
    why = check(command, str(call.get("cwd") or os.getcwd()), os.environ.get("DLC_AGENT_ROLE", "")) \
        or long_running(command, bool(ti.get("run_in_background"))) or _hook_refusal(command)
    if why:
        sys.stderr.write("DLC guard: " + why + "\n")
        return 2
    return 0


__all__ = ["check", "long_running", "main", "SHELL_TOOLS"]


if __name__ == "__main__":
    sys.exit(main())
