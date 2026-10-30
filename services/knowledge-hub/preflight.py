#!/usr/bin/env python
"""
KnowledgeHub launch preflight.

Run this BEFORE `python main.py` to avoid the single-writer Kuzu lock collision:

    IO exception: Could not set lock on file : ...\\kuzu_data

KnowledgeHub runs uvicorn with reload=False, so it is a single-process server, and
its Kuzu backend takes an EXCLUSIVE OS lock on the kuzu_data file. Launching a
second instance while an old one is still alive (healthy OR wedged) fails with the
error above. This script decides what to do and signals run.bat via its exit code:

    10  KnowledgeHub is ALREADY running and healthy on the port -> ATTACH:
        the caller should NOT start a second instance.
     0  Clear to start. Any stale KnowledgeHub process for THIS project has been
        terminated, releasing the Kuzu lock.
     2  The port is held by a process that is NOT this KnowledgeHub (foreign
        listener) -> the caller should abort; killing it would not be safe.

Only python processes belonging to THIS project directory are ever killed, so
other Python apps on the machine are never touched.

Usage:
    python preflight.py            smart: attach if healthy, else kill stale instance
    python preflight.py --force    always kill the running instance first (restart)

Port:
    Read from app.config.PORT (env var KH_PORT via .env, default 8000) — the
    same source the server binds, so preflight always guards the real port.
    Set KH_PORT in .env to change it; do NOT hardcode it in run.bat.
"""

import json
import os
import socket
import sys
from urllib.error import URLError
from urllib.request import urlopen

import psutil

# Port comes from the single source of truth (app.config, which loads .env),
# NOT a bare os.getenv here — so preflight always probes the exact port the
# server will bind. config.PORT = int(env KH_PORT, default 8000).
from app.config import PORT

# Frozen: the exe lives at Slaves/KnowledgeHub/; that's the project boundary.
PROJECT_DIR = (os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
               else os.path.dirname(os.path.abspath(__file__)))

# Entry-point script that identifies a KnowledgeHub instance of THIS project.
# `main.py` runs the server in-process and (when launched) shows the tray icon.
ENTRY_SCRIPTS = ("main.py",)

# Frozen (PyInstaller) builds run as `KnowledgeHub.exe` — there is no python
# interpreter and no `main.py` in the cmdline, so a stale instance must be
# matched by its executable name instead. Onefile builds spawn a bootloader +
# child of the SAME name; both are handled (own tree is protected, children are
# swept when killing a stale instance).
FROZEN = getattr(sys, "frozen", False)
SELF_EXE = os.path.basename(sys.executable).lower()   # e.g. "knowledgehub.exe"

EXIT_ATTACH = 10
EXIT_CLEAR = 0
EXIT_PORT_TAKEN = 2


def log(msg: str) -> None:
    print(f"[preflight] {msg}", flush=True)


def is_healthy(timeout: float = 2.0) -> bool:
    """True if a healthy KnowledgeHub is answering on the port."""
    try:
        with urlopen(f"http://127.0.0.1:{PORT}/health", timeout=timeout) as resp:
            if resp.status != 200:
                return False
            data = json.loads(resp.read().decode("utf-8", "replace") or "{}")
            return data.get("status") == "ok"
    except (URLError, OSError, ValueError, TimeoutError):
        return False


def port_listening() -> bool:
    """True if something is accepting connections on the port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", PORT)) == 0


def _under_project(path) -> bool:
    """True if `path` lives inside this project directory."""
    if not path:
        return False
    try:
        return os.path.commonpath([os.path.abspath(path), PROJECT_DIR]) == PROJECT_DIR
    except (ValueError, OSError):
        return False


def _own_tree_pids() -> set:
    """
    PIDs that make up the CURRENT process tree and must never be killed:
    self + all ancestors + all descendants.

    This matters when preflight runs IN-PROCESS (e.g. `python main.py` in tray
    mode): the Windows venv `python.exe` is a stub launcher that spawns the real
    interpreter as a CHILD, so `os.getpid()` is the child while the stub — which
    carries `main.py` in its cmdline — is an ancestor. Excluding the whole tree
    stops us from killing our own launcher and taking ourselves down with it.
    """
    protected = {os.getpid()}
    try:
        cur = psutil.Process(os.getpid())
        protected.update(p.pid for p in cur.parents())
        protected.update(c.pid for c in cur.children(recursive=True))
    except psutil.Error:
        pass
    return protected


def _is_kh_instance(proc) -> bool:
    """True if *proc* is a KnowledgeHub instance of THIS project.

    Works in both run modes:
      - source : a python interpreter whose cmdline runs this project's main.py
      - frozen : a KnowledgeHub.exe whose image lives under this project dir
    In both cases the process must resolve to this project directory, so other
    Python apps (source) or a different KnowledgeHub install (frozen) are safe.
    """
    name = (proc.info.get("name") or "").lower()
    cmdline = proc.info.get("cmdline") or []
    exe = proc.info.get("exe")
    under = (
        _under_project(proc.info.get("cwd"))
        or _under_project(exe)
        or any(_under_project(arg) for arg in cmdline if os.sep in str(arg))
    )
    if not under:
        return False
    if "--tray" in cmdline:
        # The status tray (app/status_tray.py) shares the exe but holds no store lock: never a stale server.
        return False
    if FROZEN:
        # exe mode: match by executable name (bootloader + child share it).
        return name == SELF_EXE or "knowledgehub" in name
    # source mode: a python process running one of the entry scripts.
    return ("python" in name
            and any(entry in str(arg) for arg in cmdline for entry in ENTRY_SCRIPTS))


def find_kh_processes() -> list:
    """KnowledgeHub instances of THIS project (source or frozen), plus children."""
    protected = _own_tree_pids()
    direct = []
    for proc in psutil.process_iter(["pid", "name", "cmdline", "exe", "cwd"]):
        try:
            if proc.pid in protected:
                continue
            if _is_kh_instance(proc):
                direct.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    found = {proc.pid: proc for proc in direct}
    # Include children (e.g. a uvicorn reload worker) so nothing is left holding
    # the lock after the parent dies.
    for proc in direct:
        try:
            for child in proc.children(recursive=True):
                if child.pid not in protected:
                    found.setdefault(child.pid, child)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return list(found.values())


def kill_processes(procs: list) -> list:
    """Kill the given processes; return the list of any that survived."""
    for proc in procs:
        try:
            log(f"  killing PID {proc.pid}: {' '.join(proc.cmdline())}")
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            log(f"  killing PID {proc.pid}")
        try:
            proc.kill()
        except psutil.NoSuchProcess:
            pass
        except psutil.AccessDenied as exc:
            log(f"  (access denied killing PID {proc.pid}: {exc})")
    # Wait for exit — the OS releases the file lock once the process is gone.
    _, alive = psutil.wait_procs(procs, timeout=10)
    return alive


def main() -> int:
    force = "--force" in sys.argv or "-f" in sys.argv

    if not force and is_healthy():
        log(f"KnowledgeHub already running & healthy on http://localhost:{PORT} "
            "-- attaching (no new instance).")
        return EXIT_ATTACH

    stale = find_kh_processes()
    if stale:
        log(f"Found {len(stale)} stale KnowledgeHub process(es) holding the Kuzu "
            "lock -- terminating:")
        alive = kill_processes(stale)
        if alive:
            log(f"WARNING: {len(alive)} process(es) survived; the lock may still "
                "be held.")
        else:
            log("Stale instance stopped -- Kuzu lock released.")

    if port_listening():
        log(f"ERROR: port {PORT} is in use by a process that is NOT this KnowledgeHub.")
        log("Free the port or set KH_PORT in .env to a different value, then retry.")
        return EXIT_PORT_TAKEN

    log("Clear to start.")
    return EXIT_CLEAR


if __name__ == "__main__":
    sys.exit(main())
