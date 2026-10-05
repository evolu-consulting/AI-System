"""WRK-FR-22 · H3a-R14(b) · `claude_probe` với **SDK giả** (monkeypatch `ClaudeSDKClient`, không
gọi CLI thật): options đúng `rt §4.2` (haiku, `max_turns=1`, không tool/MCP/setting/hook/session),
sự kiện như job, **không** phát nội dung trả lời.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any, Self

import pytest
from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKError,
    CLINotFoundError,
    Message,
    RateLimitEvent,
    RateLimitInfo,
    ResultMessage,
)

from agent_runtime.providers.base import ProbeRequest, ProviderEvent
from agent_runtime.providers.claude import probe as mod
from agent_runtime.providers.claude.probe import PROBE_PROMPT, PROBE_SYSTEM, probe_options
from agent_runtime.providers.registry import get_provider

ANSWER = "ok — câu trả lời bí mật của probe"


class FakeClient:
    script: Sequence[Message] = ()
    error: ClaudeSDKError | None = None
    last: FakeClient | None = None

    def __init__(self, options: ClaudeAgentOptions | None = None) -> None:
        self.options = options
        self.prompts: list[str] = []
        FakeClient.last = self

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def query(self, prompt: str) -> None:
        self.prompts.append(prompt)

    async def receive_response(self) -> AsyncIterator[Message]:
        for msg in self.script:
            yield msg
        if self.error is not None:
            raise self.error


def req_of(tmp_path: Path) -> ProbeRequest:
    return ProbeRequest(provider_key="claude-sub", work_dir=str(tmp_path), cli_path="/x/claude")


def result(**over: Any) -> ResultMessage:
    base: dict[str, Any] = {
        "subtype": "success",
        "duration_ms": 1,
        "duration_api_ms": 1,
        "is_error": False,
        "num_turns": 1,
        "session_id": "sess-1",
        "usage": {"input_tokens": 4211, "output_tokens": 45},
        "model_usage": {"claude-haiku-x": {}},
        "result": ANSWER,
    }
    base.update(over)
    return ResultMessage(**base)


def rate(status: str, **more: Any) -> RateLimitEvent:
    info = RateLimitInfo(status=status, **more)  # pyright: ignore[reportArgumentType]
    return RateLimitEvent(rate_limit_info=info, uuid="u", session_id="sess-1")


async def run(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    script: Sequence[Message],
    error: ClaudeSDKError | None = None,
) -> list[dict[str, Any]]:
    fake = type("Fake", (FakeClient,), {"script": script, "error": error})
    monkeypatch.setattr(mod, "ClaudeSDKClient", fake)
    out: list[ProviderEvent] = []

    async def emit(ev: ProviderEvent) -> None:
        out.append(ev)

    provider = get_provider("claude-sub", "production")
    assert provider is not None
    await provider.probe(req_of(tmp_path), emit)
    return [json.loads(ev.model_dump_json(by_alias=True)) for ev in out]


def test_wrk_fr_22_probe_options(tmp_path: Path) -> None:
    o = probe_options(req_of(tmp_path))
    assert o.model == "haiku" and o.system_prompt == PROBE_SYSTEM and o.max_turns == 1
    assert o.tools == [] and o.allowed_tools == [] and o.mcp_servers == {}
    assert o.setting_sources == [] and o.strict_mcp_config is True
    assert o.cwd == str(tmp_path) and o.cli_path == "/x/claude"
    assert not o.hooks and o.resume is None and not o.continue_conversation
    assert o.env == {} and o.output_format is None


async def test_wrk_fr_22_probe_ok_no_content(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    script = [rate("allowed", rate_limit_type="five_hour", resets_at=1900000000), result()]
    evs = await run(monkeypatch, tmp_path, script)
    assert [e["type"] for e in evs] == ["rate_limit", "usage", "final"]
    assert evs[0]["status"] == "allowed" and evs[0]["rate_limit_type"] == "five_hour"
    assert (evs[1]["in"], evs[1]["out"]) == (4211, 45)
    assert evs[2]["text"] is None and evs[2]["is_error"] is False
    assert ANSWER not in json.dumps(evs)
    client = FakeClient.last
    assert client is not None and client.prompts == [PROBE_PROMPT]


async def test_wrk_fr_22_probe_rejected_and_warning(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    script = [
        rate("allowed_warning", utilization=0.9),
        rate("rejected", resets_at=1900000000),
        rate("rejected", resets_at=1900000000),
        result(is_error=True, subtype="error_during_execution", api_error_status=429),
    ]
    evs = await run(monkeypatch, tmp_path, script)
    statuses = [e["status"] for e in evs if e["type"] == "rate_limit"]
    assert statuses == ["allowed_warning", "rejected"]  # mỗi status một lần
    assert evs[-1]["type"] == "final" and evs[-1]["is_error"] is True


async def test_wrk_fr_22_probe_not_logged_in_result(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    script = [result(is_error=True, result="Not logged in · Please run /login")]
    evs = await run(monkeypatch, tmp_path, script)
    assert evs[0] == {**evs[0], "type": "rate_limit", "status": "logged_out"}
    assert evs[-1]["text"] is None


async def test_wrk_fr_22_probe_sdk_error_fatal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    evs = await run(monkeypatch, tmp_path, [], CLINotFoundError("no cli at /secret/path"))
    assert evs and evs[-1]["type"] == "fatal"
    assert "/secret/path" not in json.dumps(evs)
