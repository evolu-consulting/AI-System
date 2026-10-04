"""RT9 · Q5 · `dify_mock.py` qua HTTP thật (loopback) + `DifyClient`/`fetch_credential` (PY-02).

Không cần Postgres/Redis — chạy trong `pytest` mặc định.
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request
from typing import Any

import pytest

from agent_runtime.runtimes.dify.client import DifyClient, DifyEvent, DifyHTTPError, DifyRequest
from agent_runtime.runtimes.dify.credential import (
    AppType,
    CredentialError,
    DifyCredential,
    fetch_credential,
    make_hub_client,
)
from agent_runtime.runtimes.dify.stream import Failed, Finished, StreamState, final_text, reduce
from tests.support.dify_mock import (
    CHUNKS,
    CredentialSpec,
    DifyMock,
    dify_mock_thread,
    scenario_of,
    start_dify_mock,
)

REQ = DifyRequest(inputs={"q": "x"}, user="acme:u1", query="hỏi")
TOKEN = "T" * 43


def _cred(m: DifyMock, key: str, app_type: AppType = "workflow") -> DifyCredential:
    return DifyCredential(base_url=m.base_url, api_key=key, app_type=app_type)


async def _run(m: DifyMock, key: str, app_type: AppType = "workflow") -> tuple[StreamState, object]:
    state = StreamState(app_type=app_type)
    step: object = None
    async with DifyClient() as client:
        async for ev in client.run_stream(_cred(m, key, app_type), REQ):
            state, s = reduce(state, ev.event, ev.data)
            step = s if s is not None else step
    return state, step


def test_rt9_scenario_names_match_ts() -> None:
    assert scenario_of("mk-401").kind == "http" and scenario_of("mk-401").status == 401
    assert scenario_of("mk-503x2").times == 2
    assert scenario_of("mk-slow-50").ms == 50
    assert scenario_of("LEAK_KEY_abc").kind == "ok"
    assert scenario_of("mk-nope").kind == "ok"
    assert scenario_of("mk-error-event").kind == "error-event"


@pytest.mark.parametrize(
    ("key", "app_type", "text", "step"),
    [
        ("mk-ok", "workflow", "".join(CHUNKS), Finished),
        ("LEAK_KEY_x", "chat", "".join(CHUNKS), Finished),
        ("mk-agent", "agent", "".join(CHUNKS), Finished),
        ("mk-failed", "workflow", CHUNKS[0], Failed),
        ("mk-error-event", "chat", "".join(CHUNKS[:2]), Failed),
    ],
)
async def test_rt9_stream_scenarios(key: str, app_type: AppType, text: str, step: type) -> None:
    async with start_dify_mock() as m:
        state, last = await _run(m, key, app_type)
        (call,) = m.calls("/v1/")
    assert state.text == text and isinstance(last, step)
    assert state.task_id == "task-1" and state.first_seen
    path = "/v1/workflows/run" if app_type == "workflow" else "/v1/chat-messages"
    assert (call.path, call.auth, call.body["user"]) == (path, f"Bearer {key}", "acme:u1")
    if key == "mk-agent":
        assert state.nodes == 1


async def test_rt9_outputs_and_empty() -> None:
    async with start_dify_mock() as m:
        state, _ = await _run(m, "mk-outputs")
        assert final_text(state.text, state.outputs, None) == "".join(CHUNKS)
        state, _ = await _run(m, "mk-empty")
        assert final_text(state.text, state.outputs, None) is None
        assert state.usage is not None and state.usage["total_tokens"] == 20


@pytest.mark.parametrize(("key", "status"), [("mk-401", 401), ("mk-404", 404), ("mk-400", 400)])
async def test_rt9_http_errors(key: str, status: int) -> None:
    async with start_dify_mock() as m, DifyClient() as client:
        with pytest.raises(DifyHTTPError) as info:
            [e async for e in client.run_stream(_cred(m, key), REQ)]
    assert info.value.status == status


async def test_rt9_flaky_503_counts_per_key() -> None:
    async with start_dify_mock() as m, DifyClient() as client:
        for _ in range(2):
            with pytest.raises(DifyHTTPError) as info:
                [e async for e in client.run_stream(_cred(m, "mk-503x2"), REQ)]
            assert info.value.status == 503
        evs = [e async for e in client.run_stream(_cred(m, "mk-503x2"), REQ)]
        assert evs[-1].event == "workflow_finished"
        assert len(m.calls("/v1/workflows/run")) == 3
        m.reset()
        with pytest.raises(DifyHTTPError):
            [e async for e in client.run_stream(_cred(m, "mk-503x2"), REQ)]


async def test_rt9_slow_then_stop() -> None:
    async with start_dify_mock() as m, DifyClient() as client:
        cred = _cred(m, "mk-slow-100")
        seen: list[DifyEvent] = []
        async for ev in client.run_stream(cred, REQ):
            seen.append(ev)
            if ev.event == "text_chunk":
                assert await client.stop(cred, "task-1", "acme:u1") is True
        assert "task-1" in m.stopped
        assert seen[-1].data["data"]["status"] == "stopped"
        assert sum(e.event == "text_chunk" for e in seen) < len(CHUNKS)
        assert m.calls("/v1/workflows/tasks/task-1/stop")[0].body == {"user": "acme:u1"}


async def test_rt9_client_disconnect_marks_stopped() -> None:
    async with start_dify_mock() as m, DifyClient() as client:
        async for ev in client.run_stream(_cred(m, "mk-slow-50", "chat"), REQ):
            if ev.event == "message":
                break
        for _ in range(50):
            if "task-1" in m.stopped:
                break
            await asyncio.sleep(0.05)
        assert "task-1" in m.stopped


def test_rt9_blocking_rejected_unless_allowed() -> None:
    def post(m: DifyMock) -> tuple[int, Any]:
        data = json.dumps({"inputs": {}, "response_mode": "blocking", "user": "u"}).encode()
        req = urllib.request.Request(
            f"{m.base_url}/workflows/run", data, {"Authorization": "Bearer mk-ok"}
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    with dify_mock_thread() as m:
        status, body = post(m)
        assert (status, body["code"]) == (400, "invalid_param")
    with dify_mock_thread(allow_blocking=True) as m:
        status, body = post(m)
        assert status == 200 and body["data"]["outputs"] == {"text": "".join(CHUNKS)}
        with urllib.request.urlopen(f"{m.url}/__mock/requests", timeout=5) as resp:  # noqa: S310
            assert len(json.loads(resp.read())["requests"]) == 1


async def test_q5_credential_endpoint_registry() -> None:
    spec = CredentialSpec(api_key="LEAK_KEY_1", app_type="chat", token=TOKEN, fail_5xx=1)
    async with start_dify_mock() as m, make_hub_client() as hub:
        m.set_credential("job-1", spec)
        assert await fetch_credential(hub, m.hub_url, "job-1", TOKEN) == CredentialError(True, 503)
        out = await fetch_credential(hub, m.hub_url, "job-1", TOKEN)
        assert out == DifyCredential(base_url=m.base_url, api_key="LEAK_KEY_1", app_type="chat")
        assert await fetch_credential(hub, m.hub_url, "job-1", "sai") == CredentialError(False, 401)
        assert await fetch_credential(hub, m.hub_url, "job-2", TOKEN) == CredentialError(False, 401)
        m.set_credential("job-3", CredentialSpec(status=409, token=TOKEN))
        assert await fetch_credential(hub, m.hub_url, "job-3", TOKEN) == CredentialError(False, 409)
        calls = m.calls("/internal/jobs/")
        assert len(calls) == 5 and calls[0].auth == f"Bearer {TOKEN}"


async def test_q5_credential_verify_token_hook() -> None:
    seen: list[tuple[str, bytes]] = []

    async def verify(job_id: str, digest: bytes) -> bool:
        seen.append((job_id, digest))
        return job_id == "ok"

    started = time.monotonic()
    async with (
        start_dify_mock(default_credential=CredentialSpec(), verify_token=verify) as m,
        make_hub_client() as hub,
    ):
        out = await fetch_credential(hub, m.hub_url, "ok", TOKEN)
        assert isinstance(out, DifyCredential) and out.api_key == "mk-ok"
        assert await fetch_credential(hub, m.hub_url, "x", TOKEN) == CredentialError(False, 401)
    assert len(seen[0][1]) == 32 and time.monotonic() - started < 5
