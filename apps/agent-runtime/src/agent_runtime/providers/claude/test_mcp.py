"""WRK-FR-13 · H2a-R18, R19 · MCP Hub cho agent CLI: file cấu hình 0600 + `build_options`
(`plan-runtime` §4.2–4.5; spike `spike-mcp.md` #1, #10, S3–S5). SDK giả, không CLI thật."""

from __future__ import annotations

import json
import stat
from pathlib import Path
from typing import Any

import pytest
from claude_agent_sdk import AssistantMessage, SystemMessage, ToolUseBlock
from claude_agent_sdk.types import HookContext

from agent_runtime.providers.base import ProviderJob
from agent_runtime.providers.claude import mcp
from agent_runtime.providers.claude.mapping import mcp_statuses, tool_events
from agent_runtime.providers.claude.options import (
    CLAUDE_ENV,
    FORMAT_BLOCK,
    KNOWN_TOOLS,
    build_options,
)
from agent_runtime.providers.claude.test_options import (
    _input,  # pyright: ignore[reportPrivateUsage]
)
from agent_runtime.providers.claude.test_provider import JOB, job_of, result, run

URL = "http://127.0.0.1:4000/mcp"
TOKEN = "tok_" + "A" * 39
MCP = {"url": URL, "tools": ["check-invoice", "create-trello-card"]}
NAMES = ["mcp__hub__check-invoice", "mcp__hub__create-trello-card"]


def mcp_job(tmp_path: Path, output: str = "agent_result", **over: Any) -> ProviderJob:
    job = job_of(tmp_path, output, mcp=MCP, **over)
    path = mcp.write_config(tmp_path / "work", JOB, URL, TOKEN)
    return job.model_copy(update={"mcp_config_path": str(path)})


def test_wrk_fr_13_config_file_0600_outside_job_work(tmp_path: Path) -> None:
    """§4.2: `.mcp/<job_id>.json` 0600 (thư mục 0700), ngoài `work/<job_id>`, đúng hình
    `McpHttpServerConfig`; ghi lại thay file cũ; xoá idempotent."""
    root = tmp_path / "work"
    path = mcp.write_config(root, JOB, URL, TOKEN)
    assert path == root / ".mcp" / f"{JOB}.json" == mcp.config_path(root, JOB)
    assert (root / JOB) not in path.parents
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    assert json.loads(path.read_text()) == {
        "mcpServers": {
            "hub": {"type": "http", "url": URL, "headers": {"Authorization": f"Bearer {TOKEN}"}}
        }
    }
    assert mcp.read_bearer(path) == f"Bearer {TOKEN}"
    again = mcp.write_config(root, JOB, URL, "other")
    assert mcp.read_bearer(again) == "Bearer other"
    mcp.remove_config(path)
    mcp.remove_config(path)
    assert not path.exists() and mcp.read_bearer(path) is None


def test_wrk_fr_13_tool_timeout_ms() -> None:
    """S3: `MCP_TOOL_TIMEOUT` = min(timeout agent, trần Hub 300 s) + 5 s."""
    assert mcp.tool_timeout_ms(60) == 65_000
    assert mcp.tool_timeout_ms(3600) == 305_000


def test_wrk_fr_13_agent_options_with_mcp(tmp_path: Path) -> None:
    """§4.2: `mcp_servers=<đường dẫn>` (không dict ⇒ token không lên argv), `allowed_tools` thêm
    `mcp__hub__<k>`, `tools`/`disallowed_tools` như H1, strict + env tắt connector, `MCP_BLOCK`."""
    job = mcp_job(tmp_path)
    opts = build_options(job)
    assert opts.mcp_servers == job.mcp_config_path
    assert isinstance(opts.mcp_servers, str) and TOKEN not in opts.mcp_servers
    assert opts.tools == ["Read", "Grep"]
    assert opts.allowed_tools == ["Read", "Grep", *NAMES]
    assert set(opts.disallowed_tools) == set(KNOWN_TOOLS) - {"Read", "Grep"}
    assert opts.strict_mcp_config and opts.env == CLAUDE_ENV
    assert opts.env["ENABLE_CLAUDEAI_MCP_SERVERS"] == "false"
    assert isinstance(opts.system_prompt, str)
    assert opts.system_prompt.endswith(FORMAT_BLOCK + mcp.MCP_BLOCK)
    assert "CONFIRMATION_REQUIRED" in opts.system_prompt


@pytest.mark.parametrize("case", ["no_path", "retry", "orchestrator", "no_payload_mcp"])
def test_wrk_fr_13_no_mcp_cases(tmp_path: Path, case: str) -> None:
    """Không file / lần thử lại định dạng (WRK-BR-04) / Orchestrator (H1-R17) / payload không
    `mcp` → options như H1: `mcp_servers` rỗng, không tên MCP, không `MCP_BLOCK`."""
    job = mcp_job(tmp_path, "text" if case == "orchestrator" else "agent_result")
    if case == "no_path":
        job = job.model_copy(update={"mcp_config_path": None})
    elif case == "retry":
        job = job.model_copy(update={"retry_prompt": "chỉ JSON"})
    elif case == "no_payload_mcp":
        job = job.model_copy(update={"payload": job.payload.model_copy(update={"mcp": None})})
    opts = build_options(job)
    assert opts.mcp_servers == {} and opts.strict_mcp_config
    assert not any(t.startswith("mcp__") for t in opts.allowed_tools)
    assert isinstance(opts.system_prompt, str) and mcp.MCP_BLOCK not in opts.system_prompt


async def test_wrk_fr_13_options_hook_allows_only_job_mcp_tools(tmp_path: Path) -> None:
    """§4.3: hook của options cho `mcp__hub__<k>` của job (trả `{}`), deny tên lạ."""
    opts = build_options(mcp_job(tmp_path))
    assert opts.hooks is not None
    [hook] = opts.hooks["PreToolUse"][0].hooks
    ctx: HookContext = {"signal": None}
    ok = await hook(_input(NAMES[0], {"path": "/etc/passwd"}), "t1", ctx)
    assert ok == {}
    bad = await hook(_input("mcp__hub__secret-tool", {}), "t1", ctx)
    assert bad["hookSpecificOutput"]["permissionDecisionReason"] == "tool_not_allowed"  # pyright: ignore[reportTypedDictNotRequiredAccess, reportGeneralTypeIssues]


def test_wrk_fr_13_mcp_progress_label_static() -> None:
    """§4.4: `ToolUseBlock` `mcp__hub__<k>` → `tool_use` + nhãn tĩnh "Đang gọi công cụ"."""
    block = ToolUseBlock(id="t1", name=NAMES[1], input={"title": "bí mật"})
    evs = list(tool_events(AssistantMessage(content=[block], model="m")))
    dumped = [e.model_dump() for e in evs]
    assert dumped == [
        {"type": "tool_use", "name": NAMES[1]},
        {"type": "progress", "label": "Đang gọi công cụ"},
    ]


def test_wrk_fr_13_init_mcp_status_only() -> None:
    """§4.5 · S4: chỉ lấy `status` của server `hub` ở init (không `error`/config)."""
    data = {
        "mcp_servers": [
            {"name": "hub", "status": "failed", "error": "Bearer x http://hub.internal"},
            {"name": "other", "status": "connected"},
        ]
    }
    assert mcp_statuses(SystemMessage(subtype="init", data=data)) == ["failed"]
    assert mcp_statuses(SystemMessage(subtype="init", data={})) == []
    assert mcp_statuses(SystemMessage(subtype="status", data=data)) == []


async def test_wrk_fr_13_mcp_unavailable_not_fatal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """§4.5: Hub không tới được lúc init → CLI vẫn chạy, job không fail (log `warn`)."""
    init = SystemMessage(
        subtype="init",
        data={"session_id": "s1", "mcp_servers": [{"name": "hub", "status": "failed"}]},
    )
    evs = await run(monkeypatch, mcp_job(tmp_path), [init, result()])
    assert [e["type"] for e in evs][-1] == "final"
    assert all(e["type"] != "fatal" for e in evs)
