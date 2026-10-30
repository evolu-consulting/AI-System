"""Backend over the Claude Code CLI (`claude -p`), one subprocess per call.

Reuses Slaves/SDLC/llm.py (loaded by path, never modified): cli_env() for the child
environment, UsageMeter for stream-json usage/cost, which() and NO_WINDOW. The run
loop is local because the line needs three things llm.call() does not give: a
scrubbed environment (no secrets reach the agent), the agentic flags below, and
the result subtype (max turns / budget stop become BLOCKED, not errors).

agentic argv:  claude -p --output-format stream-json --verbose --model <LINE_MODEL>
               --permission-mode acceptEdits
               --allowedTools "Read Edit Write Bash(python -m unittest*)"
               --max-turns <n> --max-budget-usd <ceiling>
               --setting-sources project --strict-mcp-config
               cwd = workdir, prompt on stdin.
complete argv: same base, --max-turns 1, --tools "" (no tools); cwd = LINE_WORKROOT.
outcome:       last non-empty line of the final message: "SUBMIT" or "BLOCKED:<reason>";
               anything else -> "BLOCKED:no_outcome".
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .. import codes, stacks
from ..codes import LineError
from ..config import SDLC_DIR
from ..contracts import LlmResult

ALLOWED_TOOLS = "Read Edit Write Bash(python -m unittest*)"
#: what an agent gets by default: the whole Claude Code tool set, like a person's own session; the PreToolUse
#: guard (line.agent_guard) refuses push to main, deletes outside the work folder and production deploys.
#: LINE_AGENT_TOOLS=narrow goes back to the old allow-list (unit tests only).
FULL_TOOLS = "Bash PowerShell Read Edit Write Glob Grep WebFetch WebSearch Task TodoWrite NotebookEdit"
#: roles with their own tool set instead of FULL_TOOLS (their dlc mcp tools are added as usual). Every tool's
#: definition is re-sent on each turn of the call: builders and fixers implement in their folder (the spec analyst
#: already read the links), so web, sub-agent and notebook tools only make each turn heavier.
CODE_TOOLS = "Bash PowerShell Read Edit Write Glob Grep"
#: the solo agent (line.solo) does the whole request like a person's session: code tools, a todo list, and the web for
#: a library's docs; no sub-agents (each one is a fresh, uncached context)
ROLE_TOOLS = {"change_sizer": "Read Glob Grep", "builder": CODE_TOOLS, "fixer": CODE_TOOLS,
              "solo": CODE_TOOLS + " TodoWrite WebFetch", "solo_lead": CODE_TOOLS + " TodoWrite WebFetch Task",
              "solo_reviewer": "Read Glob Grep",
              "test_arbiter": CODE_TOOLS, "test_repairer": CODE_TOOLS}
PERMISSION_MODE = "acceptEdits"
BASE_ARGS = ["-p", "--output-format", "stream-json", "--verbose"]
ISOLATION_ARGS = ["--setting-sources", "project", "--strict-mcp-config"]
COMPLETE_TIMEOUT_S = 900
AGENTIC_TIMEOUT_S = 3600

#: Variables never passed to the agent: anything that looks like a credential.
SECRET_RE = re.compile(r"(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|"
                       r"^LINE_RAG_CLIENT_)", re.I)
#: The CLI's own sign-in, which it needs to run at all.
KEEP_ENV = frozenset({"CLAUDE_CODE_OAUTH_TOKEN"})


def _load_sdlc_llm() -> Any:
    name = "_sdlc_llm_for_line"
    mod = sys.modules.get(name)
    if mod is None and getattr(sys, "frozen", False):
        mod = __import__("llm")      # the built app bundles it as a frozen module
        sys.modules[name] = mod
    if mod is None:
        spec = importlib.util.spec_from_file_location(name, os.path.join(SDLC_DIR, "llm.py"))
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        sys.modules[name] = mod
    return mod


sdlc_llm = _load_sdlc_llm()


def console_exe() -> str:
    """The console build of the app (dlc.exe): stdio servers and hooks need its stdin / stdout, also when the
    engine itself runs as the windowless dlcw.exe (scheduled-task mode)."""
    here = os.path.dirname(sys.executable)
    for name in ("dlc.exe", "dlc"):
        p = os.path.join(here, name)
        if os.path.isfile(p):
            return p
    return sys.executable


def scrub_env(env: Mapping[str, str]) -> Dict[str, str]:
    return {k: v for k, v in env.items() if k in KEEP_ENV or not SECRET_RE.search(k)}


def child_env() -> Dict[str, str]:
    """llm.cli_env() (session variables stripped, utf-8 stdio) minus secrets; the setup-token an admin set
    from the frontend (line.claude_token) wins over the service's own."""
    from .. import claude_token
    env = scrub_env(sdlc_llm.cli_env({}))
    tok = claude_token.read()
    if tok:
        env[claude_token.ENV] = tok
    return env


def command_timeouts(cfg: Any = None) -> Dict[str, str]:
    """Claude Code's own limit on one Bash command (default and the most a command may ask for): a dev server or a
    watcher started in the foreground ends there instead of holding the whole call (finding 14)."""
    s = int(getattr(cfg, "agent_cmd_timeout_s", 300) or 0)
    if s <= 0:
        return {}
    ms = s * 1000
    return {"BASH_DEFAULT_TIMEOUT_MS": str(min(ms, 120_000)), "BASH_MAX_TIMEOUT_MS": str(ms)}


def with_hooks(role: str, prompt: str, cfg: Any = None, agentic: bool = False) -> str:
    """The prompt plus the standing instructions of Admin > Hooks (agent scope, agent_start) for this role and,
    for an agentic call, the working memory's kernel and turn context (line.agent_memory); a one-shot call of a
    role that writes content (test author, planner, reviewer, judge) gets the lessons and findings near its task."""
    from .. import agent_memory, hooks
    extra = hooks.agent_instructions(role)
    if agentic and cfg is not None:
        extra += agent_memory.turn_context(cfg, role, prompt[:1500])
    elif cfg is not None:
        extra += agent_memory.lessons_block(cfg, role, prompt[:1500])
    return prompt + extra if extra else prompt


def kill_tree(proc: Any) -> None:
    """Kill a CLI call with its children (on Windows a .cmd shim or launcher leaves the real
    process holding the pipes when only the parent dies)."""
    try:
        if os.name == "nt" and getattr(proc, "pid", None):
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30, creationflags=sdlc_llm.NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        proc.kill()
    except OSError:
        pass


def cli_error(message: str, detail: Dict[str, Any]) -> LineError:
    """LineError(LLM_ERROR) of a failed Claude CLI call; a refused token (revoked, expired) says what to do."""
    from .. import claude_token
    if claude_token.rejected(message):
        return LineError(codes.LLM_ERROR, claude_token.note_rejected(message), dict(detail, token_rejected=True))
    return LineError(codes.LLM_ERROR, message, detail)


def parse_outcome(text: str) -> str:
    lines = [ln.strip().strip("*`").strip() for ln in (text or "").splitlines() if ln.strip()]
    last = lines[-1] if lines else ""
    if last == "SUBMIT":
        return "SUBMIT"
    if last.startswith("BLOCKED:") and len(last) > len("BLOCKED:"):
        return last
    return "BLOCKED:no_outcome"


class CliBackend:
    name = "cli"
    overhead_tokens = 20000          # Claude Code system prompt + tool definitions

    def __init__(self, config: Any = None, command: Optional[str] = None):
        self.config = config
        self.command = command
        self._procs: set = set()
        self._plock = threading.Lock()
        self._cancelled = False

    def cancel(self) -> None:
        """Kill every call in flight and refuse new ones (the run was cancelled)."""
        with self._plock:
            self._cancelled = True
            procs = list(self._procs)
        for p in procs:
            kill_tree(p)

    # ---------------------------------------------------------- argv

    def executable(self) -> List[str]:
        found = self.command or sdlc_llm.which("claude")
        if not found:
            raise LineError(codes.LLM_ERROR, "Claude CLI is not installed (claude not on PATH)", {})
        if found.lower().endswith((".cmd", ".bat")):
            return [os.environ.get("COMSPEC", "cmd.exe"), "/c", found]
        return [found]

    def complete_argv(self, model: str) -> List[str]:
        # no tools at all: a one-turn answer must not try to write files (that ends in error_max_turns)
        return (self.executable() + BASE_ARGS + ["--model", model, "--max-turns", "1", "--tools", ""]
                + ISOLATION_ARGS)

    def agentic_argv(self, model: str, max_turns: int, usd_cap: float, allowed_tools: str = "",
                     mcp_config: str = "", mcp_tools: Optional[List[str]] = None, settings: str = "") -> List[str]:
        tools = allowed_tools or ALLOWED_TOOLS
        if mcp_tools:
            tools += " " + " ".join("mcp__dlc__" + t for t in mcp_tools)
        argv = self.executable() + BASE_ARGS + [
            "--model", model, "--permission-mode", PERMISSION_MODE, "--allowedTools", tools,
            "--max-turns", str(max(int(max_turns), 1))]
        if usd_cap and usd_cap > 0:
            argv += ["--max-budget-usd", "%.4f" % usd_cap]
        if mcp_config:
            argv += ["--mcp-config", mcp_config]
        if settings:
            argv += ["--settings", settings]
        return argv + ISOLATION_ARGS

    @staticmethod
    def guard_settings() -> str:
        """The settings file every agent call gets: the PreToolUse guard on its shell commands."""
        from ..runtime import frozen
        if frozen():
            cmd = '"%s" hook guard' % console_exe()
        else:
            cmd = '"%s" "%s"' % (sys.executable, os.path.join(SDLC_DIR, "line", "agent_guard.py"))
        home = os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")
        path = os.path.join(home, "agent-settings.json")
        doc = {"hooks": {"PreToolUse": [{"matcher": "Bash|PowerShell", "hooks": [{"type": "command", "command": cmd}]}]}}
        text = json.dumps(doc, indent=1)
        try:
            with open(path, encoding="utf-8") as fh:
                if fh.read() == text:
                    return path
        except OSError:
            pass
        os.makedirs(home, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        return path

    def _agent_mcp(self, role: str) -> Optional[Tuple[str, List[str], str]]:
        """The `dlc mcp` server for this agent call (line.agent_tools): (config file, tool names, token), or None
        when no engine server is running in this process (a plain `dlc run`)."""
        from .. import agent_tools
        from ..runtime import frozen
        ctx = agent_tools.CURRENT.get() or {}
        if not agent_tools.ENGINE_URL:
            return None
        extra = dict(getattr(self.config, "rag_extra", None) or {})
        tools = agent_tools.tools_for(role)
        tok = agent_tools.issue(str(ctx.get("run") or ""), role, str(extra.get("project") or ""),
                                str(extra.get("shared_project") or ""))
        if frozen():
            command, args, env = console_exe(), ["mcp"], {}
        else:
            command, args = sys.executable, ["-m", "line.app_main", "mcp"]
            env = {"PYTHONPATH": SDLC_DIR}
        env.update(DLC_AGENT_URL=agent_tools.ENGINE_URL, DLC_AGENT_TOKEN=tok, DLC_AGENT_TOOLS=",".join(tools),
                   PYTHONIOENCODING="utf-8")
        home = os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")
        folder = os.path.join(home, "agent-mcp")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "mcp-%s.json" % tok[:12])
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"mcpServers": {"dlc": {"type": "stdio", "command": command, "args": args, "env": env}}}, fh)
        return path, tools, tok

    # ---------------------------------------------------------- run

    def _run(self, argv: List[str], prompt: str, cwd: str, model: str, timeout: int,
             role: str = "") -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """-> (result event, usage totals). Raises LineError(LLM_ERROR) with usd/usage detail."""
        if self._cancelled:
            raise LineError(codes.CANCELLED, "run cancelled: no new model call", {})
        env = child_env()
        env["DLC_AGENT_ROLE"] = role or ""          # the guard hook applies Admin > Hooks per role
        env.update(command_timeouts(self.config))
        try:
            proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding="utf-8", errors="replace", env=env, cwd=cwd,
                                    creationflags=sdlc_llm.NO_WINDOW)
        except OSError as e:
            raise LineError(codes.LLM_ERROR, "could not run Claude CLI: %s" % e, {"argv0": argv[0]}) from e
        from ..procjob import Job
        job = Job.attach(proc)                      # whatever the call starts ends with it (finding 14)
        with self._plock:
            self._procs.add(proc)
            if self._cancelled:
                kill_tree(proc)
        err_lines: List[str] = []
        stray: List[str] = []
        killed = threading.Event()

        def drain() -> None:
            for line in proc.stderr:
                if len(err_lines) < 200:
                    err_lines.append(line)

        def kill() -> None:
            killed.set()
            kill_tree(proc)

        threading.Thread(target=drain, daemon=True).start()
        timer = threading.Timer(timeout, kill)
        timer.start()
        meter = sdlc_llm.UsageMeter(model)
        result: Optional[Dict[str, Any]] = None
        try:
            try:
                proc.stdin.write(prompt)
                proc.stdin.close()
            except OSError:
                pass
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    if len(stray) < 50:
                        stray.append(line)
                    continue
                if not isinstance(event, dict):
                    continue
                meter.feed(event)
                if event.get("type") == "result":
                    result = event
            proc.wait()
        finally:
            timer.cancel()
            with self._plock:
                self._procs.discard(proc)
            orphans = job.close() if job is not None else 0
            if orphans:
                sys.stderr.write("dlc: %s call left %d process(es) running; ended with the call\n"
                                 % (role or "agent", orphans))
        tot = meter.totals()
        usage = {k: int(tot.get(k) or 0) for k in ("input", "output", "cacheWrite", "cacheRead")}
        spent = {"usd": float(tot.get("costUsd") or 0.0), "usage": usage}
        if self._cancelled:
            raise LineError(codes.CANCELLED, "run cancelled: Claude CLI call killed", dict(spent))
        if killed.is_set():
            raise LineError(codes.LLM_ERROR, "Claude CLI did not answer within %ds" % timeout, dict(spent, timeout=timeout))
        if result is None:
            detail = ("".join(err_lines) or "\n".join(stray)).strip()[:800]
            raise cli_error("Claude CLI exited %s without a result: %s" % (proc.returncode, detail),
                            dict(spent, returncode=proc.returncode))
        return result, dict(spent, model=tot.get("model") or model)

    def raw_complete(self, role: str, prompt: str, model: str, key: str, repair: bool = False) -> LlmResult:
        cwd = getattr(self.config, "workroot", "") or os.getcwd()
        os.makedirs(cwd, exist_ok=True)
        result, spent = self._run(self.complete_argv(model), with_hooks(role, prompt, self.config), cwd, model,
                                  COMPLETE_TIMEOUT_S,
                                  role)
        text = result.get("result")
        if result.get("is_error") or not isinstance(text, str):
            raise cli_error("Claude CLI error (%s): %s" % (result.get("subtype"), str(text or "")[:400]),
                            dict(usd=spent["usd"], usage=spent["usage"], role=role, key=key))
        return LlmResult(None, text.strip(), spent["usage"], spent["usd"], model, "")

    def raw_agentic(self, role: str, workdir: str, prompt: str, model: str, max_turns: int,
                    usd_cap: float, key: str) -> LlmResult:
        if not workdir or not os.path.isdir(workdir):
            raise LineError(codes.LLM_ERROR, "agentic workdir does not exist: %r" % (workdir,),
                            {"workdir": workdir, "role": role, "key": key})
        if role in ROLE_TOOLS:                      # a role that only looks (the change sizer): no shell, no edits
            tools = ROLE_TOOLS[role]
        elif os.environ.get("LINE_AGENT_TOOLS", "").strip().lower() == "narrow":
            # the old allow-list: the target stack decides which test commands the builder may run
            st = stacks.for_repo(workdir)
            tools = "" if st.is_python else st.allowed_tools
        else:
            tools = FULL_TOOLS
        mcp = self._agent_mcp(role)
        try:
            argv = self.agentic_argv(model, max_turns, usd_cap, tools, *(mcp[:2] if mcp else ("", None)),
                                     settings=self.guard_settings())
            result, spent = self._run(argv, with_hooks(role, prompt, self.config, agentic=bool(mcp)), workdir, model,
                                      AGENTIC_TIMEOUT_S, role)
        finally:
            if mcp:
                from .. import agent_tools
                agent_tools.revoke(mcp[2])
                try:
                    os.remove(mcp[0])
                except OSError:
                    pass
        text = result.get("result") if isinstance(result.get("result"), str) else ""
        subtype = str(result.get("subtype") or "")
        if "max_turns" in subtype:
            outcome = "BLOCKED:max_turns"
        elif "budget" in subtype:
            outcome = "BLOCKED:budget"
        elif result.get("is_error"):
            raise cli_error("Claude CLI error (%s): %s" % (subtype, (text or "")[:400]),
                            dict(usd=spent["usd"], usage=spent["usage"], role=role, key=key))
        else:
            outcome = parse_outcome(text)
        if mcp:                                   # the call's worklog in the project's memory (line.agent_memory)
            from .. import agent_memory, agent_tools
            agent_memory.call_worklog(self.config, role, str((agent_tools.CURRENT.get() or {}).get("run") or ""),
                                      key, outcome, text, spent["usd"], tok=mcp[2])
        return LlmResult(None, (text or "").strip(), spent["usage"], spent["usd"], model, outcome)
