"""CR-116 probe · kịch bản `claim.n`: claim N job qua `jobs_sql.claim_one` thật (pool có tap).

Chỉ chạy khi `PERF_PROBE=1` (evotest `-Step py -Probe`); tuỳ chọn: `PERF_PROBE_OPTS`.
small = 100 job / 1 provider; large = 400 job / 4 provider (như S2 của `claim_scale_int_test.py`).
Mỗi lượt: seed lại N job (ngoài khoảng đo) → N/2 lần `claim_one` tuần tự (probe `claim.one` của
mã thật, tổng `claim.batch`) rồi phần còn lại bằng 8 claimer song song (`claim.parallel`).
"""

from __future__ import annotations

import asyncio
import os
import resource
import time
from collections.abc import AsyncIterator
from typing import Any

import pytest

from agent_runtime.db import jobs_sql
from agent_runtime.db.pool import create_pool
from agent_runtime.probe import probe, probe_emit, probe_on, set_probe
from tests.acceptance._rt import (
    ACME,
    BETA,
    FAKE,
    JobSpec,
    add_job,
    ensure_schema,
    owner_db_url,
    pg_connect,
    reset_data,
    rt_db_url,
    set_provider,
)

pytestmark = [
    pytest.mark.int,
    pytest.mark.skipif(not probe_on(), reason="CR-116: chỉ chạy với PERF_PROBE=1"),
]

PROVIDERS = (FAKE, "qc-scale-1", "qc-scale-2", "qc-scale-3")
SLOTS = 100  # CHECK max_concurrency 1..100


def _opts() -> dict[str, str]:
    raw = os.environ.get("PERF_PROBE_OPTS", "")
    return dict(kv.split("=", 1) for kv in raw.replace(" ", ",").split(",") if "=" in kv)


@pytest.fixture
async def own() -> AsyncIterator[Any]:
    await ensure_schema()
    conn = await pg_connect(owner_db_url())
    try:
        yield conn
    finally:
        await conn.execute("delete from hub.jobs")
        await conn.execute("update hub.providers set enabled = false where key like 'qc-scale-%'")
        await conn.close()


async def _seed(own: Any, n: int, providers: tuple[str, ...]) -> None:
    await reset_data(own, acme_limit=n, fake_slots=SLOTS)
    for key in providers[1:]:
        await set_provider(own, key, SLOTS)
    for i in range(n):
        tenant = ACME if i % 2 else BETA
        await add_job(
            own, JobSpec(tenant=tenant, provider=providers[i % len(providers)], notify=False)
        )
    await own.execute("analyze hub.jobs")


async def _conns(own: Any) -> int:
    return int(
        await own.fetchval(
            "select count(*) from pg_stat_activity where datname = current_database()"
        )
    )


async def test_probe_claim_n(own: Any) -> None:
    o = _opts()
    runs, large = int(o.get("runs", "3")), o.get("size", "small") == "large"
    n, providers = (400, PROVIDERS) if large else (100, PROVIDERS[:1])
    probe_emit(
        "meta",
        scn="claim.n",
        pg=await own.fetchval("show server_version"),
        size=o.get("size", "small"),
    )
    pool = await create_pool(rt_db_url(), max_size=8)
    try:
        for r in range(1, runs + 1):
            await _seed(own, n, providers)
            probe_emit("scenario.start", scn="claim.n", r=r)
            t0, c0 = time.perf_counter(), time.process_time()
            with probe("claim.batch"):
                for _ in range(n // 2):
                    async with pool.acquire() as conn:
                        assert (
                            await jobs_sql.claim_one(conn, list(providers), "probe-seq") is not None
                        )

            async def claimer(i: int) -> int:
                got = 0
                async with pool.acquire() as conn:
                    while await jobs_sql.claim_one(conn, list(providers), f"probe-par-{i}"):
                        got += 1
                return got

            with probe("claim.parallel"):
                set_probe(
                    False
                )  # claim.one lồng nhau trong pha song song sẽ lẫn bộ đếm toàn tiến trình
                got = sum(await asyncio.gather(*(claimer(i) for i in range(8))))
                set_probe(True)
            assert got == n - n // 2
            probe_emit(
                "scenario.end",
                scn="claim.n",
                r=r,
                ms=round((time.perf_counter() - t0) * 1000),
                cpu=round((time.process_time() - c0) * 1000),
                rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                conns=await _conns(own),
            )
    finally:
        await pool.close()
