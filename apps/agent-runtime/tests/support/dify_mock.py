"""H2a plan-runtime §7 · RT9 · Mock Dify + endpoint credential Hub (asyncio stdlib, không thư viện).

Bản Python của `tools/hub-dev/src/dify-mock.ts` (cùng tên kịch bản, cùng hình sự kiện). Không thay
mock Hub (Q9). Kịch bản chọn theo app-key (`Authorization: Bearer <key>`) gửi tới Dify:

| Key | Hành vi |
|---|---|
| `mk-ok` / key lạ / `LEAK_KEY_*` | `ping` → 5 chunk → `workflow_finished` / `message_end` |
| `mk-outputs` | chỉ `workflow_finished` (`outputs.text`), không chunk |
| `mk-empty` | `workflow_finished` `outputs: {}` (chat: `message_end` không answer) |
| `mk-failed` | 1 chunk → `workflow_finished{status:"failed", error}` |
| `mk-error-event` | 2 chunk → sự kiện `error` (500 `mock_error`) |
| `mk-401` · `mk-404` · `mk-400` | HTTP lỗi JSON `{code, message, status}` |
| `mk-503x<n>` | n lời gọi đầu (đếm theo key) → 503 `service_unavailable`, sau đó như `mk-ok` |
| `mk-slow-<ms>` | chunk cách `<ms>`; bị stop / client ngắt → dừng, kết `status:"stopped"` |
| `mk-agent` | `agent_thought` → `agent_message` ×5 → `message_end` |

Đường dẫn Dify dưới `/v1` (`DifyMock.base_url`): `POST /workflows/run` (workflow) ·
`POST /chat-messages` (chat, agent; sự kiện `message` hoặc `agent_message`) · stop
`POST /workflows/tasks/{task}/stop`, `POST /chat-messages/{task}/stop` → `{result:"success"}` ·
`GET /parameters`. `response_mode ≠ streaming` → 400 `invalid_param` (trừ `allow_blocking=True`).
Mỗi lời gọi chạy có id `task-<n>`, `run-<n>`, `msg-<n>`, `conv-<n>` (n tăng từ 1, `reset()` về 0).

Credential Hub (Q5) ở gốc (`DifyMock.hub_url` = giá trị `AGENT_RT_HUB_URL`):
`POST /internal/jobs/{job_id}/dify-credential`, `Bearer <token job>`. Thứ tự: thiếu Bearer → 401 ·
xác thực (`verify_token(job_id, sha256(token))` nếu truyền — qc so `hub.jobs.token_hash`; không thì
so `CredentialSpec.token`) sai → 401 · `fail_5xx` lần đầu → 503 · `status` ≠ 200 → mã đó (409 →
`{code:"NOT_CONFIGURED"}`) · 200 → `{base_url, api_key, app_type}` + `Cache-Control: no-store`.
Spec lấy theo `set_credential(job_id, …)`, không có thì `default_credential`, không có nữa → 401.

Ghi lại mọi request (`calls()` / `GET /__mock/requests`): path, header `Authorization`, body JSON.
Dùng: `async with start_dify_mock() as m:` (cùng event loop test) hoặc `with dify_mock_thread() as
m:` (loop riêng trong thread, khi test chặn đồng bộ; `verify_token` khi đó chạy trên loop thread).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import threading
import time
from collections.abc import AsyncGenerator, Awaitable, Callable, Generator
from contextlib import asynccontextmanager, contextmanager, suppress
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, cast

Json = dict[str, Any]
TokenVerifier = Callable[[str, bytes], Awaitable[bool]]

USAGE: Json = {
    "prompt_tokens": 12,
    "completion_tokens": 8,
    "total_tokens": 20,
    "total_price": "0.0001",
    "currency": "USD",
}
CHUNKS = ("Xin ", "chào, ", "đây ", "là ", "mock.")
HTTP_KEYS: dict[str, tuple[int, str]] = {
    "mk-401": (401, "unauthorized"),
    "mk-404": (404, "not_found"),
    "mk-400": (400, "invalid_param"),
}
SIMPLE = frozenset({"ok", "outputs", "empty", "failed", "error-event", "agent"})
_FLAKY = re.compile(r"^mk-503x(\d+)$")
_SLOW = re.compile(r"^mk-slow-(\d+)$")
_STOP = re.compile(r"^/v1/(?:workflows/tasks|chat-messages)/([^/]+)/stop$")
_CRED = re.compile(r"^/internal/jobs/([^/]+)/dify-credential$")
_BEARER = re.compile(r"^Bearer\s+", re.IGNORECASE)


@dataclass(frozen=True)
class Scenario:
    kind: str  # SIMPLE | "http" | "flaky" | "slow"
    status: int = 0
    code: str = ""
    times: int = 0
    ms: int = 0


def scenario_of(key: str) -> Scenario:
    """= `scenarioOf` TS."""
    if key in HTTP_KEYS:
        status, code = HTTP_KEYS[key]
        return Scenario("http", status=status, code=code)
    if m := _FLAKY.match(key):
        return Scenario("flaky", times=int(m.group(1)))
    if m := _SLOW.match(key):
        return Scenario("slow", ms=int(m.group(1)))
    name = key[3:] if key.startswith("mk-") else "ok"
    return Scenario(name if name in SIMPLE else "ok")


@dataclass(frozen=True)
class MockCall:
    path: str
    auth: str
    body: Json
    at: float


@dataclass(frozen=True)
class CredentialSpec:
    """Trả lời credential của một job. `token` None ⇒ chỉ hợp lệ khi có `verify_token`."""

    api_key: str = "mk-ok"
    app_type: str = "workflow"
    status: int = 200
    fail_5xx: int = 0
    base_url: str | None = None  # None = `DifyMock.base_url`
    token: str | None = None


def token_hash(token: str) -> bytes:
    """= `hashJobToken` TS / `plan-runtime` §3.3: sha256(ascii) 32 byte."""
    return hashlib.sha256(token.encode("ascii")).digest()


@dataclass
class _Ctx:
    chat: bool
    n: int
    stopped: set[str]

    @property
    def task(self) -> str:
        return f"task-{self.n}"

    def base(self) -> Json:
        n = self.n
        return {
            "task_id": f"task-{n}",
            "workflow_run_id": f"run-{n}",
            "message_id": f"msg-{n}",
            "conversation_id": f"conv-{n}",
        }


def _chunks(c: _Ctx, chat_event: str = "message") -> list[Json]:
    if c.chat:
        return [{**c.base(), "event": chat_event, "answer": t} for t in CHUNKS]
    return [{**c.base(), "event": "text_chunk", "data": {"text": t}} for t in CHUNKS]


def _finish(c: _Ctx, status: str, extra: Json | None = None) -> list[Json]:
    if c.chat:
        return [{**c.base(), "event": "message_end", "metadata": {"usage": USAGE}}]
    outputs: Json = {"text": "".join(CHUNKS)} if status == "succeeded" else {}
    data: Json = {
        "status": status,
        "outputs": outputs,
        "total_tokens": USAGE["total_tokens"],
        "metadata": {"usage": USAGE},
    }
    return [{**c.base(), "event": "workflow_finished", "data": {**data, **(extra or {})}}]


def events(s: Scenario, c: _Ctx) -> list[Json]:
    """Dãy sự kiện cho kịch bản không chậm (= `events` TS)."""
    if s.kind == "outputs":
        return _finish(c, "succeeded")
    if s.kind == "empty":
        return _finish(c, "succeeded", {"outputs": {}})
    if s.kind == "failed":
        return [*_chunks(c)[:1], *_finish(c, "failed", {"error": "mock failed"})]
    if s.kind == "error-event":
        err = {**c.base(), "event": "error", "status": 500, "code": "mock_error", "message": "mock"}
        return [*_chunks(c)[:2], err]
    if s.kind == "agent":
        th = {**c.base(), "event": "agent_thought", "id": "th1", "thought": "dang nghi"}
        return [{**th, "position": 1}, *_chunks(c, "agent_message"), *_finish(c, "succeeded")]
    return [*_chunks(c), *_finish(c, "succeeded")]


def _sse(e: Json) -> bytes:
    return f"event: {e['event']}\ndata: {json.dumps(e, ensure_ascii=False)}\n\n".encode()


_PING = b"event: ping\n\n"


@dataclass
class _Req:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes


async def _read_request(reader: asyncio.StreamReader) -> _Req | None:
    line = await reader.readline()
    parts = line.decode("latin-1").split()
    if len(parts) < 2:
        return None
    headers: dict[str, str] = {}
    while (h := await reader.readline()) not in (b"\r\n", b"\n", b""):
        name, _, value = h.decode("latin-1").partition(":")
        headers[name.strip().lower()] = value.strip()
    size = int(headers.get("content-length", "0") or 0)
    body = await reader.readexactly(size) if size else b""
    return _Req(parts[0].upper(), parts[1].split("?", 1)[0], headers, body)


def _head(status: int, headers: dict[str, str]) -> bytes:
    lines = [f"HTTP/1.1 {status} {HTTPStatus(status).phrase}"]
    lines += [f"{k}: {v}" for k, v in {**headers, "Connection": "close"}.items()]
    return ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")


async def _send_json(
    w: asyncio.StreamWriter, status: int, body: Json, extra: Json | None = None
) -> None:
    raw = json.dumps(body, ensure_ascii=False).encode()
    hdr = {"Content-Type": "application/json", "Content-Length": str(len(raw)), **(extra or {})}
    w.write(_head(status, hdr) + raw)
    await w.drain()


def _err(status: int, code: str) -> tuple[int, Json]:
    return status, {"code": code, "message": f"mock {code}", "status": status}


class DifyMock:
    """Server mock; tạo qua `start_dify_mock()` / `dify_mock_thread()`."""

    def __init__(
        self,
        *,
        allow_blocking: bool = False,
        default_credential: CredentialSpec | None = None,
        verify_token: TokenVerifier | None = None,
    ) -> None:
        self.allow_blocking = allow_blocking
        self.default_credential = default_credential
        self.verify_token = verify_token
        self.url = ""
        self.stopped: set[str] = set()
        self._log: list[MockCall] = []
        self._flaky: dict[str, int] = {}
        self._cred_fails: dict[str, int] = {}
        self._creds: dict[str, CredentialSpec] = {}
        self._seq = 0
        self._server: asyncio.Server | None = None

    @property
    def base_url(self) -> str:
        """`base_url` Dify (credential trả về giá trị này khi `CredentialSpec.base_url` None)."""
        return f"{self.url}/v1"

    @property
    def hub_url(self) -> str:
        """Giá trị `AGENT_RT_HUB_URL` trỏ vào endpoint credential giả."""
        return self.url

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> None:
        self._server = await asyncio.start_server(self._handle, host, port)
        sock_port = self._server.sockets[0].getsockname()[1]
        self.url = f"http://{host}:{sock_port}"

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
            with suppress(Exception):
                await asyncio.wait_for(self._server.wait_closed(), 2)
            self._server = None

    def set_credential(self, job_id: str, spec: CredentialSpec) -> None:
        self._creds[job_id] = spec

    def calls(self, prefix: str = "") -> list[MockCall]:
        return [c for c in self._log if c.path.startswith(prefix)]

    def reset(self) -> None:
        self._log.clear()
        self._flaky.clear()
        self._cred_fails.clear()
        self.stopped.clear()
        self._seq = 0

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            req = await _read_request(reader)
            if req is not None:
                await self._route(req, writer)
        except (ConnectionError, asyncio.IncompleteReadError, ValueError):
            pass
        finally:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()

    def _record(self, req: _Req) -> Json:
        try:
            parsed: object = json.loads(req.body) if req.body else {}
        except ValueError:
            parsed = {}
        body: Json = cast("Json", parsed) if isinstance(parsed, dict) else {}
        self._log.append(
            MockCall(req.path, req.headers.get("authorization", ""), body, time.time())
        )
        return body

    async def _route(self, req: _Req, w: asyncio.StreamWriter) -> None:
        if req.path == "/__mock/requests":
            return await _send_json(w, 200, {"requests": [c.__dict__ for c in self._log]})
        body = self._record(req)
        auth = req.headers.get("authorization", "")
        if req.method == "POST" and (m := _CRED.match(req.path)):
            status, out, extra = await self._credential(m.group(1), auth)
            return await _send_json(w, status, out, extra)
        if req.method == "GET" and req.path == "/v1/parameters":
            return await _send_json(w, 200, {"user_input_form": [], "opening_statement": ""})
        if req.method != "POST":
            return await _send_json(w, *_err(404, "not_found"))
        if m := _STOP.match(req.path):
            self.stopped.add(m.group(1))
            return await _send_json(w, 200, {"result": "success"})
        if req.path in ("/v1/workflows/run", "/v1/chat-messages"):
            key = _BEARER.sub("", auth)
            return await self._run_app(w, body, req.path == "/v1/chat-messages", key)
        return await _send_json(w, *_err(404, "not_found"))

    async def _run_app(self, w: asyncio.StreamWriter, body: Json, chat: bool, key: str) -> None:
        s = scenario_of(key)
        if s.kind == "http":
            return await _send_json(w, *_err(s.status, s.code))
        if s.kind == "flaky":
            self._flaky[key] = self._flaky.get(key, 0) + 1
            if self._flaky[key] <= s.times:
                return await _send_json(w, *_err(503, "service_unavailable"))
        self._seq += 1
        c = _Ctx(chat=chat, n=self._seq, stopped=self.stopped)
        if body.get("response_mode") == "streaming":
            return await self._stream(w, s, c)
        if not self.allow_blocking:
            return await _send_json(w, *_err(400, "invalid_param"))
        evs = events(s, c)
        if chat:
            answer = "".join(str(e.get("answer", "")) for e in evs)
            return await _send_json(
                w, 200, {**c.base(), "answer": answer, "metadata": {"usage": USAGE}}
            )
        return await _send_json(w, 200, {**c.base(), "data": evs[-1].get("data", {})})

    async def _stream(self, w: asyncio.StreamWriter, s: Scenario, c: _Ctx) -> None:
        hdr = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Transfer-Encoding": "chunked",
        }
        w.write(_head(200, hdr))

        async def put(data: bytes) -> None:
            if w.is_closing():
                raise ConnectionResetError
            w.write(b"%x\r\n%s\r\n" % (len(data), data))
            await w.drain()

        try:
            await put(_PING)
            if s.kind == "slow":
                for e in _chunks(c):
                    if c.task in c.stopped:
                        break
                    await put(_sse(e))
                    await asyncio.sleep(s.ms / 1000)
                status = "stopped" if c.task in c.stopped else "succeeded"
                for e in _finish(c, status):
                    await put(_sse(e))
            else:
                for e in events(s, c):
                    await put(_sse(e))
            w.write(b"0\r\n\r\n")
            await w.drain()
        except ConnectionError:
            c.stopped.add(c.task)  # client đã đóng kết nối (= `cancel()` TS)

    async def _credential(self, job_id: str, auth: str) -> tuple[int, Json, Json | None]:
        if not _BEARER.match(auth):
            return *_err(401, "unauthorized"), None
        digest = token_hash(_BEARER.sub("", auth))
        spec = self._creds.get(job_id, self.default_credential)
        if self.verify_token is not None:
            ok = await self.verify_token(job_id, digest)
        else:
            ok = spec is not None and spec.token is not None and token_hash(spec.token) == digest
        if not ok or spec is None:
            return *_err(401, "unauthorized"), None
        n = self._cred_fails[job_id] = self._cred_fails.get(job_id, 0) + 1
        if n <= spec.fail_5xx:
            return *_err(503, "service_unavailable"), None
        if spec.status != 200:
            code = "NOT_CONFIGURED" if spec.status == 409 else f"http_{spec.status}"
            return *_err(spec.status, code), None
        out = {
            "base_url": spec.base_url or self.base_url,
            "api_key": spec.api_key,
            "app_type": spec.app_type,
        }
        return 200, out, {"Cache-Control": "no-store"}


@asynccontextmanager
async def start_dify_mock(
    *,
    allow_blocking: bool = False,
    default_credential: CredentialSpec | None = None,
    verify_token: TokenVerifier | None = None,
) -> AsyncGenerator[DifyMock]:
    mock = DifyMock(
        allow_blocking=allow_blocking,
        default_credential=default_credential,
        verify_token=verify_token,
    )
    await mock.start()
    try:
        yield mock
    finally:
        await mock.close()


@contextmanager
def dify_mock_thread(
    *,
    allow_blocking: bool = False,
    default_credential: CredentialSpec | None = None,
    verify_token: TokenVerifier | None = None,
) -> Generator[DifyMock]:
    """Mock chạy trên event loop riêng (thread daemon) — test chặn đồng bộ vẫn được phục vụ."""
    mock = DifyMock(
        allow_blocking=allow_blocking,
        default_credential=default_credential,
        verify_token=verify_token,
    )
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, name="dify-mock", daemon=True)
    thread.start()
    asyncio.run_coroutine_threadsafe(mock.start(), loop).result(10)
    try:
        yield mock
    finally:
        asyncio.run_coroutine_threadsafe(mock.close(), loop).result(10)
        loop.call_soon_threadsafe(loop.stop)
        thread.join(5)
        loop.close()


__all__ = [
    "CHUNKS",
    "USAGE",
    "CredentialSpec",
    "DifyMock",
    "MockCall",
    "Scenario",
    "dify_mock_thread",
    "events",
    "scenario_of",
    "start_dify_mock",
    "token_hash",
]
