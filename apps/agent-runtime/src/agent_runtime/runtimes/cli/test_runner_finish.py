"""WRK-FR-24 · WRK-FR-14 · review H1 v2 M1/M2 (unit) — `CliJobHost`: ghi "Kết thúc" hết lượt thử
đi thẳng lên Supervisor (không thêm vòng `crashed`); commit thành công mà mất ack → lần sau 0 dòng
vẫn XADD đúng một lần nếu job của mình đã ở đúng trạng thái kết thúc."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import asyncpg  # pyright: ignore[reportMissingTypeStubs]
import pytest

from agent_runtime.db import jobs_sql
from agent_runtime.db.finish_sql import FinishTx
from agent_runtime.db.jobs_sql import ClaimedJob, Finish
from agent_runtime.events.job_events import Tokens
from agent_runtime.runtimes.cli import runner
from agent_runtime.runtimes.cli.outcome import Verdict
from agent_runtime.runtimes.cli.runner import CliJobHost, FinishWriteFailed, HostConfig
from agent_runtime.runtimes.cli.test_runner import payload

_PG: Any = asyncpg
JOB = ClaimedJob("c3000000-0000-4000-8000-000000000002", {"run_id": "r"})
TX = FinishTx(Finish("succeeded", result={"x": 1}), "fake-cli")


class _Pool:
    @asynccontextmanager
    async def acquire(self) -> AsyncGenerator[object, None]:
        yield object()


class _Events:
    def __init__(self) -> None:
        self.results: list[str] = []

    async def result(self, job: ClaimedJob, *_a: object) -> None:
        self.results.append(job.id)

    def forget(self, job_id: str) -> None: ...


def _host(tmp_path: Path) -> tuple[CliJobHost, _Events]:
    cfg = HostConfig("w-1", tmp_path, tmp_path, tmp_path, "test", 0.1)
    events = _Events()
    return CliJobHost(_Pool(), events, cfg), events  # pyright: ignore[reportArgumentType]


def _flaky_finish(monkeypatch: pytest.MonkeyPatch, outcomes: list[object]) -> list[int]:
    """`finish_tx` lần lượt: Exception → ném, còn lại → trả. Trả bộ đếm số lần gọi."""
    calls = [0]
    monkeypatch.setattr(runner, "FINISH_BACKOFF_S", (0.0, 0.0, 0.0))

    async def finish_tx(*_a: object) -> object:
        calls[0] += 1
        out = outcomes.pop(0) if outcomes else _PG.PostgresConnectionError("down")
        if isinstance(out, Exception):
            raise out
        return out

    monkeypatch.setattr(runner, "finish_tx", finish_tx)
    return calls


async def test_wrk_fr_24_finish_exhausted_goes_to_supervisor(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """M1: hết lượt thử → `FinishWriteFailed` ra khỏi `run()`, không `finish_failed(CRASHED)`
    (không thêm vòng ghi có thể đè kết quả thành công)."""
    host, _ = _host(tmp_path)
    calls = _flaky_finish(monkeypatch, [])
    crashed: list[object] = []

    async def finish_failed(job: ClaimedJob, f: object) -> None:
        crashed.append(f)

    class _Run:
        def __init__(self, h: CliJobHost, job: ClaimedJob, *_a: object) -> None:
            self.h, self.job = h, job

        async def execute(self) -> None:
            await self.h.close(self.job, TX, Verdict(None, {"x": 1}), Tokens())

    monkeypatch.setattr(runner, "JobRun", _Run)
    monkeypatch.setattr(host, "finish_failed", finish_failed)
    job = ClaimedJob(JOB.id, payload().model_dump(mode="json", by_alias=True))
    with pytest.raises(FinishWriteFailed):
        await host.run(job, None)  # pyright: ignore[reportArgumentType]
    assert crashed == [] and calls[0] == 4


async def test_wrk_fr_24_finish_ack_lost_still_xadds_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """M2: lần 1 commit nhưng mất ack (lỗi), lần 2 0 dòng, job của mình đã `succeeded`
    → XADD đúng 1 lần."""
    host, events = _host(tmp_path)
    _flaky_finish(monkeypatch, [_PG.PostgresConnectionError("ack lost"), None])
    seen: list[Finish] = []

    async def finished_as(_c: object, job_id: str, worker: str, f: Finish) -> bool:
        seen.append(f)
        return (job_id, worker) == (JOB.id, "w-1") and f == TX.finish

    monkeypatch.setattr(jobs_sql, "finished_as", finished_as)
    await host.close(JOB, TX, Verdict(None, {"x": 1}), Tokens())
    assert events.results == [JOB.id] and seen == [TX.finish]


async def test_wrk_fr_24_zero_rows_without_retry_no_xadd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """0 dòng ở lần đầu (job không còn của mình) → không đọc lại, không XADD (R2)."""
    host, events = _host(tmp_path)
    _flaky_finish(monkeypatch, [None])

    async def finished_as(*_a: object) -> bool:
        raise AssertionError("không được gọi")

    monkeypatch.setattr(jobs_sql, "finished_as", finished_as)
    await host.close(JOB, TX, Verdict(None, {"x": 1}), Tokens())
    assert events.results == []
    _flaky_finish(monkeypatch, [_PG.PostgresConnectionError("x"), None])

    async def not_mine(*_a: object) -> bool:
        return False

    monkeypatch.setattr(jobs_sql, "finished_as", not_mine)
    await host.close(JOB, TX, Verdict(None, {"x": 1}), Tokens())
    assert events.results == []
