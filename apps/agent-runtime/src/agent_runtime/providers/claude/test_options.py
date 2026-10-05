"""WRK-FR-10 · WRK-FR-11 · WRK-BR-07 · `build_options` (plan-runtime §3.1, §4; spike PY-02
S1–S4, S6, S7)."""

from __future__ import annotations

from pathlib import Path

from claude_agent_sdk import HookMatcher
from claude_agent_sdk.types import HookContext, HookInput

from agent_runtime.providers.claude.options import (
    AGENT_RESULT_SCHEMA,
    CLAUDE_ENV,
    FGTS_ENV,
    HOOK_TIMEOUT_S,
    KNOWN_TOOLS,
    build_options,
)
from agent_runtime.providers.claude.test_provider import job_of
from agent_runtime.sandbox.env import job_host_env


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
    assert {"Bash", "Write", "Edit", "WebFetch", "Task", "Skill"} <= set(opts.disallowed_tools)
    assert "StructuredOutput" not in opts.disallowed_tools and "LS" not in KNOWN_TOOLS
    assert opts.permission_mode == "dontAsk"
    assert opts.setting_sources == [] and opts.strict_mcp_config
    assert (opts.resume, opts.max_turns, opts.model) == ("sess-old", 7, "claude-sonnet-x")
    assert opts.env == {
        "ENABLE_CLAUDEAI_MCP_SERVERS": "false",
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
        "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING": "1",
    }
    assert opts.output_format == {"type": "json_schema", "schema": AGENT_RESULT_SCHEMA}
    assert isinstance(opts.system_prompt, str) and opts.system_prompt.startswith("Bạn là agent.")
    assert "JSON" in opts.system_prompt
    assert opts.max_budget_usd is None and opts.cli_path is None


def test_wrk_fr_10_orchestrator_options(tmp_path: Path) -> None:
    opts = build_options(job_of(tmp_path, "text", use_session=False, allowed_tools=[]))
    assert opts.tools == [] and opts.allowed_tools == []
    assert opts.disallowed_tools == ["*"]  # S4: đã xác minh = không tool nào
    assert opts.resume is None and opts.strict_mcp_config
    assert opts.env == {**CLAUDE_ENV, "CLAUDE_CODE_SKIP_PROMPT_HISTORY": "1"}
    assert opts.output_format is None and opts.system_prompt == "Bạn là agent."


def test_wrk_fr_03_agent_fine_grained_tool_streaming(tmp_path: Path) -> None:
    """H2b smoke F1: env job host (`CLI_QUIET_ENV`) tắt GrowthBook của CLI ⇒ phải bật tường minh
    fine-grained tool streaming, nếu không `input_json_delta` của `StructuredOutput` dồn cục cuối
    (spike `stream_fgts_spike.py`: 136/140 mảnh trong 26 ms ↔ bật: 95 mảnh trải 4,9 s)."""
    env = job_host_env(tmp_path, tmp_path / "w", "development")
    assert env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] == "1"  # lý do phải bật tường minh
    for output in ("agent_result", "text"):
        opts = build_options(job_of(tmp_path / output, output))
        assert opts.env[FGTS_ENV] == "1"
        assert {**env, **opts.env}[FGTS_ENV] == "1"  # SDK: env tiến trình + `options.env` đè


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


def test_wrk_br_04_retry_has_no_tools(tmp_path: Path) -> None:
    job = job_of(tmp_path).model_copy(update={"retry_prompt": "chỉ JSON"})
    opts = build_options(job)
    assert opts.tools == [] and opts.allowed_tools == []
    assert set(opts.disallowed_tools) == set(KNOWN_TOOLS)
    assert opts.output_format == {"type": "json_schema", "schema": AGENT_RESULT_SCHEMA}


def test_wrk_fr_10_agent_min_two_turns(tmp_path: Path) -> None:
    """S7: structured output tốn 1 lượt ⇒ agent `max_turns ≥ 2`; Orchestrator giữ nguyên."""
    assert build_options(job_of(tmp_path / "a", max_turns=1)).max_turns == 2
    assert build_options(job_of(tmp_path / "o", "text", max_turns=1)).max_turns == 1


def test_wrk_br_07_system_prompt_mentions_neutralized(tmp_path: Path) -> None:
    """S1: `system_prompt` (Hub dựng) cũng qua `neutralize_mentions`."""
    job = job_of(tmp_path, "text", system_prompt="x @~/.claude/y")
    assert build_options(job).system_prompt == "x \u200b@~/.claude/y"
