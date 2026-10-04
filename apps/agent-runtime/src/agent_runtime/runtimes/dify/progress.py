"""H2a-R12 · RT7 · Gộp `job.progress` của job `workflow.async` (`plan-runtime-dify` §3.5): tối đa 1
sự kiện/giây, giữ sự kiện mới nhất (phát khi hết khoảng chờ). `message` là câu tĩnh do host dựng
(không tên node/workflow). `close()` bỏ sự kiện còn chờ và chờ lần phát đang dở — gọi trước XADD kết
thúc để không có `job.progress` sau `job.result`/`job.failed`.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress

RUNNING = "Đang chạy lệnh"
INTERVAL_S = 1.0

Publish = Callable[[str], Awaitable[None]]


def step_message(n: int) -> str:
    return f"Đang chạy bước {n}"


def retry_message(k: int, of: int) -> str:
    return f"Đang thử lại ({k}/{of})"


class Throttle:
    def __init__(self, publish: Publish, interval_s: float = INTERVAL_S) -> None:
        self._publish, self._interval = publish, interval_s
        self._last: float | None = None
        self._pending: str | None = None
        self._timer: asyncio.Task[None] | None = None
        self._sending: asyncio.Task[None] | None = None
        self._closed = False

    def push(self, message: str) -> None:
        if self._closed:
            return
        self._pending = message
        if self._timer is None or self._timer.done():
            self._timer = asyncio.create_task(self._flush_later())

    async def _flush_later(self) -> None:
        if self._last is not None:
            wait = self._last + self._interval - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
        message, self._pending = self._pending, None
        if message is None or self._closed:
            return
        self._last = time.monotonic()
        self._sending = asyncio.current_task()
        try:
            await asyncio.shield(self._publish(message))
        finally:
            self._sending = None

    async def close(self) -> None:
        self._closed = True
        self._pending = None
        timer = self._timer
        if timer is None or timer.done():
            return
        if self._sending is timer:  # đang XADD: chờ xong (giữ thứ tự seq)
            with suppress(Exception):
                await timer
            return
        timer.cancel()
        with suppress(asyncio.CancelledError):
            await timer
