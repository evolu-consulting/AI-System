"""Calling an agent's model. A trimmed copy of RITA's provider layer (RITA/llm.py:
PROVIDERS['claude-cli'], cli_env, cli_argv, call_cli, read_cli_output) with two
additions the SDLC engine needs: `--resume <session_id>` and the session id
handed back from Claude's JSON output.

One subprocess per turn, prompt on stdin, CREATE_NO_WINDOW so a hidden server
never pops a console per call.

TOKENS ARE READ WHILE THE TURN RUNS. The CLI is called with
`--output-format stream-json --verbose`, one JSON event per line. Every
assistant event carries that API message's usage, so UsageMeter keeps the
newest usage per message id (the CLI repeats it once per content block) and
the caller's `on_usage` sees a running total priced from pricing.json. The
closing `result` event then replaces the estimate with the CLI's own figures:
modelUsage per model and total_cost_usd.
"""

import json
import os
import shutil
import subprocess
import threading

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

#: Variables a Claude Code session puts in its environment. A child `claude`
#: that inherits them believes it is nested inside that session; the same list
#: RITA's launcher strips.
SESSION_VARS = [
    "CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_SESSION_ID", "CLAUDE_EFFORT", "CLAUDE_PID",
]

#: The provider catalogue. A new LLM type is a new entry here, not an engine edit.
PROVIDERS = {
    "claude-cli": {
        "name": "Claude CLI",
        "command": "claude",
        "base": ["-p", "--output-format", "stream-json", "--verbose"],
        "defaultArgs": ["--setting-sources", "project", "--dangerously-skip-permissions"],
        "modelArg": "--model",
        "dirArg": "--add-dir",
        "resumeArg": "--resume",
        "tokenEnv": "CLAUDE_CODE_OAUTH_TOKEN",
        "jsonField": "result",
        "models": [
            {"id": "opus", "label": "Opus 5.5"},
            {"id": "sonnet", "label": "Sonnet 5.5"},
            {"id": "haiku", "label": "Haiku 4.5"},
            {"id": "fable", "label": "Fable 5.1"},
        ],
    },
}


def catalogue():
    return [{"id": pid, "name": p["name"], "models": p["models"], "defaultArgs": p["defaultArgs"],
             "tokenEnv": p["tokenEnv"]} for pid, p in PROVIDERS.items()]


def which(command):
    if os.path.isabs(command):
        return command if os.path.isfile(command) else None
    return shutil.which(command)


def cli_env(extra):
    env = dict(os.environ)
    for name in SESSION_VARS:
        env.pop(name, None)
    env["PYTHONIOENCODING"] = "utf-8"
    for name, value in (extra or {}).items():
        env[name] = str(value)
    return env


# ---------------------------------------------------------------- usage

PRICING_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pricing.json")
_pricing = None


def pricing():
    global _pricing
    if _pricing is None:
        try:
            with open(PRICING_FILE, encoding="utf-8") as f:
                _pricing = json.load(f)
        except (OSError, ValueError):
            _pricing = {"models": {}, "aliases": {}}
    return _pricing


def price_of(model):
    """The price row for a model id or alias: the longest key the id starts with."""
    cat = pricing()
    mid = str(model or "").lower()
    mid = cat.get("aliases", {}).get(mid, mid)
    best = None
    for key in cat.get("models", {}):
        if mid.startswith(key) and (best is None or len(key) > len(best)):
            best = key
    return cat["models"][best] if best else None


def estimate(model, u):
    """USD for one usage dict in the Messages API shape; 0 for a model with no price row."""
    p = price_of(model)
    if not p:
        return 0.0
    w1h = int((u.get("cache_creation") or {}).get("ephemeral_1h_input_tokens") or 0)
    w5m = max(int(u.get("cache_creation_input_tokens") or 0) - w1h, 0)
    return (int(u.get("input_tokens") or 0) * p["input"] + int(u.get("output_tokens") or 0) * p["output"]
            + w5m * p["cacheWrite5m"] + w1h * p["cacheWrite1h"]
            + int(u.get("cache_read_input_tokens") or 0) * p["cacheRead"]) / 1e6


class UsageMeter:
    """Running token and cost totals of one CLI call, fed one stream-json event at a time."""

    def __init__(self, model=None):
        self.model = model
        self.by_msg = {}
        self.final = None

    def feed(self, event):
        """Returns True when the totals changed."""
        kind = event.get("type")
        if kind == "assistant":
            msg = event.get("message") or {}
            u = msg.get("usage")
            if not isinstance(u, dict):
                return False
            self.by_msg[msg.get("id") or len(self.by_msg)] = (msg.get("model") or self.model, u)
            return True
        if kind == "result" and event.get("modelUsage"):
            models = event["modelUsage"]
            tot = {"input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0}
            for m in models.values():
                tot["input"] += int(m.get("inputTokens") or 0)
                tot["output"] += int(m.get("outputTokens") or 0)
                tot["cacheWrite"] += int(m.get("cacheCreationInputTokens") or 0)
                tot["cacheRead"] += int(m.get("cacheReadInputTokens") or 0)
            cost = event.get("total_cost_usd")
            if cost is None:
                cost = sum(float(m.get("costUSD") or 0) for m in models.values())
            tot["costUsd"] = float(cost)
            tot["model"] = ",".join(sorted(models))
            self.final = tot
            return True
        return False

    def totals(self):
        if self.final:
            return dict(self.final, final=True)
        tot = {"input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0, "costUsd": 0.0}
        models = set()
        for model, u in self.by_msg.values():
            tot["input"] += int(u.get("input_tokens") or 0)
            tot["output"] += int(u.get("output_tokens") or 0)
            tot["cacheWrite"] += int(u.get("cache_creation_input_tokens") or 0)
            tot["cacheRead"] += int(u.get("cache_read_input_tokens") or 0)
            tot["costUsd"] += estimate(model, u)
            if model:
                models.add(model)
        tot["model"] = ",".join(sorted(models)) or (self.model or "")
        tot["final"] = False
        return tot


# ---------------------------------------------------------------- call

def call(llm_type, model, args, env, prompt, cwd, add_dirs=(), resume=None, timeout=900, on_usage=None):
    """Run one turn. Returns (text, session_id, error). error is None on success.

    on_usage(totals) runs on this thread each time the running token totals
    change, and once more with final=True from the CLI's result event.
    """
    spec = PROVIDERS.get(llm_type)
    if not spec:
        return "", None, "unknown LLM type " + str(llm_type)
    found = which(spec["command"])
    if not found:
        return "", None, spec["name"] + " is not installed"
    argv = [found] if not found.lower().endswith((".cmd", ".bat")) else [os.environ.get("COMSPEC", "cmd.exe"), "/c", found]
    argv += list(spec["base"]) + list(args or [])
    for d in add_dirs or []:
        if d and os.path.isdir(d):
            argv += [spec["dirArg"], d]
    if model:
        argv += [spec["modelArg"], model]
    if resume:
        argv += [spec["resumeArg"], resume]
    if cwd and not os.path.isdir(cwd):
        cwd = None
    try:
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace", env=cli_env(env), cwd=cwd,
                                creationflags=NO_WINDOW)
    except OSError as exc:
        return "", None, "could not run %s: %s" % (spec["name"], exc)
    err_lines, stray = [], []
    killed = threading.Event()

    def drain_stderr():
        for line in proc.stderr:
            if len(err_lines) < 200:
                err_lines.append(line)

    def kill():
        killed.set()
        proc.kill()

    threading.Thread(target=drain_stderr, daemon=True).start()
    timer = threading.Timer(timeout, kill)
    timer.start()
    meter = UsageMeter(model)
    parsed = None
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
                # Hooks can print plain text between the events.
                if len(stray) < 50:
                    stray.append(line)
                continue
            if not isinstance(event, dict):
                continue
            if meter.feed(event) and on_usage:
                try:
                    on_usage(meter.totals())
                except Exception:  # noqa: BLE001 - metering must never break a turn
                    pass
            if event.get("type") == "result":
                parsed = event
        proc.wait()
    finally:
        timer.cancel()
    if killed.is_set():
        return "", None, "%s did not answer within %ds" % (spec["name"], timeout)
    if not isinstance(parsed, dict):
        detail = ("".join(err_lines) or "\n".join(stray)).strip()[:800]
        return "", None, "%s exited %s without JSON: %s" % (spec["name"], proc.returncode, detail)
    sid = parsed.get("session_id")
    if parsed.get("is_error"):
        return "", sid, "%s reported an error: %s" % (spec["name"], str(parsed.get(spec["jsonField"]) or parsed.get("subtype") or "")[:400])
    text = parsed.get(spec["jsonField"])
    if not isinstance(text, str):
        return "", sid, "%s answered JSON with no '%s'" % (spec["name"], spec["jsonField"])
    return text.strip(), sid, None
