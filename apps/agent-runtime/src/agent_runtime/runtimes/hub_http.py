"""H2c-P · Client HTTP gọi Hub nội bộ — dùng chung `runtimes.cli` (tải file/đẩy `out/`, H2c) và
`runtimes.dify` (credential, H2a). Chuyển từ `runtimes/dify/credential.py` (PY-00 H2c, không đổi
hành vi); `credential.py` import lại và giữ tên export.
"""

import httpx2

CREDENTIAL_TIMEOUT = httpx2.Timeout(10.0)
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
