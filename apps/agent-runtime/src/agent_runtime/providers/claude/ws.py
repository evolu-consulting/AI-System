"""WRK-FR-28 · HUB-BR-32 · P-c1 · Tool `ws` cho `claude-sub` — MCP trong tiến trình
(`create_sdk_mcp_server`, tên `mcp__ws__ws_*`; plan-runtime §5.5). Thân tool ở
`autofix/ws_tools.py` (không SDK); đây chỉ bọc thành `SdkMcpTool`. Lỗi ⇒ `is_error` + mã ngắn.
"""

from __future__ import annotations

from typing import Any

from claude_agent_sdk import SdkMcpTool, create_sdk_mcp_server
from claude_agent_sdk.types import McpSdkServerConfig

from agent_runtime.autofix.ws_tools import TOOL_SPECS, WS_SERVER, WsError, WsSession, WsTarget, call

WS_BLOCK = (
    "\n\n# Workspace\nRepo cần sửa chỉ truy cập qua tool `ws_read`, `ws_write`, `ws_edit`, "
    "`ws_exec` (đường dẫn tương đối gốc repo; lệnh chạy trong container không mạng). Không dùng "
    "Read/Write gốc cho repo."
)


def _text(text: str, *, error: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {"content": [{"type": "text", "text": text}]}
    if error:
        out["is_error"] = True
    return out


def _handler(session: WsSession, name: str):  # noqa: ANN202 — closure handler SDK
    async def handle(args: dict[str, Any]) -> dict[str, Any]:
        try:
            return _text(await call(session, name, args))
        except WsError as err:
            return _text(f"lỗi: {err}", error=True)

    return handle


def ws_server(target: WsTarget) -> McpSdkServerConfig:
    """Server `ws` của một job (một `WsSession` chung cho 4 tool)."""
    session = WsSession(target)
    tools: list[SdkMcpTool[Any]] = [
        SdkMcpTool(
            name=name, description=desc, input_schema=schema, handler=_handler(session, name)
        )
        for name, (desc, schema) in TOOL_SPECS.items()
    ]
    return create_sdk_mcp_server(WS_SERVER, tools=tools)
