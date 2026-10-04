"""WRK-FR-13 · HUB-FR-95 · AC-H12 · `fake-cli` gọi MCP Hub thật (`plan-runtime` §6): JSON-RPC qua
httpx2 tới `payload.mcp.url`, header `Authorization` đọc từ file cấu hình `mcp_config_path` (như CLI
thật — token claim, quyền được cấp cho job, WRK-FR-26). Chạy trong job host (process con): không
import `config`/`db`/`events`. Kết quả quy về chữ cố định (`done{text}`) hoặc `Confirm`.
"""

from __future__ import annotations

import itertools
from collections.abc import Mapping, Sequence
from typing import Any, cast

import httpx2

from agent_runtime.providers.base import Confirm, parse_confirmation

PROTOCOL_VERSION = "2025-11-25"  # bản CLI gửi khi `initialize` (spike `spike-mcp.md` S1)
CALL_TIMEOUT_S = 30.0
UNKNOWN_TOOL = -32602
CLIENT_INFO = {"name": "fake-cli", "version": "1"}
UNAUTHORIZED = "mcp_unauthorized"
UNREACHABLE = "mcp_unreachable"
TOOL_UNKNOWN = "tool_unknown"
TOOL_ERROR = "tool_error"
DESC_MAX = 500

Json = dict[str, Any]


class McpFailure(Exception):
    """Lỗi quy về chữ cố định (`mcp_unauthorized`, `mcp_unreachable`, `tool_unknown`, …)."""

    def __init__(self, text: str) -> None:
        super().__init__(text)
        self.text = text


class McpSession:
    """`initialize` rồi các lời gọi JSON-RPC (Hub không giữ phiên — mỗi request kèm Bearer)."""

    def __init__(self, client: httpx2.AsyncClient, url: str, auth: str) -> None:
        self.client, self.url, self.auth = client, url, auth
        self.version = PROTOCOL_VERSION
        self._ids = itertools.count(1)

    async def rpc(self, method: str, params: Json) -> Json:
        headers = {"Authorization": self.auth, "MCP-Protocol-Version": self.version}
        body = {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params}
        try:
            resp = await self.client.post(self.url, json=body, headers=headers)
        except httpx2.HTTPError as err:
            raise McpFailure(UNREACHABLE) from err
        if resp.status_code == 401:
            raise McpFailure(UNAUTHORIZED)
        try:
            data: object = resp.json()
        except ValueError as err:
            raise McpFailure(TOOL_ERROR) from err
        if resp.status_code != 200 or not isinstance(data, dict):
            raise McpFailure(TOOL_ERROR)
        msg = cast(Json, data)
        error = msg.get("error")
        if isinstance(error, dict):
            code = cast(Json, error).get("code")
            raise McpFailure(TOOL_UNKNOWN if code == UNKNOWN_TOOL else TOOL_ERROR)
        result = msg.get("result")
        return cast(Json, result) if isinstance(result, dict) else {}

    async def initialize(self) -> None:
        params = {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": CLIENT_INFO,
        }
        got = await self.rpc("initialize", params)
        version = got.get("protocolVersion")
        if isinstance(version, str) and version:
            self.version = version


def _client() -> httpx2.AsyncClient:
    # Không đọc proxy env: Hub/mock ở loopback (tương đương `NO_PROXY`, `plan-runtime` §4.2).
    return httpx2.AsyncClient(timeout=httpx2.Timeout(CALL_TIMEOUT_S), trust_env=False)


def _texts(content: object) -> list[str]:
    if not isinstance(content, list):
        return []
    out: list[str] = []
    for block in cast(list[object], content):
        if isinstance(block, dict):
            b = cast(Json, block)
            if b.get("type") == "text" and isinstance(b.get("text"), str):
                out.append(cast(str, b["text"]))
    return out


def tool_outcome(result: Mapping[str, Any]) -> str | Confirm:
    """Kết quả `tools/call`: `isError` + `CONFIRMATION_REQUIRED` đúng hình → `Confirm`; lỗi khác →
    `tool_error`; thành công → nối các khối text."""
    content: object = result.get("content")
    if result.get("isError") is True:
        blocks = cast(Sequence[Mapping[str, Any]], content if isinstance(content, list) else [])
        return parse_confirmation(blocks) or TOOL_ERROR
    return "\n".join(_texts(content))


async def call_tool(url: str, auth: str, key: str, arguments: Json) -> str | Confirm:
    """`initialize` → `tools/call{name: key, arguments}`; lỗi quy về chữ cố định."""
    async with _client() as c:
        s = McpSession(c, url, auth)
        try:
            await s.initialize()
            result = await s.rpc("tools/call", {"name": key, "arguments": arguments})
        except McpFailure as err:
            return err.text
    return tool_outcome(result)


async def list_tools(url: str, auth: str) -> str:
    """`tools/list` → `"tên1,tên2 | <mô tả tool đầu>"` (AC-H12, HUB-H2a-AC-05)."""
    async with _client() as c:
        s = McpSession(c, url, auth)
        try:
            await s.initialize()
            result = await s.rpc("tools/list", {})
        except McpFailure as err:
            return err.text
    raw: object = result.get("tools")
    tools = (
        [cast(Json, t) for t in cast(list[object], raw) if isinstance(t, dict)]
        if isinstance(raw, list)
        else []
    )
    names = ",".join(str(t.get("name", "")) for t in tools)
    desc = str(tools[0].get("description", ""))[:DESC_MAX] if tools else ""
    return f"{names} | {desc}" if desc else names
