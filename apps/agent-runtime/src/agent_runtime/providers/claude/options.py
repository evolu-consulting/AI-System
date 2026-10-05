"""WRK-FR-10 · WRK-FR-11 · WRK-BR-07 · Dựng `ClaudeAgentOptions` cho một job (plan-runtime
§3.1, §4).

Đã xác minh ở spike PY-02 (`spike-py02.md`, CLI đóng gói 2.1.286): `tools` (allowlist `--tools`)
là hàng rào chính; `disallowed_tools=["*"]` ⇒ không tool (Orchestrator); `setting_sources=[]` không
nạp CLAUDE.md/settings; `output_format` schema phẳng ⇒ CLI thêm tool `StructuredOutput` (tốn 1
lượt, hook cho phép — S2); env tắt connector claude.ai (S3) + auto-memory (S6);
`CLAUDE_CODE_SKIP_PROMPT_HISTORY` cho Orchestrator; fine-grained tool streaming cho
`StructuredOutput` (H2b smoke F1). `system_prompt` qua `neutralize_mentions` (S1).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, cast

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher
from claude_agent_sdk.types import HookCallback, HookContext, HookInput, HookJSONOutput

from agent_runtime.providers.base import ProviderJob
from agent_runtime.providers.claude.mcp import MCP_BLOCK, job_mcp_tools
from agent_runtime.providers.context import neutralize_mentions
from agent_runtime.sandbox.hook import PathGuard, SandboxPolicy, make_path_guard

HOOK_TIMEOUT_S = 10.0
PERMISSION_MODE = "dontAsk"  # không `bypassPermissions` (§3.1)
# Tool dựng sẵn của CLI 2.1.286 (init `tools` mặc định, spike #2b) + `Glob`/`Grep` (chỉ có khi ghi
# rõ trong `tools`). Không có `StructuredOutput` (CLI tự thêm khi có `output_format`).
KNOWN_TOOLS: tuple[str, ...] = (
    "Task",
    "Bash",
    "CronCreate",
    "CronDelete",
    "CronList",
    "DesignSync",
    "Edit",
    "EnterWorktree",
    "ExitWorktree",
    "ListAgents",
    "NotebookEdit",
    "Read",
    "ReportFindings",
    "ScheduleWakeup",
    "SendMessage",
    "Skill",
    "TaskStop",
    "ToolSearch",
    "WebFetch",
    "WebSearch",
    "Workflow",
    "Write",
    "Glob",
    "Grep",
)
ALL_TOOLS = "*"  # đã xác minh: `disallowed_tools=["*"]` xoá mọi tool (kể cả tool trong `tools`)
AGENT_MIN_TURNS = 2  # S7: structured output tốn 1 lượt (`num_turns=2` khi trả lời ngay)
# S3/S6: không nạp MCP connector claude.ai của tài khoản; không đọc/ghi auto-memory.
# H2b smoke F1 (`smoke.md` "Điều tra delta agent"): env job host tắt telemetry/traffic phụ
# (`CLI_QUIET_ENV`) ⇒ CLI tắt GrowthBook ⇒ cờ `tengu_fgts` = mặc định false ⇒ tool không gắn
# `eager_input_streaming` ⇒ API đệm `input_json_delta` của `StructuredOutput` tới cuối (dồn cục).
# Bật tường minh fine-grained tool streaming (CLI 2.1.286 đọc biến này, đo lại bằng spike).
FGTS_ENV = "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING"
CLAUDE_ENV: dict[str, str] = {
    "ENABLE_CLAUDEAI_MCP_SERVERS": "false",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
    FGTS_ENV: "1",
}
ORCHESTRATOR_ENV: dict[str, str] = {**CLAUDE_ENV, "CLAUDE_CODE_SKIP_PROMPT_HISTORY": "1"}
# Dự phòng §4: schema phẳng thay `discriminatedUnion` AgentResult; runner validate chặt (C2).
AGENT_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "partial", "need_input"]},
        "text": {"type": "string"},
        "missing": {"type": "string"},
        "question": {"type": "string"},
        "choices": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
    },
    "required": ["status"],
    "additionalProperties": False,
}
FORMAT_BLOCK = (
    "\n\n# Định dạng trả lời\nChỉ trả MỘT đối tượng JSON đúng schema: "
    '{"status":"done","text":"..."} | {"status":"partial","text":"...","missing":"..."} | '
    '{"status":"need_input","question":"...","choices":["..."]}. Không thêm chữ ngoài JSON.'
)


def job_tools(job: ProviderJob) -> list[str]:
    """Agent: `payload.allowed_tools`; Orchestrator / lần thử lại (PY-10): không tool."""
    if job.payload.output == "text" or job.retry_prompt is not None:
        return []
    return list(dict.fromkeys(job.payload.allowed_tools))


def disallowed(tools: list[str], *, structured: bool) -> list[str]:
    """Orchestrator (không `output_format`) → `["*"]`; agent → mọi tool dựng sẵn ngoài `tools`
    (không dùng `*` để khỏi xoá `StructuredOutput` — hàng rào thứ hai sau `tools`)."""
    if not structured:
        return [ALL_TOOLS]
    return [name for name in KNOWN_TOOLS if name not in tools]


def sdk_hook(guard: PathGuard) -> HookCallback:
    """Bọc `path_guard` (dict thuần, không phụ thuộc SDK) thành `HookCallback` của SDK."""

    async def hook(
        input_data: HookInput, tool_use_id: str | None, context: HookContext
    ) -> HookJSONOutput:
        return cast(HookJSONOutput, await guard(input_data, tool_use_id, context))

    return hook


def policy_of(job: ProviderJob, tools: list[str]) -> SandboxPolicy:
    return SandboxPolicy(
        job_id=str(job.payload.job_id),
        work_dir=Path(job.work_dir),
        forbidden_roots=tuple(Path(r) for r in job.forbidden_roots),
        tools=frozenset(tools),
        structured_output=job.payload.output == "agent_result",  # có `output_format` (S2)
        mcp_tools=frozenset(job_mcp_tools(job)),
    )


def _stderr_line(line: str) -> None:
    # stderr job host = file log job 0600 (runner); không đi vào ChildEvent.
    sys.stderr.write(line.rstrip("\n") + "\n")


def _system_prompt(job: ProviderJob, *, agent: bool, mcp: bool) -> str:
    p = job.payload
    text = p.system_prompt + FORMAT_BLOCK if agent else p.system_prompt
    return neutralize_mentions(text + MCP_BLOCK if mcp else text)


def build_options(job: ProviderJob) -> ClaudeAgentOptions:
    """§3.1: `cwd` = work của job, tool tối thiểu, hook sandbox, env tường minh. H2a §4.2: có MCP
    → `mcp_servers=<đường dẫn file>` (không dict — dict lên argv), `allowed_tools` thêm
    `mcp__hub__<k>`, `MCP_BLOCK`; `tools`/`disallowed_tools` không đổi."""
    p = job.payload
    tools = job_tools(job)
    agent = p.output == "agent_result"
    mcp = job_mcp_tools(job)
    guard = make_path_guard(policy_of(job, tools))
    return ClaudeAgentOptions(
        cwd=job.work_dir,
        tools=tools,
        allowed_tools=[*tools, *mcp],
        mcp_servers=job.mcp_config_path if mcp and job.mcp_config_path else {},
        disallowed_tools=disallowed(tools, structured=agent),
        permission_mode=PERMISSION_MODE,
        hooks={
            "PreToolUse": [
                HookMatcher(matcher=None, hooks=[sdk_hook(guard)], timeout=HOOK_TIMEOUT_S)
            ]
        },
        setting_sources=[],
        strict_mcp_config=True,  # S3: chỉ MCP truyền qua `mcp_servers` (file Hub hoặc không có)
        resume=job.resume_session_id if p.use_session else None,
        max_turns=max(p.max_turns, AGENT_MIN_TURNS) if agent else p.max_turns,
        model=p.model.root if p.model is not None else None,
        env=dict(CLAUDE_ENV if agent else ORCHESTRATOR_ENV),
        system_prompt=_system_prompt(job, agent=agent, mcp=bool(mcp)),
        output_format={"type": "json_schema", "schema": AGENT_RESULT_SCHEMA} if agent else None,
        cli_path=job.cli_path,
        stderr=_stderr_line,
        # H2b §3.4 (PY-S2 S2): mọi job — F5 cần `StreamEvent` cả khi không stream (huỷ/timeout);
        # scanner/`Delta` chỉ khi `payload.stream` ∧ không phải lần thử lại (`provider.py`).
        include_partial_messages=True,
    )
