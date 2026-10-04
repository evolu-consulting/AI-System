"""WRK-FR-04 · WRK-FR-05 · WRK-NFR-06 · AC-W03 · AC-W10 · P8–P11: huỷ/timeout giết cả process group.

Hộp đen: `hub.jobs` (status, pgid), `/proc/*/stat` (`pgrp`), `run:<run_id>`. `fake-cli` sinh
process con
(`#fake:spawn-child` = `sleep 300` cùng group). Không `sleep` cố định: chờ theo điều kiện.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from tests.acceptance._rt import BETA, Job, cancel_job, cmdline, group_pids, reset_data, wait_until
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int


async def group_gone(pgid: int, limit_s: float) -> None:
    async def cond() -> bool:
        return not group_pids(pgid)

    await wait_until(cond, limit_s, f"process group {pgid} hết")


def failed_events(evs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in evs if e["type"] in ("job.failed", "job.result")]


async def cancel_and_check(ctx: Ctx, job: Job, notify: bool, limit_s: float) -> None:
    row = await ctx.until_running(job)
    pgid = int(row["pgid"])
    assert group_pids(pgid), "job host phải đang sống trước khi huỷ"
    t0 = time.monotonic()
    await cancel_job(ctx.conn, job, notify=notify)
    await ctx.until_status(job, ["cancelled"], limit_s)
    await group_gone(pgid, max(0.1, limit_s - (time.monotonic() - t0)))
    term = failed_events(await ctx.evs(job))
    assert [(e["type"], e["status"], e["code"]) for e in term] == [
        ("job.failed", "cancelled", "CANCELLED")
    ]


async def test_wrk_ac_w03_cancel_kills_group_within_5s(ctx: Ctx) -> None:
    """AC-W03 · `#fake:sleep=60` → huỷ (NOTIFY `job_cancel`) → ≤ 5 s `cancelled`, `/proc` không
    còn pid
    `pgrp=pgid`, đúng 1 `job.failed CANCELLED`; job chờ slot (provider 1 slot) được claim sau đó."""
    await reset_data(ctx.conn, acme_limit=None, fake_slots=1)
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=60")
    waiting = await ctx.job(tenant=BETA, prompt="sau")
    ctx.runtime()
    await cancel_and_check(ctx, job, notify=True, limit_s=5)
    await ctx.until_status(waiting, ["running", "succeeded"], 5)


async def test_wrk_ac_w10_cancel_kills_spawned_child(ctx: Ctx) -> None:
    """AC-W10 · `#fake:spawn-child` (`sleep 300` cùng group) → huỷ → mọi pid của group hết ≤ 5 s."""
    job = await ctx.job(tenant=BETA, prompt="#fake:spawn-child #fake:sleep=60")
    ctx.runtime()
    row = await ctx.until_running(job)
    pgid = int(row["pgid"])

    async def has_child() -> bool:
        return len(group_pids(pgid)) >= 2

    await wait_until(has_child, 5, "process con `sleep 300` trong group", ctx.alive)
    assert any(cmdline(p).startswith("sleep 300") for p in group_pids(pgid))
    await cancel_job(ctx.conn, job)
    await group_gone(pgid, 5)
    assert (await ctx.until_status(job, ["cancelled"], 1))["pgid"] is None


async def test_wrk_fr_05_cancel_flag_only_heartbeat(ctx: Ctx) -> None:
    """FR-05 · chỉ cờ DB, không NOTIFY → heartbeat (10 s) phát hiện → dừng ≤ 15 s."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=60")
    ctx.runtime()
    await cancel_and_check(ctx, job, notify=False, limit_s=15)


async def test_wrk_fr_04_timeout_kills_group(ctx: Ctx) -> None:
    """FR-04 · `timeout_s=10`, `#fake:sleep=60` → `timed_out` ≤ 15 s từ lúc chạy, group hết,
    1 `job.failed` `TIMEOUT`."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=60", timeout_s=10)
    ctx.runtime()
    row = await ctx.until_running(job)
    pgid = int(row["pgid"])
    await ctx.until_status(job, ["timed_out"], 15)
    await group_gone(pgid, 2)
    term = failed_events(await ctx.evs(job))
    assert [(e["status"], e["code"]) for e in term] == [("timed_out", "TIMEOUT")]
