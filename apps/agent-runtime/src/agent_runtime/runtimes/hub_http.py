"""H2c-P · Client HTTP gọi Hub nội bộ — dùng chung `runtimes.cli` (tải file/đẩy `out/`, H2c) và
`runtimes.dify` (credential, H2a). Chuyển từ `runtimes/dify/credential.py` (PY-00 H2c, không đổi
hành vi); `credential.py` import lại và giữ tên export.
"""

from urllib.parse import quote

import httpx2

from agent_runtime.log import get_logger

CREDENTIAL_TIMEOUT = httpx2.Timeout(10.0)
_SOURCE_CRED_RETRY = 2
_HTTP_OK = 200
# Hub và mock chạy loopback: không đi qua proxy env (tương đương `NO_PROXY=localhost,127.0.0.1`).
NO_PROXY_MOUNTS: dict[str, httpx2.AsyncBaseTransport | None] = {
    "all://localhost": None,
    "all://127.0.0.1": None,
    "all://[::1]": None,
}


def make_hub_client(transport: httpx2.AsyncBaseTransport | None = None) -> httpx2.AsyncClient:
    """Client gọi Hub nội bộ: không redirect, timeout 10 s, `trust_env=False` (review 1 C3: Hub luôn
    là mạng nội bộ — không đi qua `HTTP(S)_PROXY`, không đọc `.netrc`/`SSL_CERT_*` từ env; token
    job không bao giờ tới proxy)."""
    return httpx2.AsyncClient(
        timeout=CREDENTIAL_TIMEOUT,
        follow_redirects=False,
        trust_env=False,
        mounts=NO_PROXY_MOUNTS,
        transport=transport,
    )


class SourceCredentialError(Exception):
    """PC2-R11: không lấy được khoá nguồn (404 NOT_FOUND / 409 NOT_CONFIGURED / mạng). Không mang
    giá trị khoá; message chung (người gọi ánh xạ `no_credential`/`SOURCE_UNRESOLVABLE`)."""

    def __init__(self, status: int | None) -> None:
        super().__init__(f"source-credential lỗi (status={status})")
        self.status = status


async def source_credential(  # noqa: PLR0913
    hub_url: str,
    job_id: str,
    job_token: str,
    source_id: str,
    transport: httpx2.AsyncBaseTransport | None = None,
) -> tuple[str, str]:
    """PC2-R11: `POST /internal/jobs/:job_id/source-credential {source_id}` (Bearer token job) ⇒
    `(username, token)`. Giữ trong bộ nhớ người gọi tới hết job; không log/ghi file giá trị. Thử lại
    `_SOURCE_CRED_RETRY` lần cho lỗi mạng/5xx; 404/409 ⇒ `SourceCredentialError` ngay.

    Không bao giờ ghi `Authorization`/token vào log — chỉ log mã trạng thái/loại lỗi.
    """
    url = f"{hub_url.rstrip('/')}/internal/jobs/{quote(job_id, safe='')}/source-credential"
    headers = {"Authorization": f"Bearer {job_token}"}
    last: int | None = None
    for attempt in range(_SOURCE_CRED_RETRY + 1):
        try:
            async with make_hub_client(transport) as client:
                resp = await client.post(url, json={"source_id": source_id}, headers=headers)
        except httpx2.HTTPError as err:
            last = None
            get_logger().warning("apply.credential_error", error=type(err).__name__, try_=attempt)
            continue
        if resp.status_code == _HTTP_OK:
            body = resp.json()
            return str(body["username"]), str(body["token"])
        last = resp.status_code
        if resp.status_code < 500:  # 401/404/409: lỗi dứt điểm, không thử lại
            break
        get_logger().warning("apply.credential_rejected", status=resp.status_code, try_=attempt)
    raise SourceCredentialError(last)
