"""WRK-FR-04 · WRK-FR-05 · WRK-FR-15 · WRK-FR-24 · review H1 #1/#2/#5/#9/#10 — `JobRun` +
`CliJobHost` (unit, Linux): cha đang dừng, job host chết vì tín hiệu, reader lỗi, pipe bị cháu
giữ, lỗi giao thức phía cha, thử lại ghi "Kết thúc"."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import asyncpg  # pyright: ignore[reportMissingTypeStubs]
import pytest

from agent_runtime.db.finish_sql import Finished, FinishTx
from agent_runtime.db.jobs_sql import ClaimedJob, Finish
from agent_runtime.providers.base import Fatal, Final
from agent_runtime.runtimes.cli import job_run as jr
from agent_runtime.runtimes.cli import runner
from agent_runtime.runtimes.cli.job_run import JobRun
from agent_runtime.runtimes.cli.outcome import CRASHED, Seen, decide_exit
from agent_runtime.runtimes.cli.protocol import (
    EVENT_TOO_LARGE,
    INVALID_EVENT,
    MAX_LINE_BYTES,
    parse_event,
)
from agent_runtime.runtimes.cli.runner import CliJobHost, FinishWriteFailed, HostConfig
from agent_runtime.runtimes.cli.stdout_pipe import StdoutPipe
from agent_runtime.runtimes.cli.test_runner import payload

JOB = ClaimedJob("c3000000-0000-4000-8000-000000000001", {"run_id": "r"})
_PG: Any = asyncpg


class JobControl:
    """= `queue.host.JobControl` (lớp `runtimes` không import `queue`)."""

    def __init__(self) -> None:
        self.stopped, self.reason = asyncio.Event(), None

    def request_stop(self, reason: str) -> None:
        self.reason = self.reason or reason
        self.stopped.set()


class _Events:
    def __init__(self) -> None:
        self.forgot: list[str] = []
        self.progress_s = 0.0  # Redis chậm (review H1 v2 N1)

    async def progress(self, job: ClaimedJob, label: str) -> None:
        await asyncio.sleep(self.progress_s)

    def forget(self, job_id: str) -> None:
        self.forgot.append(job_id)


class _Host:
    def __init__(self, cfg: HostConfig) -> None:
        self.cfg, self.events = cfg, _Events()
        self.closed: list[Any] = []

    async def close(self, job: ClaimedJob, tx: FinishTx, v: Any, tokens: Any) -> None:
        self.closed.append(v)


def make_run(tmp_path: Path, control: JobControl | None = None) -> tuple[JobRun, _Host]:
    cfg = HostConfig("w-1", tmp_path / "work", tmp_path / "logs", tmp_path, "test", 0.2)
    host = _Host(cfg)
    run = JobRun(host, JOB, payload(), control or JobControl())  # pyright: ignore[reportArgumentType]
    return run, host


async def start(run: JobRun, script: str) -> asyncio.subprocess.Process:
    """Như `JobRun._spawn` nhưng chạy `sh -c script` (pipe stdout do cha tạo)."""
    run.pipe = pipe = StdoutPipe()
    try:
        run.proc = await asyncio.create_subprocess_exec(
            "sh",
            "-c",
            script,
            stdin=asyncio.subprocess.PIPE,
            stdout=pipe.write_fd,
            start_new_session=True,
        )
    finally:
        pipe.close_write()
    run.out = await pipe.attach(MAX_LINE_BYTES)
    return run.proc


def test_wrk_fr_15_parent_faults_do_not_count_provider_error() -> None:
    p = payload()
    assert parse_event(b"{bad") is INVALID_EVENT
    for fatal in (INVALID_EVENT, EVENT_TOO_LARGE, jr.READER_FAILED):
        v = decide_exit(p, Seen(fatal=fatal, parent_fault=True))
        assert v.failure is not None and v.failure.code == "INTERNAL_ERROR" and v.provider == "none"
    child = decide_exit(p, Seen(fatal=Fatal(code="UPSTREAM_ERROR", msg="x")))
    assert child.provider == "error"
    sig = decide_exit(p, Seen(signaled=True))
    assert (sig.failure, sig.provider) == (CRASHED, "none")
    seen = Seen(signaled=True, parent_fault=True)
    seen.next_attempt()
    assert not seen.signaled and not seen.parent_fault


async def test_wrk_fr_24_stdout_held_by_grandchild_stops_reading(tmp_path: Path) -> None:
    """#9: job host thoát, cháu giữ stdout → ngừng đọc sau `DRAIN_S`, giết cây."""
    run, _ = make_run(tmp_path)
    await start(run, "sleep 30 & exit 0")
    t0 = time.monotonic()
    assert await run._supervise() == "exited"  # pyright: ignore[reportPrivateUsage]
    assert time.monotonic() - t0 < jr.DRAIN_S + 2
    assert not run.seen.signaled
    await run._kill_leftovers()  # pyright: ignore[reportPrivateUsage]
    assert decide_exit(run.payload, run.seen).provider == "error"  # thoát 0 không final: lỗi thật


async def test_wrk_fr_15_reader_error_is_parent_fault(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#5: reader ném lỗi → `INTERNAL_ERROR`, không đếm lỗi provider, group bị giết."""
    run, _ = make_run(tmp_path)
    proc = await start(run, "sleep 30")

    async def boom() -> None:
        raise RuntimeError("x")

    monkeypatch.setattr(run, "_read", boom)
    assert await run._supervise() == "exited"  # pyright: ignore[reportPrivateUsage]
    assert run.seen.fatal is jr.READER_FAILED and run.seen.parent_fault
    await run._kill_leftovers()  # pyright: ignore[reportPrivateUsage]
    assert proc.returncode is not None
    assert decide_exit(run.payload, run.seen).provider == "none"


async def test_wrk_fr_15_signaled_host_not_provider_error(tmp_path: Path) -> None:
    """#2c: job host chết vì SIGTERM không do cha gửi → `signaled`, không đếm lỗi provider."""
    run, _ = make_run(tmp_path)
    await start(run, "kill -TERM $$")
    assert await run._supervise() == "exited"  # pyright: ignore[reportPrivateUsage]
    assert run.seen.signaled
    assert decide_exit(run.payload, run.seen).provider == "none"


async def test_wrk_fr_02_parent_stopping_no_write(tmp_path: Path) -> None:
    """#2b: cờ dừng (signal handler) → không ghi lỗi; kết quả thành công vẫn ghi."""
    run, host = make_run(tmp_path)
    host.cfg.stopping.set()
    assert run.stopping() and not run._retryable("exited")  # pyright: ignore[reportPrivateUsage]
    await run._apply("exited")  # pyright: ignore[reportPrivateUsage]
    assert host.closed == [] and host.events.forgot == [JOB.id]
    run.seen.final = Final(kind="agent_result", structured={"status": "done", "text": "x"})
    await run._apply("exited")  # pyright: ignore[reportPrivateUsage]
    assert len(host.closed) == 1 and host.closed[0].failure is None


async def test_wrk_fr_02_shutdown_reason_no_write(tmp_path: Path) -> None:
    control = JobControl()
    control.request_stop("shutdown")
    run, host = make_run(tmp_path, control)
    await run._apply("exited")  # pyright: ignore[reportPrivateUsage]
    assert host.closed == [] and host.events.forgot == [JOB.id]
    await run._apply("stopped")  # pyright: ignore[reportPrivateUsage]
    assert host.closed == []


async def test_wrk_fr_02_shutdown_after_valid_final_still_written(tmp_path: Path) -> None:
    """Review H1 v2 M3: shutdown khi đã đọc `Final` hợp lệ (`stopped`) → vẫn ghi kết quả."""
    control = JobControl()
    control.request_stop("shutdown")
    run, host = make_run(tmp_path, control)
    run.seen.final = Final(kind="agent_result", structured={"status": "done", "text": "x"})
    await run._apply("stopped")  # pyright: ignore[reportPrivateUsage]
    assert len(host.closed) == 1 and host.closed[0].failure is None
    assert host.events.forgot == []


class _FlakyPool:
    def __init__(self, fails: int) -> None:
        self.fails = fails

    @asynccontextmanager
    async def acquire(self) -> AsyncGenerator[object, None]:
        if self.fails:
            self.fails -= 1
            raise _PG.PostgresConnectionError("down")
        yield object()


async def test_wrk_fr_24_finish_retried_with_backoff(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#1: ghi "Kết thúc" lỗi DB → thử lại; hết lượt → `FinishWriteFailed` (heartbeat dọn)."""
    monkeypatch.setattr(runner, "FINISH_BACKOFF_S", (0.0, 0.0))

    async def finish_tx(*_a: object) -> Finished:
        return Finished()

    monkeypatch.setattr(runner, "finish_tx", finish_tx)
    cfg = HostConfig("w-1", tmp_path, tmp_path, tmp_path, "test", 0.1)
    tx = FinishTx(Finish("failed"), "fake-cli")
    ok = CliJobHost(_FlakyPool(2), None, cfg)  # pyright: ignore[reportArgumentType]
    assert await ok._finish(JOB, tx) == Finished()  # pyright: ignore[reportPrivateUsage]
    bad = CliJobHost(_FlakyPool(3), None, cfg)  # pyright: ignore[reportArgumentType]
    with pytest.raises(FinishWriteFailed):
        await bad._finish(JOB, tx)  # pyright: ignore[reportPrivateUsage]
