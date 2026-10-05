"""H2c · WRK-FR-11 · R16 — `fetch_attachments` + `httpx2.MockTransport` (plan-runtime H2c §3.2)."""

import asyncio
import errno
import hashlib
import os
import stat
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx2
import pytest

from agent_runtime.contracts.hub import JobAttachment
from agent_runtime.runtimes.cli.files import fetch
from agent_runtime.runtimes.cli.files.fetch import (
    FetchFailed,
    FetchOk,
    FetchResult,
    FetchStopped,
    FetchTimedOut,
    FilesCall,
    fetch_attachments,
)

Handler = Callable[[httpx2.Request], httpx2.Response]


@dataclass(frozen=True)
class _Job:
    id: str
    token: str


def _att(name: str, body: bytes) -> JobAttachment:
    return JobAttachment(
        id=uuid.uuid4(),
        name=name,
        mime="application/pdf",
        size=len(body),
        sha256=hashlib.sha256(body).hexdigest(),
    )


def _no_wait(attempt: int) -> float | None:
    return 0.0 if attempt < 2 else None


@pytest.fixture(autouse=True)
def _fast_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fetch, "backoff", _no_wait)


async def _run(
    tmp_path: Path,
    handler: Handler,
    items: list[JobAttachment],
    *,
    hub_url: str | None = "http://hub.test/",
    deadline_s: float = 30,
    stop: asyncio.Event | None = None,
) -> tuple[FetchResult, Path]:
    dest = tmp_path / "attachments"
    dest.mkdir(exist_ok=True)
    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
        call = FilesCall(
            client,
            hub_url,
            _Job("j-1", "tok"),
            time.monotonic() + deadline_s,
            stop or asyncio.Event(),
        )
        return await fetch_attachments(call, items, dest), dest


async def test_wrk_fr_11_ok_sequential_auth_and_mode(tmp_path: Path) -> None:
    bodies = {"a.pdf": b"A" * 70_000, "Hoá đơn.pdf": b"hd"}
    items = [_att(n, b) for n, b in bodies.items()]
    by_id = {str(i.id): bodies[i.name] for i in items}
    seen: list[httpx2.Request] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return httpx2.Response(200, content=by_id[req.url.path.rsplit("/", 1)[1]])

    res, dest = await _run(tmp_path, handler, items)
    assert isinstance(res, FetchOk) and (res.count, res.bytes) == (2, 70_002)
    assert [r.url.path for r in seen] == [f"/internal/jobs/j-1/attachments/{i.id}" for i in items]
    assert all(r.headers["authorization"] == "Bearer tok" for r in seen)
    for name, body in bodies.items():
        assert (dest / name).read_bytes() == body
        assert stat.S_IMODE((dest / name).stat().st_mode) == 0o400


async def test_wrk_fr_11_empty_items_no_request(tmp_path: Path) -> None:
    res, _ = await _run(tmp_path, lambda r: httpx2.Response(500), [])
    assert res == FetchOk(0, 0, 0)


async def test_wrk_fr_11_no_hub_url(tmp_path: Path) -> None:
    res, _ = await _run(
        tmp_path, lambda r: httpx2.Response(200), [_att("a.pdf", b"x")], hub_url=None
    )
    assert res == FetchFailed("no_hub_url")


@pytest.mark.parametrize(
    ("served", "why"),
    [(b"helly", "sha_mismatch"), (b"hell", "size_mismatch"), (b"hello!", "size_mismatch")],
)
async def test_wrk_fr_11_integrity_failures_clear_dest(
    tmp_path: Path, served: bytes, why: str
) -> None:
    ok, bad = _att("a.pdf", b"x"), _att("b.pdf", b"hello")

    def handler(req: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, content=b"x" if str(ok.id) in req.url.path else served)

    res, dest = await _run(tmp_path, handler, [ok, bad])
    assert res == FetchFailed(why, str(bad.id))  # pyright: ignore[reportArgumentType]
    assert list(dest.iterdir()) == []


async def test_wrk_fr_11_5xx_once_then_ok(tmp_path: Path) -> None:
    calls: list[int] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return httpx2.Response(503 if len(calls) == 1 else 200, content=b"x")

    res, dest = await _run(tmp_path, handler, [_att("a.pdf", b"x")])
    assert isinstance(res, FetchOk) and len(calls) == 2
    assert (dest / "a.pdf").read_bytes() == b"x"


async def test_wrk_fr_11_network_always_three_tries(tmp_path: Path) -> None:
    calls: list[int] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        raise httpx2.ConnectError("down", request=req)

    res, dest = await _run(tmp_path, handler, [_att("a.pdf", b"x")])
    assert isinstance(res, FetchFailed) and res.why == "network" and len(calls) == 3
    assert list(dest.iterdir()) == []


@pytest.mark.parametrize(
    ("status", "why"), [(401, "unauthorized"), (404, "not_found"), (403, "http")]
)
async def test_wrk_fr_11_no_retry_statuses(tmp_path: Path, status: int, why: str) -> None:
    calls: list[int] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        return httpx2.Response(status)

    res, _ = await _run(tmp_path, handler, [_att("a.pdf", b"x")])
    assert isinstance(res, FetchFailed) and res.why == why and len(calls) == 1


async def test_wrk_br_07_slash_name_bad_name(tmp_path: Path) -> None:
    dest = tmp_path / "attachments"
    dest.mkdir()
    item = JobAttachment.model_construct(
        id=uuid.uuid4(), name="sub/a.pdf", mime="application/pdf", size=1, sha256="0" * 64
    )
    res, _ = await _run(tmp_path, lambda r: httpx2.Response(200, content=b"x"), [item])
    assert isinstance(res, FetchFailed) and res.why == "bad_name"


async def test_wrk_fr_11_deadline_timed_out(tmp_path: Path) -> None:
    async def handler(req: httpx2.Request) -> httpx2.Response:
        await asyncio.sleep(5)
        return httpx2.Response(200, content=b"x")

    res, dest = await _run(
        tmp_path,
        handler,  # pyright: ignore[reportArgumentType]
        [_att("a.pdf", b"x")],
        deadline_s=0.2,
    )
    assert res == FetchTimedOut()
    assert list(dest.iterdir()) == []


async def test_wrk_fr_11_stop_cancels(tmp_path: Path) -> None:
    stop = asyncio.Event()
    first = _att("a.pdf", b"x")

    async def handler(req: httpx2.Request) -> httpx2.Response:
        if str(first.id) not in req.url.path:
            stop.set()
            await asyncio.sleep(5)
        return httpx2.Response(200, content=b"x")

    res, dest = await _run(
        tmp_path,
        handler,  # pyright: ignore[reportArgumentType]
        [first, _att("b.pdf", b"x")],
        stop=stop,
    )
    assert res == FetchStopped()
    assert list(dest.iterdir()) == []


async def test_wrk_fr_11_os_error_on_write_is_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review H2c v1 #1: ENOSPC/EIO khi ghi ⇒ `FetchFailed("path")`, không ném lên; dest sạch."""

    def full(fd: int, data: bytes) -> None:
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(fetch, "_write_all", full)
    item = _att("a.pdf", b"x")
    res, dest = await _run(tmp_path, lambda r: httpx2.Response(200, content=b"x"), [item])
    assert res == FetchFailed("path", str(item.id))
    assert list(dest.iterdir()) == []


def test_wrk_br_07_opened_inside_checks_after_open(tmp_path: Path) -> None:
    """Review H2c v1 #7: kiểm sau `open` — tên bị thay (file khác / symlink) ⇒ False."""
    dest = tmp_path / "attachments"
    dest.mkdir()
    target = dest / "a.pdf"
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        assert fetch._opened_inside(fd, target, dest)  # pyright: ignore[reportPrivateUsage]
        target.unlink()
        target.write_bytes(b"other")
        assert not fetch._opened_inside(fd, target, dest)  # pyright: ignore[reportPrivateUsage]
        target.unlink()
        target.symlink_to(tmp_path / "elsewhere")
        assert not fetch._opened_inside(fd, target, dest)  # pyright: ignore[reportPrivateUsage]
    finally:
        os.close(fd)
