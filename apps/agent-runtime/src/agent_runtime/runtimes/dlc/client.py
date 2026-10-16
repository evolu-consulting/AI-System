"""DLC-R01 · DLC-R02 · Client HTTP gọi engine AI SDLC (DLC) — `docs/dlc/FRONTEND-INTEGRATION.md` của
DLC.

Mỗi lần claim job mở một `DlcClient` (httpx2). Xác thực: không cấu hình → không gửi token (engine
chạy không đăng nhập, chỉ mạng riêng); có `token_url` + `client_id` + `client_secret` →
`client_credentials` của Keycloak realm `dlc`, token giữ trong `TokenSource` (dùng chung giữa các
job, làm mới trước `exp`); 401 → làm mới, thử lại một lần. Không log token, secret, thân lỗi;
`DlcError` chỉ mang mã + câu ngắn của engine.
"""

from __future__ import annotations

import asyncio
import ssl
import time
from dataclasses import dataclass, field
from typing import Any, cast

import httpx2

TIMEOUT = httpx2.Timeout(30.0)
TOKEN_EARLY_S = 30.0  # làm mới trước `exp`
_MSG_MAX = 300
_HTTP_UNAUTHORIZED = 401

Json = dict[str, Any]


class DlcError(Exception):
    """`status` 0 = không kết nối được / hết giờ."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{status} {code}")
        self.status, self.code, self.message = status, code, message[:_MSG_MAX]

    @property
    def retryable(self) -> bool:
        return self.status == 0 or self.status >= 500


@dataclass
class TokenSource:
    """`client_credentials` (Keycloak). `repr` che secret; `ca_file` = chứng chỉ tự ký Keycloak."""

    token_url: str
    client_id: str
    client_secret: str = field(repr=False)
    ca_file: str | None = None
    _token: str | None = field(default=None, repr=False)
    _until: float = 0.0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    def verify(self) -> ssl.SSLContext | bool:
        return ssl.create_default_context(cafile=self.ca_file) if self.ca_file else True

    async def token(self, *, refresh: bool = False) -> str:
        async with self._lock:
            if refresh or self._token is None or time.monotonic() >= self._until:
                await self._fetch()
            return cast(str, self._token)

    async def _fetch(self) -> None:
        form = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }
        try:
            async with httpx2.AsyncClient(timeout=TIMEOUT, verify=self.verify()) as c:
                resp = await c.post(self.token_url, data=form)
        except httpx2.HTTPError as err:
            raise DlcError(0, "TOKEN_UNREACHABLE", type(err).__name__) from None
        if resp.status_code != 200:  # noqa: PLR2004
            raise DlcError(resp.status_code, "TOKEN_REJECTED", "sign-in refused")
        body = cast(Json, resp.json())
        self._token = str(body.get("access_token", ""))
        life = float(body.get("expires_in", 60))
        self._until = time.monotonic() + max(life - TOKEN_EARLY_S, 5.0)


class DlcClient:
    """Một client mỗi lần claim. `transport` chỉ cho test (`httpx2.MockTransport`)."""

    def __init__(
        self,
        base_url: str,
        tokens: TokenSource | None = None,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._tokens = tokens
        self._http = httpx2.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=TIMEOUT,
            follow_redirects=False,
            transport=transport,
        )

    async def __aenter__(self) -> DlcClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._http.aclose()

    async def _headers(self, refresh: bool) -> dict[str, str]:
        h = {"Accept": "application/json"}
        if self._tokens is not None:
            h["Authorization"] = f"Bearer {await self._tokens.token(refresh=refresh)}"
        return h

    async def call(self, method: str, path: str, body: Json | None = None) -> Json:
        """JSON vào/ra. 401 → làm mới token, thử lại một lần. Lỗi → `DlcError`."""
        resp = await self._send(method, path, body, refresh=False)
        if resp.status_code == _HTTP_UNAUTHORIZED and self._tokens is not None:
            resp = await self._send(method, path, body, refresh=True)
        data = _json(resp)
        if resp.status_code >= 400:  # noqa: PLR2004
            err = cast(Json, data.get("error")) if isinstance(data.get("error"), dict) else data
            code = str(err.get("code") or "HTTP_ERROR")
            raise DlcError(resp.status_code, code, str(err.get("message") or ""))
        return data

    async def _send(
        self, method: str, path: str, body: Json | None, *, refresh: bool
    ) -> httpx2.Response:
        try:
            headers = await self._headers(refresh)
            return await self._http.request(method, path, json=body, headers=headers)
        except httpx2.HTTPError as err:
            raise DlcError(0, "UNREACHABLE", type(err).__name__) from None

    # ---------- các route dùng (FRONTEND-INTEGRATION §5) ----------

    async def health(self) -> Json:
        return await self.call("GET", "/api/health")

    async def project(self, project: str) -> Json:
        return await self.call("GET", f"/api/projects/{project}")

    async def create_project(self, name: str, description: str) -> Json:
        return await self.call("POST", "/api/projects", {"name": name, "description": description})

    async def create_pack(self, body: Json) -> str:
        return str((await self.call("POST", "/api/packs", body))["pack"])

    async def start_run(self, body: Json) -> str:
        return str((await self.call("POST", "/api/runs", body))["run"])

    async def run(self, run: str) -> Json:
        return await self.call("GET", f"/api/runs/{run}")

    async def questions(self, run: str) -> Json:
        return await self.call("GET", f"/api/runs/{run}/questions")

    async def answer(self, run: str, who: str, answers: list[Json]) -> Json:
        return await self.call("POST", f"/api/runs/{run}/answers", {"who": who, "answers": answers})

    async def act(self, run: str, verb: str, body: Json | None = None) -> Json:
        """`verb` ∈ pause | resume | cancel | retry (`POST /api/runs/{run}:{verb}`)."""
        return await self.call("POST", f"/api/runs/{run}:{verb}", body or {})

    async def attention(self, run: str) -> Json:
        return await self.call("GET", f"/api/runs/{run}/attention")

    async def app(self, run: str, *, start: bool) -> Json:
        if start:
            return await self.call("POST", f"/api/runs/{run}/app:start", {})
        return await self.call("GET", f"/api/runs/{run}/app")


def obj(value: object) -> Json:
    """Phần tử JSON là object → dict, khác → `{}` (thân engine không tin cậy về kiểu)."""
    return cast(Json, value) if isinstance(value, dict) else {}


def objs(value: object) -> list[Json]:
    """Mảng JSON → các phần tử là object (bỏ phần tử khác)."""
    items = cast(list[object], value) if isinstance(value, list) else []
    return [cast(Json, x) for x in items if isinstance(x, dict)]


def _json(resp: httpx2.Response) -> Json:
    try:
        data = resp.json()
    except ValueError:
        return {}
    return cast(Json, data) if isinstance(data, dict) else {}
