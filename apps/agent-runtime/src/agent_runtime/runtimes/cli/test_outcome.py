"""WRK-FR-15 · WRK-FR-17 · H1-R24 · H1-R25 · `outcome.py`: kết quả job, provider, usage."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from agent_runtime.db.provider_state_sql import Broken
from agent_runtime.providers.base import Fatal, Final, RateLimit, UsageEv
from agent_runtime.runtimes.cli.outcome import (
    CRASHED,
    LOGGED_OUT,
    PROVIDER_ERROR,
    RATE_LIMITED,
    REFUSED,
    Seen,
    broken_of,
    decide_exit,
    usage_row,
)
from agent_runtime.runtimes.cli.test_runner import payload


def test_wrk_fr_15_rate_limit_cooldown_reset_or_30min() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    reset = now + timedelta(hours=1)
    b = broken_of(RateLimit(status="rejected", resets_at=int(reset.timestamp())), now)
    assert (b.status, b.until, b.reason) == ("cooldown", reset, "quota")
    assert broken_of(RateLimit(status="rejected"), now).until == now + timedelta(minutes=30)
    out = broken_of(RateLimit(status="logged_out"), now)
    assert (out.status, out.until, out.reason) == ("logged_out", None, "provider_unavailable")


def test_wrk_fr_15_h3a_r02_reset_out_of_range_uses_default_s() -> None:
    """H3a-R02: `resets_at` quá 8 ngày / đã qua ⇒ `now + default_s` (env `COOLDOWN_DEFAULT_S`)."""
    now = datetime(2026, 1, 1, tzinfo=UTC)
    far = int((now + timedelta(days=8, seconds=1)).timestamp())
    past = int((now - timedelta(seconds=1)).timestamp())
    for ts in (far, past):
        got = broken_of(RateLimit(status="rejected", resets_at=ts), now, 60)
        assert got.until == now + timedelta(seconds=60)
    edge = now + timedelta(days=8)
    assert broken_of(RateLimit(status="rejected", resets_at=int(edge.timestamp())), now).until == (
        edge
    )


def test_wrk_fr_15_decide_exit_provider_effect() -> None:
    p = payload()
    rl = Seen(
        rate_limit=RateLimit(status="rejected"), final=Final(kind="agent_result", is_error=True)
    )
    v = decide_exit(p, rl)
    assert v.failure == RATE_LIMITED and isinstance(v.provider, Broken)
    assert decide_exit(p, Seen(rate_limit=RateLimit(status="logged_out"))).failure == LOGGED_OUT
    crash = decide_exit(p, Seen())
    assert (crash.failure, crash.provider) == (CRASHED, "error")
    fatal = decide_exit(p, Seen(fatal=Fatal(code="UPSTREAM_ERROR", msg="x", reason="crash")))
    assert fatal.provider == "error"
    out = UsageEv.model_validate({"in": 1, "out": 3})
    is_err = decide_exit(p, Seen(final=Final(kind="agent_result", is_error=True), usage=out))
    assert (is_err.failure, is_err.provider) == (PROVIDER_ERROR, "none")
    ok = Final(kind="agent_result", structured={"status": "done", "text": "xong"})
    good = decide_exit(p, Seen(final=ok))
    assert (good.failure, good.provider, good.finish().status) == (None, "ok", "succeeded")


def test_hub_h1_r25_usage_row_totals_and_absent() -> None:
    p = payload()
    assert usage_row(p, Seen().total(), 5) is None
    seen = Seen(
        usage=UsageEv.model_validate({"in": 10, "out": 2, "cache_read": 3, "cache_write": 4})
    )
    seen.next_attempt()
    seen.usage = UsageEv.model_validate({"in": 1, "out": 1, "model": "m1"})
    row = usage_row(p, seen.total(), 42)
    assert row is not None
    assert (row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens) == (
        18,
        3,
        3,
        4,
    )
    assert (row.model, row.latency_ms, row.keys.agent_id) == ("m1", 42, p.agent.id)


def test_wrk_fr_15_h2b_f4_is_error_classified() -> None:
    """H2b F4 (plan-runtime §4): `is_error` chưa có `RateLimit` → mẫu rate/auth (bất kể output),
    `stop_reason == "refusal"` ∧ 0 output → `refused` (TC-8), không tín hiệu → `PROVIDER_ERROR`;
    chữ lấy `text` → `raw_json` → `errors`."""
    p = payload()

    def verdict(final: Final, out: int = 0) -> tuple[object, object]:
        usage = UsageEv.model_validate({"in": 10, "out": out})
        v = decide_exit(p, Seen(final=final, usage=usage))
        return v.failure, v.provider

    rate, prov = verdict(Final(kind="text", is_error=True, text="You've hit your usage limit"), 7)
    assert rate == RATE_LIMITED and isinstance(prov, Broken) and prov.status == "cooldown"
    auth, prov = verdict(Final(kind="text", is_error=True, raw_json="Not logged in · /login"))
    assert auth == LOGGED_OUT and isinstance(prov, Broken) and prov.status == "logged_out"
    err = Final(kind="agent_result", is_error=True, errors=["I can't help with that."])
    assert verdict(err) == (PROVIDER_ERROR, "none")  # TC-8: không tín hiệu ⇒ H1
    refused = err.model_copy(update={"stop_reason": "refusal"})
    assert verdict(refused) == (REFUSED, "none")
    assert REFUSED.code == "UPSTREAM_ERROR" and REFUSED.reason == "refused"
    assert verdict(refused, 5) == (PROVIDER_ERROR, "none")
    assert verdict(Final(kind="text", is_error=True, stop_reason="end_turn")) == (
        PROVIDER_ERROR,
        "none",
    )
    rl = Seen(rate_limit=RateLimit(status="rejected"), final=err)  # nhánh H1 `result_signal`
    assert decide_exit(p, rl).failure == RATE_LIMITED
