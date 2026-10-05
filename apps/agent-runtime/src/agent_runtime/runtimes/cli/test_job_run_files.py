"""H2c · WRK-FR-11 · R16 · R24 — `JobRun._prepare_files` (plan-runtime H2c §3.3): thư mục, tải,
kết cục khi lỗi/hết hạn/dừng; không chạy provider khi tải lỗi."""

from __future__ import annotations

import asyncio
import hashlib
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx2

from agent_runtime.db.finish_sql import FinishTx
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.events.job_events import Failure
from agent_runtime.runtimes.cli.job_run import JobRun
from agent_runtime.runtimes.cli.outcome import CANCELLED, TIMED_OUT
from agent_runtime.runtimes.cli.runner import HostConfig
from agent_runtime.runtimes.cli.test_job_run import JobControl
from agent_runtime.runtimes.cli.test_runner import payload

BODY = b"%PDF-1"
JOB = ClaimedJob("c3000000-0000-4000-8000-0000000000f1", {"run_id": "r"}, token="tok")


class _Events:
    def __init__(self) -> None:
        self.forgot: list[str] = []

    def forget(self, job_id: str) -> None:
        self.forgot.append(job_id)


class _Host:
    def __init__(self, cfg: HostConfig) -> None:
        self.cfg, self.events = cfg, _Events()
        self.closed: list[Any] = []
        self.failed: list[Failure] = []

    async def close(self, job: ClaimedJob, tx: FinishTx, v: Any, tokens: Any) -> None:
        self.closed.append(v.failure)

    async def finish_failed(self, job: ClaimedJob, f: Failure) -> None:
        self.failed.append(f)


def _run(
    tmp_path: Path,
    handler: Callable[[httpx2.Request], Any],
    *,
    attachments: bool = True,
    role: str = "agent",
    hub_url: str | None = "http://hub.test",
    control: JobControl | None = None,
) -> tuple[JobRun, _Host]:
    transport = httpx2.MockTransport(handler)
    cfg = HostConfig(
        "w-1", tmp_path / "work", tmp_path / "logs", tmp_path, "test", 0.2,
        hub_url=hub_url, hub_transport=transport,
    )  # fmt: skip
    p = payload()
    p.agent.role = role  # pyright: ignore[reportAttributeAccessIssue]
    if attachments:
        data = p.model_dump(mode="json")
        data["attachments"] = [
            {
                "id": str(uuid.uuid4()),
                "name": "a.pdf",
                "mime": "application/pdf",
                "size": len(BODY),
                "sha256": hashlib.sha256(BODY).hexdigest(),
            }
        ]
        p = type(p).model_validate(data)
    host = _Host(cfg)
    run = JobRun(host, JOB, p, control or JobControl())  # pyright: ignore[reportArgumentType]
    return run, host


def _ok(req: httpx2.Request) -> httpx2.Response:
    return httpx2.Response(200, content=BODY)


async def test_wrk_fr_11_fetch_ok_dirs_ready(tmp_path: Path) -> None:
    run, host = _run(tmp_path, _ok)
    assert await run._prepare_files() is True  # pyright: ignore[reportPrivateUsage]
    assert (run.work / "attachments" / "a.pdf").read_bytes() == BODY
    assert (run.work / "out").is_dir()
    assert (host.failed, host.closed) == ([], [])


async def test_wrk_fr_11_no_attachments_orchestrator_no_dirs(tmp_path: Path) -> None:
    run, _ = _run(tmp_path, _ok, attachments=False, role="orchestrator")
    assert await run._prepare_files() is True  # pyright: ignore[reportPrivateUsage]
    assert not run.work.exists()


async def test_wrk_fr_11_fetch_failed_attachment_reason(tmp_path: Path) -> None:
    run, host = _run(tmp_path, lambda r: httpx2.Response(404))
    assert await run._prepare_files() is False  # pyright: ignore[reportPrivateUsage]
    (f,) = host.failed
    assert (f.status, f.code, f.reason) == ("failed", "INTERNAL_ERROR", "attachment")
    assert "not_found" in f.message
    assert list((run.work / "attachments").iterdir()) == []


async def test_wrk_fr_11_no_hub_url(tmp_path: Path) -> None:
    run, host = _run(tmp_path, _ok, hub_url=None)
    assert await run._prepare_files() is False  # pyright: ignore[reportPrivateUsage]
    assert host.failed[0].message == "attachment fetch failed: no_hub_url"


async def test_wrk_fr_11_deadline_timed_out(tmp_path: Path) -> None:
    async def slow(req: httpx2.Request) -> httpx2.Response:
        await asyncio.sleep(5)
        return _ok(req)

    run, host = _run(tmp_path, slow)
    run.deadline = time.monotonic() + 0.2
    assert await run._prepare_files() is False  # pyright: ignore[reportPrivateUsage]
    assert host.closed == [TIMED_OUT]


async def test_wrk_fr_11_cancel_and_shutdown(tmp_path: Path) -> None:
    for reason, closed, forgot in (("cancel", [CANCELLED], []), ("shutdown", [], [JOB.id])):
        ctl = JobControl()

        async def held(req: httpx2.Request, ctl: JobControl = ctl, why: str = reason) -> Any:
            ctl.request_stop(why)
            await asyncio.sleep(5)

        run, host = _run(tmp_path / reason, held, control=ctl)
        assert await run._prepare_files() is False  # pyright: ignore[reportPrivateUsage]
        assert (host.closed, host.events.forgot) == (closed, forgot)
