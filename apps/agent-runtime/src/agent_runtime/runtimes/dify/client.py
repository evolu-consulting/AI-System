"""WRK-FR-06 · H2a-R17 · `DifyClient`: gọi Dify streaming (SSE) + stop (plan-runtime-dify §3.2).

- `run_stream(cred, req)`: `POST {base_url}/workflows/run` (workflow) hoặc `/chat-messages`
  (chat/agent), `response_mode=streaming`, `Authorization: Bearer <api_key>`; trả từng
  `DifyEvent(event, data)` cho `stream.reduce` (tên sự kiện lấy từ `data.event`, thiếu thì từ dòng
  `event:` SSE — `ping` không có data). HTTP ≠ 2xx → `DifyHTTPError` (thân đã `mask`, ≤ 300 ký tự).
- `stop(cred, task_id, user)`: best-effort, timeout `AGENT_RT_DIFY_STOP_TIMEOUT_S`, không ném lỗi.
- `classify(exc)` → (`ErrKind`, http_status) cho `policy.retry_delay`/`map_failure`.
Timeout: connect 10 s, read `AGENT_RT_DIFY_READ_TIMEOUT_S` (Dify gửi `ping` ~10 s); hạn tổng do
host bọc `asyncio.timeout`. Không log URL/header/thân (logger httpx2 ở `WARNING`, `log.py`).
"""

import json
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from types import TracebackType
from typing import Any, Self, cast

import httpx2

from agent_runtime.runtimes.dify.credential import DifyCredential
from agent_runtime.runtimes.dify.policy import DETAIL_MAX, ErrKind, mask
from agent_runtime.runtimes.hub_http import NO_PROXY_MOUNTS

CONNECT_TIMEOUT_S = 10.0
_ERROR_BODY_READ = 4096


@dataclass(frozen=True)
class DifyRequest:
    """`inputs`/`query` Hub đã map + validate (R05, R06) — gửi nguyên văn. `user` = `dify_user`."""

    inputs: Mapping[str, Any]
    user: str
    query: str | None = None


@dataclass(frozen=True)
class DifyEvent:
    event: str
    data: Mapping[str, Any] = field(default_factory=dict[str, Any])


class DifyHTTPError(Exception):
    """Dify trả HTTP ≠ 2xx. `detail` đã che key và cắt ≤ 300 ký tự (chỉ để log)."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"Dify HTTP {status}")
        self.status = status
        self.detail = detail


class DifyStreamError(Exception):
    """Phản hồi 2xx nhưng không phải `text/event-stream` / SSE hỏng."""


def _endpoint(cred: DifyCredential) -> str:
    path = "/workflows/run" if cred.app_type == "workflow" else "/chat-messages"
    return cred.base_url.rstrip("/") + path


def _stop_endpoint(cred: DifyCredential, task_id: str) -> str:
    base = cred.base_url.rstrip("/")
    if cred.app_type == "workflow":
        return f"{base}/workflows/tasks/{task_id}/stop"
    return f"{base}/chat-messages/{task_id}/stop"


def request_body(cred: DifyCredential, req: DifyRequest) -> dict[str, Any]:
    """Body theo `-dify` §3.2 (workflow: không `query`; chat/agent: `conversation_id` rỗng)."""
    body: dict[str, Any] = {"inputs": dict(req.inputs), "response_mode": "streaming"}
    if cred.app_type != "workflow":
        body["query"] = req.query or ""
        body["conversation_id"] = ""
    body["user"] = req.user
    return body


def _auth(cred: DifyCredential) -> dict[str, str]:
    return {"Authorization": f"Bearer {cred.api_key}"}


def to_event(sse: httpx2.ServerSentEvent) -> DifyEvent:
    """Dify thật: `data: {json có "event"}`; mock: thêm dòng `event:`; `ping` không data."""
    data: Mapping[str, Any] = {}
    if sse.data:
        try:
            parsed = json.loads(sse.data)
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            data = cast("dict[str, Any]", parsed)
    name = data.get("event")
    return DifyEvent(event=name if isinstance(name, str) and name else sse.event, data=data)


def classify(exc: BaseException) -> tuple[ErrKind, int | None]:
    """Ánh xạ exception của `run_stream` → `ErrKind` (`plan-runtime` §3.1)."""
    if isinstance(exc, DifyHTTPError):
        return ("http_5xx" if exc.status >= 500 else "http_4xx"), exc.status
    if isinstance(exc, httpx2.ConnectError | httpx2.ConnectTimeout | httpx2.PoolTimeout):
        return "connect", None  # request chưa gửi
    if isinstance(exc, DifyStreamError | httpx2.SSEError):
        return "sse_error", None  # trả lời sai giao thức: không retry
    return "read", None  # ReadError/ReadTimeout/RemoteProtocolError/Write*/lỗi mạng khác


class DifyClient:
    """Một `AsyncClient` cho **một lần claim** job `workflow.async` (mở trong `DifyRun.execute`,
    đóng khi job xong; `stop` ngoài vòng thử mở client ngắn riêng) — không chia sẻ giữa job.

    Proxy (review 1 C3): giữ `trust_env` mặc định — Dify có thể là dịch vụ ngoài (cloud) cần proxy
    ra Internet của máy chủ; loopback luôn bỏ proxy (`NO_PROXY_MOUNTS`), host nội bộ khác dùng
    `NO_PROXY` của môi trường."""

    def __init__(
        self,
        read_timeout_s: float = 30.0,
        stop_timeout_s: float = 2.0,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._stop_timeout = httpx2.Timeout(stop_timeout_s)
        self._http = httpx2.AsyncClient(
            timeout=httpx2.Timeout(read_timeout_s, connect=CONNECT_TIMEOUT_S),
            follow_redirects=False,
            mounts=NO_PROXY_MOUNTS,
            transport=transport,
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        _et: type[BaseException] | None,
        _e: BaseException | None,
        _tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def run_stream(self, cred: DifyCredential, req: DifyRequest) -> AsyncIterator[DifyEvent]:
        """Sinh sự kiện tới khi server đóng stream. Huỷ task → đóng response (không gọi stop)."""
        headers = {**_auth(cred), "Accept": "text/event-stream"}
        body = request_body(cred, req)
        async with self._http.stream("POST", _endpoint(cred), json=body, headers=headers) as resp:
            if not resp.is_success:
                raise DifyHTTPError(resp.status_code, await _error_detail(resp, cred.api_key))
            ctype = resp.headers.get("content-type", "").partition(";")[0].strip().lower()
            if ctype != "text/event-stream":
                raise DifyStreamError(f"content-type {ctype or '-'}")
            async for sse in httpx2.EventSource(resp):
                yield to_event(sse)

    async def stop(self, cred: DifyCredential, task_id: str, user: str) -> bool:
        """Best-effort; True khi Dify trả 2xx. Lỗi/timeout → False (host bỏ qua)."""
        try:
            resp = await self._http.post(
                _stop_endpoint(cred, task_id),
                json={"user": user},
                headers=_auth(cred),
                timeout=self._stop_timeout,
            )
        except httpx2.HTTPError:
            return False
        return resp.is_success


async def _error_detail(resp: httpx2.Response, api_key: str) -> str:
    raw = b""
    try:
        async for chunk in resp.aiter_bytes():
            raw += chunk
            if len(raw) >= _ERROR_BODY_READ:
                break
    except httpx2.HTTPError:
        pass
    return mask(raw[:_ERROR_BODY_READ].decode("utf-8", "replace"), api_key, DETAIL_MAX)
