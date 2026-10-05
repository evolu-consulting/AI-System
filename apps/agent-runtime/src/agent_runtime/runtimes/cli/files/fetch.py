"""H2c · WRK-FR-11 · R16 — tải file đính kèm của job từ Hub (plan-runtime H2c §3.2).

Tuần tự theo thứ tự payload. Mỗi file: kiểm tên (`valid_job_file_name`) →
`os.open(O_EXCL|O_NOFOLLOW)` (symlink/file đặt sẵn ⇒ `exists`, trước khi GET) → kiểm **sau khi mở**
(review H2c v1 #7): `fstat(fd)` cùng (dev, ino) với `lstat(target)` và `realpath(target)` nằm trực
tiếp trong `realpath(dest)` — sai ⇒ `path` → `GET
/internal/jobs/:id/attachments/:att` (Bearer token job) stream 64 KiB + sha256 + đếm byte → so
`size`/`sha256` của payload → `fchmod 0o400`. 5xx/mạng/timeout 60 s ⇒ thử lại theo `backoff`
(file dở xoá, mở lại `O_EXCL`). Hạn job ⇒ `FetchTimedOut`; `stop` ⇒ `FetchStopped`. Mọi kết cục
khác `FetchOk` ⇒ xoá mọi file đã ghi. Lỗi OS khi ghi/đổi quyền (ENOSPC, EIO… — review H2c v1 #1)
⇒ `FetchFailed("path")` (job `failed` reason `attachment`). Không log token, tên file, URL.
"""

import asyncio
import errno
import hashlib
import os
import stat
import time
from collections.abc import Coroutine, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol
from urllib.parse import quote

import httpx2

from agent_runtime.contracts.hub import JobAttachment
from agent_runtime.log import get_logger
from agent_runtime.runtimes.cli.files.rules import (
    FETCH_TIMEOUT_S,
    backoff,
    classify_fetch,
    valid_job_file_name,
)

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

CHUNK_BYTES = 65_536
_OPEN_NEW = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
_HTTP_OK = 200


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


def job_url(hub_url: str, job_id: str, tail: str) -> str:
    """`{hub_url}/internal/jobs/{quote(job_id)}/{tail}` (`tail` đã quote phần biến)."""
    return f"{hub_url.rstrip('/')}/internal/jobs/{quote(job_id, safe='')}/{tail}"


def auth_headers(job: JobRef) -> dict[str, str]:
    return {"Authorization": f"Bearer {job.token}"}


async def until_stopped[T](
    work: Coroutine[Any, Any, T], stop: asyncio.Event
) -> tuple[bool, T | None]:
    """Chạy `work` tới xong hoặc tới khi `stop` set (huỷ `work`). `(True, kết quả)` khi xong."""
    task = asyncio.ensure_future(work)
    waiter = asyncio.ensure_future(stop.wait())
    try:
        await asyncio.wait({task, waiter}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        waiter.cancel()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    if task.cancelled():
        return False, None
    return True, task.result()


class _Failed(Exception):
    def __init__(self, why: FetchWhy, status: int | None = None, error: str | None = None) -> None:
        super().__init__(why)
        self.why: FetchWhy = why
        self.status: int | None = status
        self.error: str | None = error  # tên lớp lỗi OS (log), không thông điệp (có thể chứa path)


async def fetch_attachments(
    call: FilesCall, items: Sequence[JobAttachment], dest: Path
) -> FetchResult:
    """Tuần tự theo thứ tự payload: `O_EXCL|O_NOFOLLOW`, stream + sha256, thử lại theo `backoff`."""
    if not items:
        return FetchOk(0, 0, 0)
    log = get_logger()
    if call.hub_url is None:
        log.warning("job.attachment_failed", attachment_id=None, why="no_hub_url", status=None)
        return FetchFailed("no_hub_url")
    started = time.monotonic()
    run = _Fetch(call, call.hub_url, dest)
    res: FetchResult = FetchStopped()
    try:
        done, total = await until_stopped(run.all(items), call.stop)
        if isinstance(total, _Failed):
            aid = run.current
            log.warning(
                "job.attachment_failed",
                attachment_id=aid,
                why=total.why,
                status=total.status,
                error=total.error,
            )
            res = FetchFailed(total.why, aid)
        elif done and total is None:
            res = FetchTimedOut()
        elif done and total is not None:
            ms = int((time.monotonic() - started) * 1000)
            log.info("job.attachments_fetched", count=len(items), bytes=total, ms=ms)
            res = FetchOk(len(items), total, ms)
    finally:
        if not isinstance(res, FetchOk):
            _remove(run.written)
    return res


def _opened_inside(fd: int, target: Path, dest: Path) -> bool:
    """Kiểm thật sau `open` (review H2c v1 #7): fd đúng là file thường tại `target` (cùng dev/ino,
    `lstat` — không theo symlink) và `realpath(target)` nằm trực tiếp trong `realpath(dest)`."""
    try:
        got, at = os.fstat(fd), os.lstat(target)
    except OSError:
        return False
    if not stat.S_ISREG(at.st_mode) or (got.st_dev, got.st_ino) != (at.st_dev, at.st_ino):
        return False
    return os.path.dirname(os.path.realpath(target)) == os.path.realpath(dest)


def _open_new(target: Path) -> int:
    try:
        return os.open(target, _OPEN_NEW, 0o600)
    except FileExistsError as err:
        raise _Failed("exists") from err
    except OSError as err:
        raise _Failed("exists" if err.errno == errno.ELOOP else "path") from err


class _Fetch:
    """Một lần tải cả danh sách: nhớ file đã ghi (để xoá khi lỗi) và id đang tải (log)."""

    def __init__(self, call: FilesCall, hub_url: str, dest: Path) -> None:
        self.call, self.hub_url, self.dest = call, hub_url, dest
        self.written: list[Path] = []
        self.current: str | None = None

    async def all(self, items: Sequence[JobAttachment]) -> int | _Failed | None:
        """Tổng byte · `_Failed` · None khi chạm hạn job."""
        total = 0
        try:
            async with asyncio.timeout(self.call.deadline - time.monotonic()):
                for item in items:
                    self.current = str(item.id)
                    total += await self._one(item)
        except _Failed as err:
            return err
        except TimeoutError:
            return None
        except OSError as err:  # sau TimeoutError (lớp con của OSError): ENOSPC/EIO khi ghi
            return _Failed("path", None, type(err).__name__)
        return total

    async def _one(self, item: JobAttachment) -> int:
        if not valid_job_file_name(item.name):
            raise _Failed("bad_name")
        target = self.dest / item.name
        url = job_url(self.hub_url, self.call.job.id, f"attachments/{quote(str(item.id), safe='')}")
        attempt = 0
        while True:
            fd = _open_new(target)
            self.written.append(target)  # đã tạo ⇒ xoá khi lỗi (kể cả `path` ngay dưới)
            try:
                if not _opened_inside(fd, target, self.dest):
                    raise _Failed("path")
                status = await _download(self.call, url, item, fd)
                if status == _HTTP_OK:
                    os.fchmod(fd, 0o400)
                    return item.size
            finally:
                os.close(fd)
            target.unlink(missing_ok=True)
            self.written.remove(target)
            kind = classify_fetch(status)
            if kind in ("unauthorized", "not_found", "http"):
                raise _Failed(kind, status)
            wait = backoff(attempt)
            if wait is None:
                raise _Failed("network" if status is None else "http", status)
            attempt += 1
            await asyncio.sleep(wait)


async def _download(call: FilesCall, url: str, item: JobAttachment, fd: int) -> int | None:
    """Mã HTTP (200 = đủ byte, sha khớp) · None = lỗi mạng/timeout 60 s (thử lại được)."""
    digest = hashlib.sha256()
    count = 0
    try:
        async with (
            asyncio.timeout(FETCH_TIMEOUT_S),
            call.client.stream("GET", url, headers=auth_headers(call.job)) as resp,
        ):
            if resp.status_code != _HTTP_OK:
                return resp.status_code
            async for chunk in resp.aiter_bytes(CHUNK_BYTES):
                count += len(chunk)
                if count > item.size:
                    raise _Failed("size_mismatch", _HTTP_OK)
                _write_all(fd, chunk)
                digest.update(chunk)
    except (httpx2.HTTPError, TimeoutError):
        return None
    if count != item.size:
        raise _Failed("size_mismatch", _HTTP_OK)
    if digest.hexdigest() != item.sha256:
        raise _Failed("sha_mismatch", _HTTP_OK)
    return _HTTP_OK


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view) :]


def _remove(paths: list[Path]) -> None:
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            get_logger().warning("job.attachment_cleanup_failed")
    paths.clear()
