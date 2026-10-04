"""WRK-FR-13 · HUB-FR-95 · R6 · `mcp_mock.py` qua HTTP thật (loopback) + client `fake-cli`
(`providers/fake/mcp_call.py`, PY-06). Không cần Postgres/Redis — chạy trong `pytest` mặc định.
"""

from __future__ import annotations

import json
import socket

import httpx2

from agent_runtime.providers.base import Confirm
from agent_runtime.providers.fake.mcp_call import call_tool, list_tools
from tests.support.mcp_mock import CONFIRMATION_REQUIRED, INSTRUCTION, start_mcp_mock

TOOLS = {"check-invoice": "Kiểm tra một hoá đơn điện tử", "create-trello-card": "Tạo thẻ"}
CONFIRM = {"create-trello-card": {"question": 'Tạo thẻ Trello "A"?', "choices": ["Đồng ý", "Huỷ"]}}
AUTH = "Bearer " + "T" * 43


async def test_wrk_fr_13_mock_records_initialize_and_call() -> None:
    async with start_mcp_mock(tools=TOOLS) as m:
        assert m.url.endswith("/mcp")
        got = await call_tool(m.url, AUTH, "check-invoice", {"x": "HD-1", "y": "ghi chú"})
        assert got == 'ok:check-invoice {"x": "HD-1", "y": "ghi chú"}'
        assert [c.method for c in m.calls()] == ["initialize", "tools/call"]
        [call] = m.calls("tools/call")
        assert call.params == {"name": "check-invoice", "arguments": {"x": "HD-1", "y": "ghi chú"}}
        assert call.auth == AUTH


async def test_hub_fr_95_mock_confirmation_shape_and_client_confirm() -> None:
    """R6: `isError` + `content[0]` JSON + `content[1]` câu chỉ dẫn + `structuredContent`; client
    `fake-cli` → `Confirm` đúng question/choices."""
    async with start_mcp_mock(tools=TOOLS, confirm=CONFIRM) as m:
        params: dict[str, object] = {"name": "create-trello-card", "arguments": {}}
        body = {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": params}
        async with httpx2.AsyncClient(trust_env=False) as c:
            raw = (await c.post(m.url, json=body)).json()
        result = raw["result"]
        assert raw["id"] == 7 and result["isError"] is True
        first = json.loads(result["content"][0]["text"])
        assert first == {"code": CONFIRMATION_REQUIRED, **CONFIRM["create-trello-card"]}
        assert result["content"][1]["text"] == INSTRUCTION
        assert result["structuredContent"] == first
        got = await call_tool(m.url, AUTH, "create-trello-card", {"title": "A"})
        assert got == Confirm(question='Tạo thẻ Trello "A"?', choices=("Đồng ý", "Huỷ"))


async def test_wrk_fr_13_client_error_texts() -> None:
    """§6: Unknown tool → `tool_unknown`; 401 → `mcp_unauthorized`; không tới → `mcp_unreachable`;
    GET → 405; notification → 202."""
    async with start_mcp_mock(tools=TOOLS, token="T" * 43) as m:
        assert await call_tool(m.url, AUTH, "khac-tool", {}) == "tool_unknown"
        assert await call_tool(m.url, "Bearer sai", "check-invoice", {}) == "mcp_unauthorized"
        assert (
            await list_tools(m.url, AUTH)
            == "check-invoice,create-trello-card | " + (TOOLS["check-invoice"])
        )
        async with httpx2.AsyncClient(trust_env=False) as c:
            assert (await c.get(m.url)).status_code == 405
            note = {"jsonrpc": "2.0", "method": "notifications/initialized"}
            resp = await c.post(m.url, json=note, headers={"Authorization": AUTH})
            assert resp.status_code == 202
        assert m.calls("notifications/initialized")[0].auth == AUTH
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    closed = f"http://127.0.0.1:{port}/mcp"
    assert await call_tool(closed, AUTH, "check-invoice", {}) == "mcp_unreachable"
    assert await list_tools(closed, AUTH) == "mcp_unreachable"
