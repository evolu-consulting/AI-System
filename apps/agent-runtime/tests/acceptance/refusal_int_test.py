"""WRK-FR-15 · HUB-H2b-AC-08 · H2b-R27 · P26 (test-plan-py §2): F4 — `is_error` 0 token phân loại
theo chữ result (`classify_is_error`, `plan-runtime` §4): mẫu rate → `ALL_PROVIDERS_EXHAUSTED quota`
+ `cooldown` 30 phút; mẫu auth → `ALL_PROVIDERS_EXHAUSTED provider_unavailable` + `logged_out`;
không mẫu + 0 output → `UPSTREAM_ERROR refused`, `provider_state` không đổi; có output → H1
(`UPSTREAM_ERROR`, reason null). Chữ result không lộ ra `job.failed.message`/`jobs.error_message`/
XADD; chỉ vào log (đã che, ≤ 300).

Chỉ thị `#fake:is-error=<rate|auth|refused>` (test-plan L2, `plan-runtime` §6 — PY-04): `Final{
is_error:true}` với chữ cố định dưới, không `RateLimit`, usage `{in:10, out:0}` trừ khi có
`#fake:usage`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from tests.acceptance._rt import BETA, FAKE, events
from tests.acceptance._stream import finished, runtime_logs, stream_job
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

TEXT = {
    "rate": "You've hit your usage limit",
    "auth": "Not logged in · Please run /login",
    "refused": "I can't help with that.",
}


async def provider_state(ctx: Ctx) -> dict[str, Any] | None:
    row = await ctx.conn.fetchrow("select * from hub.provider_state where provider_key = $1", FAKE)
    return dict(row) if row is not None else None


async def run_refusal(ctx: Ctx, directive: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    job = await stream_job(ctx, None, tenant=BETA, prompt=f"{directive} câu hỏi")
    ctx.runtime()
    return await finished(ctx, job)


def failed_of(evs: list[dict[str, Any]]) -> list[tuple[str, str | None]]:
    return [(e["code"], e["reason"]) for e in evs if e["type"] == "job.failed"]


async def assert_text_hidden(ctx: Ctx, row: dict[str, Any], run_id: str, text: str) -> None:
    """Chữ result không ở `jobs.error_message`, `job.failed.message`, mọi XADD; có trong log."""
    assert text not in str(row["error_message"] or "")
    assert text not in json.dumps(await events(ctx.rd, run_id), ensure_ascii=False)
    assert text in runtime_logs(ctx)


async def test_wrk_fr_15_p26_is_error_rate(ctx: Ctx) -> None:
    """P26 · AC-08 · `#fake:is-error=rate` (0 token) → `job.failed ALL_PROVIDERS_EXHAUSTED quota`,
    `provider_state` `cooldown` ≈ now + 30 phút (± 1); chữ result không lộ."""
    row, evs = await run_refusal(ctx, "#fake:is-error=rate")
    assert (row["status"], row["error_code"], row["error_reason"]) == (
        "failed",
        "ALL_PROVIDERS_EXHAUSTED",
        "quota",
    )
    assert failed_of(evs) == [("ALL_PROVIDERS_EXHAUSTED", "quota")]
    st = await provider_state(ctx)
    assert st is not None and st["status"] == "cooldown"
    until = st["cooldown_until"]
    assert isinstance(until, datetime)
    assert timedelta(minutes=29) <= until - datetime.now(UTC) <= timedelta(minutes=31)
    await assert_text_hidden(ctx, row, str(row["run_id"]), TEXT["rate"])


async def test_wrk_fr_15_p26_is_error_auth(ctx: Ctx) -> None:
    """P26 · AC-08 · `#fake:is-error=auth` → `ALL_PROVIDERS_EXHAUSTED provider_unavailable`,
    `provider_state` `logged_out`; chữ result không lộ."""
    row, evs = await run_refusal(ctx, "#fake:is-error=auth")
    assert (row["status"], row["error_code"], row["error_reason"]) == (
        "failed",
        "ALL_PROVIDERS_EXHAUSTED",
        "provider_unavailable",
    )
    assert failed_of(evs) == [("ALL_PROVIDERS_EXHAUSTED", "provider_unavailable")]
    st = await provider_state(ctx)
    assert st is not None and st["status"] == "logged_out"
    await assert_text_hidden(ctx, row, str(row["run_id"]), TEXT["auth"])


async def test_wrk_fr_15_p26_is_error_refused(ctx: Ctx) -> None:
    """P26 · AC-08 · `#fake:is-error=refused` (0 output) → `UPSTREAM_ERROR refused`;
    `provider_state` không đổi (không có hàng / không `cooldown`/`logged_out`); chữ result không
    lộ."""
    row, evs = await run_refusal(ctx, "#fake:is-error=refused")
    assert (row["status"], row["error_code"], row["error_reason"]) == (
        "failed",
        "UPSTREAM_ERROR",
        "refused",
    )
    assert failed_of(evs) == [("UPSTREAM_ERROR", "refused")]
    st = await provider_state(ctx)
    assert st is None or st["status"] not in ("cooldown", "logged_out")
    await assert_text_hidden(ctx, row, str(row["run_id"]), TEXT["refused"])


async def test_wrk_fr_15_p26_is_error_with_output_is_h1(ctx: Ctx) -> None:
    """P26 · H1 · `#fake:is-error=refused #fake:usage=10,5` (output > 0, không mẫu) →
    `UPSTREAM_ERROR` reason `null` (PROVIDER_ERROR H1); chữ result không lộ."""
    row, evs = await run_refusal(ctx, "#fake:is-error=refused #fake:usage=10,5")
    assert (row["status"], row["error_code"], row["error_reason"]) == (
        "failed",
        "UPSTREAM_ERROR",
        None,
    )
    assert failed_of(evs) == [("UPSTREAM_ERROR", None)]
    await assert_text_hidden(ctx, row, str(row["run_id"]), TEXT["refused"])
