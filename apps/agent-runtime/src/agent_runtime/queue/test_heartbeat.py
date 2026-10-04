"""WRK-FR-23 · WRK-FR-24 · WRK-FR-01 — review H1 #1/#4/#6 (unit): job `running` của `worker_id` mà
process không giữ → `orphaned` sau hai heartbeat; `job.started` trước `Supervisor.start`; vòng nền
chịu lỗi Postgres."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import asyncpg  # pyright: ignore[reportMissingTypeStubs]
import pytest

from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import ClaimedJob, OrphanRow
from agent_runtime.queue.claimer import Claimer
from agent_runtime.queue.heartbeat import Heartbeat, strays
from agent_runtime.queue.host import JobControl
from agent_runtime.queue.supervisor import Supervisor
from agent_runtime.queue.sweeper import SweepConfig, run_sweeper

GHOST = "c3000000-0000-4000-8000-0000000000aa"
HELD = "c3000000-0000-4000-8000-0000000000bb"
WORKER = "w-1"
_PG: Any = asyncpg


class _Conn:
    def __init__(self, beat: dict[str, bool]) -> None:
        self.beat = beat
        self.orphaned: list[tuple[str, str]] = []

    async def fetch(self, query: str, *args: object) -> list[dict[str, object]]:
        assert query == jobs_sql.HEARTBEAT and args == (WORKER,)
        return [{"id": k, "cancel": v} for k, v in self.beat.items()]

    async def fetchrow(self, query: str, *args: object) -> dict[str, object] | None:
        assert query == jobs_sql.ORPHAN_ONE
        job_id, worker = str(args[0]), str(args[1])
        self.orphaned.append((job_id, worker))
        return {"id": job_id, "run_id": "r1", "pgid": None}


class _Pool:
    def __init__(self, conn: Any, fail: BaseException | None = None) -> None:
        self.conn, self.fail = conn, fail

    @asynccontextmanager
    async def acquire(self) -> AsyncGenerator[Any, None]:
        if self.fail is not None:
            raise self.fail
        yield self.conn

    async def close(self) -> None: ...


class _Events:
    def __init__(self, sup: Supervisor | None = None) -> None:
        self.orphans: list[str] = []
        self.started_held: list[list[str]] = []
        self.sup = sup

    async def started(self, job: ClaimedJob) -> None:
        assert self.sup is not None
        self.started_held.append(self.sup.held())

    async def orphaned(self, row: OrphanRow) -> None:
        self.orphans.append(row.id)


class _Host:
    async def run(self, job: ClaimedJob, control: JobControl) -> None:
        await control.stopped.wait()


def _hb(conn: _Conn, sup: Supervisor, events: _Events) -> Heartbeat:
    return Heartbeat(_Pool(conn), sup, events, SweepConfig(WORKER, 60, 0.1))  # pyright: ignore[reportArgumentType]


def test_wrk_fr_23_strays_need_two_beats() -> None:
    beat = {GHOST: False, HELD: False}
    confirmed, suspects = strays(beat, [HELD], set())
    assert (confirmed, suspects) == (set(), {GHOST})
    confirmed, suspects = strays(beat, [HELD], suspects)
    assert (confirmed, suspects) == ({GHOST}, set())
    # job vừa claim chưa `start` (lạc 1 lần) rồi được giữ → không bao giờ orphan
    assert strays(beat, [HELD, GHOST], {GHOST}) == (set(), set())


async def test_wrk_fr_24_ghost_job_orphaned_and_slot_freed() -> None:
    """Task job đã thoát (ghi kết thúc lỗi DB) nhưng dòng còn `running`: heartbeat lần 2 →
    SQL `orphaned` theo `worker_id` + XADD; job đang giữ không bị đụng."""
    sup = Supervisor(_Host())
    sup.start(ClaimedJob(HELD, {"run_id": "r"}))
    await asyncio.sleep(0)
    conn, events = _Conn({GHOST: False, HELD: False}), _Events()
    hb = _hb(conn, sup, events)
    assert await hb.beat_once() == 0 and conn.orphaned == []
    assert await hb.beat_once() == 1
    assert conn.orphaned == [(GHOST, WORKER)] and events.orphans == [GHOST]
    assert sup.holds(HELD)
    await sup.shutdown(1)


@pytest.mark.parametrize(
    "err", [_PG.PostgresConnectionError("down"), _PG.InterfaceError("closed"), OSError("x")]
)
async def test_wrk_fr_02_heartbeat_survives_db_errors(err: BaseException) -> None:
    sup = Supervisor(_Host())
    hb = Heartbeat(_Pool(None, err), sup, _Events(), SweepConfig(WORKER, 60, 0.1))  # pyright: ignore[reportArgumentType]
    cfg = SweepConfig(WORKER, 0.01, 0.1)
    tasks = [
        asyncio.create_task(hb.run(0.01)),
        asyncio.create_task(run_sweeper(_Pool(None, err), _Events(), sup, cfg)),  # pyright: ignore[reportArgumentType]
    ]
    await asyncio.sleep(0.05)
    assert not any(t.done() for t in tasks)
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def test_wrk_fr_01_started_xadd_before_supervisor_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = [ClaimedJob(HELD, {"run_id": "r"}), None]

    async def claim_one(_c: object, _p: list[str], _w: str) -> ClaimedJob | None:
        return jobs.pop(0)

    monkeypatch.setattr(jobs_sql, "claim_one", claim_one)
    sup = Supervisor(_Host())
    events = _Events(sup)
    claimer = Claimer(_Pool(object()), sup, events, ["fake-cli"])  # pyright: ignore[reportArgumentType]
    assert await claimer.claim_ready(WORKER) == 1
    assert events.started_held == [[]] and sup.holds(HELD)
    await sup.shutdown(1)
