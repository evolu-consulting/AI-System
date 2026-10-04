"""WRK-FR-01 · WRK-FR-05 · LISTEN `job_enqueued` / `job_cancel` trên kết nối riêng (plan-runtime
§2.1, §2.3). Rớt kết nối → mở lại sau 1 s, luỹ thừa tới 10 s; poll của claimer vẫn chạy.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import ValidationError

from agent_runtime.contracts.hub import JobCancelPayload
from agent_runtime.db.pool import ListenConn
from agent_runtime.log import get_logger
from agent_runtime.queue.supervisor import Supervisor

CH_ENQUEUED = "job_enqueued"
CH_CANCEL = "job_cancel"
BACKOFF_MIN_S = 1.0
BACKOFF_MAX_S = 10.0
PING_S = 5.0

Connect = Callable[[], Awaitable[ListenConn]]


class Listener:
    def __init__(self, connect: Connect, wake: asyncio.Event, supervisor: Supervisor) -> None:
        self._connect, self._wake, self._sup = connect, wake, supervisor

    def on_notify(self, _conn: Any, _pid: int, channel: str, payload: str) -> None:
        if channel == CH_ENQUEUED:
            self._wake.set()
            return
        try:
            msg = JobCancelPayload.model_validate_json(payload)
        except ValidationError:
            get_logger().warning("listen.bad_payload", channel=channel)
            return
        self._sup.stop(str(msg.job_id), "cancel")

    async def _attach(self, conn: ListenConn) -> None:
        await conn.add_listener(CH_ENQUEUED, self.on_notify)
        await conn.add_listener(CH_CANCEL, self.on_notify)
        self._wake.set()  # có thể đã lỡ NOTIFY lúc chưa LISTEN

    async def _hold(self, conn: ListenConn) -> None:
        """Giữ kết nối; ping định kỳ để phát hiện rớt."""
        while not conn.is_closed():
            await asyncio.sleep(PING_S)
            async with asyncio.timeout(PING_S):
                await conn.execute("SELECT 1")

    async def run(self, first: ListenConn | None = None) -> None:
        log = get_logger()
        conn, backoff = first, BACKOFF_MIN_S
        while True:
            try:
                if conn is None:
                    conn = await self._connect()
                await self._attach(conn)
                backoff = BACKOFF_MIN_S
                await self._hold(conn)
            except Exception as err:  # mọi lỗi kết nối/LISTEN → mở lại
                log.warning("listen.lost", error=type(err).__name__, retry_s=backoff)
            if conn is not None:
                await _close(conn)
            conn = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX_S)


async def _close(conn: ListenConn) -> None:
    try:
        await conn.close()
    except Exception:  # đóng kết nối đã hỏng
        return
