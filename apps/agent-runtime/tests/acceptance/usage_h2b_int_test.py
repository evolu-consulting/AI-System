"""WRK-FR-17 · AC-W09 · HUB-H2b-AC-09 · H2b-R28 · P27–P28 (test-plan-py §2): F5 — usage cộng dồn
theo lượt; huỷ / timeout ghi đúng 1 dòng `usage_logs` = tổng đã báo; chạy hết = tổng cuối, không
cộng đôi.

`#fake:turns=<n>` + `#fake:usage=<in>,<out>` (`plan-runtime` §6 — PY-04): `n` `UsageEv` cộng dồn
(lượt k: k×in, k×out) cách nhau 50 ms, **trước** `#fake:sleep`. Nguồn `StreamEvent` của `claude-sub`
kiểm ở unit PY-02 + SM3 — ở đây chỉ `fake-cli`.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from tests.acceptance._rt import BETA, Job, cancel_job, wait_until
from tests.acceptance._stream import finished, stream_job, usage_rows
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int


async def after_first_progress(ctx: Ctx, job: Job) -> None:
    """`#fake:sleep` phát `job.progress` sau 1 s — mọi lượt usage đã phát trước đó (§6)."""

    async def progressed() -> bool | None:
        return any(e["type"] == "job.progress" for e in await ctx.evs(job)) or None

    await wait_until(progressed, 15, f"job.progress đầu của {job.id}", ctx.alive)


def tokens(rows: list[dict[str, Any]]) -> list[tuple[int, int]]:
    return [(r["input_tokens"], r["output_tokens"]) for r in rows]


def failed_usage(evs: list[dict[str, Any]]) -> list[Any]:
    return [e["usage"] for e in evs if e["type"] == "job.failed"]


async def test_wrk_fr_17_p27_cancel_after_two_turns(ctx: Ctx) -> None:
    """P27 · AC-09 · `#fake:turns=2 #fake:usage=100,50 #fake:sleep=10` → huỷ sau 2 lượt →
    `cancelled`, `usage_logs` 1 dòng (200, 100), `subscription`, `cost_usd=0`; `job.failed.usage`
    cùng số."""
    job = await stream_job(
        ctx, None, tenant=BETA, prompt="#fake:turns=2 #fake:usage=100,50 #fake:sleep=10"
    )
    ctx.runtime()
    await ctx.until_running(job)
    await after_first_progress(ctx, job)
    await cancel_job(ctx.conn, job)
    row, evs = await finished(ctx, job, 10)
    assert row["status"] == "cancelled"
    rows = await usage_rows(ctx, job)
    assert tokens(rows) == [(200, 100)]
    assert (rows[0]["billing"], rows[0]["cost_usd"]) == ("subscription", Decimal(0))
    assert failed_usage(evs) == [{"input_tokens": 200, "output_tokens": 100}]


async def test_wrk_fr_17_p27_cancel_before_usage_no_row(ctx: Ctx) -> None:
    """P27 · `#fake:sleep=10` (huỷ trước khi có usage) → `cancelled`, 0 dòng `usage_logs`."""
    job = await stream_job(ctx, None, tenant=BETA, prompt="#fake:sleep=10")
    ctx.runtime()
    await ctx.until_running(job)
    await cancel_job(ctx.conn, job)
    row, _ = await finished(ctx, job, 10)
    assert row["status"] == "cancelled"
    assert await usage_rows(ctx, job) == []


async def test_wrk_fr_17_p27_timeout_after_two_turns(ctx: Ctx) -> None:
    """P27 · `timeout_s=10` (min contract) sau 2 lượt usage → `timed_out`, 1 dòng (200, 100)."""
    job = await stream_job(
        ctx,
        None,
        tenant=BETA,
        timeout_s=10,
        prompt="#fake:turns=2 #fake:usage=100,50 #fake:sleep=30",
    )
    ctx.runtime()
    row, evs = await finished(ctx, job, 25)
    assert row["status"] == "timed_out"
    assert tokens(await usage_rows(ctx, job)) == [(200, 100)]
    assert failed_usage(evs) == [{"input_tokens": 200, "output_tokens": 100}]


async def test_wrk_fr_17_p28_full_run_final_total(ctx: Ctx) -> None:
    """P28 · `#fake:turns=3 #fake:usage=10,5` chạy hết → `succeeded`, 1 dòng = tổng cuối (30, 15),
    không cộng đôi; `job.result.usage` cùng số."""
    job = await stream_job(ctx, None, tenant=BETA, prompt="#fake:turns=3 #fake:usage=10,5 trả lời")
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert row["status"] == "succeeded"
    assert tokens(await usage_rows(ctx, job)) == [(30, 15)]
    assert [e["usage"] for e in evs if e["type"] == "job.result"] == [
        {"input_tokens": 30, "output_tokens": 15}
    ]
