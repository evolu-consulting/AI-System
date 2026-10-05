"""WRK-FR-06 · AC-W06 · H2a-R13 · Q6 · RT4 · P18–P22: job `workflow.async` mồ côi được đưa lại hàng
đợi (`REQUEUE_ORPHANS` của sweeper / `REQUEUE_RESTART` khi khởi động lại cùng `WORKER_ID`) **trước**
câu `failed orphaned` H1 (`plan-runtime` §3.8, `plan-db` §2 "Requeue orphan").

Điều kiện requeue: `attempts < 3` ∧ `cancel_requested_at IS NULL` ∧
¬(`side_effect` ∧ `dispatched_at`).
Requeue xoá `token_hash`, `dispatched_at`; NOTIFY `job_enqueued{provider_key:"dify"}`; không XADD.
Trước PY-03: đỏ ở `ModuleNotFoundError` (`DifyEnv.runtime` → `need_router`).
"""

from __future__ import annotations

import json
import signal
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import pytest

from tests.acceptance._dify import DifyEnv, DifySpec, bearer, dify_env
from tests.acceptance._proc import Runtime
from tests.acceptance._rt import Job, owner_db_url, pg_connect, terminal, wait_until
from tests.acceptance.conftest import Ctx
from tests.support.dify_mock import CredentialSpec

pytestmark = pytest.mark.int

SLOW = CredentialSpec(api_key="mk-slow-1000")
SWEEP_S = 40.0  # ngưỡng orphan 5 s + chu kỳ quét 10 s + chạy lại mk-slow ~5 s, rộng


@asynccontextmanager
async def enqueued_notes() -> AsyncGenerator[list[dict[str, Any]]]:
    """LISTEN `job_enqueued` trên kết nối riêng (quan sát requeue, plan-runtime §3.8)."""
    conn = await pg_connect(owner_db_url())
    notes: list[dict[str, Any]] = []

    def on_note(_c: object, _pid: int, _ch: str, payload: str) -> None:
        notes.append(json.loads(payload))

    await conn.add_listener("job_enqueued", on_note)
    try:
        yield notes
    finally:
        await conn.close()


async def start_and_kill(d: DifyEnv, job: Job, worker: str) -> tuple[Runtime, bytes]:
    """Runtime `worker` claim + đang stream `mk-slow` → `kill -9`; trả token_hash lần claim đầu."""
    rt = d.runtime(worker)

    async def streaming() -> bool:
        return len(d.runs()) == 1

    await wait_until(streaming, 10, "Dify nhận lời gọi đầu", d.ctx.alive)
    row = await d.ctx.until_status(job, ["running"], 1)
    assert row["token_hash"] is not None and len(row["token_hash"]) == 32
    rt.signal(signal.SIGKILL)
    await rt.wait_exit(5)
    return rt, bytes(row["token_hash"])


async def test_wrk_ac_w06_p18_orphan_requeued_and_rerun(ctx: Ctx) -> None:
    """P18 · AC-W06 · `kill -9` Runtime A khi `mk-slow` → B (`AGENT_RT_ORPHAN_S=5`)
    `REQUEUE_ORPHANS` → `queued` (NOTIFY `dify`, không XADD `job.failed`) → B claim (token khác) →
    `succeeded`, `attempts=2`, `run:<id>` đúng 1 sự kiện kết thúc, `job.started` ×2."""
    async with dify_env(ctx) as d, enqueued_notes() as notes:
        job = await d.job(cred=SLOW)
        _, first_hash = await start_and_kill(d, job, "qc-a")
        d.runtime("qc-b", AGENT_RT_ORPHAN_S="5", AGENT_RT_HEARTBEAT_S="1")
        row = await ctx.until_status(job, ["succeeded"], SWEEP_S)
        assert (row["attempts"], row["worker_id"]) == (2, "qc-b")
        assert row["token_hash"] != first_hash
        assert any(n.get("job_id") == job.id and n.get("provider_key") == "dify" for n in notes)
        evs = await ctx.evs(job)
        assert [e["type"] for e in terminal(evs)] == ["job.result"]
        assert [e["type"] for e in evs].count("job.started") == 2
        tokens = {bearer(c) for c in d.creds(job)}
        assert len(tokens) == 2 and len(d.runs()) == 2


async def test_wrk_ac_w06_p19_side_effect_dispatched_orphaned(ctx: Ctx) -> None:
    """P19 · Q6 · như P18 với `side_effect` (đã `dispatched_at`) → `failed`
    `INTERNAL_ERROR`/`orphaned` (H1), không lời gọi Dify thứ 2, 1 `job.failed`."""
    async with dify_env(ctx) as d:
        job = await d.job(DifySpec(side_effect=True), SLOW)
        await start_and_kill(d, job, "qc-a")
        assert (await ctx.until_status(job, ["running"], 1))["dispatched_at"] is not None
        d.runtime("qc-b", AGENT_RT_ORPHAN_S="5", AGENT_RT_HEARTBEAT_S="1")
        row = await ctx.until_status(job, ["failed"], SWEEP_S)
        assert (row["error_code"], row["error_reason"], row["attempts"]) == (
            "INTERNAL_ERROR",
            "orphaned",
            1,
        )
        assert len(d.runs()) == 1
        assert [e["type"] for e in terminal(await ctx.evs(job))] == ["job.failed"]


async def ghost_running(d: DifyEnv, attempts: int) -> Job:
    """Job `workflow.async` `running` của worker đã chết (heartbeat −61 s), dựng bằng SQL."""
    job = await d.job()
    await d.ctx.conn.execute(
        """update hub.jobs set status = 'running', worker_id = 'qc-ghost', attempts = $2,
             started_at = now() - interval '62 seconds',
             heartbeat_at = now() - interval '61 seconds',
             token_hash = sha256(convert_to(id::text, 'UTF8'))
           where id = $1""",
        job.id,
        attempts,
    )
    return job


async def test_wrk_h2a_r13_p20_attempts_3_orphaned(ctx: Ctx) -> None:
    """P20 · R13 · mồ côi với `attempts=3` → `failed INTERNAL_ERROR/orphaned`, Dify 0 lời gọi."""
    async with dify_env(ctx) as d:
        job = await ghost_running(d, 3)
        d.runtime("qc-b", AGENT_RT_ORPHAN_S="5", AGENT_RT_HEARTBEAT_S="1")
        row = await ctx.until_status(job, ["failed"], SWEEP_S)
        assert (row["error_code"], row["error_reason"]) == ("INTERNAL_ERROR", "orphaned")
        assert len(d.runs()) == 0


async def test_wrk_h2a_r13_p20_attempts_2_requeued(ctx: Ctx) -> None:
    """P20 · R13 (biên) · mồ côi với `attempts=2` → requeue → claim lại → `succeeded`,
    `attempts=3`, 1 lời gọi Dify."""
    async with dify_env(ctx) as d:
        job = await ghost_running(d, 2)
        d.runtime("qc-b", AGENT_RT_ORPHAN_S="5", AGENT_RT_HEARTBEAT_S="1")
        row = await ctx.until_status(job, ["succeeded"], SWEEP_S)
        assert (row["attempts"], row["worker_id"]) == (3, "qc-b")
        assert len(d.runs()) == 1


async def test_wrk_rt4_p21_restart_same_worker_requeues(ctx: Ctx) -> None:
    """P21 · RT4 · `kill -9` rồi khởi động lại cùng `AGENT_RT_WORKER_ID` (ngưỡng orphan mặc định
    60 s — chỉ `REQUEUE_RESTART` mới cứu được) → job về `queued` rồi chạy lại → `succeeded`,
    `attempts=2`, không `job.failed`."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=SLOW)
        await start_and_kill(d, job, "qc-p21")
        d.runtime("qc-p21")
        row = await ctx.until_status(job, ["succeeded"], 20)
        assert (row["attempts"], row["worker_id"]) == (2, "qc-p21")
        assert [e["type"] for e in terminal(await ctx.evs(job))] == ["job.result"]


async def test_wrk_h2a_r15_p22_usage_once_after_requeue(ctx: Ctx) -> None:
    """P22 · R15 · sau requeue + chạy xong: `usage_logs` theo `job_id` đúng 1 dòng (`dify`)."""
    async with dify_env(ctx) as d:
        job = await d.job(cred=SLOW)
        await start_and_kill(d, job, "qc-p22")
        d.runtime("qc-p22")
        await ctx.until_status(job, ["succeeded"], 20)
        rows = await ctx.conn.fetch(
            "select billing, provider_key from hub.usage_logs where job_id = $1", job.id
        )
        assert [(r["billing"], r["provider_key"]) for r in rows] == [("dify", "dify")]
