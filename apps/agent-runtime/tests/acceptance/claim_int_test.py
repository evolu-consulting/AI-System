"""WRK-FR-01 · WRK-FR-20 · WRK-FR-24 · WRK-BR-05 · WRK-NFR-01 · AC-W07 · AC-W08 · HUB-H1-AC-07.

P2–P7: claim/slot provider + tenant đồng thời (SQL claim nguyên văn plan-db §5.4, khoá `K_CLAIM`).
P2 chạy SQL trên schema D1 nên có thể xanh trước code Runtime (test-plan §8, chấp nhận).
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import pytest

from tests.acceptance._rt import (
    ACME,
    AGENT_A,
    AGENT_B,
    BETA,
    FAKE,
    JobSpec,
    events,
    job_row,
    new_conversation,
    pg_connect,
    reset_data,
    rt_db_url,
)
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

# plan-db §5.4 "Claim" — nguyên văn, tham số asyncpg.
K_CLAIM = "SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim'));"
CLAIM_SELECT = """SELECT j.id, j.payload FROM hub.jobs j
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
CLAIM_UPDATE = """UPDATE hub.jobs SET status = 'running', worker_id = $2, started_at = now(),
  heartbeat_at = now(), attempts = attempts + 1
WHERE id = $1 AND status = 'queued'"""


async def claim_once(conn: Any, worker: str) -> str | None:
    async with conn.transaction():
        await conn.execute(K_CLAIM)
        row = await conn.fetchrow(CLAIM_SELECT, [FAKE])
        if row is None:
            return None
        await conn.execute(CLAIM_UPDATE, row["id"], worker)
        return str(row["id"])


async def worker_loop(n: int, remaining: dict[str, int]) -> None:
    """Một kết nối `agent_runtime`: claim → giữ ~30 ms → `succeeded`; dừng khi hết job."""
    conn = await pg_connect(rt_db_url())
    try:
        while remaining["n"] > 0:
            jid = await claim_once(conn, f"qc-sql-{n}")
            if jid is None:
                await asyncio.sleep(0.01)
                continue
            await asyncio.sleep(0.03)
            await conn.execute(
                """UPDATE hub.jobs SET status = 'succeeded', finished_at = now()
                   WHERE id = $1 AND status = 'running'""",
                jid,
            )
            remaining["n"] -= 1
    finally:
        await conn.close()


async def sample(conn: Any, stop: asyncio.Event, seen: list[tuple[int, int]]) -> None:
    while not stop.is_set():
        row = await conn.fetchrow(
            """select count(*) filter (where provider_key = $1) as p,
                      count(*) filter (where tenant_id = $2) as a
               from hub.jobs where status = 'running'""",
            FAKE,
            ACME,
        )
        seen.append((int(row["p"]), int(row["a"])))
        await asyncio.sleep(0.05)


async def test_hub_h1_ac_07_claim_sql_slots_concurrent(ctx: Ctx) -> None:
    """AC-07 · 20 kết nối chạy SQL claim nguyên văn; `max_concurrency=2`, `acme` limit 1, 50 job
    2 tenant → mẫu 50 ms: provider ≤ 2, `acme` ≤ 1; mọi job `succeeded`, `attempts=1`."""
    for i in range(50):
        await ctx.job(tenant=ACME if i % 2 else BETA, notify=False)
    remaining = {"n": 50}
    stop, seen = asyncio.Event(), list[tuple[int, int]]()
    sampler = asyncio.create_task(sample(ctx.conn, stop, seen))
    async with asyncio.timeout(60):
        await asyncio.gather(*(worker_loop(n, remaining) for n in range(20)))
    stop.set()
    await sampler
    assert seen and max(p for p, _ in seen) <= 2
    assert max(a for _, a in seen) <= 1
    rows = await ctx.conn.fetch("select status, attempts from hub.jobs")
    assert {(r["status"], r["attempts"]) for r in rows} == {("succeeded", 1)}


async def test_wrk_ac_w07_tenant_full_other_tenant_gets_slot(ctx: Ctx) -> None:
    """AC-W07 · `acme` (limit 1) đang 1 job → job `acme` thứ 2 `queued`; job `beta` nhận slot."""
    busy = await ctx.job(tenant=ACME, notify=False)
    await ctx.conn.execute(
        """update hub.jobs set status = 'running', worker_id = 'qc-other', started_at = now(),
             heartbeat_at = now(), attempts = 1 where id = $1""",
        busy.id,
    )
    second = await ctx.job(tenant=ACME, prompt="#fake:sleep=30")
    other = await ctx.job(tenant=BETA, prompt="#fake:sleep=30")
    ctx.runtime()
    await ctx.until_running(other)
    assert (await job_row(ctx.conn, second))["status"] == "queued"


async def test_wrk_ac_w08_tenant_without_limit_two_parallel(ctx: Ctx) -> None:
    """AC-W08 · `beta` không giới hạn + provider 2 slot → 2 job `running` cùng lúc."""
    a = await ctx.job(tenant=BETA, prompt="#fake:sleep=30")
    b = await ctx.job(tenant=BETA, prompt="#fake:sleep=30")
    ctx.runtime()
    await ctx.until_running(a)
    await ctx.until_running(b)
    assert (await job_row(ctx.conn, a))["status"] == "running"


async def test_wrk_br_05_same_conversation_agent_sequential(ctx: Ctx) -> None:
    """BR-05 · cùng `(conversation, agent)` → job sau chờ job trước kết thúc mới `running`."""
    conv = await new_conversation(ctx.conn, BETA)
    first = await ctx.job(tenant=BETA, conv=conv, prompt="#fake:sleep=3")
    second = await ctx.job(tenant=BETA, conv=conv, prompt="nhanh")
    ctx.runtime()
    await ctx.until_running(first)
    assert (await job_row(ctx.conn, second))["status"] == "queued"
    done1 = await ctx.until_status(first, ["succeeded"], 10)
    row2 = await ctx.until_status(second, ["succeeded"], 10)
    assert row2["started_at"] >= done1["finished_at"]


async def test_wrk_br_05_other_agent_parallel(ctx: Ctx) -> None:
    """BR-05 · cùng hội thoại, khác agent → chạy song song."""
    conv = await new_conversation(ctx.conn, BETA)
    a = await ctx.job(tenant=BETA, conv=conv, agent_id=AGENT_A, prompt="#fake:sleep=30")
    b = await ctx.job(tenant=BETA, conv=conv, agent_id=AGENT_B, prompt="#fake:sleep=30")
    ctx.runtime()
    await ctx.until_running(a)
    await ctx.until_running(b)


@pytest.mark.parametrize("notify", [True, False])
async def test_wrk_nfr_01_started_within_2s(ctx: Ctx, notify: bool) -> None:
    """NFR-01 · `job.started` ≤ 2 s sau INSERT (có NOTIFY; không NOTIFY → poll 1 s)."""
    rt = ctx.runtime()
    await ctx.until_status(await ctx.job(prompt="mồi"), ["succeeded"], 15)  # Runtime đã sẵn sàng
    t0 = time.monotonic()
    job = await ctx.job(tenant=BETA, prompt="đo", notify=notify)
    while not [e for e in await ctx.evs(job) if e["type"] == "job.started"]:
        assert rt.dead() is None, rt.dead()
        assert time.monotonic() - t0 <= 2.0, "quá 2 s chưa có job.started"
        await asyncio.sleep(0.05)


async def test_hub_h1_r14_cancel_flag_not_claimed(ctx: Ctx) -> None:
    """R14 · job `queued` có `cancel_requested_at` không bị claim (job sau vẫn chạy)."""
    flagged = await ctx.job(spec=JobSpec(tenant=BETA, cancel=True))
    normal = await ctx.job(tenant=BETA)
    ctx.runtime()
    await ctx.until_status(normal, ["succeeded"], 15)
    row = await job_row(ctx.conn, flagged)
    assert (row["status"], row["attempts"], row["worker_id"]) == ("queued", 0, None)
    assert await events(ctx.rd, flagged.run_id) == []


async def test_wrk_fr_24_slot_freed_after_finish(ctx: Ctx) -> None:
    """FR-24 · provider 1 slot: job 2 chỉ `running` sau khi job 1 rời `running`."""
    await reset_data(ctx.conn, acme_limit=None, fake_slots=1)
    a = await ctx.job(tenant=BETA, prompt="#fake:sleep=2")
    b = await ctx.job(tenant=ACME, prompt="ok")
    ctx.runtime()
    await ctx.until_running(a)
    assert (await job_row(ctx.conn, b))["status"] == "queued"
    await ctx.until_status(b, ["succeeded"], 15)
    started = [json.dumps(e) for e in await ctx.evs(b) if e["type"] == "job.started"]
    assert len(started) == 1
