"""WRK-FR-13 · HUB-FR-50 · HUB-FR-95 · RT1 · H2a-R18–R21 · H1-R17 · P01, P24–P27: token claim cho
mọi job (`plan-runtime` §3.3) và MCP Hub qua `fake-cli` (`plan-runtime` §4.2, §5, §6) với server
MCP giả `tests/support/mcp_mock.py` (PY-06).

API `mcp_mock` mà test này dùng (PY-06 làm theo, ghi `test-plan` §10 QW-P):
`start_mcp_mock(tools: dict[key, mô tả], confirm: dict[key, {question, choices}] | None)` — async
context manager → mock có `.url` (URL `/mcp` đầy đủ, đặt vào `payload.mcp.url`) và
`.calls(method: str | None = None)` → bản ghi có `.method`, `.params` (dict), `.auth` (header
`Authorization`). Tool trong `confirm` trả `isError` + `content[0]` JSON `CONFIRMATION_REQUIRED`
+ `content[1]` câu chỉ dẫn (R6); tool khác trả thành công.
Import trong thân test: trước PY-06 đỏ ở `ModuleNotFoundError: tests.support.mcp_mock`.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import stat
from pathlib import Path
from typing import Any

import pytest

from tests.acceptance._proc import Runtime
from tests.acceptance._rt import (
    BETA,
    ORCH,
    Job,
    JobSpec,
    agent_text,
    cmdline,
    events,
    job_row,
    result_of,
    wait_until,
)
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

INVOICE = {"check-invoice": "Kiểm tra một hoá đơn điện tử"}
CONFIRM = {"create-trello-card": {"question": 'Tạo thẻ Trello "A"?', "choices": ["Đồng ý", "Huỷ"]}}
END_S = 20.0


def mcp_mock() -> Any:
    return importlib.import_module("tests.support.mcp_mock")


async def mcp_job(ctx: Ctx, spec: JobSpec, url: str, tools: list[str]) -> Job:
    """Job `agent.cli` + `payload.mcp = {url, tools}` (C2 `McpConfig`, không token — P4)."""
    job = await ctx.job(spec)
    mcp = {"url": url, "tools": tools}
    await ctx.conn.execute(
        "update hub.jobs set payload = jsonb_set(payload, '{mcp}', $2::jsonb) where id = $1",
        job.id,
        json.dumps(mcp),
    )
    job.payload["mcp"] = mcp
    return job


def token_of(call: Any) -> str:
    auth = str(call.auth)
    assert auth.startswith("Bearer "), auth
    return auth.removeprefix("Bearer ")


def argv_with(token: str) -> list[int]:
    """Pid có `token` trên `/proc/<pid>/cmdline` (spike #10)."""
    return [
        int(p.name)
        for p in Path("/proc").iterdir()
        if p.name.isdigit() and token in cmdline(int(p.name))
    ]


async def tool_calls(m: Any, n: int, ctx: Ctx) -> list[Any]:
    async def got() -> list[Any] | None:
        calls: list[Any] = list(m.calls("tools/call"))
        return calls if len(calls) >= n else None

    return await wait_until(got, 10, f"mcp_mock nhận {n} tools/call", ctx.alive)


async def test_wrk_fr_50_p01_agent_cli_claim_sets_token_hash(ctx: Ctx) -> None:
    """P01 · RT1 · claim job `agent.cli` (không MCP) → `token_hash` 32 byte ghi trong cùng câu
    claim; payload không có token."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=3")
    ctx.runtime()

    async def hashed() -> dict[str, Any] | None:
        row = await job_row(ctx.conn, job)
        return row if row["status"] != "queued" and row["token_hash"] is not None else None

    row = await wait_until(hashed, 5, f"job {job.id} claim có token_hash", ctx.alive)
    assert len(row["token_hash"]) == 32
    assert "token" not in json.dumps(row["payload"] if isinstance(row["payload"], dict) else {})


async def test_wrk_fr_50_p01_mcp_bearer_matches_token_hash(ctx: Ctx) -> None:
    """P01 · RT1 · FR-50 · Bearer tới MCP = token claim: sha256 = `jobs.token_hash`; token không có
    trong `jobs.*`, XADD, log JSON Runtime, `/proc/<pid>/cmdline` (CLI con)."""
    mm = mcp_mock()
    async with mm.start_mcp_mock(tools=INVOICE, confirm=None) as m:
        prompt = '#fake:tool=check-invoice #fake:args={"x":"HD-1"} #fake:sleep=3'
        job = await mcp_job(ctx, JobSpec(tenant=BETA, prompt=prompt), m.url, ["check-invoice"])
        rt = ctx.runtime()
        [call] = await tool_calls(m, 1, ctx)
        token = token_of(call)
        row = await ctx.until_status(job, ["running"], 1)
        assert hashlib.sha256(token.encode("ascii")).digest() == bytes(row["token_hash"])
        assert argv_with(token) == []
        await ctx.until_status(job, ["succeeded"], END_S)
        dump = await ctx.conn.fetchval(
            "select to_jsonb(j)::text from hub.jobs j where id = $1", job.id
        )
        assert token not in str(dump)
        assert token not in json.dumps(await events(ctx.rd, job.run_id))
        assert token not in rt.stdout() + rt.err.read_text(errors="replace")


async def test_wrk_fr_13_p24_fake_cli_calls_mcp_tool(ctx: Ctx) -> None:
    """P24 · WRK-FR-13 · `#fake:tool=check-invoice #fake:args={…}` → mock nhận `tools/call{name,
    arguments}` + Bearer token claim; file MCP 0600 ngoài `work/<job_id>`, bị xoá sau job; không
    token trong argv."""
    mm = mcp_mock()
    async with mm.start_mcp_mock(tools=INVOICE, confirm=None) as m:
        prompt = '#fake:tool=check-invoice #fake:args={"x":"HD-1","y":"ghi chú"} #fake:sleep=3'
        job = await mcp_job(ctx, JobSpec(tenant=BETA, prompt=prompt), m.url, ["check-invoice"])
        ctx.runtime()
        [call] = await tool_calls(m, 1, ctx)
        assert call.params["name"] == "check-invoice"
        assert call.params["arguments"] == {"x": "HD-1", "y": "ghi chú"}
        cfg = ctx.box.work / ".mcp" / f"{job.id}.json"
        assert cfg.is_file(), cfg
        assert stat.S_IMODE(cfg.stat().st_mode) == 0o600
        assert (ctx.box.work / job.id) not in cfg.parents
        assert argv_with(token_of(call)) == []
        await ctx.until_status(job, ["succeeded"], END_S)
        assert not cfg.exists()


async def test_hub_fr_95_p25_confirmation_forces_need_input(ctx: Ctx) -> None:
    """P25 · FR-95 · R21 · mock trả `CONFIRMATION_REQUIRED` đúng hình → job `succeeded`
    `need_input{question, choices}` = của Hub; đúng 1 `tools/call`, không retry/resume."""
    mm = mcp_mock()
    async with mm.start_mcp_mock(tools={"create-trello-card": "Tạo thẻ"}, confirm=CONFIRM) as m:
        prompt = '#fake:tool=create-trello-card #fake:args={"title":"A"}'
        job = await mcp_job(ctx, JobSpec(tenant=BETA, prompt=prompt), m.url, ["create-trello-card"])
        ctx.runtime()
        row = await ctx.until_status(job, ["succeeded"], END_S)
        out = result_of(row)
        assert out["kind"] == "agent_result"
        want = CONFIRM["create-trello-card"]
        assert out["result"] == {
            "status": "need_input",
            "question": want["question"],
            "choices": want["choices"],
        }
        assert len(m.calls("tools/call")) == 1
        assert row["attempts"] == 1


@pytest.mark.parametrize("tool", ["khac-tool", "mcp__other__x"])
async def test_wrk_fr_13_p26_tool_outside_mcp_not_called(ctx: Ctx, tool: str) -> None:
    """P26 · R19 · `#fake:tool=<x>` với `x` ∉ `payload.mcp.tools` → không gọi MCP (nghĩa H1:
    tool_use thường qua hook); `mcp__other__x` → deny `tool_not_allowed`."""
    mm = mcp_mock()
    async with mm.start_mcp_mock(tools=INVOICE, confirm=None) as m:
        job = await mcp_job(
            ctx, JobSpec(tenant=BETA, prompt=f"#fake:tool={tool}"), m.url, ["check-invoice"]
        )
        ctx.runtime()
        row = await ctx.until_status(job, ["succeeded"], END_S)
        text = agent_text(row)
        assert text.startswith("denied:"), text
        if tool.startswith("mcp__"):
            assert "tool_not_allowed" in text
        assert list(m.calls()) == []


async def test_h1_r17_p27_orchestrator_ignores_mcp(ctx: Ctx) -> None:
    """P27 · H1-R17 · Orchestrator (`output=text`) có `mcp` ≠ null → bỏ qua MCP (mock 0 request),
    log `warn`, job vẫn `succeeded`."""
    mm = mcp_mock()
    async with mm.start_mcp_mock(tools=INVOICE, confirm=None) as m:
        spec = JobSpec(
            tenant=BETA,
            output="text",
            agent_id=ORCH,
            prompt="<message>#fake:tool=check-invoice</message>",
        )
        job = await mcp_job(ctx, spec, m.url, ["check-invoice"])
        rt: Runtime = ctx.runtime()
        await ctx.until_status(job, ["succeeded"], END_S)
        assert list(m.calls()) == []
        warns = [
            json.loads(line)
            for line in rt.stdout().splitlines()
            if line.startswith("{") and '"mcp' in line
        ]
        assert any(w.get("level") in ("warning", "warn") for w in warns), warns
