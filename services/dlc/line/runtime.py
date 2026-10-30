"""Where the engine runs: from source (dev) or as the built `dlc` application (frozen).

The engine itself never needs a Python interpreter once it is built, but a Python TARGET does: its tests run
under a real interpreter. From source that is the interpreter running the engine (sys.executable); in the
built app sys.executable is the dlc executable itself, so the interpreter is found instead:
LINE_PYTHON, else `python`, `python3` or `py` on PATH.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys


def frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def python_exe() -> str:
    """The interpreter that runs Python targets' tests and helpers."""
    if not frozen():
        return sys.executable
    stated = os.environ.get("LINE_PYTHON", "").strip()
    if stated:
        return stated
    for name in ("python", "python3", "py"):
        found = shutil.which(name)
        if found:
            return found
    return "python"   # fails clearly at the first call ("cannot run 'python'")


CREATE_NEW_CONSOLE, DETACHED_PROCESS, CREATE_NO_WINDOW = 0x00000010, 0x00000008, 0x08000000


def hide_child_consoles(has_console=None) -> bool:
    """Windows engine without a console of its own (dlcw.exe as a scheduled task or service): every console
    child it starts - git, claude, node, test runners, and through claude the agents' tools and MCP servers -
    would get a new console window that flashes and takes the focus. From here on every child gets
    CREATE_NO_WINDOW (a hidden console its own children share), unless the call asks for a console or a
    detached process itself. With a console (dlc.exe in a terminal) children share it: nothing changes."""
    if os.name != "nt" or getattr(subprocess.Popen, "_dlc_no_window", False):
        return False
    if has_console is None:
        import ctypes
        has_console = bool(ctypes.windll.kernel32.GetConsoleWindow())
    if has_console:
        return False
    init = subprocess.Popen.__init__

    def __init__(self, *args, **kwargs):
        flags = kwargs.get("creationflags", 0) or 0
        if not flags & (CREATE_NEW_CONSOLE | DETACHED_PROCESS | CREATE_NO_WINDOW):
            kwargs["creationflags"] = flags | CREATE_NO_WINDOW
        init(self, *args, **kwargs)

    subprocess.Popen.__init__ = __init__
    subprocess.Popen._dlc_no_window = True
    return True


__all__ = ["frozen", "python_exe", "hide_child_consoles"]
