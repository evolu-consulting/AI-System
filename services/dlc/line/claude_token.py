"""The Claude setup-token the engine's agents sign in with, settable by an admin from the frontend.

The token lives in one file, DLC_HOME/secrets/claude-token (on Windows its ACL keeps only SYSTEM and
Administrators; elsewhere mode 600). The CLI backend reads it at every call (line.llm.cli.child_env), so a
new token is used by the next agent call without restarting the service; with no file the service's own
CLAUDE_CODE_OAUTH_TOKEN (set by the deploy kit) stays in force. A token is saved only after a real
`claude -p` call with it answered.

GET  /api/admin/claude-token                 {"source": "file" | "service" | "none", "hint", "set_ms", "set_by",
                                              "rejected": {"ms", "message"} | null}
POST /api/admin/claude-token {"token"}       test it, then save it -> the same status

Use a `claude setup-token` token (valid about a year). The access token in a person's own Claude profile is a
short-lived OAuth token (about 8 hours) that dies when that profile refreshes it. When Claude refuses the token
(revoked, expired, failed to authenticate) an agent call fails with LLM_ERROR whose message starts with REJECTED
(rejected() spots it), and status() shows that refusal until a new token is saved.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from typing import Any, Dict, Optional

from . import codes
from .codes import LineError
from .contracts import now_ms

ENV = "CLAUDE_CODE_OAUTH_TOKEN"
_SHAPE = re.compile(r"^sk-ant-oat01-[A-Za-z0-9_-]{20,}$")
REJECTED = "Claude token rejected: set a new long-lived token (claude setup-token) in Admin > Claude token"
_REFUSED = re.compile(r"oauth token (has been )?revoked|token (has )?expired|failed to authenticate|"
                      r"authentication_error|invalid (api key|bearer token)", re.I)
_last_rejected: Dict[str, Any] = {}       # the last refusal an agent call met (this process; cleared by save)


def rejected(text: str) -> bool:
    """Does this Claude CLI output say the token was refused (revoked, expired, not authenticated)?"""
    return bool(_REFUSED.search(text or ""))


def note_rejected(message: str) -> str:
    """An agent call met a refused token: remember it for status() -> the message with REJECTED in front."""
    _last_rejected.update(ms=now_ms(), message=str(message or "")[:300])
    return "%s. %s" % (REJECTED, message)


def _home() -> str:
    return os.environ.get("DLC_HOME", "").strip() or os.path.join(os.path.expanduser("~"), "dlc")


def path() -> str:
    return os.path.join(_home(), "secrets", "claude-token")


def read() -> str:
    """The token set from the frontend ('' = none; the service environment applies)."""
    try:
        with open(path(), encoding="utf-8") as fh:
            return (json.load(fh).get("token") or "").strip()
    except (OSError, ValueError, AttributeError):
        return ""


def _hint(tok: str) -> str:
    return tok[:13] + "..." + tok[-4:] if tok else ""


def status() -> Dict[str, Any]:
    try:
        with open(path(), encoding="utf-8") as fh:
            d = json.load(fh)
        if d.get("token"):
            return {"source": "file", "hint": _hint(d["token"]), "set_ms": d.get("set_ms", 0),
                    "set_by": d.get("set_by", ""), "rejected": _rejected_since(int(d.get("set_ms") or 0))}
    except (OSError, ValueError, AttributeError):
        pass
    svc = os.environ.get(ENV, "")
    return {"source": "service" if svc else "none", "hint": _hint(svc), "set_ms": 0, "set_by": "",
            "rejected": _rejected_since(0)}


def _rejected_since(set_ms: int) -> Optional[Dict[str, Any]]:
    """The last refusal of the token in use (one met before the token was saved belongs to an older one)."""
    if int(_last_rejected.get("ms") or 0) <= set_ms:
        return None
    return dict(_last_rejected)


def _lock_down(p: str) -> None:
    if os.name == "nt":   # only SYSTEM, Administrators and the account the engine runs as (LocalSystem as a service)
        me = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True,
                            timeout=30).stdout.strip().split(",")[-1].strip('"')
        grants = ["*S-1-5-18:F", "*S-1-5-32-544:F"] + (["*%s:F" % me] if me.startswith("S-1-") else [])
        subprocess.run(["icacls", p, "/inheritance:r", "/grant:r"] + grants, capture_output=True, timeout=30)
    else:
        os.chmod(p, 0o600)


def _probe(tok: str, run: Optional[Any] = None) -> str:
    """'' when `claude -p` answers with this token, else why not."""
    from .llm.cli import child_env, sdlc_llm
    exe = sdlc_llm.which("claude")
    if not exe:
        return "Claude CLI is not installed on the engine host"
    env = dict(child_env(), **{ENV: tok})
    try:
        cp = (run or subprocess.run)([exe, "-p", "Reply with the single word: ready"], capture_output=True, text=True,
                                     encoding="utf-8", errors="replace", env=env, timeout=120,
                                     creationflags=getattr(sdlc_llm, "NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError) as e:
        return "Claude CLI did not run: %s" % e
    if cp.returncode != 0 or "ready" not in (cp.stdout or "").lower():
        out = ((cp.stdout or "") + (cp.stderr or "")).replace(tok, "***").strip()
        return "Claude did not accept the token: %s" % (out[-300:] or "exit %d" % cp.returncode)
    return ""


def save(body: Dict[str, Any], actor: str = "", run: Optional[Any] = None) -> Dict[str, Any]:
    tok = str(body.get("token") or "").strip()
    if not _SHAPE.match(tok):
        raise ValueError("a setup-token looks like sk-ant-oat01-... (run 'claude setup-token' to make one)")
    why = _probe(tok, run)
    if why:
        raise LineError(codes.STATE_CONFLICT, why, {})
    p = path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"token": tok, "set_ms": now_ms(), "set_by": actor}, fh)
    _lock_down(tmp)
    os.replace(tmp, p)
    _last_rejected.clear()
    return status()


__all__ = ["read", "status", "save", "path", "ENV", "REJECTED", "rejected", "note_rejected"]
