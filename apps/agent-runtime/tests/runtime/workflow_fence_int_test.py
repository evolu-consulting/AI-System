"""Review 1 C1 · RT1 · int (Postgres thật): câu ghi job `workflow.async` của một lần claim rào theo
`token_hash` — sau requeue + claim lại cùng `id` bởi cùng `worker_id`, lần claim cũ không đánh dấu
đã gửi / không ghi "Kết thúc" đè lên lần claim mới.
"""

from __future__ import annotations

from typing import Any

import pytest

from agent_runtime.db import jobs_sql, workflow_sql
from agent_runtime.db.jobs_sql import ClaimedJob, Finish
from tests.acceptance._rt import FAKE, JobSpec
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

WORKER = "qc-fence"
REQUEUE = """UPDATE hub.jobs SET status = 'queued', worker_id = NULL, heartbeat_at = NULL,
  started_at = NULL, token_hash = NULL, dispatched_at = NULL, queued_at = now() WHERE id = $1"""


async def _claim(conn: Any) -> ClaimedJob:
    job = await jobs_sql.claim_one(conn, [FAKE], WORKER)
    assert job is not None
    return job


async def test_review1_c1_old_claim_cannot_write_after_reclaim(ctx: Ctx) -> None:
    conn = ctx.conn
    await ctx.job(JobSpec(notify=False))
    old = await _claim(conn)
    await conn.execute(REQUEUE, old.id)
    new = await _claim(conn)
    assert (new.id, new.fence != old.fence) == (old.id, True)

    assert not await workflow_sql.mark_dispatched(conn, old, WORKER)
    assert await workflow_sql.mark_dispatched(conn, new, WORKER)

    done = (Finish("succeeded", result={"kind": "text", "text": "x"}), None)
    assert not await workflow_sql.finish_dify(conn, old, WORKER, done)
    assert not await jobs_sql.finished_as_fenced(conn, old, WORKER, done[0])
    row = await conn.fetchrow("select status from hub.jobs where id = $1", old.id)
    assert row["status"] == "running"
    assert await workflow_sql.finish_dify(conn, new, WORKER, done)
    assert await jobs_sql.finished_as_fenced(conn, new, WORKER, done[0])
