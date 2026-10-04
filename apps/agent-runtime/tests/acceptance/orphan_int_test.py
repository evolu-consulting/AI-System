"""WRK-FR-02 · WRK-FR-23 · WRK-BR-04 · H1-R20 · HUB-H1-AC-04 · P12–P16, P32: heartbeat, orphaned,
crash, đếm lỗi provider, dọn khi khởi động (plan-runtime §1.5, §2.2, §2.4, §3.3; plan-db §5.4–5.5).
"""

from __future__ import annotations

import signal

import pytest

from tests.acceptance._rt import BETA, FAKE, group_pids, new_conversation, wait_until
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int


def orphan_failed(row: dict[str, object]) -> tuple[object, object, object]:
    return row["status"], row["error_code"], row["error_reason"]


async def test_wrk_runtime_sigterm_orphans_running_job(ctx: Ctx) -> None:
    """§1.5 · SIGTERM Runtime khi job chạy → job `failed` `INTERNAL_ERROR` `orphaned`, exit 0 ≤ 10
    s."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=60")
    rt = ctx.runtime()
    await ctx.until_running(job)
    rt.signal(signal.SIGTERM)
    assert await rt.wait_exit(10) == 0
    row = await ctx.until_status(job, ["failed"], 1, watch=False)
    assert orphan_failed(row) == ("failed", "INTERNAL_ERROR", "orphaned")
    term = [e for e in await ctx.evs(job) if e["type"] == "job.failed"]
    assert [e["code"] for e in term] == ["INTERNAL_ERROR"]


async def test_hub_h1_ac_04_restart_after_kill9(ctx: Ctx) -> None:
    """AC-04 · `kill -9` Runtime khi job chạy → khởi động lại cùng `worker_id`: job `orphaned`,
    pgid bị
    giết, XADD `job.failed INTERNAL_ERROR`; job `queued` thêm lúc chết vẫn được chạy."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=120")
    rt = ctx.runtime("qc-ac04")
    pgid = int((await ctx.until_running(job))["pgid"])
    rt.signal(signal.SIGKILL)
    await rt.wait_exit(5)
    later = await ctx.job(tenant=BETA, prompt="sau khi chết")
    ctx.runtime("qc-ac04")
    row = await ctx.until_status(job, ["failed"], 10)
    assert orphan_failed(row) == ("failed", "INTERNAL_ERROR", "orphaned")

    async def gone() -> bool:
        return not group_pids(pgid)

    await wait_until(gone, 5, f"pgid {pgid} của job sót bị giết", ctx.alive)
    assert [e["code"] for e in await ctx.evs(job) if e["type"] == "job.failed"] == [
        "INTERNAL_ERROR"
    ]
    await ctx.until_status(later, ["succeeded"], 15)


async def test_wrk_fr_23_other_runtime_sweeps_orphan(ctx: Ctx) -> None:
    """FR-23 · `kill -9` Runtime A; Runtime B (`AGENT_RT_ORPHAN_S=5`) → job của A `orphaned` ≤ 15 s,
    đúng 1 `job.failed`."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=120")
    a = ctx.runtime("qc-a")
    await ctx.until_running(job)
    a.signal(signal.SIGKILL)
    await a.wait_exit(5)
    ctx.runtime("qc-b", AGENT_RT_ORPHAN_S="5")
    row = await ctx.until_status(job, ["failed"], 15)
    assert orphan_failed(row) == ("failed", "INTERNAL_ERROR", "orphaned")
    assert len([e for e in await ctx.evs(job) if e["type"] == "job.failed"]) == 1


async def test_wrk_br_04_crash_not_retried(ctx: Ctx) -> None:
    """BR-04 · `#fake:crash` → `failed` lý do `crash`, `attempts=1` (không đưa lại hàng đợi)."""
    job = await ctx.job(tenant=BETA, prompt="#fake:crash")
    ctx.runtime()
    row = await ctx.until_status(job, ["failed"], 15)
    assert (row["error_reason"], row["attempts"]) == ("crash", 1)
    assert len([e for e in await ctx.evs(job) if e["type"] == "job.failed"]) == 1


async def test_wrk_provider_three_crashes_marks_error(ctx: Ctx) -> None:
    """§3.3 · 3 `crash` liên tiếp → `provider_state.status=error`; job `queued` cùng provider →
    `failed` `ALL_PROVIDERS_EXHAUSTED` `provider_unavailable`."""
    conv = await new_conversation(ctx.conn, BETA)
    crashes = [await ctx.job(tenant=BETA, conv=conv, prompt="#fake:crash") for _ in range(3)]
    queued = await ctx.job(tenant=BETA, conv=conv, prompt="sau 3 crash")
    ctx.runtime()
    for j in crashes:
        await ctx.until_status(j, ["failed"], 15)
    row = await ctx.until_status(queued, ["failed"], 5)
    assert (row["error_code"], row["error_reason"], row["attempts"]) == (
        "ALL_PROVIDERS_EXHAUSTED",
        "provider_unavailable",
        0,
    )
    st = await ctx.conn.fetchrow("select * from hub.provider_state where provider_key = $1", FAKE)
    assert st is not None and st["status"] == "error"


async def test_wrk_provider_success_resets_error_count(ctx: Ctx) -> None:
    """§3.3 · crash, crash, thành công → `consecutive_errors` về 0, provider vẫn `ok`."""
    conv = await new_conversation(ctx.conn, BETA)
    jobs = [
        await ctx.job(tenant=BETA, conv=conv, prompt=p)
        for p in ("#fake:crash", "#fake:crash", "ok")
    ]
    ctx.runtime()
    await ctx.until_status(jobs[-1], ["succeeded"], 20)
    st = await ctx.conn.fetchrow("select * from hub.provider_state where provider_key = $1", FAKE)
    assert st is not None and (st["status"], st["consecutive_errors"]) == ("ok", 0)


@pytest.mark.parametrize("status", ["error", "logged_out"])
async def test_wrk_restart_resets_provider_state(ctx: Ctx, status: str) -> None:
    """§2.4 · khởi động: provider của registry ở `error`/`logged_out` → `ok`,
    `consecutive_errors=0`."""
    await ctx.conn.execute(
        """insert into hub.provider_state (provider_key, status, consecutive_errors)
           values ($1, $2, 3)""",
        FAKE,
        status,
    )
    ctx.runtime()

    async def ok() -> bool:
        st = await ctx.conn.fetchrow(
            "select * from hub.provider_state where provider_key = $1", FAKE
        )
        return st is not None and (st["status"], st["consecutive_errors"]) == ("ok", 0)

    await wait_until(ok, 10, "provider_state về ok", ctx.alive)


async def test_wrk_restart_keeps_cooldown(ctx: Ctx) -> None:
    """§2.4 · khởi động: `cooldown` chưa hết giữ nguyên (job `queued` không bị claim);
    mốc sẵn sàng = manifest `agent_types` đã ghi (bước 6 trước bước 7)."""
    await ctx.conn.execute(
        """insert into hub.provider_state (provider_key, status, cooldown_until)
           values ($1, 'cooldown', now() + interval '1 hour')""",
        FAKE,
    )
    job = await ctx.job(tenant=BETA)
    ctx.runtime()

    async def ready() -> bool:
        n = await ctx.conn.fetchval("select count(*) from hub.agent_types where available")
        return int(n) > 0

    await wait_until(ready, 10, "manifest agent_types", ctx.alive)
    st = await ctx.conn.fetchrow("select * from hub.provider_state where provider_key = $1", FAKE)
    assert st is not None and st["status"] == "cooldown"
    assert (await ctx.until_status(job, ["queued"], 1))["attempts"] == 0
