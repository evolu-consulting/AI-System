"""P-b · CR-060 · vòng soát sau-UAT (reviewer Minor #4) · WRK-FR-27 · PB-R11 · D8 · C18.

`source_reads` audit chỉ gồm file agent ĐỌC (Read/Grep/Glob). Ghi (`Write`/`Edit`) KHÔNG phải đọc
⇒ không mang đường dẫn vào audit. Hộp đen trên ánh xạ tin nhắn Claude Agent SDK → sự kiện provider
(`mapping.tool_events`): `ToolUse.path` là nguồn duy nhất của `read_paths` (→ `source_reads`).
Không DB/HTTP.
"""

from __future__ import annotations

from typing import Any

import pytest
from claude_agent_sdk import AssistantMessage, ToolUseBlock

from agent_runtime.providers.base import ToolUse
from agent_runtime.providers.claude.mapping import tool_events

WORK = "/work/jobs/33333333-3333-4333-8333-333333333333"


def _paths(name: str, inp: dict[str, Any]) -> list[str | None]:
    msg = AssistantMessage(content=[ToolUseBlock(id="tu-1", name=name, input=inp)], model="m")
    return [e.path for e in tool_events(msg, WORK) if isinstance(e, ToolUse)]


@pytest.mark.parametrize(
    "inp",
    [
        {"file_path": f"{WORK}/out/report.md", "content": "x"},
        {"file_path": f"{WORK}/sources/app/docs/rule.md", "content": "x"},
        {"file_path": "out/report.md", "content": "x"},
    ],
)
def test_pb_r11_write_not_counted_as_read(inp: dict[str, Any]) -> None:
    """PB-R11 · Minor #4 · `Write` (kể cả nhắm dưới `sources/`) ⇒ ToolUse.path = None (không vào
    read_paths)."""
    assert _paths("Write", inp) == [None]


@pytest.mark.parametrize(
    ("name", "inp", "want"),
    [
        ("Read", {"file_path": f"{WORK}/sources/app/docs/rule.md"}, "sources/app/docs/rule.md"),
        ("Grep", {"pattern": "x", "path": "sources/app/docs"}, "sources/app/docs"),
        ("Glob", {"pattern": "*.md", "path": "sources/app"}, "sources/app"),
    ],
)
def test_pb_r11_read_tools_keep_path(name: str, inp: dict[str, Any], want: str) -> None:
    """PB-R11 · D8 · Read/Grep/Glob vẫn mang đường dẫn tương đối `work/<job_id>` (đối chứng,
    không xanh giả)."""
    assert _paths(name, inp) == [want]


def test_pb_r11_edit_not_counted_as_read() -> None:
    """PB-R11 · `Edit` (ghi) không mang đường dẫn vào audit đọc."""
    assert _paths(
        "Edit", {"file_path": f"{WORK}/out/report.md", "old_string": "a", "new_string": "b"}
    ) == [None]
