"""WRK-FR-06 · WRK-FR-07 · HUB-FR-80 · H2a-R10 · R12 · R15 · R17 · RT5 · RT6 · AC-W06 —
`DifyJobHost`: job `workflow.async` chạy **trong process cha** (chỉ HTTP, không process con;
`plan-runtime` §1, §3.1).

`run(job, control)`: validate payload (`JobPayloadWorkflowAsync`, sai → `INTERNAL_ERROR`/
`invalid_payload`) → `DifyRun` (credential + vòng thử) dưới `asyncio.timeout(payload.timeout_s)`
(gồm credential, các lần thử, backoff). Dừng sớm (§3.6): `cancel` → huỷ task (đóng stream) →
`stop(task_id)` best-effort → `cancelled` · timeout → như huỷ → `timed_out` · `lost`/`shutdown` →
huỷ task, **không** stop, không ghi (cha/worker khác lo SQL requeue/orphan).
Kết thúc (`-dify` §3.7): một transaction `jobs` + `usage_logs` (`billing=dify`, chỉ khi đã có lời
gọi Dify trả về) rồi XADD sau commit; 0 dòng → không XADD. Không đụng `provider_state` (RT6).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Protocol

import httpx2
from pydantic import ValidationError

from agent_runtime.contracts.hub import JobPayloadWorkflowAsync
from agent_runtime.db import jobs_sql, workflow_sql
from agent_runtime.db.jobs_sql import ClaimedJob, Finish
from agent_runtime.db.pool import DB_ERRORS, Pool
from agent_runtime.db.workflow_sql import DifyUsage
from agent_runtime.events.job_events import Failure, RunEvents, Tokens
from agent_runtime.log import bind_job, get_logger
from agent_runtime.runtimes.dify.job_run import DifyRun, LostJob, Outcome
from agent_runtime.runtimes.dify.policy import BACKOFF

CANCELLED = Failure("cancelled", "CANCELLED", "cancelled", "job cancelled")
TIMED_OUT = Failure("timed_out", "TIMEOUT", "timeout", "job timed out")
INVALID_PAYLOAD = Failure("failed", "INTERNAL_ERROR", "invalid_payload", "invalid job payload")
CRASHED = Failure("failed", "INTERNAL_ERROR", "crash", "job host failed")
FINISH_BACKOFF_S = (0.5, 1.0, 2.0)  # ghi "Kết thúc" lỗi DB → thử lại (như CLI)


class StopControl(Protocol):
    """= `queue.host.JobControl` (lớp `runtimes` không import `queue`)."""

    @property
    def stopped(self) -> asyncio.Event: ...
    @property
    def reason(self) -> str | None: ...


@dataclass(frozen=True)
class DifyConfig:
    worker_id: str
    hub_url: str  # `AGENT_RT_HUB_URL` (bắt buộc khi `dify` ∈ `AGENT_RT_PROVIDERS`)
    backoff: tuple[float, ...] = BACKOFF
    read_timeout_s: float = 30.0
    stop_timeout_s: float = 2.0
    # Chỉ test đơn vị (`httpx2.MockTransport`); None = mạng thật.
    hub_transport: httpx2.AsyncBaseTransport | None = field(default=None, compare=False)
    dify_transport: httpx2.AsyncBaseTransport | None = field(default=None, compare=False)


class FinishWriteFailed(Exception):
    """Ghi "Kết thúc" hết lượt thử: lên Supervisor; heartbeat/sweeper xử lý job lạc."""


class DifyJobHost:
    """`JobHost` (queue/host.py) cho job `workflow.async`."""

    def __init__(self, pool: Pool, events: RunEvents, cfg: DifyConfig) -> None:
        self.pool, self.events, self.cfg = pool, events, cfg

    async def run(self, job: ClaimedJob, control: StopControl) -> None:
        tenant = str(job.payload.get("tenant_id", ""))
        with bind_job(job.id, job.run_id, tenant):
            try:
                payload = JobPayloadWorkflowAsync.model_validate(job.payload)
            except ValidationError:
                await self.close(job, None, Outcome(INVALID_PAYLOAD))
                return
            run = DifyRun(self, job, payload)
            try:
                outcome = await self._supervise(run, control)
            except Exception as err:  # lỗi lập trình/IO lạ: không để job `running` mãi
                get_logger().error("job.host_failed", error=type(err).__name__)
                outcome = Outcome(CRASHED, usage=run.usage())
            finally:
                await run.progress.close()
            if outcome is None:
                self.events.forget(job.id)
                return
            await self.close(job, payload, outcome)

    async def _supervise(self, run: DifyRun, control: StopControl) -> Outcome | None:
        """Chạy `run` tới khi xong / hết giờ / bị dừng. None = không ghi (`lost`, `shutdown`)."""
        work = asyncio.create_task(self._timed(run))
        waiter = asyncio.create_task(control.stopped.wait())
        try:
            await asyncio.wait({work, waiter}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            waiter.cancel()
            work.cancel()  # đã xong thì vô hiệu
            [res] = await asyncio.gather(work, return_exceptions=True)
        if isinstance(res, Outcome):
            return res
        if isinstance(res, asyncio.CancelledError):
            return await self._stopped(run, control.reason)
        if isinstance(res, TimeoutError):
            await run.stop()
            return Outcome(TIMED_OUT, usage=run.usage())
        if isinstance(res, LostJob):
            get_logger().warning("job.dispatch_lost")
            return None
        raise res

    async def _stopped(self, run: DifyRun, reason: str | None) -> Outcome | None:
        if reason != "cancel":  # `lost` / `shutdown`: worker khác có thể đang chạy lại
            return None
        await run.stop()
        return Outcome(CANCELLED, usage=run.usage())

    @staticmethod
    async def _timed(run: DifyRun) -> Outcome:
        async with asyncio.timeout(run.p.timeout_s):
            return await run.execute()

    # ---------- Kết thúc (§3.7) ----------

    async def close(
        self, job: ClaimedJob, payload: JobPayloadWorkflowAsync | None, outcome: Outcome
    ) -> None:
        f, u = outcome.failure, outcome.usage
        usage = _usage_row(payload, outcome) if payload is not None else None
        tokens = Tokens(u.input_tokens, u.output_tokens) if u is not None and usage else Tokens()
        output = {"kind": "text", "text": outcome.text or ""}
        if f is None:
            finish = Finish("succeeded", result=output)
        else:
            finish = Finish(f.status, None, f.code, f.reason, f.message)
        written = await self._write(job, (finish, usage))
        get_logger().info(
            "job.finished", status=finish.status, code=finish.error_code, written=written
        )
        if not written:
            self.events.forget(job.id)
        elif f is None:
            await self.events.result(job, output, tokens, False)
        else:
            await self.events.failed(job.id, job.run_id, f, tokens)

    async def _write(self, job: ClaimedJob, done: tuple[Finish, DifyUsage | None]) -> bool:
        """Lỗi DB → thử lại có backoff; lần sau 0 dòng mà job đã ở đúng trạng thái → mất ack."""
        retried = False
        for wait_s in (*FINISH_BACKOFF_S, None):
            try:
                async with self.pool.acquire() as conn:
                    if await workflow_sql.finish_dify(conn, job.id, self.cfg.worker_id, done):
                        return True
                    return retried and await jobs_sql.finished_as(
                        conn, job.id, self.cfg.worker_id, done[0]
                    )
            except DB_ERRORS as err:
                if wait_s is None:
                    raise FinishWriteFailed from err
                retried = True
                get_logger().warning("job.finish_retry", error=type(err).__name__)
                await asyncio.sleep(wait_s)
        return False


def _usage_row(p: JobPayloadWorkflowAsync, outcome: Outcome) -> DifyUsage | None:
    u = outcome.usage
    if u is None:
        return None
    return DifyUsage(
        tenant_id=p.tenant_id,
        run_id=p.run_id,
        step_id=p.step_id,
        user_id=p.user_id,
        feature_id=p.feature_id,
        input_tokens=u.input_tokens,
        output_tokens=u.output_tokens,
        cost_usd=u.cost_usd,
        latency_ms=u.latency_ms,
    )
