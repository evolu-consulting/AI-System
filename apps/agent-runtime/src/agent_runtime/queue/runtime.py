"""WRK-FR-01 · WRK-FR-02 · WRK-FR-23 · H1-R20 · Khởi động / dừng phần hàng đợi của process cha
(plan-runtime §1.5 bước 3, 5–9 và pha SIGTERM; §2.4).

Thứ tự: pool + kết nối LISTEN → Redis PING → registry provider → manifest `agent_types` (mốc
"sẵn sàng") → dọn job sót của `worker_id` + reset provider `error`/`logged_out` → dịch vụ claimer,
listener, heartbeat, sweeper. H3a (plan-runtime H3a §4.4, PL2): `AGENT_RT_PROBE_S > 0` ⇒ **không**
reset mù; dịch vụ `ProbeLoop` chạy lượt `startup` ngay khi dịch vụ bắt đầu (không chặn "sẵn sàng");
`= 0` ⇒ giữ reset mù H1. Dừng: ngừng claim (TaskGroup đã huỷ dịch vụ) → dừng job đang chạy →
`orphaned` → đóng DB.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from redis.asyncio import Redis

from agent_runtime.agents.manifest import manifests
from agent_runtime.config import Settings
from agent_runtime.db import agent_types_sql, jobs_sql
from agent_runtime.db.pool import ListenConn, Pool, connect_listen, create_pool
from agent_runtime.events.job_events import RunEvents, connect_redis
from agent_runtime.log import get_logger
from agent_runtime.providers.keys import is_available
from agent_runtime.queue.claimer import Claimer
from agent_runtime.queue.cleanup import CleanupConfig, run_cleanup
from agent_runtime.queue.heartbeat import Heartbeat
from agent_runtime.queue.host import JobHost
from agent_runtime.queue.listener import Listener
from agent_runtime.queue.probe_loop import ProbeLoop, ProbeLoopCfg
from agent_runtime.queue.supervisor import Supervisor
from agent_runtime.queue.sweeper import SweepConfig, orphan_own_jobs, run_sweeper
from agent_runtime.runtimes.cli.probe import ProbeHostCfg
from agent_runtime.runtimes.cli.quota_rules import ProbeCfg

Service = Callable[[], Coroutine[Any, Any, None]]
HostFactory = Callable[[Pool, RunEvents], JobHost]
CLOSE_TIMEOUT_S = 2.0
# H2a RT6: provider chạy bằng HTTP trong process cha (`workflow.async`, không job host CLI) — claim
# khi có trong `AGENT_RT_PROVIDERS`, không đụng `provider_state`.
HTTP_PROVIDERS = frozenset({"dify"})


class UnknownProviders(ValueError):
    """`AGENT_RT_PROVIDERS` có khoá registry không có ở `APP_ENV` này (main → exit 2)."""

    def __init__(self, keys: list[str]) -> None:
        super().__init__("unknown providers")
        self.keys = keys


def registry_providers(settings: Settings) -> list[str]:
    """Provider claim được = `AGENT_RT_PROVIDERS` ∩ registry theo `APP_ENV` (WRK-FR-10); khoá lạ →
    `UnknownProviders` (không claim job mà job host sẽ không chạy được)."""
    keys = list(dict.fromkeys(settings.providers))
    unknown = [k for k in keys if k not in HTTP_PROVIDERS and not is_available(k, settings.app_env)]
    if unknown:
        raise UnknownProviders(unknown)
    return keys


@dataclass
class QueueRuntime:
    settings: Settings
    pool: Pool
    listen: ListenConn
    redis: Redis
    events: RunEvents
    supervisor: Supervisor
    claimer: Claimer
    probe: ProbeLoop | None = None

    @property
    def sweep(self) -> SweepConfig:
        s = self.settings
        return SweepConfig(s.worker_id, s.orphan_s, s.kill_grace_s)

    def services(self) -> list[Service]:
        s, sup = self.settings, self.supervisor
        dsn = s.database_url.get_secret_value()
        listener = Listener(lambda: connect_listen(dsn), self.claimer.wake, sup)
        clean = CleanupConfig(s.work_dir, s.log_dir, s.cleanup_s)
        services: list[Service] = [
            lambda: self.claimer.run(s.worker_id, s.poll_s),
            lambda: listener.run(self.listen),
            lambda: Heartbeat(self.pool, sup, self.events, self.sweep).run(s.heartbeat_s),
            lambda: run_sweeper(self.pool, self.events, sup, self.sweep),
            lambda: run_cleanup(clean, sup.held),
        ]
        if self.probe is not None:
            services.append(self.probe.run)
        return services

    async def shutdown(self) -> None:
        """SIGTERM: job đang chạy → dừng, rồi `failed`/`orphaned` + XADD (≤ 10 s tổng)."""
        log = get_logger()
        await self.supervisor.shutdown(self.settings.kill_grace_s + 1)
        try:
            n = await orphan_own_jobs(self.pool, self.events, self.sweep)
            if n:
                log.warning("runtime.jobs_orphaned", count=n)
        finally:
            await _close(self.listen.close(), self.pool.close(), self.redis.aclose())


async def _close(*aws: Coroutine[Any, Any, None]) -> None:
    with suppress(TimeoutError):
        async with asyncio.timeout(CLOSE_TIMEOUT_S):
            await asyncio.gather(*aws, return_exceptions=True)


def probe_loop_cfg(
    settings: Settings, host: ProbeHostCfg | None, providers: list[str]
) -> ProbeLoopCfg | None:
    """None ⇒ không có vòng probe (PL2: `AGENT_RT_PROBE_S=0`, hoặc không có provider CLI)."""
    s = settings
    keys = tuple(k for k in providers if k not in HTTP_PROVIDERS)
    if host is None or s.probe_s <= 0 or not keys:
        return None
    rules = ProbeCfg(s.probe_s, s.probe_logged_out_s)
    return ProbeLoopCfg(host, rules, keys, s.cooldown_default_s)


async def start(
    settings: Settings, make_host: HostFactory, probe_host: ProbeHostCfg | None = None
) -> QueueRuntime:
    log = get_logger()
    dsn = settings.database_url.get_secret_value()
    pool = await create_pool(dsn)
    listen = await connect_listen(dsn)
    redis = await connect_redis(settings.redis_url.get_secret_value())
    events = RunEvents(redis, settings.worker_id)
    providers = registry_providers(settings)
    async with pool.acquire() as conn:
        await agent_types_sql.write_manifest(conn, settings.worker_id, manifests())
    sweep = SweepConfig(settings.worker_id, settings.orphan_s, settings.kill_grace_s)
    n = await orphan_own_jobs(pool, events, sweep)
    probe_cfg = probe_loop_cfg(settings, probe_host, providers)
    if probe_cfg is None:  # PL2: probe tắt ⇒ reset mù H1
        async with pool.acquire() as conn:
            await jobs_sql.reset_providers(conn, [k for k in providers if k not in HTTP_PROVIDERS])
    log.info("runtime.ready", providers=providers, orphaned=n)
    sup = Supervisor(make_host(pool, events))
    claimer = Claimer(pool, sup, events, providers)
    probe = ProbeLoop(pool, events, probe_cfg) if probe_cfg is not None else None
    return QueueRuntime(settings, pool, listen, redis, events, sup, claimer, probe)
