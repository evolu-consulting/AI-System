"""Which CLI owns a helper HOME, and whether the process asking now is that CLI.

A sign-in belongs to the CLI profile where the person made it. On 2026-09-26 a Grok CLI that read the
guide ran the helper inside ~/.claude and used Claude Code's live sign-in without logging in. This
module is the lock on that door: every read of the stored sign-in goes through check().

HOW THE CALLER IS IDENTIFIED
  Claude Code starts its tools, hooks and MCP servers with CLAUDECODE=1, CLAUDE_CONFIG_DIR (when set)
  and CLAUDE_PID. The environment alone can be copied, so the caller counts as Claude Code only when
  CLAUDE_PID is also one of this process's ancestors. Any other caller is "other".

WHO OWNS A HOME
  Recorded in helper.json at sign-in ({"cli", "profile"}). A HOME signed in before 1.4.0 has no record;
  it is treated as Claude Code's when its parent folder is named .claude*, which is where the guide
  put every install until then.

THE RULES
  * A Claude Code HOME answers only Claude Code running with that same profile.
  * Any other HOME never answers Claude Code: Claude uses its own sign-in, not another CLI's.
  * Signing out is always allowed: it only takes access away.

LIMIT, stated plainly: a program running as the same operating-system user that deliberately forges
the process tree or reads the credential store directly is not stopped by this; that needs separate
OS accounts. This stops the case that happened - an assistant finding another CLI's sign-in and using it.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

CLAUDE_CODE = "claude-code"
OTHER = "other"
MAX_DEPTH = 64


class WrongOwner(Exception):
    """This helper's sign-in belongs to another CLI or another profile."""


def _parents_windows() -> dict[int, int]:
    import ctypes
    from ctypes import wintypes

    class ENTRY(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
                    ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_void_p),
                    ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                    ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", ctypes.c_long),
                    ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = kernel.CreateToolhelp32Snapshot(0x2, 0)          # TH32CS_SNAPPROCESS
    if snap in (None, wintypes.HANDLE(-1).value):
        return {}
    parents: dict[int, int] = {}
    try:
        entry = ENTRY()
        entry.dwSize = ctypes.sizeof(ENTRY)
        ok = kernel.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            parents[entry.th32ProcessID] = entry.th32ParentProcessID
            ok = kernel.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snap)
    return parents


def _parents_posix() -> dict[int, int]:
    out = subprocess.run(["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True, timeout=10).stdout
    parents: dict[int, int] = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            parents[int(parts[0])] = int(parts[1])
    return parents


def is_ancestor(pid: int) -> bool:
    """True when pid is this process or one of its ancestors."""
    try:
        parents = _parents_windows() if sys.platform == "win32" else _parents_posix()
    except Exception:
        return False
    current = os.getpid()
    for _ in range(MAX_DEPTH):
        if current == pid:
            return True
        parent = parents.get(current)
        if not parent or parent == current:
            return False
        current = parent
    return False


def _resolve(path: Path | str) -> str:
    return os.path.normcase(str(Path(path).expanduser().resolve()))


CLAUDE_EXES = {"claude.exe", "claude"}
LAUNCHER_EXES = {"python.exe", "pythonw.exe", "py.exe", "python", "python3"}
# The shells Claude Code's Bash and PowerShell tools run commands in (1.17.2). Git Bash nests bash.exe
# two or three deep, so the walk allows a few of them; any other program on the way still ends it.
SHELL_EXES = {"bash.exe", "sh.exe", "pwsh.exe", "powershell.exe", "cmd.exe", "bash", "sh", "zsh", "dash"}
MAX_HOPS = 8


def _processes() -> dict[int, tuple[int, str]]:
    """pid -> (parent pid, executable name, lower case)."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class ENTRY(ctypes.Structure):
            _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
                        ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_void_p),
                        ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                        ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", ctypes.c_long),
                        ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        snap = kernel.CreateToolhelp32Snapshot(0x2, 0)
        if snap in (None, wintypes.HANDLE(-1).value):
            return {}
        out: dict[int, tuple[int, str]] = {}
        try:
            entry = ENTRY()
            entry.dwSize = ctypes.sizeof(ENTRY)
            ok = kernel.Process32FirstW(snap, ctypes.byref(entry))
            while ok:
                out[entry.th32ProcessID] = (entry.th32ParentProcessID, entry.szExeFile.lower())
                ok = kernel.Process32NextW(snap, ctypes.byref(entry))
        finally:
            kernel.CloseHandle(snap)
        return out
    text = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,comm="], capture_output=True, text=True, timeout=10).stdout
    out = {}
    for line in text.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            out[int(parts[0])] = (int(parts[1]), os.path.basename(parts[2]).lower())
    return out


def launched_by_claude() -> bool:
    """True when the process that started this one is Claude Code itself.

    Claude Code gives its hooks CLAUDE_PID, but an MCP server only inherits Claude Code's environment,
    where CLAUDE_PID is missing or belongs to an outer session (measured 2026-09-29: the server's
    parent was claude.exe 24888 while CLAUDE_PID said 15268), so the MCP server was refused. Only the
    DIRECT parent counts, stepping over Python launchers (a venv's python.exe starts the real one): a
    far-off claude.exe ancestor does not, or another CLI started from inside a Claude session would pass.

    The `kh call` fallback run from Claude Code's own Bash tool has the same problem when CLAUDE_PID is
    stale (2026-10-22: a new session after one that ended unexpectedly was refused), so the shells that
    tool runs in are stepped over too. Another CLI on the way (grok.exe, node.exe, codex.exe) still ends it.
    """
    try:
        procs = _processes()
    except Exception:
        return False
    current = procs.get(os.getpid(), (0, ""))[0]
    for _ in range(MAX_HOPS):
        parent, exe = procs.get(current, (0, ""))
        if exe in CLAUDE_EXES:
            return True
        if exe not in LAUNCHER_EXES | SHELL_EXES or not parent or parent == current:
            return False
        current = parent
    return False


def caller() -> dict:
    """The CLI running this process: {"cli": "claude-code", "profile": <folder>} or {"cli": "other"}."""
    pid = os.getenv("CLAUDE_PID", "")
    if os.getenv("CLAUDECODE") == "1" and ((pid.isdigit() and is_ancestor(int(pid))) or launched_by_claude()):
        base = os.getenv("CLAUDE_CONFIG_DIR")
        return {"cli": CLAUDE_CODE, "profile": _resolve(base) if base else _resolve(Path.home() / ".claude")}
    return {"cli": OTHER}


def _looks_like_claude_profile(folder: Path) -> bool:
    """A Claude Code config folder: named .claude*, or holding Claude Code's own files."""
    return (folder.name.lower().startswith(".claude") or (folder / ".credentials.json").is_file()
            or ((folder / "settings.json").is_file() and (folder / "projects").is_dir()))


def owner_of(home: Path, state: dict, who: dict | None = None) -> dict:
    """Who owns this HOME: the record written at sign-in, or, for a HOME from before 1.4.0, the folder."""
    recorded = state.get("owner")
    if isinstance(recorded, dict) and recorded.get("cli"):
        return recorded
    profile = _resolve(home.parent)
    if (who and who["cli"] == CLAUDE_CODE and who.get("profile") == profile) or _looks_like_claude_profile(home.parent):
        return {"cli": CLAUDE_CODE, "profile": profile}
    return {"cli": OTHER}


def refusal(home: Path, state: dict, who: dict | None = None) -> str | None:
    """Why the caller may not use this HOME, or None when it may."""
    who = who or caller()
    owner = owner_of(home, state, who)
    if owner["cli"] == CLAUDE_CODE:
        if who["cli"] != CLAUDE_CODE:
            return (f"this Knowledge Hub sign-in belongs to Claude Code ({owner.get('profile')}), not to the "
                    "program asking. Install your own copy of the helper in your own CLI's profile and sign in "
                    "there - see /auth/help.")
        if owner.get("profile") and who.get("profile") != owner["profile"]:
            return (f"this Knowledge Hub sign-in belongs to another Claude Code profile ({owner['profile']}). "
                    "Install the helper in this profile and sign in there - see /auth/help.")
        return None
    if who["cli"] == CLAUDE_CODE:
        return ("this Knowledge Hub sign-in belongs to another CLI. Claude Code uses the helper in its own "
                "profile - see /auth/help.")
    return None


def check(home: Path, state: dict) -> None:
    reason = refusal(home, state)
    if reason:
        raise WrongOwner(reason)


def record(home: Path) -> dict:
    """The owner to write at sign-in: the caller, as identified now."""
    who = caller()
    if who["cli"] == CLAUDE_CODE:
        return who
    # Other CLIs cannot be identified from the process, so the record says where the copy lives and,
    # when that folder is a known CLI's profile, which CLI it is (informational; the rules use "other").
    from .clis import cli_of_home
    return {"cli": OTHER, "profile": _resolve(home.parent), "as": cli_of_home(home)}
