"""WRK-FR-14 · WRK-BR-03 · WRK-BR-06 · AC-W04 · H1-R23 · WRK-FR-03 · Q-T8 · P20–P25, P45a/b.

Session `cli_sessions` theo `(conversation, agent, provider_key)` + `tenant_id` (BR-06);
`fake-cli` lưu
session giả ở `AGENT_RT_WORK_DIR/.fake-sessions/` (plan-runtime §6, plan-runtime-fake §7).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from tests.acceptance._rt import (
    ACME,
    AGENT_A,
    BETA,
    FAKE,
    Job,
    agent_text,
    cancel_job,
    new_conversation,
    result_of,
)
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

FAKE_TAIL_MIN = 120  # plan-runtime-fake §7: câu cố định ≥ 120 ký tự


async def result_event(ctx: Ctx, job: Job) -> dict[str, Any]:
    evs = [e for e in await ctx.evs(job) if e["type"] == "job.result"]
    assert len(evs) == 1, evs
    return evs[0]


async def sessions(ctx: Ctx, conv: str) -> list[dict[str, Any]]:
    rows = await ctx.conn.fetch("select * from hub.cli_sessions where conversation_id = $1", conv)
    return [dict(r) for r in rows]


async def remember(ctx: Ctx, tenant: str, word: str) -> tuple[str, str]:
    conv = await new_conversation(ctx.conn, tenant)
    j = await ctx.job(tenant=tenant, conv=conv, use_session=True, prompt=f"#fake:remember={word}")
    await ctx.until_status(j, ["succeeded"], 15)
    return conv


async def test_wrk_ac_w04_resume_same_session(ctx: Ctx) -> None:
    """AC-W04 · lượt 1 `#fake:remember=xanh` → `cli_sessions` có dòng; lượt 2 `#fake:recall` cùng
    hội thoại/agent → "xanh", `session_resumed=true`."""
    ctx.runtime()
    conv = await remember(ctx, BETA, "xanh")
    rows = await sessions(ctx, conv[0])
    assert [(str(r["tenant_id"]), r["provider_key"]) for r in rows] == [(BETA, FAKE)]
    j2 = await ctx.job(tenant=BETA, conv=conv, use_session=True, prompt="#fake:recall")
    assert "xanh" in agent_text(await ctx.until_status(j2, ["succeeded"], 15))
    assert (await result_event(ctx, j2))["session_resumed"] is True


async def test_hub_h1_r23_lost_session_rebuilds_from_history(ctx: Ctx) -> None:
    """R23 · resume lỗi (`#fake:lost-session`) trước `tool_use` → chạy lại từ `history`, thành công,
    `session_resumed=false`, không báo lỗi."""
    ctx.runtime()
    conv = await remember(ctx, BETA, "xanh")
    hist = [{"role": "user", "content": "nhớ chữ xanh"}, {"role": "assistant", "content": "ok"}]
    j2 = await ctx.job(
        tenant=BETA, conv=conv, use_session=True, history=hist, prompt="#fake:lost-session"
    )
    await ctx.until_status(j2, ["succeeded"], 15)
    assert (await result_event(ctx, j2))["session_resumed"] is False


async def test_wrk_br_06_session_other_tenant_not_used(ctx: Ctx) -> None:
    """BR-06 · dòng `cli_sessions` cùng khoá nhưng `tenant_id` khác → không resume, không ghi đè."""
    conv = await new_conversation(ctx.conn, ACME)
    await ctx.conn.execute(
        """insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id,
        session_id)
           values ($1, $2, $3, $4, 'sess-of-beta')""",
        conv[0],
        AGENT_A,
        FAKE,
        BETA,
    )
    ctx.runtime()
    j = await ctx.job(tenant=ACME, conv=conv, use_session=True, prompt="#fake:recall")
    await ctx.until_status(j, ["succeeded"], 15)
    assert (await result_event(ctx, j))["session_resumed"] is False
    rows = await sessions(ctx, conv[0])
    assert [(str(r["tenant_id"]), r["session_id"]) for r in rows] == [(BETA, "sess-of-beta")]


async def test_wrk_br_03_other_provider_not_resumed(ctx: Ctx) -> None:
    """BR-03 · session của `provider_key` khác (`claude-sub`) → job `fake-cli` không resume."""
    conv = await new_conversation(ctx.conn, BETA)
    await ctx.conn.execute(
        """insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id,
        session_id)
           values ($1, $2, 'claude-sub', $3, 'sess-claude')""",
        conv[0],
        AGENT_A,
        BETA,
    )
    ctx.runtime()
    j = await ctx.job(tenant=BETA, conv=conv, use_session=True, prompt="#fake:recall")
    await ctx.until_status(j, ["succeeded"], 15)
    assert (await result_event(ctx, j))["session_resumed"] is False


async def test_hub_h1_r23_use_session_false_untouched(ctx: Ctx) -> None:
    """R23 · `use_session=false` → không đọc/ghi `cli_sessions` (dòng có sẵn giữ nguyên)."""
    conv = await new_conversation(ctx.conn, BETA)
    await ctx.conn.execute(
        """insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id,
             session_id, updated_at)
           values ($1, $2, $3, $4, 'keep', '2026-01-01T00:00:00Z')""",
        conv[0],
        AGENT_A,
        FAKE,
        BETA,
    )
    ctx.runtime()
    j = await ctx.job(tenant=BETA, conv=conv, use_session=False, prompt="#fake:remember=do")
    await ctx.until_status(j, ["succeeded"], 15)
    assert (await result_event(ctx, j))["session_resumed"] is False
    rows = await sessions(ctx, conv[0])
    assert [(r["session_id"], r["updated_at"]) for r in rows] == [
        ("keep", datetime(2026, 1, 1, tzinfo=UTC))
    ]


async def test_wrk_cancel_does_not_write_session(ctx: Ctx) -> None:
    """§2.3 bước 8 · huỷ job `use_session` → không ghi `cli_sessions`."""
    conv = await new_conversation(ctx.conn, BETA)
    j = await ctx.job(
        tenant=BETA, conv=conv, use_session=True, prompt="#fake:remember=xanh #fake:sleep=60"
    )
    ctx.runtime()
    await ctx.until_running(j)
    await cancel_job(ctx.conn, j)
    await ctx.until_status(j, ["cancelled"], 5)
    assert await sessions(ctx, conv[0]) == []


ORCH_PROMPT = (
    '<agents>[{"key":"assistant","description":"SECRET-AGENTS-1"}]</agents>\n'
    "<history>user: SECRET-HIST-1</history>\n"
    "<message>xin chào</message>"
)


async def orchestrator_text(ctx: Ctx) -> str:
    j = await ctx.job(tenant=BETA, output="text", prompt=ORCH_PROMPT)
    ctx.runtime()
    out = result_of(await ctx.until_status(j, ["succeeded"], 15))
    assert out["kind"] == "text", out
    ev = await result_event(ctx, j)
    assert ev["output"] == out and ev["session_resumed"] is False
    return str(out["text"])


async def test_wrk_fr_03_p45a_fake_echoes_only_message(ctx: Ctx) -> None:
    """P45a · Orchestrator `fake-cli` chỉ echo khối `<message>`: `"echo: xin chào"` + câu cố định;
    không chứa chuỗi mồi, `<agents>`, `<history>` (Q-T8)."""
    raw = await orchestrator_text(ctx)
    # plan-runtime-fake §7: Orchestrator không chỉ thị → `answer{text}` (JSON).
    decision = json.loads(raw)
    assert decision["decision"] == "answer"
    text = decision["text"]
    assert text.startswith("echo: xin chào ")
    for bad in ("SECRET-AGENTS-1", "SECRET-HIST-1", "<agents>", "<history>", "<message>"):
        assert bad not in raw


async def test_k_r1_p45b_fake_tail_long_enough(ctx: Ctx) -> None:
    """P45b · phần cố định sau `"echo: xin chào "` ≥ 120 ký tự (⇒ Hub cắt ≥ 3 `delta`, H1-R09)."""
    text = await orchestrator_text(ctx)
    assert len(text) - len("echo: xin chào ") >= FAKE_TAIL_MIN
