"""DLC-R07 · Spec của một yêu cầu: file văn bản đính kèm (`.md`, `.markdown`, `.txt`) tải từ Hub
bằng token job (`GET /internal/jobs/:id/attachments/:att`, H2c), không có file thì là chính tin
chat.

Chỉ đọc vào bộ nhớ (≤ `SPEC_FILE_MAX` mỗi file, kiểm `sha256` của payload); file khác (ảnh, pdf…) bỏ
qua. Lỗi tải → bỏ file đó (spec vẫn có thể lấy từ tin chat). Không log token, tên file, URL.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING
from urllib.parse import quote

import httpx2

from agent_runtime.contracts.hub import JobAttachment, JobPayload1
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.log import get_logger
from agent_runtime.runtimes.hub_http import make_hub_client

if TYPE_CHECKING:
    from agent_runtime.runtimes.dlc.host import DlcJobHost

SPEC_FILE_MAX = 2_000_000
SPEC_FILES_MAX = 5
TEXT_SUFFIXES = (".md", ".markdown", ".txt")
TEXT_MIMES = frozenset({"text/markdown", "text/plain"})


def is_spec_file(a: JobAttachment) -> bool:
    return a.name.lower().endswith(TEXT_SUFFIXES) or str(a.mime) in TEXT_MIMES


class SpecSource:
    def __init__(self, host: DlcJobHost, job: ClaimedJob, payload: JobPayload1) -> None:
        self.host, self.job, self.p = host, job, payload

    async def text(self, message: str) -> str:
        """Nội dung các file văn bản đính kèm (nối bằng dòng trống), không có thì `message`."""
        files = [a for a in self.p.attachments or [] if is_spec_file(a)][:SPEC_FILES_MAX]
        hub_url = self.host.cfg.hub_url
        if not files or not hub_url:
            return message.strip()
        parts: list[str] = []
        async with make_hub_client(self.host.cfg.hub_transport) as hub:
            for a in files:
                body = await self._get(hub, hub_url, a)
                if body:
                    parts.append(body.strip())
        return "\n\n".join(parts) if parts else message.strip()

    async def _get(self, hub: httpx2.AsyncClient, hub_url: str, a: JobAttachment) -> str | None:
        if a.size > SPEC_FILE_MAX:
            return None
        url = (
            f"{hub_url.rstrip('/')}/internal/jobs/{quote(self.job.id, safe='')}"
            f"/attachments/{quote(str(a.id), safe='')}"
        )
        try:
            resp = await hub.get(url, headers={"Authorization": f"Bearer {self.job.token}"})
        except httpx2.HTTPError as err:
            get_logger().warning("dlc.spec_fetch_failed", error=type(err).__name__)
            return None
        data = resp.content
        if resp.status_code != 200 or hashlib.sha256(data).hexdigest() != a.sha256:  # noqa: PLR2004
            get_logger().warning("dlc.spec_fetch_failed", status=resp.status_code)
            return None
        return data.decode("utf-8", errors="replace")
