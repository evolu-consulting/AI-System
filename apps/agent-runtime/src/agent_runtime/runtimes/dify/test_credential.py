"""Q5 · H2a-R17 · `fetch_credential` qua `httpx2.MockTransport` (plan-runtime §3.3, §7)."""

from __future__ import annotations

import httpx2
import pytest

from agent_runtime.runtimes.dify.credential import (
    CredentialError,
    DifyCredential,
    fetch_credential,
    make_hub_client,
)

HUB = "http://127.0.0.1:4000/"
TOKEN = "tok_" + "A" * 39
KEY = "LEAK_KEY_app-secret-123"
OK_BODY = {"base_url": "http://dify.local/v1/", "api_key": KEY, "app_type": "chat"}


def _client(status: int, body: object, seen: list[httpx2.Request]) -> httpx2.AsyncClient:
    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return httpx2.Response(status, json=body)

    return make_hub_client(httpx2.MockTransport(handler))


async def test_q5_credential_ok_request_shape_and_masked_repr() -> None:
    seen: list[httpx2.Request] = []
    async with _client(200, OK_BODY, seen) as client:
        out = await fetch_credential(client, HUB, "job/1", TOKEN)
    assert out == DifyCredential(base_url="http://dify.local/v1", api_key=KEY, app_type="chat")
    (req,) = seen
    assert req.method == "POST"
    assert str(req.url) == "http://127.0.0.1:4000/internal/jobs/job%2F1/dify-credential"
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert req.content == b""
    assert isinstance(out, DifyCredential)
    assert KEY not in repr(out) and KEY not in str(out) and KEY not in f"{out}"
    assert "***" in repr(out)


@pytest.mark.parametrize(
    ("status", "retryable"),
    [(401, False), (409, False), (404, False), (400, False), (500, True), (503, True)],
)
async def test_q5_credential_http_errors(status: int, retryable: bool) -> None:
    seen: list[httpx2.Request] = []
    body = {"code": "NOT_CONFIGURED", "message": "x"}
    async with _client(status, body, seen) as client:
        out = await fetch_credential(client, HUB, "j1", TOKEN)
    assert out == CredentialError(retryable=retryable, http_status=status)


@pytest.mark.parametrize(
    "body",
    [
        {"base_url": "ftp://x", "api_key": KEY, "app_type": "workflow"},
        {"base_url": "http://x", "api_key": KEY, "app_type": "completion"},
        {"base_url": "http://x", "api_key": KEY, "app_type": "workflow", "extra": 1},
        {"base_url": "http://x", "app_type": "workflow"},
        ["not", "object"],
    ],
)
async def test_q5_credential_invalid_body_not_retryable_no_leak(body: object) -> None:
    async with _client(200, body, []) as client:
        out = await fetch_credential(client, HUB, "j1", TOKEN)
    assert out == CredentialError(retryable=False, http_status=200)
    assert KEY not in repr(out)


async def test_q5_credential_non_json_body() -> None:
    def handler(_req: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, content=b"<html>")

    async with make_hub_client(httpx2.MockTransport(handler)) as client:
        out = await fetch_credential(client, HUB, "j1", TOKEN)
    assert out == CredentialError(retryable=False, http_status=200)


@pytest.mark.parametrize(
    "exc",
    [httpx2.ConnectError("refused"), httpx2.ReadTimeout("slow"), httpx2.RemoteProtocolError("x")],
)
async def test_q5_credential_network_error_retryable(exc: Exception) -> None:
    def handler(_req: httpx2.Request) -> httpx2.Response:
        raise exc

    async with make_hub_client(httpx2.MockTransport(handler)) as client:
        out = await fetch_credential(client, HUB, "j1", TOKEN)
    assert out == CredentialError(retryable=True, http_status=None)
    assert TOKEN not in repr(out)


async def test_q5_credential_redirect_not_followed() -> None:
    seen: list[httpx2.Request] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return httpx2.Response(307, headers={"location": "http://evil.example/x"})

    async with make_hub_client(httpx2.MockTransport(handler)) as client:
        out = await fetch_credential(client, HUB, "j1", TOKEN)
    assert out == CredentialError(retryable=False, http_status=307)
    assert len(seen) == 1


async def test_review1_c3_hub_client_ignores_proxy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """C3: client gọi Hub không đọc `HTTP(S)_PROXY` (token job không tới proxy)."""
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.invalid:3128")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    async with make_hub_client() as client:
        assert client.trust_env is False
