"""WRK-FR-23 · WRK-FR-24 · review H1 v2 M4/M2 (int, Postgres thật): `ORPHAN_ONE` — dòng `running`
của mình không task nào giữ → sau 2 nhịp heartbeat `failed`/`orphaned`, slot nhả (job `queued` claim
được), job `running` của worker khác không bị đụng. `FINISHED_AS` (mất ack "Kết thúc")."""

from __future__ import annotations

from typing import Any

import pytest

from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import ClaimedJob, Finish, OrphanRow
from agent_runtime.db.pool import create_pool
from agent_runtime.queue.heartbeat import Heartbeat
from agent_runtime.queue.host import JobControl
from agent_runtime.queue.supervisor import Supervisor
from agent_runtime.queue.sweeper import SweepConfig
from tests.acceptance._rt import BETA, FAKE, Job, job_row, rt_db_url, set_provider
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int
ME, OTHER = "qc-hb-me", "qc-hb-other"


class _Host:
    async def run(self, job: ClaimedJob, control: JobControl) -> None:
        await control.stopped.wait()


class _Events:
    def __init__(self) -> None:
        self.orphans: list[str] = []

    async def started(self, job: ClaimedJob) -> None: ...

    async def orphaned(self, row: OrphanRow) -> None:
        self.orphans.append(row.id)


async def _running(conn: Any, job: Job, worker: str) -> None:
    await conn.execute(
        """update hub.jobs set status = 'running', worker_id = $2, started_at = now(),
             heartbeat_at = now(), attempts = attempts + 1 where id = $1""",
        job.id,
        worker,
    )


async def test_wrk_fr_24_orphan_one_frees_slot_other_worker_untouched(ctx: Ctx) -> None:
    await set_provider(ctx.conn, FAKE, 2)
    ghost = await ctx.job(tenant=BETA, notify=False)
    other = await ctx.job(tenant=BETA, notify=False)
    queued = await ctx.job(tenant=BETA, notify=False)
    await _running(ctx.conn, ghost, ME)
    await _running(ctx.conn, other, OTHER)
    other_before = await job_row(ctx.conn, other)
    pool = await create_pool(rt_db_url())
    try:
        async with pool.acquire() as conn:  # 2 slot đều `running` → chưa claim được
            assert await jobs_sql.claim_one(conn, [FAKE], ME) is None
        events = _Events()
        hb = Heartbeat(pool, Supervisor(_Host()), events, SweepConfig(ME, 60.0, 0.2))
        assert await hb.beat_once() == 0  # lần 1: chỉ nghi
        assert (await job_row(ctx.conn, ghost))["status"] == "running"
        assert await hb.beat_once() == 1  # lần 2: orphaned
        row = await job_row(ctx.conn, ghost)
        assert (row["status"], row["error_code"], row["error_reason"]) == (
            "failed",
            "INTERNAL_ERROR",
            "orphaned",
        )
        assert events.orphans == [ghost.id]
        async with pool.acquire() as conn:  # slot nhả
            got = await jobs_sql.claim_one(conn, [FAKE], ME)
        assert got is not None and got.id == queued.id
    finally:
        await pool.close()
    other_after = await job_row(ctx.conn, other)
    assert other_after["status"] == "running" and other_after["worker_id"] == OTHER
    assert other_after["heartbeat_at"] == other_before["heartbeat_at"]


async def test_wrk_fr_24_finished_as_matches_own_terminal_state(ctx: Ctx) -> None:
    job = await ctx.job(tenant=BETA, notify=False)
    await _running(ctx.conn, job, ME)
    fin = Finish("failed", error_code="UPSTREAM_ERROR", error_reason="crash", error_message="m")
    pool = await create_pool(rt_db_url())
    try:
        async with pool.acquire() as conn:
            assert not await jobs_sql.finished_as(conn, job.id, ME, fin)  # còn `running`
            assert await jobs_sql.finish_job(conn, job.id, ME, fin)
            assert await jobs_sql.finished_as(conn, job.id, ME, fin)
            assert not await jobs_sql.finished_as(conn, job.id, OTHER, fin)
            assert not await jobs_sql.finished_as(conn, job.id, ME, Finish("succeeded"))
            orphan = Finish("failed", error_code="INTERNAL_ERROR", error_reason="orphaned")
            assert not await jobs_sql.finished_as(conn, job.id, ME, orphan)
    finally:
        await pool.close()
