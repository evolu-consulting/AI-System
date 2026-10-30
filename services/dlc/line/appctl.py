"""Start / stop / watch the app a green run deployed, so a frontend can offer "Start" and "Open".

    status(store, cfg, run)            -> {"state", "url", "port", "pid", "dir", "log_tail", "how"}
    start(store, cfg, run, by="")      -> same, after the app answers its health check (or "failed")
    stop(store, cfg, run, by="", reason="operator") -> same, state "stopped"

Where the app runs from: the color QAS deployed last (<workroot>/<run>/_qas/<color>), else the run's target
repository (branch main). How it starts:

    dlc.app.json  {"start": ["python", "app.py"], "cwd": ".", "port_env": "PORT", "health_path": "/",
                   "open_path": "/"}          ("{port}" in an argument is replaced by the port)
    else detected: package.json with a start script -> npm start; a Python package with __main__.py (server/,
                   app/, backend/, api/) -> python -m <package>; a Python file app.py / main.py / server.py
                   -> python <file>; an index.html -> a static file server; PORT (and HOST=0.0.0.0) in the env.
                   A Python app with a web frontend in web/ (frontend/, client/, ui/) whose package.json has a
                   build script gets it built first (npm ci / install when node_modules is missing, npm run
                   build): the Python server serves the built files (run R20261025-124714-1c99 was started as a
                   static server on the frontend's unbuilt sources instead of `python -m server`).

Settings the app needs that must not live in its repository (an admin password, an API key) go in
DLC_HOME/secrets/apps/<project>.env, KEY=VALUE per line (# comments, optional quotes): every start of a run of
that project gets them in its environment; PORT and HOST stay the engine's. The log names the keys, never the
values.

A port comes from LINE_APP_PORTS (e.g. 18000-18099), skipping ports in use. The URL uses LINE_PUBLIC_HOST, else
this host's primary IP. State lives in <workroot>/<run>/_app/state.json, logs in .../_app/app.log, so a
restarted server still knows (pid + port check) whether the app runs. Processes start without a console
window on Windows. Open the port range in the host firewall for other machines to reach the app.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from . import codes
from .codes import LineError
from .contracts import E_RUN, now_ms

APP_FILE = "dlc.app.json"
APP_DIR = "_app"
QAS_DIR = "_qas"
SYSTEM_RUN = "_line"
_lock = threading.Lock()


def _safe(s: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in s) or "_"


def _run_dir(cfg: Any, run: str) -> str:
    return os.path.join(cfg.workroot, _safe(run))


def _state_path(cfg: Any, run: str) -> str:
    return os.path.join(_run_dir(cfg, run), APP_DIR, "state.json")


def _log_path(cfg: Any, run: str) -> str:
    return os.path.join(_run_dir(cfg, run), APP_DIR, "app.log")


def _read_state(cfg: Any, run: str) -> Dict[str, Any]:
    try:
        with open(_state_path(cfg, run), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _write_state(cfg: Any, run: str, st: Dict[str, Any]) -> None:
    p = _state_path(cfg, run)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(st, fh)
    os.replace(tmp, p)


def _tail(path: str, n: int = 4000) -> str:
    try:
        with open(path, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - n))
            return fh.read().decode("utf-8", "replace")
    except OSError:
        return ""


def pid_alive(pid: int) -> bool:
    if not pid:
        return False
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.windll.kernel32   # type: ignore[attr-defined]
        h = k32.OpenProcess(0x1000, False, int(pid))   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        try:
            code = wintypes.DWORD()
            if not k32.GetExitCodeProcess(h, ctypes.byref(code)):
                return False
            return code.value == 259                    # STILL_ACTIVE
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.3) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, int(port)))
        return True
    except OSError:
        return False
    finally:
        s.close()


def parse_ports(spec: str) -> List[int]:
    out: List[int] = []
    for part in str(spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(\d+)\s*-\s*(\d+)$", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            out.extend(range(min(a, b), max(a, b) + 1))
        elif part.isdigit():
            out.append(int(part))
    if not out:
        raise LineError(codes.CONFIG_INVALID, "LINE_APP_PORTS has no port: %r" % spec, {"field": "app_ports"})
    return out


def _taken_ports(cfg: Any) -> set:
    taken = set()
    root = cfg.workroot
    try:
        names = os.listdir(root)
    except OSError:
        return taken
    for name in names:
        try:
            with open(os.path.join(root, name, APP_DIR, "state.json"), encoding="utf-8") as fh:
                st = json.load(fh)
            if st.get("state") in ("starting", "running") and pid_alive(int(st.get("pid") or 0)):
                taken.add(int(st.get("port") or 0))
        except (OSError, ValueError):
            continue
    return taken


def free_port(cfg: Any) -> int:
    taken = _taken_ports(cfg)
    for p in parse_ports(cfg.app_ports):
        if p in taken or port_open(p):
            continue
        return p
    raise LineError(codes.APP_START_FAILED, "no free port in LINE_APP_PORTS %s" % cfg.app_ports,
                    {"app_ports": cfg.app_ports})


def host_ip() -> str:
    """This host's primary IPv4 (no packet is sent), else its name."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return socket.gethostname()
    finally:
        s.close()


def app_dir(store: Any, cfg: Any, run: str) -> str:
    row = store.get(E_RUN, run)
    if row is None:
        raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
    from .ship.deploy import current_dir
    qas = current_dir(os.path.join(_run_dir(cfg, run), QAS_DIR))
    if qas and os.path.isdir(qas):
        return qas
    target = str((row.get("detail") or {}).get("target") or "")
    if target and os.path.isdir(target):
        return target
    fresh = os.path.join(_run_dir(cfg, run), "target")
    if os.path.isdir(fresh):
        return fresh
    raise LineError(codes.NOT_FOUND, "run %s has nothing deployed yet" % run, {"run": run})


def _python() -> str:
    from .runtime import python_exe
    return python_exe()


# ------------------------------------------------------------------ desktop or web, and its Python environment

#: libraries that make a Python app a desktop (window) app: it gets Build & download instead of Start
DESKTOP_LIBS = ("flet", "tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6", "wx", "kivy", "pygame")
WEB_LIBS = ("flask", "fastapi", "django", "http", "aiohttp", "uvicorn", "bottle", "starlette", "streamlit")
_IMPORT = re.compile(r"^\s*(?:import|from)\s+([A-Za-z_]\w*)", re.M)


def app_kind(directory: str, entry: str = "") -> str:
    """'desktop' or 'web'. dlc.app.json may say it ("kind"); else a Python entry that imports a desktop UI
    library and no web server is a desktop app (a Flet app opened in the browser, view=WEB_BROWSER, is web)."""
    try:
        with open(os.path.join(directory, APP_FILE), encoding="utf-8") as fh:
            kind = str((json.load(fh) or {}).get("kind") or "").lower()
        if kind in ("desktop", "web"):
            return kind
    except (OSError, ValueError):
        pass
    names = [entry] if entry else ["app.py", "main.py", "server.py"]
    for name in names:
        p = os.path.join(directory, name)
        if not name.endswith(".py") or not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        libs = set(_IMPORT.findall(text))
        if libs & set(DESKTOP_LIBS) and not libs & set(WEB_LIBS) and "WEB_BROWSER" not in text:
            return "desktop"
        return "web"
    return "web"


def _home(cfg: Any) -> str:
    return os.environ.get("DLC_HOME", "").strip() or os.path.dirname(os.path.abspath(str(cfg.workroot)))


_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def env_path(cfg: Any, project: str) -> str:
    return os.path.join(_home(cfg), "secrets", "apps", _safe(project) + ".env")


def app_env(cfg: Any, project: str) -> Dict[str, str]:
    """The project's own settings for its app (DLC_HOME/secrets/apps/<project>.env); {} when there is none."""
    if not project:
        return {}
    path = env_path(cfg, project)
    try:
        with open(path, encoding="utf-8-sig") as fh:
            lines = fh.read().splitlines()
    except FileNotFoundError:
        return {}
    except OSError as e:
        raise LineError(codes.APP_START_FAILED, "cannot read %s: %s" % (path, e), {"path": path})
    out: Dict[str, str] = {}
    for n, line in enumerate(lines, 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        if not sep or not _ENV_KEY.match(key):
            raise LineError(codes.APP_START_FAILED, "%s line %d is not KEY=VALUE" % (path, n), {"path": path})
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key] = value
    return out


def venv_python(cfg: Any, directory: str, log: str, extra: Tuple[str, ...] = ()) -> str:
    """The Python to run or build the app with: a venv with its requirements.txt (and `extra` packages) installed,
    shared by every app with the same requirements (DLC_HOME/venvs/<hash>). No requirements and no extra: the
    plain interpreter."""
    import hashlib
    req = os.path.join(directory, "requirements.txt")
    wanted = ""
    if os.path.isfile(req):
        with open(req, encoding="utf-8", errors="replace") as fh:
            wanted = "\n".join(sorted(x.strip() for x in fh if x.strip() and not x.strip().startswith("#")))
    if not wanted and not extra:
        return _python()
    base = _python()
    key = hashlib.sha256(("%s\n%s\n%s" % (base, wanted, " ".join(extra))).encode("utf-8")).hexdigest()[:12]
    root = os.path.join(_home(cfg), "venvs", key)
    py = os.path.join(root, "Scripts", "python.exe") if os.name == "nt" else os.path.join(root, "bin", "python")
    ready = os.path.join(root, ".ready")
    if os.path.isfile(ready) and os.path.isfile(py):
        return py
    with open(log, "ab") as out:
        out.write(("\n--- python environment %s: %s %s\n" % (key, wanted.replace("\n", ", ") or "-", " ".join(extra)))
                  .encode("utf-8"))
        out.flush()
        steps = [[base, "-m", "venv", root]]
        if wanted:
            steps.append([py, "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", req])
        if extra:
            steps.append([py, "-m", "pip", "install", "-q", "--disable-pip-version-check"] + list(extra))
        for argv in steps:
            rc = subprocess.run(argv, cwd=directory, stdout=out, stderr=subprocess.STDOUT, timeout=1800).returncode
            if rc != 0:
                raise LineError(codes.APP_START_FAILED, "could not prepare the app's Python environment (%s exited "
                                "%d; see the log)" % (os.path.basename(argv[0]) + " " + " ".join(argv[1:3]), rc),
                                {"argv": argv})
    with open(ready, "w", encoding="utf-8") as fh:
        fh.write(wanted)
    return py


def _npm() -> str:
    return shutil.which("npm.cmd") or shutil.which("npm") or "npm"


PY_PACKAGES = ("server", "app", "backend", "api")
WEB_DIRS = ("web", "frontend", "client", "ui")


def _scripts(pkg: str) -> Dict[str, Any]:
    try:
        with open(pkg, encoding="utf-8") as fh:
            return dict((json.load(fh) or {}).get("scripts") or {})
    except (OSError, ValueError, AttributeError):
        return {}


def prebuild(directory: str) -> List[Dict[str, Any]]:
    """The steps that build a Python app's web frontend before it starts: [{"argv", "cwd"}] (empty: none)."""
    for sub in WEB_DIRS:
        d = os.path.join(directory, sub)
        if not _scripts(os.path.join(d, "package.json")).get("build"):
            continue
        steps: List[Dict[str, Any]] = []
        if not os.path.isdir(os.path.join(d, "node_modules")):
            ci = os.path.isfile(os.path.join(d, "package-lock.json"))
            steps.append({"argv": [_npm(), "ci" if ci else "install", "--no-audit", "--no-fund"], "cwd": d})
        steps.append({"argv": [_npm(), "run", "build"], "cwd": d})
        return steps
    return []


def plan(directory: str) -> Dict[str, Any]:
    """How to start the app in `directory`: {"argv", "cwd", "port_env", "health_path", "open_path", "how",
    "prebuild"?}."""
    spec_path = os.path.join(directory, APP_FILE)
    if os.path.isfile(spec_path):
        try:
            with open(spec_path, encoding="utf-8") as fh:
                spec = json.load(fh)
        except (OSError, ValueError) as e:
            raise LineError(codes.APP_START_FAILED, "%s is not valid JSON: %s" % (APP_FILE, e), {"dir": directory})
        argv = spec.get("start")
        if isinstance(argv, str):
            argv = argv.split()
        if not argv or not isinstance(argv, list):
            raise LineError(codes.APP_START_FAILED, "%s needs \"start\": [argv]" % APP_FILE, {"dir": directory})
        argv = [str(a) for a in argv]
        if argv[0] in ("python", "python3", "py"):
            argv[0] = _python()
        elif argv[0] == "npm":
            argv[0] = _npm()
        cwd = os.path.normpath(os.path.join(directory, str(spec.get("cwd") or ".")))
        if not cwd.startswith(os.path.normpath(directory)):
            raise LineError(codes.APP_START_FAILED, "%s cwd leaves the app folder" % APP_FILE, {"dir": directory})
        return {"argv": argv, "cwd": cwd, "port_env": str(spec.get("port_env") or "PORT"),
                "health_path": str(spec.get("health_path") or "/"), "open_path": str(spec.get("open_path") or "/"),
                "how": APP_FILE}
    pkg = os.path.join(directory, "package.json")
    if os.path.isfile(pkg):
        try:
            with open(pkg, encoding="utf-8") as fh:
                scripts = (json.load(fh) or {}).get("scripts") or {}
        except (OSError, ValueError):
            scripts = {}
        if scripts.get("start"):
            return {"argv": [_npm(), "start"], "cwd": directory, "port_env": "PORT", "health_path": "/",
                    "open_path": "/", "how": "package.json start"}
    for name in PY_PACKAGES:
        if os.path.isfile(os.path.join(directory, name, "__main__.py")):
            return {"argv": [_python(), "-m", name], "cwd": directory, "port_env": "PORT", "health_path": "/",
                    "open_path": "/", "how": "python -m %s" % name, "prebuild": prebuild(directory)}
    for name in ("app.py", "main.py", "server.py"):
        p = os.path.join(directory, name)
        if os.path.isfile(p):
            return {"argv": [_python(), name], "cwd": directory, "port_env": "PORT", "health_path": "/",
                    "open_path": "/", "how": name, "prebuild": prebuild(directory)}
    for sub in ("", "static", "public", "web", "dist"):
        d = os.path.join(directory, sub)
        if os.path.isfile(os.path.join(d, "index.html")):
            return {"argv": [_python(), "-m", "http.server", "{port}", "--bind", "0.0.0.0"], "cwd": d,
                    "port_env": "PORT", "health_path": "/", "open_path": "/", "how": "static index.html"}
    raise LineError(codes.APP_START_FAILED,
                    "no way to start this app: add %s, a package.json start script, app.py or index.html" % APP_FILE,
                    {"dir": directory})


def _url(cfg: Any, port: int, path: str = "/") -> str:
    host = str(getattr(cfg, "public_host", "") or "").strip() or host_ip()
    return "http://%s:%d%s" % (host, port, path if path.startswith("/") else "/" + path)


def _alive(st: Dict[str, Any]) -> bool:
    return bool(st) and pid_alive(int(st.get("pid") or 0)) and port_open(int(st.get("port") or 0))


def status(store: Any, cfg: Any, run: str) -> Dict[str, Any]:
    if store.get(E_RUN, run) is None:
        raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
    st = _read_state(cfg, run)
    out = {"run": run, "state": "none", "url": "", "port": 0, "pid": 0, "dir": "", "how": "", "log_tail": ""}
    if not st:
        try:
            app_dir(store, cfg, run)
            out["state"] = "stopped"
        except LineError:
            pass
        return out
    out.update({k: st.get(k, out[k]) for k in ("url", "port", "pid", "dir", "how")})
    state = st.get("state", "stopped")
    if state in ("running", "starting"):
        if _alive(st):
            state = "running"
        elif pid_alive(int(st.get("pid") or 0)):
            state = "starting"
        else:
            state = "stopped" if state == "running" else "failed"
    out["state"] = state
    out["log_tail"] = _tail(_log_path(cfg, run), 2000)
    return out


def _with_kind(store: Any, cfg: Any, run: str, out: Dict[str, Any]) -> Dict[str, Any]:
    """status() plus the app's kind and, for a desktop app, its build."""
    try:
        directory = app_dir(store, cfg, run)
        out["kind"] = app_kind(directory)
    except LineError:
        out["kind"] = "web"
    b = _read_build(cfg, run)
    out["build"] = {k: b.get(k) for k in ("state", "size", "error", "started", "finished", "name") if k in b}
    if b.get("state") == "building" and not _building.get(run):   # no build thread in this process any more
        out["build"]["state"] = "failed"
        out["build"]["error"] = out["build"].get("error") or "the build was interrupted (engine restart)"
    return out


# ------------------------------------------------------------------ Build & download (desktop apps)

_building: Dict[str, bool] = {}


def _build_path(cfg: Any, run: str) -> str:
    return os.path.join(_run_dir(cfg, run), "_app", "build.json")


def _read_build(cfg: Any, run: str) -> Dict[str, Any]:
    try:
        with open(_build_path(cfg, run), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _write_build(cfg: Any, run: str, b: Dict[str, Any]) -> None:
    p = _build_path(cfg, run)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(b, fh)
    os.replace(p + ".tmp", p)


def build(store: Any, cfg: Any, run: str, by: str = "") -> Dict[str, Any]:
    """Start building the desktop app of a run into a zip (in the background). -> status() with the build."""
    directory = app_dir(store, cfg, run)
    how = plan(directory)
    entry = how["how"] if how["how"].endswith(".py") else ""
    if app_kind(directory, entry) != "desktop":
        raise LineError(codes.APP_START_FAILED, "this is a web app: use Start app", {"dir": directory, "kind": "web"})
    with _lock:
        if _building.get(run):
            return status_full(store, cfg, run)
        _building[run] = True
    row = store.get(E_RUN, run) or {}
    name = _safe(str((row.get("detail") or {}).get("project") or run)) or "app"
    _write_build(cfg, run, {"state": "building", "started": time.time(), "by": by, "name": name})
    threading.Thread(target=_build_worker, args=(cfg, run, directory, entry, name), daemon=True,
                     name="line-app-build-%s" % run).start()
    return status_full(store, cfg, run)


def _build_worker(cfg: Any, run: str, directory: str, entry: str, name: str) -> None:
    out = os.path.join(_run_dir(cfg, run), "_app", "build")
    log = _log_path(cfg, run)
    b = _read_build(cfg, run)
    try:
        shutil.rmtree(out, ignore_errors=True)
        src = os.path.join(out, "src")
        shutil.copytree(directory, src, ignore=shutil.ignore_patterns(".git", ".venv", "__pycache__", "*.pyc",
                                                                       "build", "dist", "tests"))
        spec = {}
        try:
            with open(os.path.join(src, APP_FILE), encoding="utf-8") as fh:
                spec = json.load(fh) or {}
        except (OSError, ValueError):
            pass
        dist = os.path.join(out, "dist")
        if spec.get("build"):                       # dlc.app.json says how: {"build": [argv], "artifact": "dist"}
            argv = [str(a) for a in (spec["build"].split() if isinstance(spec["build"], str) else spec["build"])]
            if argv[0] in ("python", "python3", "py"):
                argv[0] = venv_python(cfg, src, log)
            dist = os.path.join(src, str(spec.get("artifact") or "dist"))
        else:
            entry = entry or next((n for n in ("app.py", "main.py", "server.py") if os.path.isfile(os.path.join(src, n))), "")
            if not entry:
                raise LineError(codes.APP_START_FAILED, "no Python entry (app.py / main.py) to build", {})
            with open(os.path.join(src, entry), encoding="utf-8", errors="replace") as fh:
                flet = "flet" in set(_IMPORT.findall(fh.read()))
            py = venv_python(cfg, src, log, extra=("pyinstaller",))
            if flet:                                # a Flet app is packed with its own runtime: flet pack
                argv = [py, "-m", "flet.cli", "pack", entry, "-y", "--distpath", dist, "-n", name]
            else:
                argv = [py, "-m", "PyInstaller", "--noconfirm", "--windowed", "--name", name, "--distpath", dist,
                        "--workpath", os.path.join(out, "work"), "--specpath", out, entry]
        with open(log, "ab") as fh:
            fh.write(("\n--- build %s in %s\n" % (" ".join(argv), src)).encode("utf-8"))
            fh.flush()
            rc = subprocess.run(argv, cwd=src, stdout=fh, stderr=subprocess.STDOUT, timeout=3600).returncode
        if rc != 0 or not os.path.isdir(dist) or not os.listdir(dist):
            raise LineError(codes.APP_START_FAILED, "the build failed (exit %d; see the log)" % rc, {})
        zip_base = os.path.join(out, "%s-%s" % (name, run))
        zip_path = shutil.make_archive(zip_base, "zip", dist)
        b.update(state="built", zip=zip_path, size=os.path.getsize(zip_path), finished=time.time())
    except Exception as e:   # noqa: BLE001 - the build's outcome is reported, never raised into the engine
        b.update(state="failed", error=str(getattr(e, "message", "") or e)[:400], finished=time.time())
        with open(log, "ab") as fh:
            fh.write(("\n--- build failed: %s\n" % b["error"]).encode("utf-8"))
    finally:
        _write_build(cfg, run, b)
        with _lock:
            _building.pop(run, None)


def download_path(store: Any, cfg: Any, run: str) -> str:
    """The zip of a built desktop app."""
    if store.get(E_RUN, run) is None:
        raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
    b = _read_build(cfg, run)
    if b.get("state") != "built" or not os.path.isfile(str(b.get("zip") or "")):
        raise LineError(codes.NOT_FOUND, "run %s has no built app to download" % run, {"run": run})
    return str(b["zip"])


def status_full(store: Any, cfg: Any, run: str) -> Dict[str, Any]:
    return _with_kind(store, cfg, run, status(store, cfg, run))


def _emit(store: Any, cfg: Any, kind: str, body: Dict[str, Any]) -> None:
    try:
        from .events import Emitter
        Emitter(store, getattr(cfg, "agent_version", ""), getattr(cfg, "model", "")).run_event(SYSTEM_RUN, kind, body)
    except Exception:   # noqa: BLE001 - an event never stops the app control
        pass


def _spawn(argv: List[str], cwd: str, env: Dict[str, str], log: str) -> subprocess.Popen:
    os.makedirs(os.path.dirname(log), exist_ok=True)
    fh = open(log, "ab")
    kw: Dict[str, Any] = {"cwd": cwd, "env": env, "stdout": fh, "stderr": subprocess.STDOUT,
                          "stdin": subprocess.DEVNULL}
    if os.name == "nt":
        kw["creationflags"] = 0x08000000 | 0x00000200   # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    try:
        return subprocess.Popen(argv, **kw)
    finally:
        fh.close()


def _healthy(port: int, path: str) -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=2) as r:
            return r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except (OSError, ValueError):
        return False


def _prebuild(steps: List[Dict[str, Any]], log: str) -> None:
    """Run the build steps of plan()["prebuild"] into the app log; a failing step stops the start."""
    for step in steps:
        with open(log, "ab") as out:
            out.write(("\n--- build: %s in %s\n" % (" ".join(step["argv"]), step["cwd"])).encode("utf-8"))
            out.flush()
            try:
                rc = subprocess.run(step["argv"], cwd=step["cwd"], stdout=out, stderr=subprocess.STDOUT, timeout=1800,
                                    creationflags=0x08000000 if os.name == "nt" else 0).returncode
            except (OSError, subprocess.TimeoutExpired) as e:
                raise LineError(codes.APP_START_FAILED, "cannot build the app's frontend: %s" % e, {"argv": step["argv"]})
        if rc != 0:
            raise LineError(codes.APP_START_FAILED, "building the app's frontend failed (%s exited %d; see the log)"
                            % (" ".join(step["argv"][1:3]), rc), {"argv": step["argv"], "cwd": step["cwd"]})


def start(store: Any, cfg: Any, run: str, by: str = "") -> Dict[str, Any]:
    with _lock:
        cur = status(store, cfg, run)
        if cur["state"] in ("running", "starting"):
            return cur
        directory = app_dir(store, cfg, run)
        how = plan(directory)
        if app_kind(directory, how["how"] if how["how"].endswith(".py") else "") == "desktop":
            raise LineError(codes.APP_START_FAILED, "this is a desktop app: use Build & download to get it",
                            {"dir": directory, "kind": "desktop"})
        log = _log_path(cfg, run)
        os.makedirs(os.path.dirname(log), exist_ok=True)
        if how["argv"][0] == _python():           # a Python app runs with its requirements installed
            how = dict(how, argv=[venv_python(cfg, directory, log)] + how["argv"][1:])
        _prebuild(how.get("prebuild") or [], log)
        port = free_port(cfg)
        argv = [a.replace("{port}", str(port)) for a in how["argv"]]
        env = dict(os.environ)
        for k in list(env):
            if k == "CLAUDECODE" or k.startswith("CLAUDE_CODE_") or k.startswith("LINE_") or k.startswith("DLC_"):
                env.pop(k, None)
        own = app_env(cfg, str(((store.get(E_RUN, run) or {}).get("detail") or {}).get("project") or ""))
        env.update(own)
        env.update({how["port_env"]: str(port), "PORT": str(port), "HOST": "0.0.0.0", "PYTHONUNBUFFERED": "1"})
        with open(log, "ab") as fh:
            fh.write(("\n--- start %s in %s (%s)\n" % (" ".join(argv), how["cwd"], how["how"])).encode("utf-8"))
            if own:
                fh.write(("--- project settings: %s\n" % ", ".join(sorted(own))).encode("utf-8"))
        try:
            proc = _spawn(argv, how["cwd"], env, log)
        except OSError as e:
            raise LineError(codes.APP_START_FAILED, "cannot start %s: %s" % (argv[0], e), {"argv": argv})
        url = _url(cfg, port, how.get("open_path") or "/")
        st = {"state": "starting", "pid": proc.pid, "port": port, "url": url, "dir": directory, "how": how["how"],
              "argv": argv, "started_ms": now_ms(), "by": by}
        _write_state(cfg, run, st)
    deadline = time.time() + max(5, int(getattr(cfg, "app_start_timeout_s", 60) or 60))
    ok = False
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        if port_open(port) and _healthy(port, how["health_path"]):
            ok = True
            break
        time.sleep(0.4)
    with _lock:
        if ok:
            st["state"] = "running"
            _write_state(cfg, run, st)
            _emit(store, cfg, codes.APP_STARTED, {"run": run, "url": url, "port": port, "pid": proc.pid,
                                                  "dir": directory, "by": by})
        else:
            _kill(proc.pid)
            st["state"] = "failed"
            _write_state(cfg, run, st)
    out = status(store, cfg, run)
    if not ok:
        out["state"] = "failed"
        out["error"] = "the app did not answer on port %d within %ss (see log_tail)" % (
            port, getattr(cfg, "app_start_timeout_s", 60))
    return out


def _kill(pid: int) -> None:
    if not pid:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(int(pid)), "/T", "/F"], capture_output=True,
                       creationflags=0x08000000)
    else:
        import signal
        try:
            os.killpg(os.getpgid(int(pid)), signal.SIGTERM)
        except OSError:
            pass


def stop(store: Any, cfg: Any, run: str, by: str = "", reason: str = "operator") -> Dict[str, Any]:
    with _lock:
        st = _read_state(cfg, run)
        if store.get(E_RUN, run) is None:
            raise LineError(codes.NOT_FOUND, "run %s" % run, {"run": run})
        if st:
            pid = int(st.get("pid") or 0)
            if pid_alive(pid):
                _kill(pid)
            st["state"] = "stopped"
            st["stopped_ms"] = now_ms()
            _write_state(cfg, run, st)
            _emit(store, cfg, codes.APP_STOPPED, {"run": run, "port": st.get("port"), "pid": pid,
                                                  "reason": reason, "by": by})
    return status(store, cfg, run)


__all__ = ["status", "start", "stop", "plan", "parse_ports", "free_port", "pid_alive", "port_open", "host_ip"]
