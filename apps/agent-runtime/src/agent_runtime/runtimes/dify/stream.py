"""WRK-FR-06 · H2a-R11 · R12 · R15 — gộp sự kiện SSE Dify thành trạng thái lần gọi (thuần).

`reduce(state, event, data)`: `data` = object JSON nguyên dòng `data:` (`event`, `task_id`,
`data{…}`, `answer`, `metadata{usage}`) — `plan-runtime-dify` §3.2, §3.5. `first_seen` đặt cho mọi
sự kiện ≠ `ping` (§3.4: sau sự kiện đầu không thử lại). Tiến độ chỉ mang số bước, không tên node.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Literal, cast

AppType = Literal["workflow", "chat", "agent"]
_PROGRESS_EVENTS = frozenset({"node_started", "agent_thought"})
_TEXT_EVENTS = frozenset({"message", "agent_message"})
# `job.result.output.text` tối đa 64 000 ký tự (contract). Review 1 C5: ngừng nối khi đã đủ — bộ nhớ
# không tăng theo stream dài; phần bị bỏ chỉ đếm (`dropped`) để log độ dài gốc.
OUTPUT_MAX = 64_000


@dataclass(frozen=True)
class StreamState:
    app_type: AppType
    text: str = ""
    task_id: str | None = None
    first_seen: bool = False
    nodes: int = 0
    outputs: Mapping[str, Any] | None = None
    usage: Mapping[str, Any] | None = None
    dropped: int = 0  # số ký tự text bị bỏ vì vượt `OUTPUT_MAX`


@dataclass(frozen=True)
class Progress:
    n: int  # "Đang chạy bước {n}"


@dataclass(frozen=True)
class Finished:
    pass


@dataclass(frozen=True)
class Failed:
    kind: Literal["sse_error", "finished_failed"]


Step = Progress | Finished | Failed | None


def _obj(value: object) -> Mapping[str, Any] | None:
    return cast(Mapping[str, Any], value) if isinstance(value, Mapping) else None


def _str(value: object) -> str:
    return value if isinstance(value, str) else ""


def _append(state: StreamState, chunk: str) -> StreamState:
    """Nối `chunk` vào `text`, giữ `len(text) ≤ OUTPUT_MAX` (64k đầu — như cắt cuối ở host)."""
    room = OUTPUT_MAX - len(state.text)
    if len(chunk) <= room:
        return replace(state, text=state.text + chunk) if chunk else state
    keep = max(room, 0)
    return replace(state, text=state.text + chunk[:keep], dropped=state.dropped + len(chunk) - keep)


def _finished(state: StreamState, body: Mapping[str, Any]) -> tuple[StreamState, Step]:
    """`workflow_finished.data{status, outputs, total_tokens…}` → giữ `outputs`, `usage` = data."""
    s = replace(state, outputs=_obj(body.get("outputs")), usage=body)
    return (s, Finished()) if body.get("status") == "succeeded" else (s, Failed("finished_failed"))


def reduce(state: StreamState, event: str, data: Mapping[str, Any]) -> tuple[StreamState, Step]:
    """Một sự kiện SSE → (trạng thái mới, bước). `ping` → không đổi."""
    if event == "ping":
        return state, None
    s = replace(state, first_seen=True)
    task_id = data.get("task_id")
    if s.task_id is None and isinstance(task_id, str) and task_id:
        s = replace(s, task_id=task_id)
    body = _obj(data.get("data")) or {}
    if event in _PROGRESS_EVENTS:
        s = replace(s, nodes=s.nodes + 1)
        return s, Progress(n=s.nodes)
    if event == "text_chunk":
        return _append(s, _str(body.get("text"))), None
    if event in _TEXT_EVENTS:
        return _append(s, _str(data.get("answer"))), None
    if event == "workflow_finished":
        return _finished(s, body)
    if event == "message_end":
        metadata = _obj(data.get("metadata")) or {}
        return replace(s, usage=_obj(metadata.get("usage"))), Finished()
    if event == "error":
        return s, Failed("sse_error")
    return s, None


def final_text(acc: str, outputs: Mapping[str, Any] | None, field: str | None) -> str | None:
    """Bản Python của `finalText` TS: text đã nối; rỗng → `outputs[field or "text"]` (chuỗi;
    object/số → JSON một dòng; `null`/`""`/thiếu → None). Cắt độ dài do host."""
    if acc:
        return acc
    value = (outputs or {}).get(field or "text")
    if value is None:
        return None
    text = (
        value
        if isinstance(value, str)
        else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    )
    return text or None
