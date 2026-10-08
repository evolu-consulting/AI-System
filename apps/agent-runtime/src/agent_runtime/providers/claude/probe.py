"""WRK-FR-22 · H3a-R14(b) · Lượt probe `claude-sub` (plan-runtime H3a §4.2, spec-decisions Spike
S1 #8): một lượt `ClaudeSDKClient` haiku, `max_turns=1`, không tool/MCP/setting/hook/session.

Chạy trong con probe (`runtimes/cli/probe/child.py`). Phát như job: `RateLimitEvent` → `rate_limit`
(mỗi status một lần), `ResultMessage` → `result_signal` + `usage` + `final` **không nội dung**
(`text=None` — câu trả lời probe không rời con). Lỗi SDK → `error_events` (H1).
"""

from __future__ import annotations

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ClaudeSDKError,
    Message,
    RateLimitEvent,
    ResultMessage,
)

from agent_runtime.log import get_logger
from agent_runtime.providers.base import Emit, ProbeRequest, ProviderEvent, RateLimit
from agent_runtime.providers.claude.mapping import (
    error_events,
    final_event,
    models_event,
    rate_limit_event,
    result_signal,
    usage_event,
)

PROBE_MODEL = "haiku"
PROBE_SYSTEM = "Reply ok."
PROBE_PROMPT = "Reply with: ok"


def probe_options(req: ProbeRequest) -> ClaudeAgentOptions:
    """`rt §4.2`; `strict_mcp_config` thêm (PY-03b): chỉ MCP của `mcp_servers` (= không có)."""
    return ClaudeAgentOptions(
        model=PROBE_MODEL,
        system_prompt=PROBE_SYSTEM,
        tools=[],
        allowed_tools=[],
        mcp_servers={},
        strict_mcp_config=True,
        setting_sources=[],
        max_turns=1,
        cwd=req.work_dir,
        cli_path=req.cli_path,
    )


class _Probe:
    def __init__(self, emit: Emit) -> None:
        self.emit = emit
        self.statuses: set[str] = set()
        self.final_sent = False

    async def rate_limit(self, ev: RateLimit | None) -> None:
        if ev is not None and ev.status not in self.statuses:
            self.statuses.add(ev.status)
            await self.emit(ev)

    async def handle(self, msg: Message) -> None:
        if isinstance(msg, RateLimitEvent):
            await self.rate_limit(rate_limit_event(msg))
        elif isinstance(msg, ResultMessage):
            await self.rate_limit(result_signal(msg))
            usage = usage_event(msg)
            if usage is not None:
                await self.emit(usage)
            final = final_event(msg, "text").model_copy(update={"text": None})
            await self.emit(final)
            self.final_sent = True

    async def error(self, err: ClaudeSDKError) -> None:
        get_logger().warning("claude.sdk_error", error=type(err).__name__, source="probe")
        if self.final_sent:
            return
        events: list[ProviderEvent] = error_events(err)
        for ev in events:
            await (self.rate_limit(ev) if isinstance(ev, RateLimit) else self.emit(ev))


async def claude_probe(req: ProbeRequest, emit: Emit) -> None:
    probe = _Probe(emit)
    try:
        # `ClaudeSDKClient` tra theo tên module lúc gọi ⇒ test monkeypatch được (SDK giả).
        async with ClaudeSDKClient(options=probe_options(req)) as client:
            # CR-054 · danh mục model thật của CLI (lúc initialize, không tốn token) → cha ghi DB.
            models = models_event(await client.get_server_info())
            if models is not None:
                await emit(models)
            await client.query(PROBE_PROMPT)
            async for msg in client.receive_response():
                await probe.handle(msg)
    except ClaudeSDKError as err:
        await probe.error(err)
