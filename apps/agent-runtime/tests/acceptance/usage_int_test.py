"""WRK-FR-25 · AC-W09 · H1-R25 · HUB-FR-90 · P33–P35, P37: `usage_logs` mỗi job, manifest
`agent_types`.

SQL "Kết thúc"/"Manifest" plan-db §5.4; giá trị cột plan-runtime §8.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from tests.acceptance._rt import AGENT_A, BETA, FAKE, ORCH, USER, Job, cancel_job, wait_until
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int


async def usage_rows(ctx: Ctx, job: Job) -> list[dict[str, Any]]:
    rows = await ctx.conn.fetch("select * from hub.usage_logs where job_id = $1", job.id)
    return [dict(r) for r in rows]


async def test_wrk_ac_w09_usage_row(ctx: Ctx) -> None:
    """AC-W09 · `#fake:usage=100,50` → đúng 1 dòng: khoá job/run/step/tenant/user/agent, `fake-cli`,
    `model=fake`, `subscription`, `cost_usd=0`, `billable_usd`/`feature_id` null,
    `overage=false`."""
    job = await ctx.job(tenant=BETA, prompt="#fake:usage=100,50")
    ctx.runtime()
    await ctx.until_status(job, ["succeeded"], 15)
    rows = await usage_rows(ctx, job)
    assert len(rows) == 1
    r = rows[0]
    got = {k: str(r[k]) for k in ("tenant_id", "run_id", "step_id", "user_id", "agent_id")}
    assert got == {
        "tenant_id": BETA,
        "run_id": job.run_id,
        "step_id": job.step_id,
        "user_id": USER,
        "agent_id": AGENT_A,
    }
    assert (r["provider_key"], r["model"], r["billing"]) == (FAKE, "fake", "subscription")
    assert (r["input_tokens"], r["output_tokens"]) == (100, 50)
    assert r["cost_usd"] == Decimal(0) and r["billable_usd"] is None and r["feature_id"] is None
    assert r["overage"] is False


async def test_hub_h1_r25_orchestrator_usage_row(ctx: Ctx) -> None:
    """R25 · job Orchestrator (`output=text`) cũng ghi 1 dòng `usage_logs` (agent =
    Orchestrator)."""
    job = await ctx.job(
        tenant=BETA, output="text", agent_id=ORCH, prompt="<message>#fake:usage=5,6 hi</message>"
    )
    ctx.runtime()
    await ctx.until_status(job, ["succeeded"], 15)
    rows = await usage_rows(ctx, job)
    assert [(str(r["agent_id"]), r["input_tokens"], r["output_tokens"]) for r in rows] == [
        (ORCH, 5, 6)
    ]


async def test_hub_h1_r25_cancel_with_usage_one_row(ctx: Ctx) -> None:
    """R25 · huỷ job đã báo usage → vẫn đúng 1 dòng (`ON CONFLICT (job_id) DO NOTHING`)."""
    job = await ctx.job(tenant=BETA, prompt="#fake:usage=7,8 #fake:sleep=60")
    ctx.runtime()
    await ctx.until_running(job)
    await cancel_job(ctx.conn, job)
    await ctx.until_status(job, ["cancelled"], 5)
    rows = await usage_rows(ctx, job)
    assert [(r["input_tokens"], r["output_tokens"]) for r in rows] == [(7, 8)]


async def manifest(ctx: Ctx) -> list[dict[str, Any]]:
    rows = await ctx.conn.fetch("select * from hub.agent_types order by key")
    return [dict(r) for r in rows]


async def wait_manifest(ctx: Ctx) -> list[dict[str, Any]]:
    async def cond() -> list[dict[str, Any]] | None:
        rows = await manifest(ctx)
        return rows if any(r["key"] == "agentic-cli" for r in rows) else None

    return await wait_until(cond, 10, "manifest agentic-cli", ctx.alive)


async def test_wrk_fr_25_manifest_idempotent(ctx: Ctx) -> None:
    """FR-25 · khởi động → `agentic-cli` `available`, `worker_id` của mình; lần 2 không trùng
    dòng."""
    rt = ctx.runtime("qc-man")
    rows = await wait_manifest(ctx)
    a = next(r for r in rows if r["key"] == "agentic-cli")
    assert (a["runtime"], a["available"], a["worker_id"]) == ("agentic-cli", True, "qc-man")
    first_at = a["registered_at"]
    rt.kill_all()
    ctx.runtime("qc-man")

    async def again() -> list[dict[str, Any]] | None:
        rows2 = [r for r in await manifest(ctx) if r["key"] == "agentic-cli"]
        return rows2 if rows2 and rows2[0]["registered_at"] > first_at else None

    rows2 = await wait_until(again, 10, "manifest lần 2", ctx.alive)
    assert len(rows2) == 1 and rows2[0]["available"] is True


async def test_wrk_fr_25_unknown_key_marked_unavailable(ctx: Ctx) -> None:
    """FR-25 · key lạ cùng `worker_id` (không còn trong code) → `available=false`, không xoá."""
    await ctx.conn.execute(
        """insert into hub.agent_types (key, runtime, description, config_schema, version,
             worker_id, available)
           values ('qc-legacy', 'python', '{"vi":"cũ","en":"old"}', '{}', 1, 'qc-man', true)"""
    )
    ctx.runtime("qc-man")
    await wait_manifest(ctx)

    async def off() -> bool:
        v = await ctx.conn.fetchval("select available from hub.agent_types where key = 'qc-legacy'")
        return v is False

    await wait_until(off, 5, "qc-legacy available=false", ctx.alive)
