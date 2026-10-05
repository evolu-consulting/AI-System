"""H2c · WRK-FR-18 · R25 — `send_outputs` với `httpx2.MockTransport` (plan-runtime H2c §5)."""

import asyncio
import os
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx2
import pytest

from agent_runtime.runtimes.cli.files import outputs
from agent_runtime.runtimes.cli.files.dirs import DirId
from agent_runtime.runtimes.cli.files.fetch import FilesCall
from agent_runtime.runtimes.cli.files.outputs import scan_out, send_outputs

Handler = Callable[[httpx2.Request], httpx2.Response]


@dataclass(frozen=True)
class _Job:
    id: str
    token: str


def _no_wait(attempt: int) -> float | None:
    return 0.0 if attempt < 2 else None


@pytest.fixture(autouse=True)
def _fast_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(outputs, "backoff", _no_wait)


def _created(req: httpx2.Request) -> httpx2.Response:
    return httpx2.Response(201, json={"id": str(uuid.uuid4())})


async def _send(
    out: Path,
    handler: Handler,
    hub_url: str | None = "http://hub.test",
    out_id: DirId | None = None,
) -> tuple[str, ...]:
    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
        call = FilesCall(
            client, hub_url, _Job("j-1", "tok"), time.monotonic() + 30, asyncio.Event()
        )
        return await send_outputs(call, out, out_id)


def _out(tmp_path: Path, **files: str) -> Path:
    out = tmp_path / "out"
    out.mkdir()
    for name, text in files.items():
        (out / name).write_text(text, encoding="utf-8")
    return out


async def test_wrk_fr_18_post_headers_and_body(tmp_path: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()
    (out / "Báo cáo.md").write_bytes(b"fake output\n")
    seen: list[httpx2.Request] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return _created(req)

    ids = await _send(out, handler)
    assert len(ids) == 1
    (req,) = seen
    assert req.url.path == "/internal/jobs/j-1/outputs"
    assert req.headers["authorization"] == "Bearer tok"
    assert req.headers["x-filename"] == "B%C3%A1o%20c%C3%A1o.md"
    assert req.headers["content-type"] == "application/octet-stream"
    assert req.headers["content-length"] == "12"
    assert req.content == b"fake output\n"


async def test_wrk_fr_18_limit_symlink_empty(tmp_path: Path) -> None:
    out = _out(tmp_path, **{f"{c}.md": c for c in "fedcba"}, **{"e0.md": ""})
    victim = tmp_path / "victim"
    victim.write_text("secret")
    os.symlink(victim, out / "l.md")
    names: list[str] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        names.append(req.headers["x-filename"])
        return _created(req)

    ids = await _send(out, handler)
    assert names == ["a.md", "b.md", "c.md", "d.md", "e.md"] and len(ids) == 5


async def test_wrk_fr_18_skip_stop_retry(tmp_path: Path) -> None:
    out = _out(tmp_path, **{"a.exe": "x", "b.md": "x", "c.md": "x", "d.md": "x"})
    tries: dict[str, int] = {}

    def handler(req: httpx2.Request) -> httpx2.Response:
        name = req.headers["x-filename"]
        tries[name] = tries.get(name, 0) + 1
        if name == "a.exe":
            return httpx2.Response(415)
        if name == "b.md" and tries[name] == 1:
            return httpx2.Response(503)
        if name == "c.md":
            return httpx2.Response(401)
        return _created(req)

    ids = await _send(out, handler)
    assert len(ids) == 1  # b.md (sau 503); c.md 401 ⇒ ngừng, d.md không gửi
    assert tries == {"a.exe": 1, "b.md": 2, "c.md": 1}


async def test_wrk_fr_18_bad_response_body_skipped(tmp_path: Path) -> None:
    out = _out(tmp_path, **{"a.md": "x"})
    assert await _send(out, lambda r: httpx2.Response(201, content=b"{}")) == ()


async def test_wrk_fr_18_no_hub_url_or_empty(tmp_path: Path) -> None:
    out = _out(tmp_path, **{"a.md": "x"})
    assert await _send(out, _created, hub_url=None) == ()
    assert await _send(tmp_path / "missing", _created) == ()


def test_wrk_fr_18_scan_kinds(tmp_path: Path) -> None:
    out = _out(tmp_path, **{"f.md": "abc"})
    (out / "d").mkdir()
    os.symlink(out / "f.md", out / "l.md")
    got = {e.name: (e.kind, e.size) for e in scan_out(out)}
    assert got == {"f.md": ("file", 3), "d": ("dir", 0), "l.md": ("symlink", 0)}


async def test_wrk_br_07_out_must_be_same_real_dir(tmp_path: Path) -> None:
    """Review H2c v1 #6: `out/` là symlink, hoặc thư mục khác `DirId` lúc tạo ⇒ không gửi gì."""
    seen: list[httpx2.Request] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return _created(req)

    real = _out(tmp_path, **{"a.md": "x"})
    first = DirId.of(real.lstat())
    assert len(await _send(real, handler, out_id=first)) == 1
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    assert await _send(link, handler) == ()
    real.rename(tmp_path / "old")
    _out(tmp_path, **{"a.md": "x"})
    assert await _send(real, handler, out_id=first) == ()
    assert len(seen) == 1
