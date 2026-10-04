"""H2a `plan-runtime` §7 · WRK-FR-13 · HUB-FR-95 · R6 · Server MCP giả cho `fake-cli` (asyncio
stdlib, JSON-RPC 2.0 qua JSON thường, không SSE, không session — như Hub `/mcp`, P7).

API (khoá theo `tests/acceptance/mcp_int_test.py`):
`start_mcp_mock(tools: dict[key, mô tả], confirm: dict[key, {question, choices}] | None)` — async
context manager → `McpMock` có `.url` (URL `/mcp` đầy đủ) và `.calls(method=None)` → `McpCall`
(`.method`, `.params` dict, `.auth` = header `Authorization` nguyên văn, "" nếu thiếu).

Hành vi: `POST /mcp` · `token` (tuỳ chọn) đặt ⇒ Bearer khác → 401 thân rỗng (không ghi) ·
notification (không `id`) → 202 · `initialize` → `{protocolVersion, capabilities.tools,
serverInfo}` ·
`tools/list` → mọi tool (`inputSchema` object rỗng) · `tools/call` tên ∉ `tools` → `-32602 Unknown
tool`; ∈ `confirm` → `isError` + `content[0]` JSON `{code:"CONFIRMATION_REQUIRED", question,
choices}` + `content[1]` câu chỉ dẫn + `structuredContent` (R6, `plan-errors` §5); khác → thành
công `content[0].text = "ok:<key> <arguments JSON>"` · method lạ → `-32601` · GET/DELETE → 405.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any, cast

Json = dict[str, Any]
CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
INSTRUCTION = (
    "CONFIRMATION_REQUIRED: Công cụ này cần người dùng xác nhận trước. Dừng lại và trả need_input "
    "với đúng question và choices trong structuredContent; không gọi lại công cụ trong lượt này."
)
SERVER_INFO = {"name": "mcp-mock", "version": "1"}


@dataclass(frozen=True)
class McpCall:
    method: str
    params: Json
    auth: str
    id: object = None


@dataclass
class _Req:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes


async def _read(reader: asyncio.StreamReader) -> _Req | None:
    parts = (await reader.readline()).decode("latin-1").split()
    if len(parts) < 2:
        return None
    headers: dict[str, str] = {}
    while (h := await reader.readline()) not in (b"\r\n", b"\n", b""):
        name, _, value = h.decode("latin-1").partition(":")
        headers[name.strip().lower()] = value.strip()
    size = int(headers.get("content-length", "0") or 0)
    body = await reader.readexactly(size) if size else b""
    return _Req(parts[0].upper(), parts[1].split("?", 1)[0], headers, body)


def _response(
    status: int, body: Json | None = None, extra: Mapping[str, str] | None = None
) -> bytes:
    raw = json.dumps(body, ensure_ascii=False).encode() if body is not None else b""
    head = {"Content-Length": str(len(raw)), "Connection": "close", **(extra or {})}
    if body is not None:
        head["Content-Type"] = "application/json"
    lines = [f"HTTP/1.1 {status} {HTTPStatus(status).phrase}"]
    lines += [f"{k}: {v}" for k, v in head.items()]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + raw


def _rpc_error(rid: object, code: int, message: str) -> Json:
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


@dataclass
class McpMock:
    tools: dict[str, str]
    confirm: dict[str, Json] = field(default_factory=dict[str, Json])
    token: str | None = None
    url: str = ""
    _log: list[McpCall] = field(default_factory=list[McpCall])
    _server: asyncio.Server | None = None

    def calls(self, method: str | None = None) -> list[McpCall]:
        return [c for c in self._log if method is None or c.method == method]

    def reset(self) -> None:
        self._log.clear()

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self._server = await asyncio.start_server(self._handle, host, port)
        sock_port = self._server.sockets[0].getsockname()[1]
        self.url = f"http://{host}:{sock_port}/mcp"

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            with suppress(Exception):
                await asyncio.wait_for(self._server.wait_closed(), 2)
            self._server = None

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            req = await _read(reader)
            if req is not None:
                writer.write(self._route(req))
                await writer.drain()
        except (ConnectionError, asyncio.IncompleteReadError, ValueError):
            pass
        finally:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()

    def _route(self, req: _Req) -> bytes:
        if req.path != "/mcp":
            return _response(404, {"error": "not found"})
        if req.method != "POST":
            return _response(405, None, {"Allow": "POST"})
        auth = req.headers.get("authorization", "")
        if self.token is not None and auth != f"Bearer {self.token}":
            return _response(401, None, {"WWW-Authenticate": "Bearer"})
        try:
            msg: object = json.loads(req.body)
        except ValueError:
            return _response(200, _rpc_error(None, -32700, "Parse error"))
        if not isinstance(msg, dict) or not isinstance(cast(Json, msg).get("method"), str):
            return _response(200, _rpc_error(None, -32600, "Invalid Request"))
        m = cast(Json, msg)
        raw_params: object = m.get("params")
        params = cast(Json, raw_params) if isinstance(raw_params, dict) else {}
        self._log.append(McpCall(str(m["method"]), params, auth, m.get("id")))
        if "id" not in m:
            return _response(202)
        return _response(200, self._answer(m["id"], str(m["method"]), params))

    def _answer(self, rid: object, method: str, params: Json) -> Json:
        if method == "initialize":
            version = params.get("protocolVersion") or "2025-11-25"
            result: Json = {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            }
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": [self._tool(k, d) for k, d in self.tools.items()]}
        elif method == "tools/call":
            name = params.get("name")
            if not isinstance(name, str) or name not in self.tools:
                return _rpc_error(rid, -32602, "Unknown tool")
            result = self._call(name, params.get("arguments"))
        else:
            return _rpc_error(rid, -32601, "Method not found")
        return {"jsonrpc": "2.0", "id": rid, "result": result}

    @staticmethod
    def _tool(key: str, description: str) -> Json:
        schema: Json = {"type": "object", "properties": {}, "additionalProperties": True}
        return {"name": key, "description": description, "inputSchema": schema}

    def _call(self, name: str, arguments: object) -> Json:
        spec = self.confirm.get(name)
        if spec is not None:
            err = {
                "code": CONFIRMATION_REQUIRED,
                "question": spec["question"],
                "choices": list(spec["choices"]),
            }
            content = [
                {"type": "text", "text": json.dumps(err, ensure_ascii=False)},
                {"type": "text", "text": INSTRUCTION},
            ]
            return {"isError": True, "content": content, "structuredContent": err}
        args = json.dumps(arguments if arguments is not None else {}, ensure_ascii=False)
        return {"isError": False, "content": [{"type": "text", "text": f"ok:{name} {args}"}]}


@asynccontextmanager
async def start_mcp_mock(
    tools: Mapping[str, str],
    confirm: Mapping[str, Mapping[str, Any]] | None = None,
    *,
    token: str | None = None,
) -> AsyncGenerator[McpMock]:
    mock = McpMock(dict(tools), {k: dict(v) for k, v in (confirm or {}).items()}, token)
    await mock.start()
    try:
        yield mock
    finally:
        await mock.close()


__all__ = ["CONFIRMATION_REQUIRED", "INSTRUCTION", "McpCall", "McpMock", "start_mcp_mock"]
