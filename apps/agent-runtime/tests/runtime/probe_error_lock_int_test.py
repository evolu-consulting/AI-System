"""REVIEW 1 H3a RV1-R1 · WRK-FR-22 · WRK-FR-15 · PL5 · int (Postgres thật): lỗi probe khi snapshot
khoẻ quyết định theo số lỗi đọc **dưới `K_CLAIM`**, không theo snapshot (đọc trước lượt probe) — job
lỗi chen giữa snapshot và lúc ghi vẫn được tính, chạm ngưỡng ⇒ `error` + job `queued` bị fail.
"""

from __future__ import annotations

from typing import Any

import pytest

from agent_runtime.db import probe_sql
from agent_runtime.db.provider_state_sql import provider_error
from agent_runtime.runtimes.cli.quota_rules import ProbeResult, ProviderSnap
from tests.acceptance._h3a import set_state, state
from tests.acceptance._rt import FAKE, JobSpec, job_row
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

ERR = ProbeResult("error", None, None, None, None, "probe timed out", (0, 0), 0, "turn")


async def _snap_then_job_error(ctx: Ctx, errors: int) -> ProviderSnap:
    """Snapshot `ok` với `errors` lỗi, rồi một job lỗi đếm thêm (như `finish_tx`) trước khi ghi."""
    await set_state(ctx, "ok", consecutive_errors=str(errors))
    snap = await probe_sql.snapshot(ctx.conn, FAKE)
    assert snap is not None and snap.consecutive_errors == errors
    await provider_error(ctx.conn, FAKE, "job failed")
    return snap


async def test_rv1_r1_wrk_fr_15_job_error_between_snapshot_and_write_reaches_threshold(
    ctx: Ctx,
) -> None:
    job = await ctx.job(JobSpec(notify=False))
    snap = await _snap_then_job_error(ctx, 1)  # snapshot 1, thật 2 ⇒ probe lỗi = 3
    applied = await probe_sql.apply_probe(ctx.conn, FAKE, snap, ERR)
    assert applied is not None and applied.to_status == "error"
    assert [q.id for q in applied.queued_failed] == [job.id]
    st: dict[str, Any] | None = await state(ctx)
    assert st is not None and (st["status"], st["consecutive_errors"]) == ("error", 3)
    row = await job_row(ctx.conn, job)
    assert (row["status"], row["error_code"], row["error_reason"]) == (
        "failed",
        "ALL_PROVIDERS_EXHAUSTED",
        "provider_unavailable",
    )


async def test_rv1_r1_wrk_fr_22_below_threshold_under_lock_only_counts(ctx: Ctx) -> None:
    job = await ctx.job(JobSpec(notify=False))
    snap = await _snap_then_job_error(ctx, 0)  # thật 1 ⇒ probe lỗi = 2 < 3
    applied = await probe_sql.apply_probe(ctx.conn, FAKE, snap, ERR)
    assert applied is not None and (applied.to_status, applied.queued_failed) == ("ok", [])
    st = await state(ctx)
    assert st is not None and (st["status"], st["consecutive_errors"]) == ("ok", 2)
    assert (await job_row(ctx.conn, job))["status"] == "queued"
