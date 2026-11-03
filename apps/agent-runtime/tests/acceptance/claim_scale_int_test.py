"""WRK-FR-01 · WRK-FR-20 · WRK-FR-24 · WRK-NFR-01 · CR-114 hub-claim-scale — claim song song nhiều
worker qua `jobs_sql.claim_one` thật (khoá theo provider + tenant, không còn `K_CLAIM` toàn cục).

S1: N claimer song song, nhiều provider × 2 tenant ⇒ `running` mỗi provider ≤ `max_concurrency`,
tenant giới hạn ≤ `max_concurrent_sub` (gộp mọi provider subscription), provider `cooldown` chưa
hết hạn 0 claim, không job claim 2 lần (`attempts = 1`, id không lặp).
S2 (perf): claim/s khoá toàn cục cũ (mốc giữ trong test) vs `claim_one` mới, 4 provider,
16 claimer.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import pytest

from agent_runtime.db import jobs_sql
from tests.acceptance._rt import (
    ACME,
    BETA,
    FAKE,
    JobSpec,
    add_job,
    owner_db_url,
    pg_connect,
    reset_data,
    rt_db_url,
    set_provider,
)

pytestmark = pytest.mark.int

P1, P2, PCD = "qc-scale-1", "qc-scale-2", "qc-scale-cd"
CAPS = {FAKE: 3, P1: 2, P2: 4}
ACME_LIMIT = 2
CLAIMERS = 16
PERF_PROVIDERS = (FAKE, "qc-scale-1", "qc-scale-2", "qc-scale-3")
PERF_JOBS = 400
PERF_SLOTS = 100  # CHECK max_concurrency 1..100; 4 × 100 = 400
PERF_MIN_SPEEDUP = 1.3  # khoá theo provider phải nhanh hơn khoá toàn cục ≥ 1.3× (4 provider)

# Mốc "trước" (CR-114): khoá toàn cục 1 khoá + câu claim nguyên văn bản cũ (plan-db §5.4).
OLD_K_CLAIM = "SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim'));"
OLD_CLAIM_SELECT = """SELECT j.id, j.payload FROM hub.jobs j
JOIN hub.providers p ON p.key = j.provider_key AND p.enabled
LEFT JOIN hub.provider_state s ON s.provider_key = p.key
WHERE j.status = 'queued' AND j.cancel_requested_at IS NULL
  AND j.provider_key = ANY($1::text[])
  AND (s.status IS NULL OR s.status IN ('ok','busy')
       OR (s.status = 'cooldown' AND s.cooldown_until <= now()))
  AND (SELECT count(*) FROM hub.jobs r WHERE r.status = 'running'
       AND r.provider_key = j.provider_key) < p.max_concurrency
  AND (p.kind <> 'subscription' OR hub.tenant_sub_limit(j.tenant_id) IS NULL
       OR (SELECT count(*) FROM hub.jobs r JOIN hub.providers rp ON rp.key = r.provider_key
           WHERE r.status = 'running' AND r.tenant_id = j.tenant_id AND rp.kind = 'subscription')
          < hub.tenant_sub_limit(j.tenant_id))
  AND NOT EXISTS (SELECT 1 FROM hub.jobs b
       WHERE b.conversation_id = j.conversation_id AND b.agent_id = j.agent_id
         AND (b.status = 'running' OR (b.status = 'queued'
              AND (b.priority, b.created_at, b.id) < (j.priority, j.created_at, j.id))))
ORDER BY j.priority, j.created_at, j.id
LIMIT 1
FOR UPDATE OF j SKIP LOCKED"""

ClaimFn = Callable[[Any, list[str], str], Awaitable[str | None]]


async def claim_new(conn: Any, providers: list[str], worker: str) -> str | None:
    job = await jobs_sql.claim_one(conn, providers, worker)
    return None if job is None else job.id


async def claim_old(
    conn: Any, providers: list[str], worker: str, sql: str = OLD_CLAIM_SELECT
) -> str | None:
    _, digest = jobs_sql.new_token()
    async with conn.transaction():
        await conn.execute(OLD_K_CLAIM)
        row = await conn.fetchrow(sql, providers)
        if row is None:
            return None
        await conn.execute(jobs_sql.CLAIM_UPDATE, row["id"], worker, digest)
        return str(row["id"])


@pytest.fixture
async def own(schema: None) -> AsyncIterator[Any]:
    conn = await pg_connect(owner_db_url())
    await reset_data(conn, acme_limit=ACME_LIMIT, fake_slots=CAPS[FAKE])
    try:
        yield conn
    finally:
        await conn.execute("delete from hub.jobs")
        await conn.execute("delete from hub.provider_state where provider_key like 'qc-scale-%'")
        await conn.execute("update hub.providers set enabled = false where key like 'qc-scale-%'")
        await conn.close()


async def add_jobs(conn: Any, n: int, providers: tuple[str, ...]) -> None:
    for i in range(n):
        tenant = ACME if i % 2 else BETA
        await add_job(
            conn, JobSpec(tenant=tenant, provider=providers[i % len(providers)], notify=False)
        )


COUNTS = """select coalesce(jsonb_object_agg(provider_key, n), '{}'::jsonb)::text as per_p,
  (select count(*) from hub.jobs r join hub.providers rp on rp.key = r.provider_key
   where r.status = 'running' and r.tenant_id = $1 and rp.kind = 'subscription') as acme
from (select provider_key, count(*) as n from hub.jobs where status = 'running'
      group by provider_key) t"""


async def snapshot(conn: Any) -> tuple[dict[str, int], int]:
    row = await conn.fetchrow(COUNTS, ACME)
    return {k: int(v) for k, v in json.loads(row["per_p"]).items()}, int(row["acme"])


def check(seen: list[tuple[dict[str, int], int]]) -> None:
    for per_p, acme in seen:
        for key, n in per_p.items():
            assert n <= CAPS.get(key, 0), f"{key} running {n} > {CAPS.get(key, 0)}"
        assert acme <= ACME_LIMIT, f"acme running {acme} > {ACME_LIMIT}"


async def worker(n: int, left: dict[str, int], claimed: list[str], seen: list[Any]) -> None:
    """Một kết nối `agent_runtime`: claim → tự kiểm số đếm → giữ ~10 ms → `succeeded`."""
    conn = await pg_connect(rt_db_url())
    sandbox = (1,) if n % 2 else ()  # nửa số worker đi nhánh SQL slot tự-sửa (P-c1)
    keys = [FAKE, P1, P2, PCD]
    try:
        while left["n"] > 0:
            job = await jobs_sql.claim_one(conn, keys, f"qc-scale-{n}", *sandbox)
            if job is None:
                await asyncio.sleep(0.005)  # slot đang bị worker khác giữ: mô phỏng chờ NOTIFY
                continue
            claimed.append(job.id)
            seen.append(await snapshot(conn))
            await asyncio.sleep(0.01)  # mô phỏng job chạy
            await conn.execute(
                """update hub.jobs set status = 'succeeded', finished_at = now()
                   where id = $1 and status = 'running'""",
                job.id,
            )
            left["n"] -= 1
    finally:
        await conn.close()


async def sampler(stop: asyncio.Event, seen: list[Any]) -> None:
    conn = await pg_connect(owner_db_url())
    try:
        while not stop.is_set():
            seen.append(await snapshot(conn))
            await asyncio.sleep(0.003)
    finally:
        await conn.close()


async def test_cr114_s1_parallel_claimers_never_exceed_caps(own: Any) -> None:
    """S1 · 16 claimer, provider 3/2/4 slot, `acme` limit 2 ⇒ không vượt slot, cooldown 0 claim,
    mỗi job đúng 1 lần."""
    await set_provider(own, P1, CAPS[P1])
    await set_provider(own, P2, CAPS[P2])
    await set_provider(own, PCD, 5)
    await own.execute(
        """insert into hub.provider_state (provider_key, status, cooldown_until)
           values ($1, 'cooldown', now() + interval '1 hour')""",
        PCD,
    )
    await add_jobs(own, 90, (FAKE, P1, P2))
    await add_jobs(own, 6, (PCD,))
    left, claimed, seen = {"n": 90}, list[str](), list[Any]()
    stop = asyncio.Event()
    sample = asyncio.create_task(sampler(stop, seen))
    async with asyncio.timeout(90):
        await asyncio.gather(*(worker(n, left, claimed, seen) for n in range(CLAIMERS)))
    stop.set()
    await sample
    check(seen)
    assert len(claimed) == 90 and len(set(claimed)) == 90
    rows = await own.fetch("select provider_key, status, attempts from hub.jobs")
    done = {(r["status"], r["attempts"]) for r in rows if r["provider_key"] != PCD}
    assert done == {("succeeded", 1)}
    cool = {(r["status"], r["attempts"]) for r in rows if r["provider_key"] == PCD}
    assert cool == {("queued", 0)}


async def claim_all(fn: ClaimFn, total: int) -> float:
    """16 claimer chỉ claim (không kết thúc) tới khi đủ `total`; trả số claim/s."""
    conns = [await pg_connect(rt_db_url()) for _ in range(CLAIMERS)]
    got: list[str] = []

    async def loop(i: int) -> None:
        while (jid := await fn(conns[i], list(PERF_PROVIDERS), f"qc-perf-{i}")) is not None:
            got.append(jid)

    try:
        t0 = time.perf_counter()
        await asyncio.gather(*(loop(i) for i in range(CLAIMERS)))
        dt = time.perf_counter() - t0
    finally:
        for c in conns:
            await c.close()
    assert len(got) == total and len(set(got)) == total
    return total / dt


async def test_cr114_s2_perf_claims_per_second(own: Any) -> None:
    """S2 · 400 job, 4 provider, 16 claimer: claim/s khoá theo provider ≥ 1.3× khoá toàn cục."""
    await reset_data(own, acme_limit=PERF_JOBS, fake_slots=PERF_SLOTS)
    for key in PERF_PROVIDERS[1:]:
        await set_provider(own, key, PERF_SLOTS)
    rates: dict[str, float] = {}

    async def claim_mid(conn: Any, providers: list[str], worker: str) -> str | None:
        """Khoá toàn cục cũ + câu claim mới (tách phần lợi của SQL theo tập khỏi khoá)."""
        return await claim_old(conn, providers, worker, jobs_sql.CLAIM_SELECT)

    for name, fn in (("old", claim_old), ("mid", claim_mid), ("new", claim_new)):
        await own.execute("delete from hub.jobs")
        await add_jobs(own, PERF_JOBS, PERF_PROVIDERS)
        await own.execute("analyze hub.jobs")
        rates[name] = await claim_all(fn, PERF_JOBS)
    print(f"\nCR-114 claim/s: {' '.join(f'{k}={v:.1f}' for k, v in rates.items())}")  # noqa: T201
    assert rates["new"] >= PERF_MIN_SPEEDUP * rates["old"], rates
