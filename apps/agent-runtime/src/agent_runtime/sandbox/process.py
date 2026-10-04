"""WRK-FR-04 · WRK-FR-05 · WRK-NFR-06 · AC-W03 · AC-W10 · Giết process group job host
(plan-runtime §2.3 bước 3–6).

SIGTERM group → chờ job host thoát ≤ `grace_s` → SIGKILL group → quét `/proc/*/stat` (`pgrp`)
mỗi 100 ms tới 1,5 s; còn pid → SIGKILL từng pid + log `pg_leak`.
**Dự phòng §13** (CLI có thể sinh con thoát group): chụp cây `ppid` của job host trước khi giết và
giết cả cây; Runtime đặt `PR_SET_CHILD_SUBREAPER` để cháu mồ côi về tay mình (thu zombie ở đây:
cây đã chụp + mọi zombie khác có `ppid` = Runtime, trừ job host asyncio đang theo dõi — review
H1 #7). Cháu `setsid` ra đời rồi job host chết trước khi chụp cây (ppid = Runtime, pgid riêng)
→ người gọi truyền `extra` (cây tích luỹ khi job host còn sống + `pipe_holders` — review H1 v2 N2).
`PR_SET_DUMPABLE=0` ở cha (review H1 #11): process cùng uid không đọc được `/proc/<cha>/environ`
(secret); `execve` của job host đặt lại dumpable nên con không bị ảnh hưởng.
"""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import os
import signal
import time
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path

from agent_runtime.log import get_logger

PROC = Path("/proc")
CONFIRM_S = 1.5
POLL_S = 0.1
PR_SET_CHILD_SUBREAPER = 36
PR_SET_DUMPABLE = 4
_HOSTS: set[int] = set()  # pid job host asyncio đang chờ (không được `waitpid` hộ)


def track_host(pid: int) -> None:
    _HOSTS.add(pid)


def untrack_host(pid: int) -> None:
    _HOSTS.discard(pid)


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


def start_time(pid: int, proc: Path = PROC) -> int | None:
    """`starttime` (trường 22 của `/proc/<pid>/stat`) — phân biệt pid bị tái dùng."""
    try:
        raw = (proc / str(pid) / "stat").read_text()
    except OSError:
        return None
    return int(raw[raw.rfind(")") + 2 :].split()[19])


def stamp(pids: set[int], proc: Path = PROC) -> dict[int, int]:
    """`{pid: starttime}` của các pid còn sống (để giết sau mà không trúng pid tái dùng)."""
    return {p: t for p in _alive(pids, proc) if (t := start_time(p, proc)) is not None}


def still_alive(stamped: Mapping[int, int], proc: Path = PROC) -> set[int]:
    """Pid trong `stamp()` còn sống và chưa bị tái dùng."""
    return {p for p, t in stamped.items() if start_time(p, proc) == t and _alive({p}, proc)}


def pipe_holders(inode: int, proc: Path = PROC) -> set[int]:
    """Pid (trừ chính Runtime) còn mở pipe `inode` — cháu giữ stdout của job host."""
    target, me, found = f"pipe:[{inode}]", os.getpid(), set[int]()
    for p in proc.iterdir():
        if not p.name.isdigit() or int(p.name) == me:
            continue
        with contextlib.suppress(OSError):
            if any(os.readlink(fd) == target for fd in (p / "fd").iterdir()):
                found.add(int(p.name))
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


def reap_strays(proc: Path = PROC) -> int:
    """Thu zombie con của Runtime (cháu mồ côi về subreaper) không phải job host đang theo dõi
    (job host luôn là trưởng group — `start_new_session` — nên bỏ cả `pgrp == pid`)."""
    me, n = os.getpid(), 0
    for pid, (st, ppid, pgrp) in _all_stats(proc).items():
        if st == "Z" and ppid == me and pid not in _HOSTS and pgrp != pid:
            with contextlib.suppress(ChildProcessError, OSError):
                n += os.waitpid(pid, os.WNOHANG)[0] == pid
    return n


async def _confirm(pgid: int, tree: set[int], proc: Path) -> set[int]:
    deadline = time.monotonic() + CONFIRM_S
    while True:
        left = set(group_pids(pgid, proc)) | _alive(tree, proc)
        if not left or time.monotonic() >= deadline:
            return left
        await asyncio.sleep(POLL_S)


async def kill_group(
    pgid: int,
    wait_exit: Callable[[], Awaitable[object]],
    grace_s: float,
    extra: Mapping[int, int] | None = None,
) -> set[int]:
    """Giết group + cây của job host (`pgid` = pid job host; asyncio tự thu pid này) + `extra`
    (`stamp()` các pid ngoài cây đã biết thuộc job). Trả pid sót (đã SIGKILL từng pid)."""
    proc = PROC
    more = still_alive(extra or {}, proc)
    tree = (descendants(pgid, proc) | set(group_pids(pgid, proc)) | more) - {pgid}
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
    await _reap_settle(tree | left, proc)
    return left


async def _reap_settle(pids: set[int], proc: Path) -> None:
    """Thu zombie tới khi không còn pid nào của job là zombie con Runtime (≤ `CONFIRM_S`).
    Smoke I2: cháu `claude` thành zombie (ppid = Runtime) sau lần `reap` duy nhất → `<defunct>`."""
    me, deadline = os.getpid(), time.monotonic() + CONFIRM_S
    while True:
        reap(pids)
        reap_strays(proc)
        if not any((st := _stat(p, proc)) and st[1] == me for p in pids):
            return
        if time.monotonic() >= deadline:
            return
        await asyncio.sleep(POLL_S)


def _prctl(option: int, value: int) -> bool:
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        return libc.prctl(option, value, 0, 0, 0) == 0
    except (OSError, AttributeError):
        return False


def disable_dumpable() -> bool:
    """`prctl(PR_SET_DUMPABLE, 0)` cho process cha; lỗi → False (chỉ log)."""
    ok = _prctl(PR_SET_DUMPABLE, 0)
    if not ok:
        get_logger().warning("dumpable.unchanged")
    return ok


def enable_subreaper() -> bool:
    """`prctl(PR_SET_CHILD_SUBREAPER, 1)` cho process cha; lỗi → False (chỉ log)."""
    ok = _prctl(PR_SET_CHILD_SUBREAPER, 1)
    if not ok:
        get_logger().warning("subreaper.unavailable")
    return ok
