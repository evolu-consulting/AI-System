"""WRK-FR-23 · WRK-BR-04 · H1-R20 · Quét orphan (plan-db §5.5) — **chỉ orphan** (readiness #16;
hết hạn `queued` là việc của Hub, plan-db §8 R11).

`running` ∧ `heartbeat_at` quá `AGENT_RT_ORPHAN_S` → `failed`/`orphaned` (mọi worker, idempotent;
Hub cũng quét). Bên nhận dòng XADD `job.failed`; job của `worker_id` mình → giết group.
Khởi động lại / dừng (plan-runtime §2.4, §1.5): `running` của `worker_id` mình → `orphaned`.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace

from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import OrphanRow
from agent_runtime.db.pool import Pool
from agent_runtime.log import get_logger
from agent_runtime.queue.host import JobEvents
from agent_runtime.queue.orphans import kill_job_group
from agent_runtime.queue.supervisor import Supervisor

SWEEP_MAX_S = 10.0


@dataclass(frozen=True)
class SweepConfig:
    worker_id: str
    orphan_s: float
    kill_grace_s: float

    @property
    def every_s(self) -> float:
        return min(SWEEP_MAX_S, self.orphan_s)


async def _settle(rows: list[OrphanRow], events: JobEvents, kill_grace_s: float) -> None:
    for row in rows:
        await kill_job_group(row.pgid, row.id, kill_grace_s)
        await events.orphaned(row)


async def sweep_once(pool: Pool, events: JobEvents, sup: Supervisor, cfg: SweepConfig) -> int:
    async with pool.acquire() as conn:
        rows = await jobs_sql.sweep_orphans(conn, cfg.orphan_s)
    settle: list[OrphanRow] = []
    for row in rows:
        if row.worker_id == cfg.worker_id:
            sup.stop(row.id, "lost")
            settle.append(row)
        else:  # pgid của máy/worker khác: không giết, chỉ XADD
            settle.append(replace(row, pgid=None))
    await _settle(settle, events, cfg.kill_grace_s)
    return len(rows)


async def run_sweeper(pool: Pool, events: JobEvents, sup: Supervisor, cfg: SweepConfig) -> None:
    log = get_logger()
    while True:
        try:
            n = await sweep_once(pool, events, sup, cfg)
            if n:
                log.warning("sweep.orphaned", count=n)
        except (OSError, TimeoutError) as err:
            log.warning("sweep.failed", error=type(err).__name__)
        await asyncio.sleep(cfg.every_s)


async def orphan_own_jobs(pool: Pool, events: JobEvents, cfg: SweepConfig) -> int:
    """SQL "Khởi động lại": mọi `running` của `worker_id` → `orphaned`, giết pgid còn sống."""
    async with pool.acquire() as conn:
        rows = await jobs_sql.restart_orphans(conn, cfg.worker_id)
    await _settle(rows, events, cfg.kill_grace_s)
    return len(rows)
