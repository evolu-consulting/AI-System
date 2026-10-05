"""WRK-FR-03 · R19–R21 · `DeltaPump` phía cha (plan-runtime H2b §3.3, §3.5): nhận `Delta` của job
host, gom bằng `DeltaBuffer` (≥ `flush_chars` ký tự hoặc ≥ `flush_ms`), hẹn giờ `asyncio` xả phần
còn lại, XADD `job.delta{kind, text}` qua `RunEvents.delta` (`seq` chung bộ đếm job).

Mốc thời gian gom = lúc nhận chữ đầu tiên (không phải lúc tạo pump — spawn job host có thể > 1 s,
khi đó chữ đầu bị xả lẻ ngay). `kind` đầu tiên chốt; `kind` khác ⇒ bỏ + log
`job.delta_kind_changed` (Hub lọc theo kind đầu, H4).
`asyncio.Lock` giữa xả do hẹn giờ và `drain` ⇒ thứ tự chữ giữ nguyên, `drain` xong là hết chữ
(mọi `job.delta` trước sự kiện kết thúc, H6). `streamed` bật khi đã **nhận** chữ (chắc chắn được
XADD ở lần xả kế tiếp / `drain`) — chặt hơn "đã XADD": quyết định không thử lại (R21) đúng cả khi
chữ còn trong bộ đệm lúc job host thoát (`spec-decisions` PY03-2).
Mẻ chữ đã lấy khỏi bộ đệm được XADD trong task riêng bọc `asyncio.shield` (review 1 #3): huỷ reader
/ hẹn giờ giữa XADD không làm mất mẩu đã `take()` (hở `seq`); lần xả sau và `close` chờ mẻ đang
bay xong trước (giữ thứ tự, không XADD sau sự kiện kết thúc).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from contextlib import suppress
from typing import Literal, Protocol

from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.log import get_logger
from agent_runtime.runtimes.cli.delta import DeltaBuffer

DeltaKind = Literal["answer", "done", "partial"]


class DeltaSink(Protocol):
    """= `RunEvents.delta` (unit tiêm bản giả)."""

    async def delta(self, job: ClaimedJob, kind: str, text: str) -> None: ...


class FlushCfg(Protocol):
    """= `HostConfig` (env `AGENT_RT_DELTA_FLUSH_MS` / `_CHARS`, §8)."""

    @property
    def delta_flush_ms(self) -> int: ...
    @property
    def delta_flush_chars(self) -> int: ...


class DeltaPump:
    def __init__(
        self,
        events: DeltaSink,
        job: ClaimedJob,
        cfg: FlushCfg,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._events, self._job = events, job
        self._new_buf = lambda: DeltaBuffer(cfg.delta_flush_chars, cfg.delta_flush_ms, clock=clock)
        self._buf = self._new_buf()
        self._kind: DeltaKind | None = None
        self._lock = asyncio.Lock()
        self._timer: asyncio.Task[None] | None = None
        self._inflight: asyncio.Task[None] | None = None  # mẻ XADD đang bay (shield)
        self.streamed = False  # đã nhận chữ để phát (R21: không thử lại / dựng lại session)
        self.sent = 0  # số `job.delta` đã XADD

    async def add(self, kind: DeltaKind, text: str) -> None:
        if not text:
            return
        if self._kind is None:
            self._kind = kind
        elif kind != self._kind:
            get_logger().warning("job.delta_kind_changed", first=self._kind, kind=kind)
            return
        if not self.streamed:  # mốc thời gian = chữ đầu tiên (không tính lúc spawn job host)
            self._buf = self._new_buf()
        self.streamed = True
        await self._flush(lambda: self._buf.add(text))
        if self._buf.pending and (self._timer is None or self._timer.done()):
            self._timer = asyncio.create_task(self._tick())

    async def drain(self) -> None:
        """Xả hết chữ còn trong bộ đệm rồi dừng hẹn giờ — gọi trước `job.result`/`job.failed`."""
        await self._flush(self._buf.take)
        await self.close()

    async def close(self) -> None:
        """Dừng hẹn giờ, không xả (job dừng không ghi — `stopped_no_write`, lỗi giữa chừng)."""
        timer, self._timer = self._timer, None
        if timer is not None and not timer.done():
            timer.cancel()
            with suppress(asyncio.CancelledError):
                await timer
        await self._settle()

    async def _tick(self) -> None:
        while self._buf.pending:
            await asyncio.sleep(max(0.0, self._buf.wait_s()))
            await self._flush(lambda: self._buf.take() if self._buf.due() else [])

    async def _flush(self, chunks_of: Callable[[], list[str]]) -> None:
        """Dưới khoá: chờ mẻ trước xong, lấy chunk từ bộ đệm, XADD trong task được shield."""
        async with self._lock:
            await self._settle()
            chunks, kind = chunks_of(), self._kind
            if kind is None or not chunks:
                return
            self._inflight = task = asyncio.ensure_future(self._send(kind, chunks))
            await asyncio.shield(task)

    async def _settle(self) -> None:
        """Chờ mẻ XADD đang bay (người gọi trước bị huỷ giữa chừng); lỗi của nó đã/không báo."""
        task = self._inflight
        if task is None:
            return
        if not task.done():
            await asyncio.wait({task})
        if not task.cancelled():
            task.exception()  # đã đánh dấu đọc — người gọi gốc (bị huỷ) không nhận được

    async def _send(self, kind: DeltaKind, chunks: list[str]) -> None:
        for text in chunks:
            self.sent += 1
            await self._events.delta(self._job, kind, text)
