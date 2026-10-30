"""Shared helpers of the ship slice: git / subprocess wrappers, envelopes, gate rows."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .. import codes
from ..codes import LineError
from ..contracts import E_GATE, E_RUN, Envelope, Gate, now_ms, to_dict

#: identity used for commits the line itself makes (rebase), unless the env sets one
_GIT_IDENTITY = {
    "GIT_AUTHOR_NAME": "sdlc-line",
    "GIT_AUTHOR_EMAIL": "sdlc-line@localhost",
    "GIT_COMMITTER_NAME": "sdlc-line",
    "GIT_COMMITTER_EMAIL": "sdlc-line@localhost",
}

#: output kept in evidence / event bodies (chars, tail)
TAIL_CHARS = 4000


class SystemClock:
    def now_ms(self) -> int:
        return now_ms()


def tail(text: str, n: int = TAIL_CHARS) -> str:
    text = text or ""
    return text if len(text) <= n else "..." + text[-n:]


def child_env(extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
    env = dict(os.environ)
    for k, v in _GIT_IDENTITY.items():
        env.setdefault(k, v)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env["GIT_TERMINAL_PROMPT"] = "0"
    if extra:
        env.update(extra)
    return env


def git(repo: str, *args: str, check: bool = True, timeout: float = 120) -> subprocess.CompletedProcess:
    """Run git in ``repo``. check=True raises LineError(BUILD_FAIL) on a non-zero exit."""
    argv = ["git", "-c", "core.autocrlf=false", "-c", "advice.detachedHead=false", "-C", repo] + list(args)
    try:
        cp = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace",
                            env=child_env(), timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise LineError(codes.BUILD_FAIL, "git %s failed: %s" % (args[0] if args else "", e),
                        {"argv": argv[5:]}) from e
    if check and cp.returncode != 0:
        raise LineError(codes.BUILD_FAIL, "git %s exit %d" % (" ".join(args[:2]), cp.returncode),
                        {"argv": list(args), "stderr": tail(cp.stderr, 2000), "stdout": tail(cp.stdout, 2000)})
    return cp


def git_out(repo: str, *args: str) -> str:
    return git(repo, *args).stdout.strip()


def run_cmd(argv: Sequence[str], cwd: str, timeout: float = 900) -> Dict[str, Any]:
    """Run a command; never raises. -> {"ok", "code", "output"} (stdout+stderr, tail)."""
    try:
        cp = subprocess.run(list(argv), cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                            errors="replace", env=child_env(), timeout=timeout)
        return {"ok": cp.returncode == 0, "code": cp.returncode, "output": tail((cp.stdout or "") + (cp.stderr or ""))}
    except subprocess.TimeoutExpired as e:
        return {"ok": False, "code": -1, "output": "timeout after %ss: %s" % (timeout, tail(str(e.output or "")))}
    except OSError as e:
        return {"ok": False, "code": -1, "output": "cannot run %r: %s" % (list(argv), e)}


def python_argv(*args: str) -> List[str]:
    from ..runtime import python_exe
    return [python_exe()] + list(args)


def run_env(store: Any, cfg: Any, run: str, unit: str = "", attempt: int = 0, model: str = "") -> Envelope:
    """Envelope for events the ship slice writes. epoch 0: these are server-side writes, not lease holders."""
    row = store.get(E_RUN, run) or {}
    return Envelope(run=run, unit=unit, attempt=int(attempt or 0), epoch=0,
                    agent_version=str(getattr(cfg, "agent_version", "") or ""), model=model,
                    spec_hash=str(row.get("spec_hash", "") or ""))


def put_gate(store: Any, run: str, unit: str, attempt: int, name: str, gate: Gate) -> str:
    """Record a gate verdict (E_GATE row) so the board shows it. Returns the row id."""
    base = "%s:%s:%s" % (run, unit or "-", name)
    n = 1
    while store.version(E_GATE, "%s:%d" % (base, n)):
        n += 1
    gid = "%s:%d" % (base, n)
    store.put(E_GATE, gid, {"id": gid, "run": run, "gate": to_dict(gate), "unit": unit, "attempt": int(attempt or 0),
                            "name": name}, run=run)
    return gid
