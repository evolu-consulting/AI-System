"""WRK-FR-03 · WRK-FR-17 · H2b PY-02 · `claude-sub` với `StreamEvent` giả theo thứ tự spike PY-S2
§3 (`spike-stream.md`): `Delta` chỉ khi `payload.stream` ∧ không thử lại, chọn khối theo
`content_block_start`, usage cộng dồn từ `message_start`/`message_delta` (không `AssistantMessage`).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    Message,
    ProcessError,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
)

from agent_runtime.providers.base import UsageEv
from agent_runtime.providers.claude.options import build_options
from agent_runtime.providers.claude.partial import PartialStream
from agent_runtime.providers.claude.test_provider import job_of, result, run, types

MODEL = "claude-opus-5-5"
ORCH_JSON = '{"decision":"answer","text":"Xin chào \\"bạn\\" 😀"}'
AGENT_JSON = '{"status":"done","text":"Xong việc\\nhết"}'
SNAP = {"input_tokens": 9, "output_tokens": 9999}  # `AssistantMessage.usage` — phải bị bỏ qua


def se(event: dict[str, Any], parent: str | None = None) -> StreamEvent:
    return StreamEvent(uuid="u", session_id="sess-1", event=event, parent_tool_use_id=parent)


def msg_start(mid: str, out: int, cache_w: int = 0, cache_r: int = 0) -> StreamEvent:
    usage = {
        "input_tokens": 2,
        "output_tokens": out,
        "cache_read_input_tokens": cache_r,
        "cache_creation_input_tokens": cache_w,
    }
    return se({"type": "message_start", "message": {"id": mid, "usage": usage}})


def msg_delta(out: int, cache_w: int = 0, cache_r: int = 0) -> StreamEvent:
    usage: dict[str, Any] = {
        "input_tokens": 2,
        "output_tokens": out,
        "cache_read_input_tokens": cache_r,
        "cache_creation_input_tokens": cache_w,
        "output_tokens_details": {"thinking_tokens": 0},
        "iterations": [],
    }
    return se({"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": usage})


def block_start(index: int, kind: str, name: str | None = None) -> StreamEvent:
    block: dict[str, Any] = {"type": kind}
    if name is not None:
        block |= {"name": name, "id": f"tu{index}", "input": {}}
    return se({"type": "content_block_start", "index": index, "content_block": block})


def block_delta(index: int, kind: str, piece: str) -> StreamEvent:
    key = {"text_delta": "text", "input_json_delta": "partial_json", "thinking_delta": "thinking"}
    delta = {"type": kind, key[kind]: piece}
    return se({"type": "content_block_delta", "index": index, "delta": delta})


def block_stop(index: int) -> StreamEvent:
    return se({"type": "content_block_stop", "index": index})


def pieces(doc: str, n: int = 7) -> list[str]:
    return [doc[i : i + n] for i in range(0, len(doc), n)]


def init_model() -> SystemMessage:
    return SystemMessage(subtype="init", data={"session_id": "sess-1", "model": MODEL})


def orch_script() -> list[Message]:
    """Spike §3 `orch`: start → block text → delta… → AssistantMessage → stop → message_delta."""
    return [
        init_model(),
        msg_start("msg_1", 8, cache_w=1049),
        block_start(0, "text"),
        *(block_delta(0, "text_delta", p) for p in pieces(ORCH_JSON)),
        AssistantMessage([TextBlock(ORCH_JSON)], MODEL, usage=SNAP, message_id="msg_1"),
        block_stop(0),
        msg_delta(702, cache_w=1049),
        result(structured_output=None, result=ORCH_JSON),
    ]


def agent_script() -> list[Message]:
    """Lượt 1: thinking + `tool_use Read` (`input_json_delta` riêng); lượt 2: `StructuredOutput`."""
    read_json = '{"file_path":"/secret/a.txt","text":"không phát"}'
    return [
        init_model(),
        msg_start("msg_1", 8, cache_w=2194),
        block_start(0, "thinking"),
        block_delta(0, "thinking_delta", ""),
        block_stop(0),
        block_start(1, "tool_use", "Read"),
        *(block_delta(1, "input_json_delta", p) for p in pieces(read_json)),
        AssistantMessage([ToolUseBlock("t1", "Read", {})], MODEL, usage=SNAP, message_id="msg_1"),
        block_stop(1),
        msg_delta(65, cache_w=2194),
        msg_start("msg_2", 24, cache_w=135, cache_r=2194),
        block_start(0, "text"),
        block_delta(0, "text_delta", '{"status":"done","text":"chữ thường không phát"}'),
        block_stop(0),
        block_start(1, "tool_use", "StructuredOutput"),
        *(block_delta(1, "input_json_delta", p) for p in pieces(AGENT_JSON, 5)),
        block_stop(1),
        msg_delta(300, cache_w=135, cache_r=2194),
        result(),
    ]


def deltas(evs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in evs if e["type"] == "delta"]


def usages(evs: list[dict[str, Any]]) -> list[tuple[int, int, int, int]]:
    return [
        (e["in"], e["out"], e["cache_read"], e["cache_write"]) for e in evs if e["type"] == "usage"
    ]


async def test_wrk_fr_03_orchestrator_stream(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    job = job_of(tmp_path, "text", use_session=False, allowed_tools=[], stream=True)
    evs = await run(monkeypatch, job, orch_script())
    ds = deltas(evs)
    assert ds and {d["kind"] for d in ds} == {"answer"}
    assert "".join(d["text"] for d in ds) == 'Xin chào "bạn" 😀'
    assert evs.index(ds[-1]) < types(evs).index("final")
    # F5: start (out 8) → delta cùng id thay (702, không 710); `AssistantMessage.usage` bỏ qua.
    assert usages(evs)[:2] == [(2, 8, 0, 1049), (2, 702, 0, 1049)]
    assert all(e["model"] == MODEL for e in evs if e["type"] == "usage")


async def test_wrk_fr_03_agent_structured_output_only(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    evs = await run(monkeypatch, job_of(tmp_path, stream=True), agent_script())
    ds = deltas(evs)
    assert {d["kind"] for d in ds} == {"done"}
    assert "".join(d["text"] for d in ds) == "Xong việc\nhết"  # không chữ của Read/text/thinking
    assert "/secret" not in json.dumps(evs)
    stream_usage = usages(evs)[:4]
    assert stream_usage == [
        (2, 8, 0, 2194),
        (2, 65, 0, 2194),
        (4, 89, 2194, 2329),
        (4, 365, 2194, 2329),
    ]


@pytest.mark.parametrize("over", [{}, {"stream": False}], ids=["absent", "false"])
async def test_wrk_fr_03_no_stream_flag_usage_only(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, over: dict[str, Any]
) -> None:
    evs = await run(monkeypatch, job_of(tmp_path, **over), agent_script())
    assert deltas(evs) == []
    assert usages(evs)[3] == (4, 365, 2194, 2329)


async def test_wrk_fr_03_format_retry_does_not_stream(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    job = job_of(tmp_path, stream=True).model_copy(update={"retry_prompt": "sửa JSON"})
    evs = await run(monkeypatch, job, agent_script())
    assert deltas(evs) == []


async def test_wrk_fr_03_subagent_and_status_ignored(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Spike #7/#8: `parent_tool_use_id` ≠ None bỏ; `SystemMessage` `status`/`thinking_tokens`
    không phát gì."""
    job = job_of(tmp_path, "text", use_session=False, allowed_tools=[], stream=True)
    script: list[Message] = [
        SystemMessage(subtype="status", data={"status": "requesting"}),
        SystemMessage(subtype="thinking_tokens", data={"estimated_tokens": 5}),
        se({"type": "message_start", "message": {"id": "s", "usage": {"output_tokens": 5}}}, "t"),
        se({"type": "content_block_start", "index": 0, "content_block": {"type": "text"}}, "t"),
        se(
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": ORCH_JSON},
            },
            "t",
        ),  # fmt: skip
    ]
    assert await run(monkeypatch, job, script) == []


async def test_wrk_fr_17_cancel_mid_message_lower_bound(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Spike #9: kill sau `AssistantMessage` lượt 2 (trước `message_delta`) ⇒ usage cộng dồn =
    lượt 1 cuối + lượt 2 ảnh chụp (cận dưới), rồi `fatal`."""
    full = agent_script()
    cut = next(
        i
        for i, m in enumerate(full)
        if isinstance(m, StreamEvent) and m.event.get("message", {}).get("id") == "msg_2"
    )
    script = full[: cut + 1]  # tới `msg_start("msg_2")`
    evs = await run(monkeypatch, job_of(tmp_path), script, ProcessError("x", -9, ""))
    assert usages(evs)[-1] == (4, 89, 2194, 2329)
    assert types(evs)[-1] == "fatal"


async def test_wrk_fr_03_orchestrator_ask_then_other_text_block(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Khối text đầu `off` (ask) ⇒ tháo ở `content_block_stop`; khối sau dùng scanner mới."""
    job = job_of(tmp_path, "text", use_session=False, allowed_tools=[], stream=True)
    script: list[Message] = [
        msg_start("m", 1),
        block_start(0, "text"),
        block_delta(0, "text_delta", '{"decision":"ask","text":"Hỏi?"}'),
        block_stop(0),
        block_start(1, "text"),
        block_delta(1, "text_delta", ORCH_JSON),
        block_stop(1),
        block_start(2, "text"),
        block_delta(2, "text_delta", '{"decision":"answer","text":"lần hai"}'),
        block_stop(2),
    ]
    evs = await run(monkeypatch, job, script)
    assert [d["text"] for d in deltas(evs)] == ['Xin chào "bạn" 😀']


def test_wrk_fr_03_partial_ignores_unknown_and_bad_shapes() -> None:
    ps = PartialStream("agent")
    junk: Sequence[dict[str, Any]] = [
        {"type": "ping"},
        {"type": "message_start", "message": "x"},
        {"type": "message_delta", "usage": None},
        {"type": "content_block_start", "index": "0", "content_block": {"type": "tool_use"}},
        {"type": "content_block_delta", "index": None, "delta": {"type": "text_delta"}},
    ]
    assert [ev for e in junk for ev in ps.handle(e, None)] == []


def test_wrk_fr_10_partial_messages_on_for_every_job(tmp_path: Path) -> None:
    """S2: `include_partial_messages=True` cho mọi job `claude-sub` (cả không stream, thử lại)."""
    agent = job_of(tmp_path / "a")
    orch = job_of(tmp_path / "o", "text", use_session=False, allowed_tools=[], stream=True)
    retry = agent.model_copy(update={"retry_prompt": "sửa"})
    assert all(build_options(j).include_partial_messages for j in (agent, orch, retry))


async def test_wrk_fr_17_result_without_usage_keeps_stream_total(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Review 1 F5: Result không mang `usage` (model vẫn có) ⇒ không phát `UsageEv{0,…}` đè phần
    đã tích từ `message_start`/`message_delta` — usage cuối = tổng cộng dồn."""
    script: list[Message] = [msg_start("m1", 8, 1049), msg_delta(702, 1049), result(usage=None)]
    evs = await run(monkeypatch, job_of(tmp_path), script)
    assert usages(evs) == [(2, 8, 0, 1049), (2, 702, 0, 1049)]
    assert types(evs)[-1] == "final"


def test_wrk_fr_17_message_without_id_not_doubled() -> None:
    """Review 1 #4: `message_start` thiếu id ⇒ `message_delta` sau thay bản start (không cộng
    đôi); message thiếu id kế tiếp là message mới (cộng)."""
    ps = PartialStream(None)
    start = {"type": "message_start", "message": {"usage": {"input_tokens": 2, "output_tokens": 8}}}
    delta = {"type": "message_delta", "usage": {"input_tokens": 2, "output_tokens": 702}}
    got = [ev for e in (start, delta, start, delta) for ev in ps.handle(e, MODEL)]
    assert [(u.input, u.output) for u in got if isinstance(u, UsageEv)] == [
        (2, 8),
        (2, 702),
        (4, 710),
        (4, 1404),
    ]


def test_wrk_fr_17_delta_missing_keys_keep_start_values() -> None:
    """Review 1 #5: `message_delta` chỉ mang `output_tokens` ⇒ input/cache của `message_start`
    cùng id giữ nguyên (tổng không giảm)."""
    ps = PartialStream(None)
    ps.handle(msg_start("m1", 8, 1049, 30).event, MODEL)
    got = ps.handle({"type": "message_delta", "usage": {"output_tokens": 702}}, MODEL)
    tot = [(u.input, u.output, u.cache_read, u.cache_write) for u in got if isinstance(u, UsageEv)]
    assert tot == [(2, 702, 30, 1049)]


def refusal_delta() -> StreamEvent:
    usage = {"output_tokens": 0}
    return se({"type": "message_delta", "delta": {"stop_reason": "refusal"}, "usage": usage})


async def test_wrk_fr_15_tc8_stop_reason_to_final(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """TC-8 F4: `Final.stop_reason` = của Result; Result không có ⇒ `message_delta.delta
    .stop_reason` cuối ⇒ `AssistantMessage.stop_reason`; không đâu có ⇒ None."""
    err = {"is_error": True, "result": "x", "usage": None}
    script: list[Message] = [msg_start("m1", 0), refusal_delta(), result(**err)]
    evs = await run(monkeypatch, job_of(tmp_path / "a"), script)
    assert evs[-1]["type"] == "final" and evs[-1]["stop_reason"] == "refusal"
    script = [msg_start("m1", 0), refusal_delta(), result(stop_reason="end_turn", **err)]
    evs = await run(monkeypatch, job_of(tmp_path / "b"), script)
    assert evs[-1]["stop_reason"] == "end_turn"
    am = AssistantMessage([TextBlock("x")], MODEL, stop_reason="refusal")
    evs = await run(monkeypatch, job_of(tmp_path / "c"), [am, result(**err)])
    assert evs[-1]["stop_reason"] == "refusal"
    evs = await run(monkeypatch, job_of(tmp_path / "d"), [msg_start("m1", 0), result(**err)])
    assert evs[-1]["stop_reason"] is None
    ps = PartialStream(None)
    ps.handle(refusal_delta().event, MODEL)
    ps.handle({"type": "message_delta", "delta": {"stop_reason": None}}, MODEL)
    assert ps.stop_reason == "refusal"


async def test_wrk_fr_15_rv2_stop_reason_subagent_and_reset(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """REVIEW 2 RV2-2: `AssistantMessage` của subagent (`parent_tool_use_id`) không làm
    fallback; `message_start` đặt lại `stop_reason` của message trước."""
    err = {"is_error": True, "result": "x", "usage": None}
    sub = AssistantMessage([TextBlock("x")], MODEL, parent_tool_use_id="t1", stop_reason="refusal")
    evs = await run(monkeypatch, job_of(tmp_path / "a"), [sub, result(**err)])
    assert evs[-1]["stop_reason"] is None
    script: list[Message] = [msg_start("m1", 0), refusal_delta(), msg_start("m2", 0), result(**err)]
    evs = await run(monkeypatch, job_of(tmp_path / "b"), script)
    assert evs[-1]["stop_reason"] is None
    ps = PartialStream(None)
    ps.handle(refusal_delta().event, MODEL)
    ps.handle(msg_start("m3", 0).event, MODEL)
    assert ps.stop_reason is None
