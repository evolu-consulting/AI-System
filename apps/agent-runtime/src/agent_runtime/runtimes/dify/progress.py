"""H2a-R12 · RT7 · Gộp `job.progress` của job `workflow.async` (`plan-runtime-dify` §3.5): tối đa 1
sự kiện/giây, giữ sự kiện mới nhất (phát khi hết khoảng chờ). `message` là câu tĩnh do host dựng
(không tên node/workflow). `close()` chờ lần phát đang dở rồi phát nốt sự kiện còn chờ (`flush`, giữ
khoảng 1 s) — gọi trước XADD kết thúc để không có `job.progress` sau `job.result`/`job.failed`.
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
        self._sending = False
        self._closed = False

    def push(self, message: str) -> None:
        if self._closed:
            return
        self._pending = message
        if self._timer is None or self._timer.done():
            self._timer = asyncio.create_task(self._drain())

    async def _drain(self) -> None:
        """Phát tới khi hết tin chờ: tin `push` lúc đang XADD được phát ở lượt sau (review 1 C9)."""
        while self._pending is not None and not self._closed:
            await self._wait_slot()
            if self._closed:
                return
            await self._send_pending()

    async def _wait_slot(self) -> None:
        if self._last is not None:
            wait = self._last + self._interval - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)

    async def _send_pending(self) -> None:
        message, self._pending = self._pending, None
        if message is None:
            return
        self._last = time.monotonic()
        self._sending = True
        try:
            await asyncio.shield(self._publish(message))
        finally:
            self._sending = False

    async def close(self, flush: bool = True) -> None:
        """Dừng nhận tin. Lần phát đang dở → chờ xong (giữ thứ tự seq). `flush` → phát nốt tin chờ
        (vẫn giữ khoảng ≥ `interval`) trước khi người gọi XADD kết thúc; `flush=False` (job `lost`/
        `shutdown`, không ghi kết thúc) → bỏ tin chờ."""
        self._closed = True
        timer = self._timer
        if timer is not None and not timer.done():
            if self._sending:
                with suppress(Exception):
                    await timer
            else:
                timer.cancel()
                with suppress(asyncio.CancelledError):
                    await timer
        if flush and self._pending is not None:
            await self._wait_slot()
            with suppress(Exception):
                await self._send_pending()
        self._pending = None
