"""WRK-FR-10 · WRK-FR-11 · WRK-BR-07 · Dựng `ClaudeAgentOptions` cho một job (plan-runtime
§3.1, §4).

**Xác minh lại sau W0+PY-02** (plan-runtime §13): `disallowed_tools` dùng danh sách tên đủ thay vì
`["*"]`; `tools=[]` = không tool; `setting_sources=[]` = không nạp settings user; schema
`output_format` phẳng (union chưa xác minh); `CLAUDE_CODE_SKIP_PROMPT_HISTORY` cho Orchestrator.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, cast

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher
from claude_agent_sdk.types import HookCallback, HookContext, HookInput, HookJSONOutput

from agent_runtime.providers.base import ProviderJob
from agent_runtime.sandbox.hook import PathGuard, SandboxPolicy, make_path_guard

HOOK_TIMEOUT_S = 10.0
PERMISSION_MODE = "dontAsk"  # không `bypassPermissions` (§3.1)
# Dự phòng §4 (thay `disallowed_tools=["*"]` chưa xác minh): mọi tool dựng sẵn biết tên.
KNOWN_TOOLS: tuple[str, ...] = (
    "Read",
    "Write",
    "Edit",
    "NotebookEdit",
    "Glob",
    "Grep",
    "LS",
    "Bash",
    "WebFetch",
    "WebSearch",
    "Agent",
    "Task",
    "TodoWrite",
)
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
    """Agent: `payload.allowed_tools`; Orchestrator (`output="text"`): không tool."""
    if job.payload.output == "text":
        return []
    return list(dict.fromkeys(job.payload.allowed_tools))


def disallowed(tools: list[str]) -> list[str]:
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
    )


def _stderr_line(line: str) -> None:
    # stderr job host = file log job 0600 (runner); không đi vào ChildEvent.
    sys.stderr.write(line.rstrip("\n") + "\n")


def build_options(job: ProviderJob) -> ClaudeAgentOptions:
    """§3.1: `cwd` = work của job, tool tối thiểu, hook sandbox, env tường minh."""
    p = job.payload
    tools = job_tools(job)
    agent = p.output == "agent_result"
    guard = make_path_guard(policy_of(job, tools))
    return ClaudeAgentOptions(
        cwd=job.work_dir,
        tools=tools,
        allowed_tools=list(tools),
        disallowed_tools=disallowed(tools),
        permission_mode=PERMISSION_MODE,
        hooks={
            "PreToolUse": [
                HookMatcher(matcher=None, hooks=[sdk_hook(guard)], timeout=HOOK_TIMEOUT_S)
            ]
        },
        setting_sources=[],
        resume=job.resume_session_id if p.use_session else None,
        max_turns=p.max_turns,
        model=p.model.root if p.model is not None else None,
        env={} if agent else {"CLAUDE_CODE_SKIP_PROMPT_HISTORY": "1"},
        system_prompt=p.system_prompt + FORMAT_BLOCK if agent else p.system_prompt,
        output_format={"type": "json_schema", "schema": AGENT_RESULT_SCHEMA} if agent else None,
        cli_path=job.cli_path,
        stderr=_stderr_line,
    )
