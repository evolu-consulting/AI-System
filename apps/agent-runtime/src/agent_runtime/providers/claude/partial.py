"""WRK-FR-03 · WRK-FR-17 · R19–R21, R28 · `StreamEvent` (`include_partial_messages`) của
`claude-sub` → `Delta` + `UsageEv` cộng dồn (plan-runtime H2b §3.4, §5; spike PY-S2 S1–S4).

Nhận `StreamEvent.event` thô (dict API Anthropic) — không import SDK, test bằng dict.
- Chọn khối theo `content_block_start` (S3): `text` (Orchestrator) / `tool_use` tên
  `StructuredOutput` (agent); khối khác (`thinking`, `tool_use` `Read`/MCP) bỏ qua theo index.
- Mốc khối xong = `content_block_stop` (S4): khối chưa phát ⇒ tháo scanner (khối sau dùng scanner
  mới); đã phát ở một khối ⇒ khối khác bỏ qua (Hub đối chiếu chữ cuối).
- F5 (S1): `message_start.message.usage` (id = `message.id`) rồi `message_delta.usage` (cùng id,
  bản sau thay) qua `UsageAcc`; `AssistantMessage.usage` không dùng (ảnh chụp lúc start).
  `message_start` thiếu id ⇒ id tạm riêng cho message đó (`message_delta` sau thay, không cộng đôi).
- TC-8 F4: `message_delta.delta.stop_reason` cuối (vd `"refusal"`) → `stop_reason` (cho `Final`).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, cast

from agent_runtime.providers.base import Delta, ProviderEvent, ProviderJob
from agent_runtime.providers.claude.usage_acc import UsageAcc
from agent_runtime.providers.stream_scan import Mode, StreamScanner

STRUCTURED_TOOL = "StructuredOutput"  # CLI thêm khi có `output_format` (spike PY-02 S2)
_ANON_ID = "anon:"  # tiền tố id tạm (id API dạng `msg_…` ⇒ không trùng)


def stream_mode(job: ProviderJob) -> Mode | None:
    """Mode scanner khi job được stream (`payload.stream is True` ∧ không phải lần thử lại định
    dạng — R21); None = chỉ dùng `StreamEvent` cho F5."""
    if job.payload.stream is not True or job.retry_prompt is not None:
        return None
    return "orchestrator" if job.payload.output == "text" else "agent"


def _dict(value: object) -> Mapping[str, Any]:
    return cast(Mapping[str, Any], value) if isinstance(value, dict) else {}


def _wanted(mode: Mode, block: Mapping[str, Any]) -> bool:
    if mode == "orchestrator":
        return block.get("type") == "text"
    return block.get("type") == "tool_use" and block.get("name") == STRUCTURED_TOOL


def _piece(delta: Mapping[str, Any]) -> str | None:
    kind = delta.get("type")
    value = (
        delta.get("text")
        if kind == "text_delta"
        else delta.get("partial_json")
        if kind == "input_json_delta"
        else None
    )
    return value if isinstance(value, str) and value else None


@dataclass
class PartialStream:
    mode: Mode | None
    usage: UsageAcc = field(default_factory=UsageAcc)
    message_id: str | None = None
    block: int | None = None  # index khối đang gắn scanner (trong message hiện tại)
    scanner: StreamScanner | None = None
    emitted: bool = False
    anon: int = 0  # số message thiếu id đã gặp (id tạm)
    stop_reason: str | None = None  # `message_delta.delta.stop_reason` cuối (TC-8 F4)

    def handle(self, event: Mapping[str, Any], model: str | None) -> list[ProviderEvent]:
        kind = event.get("type")
        if kind == "message_start":
            msg = _dict(event.get("message"))
            self.message_id = self._message_id(msg.get("id"))
            self.block, self.scanner = None, None
            return self._usage(msg.get("usage"), model)
        if kind == "message_delta":
            stop = _dict(event.get("delta")).get("stop_reason")
            self.stop_reason = stop if isinstance(stop, str) and stop else self.stop_reason
            return self._usage(event.get("usage"), model)
        if self.mode is None:
            return []
        index = event.get("index")
        if kind == "content_block_start":
            self._start(index, _dict(event.get("content_block")))
        elif kind == "content_block_delta" and index == self.block:
            return self._feed(_piece(_dict(event.get("delta"))))
        elif kind == "content_block_stop" and index == self.block:
            self.block, self.scanner = None, None
        return []

    def _message_id(self, mid: object) -> str:
        """Review 1 #4: thiếu id ⇒ id tạm mới — `message_delta` sau (không mang id) thay bản
        `message_start` của cùng message thay vì cộng đôi."""
        if isinstance(mid, str) and mid:
            return mid
        self.anon += 1
        return f"{_ANON_ID}{self.anon}"

    def _usage(self, usage: object, model: str | None) -> list[ProviderEvent]:
        if not isinstance(usage, dict):
            return []
        ev = self.usage.add(self.message_id, cast(Mapping[str, Any], usage), model)
        return [] if ev is None else [ev]

    def _start(self, index: object, block: Mapping[str, Any]) -> None:
        mode = self.mode
        if mode is None or self.emitted or self.block is not None or not isinstance(index, int):
            return
        if _wanted(mode, block):
            self.block, self.scanner = index, StreamScanner(mode)

    def _feed(self, piece: str | None) -> list[ProviderEvent]:
        scanner = self.scanner
        if scanner is None or piece is None:
            return []
        out: list[ProviderEvent] = []
        for text in scanner.feed(piece):
            if scanner.kind is not None:
                out.append(Delta(kind=scanner.kind, text=text))
        self.emitted = self.emitted or bool(out)
        return out
