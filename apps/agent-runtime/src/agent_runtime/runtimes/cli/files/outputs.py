"""H2c · WRK-FR-18 · R25 — đẩy file `out/` của job agent lên Hub (plan-runtime H2c §5).

Liệt kê `os.scandir(out)` (không theo symlink) → `pick_outputs` (≤ 5, sắp tên) → mỗi file:
`realpath` phòng thủ, `os.open(O_RDONLY|O_NOFOLLOW)`, `fstat` (thường, size khớp, ≤ max) →
`POST /internal/jobs/:id/outputs` (Bearer, `X-Filename` pct, thân thô stream từ fd).
`classify_output`: `ok` ⇒ id · `skip` ⇒ bỏ file · `stop` ⇒ ngừng · `retry` ⇒ ≤ 2 lần nữa.
Không bao giờ làm job `failed`; `stop` (cancel) / hết thời gian ⇒ ngừng, giữ id đã có.
Log không tên file.
"""

import asyncio
import os
import stat
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Literal

import httpx2
from pydantic import ValidationError

from agent_runtime.contracts.hub import JobOutputResponse
from agent_runtime.log import get_logger
from agent_runtime.runtimes.cli.files.fetch import (
    CHUNK_BYTES,
    FilesCall,
    auth_headers,
    job_url,
    until_stopped,
)
from agent_runtime.runtimes.cli.files.rules import (
    ATTACH_MAX_BYTES,
    FETCH_TIMEOUT_S,
    OutEntry,
    OutKind,
    backoff,
    classify_output,
    filename_header,
    pick_outputs,
)

_OPEN_READ = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
_STOP: Literal["stop"] = "stop"


async def send_outputs(call: FilesCall, out: Path) -> tuple[str, ...]:
    """`pick_outputs` → POST `/internal/jobs/{id}/outputs` từng file; trả id (≤ 5). Không làm job
    `failed`; huỷ/hết hạn ⇒ ngừng, giữ id đã có."""
    log = get_logger()
    started = time.monotonic()
    picked, skipped = pick_outputs(scan_out(out))
    for why in skipped:
        log.info("job.output_skipped", why=why, status=None)
    if not picked:
        return ()
    if call.hub_url is None:
        log.warning("job.outputs_skipped", reason="no_hub_url")
        return ()
    sender = _Sender(call, job_url(call.hub_url, call.job.id, "outputs"), out)
    budget = max(FETCH_TIMEOUT_S, call.deadline - time.monotonic())
    await until_stopped(sender.all(picked, budget), call.stop)
    ids = tuple(sender.ids)
    ms = int((time.monotonic() - started) * 1000)
    log.info("job.outputs", sent=len(ids), skipped=len(skipped) + len(picked) - len(ids), ms=ms)
    return ids


def scan_out(out: Path) -> list[OutEntry]:
    """`os.scandir` không theo symlink; thư mục vắng/lỗi đọc ⇒ []."""
    entries: list[OutEntry] = []
    try:
        with os.scandir(out) as it:
            for d in it:
                try:
                    entries.append(_entry(d))
                except OSError:
                    entries.append(OutEntry(d.name, "other", 0))
    except OSError:
        return []
    return entries


def _entry(d: os.DirEntry[str]) -> OutEntry:
    kind: OutKind
    if d.is_symlink():
        kind = "symlink"
    elif d.is_dir(follow_symlinks=False):
        kind = "dir"
    elif d.is_file(follow_symlinks=False):
        kind = "file"
    else:
        kind = "other"
    size = d.stat(follow_symlinks=False).st_size if kind == "file" else 0
    return OutEntry(d.name, kind, size)


class _Sender:
    """Gửi lần lượt; `ids` giữ id đã nhận kể cả khi bị huỷ/hết thời gian giữa chừng."""

    def __init__(self, call: FilesCall, url: str, out: Path) -> None:
        self.call, self.url, self.out = call, url, out
        self.ids: list[str] = []

    async def all(self, picked: list[OutEntry], budget: float) -> None:
        try:
            async with asyncio.timeout(budget):
                for e in picked:
                    got = await _send_one(self.call, self.url, self.out, e)
                    if got == _STOP:
                        return
                    if got is not None:
                        self.ids.append(got)
        except TimeoutError:
            get_logger().warning("job.outputs_timeout", sent=len(self.ids))


def _open_checked(out: Path, e: OutEntry) -> int | None:
    """fd file thường đúng `out/<name>`, size khớp — sai ⇒ log bỏ, None."""
    path = out / e.name
    log = get_logger()
    if Path(os.path.realpath(path)).parent != Path(os.path.realpath(out)):
        log.info("job.output_skipped", why="other", status=None)
        return None
    try:
        fd = os.open(path, _OPEN_READ)
    except OSError:
        log.info("job.output_skipped", why="other", status=None)
        return None
    st = os.fstat(fd)
    why = None
    if not stat.S_ISREG(st.st_mode):
        why = "other"
    elif st.st_size != e.size or st.st_size > ATTACH_MAX_BYTES:
        why = "too_large"
    if why is not None:
        os.close(fd)
        log.info("job.output_skipped", why=why, status=None)
        return None
    return fd


async def _send_one(call: FilesCall, url: str, out: Path, e: OutEntry) -> str | None:
    """id · None (bỏ file) · `"stop"` (401 — ngừng phần còn lại)."""
    fd = _open_checked(out, e)
    if fd is None:
        return None
    log = get_logger()
    try:
        attempt = 0
        while True:
            status, body = await _post(call, url, fd, e)
            kind = classify_output(status)
            if kind == "ok":
                return _parse_id(body, status)
            if kind == "stop":
                log.warning("job.output_skipped", why="unauthorized", status=status)
                return _STOP
            wait = backoff(attempt) if kind == "retry" else None
            if wait is None:
                log.info("job.output_skipped", why="rejected", status=status)
                return None
            attempt += 1
            await asyncio.sleep(wait)
    finally:
        os.close(fd)


def _parse_id(body: bytes, status: int | None) -> str | None:
    try:
        return str(JobOutputResponse.model_validate_json(body).id)
    except ValidationError:
        get_logger().warning("job.output_skipped", why="bad_response", status=status)
        return None


async def _post(call: FilesCall, url: str, fd: int, e: OutEntry) -> tuple[int | None, bytes]:
    headers = {
        **auth_headers(call.job),
        "X-Filename": filename_header(e.name),
        "Content-Type": "application/octet-stream",
        "Content-Length": str(e.size),
    }
    try:
        async with asyncio.timeout(FETCH_TIMEOUT_S):
            resp = await call.client.post(url, content=_read_fd(fd, e.size), headers=headers)
    except (httpx2.HTTPError, TimeoutError):
        return None, b""
    return resp.status_code, resp.content


async def _read_fd(fd: int, size: int) -> AsyncIterator[bytes]:
    """Thân stream từ đầu fd, đúng `size` byte."""
    os.lseek(fd, 0, os.SEEK_SET)
    left = size
    while left > 0:
        chunk = os.read(fd, min(CHUNK_BYTES, left))
        if not chunk:
            return
        left -= len(chunk)
        yield chunk
