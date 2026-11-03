"""WRK-FR-23 · H1-R20 · HUB-H1-AC-04 · Giết group job host sót (plan-runtime §2.4, plan-db §5.5).

Chỉ kill khi `/proc/<pgid>/cmdline` chứa `agent_runtime.runtimes.cli.child` **và**
`--job-id=<job_id>` (tránh pid bị tái dùng); SIGTERM → chờ `grace_s` → SIGKILL.
"""

from __future__ import annotations

import asyncio
import os
import signal
import time
from pathlib import Path

CHILD_MODULE = "agent_runtime.runtimes.cli.child"
WARM_FLAG = "--warm"  # = runtimes/cli/protocol.py (queue không import runtimes.cli ở đây)
_PROC = Path("/proc")
_POLL_S = 0.1


def read_cmdline(pid: int, proc: Path = _PROC) -> str:
    try:
        raw = (proc / str(pid) / "cmdline").read_bytes()
    except OSError:
        return ""
    return raw.replace(b"\0", b" ").decode(errors="replace")


def read_cwd(pid: int, proc: Path = _PROC) -> str:
    try:
        return os.readlink(proc / str(pid) / "cwd")
    except OSError:
        return ""


def is_job_host(cmdline: str, job_id: str, cwd: str = "") -> bool:
    """CR-114: host dựng sẵn (`--warm`) không có `--job-id` — gắn job thì `chdir work/<job_id>`,
    nên nhận theo tên thư mục cwd (pid tái dùng không trùng cả module, cờ và cwd)."""
    if CHILD_MODULE not in cmdline:
        return False
    args = cmdline.split()
    if f"--job-id={job_id}" in args:
        return True
    name = Path(cwd.removesuffix(" (deleted)")).name  # cwd đã bị dọn vẫn là của job đó
    return WARM_FLAG in args and bool(job_id) and name == job_id


def _group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    return True


def _signal_group(pgid: int, sig: signal.Signals) -> None:
    try:
        os.killpg(pgid, sig)
    except (ProcessLookupError, PermissionError):
        pass


async def kill_job_group(pgid: int | None, job_id: str, grace_s: float) -> bool:
    """True nếu đã gửi tín hiệu (group đúng là job host của `job_id`)."""
    if not pgid or not is_job_host(read_cmdline(pgid), job_id, read_cwd(pgid)):
        return False
    _signal_group(pgid, signal.SIGTERM)
    deadline = time.monotonic() + grace_s
    while _group_alive(pgid) and time.monotonic() < deadline:  # noqa: ASYNC110 — poll /proc
        await asyncio.sleep(_POLL_S)
    if _group_alive(pgid):
        _signal_group(pgid, signal.SIGKILL)
    return True
