"""CR-114 hub-warm-runtime — host `child --warm` thật cho `WarmPool` (cùng cách spawn của
`host_proc.py`: group riêng, env tường minh, stdout qua `StdoutPipe`), chỉ khác: cwd/TMPDIR trung
tính `work/.warm` (chưa biết job), stderr → `log/warm/<pid>.log` tới lúc gắn job.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from agent_runtime.runtimes.cli.protocol import MAX_LINE_BYTES, WARM_READY, warm_argv
from agent_runtime.runtimes.cli.stdout_pipe import StdoutPipe
from agent_runtime.runtimes.cli.warm_pool import WarmOps, WarmPool
from agent_runtime.sandbox import process as pg
from agent_runtime.sandbox.env import TMP_SUBDIR, job_host_env

if TYPE_CHECKING:
    from agent_runtime.runtimes.cli.runner import HostConfig

WARM_DIR = ".warm"
_PY_ENV_KEYS = ("VIRTUAL_ENV", "PYTHONPATH")
MIN_FREE_MB = 512  # dưới mức này không dựng thêm host chờ (trần bộ nhớ)
READY_TIMEOUT_S = 60.0  # lưới an toàn cho host treo lúc import (không phải cơ chế chờ)
_MEMINFO = Path("/proc/meminfo")


@dataclass(eq=False)
class WarmHost:
    proc: asyncio.subprocess.Process
    pipe: StdoutPipe
    out: asyncio.StreamReader


def mem_ok(meminfo: Path = _MEMINFO, min_mb: int = MIN_FREE_MB) -> bool:
    try:
        for line in meminfo.read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024 >= min_mb
    except (OSError, ValueError, IndexError):
        return True  # không đọc được → không chặn
    return True


async def spawn_warm(cfg: HostConfig) -> WarmHost:
    cwd = cfg.work_root / WARM_DIR
    (cwd / TMP_SUBDIR).mkdir(mode=0o700, parents=True, exist_ok=True)
    py_env = {k: os.environ[k] for k in _PY_ENV_KEYS if os.environ.get(k)}
    env = job_host_env(cfg.home, cwd, cfg.app_env, py_env)
    logs = cfg.log_dir / WARM_DIR
    logs.mkdir(mode=0o700, parents=True, exist_ok=True)
    err_fd = os.open(logs / "warm.stderr.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    pipe = StdoutPipe()
    try:
        proc = await asyncio.create_subprocess_exec(
            *warm_argv(cfg.python),
            stdin=asyncio.subprocess.PIPE,
            stdout=pipe.write_fd,
            stderr=err_fd,
            cwd=cwd,
            env=env,
            start_new_session=True,
        )
    except BaseException:
        pipe.close()
        raise
    finally:
        os.close(err_fd)
        pipe.close_write()
    pg.track_host(proc.pid)
    host = WarmHost(proc, pipe, await pipe.attach(MAX_LINE_BYTES))
    try:  # chỉ vào bể khi đã import xong; chết/hỏng lúc dựng = lỗi dựng (bể đếm crash)
        line = await asyncio.wait_for(host.out.readline(), READY_TIMEOUT_S)
    except BaseException:
        await discard_warm(host, cfg.kill_grace_s)
        raise
    if line != WARM_READY:
        await discard_warm(host, cfg.kill_grace_s)
        raise WarmSpawnError("warm host not ready")
    return host


class WarmSpawnError(RuntimeError):
    pass


async def discard_warm(host: WarmHost, grace_s: float = 1.0) -> None:
    """Host chưa gắn job: đóng stdin (con thoát êm) → quá `grace_s` giết group; đóng pipe."""
    proc = host.proc
    try:
        if proc.stdin is not None:
            proc.stdin.close()
        if proc.returncode is None:
            with suppress(TimeoutError):
                await asyncio.wait_for(proc.wait(), grace_s)
        if proc.returncode is None:
            await pg.kill_group(proc.pid, proc.wait, grace_s, {})
        pg.untrack_host(proc.pid)
    finally:
        host.pipe.close()


def make_pool(cfg: HostConfig, size: int) -> WarmPool[WarmHost] | None:
    if size <= 0:
        return None
    ops = WarmOps[WarmHost](
        spawn=lambda: spawn_warm(cfg),
        discard=lambda h: discard_warm(h, cfg.kill_grace_s),
        wait=lambda h: h.proc.wait(),
        alive=lambda h: h.proc.returncode is None,
        mem_ok=mem_ok,
    )
    return WarmPool(size, ops)
