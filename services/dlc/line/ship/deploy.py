"""Simple dev QAS deploy (plan block 16): blue/green directories + pointer file.

Layout under ``<workroot>/qas`` (or ``qas_root``):

  blue/  green/      exported trees of main (``git archive``), one per color
  current            JSON pointer {"color","sha","run","ts_ms"}; replaced atomically (os.replace)
  .lock              QAS lock (deploy and the QAS runner hold it while they work)

deploy(): pick the idle color, export main into it, run the smoke command there;
smoke green -> switch the pointer to the new color; smoke red -> SMOKE_FAIL and
the pointer keeps the old color. Both emit deploy.done (body.ok tells which).
The same (run, sha) already live is a no-op (deploy key, never deployed twice).

Deploy windows (config.deploy_windows, "HH:MM-HH:MM" local time, may wrap midnight):
  []        dev: deploy as soon as the merge queue has drained
  [...]     only inside a window, unless the deploy is urgent or ordered by a human

Smoke command: ``smoke_cmd`` (argv list or string), else env LINE_SMOKE_CMD, else
``python -m unittest`` (discovery) run inside the exported color directory.
"""

from __future__ import annotations

import contextlib
import datetime as _dt
import json
import os
import shlex
import shutil
import tarfile
import tempfile
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Union

from .. import codes, stacks
from ..codes import LineError
from ..config import Config, load_config
from ..contracts import E_DEPLOY, Gate
from ._util import SystemClock, git, git_out, put_gate, python_argv, run_cmd, run_env

COLORS = ("blue", "green")
LOCK_STALE_S = 3600          # a lock file older than this is from a dead process
_LOCAL_LOCK = threading.Lock()          # guards _ROOT_LOCKS
_ROOT_LOCKS: Dict[str, threading.Lock] = {}


def _root_lock(qas_root: str) -> threading.Lock:
    """In-process mutex of one QAS root (runs with their own roots never wait on each other)."""
    key = os.path.normcase(os.path.abspath(qas_root))
    with _LOCAL_LOCK:
        return _ROOT_LOCKS.setdefault(key, threading.Lock())


def other_color(color: Optional[str]) -> str:
    return "green" if color == "blue" else "blue"


# ------------------------------------------------------------------ windows


def _parse_hhmm(s: str) -> int:
    h, m = s.strip().split(":")
    h, m = int(h), int(m)
    if not (0 <= h <= 24 and 0 <= m < 60):
        raise ValueError(s)
    return h * 60 + m


def parse_window(spec: str) -> tuple:
    """'HH:MM-HH:MM' -> (start_min, end_min). LineError(CONFIG_INVALID) on a bad spec."""
    try:
        a, b = spec.split("-")
        return _parse_hhmm(a), _parse_hhmm(b)
    except (ValueError, AttributeError) as e:
        raise LineError(codes.CONFIG_INVALID, "bad deploy window %r (want HH:MM-HH:MM)" % (spec,),
                        {"field": "deploy_windows", "value": spec}) from e


def in_windows(windows: Sequence[str], now: _dt.datetime) -> bool:
    """True when ``now`` (local wall clock) is inside one of the windows. [] -> True."""
    if not windows:
        return True
    t = now.hour * 60 + now.minute
    for w in windows:
        start, end = parse_window(w)
        if start <= end:
            if start <= t < end:
                return True
        elif t >= start or t < end:      # wraps midnight, e.g. 22:00-02:00
            return True
    return False


# ------------------------------------------------------------------ lock


@contextlib.contextmanager
def qas_lock(qas_root: str, owner: str, stale_s: int = LOCK_STALE_S) -> Iterator[str]:
    """Exclusive QAS lock (lock file + in-process mutex). Busy -> LineError(STATE_CONFLICT)."""
    os.makedirs(qas_root, exist_ok=True)
    path = os.path.join(qas_root, ".lock")
    local = _root_lock(qas_root)
    if not local.acquire(timeout=0.5):
        raise LineError(codes.STATE_CONFLICT, "QAS is locked", {"lock": path})
    try:
        for _ in range(2):
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                break
            except FileExistsError:
                try:
                    age = _dt.datetime.now().timestamp() - os.path.getmtime(path)
                except OSError:
                    age = 0
                if age > stale_s:
                    with contextlib.suppress(OSError):
                        os.remove(path)
                    continue
                holder = ""
                with contextlib.suppress(OSError):
                    with open(path, encoding="utf-8") as fh:
                        holder = fh.read()
                raise LineError(codes.STATE_CONFLICT, "QAS is locked", {"lock": path, "holder": holder})
        else:
            raise LineError(codes.STATE_CONFLICT, "QAS is locked", {"lock": path})
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"owner": owner, "pid": os.getpid()}))
        try:
            yield path
        finally:
            with contextlib.suppress(OSError):
                os.remove(path)
    finally:
        local.release()


# ------------------------------------------------------------------ pointer


def read_current(qas_root: str) -> Optional[Dict[str, Any]]:
    try:
        with open(os.path.join(qas_root, "current"), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) and data.get("color") in COLORS else None
    except (OSError, ValueError):
        return None


def write_current(qas_root: str, pointer: Dict[str, Any]) -> None:
    """Atomic switch: write current.tmp then os.replace onto current."""
    tmp = os.path.join(qas_root, "current.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(pointer, fh)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, os.path.join(qas_root, "current"))


def current_dir(qas_root: str) -> Optional[str]:
    cur = read_current(qas_root)
    return os.path.join(qas_root, cur["color"]) if cur else None


# ------------------------------------------------------------------ deployer


@dataclass
class DeployResult:
    deployed: bool                      # pointer switched to a new color
    reason: str = ""                    # "ok" | "already_live" | "window_closed" | "queue_not_drained" | "smoke_fail"
    color: str = ""                     # color now live
    sha: str = ""
    gate: Optional[Gate] = None
    detail: Dict[str, Any] = field(default_factory=dict)


class Deployer:
    def __init__(self, store: Any, repo: str, cfg: Optional[Config] = None, main: str = "main",
                 qas_root: Optional[str] = None, smoke_cmd: Union[None, str, Sequence[str]] = None,
                 clock: Any = None, now_fn: Optional[Callable[[], _dt.datetime]] = None,
                 smoke_timeout_s: float = 300):
        self.store = store
        self.repo = os.path.abspath(repo)
        self.cfg = cfg or load_config()
        self.main = main
        self.qas_root = os.path.abspath(qas_root or os.path.join(self.cfg.workroot, "qas"))
        self.smoke_cmd = smoke_cmd if smoke_cmd is not None else (os.environ.get("LINE_SMOKE_CMD") or None)
        self.clock = clock or getattr(store, "clock", None) or SystemClock()
        self.now_fn = now_fn or _dt.datetime.now
        self.smoke_timeout_s = smoke_timeout_s

    # policy
    def window_open(self) -> bool:
        return in_windows(list(self.cfg.deploy_windows or []), self.now_fn())

    def may_deploy(self, queue_drained: bool = True, urgent: bool = False, human: bool = False) -> tuple:
        """-> (allowed, reason)."""
        if urgent:
            return True, "urgent"
        if human:
            return True, "human"
        if self.cfg.deploy_windows:
            return (True, "window") if self.window_open() else (False, "window_closed")
        return (True, "queue_drained") if queue_drained else (False, "queue_not_drained")

    def current(self) -> Optional[Dict[str, Any]]:
        return read_current(self.qas_root)

    def _smoke_argv(self, dest: str = "") -> List[str]:
        if not self.smoke_cmd:
            st = stacks.for_repo(dest or self.repo)
            if not st.is_python:              # non-Python target: its smoke (e.g. npm test), deps from the repo
                if dest:
                    st.prepare(dest)
                return st.smoke_argv(dest or self.repo)
            if dest:                          # a Node app in a sub-folder: its deps are not in the export
                stacks.prepare_nested(dest)
            return python_argv("-m", "unittest")
        if isinstance(self.smoke_cmd, str):
            return shlex.split(self.smoke_cmd, posix=os.name != "nt")
        return list(self.smoke_cmd)

    def _export(self, sha: str, dest: str) -> None:
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        os.makedirs(dest)
        fd, tar = tempfile.mkstemp(suffix=".tar", dir=self.qas_root)
        os.close(fd)
        try:
            git(self.repo, "archive", "--format=tar", "-o", tar, sha)
            with tarfile.open(tar) as tf:
                for m in tf.getmembers():   # refuse absolute / parent paths
                    if m.name.startswith(("/", "\\")) or ".." in m.name.replace("\\", "/").split("/"):
                        raise LineError(codes.BUILD_FAIL, "unsafe path in archive: %s" % m.name)
                tf.extractall(dest)
        finally:
            with contextlib.suppress(OSError):
                os.remove(tar)

    def deploy(self, run: str, ref: str = "", urgent: bool = False, human: bool = False,
               queue_drained: bool = True) -> DeployResult:
        ok, why = self.may_deploy(queue_drained, urgent, human)
        cur = self.current()
        if not ok:
            return DeployResult(False, why, (cur or {}).get("color", ""), (cur or {}).get("sha", ""))
        sha = git_out(self.repo, "rev-parse", ref or self.main)
        if cur and cur.get("sha") == sha and cur.get("run") == run:
            return DeployResult(False, "already_live", cur["color"], sha)

        with qas_lock(self.qas_root, "deploy:%s" % run):
            cur = self.current()
            color = other_color((cur or {}).get("color"))
            dest = os.path.join(self.qas_root, color)
            self._export(sha, dest)
            smoke = run_cmd(self._smoke_argv(dest), cwd=dest, timeout=self.smoke_timeout_s)
            ts = self.clock.now_ms()
            env = run_env(self.store, self.cfg, run)
            body = {"color": color, "sha": sha, "previous": cur, "urgent": urgent, "human": human, "policy": why}
            if not smoke["ok"]:
                gate = Gate.fail(codes.SMOKE_FAIL, color=color, sha=sha, output=smoke["output"])
                self.store.put(E_DEPLOY, "%s:%s" % (run, color),
                               {"id": "%s:%s" % (run, color), "run": run, "color": color, "sha": sha,
                                "state": "failed", "ts_ms": ts, "output": smoke["output"]}, run=run)
                put_gate(self.store, run, "", 0, "smoke", gate)
                live = (cur or {}).get("color", "")
                self.store.emit(codes.DEPLOY_DONE, env, dict(body, ok=False, code=codes.SMOKE_FAIL, live=live,
                                                             output=smoke["output"][-1500:]))
                return DeployResult(False, "smoke_fail", live, (cur or {}).get("sha", ""), gate,
                                    {"tried": color, "output": smoke["output"]})
            write_current(self.qas_root, {"color": color, "sha": sha, "run": run, "ts_ms": ts})
            self.store.put(E_DEPLOY, "%s:%s" % (run, color),
                           {"id": "%s:%s" % (run, color), "run": run, "color": color, "sha": sha,
                            "state": "live", "ts_ms": ts}, run=run)
            if cur:
                prev_id = "%s:%s" % (run, cur["color"])
                prev = self.store.get(E_DEPLOY, prev_id)
                if prev and prev.get("state") == "live":
                    self.store.put(E_DEPLOY, prev_id, dict(prev, state="idle"), run=run)
            gate = Gate.passed(color=color, sha=sha)
            put_gate(self.store, run, "", 0, "smoke", gate)
            self.store.emit(codes.DEPLOY_DONE, env, dict(body, ok=True, live=color))
            return DeployResult(True, "ok", color, sha, gate, {"dir": dest})


__all__ = ["Deployer", "DeployResult", "COLORS", "in_windows", "parse_window", "qas_lock",
           "read_current", "write_current", "current_dir", "other_color"]
