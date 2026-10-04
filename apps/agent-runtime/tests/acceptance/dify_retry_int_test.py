"""WRK-FR-06 · HUB-H2a-AC-06 · H2a-R11, R13 · Q6 · RQ4, RQ5 · P06–P12: vòng thử Dify trong một lần
claim (`plan-runtime-dify` §3.4: tối đa 3 lời gọi, backoff test `0.2,0.8`, `side_effect` +
`mark_dispatched`, huỷ trong lúc ngủ backoff). Mã cuối theo `plan-errors` §2.

Trước PY-03: đỏ ở `ModuleNotFoundError` (`DifyEnv.runtime` → `need_router`).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from tests.acceptance._dify import DifySpec, closed_port_url, dify_env, log_events, progress
from tests.acceptance._rt import cancel_job, terminal, wait_until
from tests.acceptance.conftest import Ctx
from tests.support.dify_mock import CredentialSpec

pytestmark = pytest.mark.int

END_S = 15.0


def failure(row: dict[str, Any]) -> tuple[Any, Any, Any]:
    return row["status"], row["error_code"], row["error_reason"]


async def test_hub_h2a_ac_06_p06_503x2_then_ok_backoff(ctx: Ctx) -> None:
    """P06 · AC-06 · `mk-503x2` → `succeeded`, mock 3 lời gọi; khoảng 1→2 ≥ 0.2 s, 2→3 ≥ 0.8 s
    (`AGENT_RT_DIFY_BACKOFF_S=0.2,0.8`)."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="mk-503x2"))
        d.runtime()
        await ctx.until_status(job, ["succeeded"], END_S)
        at = [c.at for c in d.runs()]
        assert len(at) == 3
        assert at[1] - at[0] >= 0.2 and at[2] - at[1] >= 0.8, at
        assert len(d.creds(job)) == 1


async def test_hub_h2a_ac_06_p06_retry_progress(ctx: Ctx) -> None:
    """P06 · §3.5 · retry → `job.progress` "Đang thử lại (1/2)" rồi "(2/2)" (backoff 1.2 s để gộp
    1 sự kiện/giây không nuốt bước nào)."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="mk-503x2"))
        d.runtime(AGENT_RT_DIFY_BACKOFF_S="1.2,1.2")
        await ctx.until_status(job, ["succeeded"], END_S)
        retry = [m for m in progress(await ctx.evs(job)) if m.startswith("Đang thử lại")]
        assert retry == ["Đang thử lại (1/2)", "Đang thử lại (2/2)"]


async def test_hub_h2a_ac_06_p07_400_no_retry(ctx: Ctx) -> None:
    """P07 · AC-06 · `mk-400` → 1 lời gọi, `UPSTREAM_ERROR`/`upstream`."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="mk-400"))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "UPSTREAM_ERROR", "upstream")
        assert len(d.runs()) == 1


async def test_hub_h2a_ac_06_p07_503x5_three_calls(ctx: Ctx) -> None:
    """P07 · AC-06 · `mk-503x5` → đúng 3 lời gọi rồi `UPSTREAM_ERROR`/`upstream`."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="mk-503x5"))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "UPSTREAM_ERROR", "upstream")
        assert len(d.runs()) == 3
        assert len(terminal(await ctx.evs(job))) == 1


async def test_hub_h2a_ac_06_p08_side_effect_no_retry_dispatched(ctx: Ctx) -> None:
    """P08 · AC-06 · Q6 · `side_effect` + `mk-503x1` → 1 lời gọi, `failed UPSTREAM_ERROR`;
    `dispatched_at` đặt **trước** khi mock nhận request."""
    async with dify_env(ctx) as d:
        job = await d.job(DifySpec(side_effect=True), CredentialSpec(api_key="mk-503x1"))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "UPSTREAM_ERROR", "upstream")
        [run] = d.runs()
        assert row["dispatched_at"] is not None
        assert row["dispatched_at"].timestamp() <= run.at


async def test_hub_h2a_ac_06_p08_no_side_effect_no_dispatched_at(ctx: Ctx) -> None:
    """P08 · Q6 · job không `side_effect` → `dispatched_at` NULL (chỉ đánh dấu khi
    `side_effect`)."""
    async with dify_env(ctx) as d:
        job = await d.job()
        d.runtime()
        row = await ctx.until_status(job, ["succeeded"], END_S)
        assert row["dispatched_at"] is None


@pytest.mark.parametrize(
    ("key", "code"),
    [("mk-401", "NOT_CONFIGURED"), ("mk-404", "NOT_CONFIGURED"), ("qc-429", "UPSTREAM_ERROR")],
)
async def test_wrk_fr_06_p09_4xx_no_retry(ctx: Ctx, key: str, code: str) -> None:
    """P09 · R11 · RQ4 · `mk-401`/`mk-404` → `NOT_CONFIGURED`/`upstream`; 429 → `UPSTREAM_ERROR`/
    `upstream`; 1 lời gọi (không retry)."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key=key))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", code, "upstream")
        assert len(d.runs()) == 1


async def test_wrk_fr_06_p10_stream_cut_after_first_event(ctx: Ctx) -> None:
    """P10 · RQ5 · luồng đứt sau `workflow_started` → không retry (1 lời gọi), `UPSTREAM_ERROR`/
    `upstream`, stop best-effort đúng `task_id`."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="qc-cut"))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "UPSTREAM_ERROR", "upstream")
        assert len(d.runs()) == 1

        async def stopped() -> bool:
            return len(d.stops()) >= 1

        await wait_until(stopped, 3, "mock nhận stop", ctx.alive)
        assert d.stops()[0].path == "/v1/workflows/tasks/qc-task-1/stop"


async def test_wrk_fr_06_p11_connect_error_three_attempts(ctx: Ctx) -> None:
    """P11 · WRK-FR-06 · cổng Dify đóng (lỗi kết nối) → 3 lần thử (log `dify.attempt` ×3,
    `err_kind=connect`, tổng ≥ 0.2 + 0.8 s) rồi `UPSTREAM_ERROR`/`upstream`."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(base_url=closed_port_url()))
        rt = d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "UPSTREAM_ERROR", "upstream")
        assert (row["finished_at"] - row["started_at"]).total_seconds() >= 1.0
        attempts = [e for e in log_events(rt.stdout(), "dify.attempt") if e.get("job_id") == job.id]
        assert [e.get("err_kind") for e in attempts] == ["connect"] * 3


async def test_wrk_fr_06_p12_cancel_during_backoff(ctx: Ctx) -> None:
    """P12 · R13 · huỷ trong lúc ngủ backoff (3 s) → `cancelled` ≤ 5 s, không có lần thử kế."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="mk-503x5"))
        d.runtime(AGENT_RT_DIFY_BACKOFF_S="3,3")

        async def first() -> bool:
            return len(d.runs()) == 1

        await wait_until(first, 10, "lời gọi Dify đầu", ctx.alive)
        t0 = time.monotonic()
        await cancel_job(ctx.conn, job)
        row = await ctx.until_status(job, ["cancelled"], 5)
        assert row["error_code"] == "CANCELLED"
        assert time.monotonic() - t0 <= 5.0
        await asyncio.sleep(3.5)  # quá mốc backoff 3 s: không được có lời gọi thứ 2
        assert len(d.runs()) == 1, "có lần thử sau khi huỷ"
