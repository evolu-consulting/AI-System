"""HUB-FR-95 · H2a-R21 · AC-H22 · `mapping`: `ToolResultBlock(is_error)` của tool `mcp__hub__*`
có `CONFIRMATION_REQUIRED` (R6, spike S2: content `str` khi lỗi) → `Confirm` (`plan-runtime` §5
#2). SDK giả, không CLI thật."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from agent_runtime.providers.claude.mapping import confirm_events, mcp_tool_ids
from agent_runtime.providers.claude.test_mcp import mcp_job
from agent_runtime.providers.claude.test_provider import result, run

TOOL = "mcp__hub__create-trello-card"
ERR = {"code": "CONFIRMATION_REQUIRED", "question": "Tạo thẻ?", "choices": ["Đồng ý", "Huỷ"]}
HINT = "CONFIRMATION_REQUIRED: Công cụ này cần người dùng xác nhận trước. Dừng lại…"
AS_STR = json.dumps(ERR, ensure_ascii=False) + "\n" + HINT  # spike S2: khối nối bằng "\n"
AS_LIST: list[dict[str, Any]] = [
    {"type": "text", "text": json.dumps(ERR)},
    {"type": "text", "text": HINT},
]


def _use(tid: str, name: str = TOOL) -> AssistantMessage:
    return AssistantMessage(
        content=[ToolUseBlock(id=tid, name=name, input={"title": "A"})], model="m"
    )


def _res(tid: str, content: Any, *, is_error: bool | None = True) -> UserMessage:
    return UserMessage(
        content=[ToolResultBlock(tool_use_id=tid, content=content, is_error=is_error)]
    )


@pytest.mark.parametrize("content", [AS_STR, AS_LIST])
def test_hub_fr_95_mapping_confirm_from_mcp_error(content: Any) -> None:
    ids = set(mcp_tool_ids(_use("t1")))
    assert ids == {"t1"}
    [got] = confirm_events(_res("t1", content), ids)
    assert (got.question, got.choices) == ("Tạo thẻ?", ("Đồng ý", "Huỷ"))


@pytest.mark.parametrize(
    ("msg", "ids"),
    [
        (_res("t9", AS_STR), {"t1"}),  # id không thuộc `mcp__hub__*`
        (_res("t1", AS_STR, is_error=False), {"t1"}),  # không lỗi
        (_res("t1", AS_STR, is_error=None), {"t1"}),
        (_res("t1", None), {"t1"}),
        (_res("t1", '{"code":"OTHER"}'), {"t1"}),
        (_res("t1", [{"type": "text", "text": HINT}, AS_LIST[0]]), {"t1"}),  # JSON không ở đầu
        (UserMessage(content="văn bản"), {"t1"}),
        (UserMessage(content=[TextBlock("x")]), {"t1"}),
    ],
)
def test_hub_fr_95_mapping_ignores_other_results(msg: UserMessage, ids: set[str]) -> None:
    assert list(confirm_events(msg, ids)) == []


def test_hub_fr_95_only_hub_tools_tracked() -> None:
    assert list(mcp_tool_ids(_use("r1", "Read"))) == []
    assert list(mcp_tool_ids(_use("o1", "mcp__other__x"))) == []


async def test_hub_fr_95_provider_emits_confirm(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Luồng `claude-sub`: tool MCP → kết quả `CONFIRMATION_REQUIRED` → `confirm` trước `final`
    (cha ép `need_input` dù model trả gì); tool khác cùng nội dung không sinh `confirm`."""
    done = result(structured_output={"status": "done", "text": "đã tạo"})
    script = [_use("t1"), _res("t1", AS_STR), _use("r1", "Read"), _res("r1", AS_STR), done]
    evs = await run(monkeypatch, mcp_job(tmp_path), script)
    confirms = [e for e in evs if e["type"] == "confirm"]
    assert confirms == [{"type": "confirm", "question": "Tạo thẻ?", "choices": ["Đồng ý", "Huỷ"]}]
    assert [e["type"] for e in evs].index("confirm") < [e["type"] for e in evs].index("final")
