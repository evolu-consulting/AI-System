"""WRK-FR-04 · WRK-FR-05 · WRK-NFR-06 · AC-W03 · AC-W10 · Giết process group job host
(plan-runtime §2.3 bước 3–6).

SIGTERM group → chờ job host thoát ≤ `grace_s` → SIGKILL group → quét `/proc/*/stat` (`pgrp`)
mỗi 100 ms tới 1,5 s; còn pid → SIGKILL từng pid + log `pg_leak`.
**Dự phòng §13** (CLI có thể sinh con thoát group): chụp cây `ppid` của job host trước khi giết và
giết cả cây; Runtime đặt `PR_SET_CHILD_SUBREAPER` để cháu mồ côi về tay mình (thu zombie ở đây).
"""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import os
import signal
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

from agent_runtime.log import get_logger

PROC = Path("/proc")
CONFIRM_S = 1.5
POLL_S = 0.1
PR_SET_CHILD_SUBREAPER = 36


def _stat(pid: int, proc: Path) -> tuple[str, int, int] | None:
    """(state, ppid, pgrp) từ `/proc/<pid>/stat` (tên process có thể chứa khoảng trắng/`)`)."""
    try:
        raw = (proc / str(pid) / "stat").read_text()
    except OSError:
        return None
    rest = raw[raw.rfind(")") + 2 :].split()
    return rest[0], int(rest[1]), int(rest[2])


def _all_stats(proc: Path) -> dict[int, tuple[str, int, int]]:
    out: dict[int, tuple[str, int, int]] = {}
    for p in proc.iterdir():
        if p.name.isdigit() and (st := _stat(int(p.name), proc)):
            out[int(p.name)] = st
    return out


def group_pids(pgid: int, proc: Path = PROC) -> list[int]:
    """Pid còn sống (không tính zombie) có `pgrp == pgid`."""
    return [p for p, (st, _, g) in _all_stats(proc).items() if g == pgid and st != "Z"]


def descendants(root: int, proc: Path = PROC) -> set[int]:
    """Mọi hậu duệ còn sống của `root` theo `ppid` (kể cả đã `setsid` sang group khác)."""
    stats = _all_stats(proc)
    children: dict[int, list[int]] = {}
    for pid, (_, ppid, _) in stats.items():
        children.setdefault(ppid, []).append(pid)
    found: set[int] = set()
    stack = [root]
    while stack:
        for c in children.get(stack.pop(), []):
            if c not in found and stats[c][0] != "Z":
                found.add(c)
                stack.append(c)
    return found


def _alive(pids: set[int], proc: Path) -> set[int]:
    return {p for p in pids if (st := _stat(p, proc)) and st[0] != "Z"}


def _signal_group(pgid: int, sig: signal.Signals) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pgid, sig)


def _signal_pids(pids: set[int], sig: signal.Signals) -> None:
    for p in pids:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(p, sig)


def reap(pids: set[int]) -> None:
    """Thu zombie là con của Runtime (subreaper) — không chạm pid asyncio đang theo dõi."""
    for p in pids:
        with contextlib.suppress(ChildProcessError, OSError):
            os.waitpid(p, os.WNOHANG)


async def _confirm(pgid: int, tree: set[int], proc: Path) -> set[int]:
    deadline = time.monotonic() + CONFIRM_S
    while True:
        left = set(group_pids(pgid, proc)) | _alive(tree, proc)
        if not left or time.monotonic() >= deadline:
            return left
        await asyncio.sleep(POLL_S)


async def kill_group(
    pgid: int, wait_exit: Callable[[], Awaitable[object]], grace_s: float, proc: Path = PROC
) -> set[int]:
    """Giết group + cây của job host (`pgid` = pid job host; asyncio tự thu pid này).
    Trả pid sót (đã SIGKILL từng pid)."""
    tree = (descendants(pgid, proc) | set(group_pids(pgid, proc))) - {pgid}
    _signal_group(pgid, signal.SIGTERM)
    _signal_pids(tree, signal.SIGTERM)
    with contextlib.suppress(TimeoutError):
        async with asyncio.timeout(grace_s):
            await wait_exit()
    _signal_group(pgid, signal.SIGKILL)
    _signal_pids(_alive(tree, proc), signal.SIGKILL)
    left = await _confirm(pgid, tree, proc)
    if left:
        get_logger().error("pg_leak", pgid=pgid, count=len(left))
        _signal_pids(left, signal.SIGKILL)
    reap(tree | left)
    return left


def enable_subreaper() -> bool:
    """`prctl(PR_SET_CHILD_SUBREAPER, 1)` cho process cha; lỗi → False (chỉ log)."""
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        ok = libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) == 0
    except (OSError, AttributeError):
        ok = False
    if not ok:
        get_logger().warning("subreaper.unavailable")
    return ok
