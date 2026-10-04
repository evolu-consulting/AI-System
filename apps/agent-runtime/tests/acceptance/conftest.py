"""WRK-FR-01 · fixture nhóm P (test-plan H1 §2): DB/Redis test, `Sandbox` tạm, Runtime thật.

Không giữ trạng thái chung giữa ca (CONVENTIONS §2 bẫy): mỗi ca `reset_data` + thư mục tạm riêng.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from tests.acceptance._proc import Runtime, Sandbox, kill_groups, kill_job_hosts
from tests.acceptance._rt import (
    Job,
    JobSpec,
    add_job,
    ensure_schema,
    events,
    job_row,
    owner_db_url,
    pg_connect,
    redis_client,
    reset_data,
    wait_until,
)

CLAIM_S = 5.0  # WRK-NFR-01 ≤ 2 s; ngưỡng chờ rộng (test-plan §1 "Chờ")


@dataclass
class Ctx:
    conn: Any
    rd: Any
    box: Sandbox
    runtimes: list[Runtime] = field(default_factory=list[Runtime])
    jobs: list[Job] = field(default_factory=list[Job])

    async def job(self, spec: JobSpec | None = None, **kw: Any) -> Job:
        j = await add_job(self.conn, spec or JobSpec(**kw))
        self.jobs.append(j)
        return j

    def runtime(self, worker: str = "qc-1", **env: str) -> Runtime:
        rt = Runtime(self.box, worker, env)
        self.runtimes.append(rt)
        return rt

    def alive(self) -> str | None:
        for rt in self.runtimes:
            if dead := rt.dead():
                return dead
        return None

    async def until_status(
        self, job: Job, statuses: Iterable[str], limit_s: float, watch: bool = True
    ) -> dict[str, Any]:
        want = set(statuses)

        async def cond() -> dict[str, Any] | None:
            row = await job_row(self.conn, job)
            return row if row["status"] in want else None

        what = f"job {job.id} ∈ {sorted(want)}"
        return await wait_until(cond, limit_s, what, self.alive if watch else None)

    async def until_running(self, job: Job, limit_s: float = CLAIM_S) -> dict[str, Any]:
        """`running` và đã ghi `pgid` (plan-db §5.4 "pgid")."""

        async def cond() -> dict[str, Any] | None:
            row = await job_row(self.conn, job)
            return row if row["status"] == "running" and row["pgid"] else None

        return await wait_until(cond, limit_s, f"job {job.id} running + pgid", self.alive)

    async def evs(self, job: Job) -> list[dict[str, Any]]:
        return [e for e in await events(self.rd, job.run_id) if e.get("job_id") == job.id]


@pytest.fixture(scope="session")
def schema() -> None:
    asyncio.run(ensure_schema())


@pytest.fixture
async def ctx(schema: None, tmp_path: Path) -> AsyncIterator[Ctx]:
    conn = await pg_connect(owner_db_url())
    rd = redis_client()
    await reset_data(conn)
    c = Ctx(conn, rd, Sandbox.make(tmp_path))
    try:
        yield c
    finally:
        rows: list[Any] = await conn.fetch("select pgid from hub.jobs where pgid > 0")
        pgids = [int(r["pgid"]) for r in rows]
        for rt in c.runtimes:
            rt.kill_all()
        kill_job_hosts([j.id for j in c.jobs])
        kill_groups(pgids)
        for j in c.jobs:
            await rd.delete(f"run:{j.run_id}")
        await rd.aclose()
        await conn.close()
