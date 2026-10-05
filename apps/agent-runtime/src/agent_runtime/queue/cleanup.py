"""WRK-FR-23 · WRK-NFR-04 · Dọn đĩa định kỳ (plan-runtime §9): `work/<job_id>/` (+ mục trong
`.fake-state/`, `.fake-sessions/`, `.mcp/` — H2a; `.probe/` — H3a) quá 24 giờ; thư mục log
`<YYYY-MM-DD>/` quá 7 ngày. Theo mtime; không đi theo symlink; không đụng thư mục của job process
này đang giữ (`Supervisor.held`).
"""

from __future__ import annotations

import asyncio
import re
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from agent_runtime.log import get_logger

WORK_MAX_AGE_S = 24 * 3600.0
LOG_MAX_AGE_S = 7 * 24 * 3600.0
# `.mcp`: H2a §4.2 · `.probe` (H3a, `<work>/.probe/<provider>`): thư mục giữ, chỉ dọn mục con cũ.
STATE_DIRS = frozenset({".fake-state", ".fake-sessions", ".mcp", ".probe"})
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


@dataclass(frozen=True)
class CleanupConfig:
    work_root: Path
    log_dir: Path
    every_s: float


def _old(path: Path, max_age_s: float, now: float) -> bool:
    try:
        return now - path.lstat().st_mtime > max_age_s
    except OSError:
        return False


def _remove(path: Path) -> bool:
    try:
        if path.is_symlink() or not path.is_dir():
            path.unlink()
        else:
            shutil.rmtree(path)
    except OSError as err:
        get_logger().warning("cleanup.remove_failed", error=type(err).__name__)
        return False
    return True


def _children(root: Path) -> list[Path]:
    try:
        return list(root.iterdir())
    except OSError:
        return []


def clean_work(root: Path, held: frozenset[str], now: float) -> int:
    n = 0
    for entry in _children(root):
        if entry.name in held:
            continue
        if entry.name in STATE_DIRS and entry.is_dir() and not entry.is_symlink():
            n += sum(_remove(f) for f in _children(entry) if _old(f, WORK_MAX_AGE_S, now))
        elif entry.name not in STATE_DIRS and _old(entry, WORK_MAX_AGE_S, now):
            n += _remove(entry)
    return n


def clean_logs(root: Path, now: float) -> int:
    return sum(
        _remove(d)
        for d in _children(root)
        if _DAY.fullmatch(d.name)
        and d.is_dir()
        and not d.is_symlink()
        and _old(d, LOG_MAX_AGE_S, now)
    )


def cleanup_once(
    cfg: CleanupConfig, held: frozenset[str], now: float | None = None
) -> tuple[int, int]:
    """(số mục `work/` đã xoá, số thư mục log đã xoá)."""
    t = time.time() if now is None else now
    return clean_work(cfg.work_root, held, t), clean_logs(cfg.log_dir, t)


async def run_cleanup(cfg: CleanupConfig, held: Callable[[], list[str]]) -> None:
    """Một vòng ngay khi khởi động, rồi mỗi `every_s`."""
    log = get_logger()
    while True:
        try:
            work, logs = await asyncio.to_thread(cleanup_once, cfg, frozenset(held()))
            if work or logs:
                log.info("cleanup.done", work=work, logs=logs)
        except OSError as err:
            log.warning("cleanup.failed", error=type(err).__name__)
        await asyncio.sleep(cfg.every_s)
