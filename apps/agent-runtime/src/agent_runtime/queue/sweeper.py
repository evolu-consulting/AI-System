"""WRK-FR-23 · WRK-BR-04 · H1-R20 · Quét orphan (plan-db §5.5) — **chỉ orphan** (readiness #16;
hết hạn `queued` là việc của Hub, plan-db §8 R11).

`running` ∧ `heartbeat_at` quá `AGENT_RT_ORPHAN_S` → `failed`/`orphaned` (mọi worker, idempotent;
Hub cũng quét). Bên nhận dòng XADD `job.failed`; job của `worker_id` mình → giết group.
Khởi động lại / dừng (plan-runtime §2.4, §1.5): `running` của `worker_id` mình → `orphaned`.
H2a (AC-W06, R7, RT4 — `plan-runtime` §3.8): câu requeue `workflow.async` chạy **trước** câu
`failed` trên cùng kết nối; dòng requeue không XADD (NOTIFY trong SQL), job của mình → dừng `lost`.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace

from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import OrphanRow
from agent_runtime.db.pool import DB_ERRORS, Pool
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


async def settle(rows: list[OrphanRow], events: JobEvents, kill_grace_s: float) -> None:
    """Sau COMMIT: giết group sót (kiểm cmdline) rồi XADD `job.failed` orphaned."""
    for row in rows:
        await kill_job_group(row.pgid, row.id, kill_grace_s)
        await events.orphaned(row)


async def sweep_once(pool: Pool, events: JobEvents, sup: Supervisor, cfg: SweepConfig) -> int:
    async with pool.acquire() as conn:
        requeued = await jobs_sql.requeue_orphans(conn, cfg.orphan_s)
        rows = await jobs_sql.sweep_orphans(conn, cfg.orphan_s)
    await _requeued(requeued, sup, cfg)
    todo: list[OrphanRow] = []
    for row in rows:
        if row.worker_id == cfg.worker_id:
            sup.stop(row.id, "lost")
            todo.append(row)
        else:  # pgid của máy/worker khác: không giết, chỉ XADD
            todo.append(replace(row, pgid=None))
    await settle(todo, events, cfg.kill_grace_s)
    return len(rows)


async def _requeued(rows: list[OrphanRow], sup: Supervisor | None, cfg: SweepConfig) -> None:
    """Job requeue của mình: dừng `lost` (không ghi), giết `pgid` nếu có (luôn NULL với `dify`)."""
    if rows:
        get_logger().warning("sweep.requeued", count=len(rows))
    for row in rows:
        if row.worker_id == cfg.worker_id:
            if sup is not None:
                sup.stop(row.id, "lost")
            await kill_job_group(row.pgid, row.id, cfg.kill_grace_s)


async def run_sweeper(pool: Pool, events: JobEvents, sup: Supervisor, cfg: SweepConfig) -> None:
    log = get_logger()
    while True:
        try:
            n = await sweep_once(pool, events, sup, cfg)
            if n:
                log.warning("sweep.orphaned", count=n)
        except DB_ERRORS as err:  # DB chập chờn / lỗi Postgres: thử lại chu kỳ sau
            log.warning("sweep.failed", error=type(err).__name__)
        await asyncio.sleep(cfg.every_s)


async def orphan_own_jobs(pool: Pool, events: JobEvents, cfg: SweepConfig) -> int:
    """SQL "Khởi động lại": `workflow.async` còn lượt → `queued` (`REQUEUE_RESTART`, trước), mọi
    `running` còn lại của `worker_id` → `orphaned`, giết pgid còn sống."""
    async with pool.acquire() as conn:
        requeued = await jobs_sql.requeue_restart(conn, cfg.worker_id)
        rows = await jobs_sql.restart_orphans(conn, cfg.worker_id)
    await _requeued(requeued, None, cfg)
    await settle(rows, events, cfg.kill_grace_s)
    return len(rows)
