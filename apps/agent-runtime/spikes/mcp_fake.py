# spike — không thuộc package
"""PY-S1 — server MCP giả (stdlib) cho `mcp_spike.py`: JSON-RPC thường, không SSE, `GET` → 405,
không `Mcp-Session-Id`; mode `ok` (lùi `initialize`), `discover` (2026-07-28), `401`.
Ghi mọi request.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

TOKEN = secrets.token_urlsafe(32)
SLOW_S = 15

CONFIRM = {
    "code": "CONFIRMATION_REQUIRED",
    "question": "Gửi email tới boss@example.com?",
    "choices": ["Gửi", "Huỷ"],
}


def _schema(**props: str) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {k: {"type": t} for k, t in props.items()},
        "required": list(props),
    }


TOOLS = [
    {
        "name": "translate-en",
        "description": "Dịch sang tiếng Anh",
        "inputSchema": _schema(text="string"),
    },
    {
        "name": "secret-tool",
        "description": "Tool không được cấp",
        "inputSchema": _schema(x="integer"),
    },
    {"name": "hook-deny", "description": "Tool bị hook chặn", "inputSchema": _schema(y="integer")},
    {"name": "confirm-send", "description": "Gửi email", "inputSchema": _schema(to="string")},
    {"name": "slow-tool", "description": "Tool chậm", "inputSchema": _schema(n="integer")},
]


# ---------- server MCP giả ----------
class FakeMcp(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, mode: str = "ok") -> None:
        super().__init__(("127.0.0.1", 0), Handler)
        self.mode = mode
        self.log: list[dict[str, Any]] = []

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/mcp"


def _call_result(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name == "confirm-send":
        sc = CONFIRM | {"marker": "SC-ONLY-4711"}  # marker chỉ có ở structuredContent
        return {
            "isError": True,
            "content": [
                {"type": "text", "text": json.dumps(CONFIRM, ensure_ascii=False)},
                {"type": "text", "text": "Cần người dùng xác nhận trước khi gửi. Dừng lại."},
            ],
            "structuredContent": sc,
        }
    if name == "slow-tool":
        time.sleep(SLOW_S)
    text = f"EN: {args.get('text')}" if name == "translate-en" else f"{name}-REACHED {args}"
    return {"content": [{"type": "text", "text": text}], "isError": False}


def _rpc(req: dict[str, Any], mode: str) -> dict[str, Any] | None:
    method, params = req.get("method"), req.get("params") or {}
    result: dict[str, Any]
    if "id" not in req:
        return None  # notification → 202
    if method == "server/discover" and mode == "discover":
        result = {  # như plan.md §6: thân `initialize` + `supportedVersions`
            "protocolVersion": "2026-07-28",
            "supportedVersions": ["2025-06-18", "2025-11-25", "2026-07-28"],
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "hub-fake", "version": "0"},
        }
    elif method == "initialize":
        result = {
            "protocolVersion": params.get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "hub-fake", "version": "0"},
        }
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        result = _call_result(params.get("name", ""), params.get("arguments") or {})
    else:
        return {"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": method}}
    if mode == "discover":  # 2026-07-28: mọi result PHẢI có `resultType` (CLI 2.1.286)
        result["resultType"] = "complete"
        if method == "tools/list":  # + cache hint bắt buộc
            result |= {"ttlMs": 0, "cacheScope": "private"}
    return {"jsonrpc": "2.0", "id": req["id"], "result": result}


class Handler(BaseHTTPRequestHandler):
    server: FakeMcp

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 — chữ ký stdlib
        return

    def _record(self, body: Any) -> None:
        auth = self.headers.get("Authorization")
        self.server.log.append(
            {
                "t": round(time.time(), 2),
                "verb": self.command,
                "auth": "ok"
                if auth == f"Bearer {TOKEN}"
                else ("none" if auth is None else "wrong"),
                "headers": {k: v for k, v in self.headers.items() if k.lower() != "authorization"},
                "body": body,
            }
        )

    def _send(self, code: int, obj: Any = None) -> None:
        data = b"" if obj is None else json.dumps(obj).encode()
        self.send_response(code)
        if obj is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._record(None)
        self._send(405)

    def do_DELETE(self) -> None:
        self._record(None)
        self._send(405)

    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        req = json.loads(raw or b"{}")
        self._record(req)
        if self.server.mode == "401":
            self._send(401, {"error": "unauthorized"})
            return
        resp = _rpc(req, self.server.mode)
        self._send(202 if resp is None else 200, resp)


def start_server(mode: str = "ok") -> FakeMcp:
    srv = FakeMcp(mode)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
