"""WRK-FR-01 · WRK-FR-20 · WRK-FR-24 · WRK-BR-05 · WRK-NFR-01 · Vòng claim (plan-runtime §2.1).

Đánh thức bằng `LISTEN job_enqueued` (chỉ là tín hiệu) hoặc poll `AGENT_RT_POLL_S`; mỗi lần thức
claim lặp tới khi rỗng (SQL claim plan-db §5.4, khoá `K_CLAIM` toàn cục, slot provider + tenant đếm
trong DB) rồi XADD `job.started` sau COMMIT, sau đó mới giao job cho `Supervisor`.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress

from agent_runtime.db import jobs_sql
from agent_runtime.db.pool import Pool
from agent_runtime.log import get_logger
from agent_runtime.queue.host import JobEvents
from agent_runtime.queue.supervisor import Supervisor


class Claimer:
    def __init__(
        self, pool: Pool, supervisor: Supervisor, events: JobEvents, providers: list[str]
    ) -> None:
        self._pool, self._sup, self._events = pool, supervisor, events
        self._providers = providers
        self.wake = asyncio.Event()

    async def claim_ready(self, worker_id: str) -> int:
        """Claim tới khi hết job hợp lệ; trả số job đã nhận."""
        n = 0
        while True:
            async with self._pool.acquire() as conn:
                job = await jobs_sql.claim_one(conn, self._providers, worker_id)
            if job is None:
                return n
            n += 1
            # `job.started` phải đứng trước mọi sự kiện của job (task job host chạy từ `start`).
            await self._events.started(job)
            self._sup.start(job)

    async def run(self, worker_id: str, poll_s: float) -> None:
        log = get_logger()
        if not self._providers:
            log.warning("claim.no_providers")
        while True:
            self.wake.clear()
            if self._providers:
                n = await self.claim_ready(worker_id)
                if n:
                    log.debug("claim.batch", count=n)
            with suppress(TimeoutError):
                async with asyncio.timeout(poll_s):
                    await self.wake.wait()
