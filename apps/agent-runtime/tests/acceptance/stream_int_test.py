"""WRK-FR-03 · HUB-H2b-AC-07 · H2b-R20, R21, R25 · P20–P25 (test-plan-py §2): `job.delta` của
`fake-cli` qua Runtime thật — chỉ khi `payload.stream is True`, kind theo vai, gom 100 ms / 200
ký tự (`AGENT_RT_DELTA_FLUSH_*`), cắt ≤ 4 000 đơn vị UTF-16, mọi `job.delta` trước kết thúc, `seq`
chung bộ đếm job; đã phát ⇒ không thử lại JSON (R21).

Nguồn: `plan-runtime` §3.1, §3.3, §3.5, §6 (`#fake:stream[=n]`, `stream-order`, `stream-badjson`,
`answer-len` — PY-04), §8 (env — PY-03).
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from tests.acceptance._rt import BETA, ORCH, Job, agent_text, result_of
from tests.acceptance._stream import (
    DELTA_MAX_UNITS,
    decision_text,
    deltas,
    end_index,
    finished,
    joined,
    orch_prompt,
    runtime_logs,
    stream_job,
    utf16_units,
)
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int


async def orch_job(ctx: Ctx, msg: str, stream: bool | None = True) -> Job:
    return await stream_job(
        ctx, stream, tenant=BETA, output="text", agent_id=ORCH, prompt=orch_prompt(msg)
    )


async def agent_job(ctx: Ctx, msg: str, stream: bool | None = True) -> Job:
    return await stream_job(ctx, stream, tenant=BETA, prompt=msg)


def assert_stream_shape(evs: list[dict[str, Any]], kind: str) -> None:
    """≥ 1 `job.delta{kind}`; mọi delta trước kết thúc; `seq` 1..n liền mạch; mỗi chunk ≤ 4 000."""
    ds = deltas(evs)
    assert ds, f"không có job.delta: {[e['type'] for e in evs]}"
    assert {d["kind"] for d in ds} == {kind}
    end = end_index(evs)
    assert end >= 0 and all(evs.index(d) < end for d in ds)
    assert [e["seq"] for e in evs] == list(range(1, len(evs) + 1))
    assert evs[0]["type"] == "job.started"
    for d in ds:
        assert 1 <= utf16_units(str(d["text"])) <= DELTA_MAX_UNITS


# ---------- P20 · Orchestrator answer ----------


async def test_wrk_fr_03_p20_orchestrator_answer_stream(ctx: Ctx) -> None:
    """P20 · AC-07 · Orchestrator `stream=true`, `#fake:stream=5 #fake:answer-len=300` → ≥ 1
    `job.delta{answer}` trước `job.result`, nối = `decision.text` (300 ký tự), `seq` liền mạch."""
    job = await orch_job(ctx, "#fake:stream=5 #fake:answer-len=300 viết đoạn dài")
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert_stream_shape(evs, "answer")
    assert row["status"] == "succeeded"
    text = decision_text(row)
    assert len(text) == 300
    assert joined(evs) == text


# ---------- P21 · stream vắng / false ----------


@pytest.mark.parametrize("stream", [None, False], ids=["absent", "false"])
async def test_wrk_fr_03_p21_no_stream_flag_no_delta(ctx: Ctx, stream: bool | None) -> None:
    """P21 · R25 · cùng chỉ thị, `stream` vắng / `false` → 0 `job.delta`; kết quả như H1."""
    job = await orch_job(ctx, "#fake:stream=5 #fake:answer-len=300 viết", stream)
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert row["status"] == "succeeded"
    assert deltas(evs) == []
    assert [e["type"] for e in evs][-1] == "job.result"
    assert decision_text(row)


# ---------- P22 · kind theo vai, scanner off ----------


@pytest.mark.parametrize(
    ("directive", "kind"),
    [("#fake:stream=5", "done"), ("#fake:partial #fake:stream=5", "partial")],
    ids=["done", "partial"],
)
async def test_wrk_fr_03_p22_agent_kind(ctx: Ctx, directive: str, kind: str) -> None:
    """P22 · R20 · agent `#fake:stream=5` → `job.delta{done}`; `#fake:partial` → `{partial}`; nối =
    `result.text`."""
    job = await agent_job(ctx, f"{directive} trả lời dài")
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert_stream_shape(evs, kind)
    assert row["status"] == "succeeded"
    res = result_of(row)["result"]
    assert res["status"] == kind
    assert joined(evs) == agent_text(row)


@pytest.mark.parametrize(
    ("role", "msg"),
    [
        ("agent", "#fake:need_input #fake:stream hỏi lại"),
        ("orchestrator", "#fake:delegate=assistant #fake:stream việc"),
        ("orchestrator", "#fake:stream=5 #fake:stream-order=text-first viết"),
    ],
    ids=["need_input", "delegate", "text-first"],
)
async def test_wrk_fr_03_p22_scanner_off_no_delta(ctx: Ctx, role: str, msg: str) -> None:
    """P22 · R20 · `need_input`, Orchestrator `delegate`, `text` trước khoá vai → 0 `job.delta`;
    `job.result` đúng (text-first: vẫn `answer` hợp lệ)."""
    job = await (orch_job(ctx, msg) if role == "orchestrator" else agent_job(ctx, msg))
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert row["status"] == "succeeded"
    assert deltas(evs) == []
    out = result_of(row)
    if role == "agent":
        assert out["result"]["status"] == "need_input"
    else:
        decision = json.loads(out["text"])
        want = "delegate" if "delegate" in msg else "answer"
        assert decision["decision"] == want


# ---------- P23 · gom theo ký tự / theo giờ ----------


async def test_wrk_fr_03_p23_flush_by_chars(ctx: Ctx) -> None:
    """P23 · R21 · AC-07 · `FLUSH_MS=1000`, `FLUSH_CHARS=200`, `#fake:stream=10`
    `#fake:answer-len=1000` → mọi `job.delta` trừ cuối ≥ 200 ký tự, ≤ 6 `job.delta`, nối = text."""
    job = await orch_job(ctx, "#fake:stream=10 #fake:answer-len=1000 viết")
    ctx.runtime(AGENT_RT_DELTA_FLUSH_MS="1000", AGENT_RT_DELTA_FLUSH_CHARS="200")
    row, evs = await finished(ctx, job)
    assert_stream_shape(evs, "answer")
    ds = deltas(evs)
    assert len(ds) <= 6
    assert all(len(str(d["text"])) >= 200 for d in ds[:-1])
    assert joined(evs) == decision_text(row)


async def test_wrk_fr_03_p23_flush_by_time(ctx: Ctx) -> None:
    """P23 · R21 · `FLUSH_CHARS=4000`, `FLUSH_MS=100`, 10 đoạn × 50 ms → 3–10 `job.delta`
    (theo giờ), nối = text."""
    job = await orch_job(ctx, "#fake:stream=10 #fake:answer-len=1000 viết")
    ctx.runtime(AGENT_RT_DELTA_FLUSH_MS="100", AGENT_RT_DELTA_FLUSH_CHARS="4000")
    row, evs = await finished(ctx, job)
    assert_stream_shape(evs, "answer")
    assert 3 <= len(deltas(evs)) <= 10
    assert joined(evs) == decision_text(row)


# ---------- P24 · cắt 4 000 đơn vị UTF-16 ----------


async def test_wrk_fr_03_p24_split_4000_units(ctx: Ctx) -> None:
    """P24 · R21 · `#fake:stream=1 #fake:answer-len=9000` → ≥ 3 `job.delta`, mỗi `text` ≤ 4 000 đơn
    vị UTF-16, nối = text."""
    job = await orch_job(ctx, "#fake:stream=1 #fake:answer-len=9000 viết")
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert_stream_shape(evs, "answer")
    assert len(deltas(evs)) >= 3
    assert joined(evs) == decision_text(row)


# ---------- P25 · không thử lại sau khi đã phát ----------


async def test_wrk_fr_03_p25_streamed_badjson_no_retry(ctx: Ctx) -> None:
    """P25 · R21 · H7 · agent `#fake:stream=5 #fake:stream-badjson` → đã phát `job.delta` rồi
    `job.failed{UPSTREAM_ERROR, invalid_output}`; không thử lại (không log `job.output_retry`)."""
    job = await agent_job(ctx, "#fake:stream=5 #fake:stream-badjson trả lời")
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert deltas(evs), f"không có job.delta: {[e['type'] for e in evs]}"
    assert (row["status"], row["error_code"], row["error_reason"]) == (
        "failed",
        "UPSTREAM_ERROR",
        "invalid_output",
    )
    term = [e for e in evs if e["type"] in ("job.result", "job.failed")]
    assert [(e["type"], e["code"], e["reason"]) for e in term] == [
        ("job.failed", "UPSTREAM_ERROR", "invalid_output")
    ]
    assert "job.output_retry" not in runtime_logs(ctx)


async def test_hub_h1_ac_10_p25_control_badjson_retry_without_stream(ctx: Ctx) -> None:
    """P25 đối chứng · H1 AC-10 · `#fake:badjson=1` không stream → thử lại → `succeeded`; log có
    `job.output_retry` (chứng minh cách đọc log của P25)."""
    job = await agent_job(ctx, "#fake:badjson=1 trả lời", stream=None)
    ctx.runtime()
    row, evs = await finished(ctx, job)
    assert row["status"] == "succeeded"
    assert deltas(evs) == []
    assert "job.output_retry" in runtime_logs(ctx)
    assert evs[-1]["type"] == "job.result"
