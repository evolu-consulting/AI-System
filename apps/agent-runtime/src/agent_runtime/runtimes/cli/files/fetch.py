"""H2c · WRK-FR-11 · R16 — tải file đính kèm của job từ Hub (plan-runtime H2c §3.2).

Stub PY-00: kiểu kết quả + chữ ký; thân ở PY-02.
"""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import httpx2

from agent_runtime.contracts.hub import JobAttachment

FetchWhy = Literal[
    "no_hub_url",
    "bad_name",
    "path",
    "exists",
    "unauthorized",
    "not_found",
    "http",
    "size_mismatch",
    "sha_mismatch",
    "network",
]


class JobRef(Protocol):
    """Phần job cần cho lời gọi nội bộ (`ClaimedJob`)."""

    @property
    def id(self) -> str: ...
    @property
    def token(self) -> str: ...


@dataclass(frozen=True)
class FetchOk:
    count: int
    bytes: int
    ms: int


@dataclass(frozen=True)
class FetchFailed:
    why: FetchWhy
    attachment_id: str | None = None


@dataclass(frozen=True)
class FetchStopped:
    pass


@dataclass(frozen=True)
class FetchTimedOut:
    pass


FetchResult = FetchOk | FetchFailed | FetchStopped | FetchTimedOut


@dataclass(frozen=True)
class FilesCall:
    """Ngữ cảnh một lần claim cho tải/đẩy file (gộp tham số — ruff PLR0913 ≤ 4; sd "BUILD — PY-00").

    `hub_url` None ⇒ `no_hub_url`. `deadline` theo `time.monotonic()`;
    `stop` set khi cancel/shutdown.
    """

    client: httpx2.AsyncClient
    hub_url: str | None
    job: JobRef
    deadline: float
    stop: asyncio.Event


async def fetch_attachments(
    call: FilesCall, items: Sequence[JobAttachment], dest: Path
) -> FetchResult:
    """Tuần tự theo thứ tự payload: `O_EXCL|O_NOFOLLOW`, stream + sha256, thử lại theo `backoff`."""
    raise NotImplementedError
