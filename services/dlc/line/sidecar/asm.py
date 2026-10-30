"""Bridge to the App Session Manager of the machine the engine runs on (the person's own vault of signed-in
web-app sessions, also used by their Claude Code sessions).

The person chose to let DLC agents borrow those sessions instead of re-entering accounts in DLC Autologin.
The engine runs `AppSessionManager.exe mcp` (stdio MCP) for each call and asks it what an assistant would:
list_apps, get_session(app) (it signs in with the account stored for that app, never handing out a secret;
entries marked for confirmation, such as production, show the person a Windows popup first) and
cf_login(app, org, space). get_session answers with the Chrome debug port of the signed-in tab; the agent's
page tools (open_page, fetch, run_js) then drive that tab over CDP (line.sidecar.cdp), like DLC Autologin's own.

LINE_ASM: auto (on when the program is installed) | 1 | 0. LINE_ASM_EXE: the program's path.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Any, Dict, Optional

DEFAULT_EXE = r"C:\Programs\ClaudeKH\tools\auto_login\AppSessionManager.exe"
CALL_TIMEOUT_S = 300            # get_session waits up to 4 minutes for the person's popup answer
_PORT = re.compile(r"debug port (\d+)", re.I)


def exe() -> str:
    return os.environ.get("LINE_ASM_EXE", "").strip() or DEFAULT_EXE


def enabled() -> bool:
    mode = os.environ.get("LINE_ASM", "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    return os.path.isfile(exe())


def _rpc(tool: str, arguments: Dict[str, Any], run: Any = None, timeout: float = CALL_TIMEOUT_S) -> str:
    """One tools/call on a fresh `AppSessionManager.exe mcp` -> the text of its answer."""
    msgs = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "dlc", "version": "1"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": arguments}},
    ]
    stdin = "".join(json.dumps(m) + "\n" for m in msgs)
    try:
        cp = (run or subprocess.run)([exe(), "mcp"], input=stdin, capture_output=True, text=True, encoding="utf-8",
                                     errors="replace", timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        raise ValueError("App Session Manager did not run: %s" % e)
    for line in (cp.stdout or "").splitlines():
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if m.get("id") != 2:
            continue
        if m.get("error"):
            raise ValueError("App Session Manager: %s" % (m["error"].get("message") or m["error"]))
        res = m.get("result") or {}
        text = "\n".join(c.get("text", "") for c in res.get("content") or [] if c.get("type") == "text")
        if res.get("isError"):
            raise ValueError(text or "App Session Manager refused the call")
        return text
    raise ValueError("App Session Manager gave no answer (exit %s): %s" % (cp.returncode, (cp.stderr or "")[-300:]))


def list_apps(run: Any = None) -> str:
    return _rpc("list_apps", {}, run)


def get_session(app: str, run: Any = None) -> Dict[str, Any]:
    """{"text", "port"} (port None when not signed in, or the person said no: text starts with DENIED)."""
    text = _rpc("get_session", {"app": app}, run)
    m = _PORT.search(text)
    signed = text.lower().startswith("signed in") and m is not None
    return {"text": text, "port": int(m.group(1)) if signed else None}


def cf_login(app: str, org: str = "", space: str = "", run: Any = None) -> str:
    args: Dict[str, Any] = {"app": app}
    if org:
        args["org"] = org
    if space:
        args["space"] = space
    return _rpc("cf_login", args, run)


def cli_login(app: str, run: Any = None) -> str:
    """A cli entry of the App Session Manager (1.10+): it runs the entry's sign-in command on this machine."""
    return _rpc("cli_login", {"app": app}, run)


__all__ = ["enabled", "exe", "list_apps", "get_session", "cf_login", "cli_login", "DEFAULT_EXE"]
