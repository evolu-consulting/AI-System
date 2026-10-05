"""H2a-R17 · Q5 · Lấy app-key Dify từ Hub bằng token job (plan-runtime §3.3).

`POST {AGENT_RT_HUB_URL}/internal/jobs/{job_id}/dify-credential`, `Authorization: Bearer <token>`,
không body. 200 → `DifyCredential` (`DifyCredentialResponse` sinh từ C2) · 401/409/4xx khác/thân
sai → `CredentialError(retryable=False)` (host: `NOT_CONFIGURED`/`credential`, không retry) ·
5xx/lỗi mạng → `CredentialError(retryable=True)` (host thử lại như hàng "kết nối" `-dify` §3.4).
Không log, không đưa token/key vào exception, `repr`, `str`.
"""

from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote

import httpx2
from pydantic import ValidationError

from agent_runtime.contracts.hub import DifyCredentialResponse
from agent_runtime.runtimes.hub_http import CREDENTIAL_TIMEOUT as CREDENTIAL_TIMEOUT
from agent_runtime.runtimes.hub_http import NO_PROXY_MOUNTS as NO_PROXY_MOUNTS
from agent_runtime.runtimes.hub_http import make_hub_client as make_hub_client

AppType = Literal["workflow", "chat", "agent"]
_MASKED = "***"


@dataclass(frozen=True)
class DifyCredential:
    """Giữ trong bộ nhớ `DifyJobHost` tới hết lần claim; `repr`/`str` che `api_key`."""

    base_url: str
    api_key: str = field(repr=False)
    app_type: AppType

    def __repr__(self) -> str:
        return (
            f"DifyCredential(base_url={self.base_url!r}, api_key={_MASKED!r}, "
            f"app_type={self.app_type!r})"
        )

    __str__ = __repr__


@dataclass(frozen=True)
class CredentialError:
    """`http_status` None = lỗi mạng/timeout (chưa có phản hồi)."""

    retryable: bool
    http_status: int | None = None


def credential_url(hub_url: str, job_id: str) -> str:
    return f"{hub_url.rstrip('/')}/internal/jobs/{quote(job_id, safe='')}/dify-credential"


def _parse(resp: httpx2.Response) -> DifyCredential | CredentialError:
    try:
        body = DifyCredentialResponse.model_validate_json(resp.content)
    except ValidationError:
        # Không chép lỗi pydantic (có thể chứa giá trị key) — chỉ trả trạng thái.
        return CredentialError(retryable=False, http_status=resp.status_code)
    return DifyCredential(
        base_url=body.base_url.rstrip("/"), api_key=body.api_key, app_type=body.app_type
    )


async def fetch_credential(
    client: httpx2.AsyncClient, hub_url: str, job_id: str, token: str
) -> DifyCredential | CredentialError:
    """Một lần gọi (không tự retry — vòng thử/backoff thuộc `DifyJobHost`)."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    try:
        resp = await client.post(credential_url(hub_url, job_id), headers=headers)
    except httpx2.HTTPError:
        return CredentialError(retryable=True)
    if resp.status_code >= 500:
        return CredentialError(retryable=True, http_status=resp.status_code)
    if resp.status_code != 200:
        return CredentialError(retryable=False, http_status=resp.status_code)
    return _parse(resp)
