"""WRK-FR-06 · H2a-R17 · `DifyClient` qua `httpx2.MockTransport` (plan-runtime-dify §3.2)."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx2
import pytest

from agent_runtime.runtimes.dify.client import (
    DifyClient,
    DifyEvent,
    DifyHTTPError,
    DifyRequest,
    DifyStreamError,
    classify,
)
from agent_runtime.runtimes.dify.credential import DifyCredential

KEY = "LEAK_KEY_dify-app-0123456789"
WF = DifyCredential(base_url="http://dify.local/v1", api_key=KEY, app_type="workflow")
CHAT = DifyCredential(base_url="http://dify.local/v1/", api_key=KEY, app_type="agent")
REQ = DifyRequest(inputs={"source_text": "xin chào"}, user="acme:u1", query="hỏi gì?")
SSE_BODY = (
    b"event: ping\n\n"
    b'data: {"event":"workflow_started","task_id":"t1"}\n\n'
    b'event: text_chunk\ndata: {"event":"text_chunk","data":{"text":"Xin "}}\n\n'
    b"data: not-json\n\n"
    b'data: {"event":"workflow_finished","data":{"status":"succeeded"}}\n\n'
)
Handler = Callable[[httpx2.Request], httpx2.Response]


def _sse(body: bytes = SSE_BODY, ctype: str = "text/event-stream; charset=utf-8") -> Handler:
    def handler(_req: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, content=body, headers={"content-type": ctype})

    return handler


def _recording(seen: list[httpx2.Request], inner: Handler) -> Handler:
    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return inner(req)

    return handler


async def _collect(client: DifyClient, cred: DifyCredential) -> list[DifyEvent]:
    return [e async for e in client.run_stream(cred, REQ)]


async def test_wrk_fr_06_workflow_stream_request_and_events() -> None:
    seen: list[httpx2.Request] = []
    async with DifyClient(transport=httpx2.MockTransport(_recording(seen, _sse()))) as client:
        evs = await _collect(client, WF)
    (req,) = seen
    assert (req.method, str(req.url)) == ("POST", "http://dify.local/v1/workflows/run")
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert json.loads(req.content) == {
        "inputs": {"source_text": "xin chào"},
        "response_mode": "streaming",
        "user": "acme:u1",
    }
    assert [e.event for e in evs] == [
        "ping",
        "workflow_started",
        "text_chunk",
        "message",
        "workflow_finished",
    ]
    assert evs[0].data == {} and evs[3].data == {}
    assert evs[1].data["task_id"] == "t1"
    assert evs[2].data["data"] == {"text": "Xin "}


async def test_wrk_fr_06_chat_agent_body() -> None:
    seen: list[httpx2.Request] = []
    async with DifyClient(transport=httpx2.MockTransport(_recording(seen, _sse()))) as client:
        await _collect(client, CHAT)
    assert str(seen[0].url) == "http://dify.local/v1/chat-messages"
    assert json.loads(seen[0].content) == {
        "inputs": {"source_text": "xin chào"},
        "response_mode": "streaming",
        "query": "hỏi gì?",
        "conversation_id": "",
        "user": "acme:u1",
    }


@pytest.mark.parametrize(
    ("status", "kind"), [(503, "http_5xx"), (500, "http_5xx"), (429, "http_4xx")]
)
async def test_wrk_fr_06_http_error_classified(status: int, kind: str) -> None:
    def handler(_req: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(status, json={"code": "x", "message": f"bad key {KEY}"})

    async with DifyClient(transport=httpx2.MockTransport(handler)) as client:
        with pytest.raises(DifyHTTPError) as info:
            await _collect(client, WF)
    assert classify(info.value) == (kind, status)
    assert KEY not in info.value.detail and "***" in info.value.detail
    assert KEY not in str(info.value)


async def test_h2a_r17_error_detail_truncated() -> None:
    def handler(_req: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(400, content=(KEY + "x" * 5000).encode())

    async with DifyClient(transport=httpx2.MockTransport(handler)) as client:
        with pytest.raises(DifyHTTPError) as info:
            await _collect(client, WF)
    assert len(info.value.detail) <= 300
    assert info.value.detail.startswith("***")


async def test_wrk_fr_06_wrong_content_type_is_sse_error() -> None:
    handler = _sse(b'{"answer":"blocking"}', "application/json")
    async with DifyClient(transport=httpx2.MockTransport(handler)) as client:
        with pytest.raises(DifyStreamError) as info:
            await _collect(client, WF)
    assert classify(info.value) == ("sse_error", None)


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (httpx2.ConnectError("refused"), "connect"),
        (httpx2.ConnectTimeout("t"), "connect"),
        (httpx2.PoolTimeout("t"), "connect"),
        (httpx2.ReadTimeout("t"), "read"),
        (httpx2.ReadError("t"), "read"),
        (httpx2.RemoteProtocolError("t"), "read"),
        (httpx2.WriteError("t"), "read"),
    ],
)
async def test_wrk_fr_06_transport_errors_classified(exc: Exception, kind: str) -> None:
    def handler(_req: httpx2.Request) -> httpx2.Response:
        raise exc

    async with DifyClient(transport=httpx2.MockTransport(handler)) as client:
        with pytest.raises(httpx2.HTTPError) as info:
            await _collect(client, WF)
    assert classify(info.value) == (kind, None)


@pytest.mark.parametrize(
    ("cred", "url"),
    [
        (WF, "http://dify.local/v1/workflows/tasks/task-9/stop"),
        (CHAT, "http://dify.local/v1/chat-messages/task-9/stop"),
    ],
)
async def test_wrk_fr_06_stop_best_effort(cred: DifyCredential, url: str) -> None:
    seen: list[httpx2.Request] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return httpx2.Response(200, json={"result": "success"})

    async with DifyClient(transport=httpx2.MockTransport(handler)) as client:
        assert await client.stop(cred, "task-9", "acme:u1") is True
    assert str(seen[0].url) == url
    assert json.loads(seen[0].content) == {"user": "acme:u1"}
    assert seen[0].headers["authorization"] == f"Bearer {KEY}"


@pytest.mark.parametrize(
    "outcome", [httpx2.Response(404, json={}), httpx2.ReadTimeout("stop chậm")]
)
async def test_wrk_fr_06_stop_failure_returns_false(outcome: Any) -> None:
    def handler(_req: httpx2.Request) -> httpx2.Response:
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async with DifyClient(transport=httpx2.MockTransport(handler)) as client:
        assert await client.stop(WF, "t", "u") is False
