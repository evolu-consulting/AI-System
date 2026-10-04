"""WRK-FR-01 · WRK-FR-02 · WRK-FR-23 · H1-R20 · Khởi động / dừng phần hàng đợi của process cha
(plan-runtime §1.5 bước 3, 5–9 và pha SIGTERM; §2.4).

Thứ tự: pool + kết nối LISTEN → registry provider → manifest `agent_types` (mốc "sẵn sàng") →
dọn job sót của `worker_id` + reset provider `error`/`logged_out` → dịch vụ claimer, listener,
heartbeat, sweeper. Dừng: ngừng claim (TaskGroup đã huỷ dịch vụ) → dừng job đang chạy →
`orphaned` → đóng DB.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from agent_runtime.agents.manifest import manifests
from agent_runtime.config import Settings
from agent_runtime.db import agent_types_sql, jobs_sql
from agent_runtime.db.pool import ListenConn, Pool, connect_listen, create_pool
from agent_runtime.log import get_logger
from agent_runtime.queue.claimer import Claimer
from agent_runtime.queue.heartbeat import run_heartbeat
from agent_runtime.queue.host import JobEvents, JobHost
from agent_runtime.queue.listener import Listener
from agent_runtime.queue.supervisor import Supervisor
from agent_runtime.queue.sweeper import SweepConfig, orphan_own_jobs, run_sweeper

Service = Callable[[], Coroutine[Any, Any, None]]
CLOSE_TIMEOUT_S = 2.0


def registry_providers(settings: Settings) -> list[str]:
    """Provider claim được. `production` + `fake-cli` đã bị chặn ở config (exit 2).

    TODO(WRK-FR-10): PY-09 — registry provider thật (chỉ provider có implementation).
    """
    return list(dict.fromkeys(settings.providers))


@dataclass
class QueueRuntime:
    settings: Settings
    pool: Pool
    listen: ListenConn
    events: JobEvents
    supervisor: Supervisor
    claimer: Claimer

    @property
    def sweep(self) -> SweepConfig:
        s = self.settings
        return SweepConfig(s.worker_id, s.orphan_s, s.kill_grace_s)

    def services(self) -> list[Service]:
        s, sup = self.settings, self.supervisor
        dsn = s.database_url.get_secret_value()
        listener = Listener(lambda: connect_listen(dsn), self.claimer.wake, sup)
        return [
            lambda: self.claimer.run(s.worker_id, s.poll_s),
            lambda: listener.run(self.listen),
            lambda: run_heartbeat(self.pool, sup, s.worker_id, s.heartbeat_s),
            lambda: run_sweeper(self.pool, self.events, sup, self.sweep),
        ]

    async def shutdown(self) -> None:
        """SIGTERM: job đang chạy → dừng, rồi `failed`/`orphaned` + XADD (≤ 10 s tổng)."""
        log = get_logger()
        await self.supervisor.shutdown(self.settings.kill_grace_s + 1)
        try:
            n = await orphan_own_jobs(self.pool, self.events, self.sweep)
            if n:
                log.warning("runtime.jobs_orphaned", count=n)
        finally:
            await _close(self.listen.close(), self.pool.close())


async def _close(*aws: Coroutine[Any, Any, None]) -> None:
    with suppress(TimeoutError):
        async with asyncio.timeout(CLOSE_TIMEOUT_S):
            await asyncio.gather(*aws, return_exceptions=True)


async def start(settings: Settings, host: JobHost, events: JobEvents) -> QueueRuntime:
    log = get_logger()
    dsn = settings.database_url.get_secret_value()
    pool = await create_pool(dsn)
    listen = await connect_listen(dsn)
    providers = registry_providers(settings)
    async with pool.acquire() as conn:
        await agent_types_sql.write_manifest(conn, settings.worker_id, manifests())
    sweep = SweepConfig(settings.worker_id, settings.orphan_s, settings.kill_grace_s)
    n = await orphan_own_jobs(pool, events, sweep)
    async with pool.acquire() as conn:
        await jobs_sql.reset_providers(conn, providers)
    log.info("runtime.ready", providers=providers, orphaned=n)
    sup = Supervisor(host)
    claimer = Claimer(pool, sup, events, providers)
    return QueueRuntime(settings, pool, listen, events, sup, claimer)
