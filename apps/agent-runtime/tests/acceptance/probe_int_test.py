"""WRK-FR-22 · H3a-R11–R18 · HUB-H3a-AC-04 (vế Runtime), AC-08–AC-11 · test-plan-py §2.1 P20–P39.

Probe `fake-cli` qua file chỉ thị `AGENT_RT_FAKE_PROBE_FILE` (plan-runtime §5) + `<file>.calls`;
biên env dev (PL6), timeout 10 s, chỉ ca treo 2 s (N1). Không probe trước hạn: so mốc DB, không
`sleep`.
"""

from __future__ import annotations

import json
import signal
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from tests.acceptance._h3a import (
    WAIT_S,
    WARN,
    Row,
    advisory_probe_locks,
    alive,
    calls,
    db_now,
    logs,
    owner_conn,
    probe_children,
    probe_file,
    set_state,
    start,
    state,
    until_calls,
    until_log,
    until_probed_after,
    until_ready,
    until_state,
    write_probe,
)
from tests.acceptance._rt import ACME, BETA, FAKE, wait_until
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int
HANG_S = 2  # N1: chỉ P22, P38


def is_(status: str) -> Callable[[Row], bool]:
    return lambda r: r["status"] == status


async def test_wrk_fr_22_p20_logged_out_then_recovered_same_process(ctx: Ctx) -> None:
    """WRK-FR-22 · P20 · không hàng + `logged_out` ⇒ `logged_out` (log warn, source probe); file
    `ok` ⇒ ≤ 15 s `ok` + `recovered`, cùng process [H3a-R13 · R15 · R16 · HUB-H3a-AC-08]"""
    write_probe(ctx, "logged_out")
    rt = start(ctx, 60)
    pid = rt.proc.pid
    await until_state(ctx, "logged_out", is_("logged_out"))
    lo = (await until_log(ctx, rt, "provider.logged_out", source="probe"))[0]
    assert lo["level"] in WARN and lo["provider"] == FAKE
    write_probe(ctx, "ok")
    row = await until_state(ctx, "ok", is_("ok"))
    assert row["consecutive_errors"] == 0
    assert row["last_probe_at"] is not None and row["last_ok_at"] is not None
    await until_log(ctx, rt, "provider.recovered", from_="logged_out")
    assert ctx.alive() is None and rt.proc.pid == pid and rt.proc.poll() is None


async def test_wrk_fr_22_p21_probe_cooldown_fails_queued(ctx: Ctx) -> None:
    """WRK-FR-22 · P21 · probe `rejected:<ts>:five_hour` ⇒ `cooldown` = ts; job `queued` ⇒ `failed
    quota`, attempts 0, đúng 1 `job.failed` [H3a-R15 · PL8 · HUB-H3a-AC-04 · HUB-H3a-AC-08]"""
    ts = int(time.time()) + 3600
    busy = await ctx.job(tenant=ACME, prompt="#fake:sleep=30")
    write_probe(ctx, "ok")
    rt = start(ctx, 2)
    await ctx.until_running(busy)
    queued = await ctx.job(tenant=ACME, prompt="xếp sau P21")
    write_probe(ctx, f"rejected:{ts}:five_hour")
    row = await until_state(ctx, "cooldown", is_("cooldown"))
    assert row["cooldown_until"] == datetime.fromtimestamp(ts, UTC)
    assert row["rate_limit_type"] == "five_hour" and row["last_probe_at"] is not None
    q = await ctx.until_status(queued, ["failed"], 5)
    assert (q["error_code"], q["error_reason"], q["attempts"]) == (
        "ALL_PROVIDERS_EXHAUSTED",
        "quota",
        0,
    )
    assert [e["type"] for e in await ctx.evs(queued) if e["type"] == "job.failed"] == ["job.failed"]
    cd = (await until_log(ctx, rt, "provider.cooldown", source="probe"))[0]
    assert cd["level"] in WARN


async def test_wrk_fr_22_p22_hang_three_timeouts_error(ctx: Ctx) -> None:
    """WRK-FR-22 · P22 · `hang`, timeout 2 s ⇒ lỗi 1→2→3 ⇒ `error`; job `queued` ⇒
    `provider_unavailable`; con probe bị giết; `last_error` không `@` [H3a-R15 · PL5]"""
    busy = await ctx.job(tenant=ACME, prompt="#fake:sleep=60")
    write_probe(ctx, "hang")
    rt = start(ctx, 2, timeout_s=HANG_S)
    await ctx.until_running(busy)
    queued = await ctx.job(tenant=ACME, prompt="xếp sau P22")
    seen: set[int] = set()
    counts: list[int] = []

    async def errored() -> dict[str, object] | None:
        seen.update(probe_children(rt))
        row = await state(ctx)
        if row and (not counts or counts[-1] != row["consecutive_errors"]):
            counts.append(int(row["consecutive_errors"]))
        return row if row and row["status"] == "error" else None

    row = await wait_until(errored, 30, "provider error sau 3 timeout", ctx.alive)
    nz = [c for c in counts if c > 0]
    assert len(nz) >= 2 and nz == list(range(1, len(nz) + 1)), counts  # 1→2→(3), không nhảy
    assert "@" not in str(row["last_error"] or "")
    q = await ctx.until_status(queued, ["failed"], 5)
    assert (q["error_code"], q["error_reason"]) == (
        "ALL_PROVIDERS_EXHAUSTED",
        "provider_unavailable",
    )
    assert seen, "không thấy con probe nào"
    assert len([p for p in seen if alive(p)]) <= 1  # chỉ lượt đang chạy (nếu có)


async def test_wrk_fr_22_p23_one_error_keeps_ok(ctx: Ctx) -> None:
    """WRK-FR-22 · P23 · một lượt `error` ⇒ `consecutive_errors=1`, status vẫn `ok` [H3a-R15]"""
    write_probe(ctx, "error")
    start(ctx, 60)
    row = await until_state(ctx, "last_probe_at", lambda r: r["last_probe_at"] is not None)
    assert (row["status"], row["consecutive_errors"]) == ("ok", 1)


async def test_wrk_fr_22_p24_logged_out_error_only_counts(ctx: Ctx) -> None:
    """WRK-FR-22 · P24 · `logged_out` + file `error` ⇒ đếm lỗi, giữ `logged_out` [PL5 · PL11]"""
    await set_state(ctx, "logged_out", consecutive_errors="0")
    write_probe(ctx, "error")
    start(ctx, 60)
    row = await until_state(ctx, "đếm lỗi", lambda r: r["consecutive_errors"] >= 1)
    assert row["status"] == "logged_out" and row["last_probe_at"] is not None


async def test_wrk_fr_22_p25_revoked_runs_turn_stays_logged_out(ctx: Ctx) -> None:
    """WRK-FR-22 · P25 · `logged_out` + `revoked` ⇒ `auth` rồi `turn`; giữ `logged_out` [PL11]"""
    await set_state(ctx, "logged_out")
    write_probe(ctx, "revoked")
    start(ctx, 60)
    got = await until_calls(ctx, "turn")
    assert got.index("auth") < got.index("turn")
    row = await until_state(ctx, "last_probe_at", lambda r: r["last_probe_at"] is not None)
    assert row["status"] == "logged_out"


async def test_wrk_fr_22_p26_two_runtimes_probe_once(ctx: Ctx) -> None:
    """WRK-FR-22 · P26 · 2 Runtime cùng `ok` ⇒ tổng `.calls` = 1 `auth` + 1 `turn`; ≥ 1
    `probe.skipped` (`locked`|`recent`) [H3a-R11 · HUB-H3a-AC-08 · F4]"""
    write_probe(ctx, "ok")
    rts = [start(ctx, 60, w, LOG_LEVEL="debug") for w in ("qc-1", "qc-2")]
    await until_state(ctx, "last_probe_at", lambda r: r["last_probe_at"] is not None)

    async def skipped() -> bool:
        lines = [x for rt in rts for x in logs(rt, "probe.skipped")]
        return any(x.get("reason") in ("locked", "recent") for x in lines)

    await wait_until(skipped, WAIT_S, "probe.skipped locked|recent", ctx.alive)
    got = calls(ctx)
    assert (got.count("auth"), got.count("turn")) == (1, 1), got


async def test_wrk_fr_22_p27_no_early_probe_then_job_updates_last_ok(ctx: Ctx) -> None:
    """WRK-FR-22 · P27 · `last_ok_at = now−58 s`, chu kỳ 60 ⇒ probe không sớm hơn last_ok+60 s; job
    thành công ⇒ `last_ok_at` mới, `updated_at` không đổi [H3a-R12 · PL4 · PL14 · HUB-H3a-AC-09]"""
    await set_state(ctx, "ok", last_ok_at="now() - interval '58 seconds'")
    base = (await state(ctx) or {})["last_ok_at"]
    write_probe(ctx, "ok")
    start(ctx, 60)
    await until_calls(ctx, "turn")
    row = await until_probed_after(ctx, base + timedelta(seconds=60))
    upd, ok0 = row["updated_at"], row["last_ok_at"]
    job = await ctx.job(tenant=BETA)
    await ctx.until_status(job, ["succeeded"], WAIT_S)
    after = await state(ctx) or {}
    assert after["last_ok_at"] > ok0 and after["updated_at"] == upd


async def test_wrk_fr_22_p28_recent_ok_zero_provider_calls(ctx: Ctx) -> None:
    """WRK-FR-22 · P28 · `last_ok_at = now()`, chu kỳ 60 ⇒ sẵn sàng + 1 job ⇒ 0 lời gọi probe,
    `last_probe_at` NULL [H3a-R12 · HUB-H3a-AC-09]"""
    await set_state(ctx, "ok", last_ok_at="now()")
    write_probe(ctx, "ok")
    start(ctx, 60)
    await until_ready(ctx)
    job = await ctx.job(tenant=BETA)
    await ctx.until_status(job, ["succeeded"], WAIT_S)
    assert calls(ctx) == []
    assert (await state(ctx) or {})["last_probe_at"] is None


async def test_wrk_fr_22_p29_cooldown_expired_recovers(ctx: Ctx) -> None:
    """WRK-FR-22 · P29 · `cooldown` hết hạn sau 2 s + `ok` ⇒ `ok` + `recovered{from:cooldown}`;
    `last_probe_at ≥ cooldown_until` [H3a-R13 · HUB-H3a-AC-09]"""
    await set_state(ctx, "cooldown", cooldown_until="now() + interval '2 seconds'")
    until = (await state(ctx) or {})["cooldown_until"]
    write_probe(ctx, "ok")
    rt = start(ctx, 60)
    row = await until_state(ctx, "ok", is_("ok"))
    assert row["last_probe_at"] is not None and row["last_probe_at"] >= until
    await until_log(ctx, rt, "provider.recovered", from_="cooldown")


async def test_wrk_fr_22_p30_startup_probe_replaces_blind_reset(ctx: Ctx) -> None:
    """WRK-FR-22 · P30 · `error` (3 lỗi) + `logged_out` ⇒ khởi động thành `logged_out` (probe thay
    reset mù H1) [H3a-R13 · PL2 · HUB-H3a-AC-09]"""
    await set_state(ctx, "error", consecutive_errors="3")
    write_probe(ctx, "logged_out")
    start(ctx, 60)
    row = await until_state(ctx, "logged_out", is_("logged_out"))
    assert row["last_probe_at"] is not None


async def test_wrk_fr_22_p31_probe_off_keeps_blind_reset(ctx: Ctx) -> None:
    """WRK-FR-22 · P31 · `PROBE_S=0` + `error` ⇒ `ok` (reset mù H1), `.calls` không có [H3a-R17 ·
    PL2]"""
    await set_state(ctx, "error", consecutive_errors="3")
    write_probe(ctx, "logged_out")
    start(ctx, 0)
    await until_state(ctx, "ok", is_("ok"))
    await until_ready(ctx)
    assert calls(ctx) == []


async def test_wrk_fr_22_p32_cooldown_not_probed_until_due(ctx: Ctx) -> None:
    """WRK-FR-22 · P32 · `cooldown` +1 h ⇒ khởi động không probe; đổi hạn `now()+1 s` ⇒ vòng sống,
    probe chạy [PL3]"""
    await set_state(ctx, "cooldown", cooldown_until="now() + interval '1 hour'")
    write_probe(ctx, "ok")
    start(ctx, 60)
    await until_ready(ctx)
    assert (await state(ctx) or {})["last_probe_at"] is None
    await ctx.conn.execute(
        "update hub.provider_state set cooldown_until = now() + interval '1 second' "
        "where provider_key = $1",
        FAKE,
    )
    await until_probed_after(ctx, await db_now(ctx))


async def test_wrk_fr_22_p33_job_cooldown_during_slow_probe_is_stale(ctx: Ctx) -> None:
    """WRK-FR-22 · P33 · probe `ok:3000` đang chạy, job `#fake:ratelimit` ⇒ `cooldown` = ts giữ
    nguyên sau probe; log `probe.stale` [H3a-R15 · G2 · HUB-H3a-AC-10]"""
    ts = int(time.time()) + 3600
    await set_state(ctx, "ok", last_ok_at="now() - interval '1 hour'")
    write_probe(ctx, "ok:3000")
    rt = start(ctx, 60)
    await until_calls(ctx, "turn")
    job = await ctx.job(tenant=BETA, prompt=f"#fake:ratelimit={ts}")
    row = await ctx.until_status(job, ["failed"], WAIT_S)
    assert row["error_reason"] == "quota"
    await until_log(ctx, rt, "probe.stale")
    st = await state(ctx) or {}
    assert (st["status"], st["cooldown_until"]) == ("cooldown", datetime.fromtimestamp(ts, UTC))


async def test_wrk_fr_22_p34_owner_change_during_probe_is_stale(ctx: Ctx) -> None:
    """WRK-FR-22 · P34 · `logged_out`, probe `ok:3000`; owner đổi sang `cooldown` giữa lượt ⇒ cuối
    `cooldown` (PROBE_RECOVER bị rào), `probe.stale` [H3a-R15 · HUB-H3a-AC-10]"""
    await set_state(ctx, "logged_out")
    write_probe(ctx, "ok:3000")
    rt = start(ctx, 60)
    await until_calls(ctx, "turn")
    await ctx.conn.execute(
        """update hub.provider_state set status = 'cooldown', updated_at = now(),
             cooldown_until = now() + interval '1 hour' where provider_key = $1""",
        FAKE,
    )
    await until_log(ctx, rt, "probe.stale")
    assert (await state(ctx) or {})["status"] == "cooldown"


async def test_wrk_fr_22_p35_probe_result_log_no_usage_no_pii(ctx: Ctx) -> None:
    """WRK-FR-22 · P35 · `probe.result{ok, step:turn, ms, 10/1 token}`; 0 `usage_logs`; log không
    `Reply`/`@`/`organization`/`accessToken` [H3a-R17 · HUB-H3a-AC-11]"""
    write_probe(ctx, "ok")
    rt = start(ctx, 60)
    res = (await until_log(ctx, rt, "probe.result"))[0]
    assert (res["provider"], res["ok"], res["step"]) == (FAKE, True, "turn")
    assert isinstance(res["ms"], int)
    assert (res["input_tokens"], res["output_tokens"]) == (10, 1)
    assert await ctx.conn.fetchval("select count(*) from hub.usage_logs") == 0
    # `runtime.start` có URL DB (`user:***@host`) — chỉ quét log probe/provider/claude của ca
    probe = ("probe.", "provider.", "claude.")
    out = json.dumps([x for x in logs(rt) if str(x.get("event", "")).startswith(probe)])
    for bad in ("Reply", "@", "organization", "accessToken"):
        assert bad not in out, bad


async def test_wrk_fr_22_p36_probe_warning_once_per_window(ctx: Ctx) -> None:
    """WRK-FR-22 · P36 · `warning:0.85:<ts>` 2 lượt ⇒ `ok`, util 0.85, cửa sổ ts; `quota_warning`
    đúng 1; đổi cửa sổ ⇒ thêm đúng 1 [H3a-R03 · HUB-H3a-AC-03]"""
    ts = int(time.time()) + 3600
    write_probe(ctx, f"warning:0.85:{ts}")
    rt = start(ctx, 2)
    await until_calls(ctx, "turn", 2)
    row = await until_state(ctx, "warn", lambda r: r["warn_at"] is not None)
    assert row["status"] == "ok" and abs(float(row["utilization"]) - 0.85) < 1e-6
    assert row["warn_resets_at"] == datetime.fromtimestamp(ts, UTC)
    await until_log(ctx, rt, "provider.quota_warning")
    assert len(logs(rt, "provider.quota_warning")) == 1
    write_probe(ctx, f"warning:0.85:{ts + 3600}")
    await until_log(ctx, rt, "provider.quota_warning", 2)
    await until_calls(ctx, "turn", calls(ctx).count("turn") + 1)
    assert len(logs(rt, "provider.quota_warning")) == 2


async def test_wrk_fr_22_p37_probe_does_not_wait_claim_lock(ctx: Ctx) -> None:
    """WRK-FR-22 · P37 · owner giữ `K_CLAIM` ⇒ probe `ok` vẫn ghi `last_probe_at` (0 lần chờ khoá
    claim) [spec §6 · P8 · G3]"""
    from agent_runtime.db.jobs_sql import K_CLAIM

    write_probe(ctx, "ok")
    start(ctx, 2)
    await until_ready(ctx)
    async with owner_conn() as lock, lock.transaction():
        await lock.execute(K_CLAIM)
        await until_probed_after(ctx, await db_now(ctx))


async def test_wrk_fr_22_p38_no_lingering_lock_or_child(ctx: Ctx) -> None:
    """WRK-FR-22 · P38 · sau lượt probe không còn khoá `hub.provider.probe`; SIGTERM khi `hang` ⇒
    không còn con probe [K8 · H3a-R11]"""
    write_probe(ctx, "ok")
    first = start(ctx, 60, "qc-1")
    await until_state(ctx, "last_probe_at", lambda r: r["last_probe_at"] is not None)
    assert await advisory_probe_locks(ctx) == 0
    first.kill_all()
    await ctx.conn.execute("delete from hub.provider_state where provider_key = $1", FAKE)
    write_probe(ctx, "hang")
    rt = start(ctx, 60, "qc-2", timeout_s=HANG_S)

    async def child() -> list[int] | None:
        return probe_children(rt) or None

    kids = await wait_until(child, WAIT_S, "con probe đang treo", ctx.alive)
    rt.signal(signal.SIGTERM)
    await rt.wait_exit(WAIT_S)

    async def gone() -> bool:
        return not any(alive(p) for p in kids)

    await wait_until(gone, 5, "con probe bị giết khi SIGTERM")


async def test_wrk_fr_22_p39_disabled_provider_not_probed(ctx: Ctx) -> None:
    """WRK-FR-22 · P39 · `providers.enabled=false` ⇒ không probe; bật lại ⇒ có `turn` (vòng sống)
    [H3a-R11]"""
    await ctx.conn.execute("update hub.providers set enabled = false where key = $1", FAKE)
    write_probe(ctx, "ok")
    start(ctx, 60)
    await until_ready(ctx)
    assert calls(ctx) == [] and not probe_file(ctx).with_suffix(".txt.calls").exists()
    await ctx.conn.execute("update hub.providers set enabled = true where key = $1", FAKE)
    await until_calls(ctx, "turn")
