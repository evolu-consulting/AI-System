"""WRK-FR-10 · WRK-FR-14 · WRK-FR-15 · Provider `claude-sub` (plan-runtime §3): một lượt
`ClaudeSDKClient` (hook `PreToolUse` cần client — dự phòng §13) trong job host.

Thứ tự phát: `session` (init) → `tool_use`/`progress`/`usage` cộng dồn/`delta` (H2b, `StreamEvent`
— `partial.py`) → `rate_limit` (nếu có) → `session` (Result, nếu khác) → `usage` → `final`.
`SystemMessage` khác `init` (`status`, `thinking_tokens` khi bật partial — PY-S2 #8) bỏ qua.
Lỗi SDK → `rate_limit?` + `fatal` (mapping.py).
Đã xác minh ở spike PY-02: init/Result, RateLimitEvent, chữ lỗi, resume. Prompt gửi CLI qua
`neutralize_mentions` (S1 — CLI không tự đọc `@đường/dẫn`); model của `usage` = model init (S9).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeSDKClient,
    ClaudeSDKError,
    Message,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    UserMessage,
)

from agent_runtime.log import get_logger
from agent_runtime.providers.base import Emit, ProviderJob, RateLimit, Session
from agent_runtime.providers.claude.mapping import (
    confirm_events,
    error_events,
    final_event,
    init_model,
    init_session_id,
    mcp_statuses,
    mcp_tool_ids,
    rate_limit_event,
    result_signal,
    tool_events,
    usage_event,
)
from agent_runtime.providers.claude.options import build_options
from agent_runtime.providers.claude.partial import PartialStream, stream_mode
from agent_runtime.providers.context import neutralize_mentions

KEY = "claude-sub"


@dataclass
class _Turn:
    job: ProviderJob
    emit: Emit
    session_id: str | None = None
    model: str | None = None
    rate_limited: set[str] = field(default_factory=set[str])
    mcp_ids: set[str] = field(default_factory=set[str])  # id `ToolUseBlock` `mcp__hub__*` (§5)
    final_sent: bool = False
    partial: PartialStream = field(init=False)  # H2b §3.4, §5: `StreamEvent` → `Delta`/F5
    stop_reason: str | None = None  # `AssistantMessage.stop_reason` cuối (TC-8 F4, dự phòng)

    def __post_init__(self) -> None:
        self.partial = PartialStream(stream_mode(self.job))

    async def session(self, sid: str | None) -> None:
        if sid and sid != self.session_id:
            self.session_id = sid
            await self.emit(Session(session_id=sid[:200]))

    async def rate_limit(self, ev: RateLimit | None) -> None:
        if ev is not None and ev.status not in self.rate_limited:
            self.rate_limited.add(ev.status)
            await self.emit(ev)

    async def result(self, msg: ResultMessage) -> None:
        await self.rate_limit(result_signal(msg))
        await self.session(msg.session_id)
        usage = usage_event(msg, self.model)
        if usage is not None:
            await self.emit(usage)
        stop = self.partial.stop_reason or self.stop_reason
        await self.emit(final_event(msg, self.job.payload.output, stop))
        self.final_sent = True

    async def system(self, msg: SystemMessage) -> None:
        self.model = init_model(msg) or self.model
        for status in mcp_statuses(msg):
            if status != "connected":  # §4.5: không fail job, tool không có
                get_logger().warning("job.mcp_unavailable", status=status)
        await self.session(init_session_id(msg))

    async def stream(self, msg: StreamEvent) -> None:
        if msg.parent_tool_use_id is None:  # spike #7: bỏ sự kiện của subagent
            for ev in self.partial.handle(msg.event, self.model):
                await self.emit(ev)

    async def assistant(self, msg: AssistantMessage) -> None:
        self.mcp_ids.update(mcp_tool_ids(msg))
        if msg.parent_tool_use_id is None:  # REVIEW 2 RV2-2: bỏ stop_reason của subagent
            self.stop_reason = msg.stop_reason or self.stop_reason
        for ev in tool_events(msg):
            await self.emit(ev)

    async def handle(self, msg: Message) -> None:
        if isinstance(msg, StreamEvent):
            await self.stream(msg)
        elif isinstance(msg, SystemMessage):
            await self.system(msg)
        elif isinstance(msg, AssistantMessage):
            await self.assistant(msg)
        elif isinstance(msg, UserMessage):
            for confirm in confirm_events(msg, self.mcp_ids):
                await self.emit(confirm)
        elif isinstance(msg, RateLimitEvent):
            ev = rate_limit_event(msg)
            if ev is None:
                get_logger().info("claude.rate_limit", status=msg.rate_limit_info.status)
            await self.rate_limit(ev)
        elif isinstance(msg, ResultMessage):
            await self.result(msg)


class ClaudeProvider:
    key = KEY

    async def run(self, job: ProviderJob, emit: Emit) -> None:
        turn = _Turn(job, emit)
        try:
            # `ClaudeSDKClient` tra theo tên module lúc gọi ⇒ test monkeypatch được (SDK giả).
            async with ClaudeSDKClient(options=build_options(job)) as client:
                await client.query(neutralize_mentions(job.retry_prompt or job.payload.prompt))
                async for msg in client.receive_response():
                    await turn.handle(msg)
        except ClaudeSDKError as err:
            get_logger().warning("claude.sdk_error", error=type(err).__name__)
            if turn.final_sent:
                return  # CLI thoát khác 0 sau khi đã có ResultMessage (ResultError) — đã báo.
            for ev in error_events(err):
                if isinstance(ev, RateLimit):
                    await turn.rate_limit(ev)
                else:
                    await emit(ev)
