"""WRK-FR-10 · WRK-FR-14 · WRK-FR-15 · WRK-BR-07 · AC-W02 · provider `claude-sub` với **SDK giả**
(monkeypatch `ClaudeSDKClient`, không gọi CLI thật). Xác minh lại hành vi thật sau W0+PY-02 (I2).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from pathlib import Path
from typing import Any, Self

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKError,
    CLIJSONDecodeError,
    CLINotFoundError,
    Message,
    ProcessError,
    RateLimitEvent,
    RateLimitInfo,
    ResultError,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
)

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.providers.base import ProviderEvent, ProviderJob
from agent_runtime.providers.claude import provider as mod
from agent_runtime.providers.claude.provider import ClaudeProvider
from agent_runtime.providers.registry import get_provider

JOB = "c3000000-0000-4000-8000-000000000008"
U = "00000000-0000-4000-8000-000000000001"


def payload(output: str = "agent_result", **over: Any) -> JobPayload1:
    data: dict[str, Any] = {
        "v": 1,
        "type": "agent.cli",
        "runtime": "agentic-cli",
        "job_id": JOB,
        "run_id": U,
        "step_id": U,
        "tenant_id": U,
        "user_id": U,
        "conversation_id": U,
        "flow_id": U,
        "feature_id": None,
        "agent_type_key": None,
        "mcp": None,
        "agent": {"id": U, "key": "coder", "role": "agent"},
        "provider_key": "claude-sub",
        "model": None,
        "step_index": 0,
        "max_turns": 30,
        "profile_steps": [{"provider_key": "claude-sub", "model": None, "on": []}],
        "system_prompt": "Bạn là agent.",
        "prompt": "đọc README",
        "history": [],
        "use_session": True,
        "allowed_tools": ["Read", "Grep"],
        "output": output,
        "timeout_s": 600,
    }
    data.update(over)
    return JobPayload1.model_validate(data)


def job_of(tmp_path: Path, output: str = "agent_result", **over: Any) -> ProviderJob:
    work = tmp_path / "work" / JOB
    work.mkdir(parents=True)
    roots = [str(tmp_path), "/mnt", str(tmp_path / "work")]
    return ProviderJob(
        payload=payload(output, **over),
        work_dir=str(work),
        forbidden_roots=roots,
        resume_session_id="sess-old",
    )


class FakeClient:
    """`ClaudeSDKClient` giả: phát `script` rồi (tuỳ) ném `error`."""

    script: Sequence[Message] = ()
    error: ClaudeSDKError | None = None
    last: FakeClient | None = None

    def __init__(self, options: ClaudeAgentOptions | None = None) -> None:
        self.options = options
        self.prompts: list[str] = []
        self.closed = False
        FakeClient.last = self

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_: object) -> None:
        self.closed = True

    async def query(self, prompt: str) -> None:
        self.prompts.append(prompt)

    async def receive_response(self) -> AsyncIterator[Message]:
        for msg in self.script:
            yield msg
        if self.error is not None:
            raise self.error


def result(**over: Any) -> ResultMessage:
    base: dict[str, Any] = {
        "subtype": "success",
        "duration_ms": 1,
        "duration_api_ms": 1,
        "is_error": False,
        "num_turns": 1,
        "session_id": "sess-1",
        "usage": {
            "input_tokens": 11,
            "output_tokens": 22,
            "cache_read_input_tokens": 3,
            "cache_creation_input_tokens": 4,
        },
        "model_usage": {"claude-sonnet-x": {}},
        "result": None,
        "structured_output": {"status": "done", "text": "xong"},
    }
    base.update(over)
    return ResultMessage(**base)


def init(sid: str = "sess-1") -> SystemMessage:
    return SystemMessage(subtype="init", data={"session_id": sid, "cwd": "/secret/path"})


def rate(status: str, resets_at: int | None = None) -> RateLimitEvent:
    info = RateLimitInfo(status=status, resets_at=resets_at)  # pyright: ignore[reportArgumentType]
    return RateLimitEvent(rate_limit_info=info, uuid="u", session_id="sess-1")


async def run(
    monkeypatch: pytest.MonkeyPatch,
    job: ProviderJob,
    script: Sequence[Message],
    error: ClaudeSDKError | None = None,
) -> list[dict[str, Any]]:
    fake = type("Fake", (FakeClient,), {"script": script, "error": error})
    monkeypatch.setattr(mod, "ClaudeSDKClient", fake)
    out: list[ProviderEvent] = []

    async def emit(ev: ProviderEvent) -> None:
        out.append(ev)

    await ClaudeProvider().run(job, emit)
    return [json.loads(ev.model_dump_json(by_alias=True)) for ev in out]


def types(evs: list[dict[str, Any]]) -> list[str]:
    return [e["type"] for e in evs]


async def test_wrk_fr_10_agent_happy_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    tool = ToolUseBlock(id="t1", name="Read", input={"file_path": "/secret/a.txt"})
    script = [init(), AssistantMessage(content=[TextBlock("x"), tool], model="m"), result()]
    evs = await run(monkeypatch, job_of(tmp_path), script)
    assert types(evs) == ["session", "tool_use", "progress", "usage", "final"]
    assert evs[0]["session_id"] == "sess-1"
    assert evs[1]["name"] == "Read"
    assert evs[2]["label"] == "Đang đọc tệp"
    assert "/secret" not in json.dumps(evs)  # H1-R26: không lộ đường dẫn
    assert evs[3] == {
        "type": "usage",
        "in": 11,
        "out": 22,
        "cache_read": 3,
        "cache_write": 4,
        "model": "claude-sonnet-x",
    }
    assert evs[4]["kind"] == "agent_result"
    assert evs[4]["structured"] == {"status": "done", "text": "xong"}
    client = FakeClient.last
    assert client is not None and client.prompts == ["đọc README"] and client.closed


async def test_wrk_fr_10_result_session_differs_emitted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    evs = await run(monkeypatch, job_of(tmp_path), [init("a"), result(session_id="b")])
    assert [e["session_id"] for e in evs if e["type"] == "session"] == ["a", "b"]


async def test_wrk_fr_10_structured_from_result_text(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    text = 'ok\n```json\n{"status": "partial", "text": "t", "missing": "m", "question": null}\n```'
    evs = await run(monkeypatch, job_of(tmp_path), [result(structured_output=None, result=text)])
    assert evs[-1]["structured"] == {"status": "partial", "text": "t", "missing": "m"}


async def test_wrk_fr_10_orchestrator_text(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    job = job_of(tmp_path, "text", use_session=False, allowed_tools=[])
    evs = await run(monkeypatch, job, [result(structured_output=None, result="QUYẾT ĐỊNH")])
    assert evs[-1]["kind"] == "text" and evs[-1]["text"] == "QUYẾT ĐỊNH"


async def test_wrk_fr_15_rate_limit_rejected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    script = [
        rate("allowed_warning"),
        rate("rejected", 1_900_000_000),
        result(is_error=True, subtype="error_during_execution", structured_output=None),
    ]
    evs = await run(monkeypatch, job_of(tmp_path), script)
    limits = [e for e in evs if e["type"] == "rate_limit"]
    assert limits == [{"type": "rate_limit", "status": "rejected", "resets_at": 1_900_000_000}]
    assert evs[-1]["is_error"] is True and evs[-1]["structured"] is None


@pytest.mark.parametrize(
    ("over", "status"),
    [
        ({"api_error_status": 429}, "rejected"),
        ({"result": "Claude AI usage limit reached|1900000000"}, "rejected"),
        ({"errors": ["Invalid API key · Please run /login"]}, "logged_out"),
        ({"api_error_status": 401}, "logged_out"),
    ],
)
async def test_wrk_fr_15_result_error_signal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, over: dict[str, Any], status: str
) -> None:
    msg = result(is_error=True, structured_output=None, **over)
    evs = await run(monkeypatch, job_of(tmp_path), [msg])
    assert [e for e in evs if e["type"] == "rate_limit"] == [
        {"type": "rate_limit", "status": status, "resets_at": None}
    ]
    assert evs[-1]["type"] == "final" and evs[-1]["is_error"] is True


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (CLINotFoundError("nf"), ["fatal:UPSTREAM_ERROR:provider_unavailable"]),
        (ProcessError("x", 1, "boom /home/w/x"), ["fatal:UPSTREAM_ERROR:crash"]),
        (
            ProcessError("x", 1, "Error: rate limit exceeded"),
            ["rate_limit:rejected", "fatal:ALL_PROVIDERS_EXHAUSTED:quota"],
        ),
        (
            ProcessError("x", 1, "Not logged in · Please run /login"),
            ["rate_limit:logged_out", "fatal:ALL_PROVIDERS_EXHAUSTED:provider_unavailable"],
        ),
        (
            ResultError("x", {"api_error_status": 429}, 1),
            ["rate_limit:rejected", "fatal:ALL_PROVIDERS_EXHAUSTED:quota"],
        ),
        (CLIJSONDecodeError("{bad", ValueError("v")), ["fatal:UPSTREAM_ERROR:crash"]),
        (ClaudeSDKError("other"), ["fatal:UPSTREAM_ERROR:None"]),
    ],
)
async def test_wrk_fr_10_sdk_errors_map_to_contract(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, error: ClaudeSDKError, expected: list[str]
) -> None:
    evs = await run(monkeypatch, job_of(tmp_path), [init()], error)
    got = [
        f"fatal:{e['code']}:{e['reason']}" if e["type"] == "fatal" else f"rate_limit:{e['status']}"
        for e in evs
        if e["type"] in ("fatal", "rate_limit")
    ]
    assert got == expected
    assert "/home/w" not in json.dumps(evs)
    codes = {"ALL_PROVIDERS_EXHAUSTED", "UPSTREAM_ERROR"}
    assert all(e["code"] in codes for e in evs if e["type"] == "fatal")


async def test_wrk_fr_10_error_after_result_ignored(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    err = ResultError("x", {"subtype": "error_max_turns"}, 1)
    msg = result(is_error=True, subtype="error_max_turns", structured_output=None)
    evs = await run(monkeypatch, job_of(tmp_path), [msg], err)
    assert types(evs) == ["session", "usage", "final"]


def test_wrk_fr_10_registry_has_claude_sub() -> None:
    for env in ("production", "development", None):
        provider = get_provider("claude-sub", env)
        assert isinstance(provider, ClaudeProvider) and provider.key == "claude-sub"
