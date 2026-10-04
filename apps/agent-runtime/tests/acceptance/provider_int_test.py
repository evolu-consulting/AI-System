"""WRK-FR-15 · AC-W02 · H1-R18 · H1-R24 · P29–P31: rate limit → cooldown, fail job `queued`, hết
hạn.

SQL "Provider hỏng" plan-db §5.4: job `queued` cùng provider → `failed ALL_PROVIDERS_EXHAUSTED
quota`.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import pytest

from tests.acceptance._rt import BETA, FAKE, job_row, new_conversation
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int


async def state(ctx: Ctx) -> dict[str, object]:
    row = await ctx.conn.fetchrow("select * from hub.provider_state where provider_key = $1", FAKE)
    assert row is not None, "chưa có provider_state"
    return dict(row)


async def test_wrk_ac_w02_ratelimit_with_reset(ctx: Ctx) -> None:
    """AC-W02 · `#fake:ratelimit=<ts>` → `cooldown_until = ts`, job `failed` lý do `quota`; job
    `queued`
    cùng provider (xếp sau, cùng hội thoại) fail ngay `ALL_PROVIDERS_EXHAUSTED quota`, không
    chạy."""
    ts = int(time.time()) + 3600
    conv = await new_conversation(ctx.conn, BETA)
    hit = await ctx.job(tenant=BETA, conv=conv, prompt=f"#fake:ratelimit={ts}")
    behind = await ctx.job(tenant=BETA, conv=conv, prompt="xếp sau")
    ctx.runtime()
    row = await ctx.until_status(hit, ["failed"], 15)
    assert row["error_reason"] == "quota"
    st = await state(ctx)
    assert st["status"] == "cooldown"
    assert st["cooldown_until"] == datetime.fromtimestamp(ts, UTC)
    b = await ctx.until_status(behind, ["failed"], 2)
    assert (b["error_code"], b["error_reason"], b["attempts"]) == (
        "ALL_PROVIDERS_EXHAUSTED",
        "quota",
        0,
    )
    assert [e["code"] for e in await ctx.evs(behind) if e["type"] == "job.failed"] == [
        "ALL_PROVIDERS_EXHAUSTED"
    ]


async def test_wrk_fr_15_ratelimit_without_reset_30min(ctx: Ctx) -> None:
    """FR-15 · rate limit không kèm giờ reset → `cooldown_until ≈ now + 30 phút` (±1 phút)."""
    job = await ctx.job(tenant=BETA, prompt="#fake:ratelimit")
    ctx.runtime()
    await ctx.until_status(job, ["failed"], 15)
    until = (await state(ctx))["cooldown_until"]
    assert isinstance(until, datetime)
    delta = until - datetime.now(UTC)
    assert timedelta(minutes=29) <= delta <= timedelta(minutes=31)


async def test_hub_h1_r18_cooldown_blocks_then_expires(ctx: Ctx) -> None:
    """R18 · `cooldown_until` còn 3 s → job không bị claim; hết hạn → được claim (điều kiện trong
    SQL)."""
    await ctx.conn.execute(
        """insert into hub.provider_state (provider_key, status, cooldown_until)
           values ($1, 'cooldown', now() + interval '3 seconds')""",
        FAKE,
    )
    job = await ctx.job(tenant=BETA)
    t0 = time.monotonic()
    ctx.runtime()
    row = await ctx.until_status(job, ["running", "succeeded"], 10)
    assert time.monotonic() - t0 >= 2.5, "claim trước khi cooldown hết"
    assert row["attempts"] == 1
    assert (await job_row(ctx.conn, job))["error_code"] is None
