"""WRK-FR-10 · WRK-FR-14 · WRK-FR-15 · Provider `claude-sub` (plan-runtime §3): một lượt
`ClaudeSDKClient` (hook `PreToolUse` cần client — dự phòng §13) trong job host.

Thứ tự phát: `session` (init) → `tool_use`/`progress` → `rate_limit` (nếu có) → `session` (Result,
nếu khác) → `usage` → `final`. Lỗi SDK → `rate_limit?` + `fatal` (mapping.py).
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
    SystemMessage,
)

from agent_runtime.log import get_logger
from agent_runtime.providers.base import Emit, ProviderJob, RateLimit, Session
from agent_runtime.providers.claude.mapping import (
    error_events,
    final_event,
    init_model,
    init_session_id,
    mcp_statuses,
    rate_limit_event,
    result_signal,
    tool_events,
    usage_event,
)
from agent_runtime.providers.claude.options import build_options
from agent_runtime.providers.context import neutralize_mentions

KEY = "claude-sub"


@dataclass
class _Turn:
    job: ProviderJob
    emit: Emit
    session_id: str | None = None
    model: str | None = None
    rate_limited: set[str] = field(default_factory=set[str])
    final_sent: bool = False

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
        await self.emit(final_event(msg, self.job.payload.output))
        self.final_sent = True

    async def handle(self, msg: Message) -> None:
        if isinstance(msg, SystemMessage):
            self.model = init_model(msg) or self.model
            for status in mcp_statuses(msg):
                if status != "connected":  # §4.5: không fail job, tool không có
                    get_logger().warning("job.mcp_unavailable", status=status)
            await self.session(init_session_id(msg))
        elif isinstance(msg, AssistantMessage):
            for ev in tool_events(msg):
                await self.emit(ev)
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
