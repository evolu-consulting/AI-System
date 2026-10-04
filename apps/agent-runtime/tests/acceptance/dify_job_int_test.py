"""WRK-FR-07 · HUB-FR-80 · H2a-R09–R12, R15 · Q5 · RQ8, RQ9 · RT7 · P02–P05, P13–P17: job
`workflow.async` chạy trong Runtime thật với mock Dify + credential Python (test-plan-cases §5).

Nguồn: `plan-runtime` §3.3 (credential), §3.6 (huỷ/timeout + stop); `plan-runtime-dify` §3.2 (gọi
Dify, `final_text`), §3.5 (tiến độ), §3.7 (kết thúc + usage); `plan-errors` §2 (mã/`reason`).
Trước PY-03: đỏ ở `ModuleNotFoundError` (`DifyEnv.runtime` → `need_router`), DB/Redis/mock đã dựng.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

import pytest

from tests.acceptance._dify import (
    DIFY_USER,
    FEATURE,
    MOCK_TEXT,
    NODE_SECRET,
    PROGRESS_OK,
    DifySpec,
    dify_env,
    progress,
)
from tests.acceptance._rt import cancel_job, result_of, terminal, wait_until
from tests.acceptance.conftest import Ctx
from tests.support.dify_mock import CredentialSpec

pytestmark = pytest.mark.int

END_S = 15.0


def failure(row: dict[str, Any]) -> tuple[Any, Any, Any]:
    return row["status"], row["error_code"], row["error_reason"]


async def test_wrk_fr_07_p02_ok_text_usage_dify(ctx: Ctx) -> None:
    """P02 · R15 · `mk-ok` → `succeeded{kind:text}`, XADD `job.result{output.kind=text}`; mock nhận
    streaming + `user=dify_user` + inputs; `usage_logs` 1 dòng `dify/dify/NULL`, agent NULL,
    `feature_id` = payload, workflow: input=`total_tokens`, output 0, cost 0."""
    async with dify_env(ctx) as d:
        job = await d.job()
        d.runtime()
        row = await ctx.until_status(job, ["succeeded"], END_S)
        assert result_of(row) == {"kind": "text", "text": MOCK_TEXT}
        ends = terminal(await ctx.evs(job))
        assert [(e["type"], e["output"]["kind"]) for e in ends] == [("job.result", "text")]
        [run] = d.runs()
        assert run.path == "/v1/workflows/run" and run.auth == "Bearer mk-ok"
        assert run.body["response_mode"] == "streaming"
        assert (run.body["user"], run.body["inputs"]) == (DIFY_USER, {"source_text": "xin chào"})
        assert "query" not in run.body
        rows = await ctx.conn.fetch("select * from hub.usage_logs where job_id = $1", job.id)
        assert len(rows) == 1
        u = rows[0]
        assert (u["billing"], u["provider_key"], u["model"], u["agent_id"]) == (
            "dify",
            "dify",
            None,
            None,
        )
        assert str(u["feature_id"]) == FEATURE
        assert (u["input_tokens"], u["output_tokens"], u["cost_usd"]) == (20, 0, Decimal(0))
        assert (u["cache_read_tokens"], u["cache_write_tokens"]) == (None, None)


async def test_wrk_fr_07_p03_chat_query_vs_workflow(ctx: Ctx) -> None:
    """P03 · R09 · app `chat` → `/chat-messages` có `query`, `conversation_id:""`; usage chat
    (prompt/completion, `total_price` USD); app `workflow` → `/workflows/run` không `query`."""
    async with dify_env(ctx) as d:
        chat = await d.job(
            DifySpec(app_type="chat", query="hỏi gì đó", inputs={}),
            CredentialSpec(app_type="chat"),
        )
        wf = await d.job()
        d.runtime()
        for j in (chat, wf):
            await ctx.until_status(j, ["succeeded"], END_S)
        by_path = {c.path: c.body for c in d.runs()}
        assert by_path["/v1/chat-messages"]["query"] == "hỏi gì đó"
        assert by_path["/v1/chat-messages"].get("conversation_id") == ""
        assert "query" not in by_path["/v1/workflows/run"]
        assert result_of(await ctx.until_status(chat, ["succeeded"], 1)) == {
            "kind": "text",
            "text": MOCK_TEXT,
        }
        u = await ctx.conn.fetchrow("select * from hub.usage_logs where job_id = $1", chat.id)
        assert u is not None
        assert (u["input_tokens"], u["output_tokens"], u["cost_usd"]) == (12, 8, Decimal("0.0001"))


@pytest.mark.parametrize("field", ["text", None])
async def test_wrk_fr_07_p04_outputs_field(ctx: Ctx, field: str | None) -> None:
    """P04 · R09 · RQ8 · `mk-outputs` (không chunk) → text từ `outputs[output_field]`; `null` →
    khoá `text`."""
    async with dify_env(ctx) as d:
        job = await d.job(DifySpec(output_field=field), CredentialSpec(api_key="mk-outputs"))
        d.runtime()
        row = await ctx.until_status(job, ["succeeded"], END_S)
        assert result_of(row) == {"kind": "text", "text": MOCK_TEXT}


async def test_wrk_fr_07_p04_outputs_missing_field_invalid(ctx: Ctx) -> None:
    """P04 · R11 · `mk-outputs` + `output_field` không có trong outputs → rỗng →
    `UPSTREAM_ERROR`/`invalid_output`."""
    async with dify_env(ctx) as d:
        job = await d.job(DifySpec(output_field="khac"), CredentialSpec(api_key="mk-outputs"))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "UPSTREAM_ERROR", "invalid_output")


@pytest.mark.parametrize(
    ("key", "reason"),
    [("mk-empty", "invalid_output"), ("mk-failed", "upstream"), ("mk-error-event", "upstream")],
)
async def test_wrk_fr_07_p05_upstream_failures(ctx: Ctx, key: str, reason: str) -> None:
    """P05 · R11 · `mk-empty` → `invalid_output`; `mk-failed`, `mk-error-event` → `upstream`;
    1 lời gọi (không retry); XADD `job.failed` đúng mã; message tĩnh (không thân Dify)."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key=key))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "UPSTREAM_ERROR", reason)
        assert len(d.runs()) == 1
        [end] = terminal(await ctx.evs(job))
        assert (end["type"], end["code"], end["reason"]) == ("job.failed", "UPSTREAM_ERROR", reason)
        assert "mock" not in str(end["message"]).lower()


@pytest.mark.parametrize("status", [409, 401])
async def test_wrk_fr_06_p13_credential_rejected(ctx: Ctx, status: int) -> None:
    """P13 · Q5 · credential 409/401 → `NOT_CONFIGURED`/`credential`, không retry (1 lời gọi
    credential), Dify 0 lời gọi, không `usage_logs`."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(status=status))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "NOT_CONFIGURED", "credential")
        assert (len(d.creds(job)), len(d.runs())) == (1, 0)
        n = await ctx.conn.fetchval("select count(*) from hub.usage_logs where job_id = $1", job.id)
        assert n == 0


async def test_wrk_fr_06_p13_credential_bearer_is_claim_token(ctx: Ctx) -> None:
    """P13 · R17 · Bearer credential = token claim (sha256 = `token_hash`, mock xác thực bằng DB
    như Hub); không body; URL gốc từ env `AGENT_RT_HUB_URL`."""
    async with dify_env(ctx) as d:
        job = await d.job()
        d.runtime()
        await ctx.until_status(job, ["succeeded"], END_S)
        [c] = d.creds(job)
        assert c.path == f"/internal/jobs/{job.id}/dify-credential"
        assert c.auth.startswith("Bearer ") and len(c.auth) == len("Bearer ") + 43
        assert c.body == {}


async def test_wrk_fr_06_p13_credential_5xx_retry_then_credential(ctx: Ctx) -> None:
    """P13 · Q5 · credential 5xx liên tục → thử lại như hàng "kết nối" (3 lần) rồi
    `NOT_CONFIGURED`/`credential`; Dify 0 lời gọi."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(fail_5xx=5))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "NOT_CONFIGURED", "credential")
        assert (len(d.creds(job)), len(d.runs())) == (3, 0)


async def test_wrk_fr_06_p13_credential_5xx_once_then_ok(ctx: Ctx) -> None:
    """P13 · Q5 · credential 503 một lần → thử lại → 200 → `succeeded` (2 lời gọi credential)."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(fail_5xx=1))
        d.runtime()
        await ctx.until_status(job, ["succeeded"], END_S)
        assert (len(d.creds(job)), len(d.runs())) == (2, 1)


async def test_wrk_fr_06_p14_app_type_mismatch(ctx: Ctx) -> None:
    """P14 · RQ9 · credential `app_type` (chat) ≠ payload (workflow) → `NOT_CONFIGURED`/
    `credential`, Dify 0 lời gọi."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(app_type="chat"))
        d.runtime()
        row = await ctx.until_status(job, ["failed"], END_S)
        assert failure(row) == ("failed", "NOT_CONFIGURED", "credential")
        assert len(d.runs()) == 0


async def test_wrk_fr_07_p15_cancel_mid_stream_stops(ctx: Ctx) -> None:
    """P15 · R10 · `job_cancel` giữa stream `mk-slow-1000` → `cancelled` + `job.failed CANCELLED`
    ≤ 5 s; mock nhận stop đúng `task_id`, body `{user}`."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="mk-slow-1000"))
        d.runtime()

        async def streaming() -> bool:
            return len(d.runs()) == 1

        await wait_until(streaming, 10, "Dify nhận lời gọi", ctx.alive)
        await ctx.until_status(job, ["running"], 1)
        t0 = datetime.now().timestamp()
        await cancel_job(ctx.conn, job)
        row = await ctx.until_status(job, ["cancelled"], 5)
        assert row["error_code"] == "CANCELLED"
        assert datetime.now().timestamp() - t0 <= 5.0
        [end] = terminal(await ctx.evs(job))
        assert (end["type"], end["code"]) == ("job.failed", "CANCELLED")

        async def stopped() -> bool:
            return len(d.stops()) >= 1

        await wait_until(stopped, 3, "mock nhận stop", ctx.alive)
        [stop] = d.stops()
        assert stop.path == "/v1/workflows/tasks/task-1/stop"
        assert stop.body == {"user": DIFY_USER} and stop.auth == "Bearer mk-slow-1000"


async def test_wrk_fr_07_p16_timeout_stops(ctx: Ctx) -> None:
    """P16 · R12 · `timeout_s=1` + `mk-slow-1000` → `timed_out` + `TIMEOUT`/`timeout` + stop."""
    async with dify_env(ctx) as d:
        job = await d.job(DifySpec(timeout_s=1), CredentialSpec(api_key="mk-slow-1000"))
        d.runtime()
        row = await ctx.until_status(job, ["timed_out"], 10)
        assert (row["error_code"], row["error_reason"]) == ("TIMEOUT", "timeout")
        [end] = terminal(await ctx.evs(job))
        assert (end["type"], end["code"], end["status"]) == ("job.failed", "TIMEOUT", "timed_out")

        async def stopped() -> bool:
            return len(d.stops()) >= 1

        await wait_until(stopped, 3, "mock nhận stop", ctx.alive)


async def test_wrk_fr_07_p17_progress_static_throttled(ctx: Ctx) -> None:
    """P17 · R12 · RT7 · `node_started{title: NODE_SECRET_TITLE}` ×6 → `job.progress.message` ∈
    {"Đang chạy lệnh", "Đang chạy bước n"}, không chứa tiêu đề; ≤ 1 sự kiện/giây; `percent` null."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=CredentialSpec(api_key="qc-node"))
        d.runtime()
        await ctx.until_status(job, ["succeeded"], END_S)
        evs = [e for e in await ctx.evs(job) if e["type"] == "job.progress"]
        msgs = progress(evs)
        assert msgs and msgs[0] == "Đang chạy lệnh"
        assert all(m == PROGRESS_OK[0] or m.startswith(PROGRESS_OK[1]) for m in msgs), msgs
        assert not any(NODE_SECRET in m for m in msgs)
        assert all(e["percent"] is None for e in evs)
        ats = [datetime.fromisoformat(str(e["at"]).replace("Z", "+00:00")) for e in evs]
        gaps = [(b - a).total_seconds() for a, b in zip(ats, ats[1:], strict=False)]
        assert all(g >= 0.9 for g in gaps), gaps
