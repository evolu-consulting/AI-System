"""WRK-FR-10 · WRK-FR-11 · WRK-BR-07 · `build_options` (plan-runtime §3.1, §4; dự phòng §13 —
xác minh lại sau W0+PY-02)."""

from __future__ import annotations

from pathlib import Path

from claude_agent_sdk import HookMatcher
from claude_agent_sdk.types import HookContext, HookInput

from agent_runtime.providers.claude.options import (
    AGENT_RESULT_SCHEMA,
    HOOK_TIMEOUT_S,
    KNOWN_TOOLS,
    build_options,
)
from agent_runtime.providers.claude.test_provider import job_of


def _matcher(tmp_path: Path, output: str = "agent_result") -> HookMatcher:
    opts = build_options(job_of(tmp_path, output))
    assert opts.hooks is not None
    [matcher] = opts.hooks["PreToolUse"]
    return matcher


def test_wrk_fr_10_agent_options(tmp_path: Path) -> None:
    job = job_of(tmp_path, model="claude-sonnet-x", max_turns=7)
    opts = build_options(job)
    assert opts.cwd == job.work_dir
    assert opts.tools == ["Read", "Grep"] and opts.allowed_tools == ["Read", "Grep"]
    assert set(opts.disallowed_tools) == set(KNOWN_TOOLS) - {"Read", "Grep"}
    assert {"Bash", "Write", "Edit", "WebFetch", "Agent", "Task"} <= set(opts.disallowed_tools)
    assert opts.permission_mode == "dontAsk"
    assert opts.setting_sources == []
    assert (opts.resume, opts.max_turns, opts.model) == ("sess-old", 7, "claude-sonnet-x")
    assert opts.env == {}
    assert opts.output_format == {"type": "json_schema", "schema": AGENT_RESULT_SCHEMA}
    assert isinstance(opts.system_prompt, str) and opts.system_prompt.startswith("Bạn là agent.")
    assert "JSON" in opts.system_prompt
    assert opts.max_budget_usd is None and opts.cli_path is None


def test_wrk_fr_10_orchestrator_options(tmp_path: Path) -> None:
    opts = build_options(job_of(tmp_path, "text", use_session=False, allowed_tools=[]))
    assert opts.tools == [] and opts.allowed_tools == []
    assert set(opts.disallowed_tools) == set(KNOWN_TOOLS)
    assert opts.resume is None
    assert opts.env == {"CLAUDE_CODE_SKIP_PROMPT_HISTORY": "1"}
    assert opts.output_format is None and opts.system_prompt == "Bạn là agent."


def test_wrk_fr_10_text_output_ignores_allowed_tools(tmp_path: Path) -> None:
    opts = build_options(job_of(tmp_path, "text"))
    assert opts.tools == []


def _input(tool: str, tool_input: dict[str, object]) -> HookInput:
    return {  # pyright: ignore[reportReturnType]
        "hook_event_name": "PreToolUse",
        "session_id": "s",
        "transcript_path": "",
        "cwd": "",
        "tool_name": tool,
        "tool_input": tool_input,
        "tool_use_id": "t1",
    }


async def test_wrk_br_07_hook_is_path_guard(tmp_path: Path) -> None:
    matcher = _matcher(tmp_path)
    assert matcher.matcher is None and matcher.timeout == HOOK_TIMEOUT_S
    [hook] = matcher.hooks
    ctx: HookContext = {"signal": None}
    work = tmp_path / "work"
    inside = str(work / "c3000000-0000-4000-8000-000000000008" / "a.txt")
    assert await hook(_input("Read", {"file_path": inside}), "t1", ctx) == {}
    denied = await hook(_input("Read", {"file_path": str(tmp_path / ".claude")}), "t1", ctx)
    assert denied["hookSpecificOutput"]["permissionDecision"] == "deny"  # pyright: ignore[reportTypedDictNotRequiredAccess, reportGeneralTypeIssues]
    tool = await hook(_input("Bash", {"command": "ls"}), "t1", ctx)
    assert tool["hookSpecificOutput"]["permissionDecisionReason"] == "tool_not_allowed"  # pyright: ignore[reportTypedDictNotRequiredAccess, reportGeneralTypeIssues]
    glob = await hook(_input("Glob", {"pattern": "*.md"}), "t1", ctx)
    assert glob["hookSpecificOutput"]["permissionDecisionReason"] == "tool_not_allowed"  # pyright: ignore[reportTypedDictNotRequiredAccess, reportGeneralTypeIssues]
