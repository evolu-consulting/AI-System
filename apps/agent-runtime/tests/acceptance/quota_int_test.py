"""WRK-FR-15 · WRK-FR-20 · H3a-R01–R07, R16 · HUB-H3a-AC-01/03/04/05/11 (vế job) · AC-W02 ·
test-plan-py §2.2 P40–P49.

Tín hiệu quota từ job `fake-cli` (`#fake:ratelimit=<ts>[,<type>]`, `#fake:ratewarn=<util>[,<ts>]`,
`#fake:is-error=rate|auth` — plan-runtime §5). Ca vế job tắt probe (`AGENT_RT_PROBE_S=0`) để chỉ
đo đường job; P43 bật probe (vòng `logged_out`/`error` không làm Runtime claim).
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any, cast

import pytest

from tests.acceptance._h3a import (
    WAIT_S,
    WARN,
    logs,
    set_state,
    start,
    state,
    until_log,
    until_probed_after,
    write_probe,
)
from tests.acceptance._proc import Runtime
from tests.acceptance._rt import BETA, FAKE, Job
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int
TYPE_NAMES = {"str", "int", "float", "bool", "NoneType", "dict", "list"}


def job_only(ctx: Ctx, **extra: str) -> Runtime:
    """Probe tắt (PL2: reset mù H1 lúc khởi động — không có hàng nên không ảnh hưởng)."""
    return ctx.runtime(AGENT_RT_PROBE_S="0", **extra)


async def run_job(ctx: Ctx, prompt: str, end: str = "succeeded") -> dict[str, Any]:
    job = await ctx.job(tenant=BETA, prompt=prompt)
    return await ctx.until_status(job, [end], WAIT_S)


async def row(ctx: Ctx) -> dict[str, Any]:
    got = await state(ctx)
    assert got is not None, "chưa có provider_state"
    return got


def near(at: datetime, delta_s: float, tol_s: float) -> bool:
    return abs((at - datetime.now(UTC)).total_seconds() - delta_s) <= tol_s


async def test_wrk_fr_15_p40_ratewarn_once_per_window(ctx: Ctx) -> None:
    """WRK-FR-15 · P40 · `#fake:ratewarn=0.85,<ts>` ⇒ `succeeded`, `ok`, util 0.85, cửa sổ ts;
    `quota_warning` 1 lần qua 2 job; `claude.rate_limit{source:job}` [H3a-R03 · HUB-H3a-AC-03]"""
    ts = int(time.time()) + 3600
    rt = job_only(ctx)
    j = await run_job(ctx, f"#fake:ratewarn=0.85,{ts}")
    st = await row(ctx)
    assert st["status"] == "ok" and abs(float(st["utilization"]) - 0.85) < 1e-6
    assert st["warn_resets_at"] == datetime.fromtimestamp(ts, UTC)
    await until_log(ctx, rt, "provider.quota_warning")
    await run_job(ctx, f"#fake:ratewarn=0.85,{ts}")
    rl = await until_log(ctx, rt, "claude.rate_limit", 2, source="job", status="allowed_warning")
    assert (rl[0]["job_id"], rl[0]["run_id"]) == (str(j["id"]), str(j["run_id"]))
    w = logs(rt, "provider.quota_warning")
    assert len(w) == 1 and w[0]["level"] in WARN


async def test_wrk_fr_15_p41_ratewarn_without_ts_hour_window(ctx: Ctx) -> None:
    """WRK-FR-15 · P41 · 2 job `#fake:ratewarn=0.5` (không ts) ⇒ cửa sổ = đầu giờ UTC; 1 log
    [H3a-R03 · PL14]"""
    rt = job_only(ctx)
    for _ in range(2):
        await run_job(ctx, "#fake:ratewarn=0.5")
    hour = await ctx.conn.fetchval("select date_trunc('hour', now())")
    assert (await row(ctx))["warn_resets_at"] == hour
    await until_log(ctx, rt, "provider.quota_warning")
    assert len(logs(rt, "provider.quota_warning")) == 1


@pytest.mark.parametrize(
    ("idc", "arg", "env", "delta_s", "tol_s", "rtype"),
    [
        ("9d", "+777600", {}, 1800, 60, None),
        ("past", "-60", {}, 1800, 60, None),
        ("type", "+3600,seven_day", {}, 3600, 60, "seven_day"),
        ("env", "", {"AGENT_RT_COOLDOWN_DEFAULT_S": "120"}, 120, 30, None),
    ],
)
async def test_wrk_fr_15_p42_ratelimit_cooldown_until(
    ctx: Ctx, idc: str, arg: str, env: dict[str, str], delta_s: int, tol_s: int, rtype: str | None
) -> None:
    """WRK-FR-15 · P42 · `#fake:ratelimit` > 8 ngày / quá khứ ⇒ mặc định 1800 s; `,seven_day` ⇒
    ts + type; env `COOLDOWN_DEFAULT_S=120` ⇒ now+120 s [H3a-R02 · HUB-H3a-AC-01]"""
    job_only(ctx, **env)
    ts = 0
    if arg:
        off, _, typ = arg.partition(",")
        ts = int(time.time()) + int(off)
        prompt = f"#fake:ratelimit={ts}" + (f",{typ}" if typ else "")
    else:
        prompt = "#fake:ratelimit"
    j = await run_job(ctx, prompt, "failed")
    assert j["error_reason"] == "quota", idc
    st = await row(ctx)
    assert st["status"] == "cooldown" and near(st["cooldown_until"], delta_s, tol_s), st
    if rtype:  # ts hợp lệ ⇒ đúng ts (R02)
        assert st["cooldown_until"] == datetime.fromtimestamp(ts, UTC)
    assert st["rate_limit_type"] == rtype


@pytest.mark.parametrize(
    ("status", "directive"), [("logged_out", "logged_out"), ("error", "error")]
)
async def test_wrk_fr_20_p43_broken_provider_not_claimed(
    ctx: Ctx, status: str, directive: str
) -> None:
    """WRK-FR-20 · P43 · provider `logged_out`/`error` + probe vẫn hỏng ⇒ vòng probe chạy sau khi có
    job mà job vẫn `queued`, attempts 0 (Runtime không claim) [H3a-R06 · HUB-H3a-AC-04]"""
    await set_state(ctx, status, consecutive_errors="3" if status == "error" else "0")
    write_probe(ctx, directive)
    job: Job = await ctx.job(tenant=BETA, prompt=f"P43 {status}")
    created = (await ctx.conn.fetchrow("select created_at from hub.jobs where id = $1", job.id))[
        "created_at"
    ]
    start(ctx, 2)
    await until_probed_after(ctx, created)
    r = await ctx.until_status(job, ["queued"], 1)
    assert r["attempts"] == 0 and r["worker_id"] is None
    assert (await row(ctx))["status"] == status


async def test_wrk_fr_15_p44_rate_limit_log_shape_only(ctx: Ctx) -> None:
    """WRK-FR-15 · P44 · log `claude.rate_limit`: `keys` chỉ map tên → tên kiểu; không prompt
    [H3a-R04 · HUB-H3a-AC-11]"""
    mark = "PROMPT-P44-MARK"
    rt = job_only(ctx)
    await run_job(ctx, f"{mark} #fake:ratelimit={int(time.time()) + 3600},five_hour", "failed")
    lines = await until_log(ctx, rt, "claude.rate_limit", source="job")
    for x in lines:
        keys = x.get("keys")
        if keys is not None:
            assert isinstance(keys, dict), keys
            assert {str(v) for v in cast(dict[str, Any], keys).values()} <= TYPE_NAMES, keys
    assert mark not in rt.stdout()


async def test_wrk_fr_15_p45_job_ok_upserts_last_ok(ctx: Ctx) -> None:
    """WRK-FR-15 · P45 · không hàng + job thành công ⇒ hàng `ok`, `last_ok_at` ≠ NULL; job lần 2 ⇒
    `updated_at` không đổi [PL4 · PL14]"""
    job_only(ctx)
    await run_job(ctx, "P45 a")
    first = await row(ctx)
    assert first["status"] == "ok" and first["last_ok_at"] is not None
    await run_job(ctx, "P45 b")
    second = await row(ctx)
    assert second["last_ok_at"] >= first["last_ok_at"]
    assert second["updated_at"] == first["updated_at"]


async def test_wrk_fr_15_p46_bad_type_not_stored(ctx: Ctx) -> None:
    """WRK-FR-15 · P46 · `,Bad-Type` ⇒ job `failed quota`, `rate_limit_type` NULL (không rollback
    "Kết thúc") [plan-db §1 CHECK]"""
    job_only(ctx)
    j = await run_job(ctx, f"#fake:ratelimit={int(time.time()) + 3600},Bad-Type", "failed")
    assert (j["error_code"], j["error_reason"]) == ("ALL_PROVIDERS_EXHAUSTED", "quota")
    st = await row(ctx)
    assert st["status"] == "cooldown" and st["rate_limit_type"] is None


async def test_wrk_fr_15_p46_bad_util_not_stored(ctx: Ctx) -> None:
    """WRK-FR-15 · P46 · `#fake:ratewarn=1.5` ⇒ `succeeded`, `utilization` NULL
    [plan-db §1 CHECK]"""
    job_only(ctx)
    await run_job(ctx, "#fake:ratewarn=1.5")
    st = await state(ctx)
    assert st is None or st["utilization"] is None


async def test_wrk_fr_15_p47_quota_fail_no_retry(ctx: Ctx) -> None:
    """WRK-FR-15 · P47 · `#fake:ratelimit` ⇒ `attempts=1`, đúng 1 `job.failed`; Runtime chạy job
    khác (hết cooldown) mà job cũ vẫn `failed` (không requeue) [H3a-R07 · HUB-H3a-AC-05]"""
    job_only(ctx)
    hit = await ctx.job(tenant=BETA, prompt=f"#fake:ratelimit={int(time.time()) + 3600}")
    r = await ctx.until_status(hit, ["failed"], WAIT_S)
    assert r["attempts"] == 1
    await ctx.conn.execute(
        "update hub.provider_state set status = 'ok', cooldown_until = null "
        "where provider_key = $1",
        FAKE,
    )
    await run_job(ctx, "P47 sau")
    again = await ctx.until_status(hit, ["failed"], 1)
    assert again["attempts"] == 1
    assert [e["type"] for e in await ctx.evs(hit) if e["type"] == "job.failed"] == ["job.failed"]


async def test_ac_w02_p48_is_error_rate_cooldown(ctx: Ctx) -> None:
    """AC-W02 · P48 · `#fake:is-error=rate` ⇒ `cooldown` + `quota` [H3a-R01]"""
    job_only(ctx)
    j = await run_job(ctx, "#fake:is-error=rate", "failed")
    assert j["error_reason"] == "quota" and (await row(ctx))["status"] == "cooldown"


async def test_ac_w02_p48_is_error_auth_logged_out(ctx: Ctx) -> None:
    """AC-W02 · P48 · `#fake:is-error=auth` ⇒ `logged_out` + `provider_unavailable` + log
    `provider.logged_out{source:job}` [H3a-R01 · H3a-R16]"""
    rt = job_only(ctx)
    j = await run_job(ctx, "#fake:is-error=auth", "failed")
    assert j["error_reason"] == "provider_unavailable"
    assert (await row(ctx))["status"] == "logged_out"
    lo = (await until_log(ctx, rt, "provider.logged_out", source="job"))[0]
    assert lo["level"] in WARN and lo["provider"] == FAKE


async def test_wrk_fr_15_p49_cooldown_log_from_job(ctx: Ctx) -> None:
    """WRK-FR-15 · P49 · `#fake:ratelimit=<ts>,five_hour` ⇒ log `provider.cooldown{source:job,
    until, type}` mức warn [H3a-R16 · G5]"""
    ts = int(time.time()) + 3600
    rt = job_only(ctx)
    await run_job(ctx, f"#fake:ratelimit={ts},five_hour", "failed")
    cd = (await until_log(ctx, rt, "provider.cooldown", source="job"))[0]
    assert cd["level"] in WARN and cd["provider"] == FAKE and cd["type"] == "five_hour"
    until = cd["until"]
    got = (
        until if isinstance(until, int | float) else datetime.fromisoformat(str(until)).timestamp()
    )
    assert abs(got - ts) < 1
