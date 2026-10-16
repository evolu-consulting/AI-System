"""DLC-R01 · DLC-R08 · DLC-R09 — `DlcJobHost`: job `agent.cli` có `provider_key = dlc` chạy **trong
process cha** (chỉ HTTP tới engine AI SDLC, không process con, không CLI — như `DifyJobHost`).

`run(job, control)`: validate `JobPayload1` (sai → `INTERNAL_ERROR`/`invalid_payload`) → đọc
`DlcState` từ `hub.cli_sessions` → `DlcRun` dưới `asyncio.timeout(timeout_s)`. Huỷ → `cancelled`
(run DLC **không** bị huỷ) · hết giờ → `timed_out` (bình thường `DlcRun` đã trả lời trước hạn) ·
`lost`/`shutdown` → không ghi. Kết thúc: một transaction `jobs` + `usage_logs` (0 token, `model =
dlc`) + `cli_sessions` (`DlcState` mới), rồi XADD `job.result{agent_result done}` sau commit. Không
đụng `provider_state`.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

import httpx2
from pydantic import ValidationError

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import finish_sql, sessions_sql
from agent_runtime.db.finish_sql import FinishTx
from agent_runtime.db.jobs_sql import ClaimedJob, Finish
from agent_runtime.db.pool import DB_ERRORS, Pool
from agent_runtime.db.sessions_sql import SessionKey
from agent_runtime.db.usage_sql import UsageKeys, UsageRow
from agent_runtime.events.job_events import Failure, RunEvents, Tokens
from agent_runtime.log import bind_job, get_logger
from agent_runtime.runtimes.dispatch import StopControl
from agent_runtime.runtimes.dlc.client import DlcClient, TokenSource
from agent_runtime.runtimes.dlc.job_run import DlcRun, DlcState, Outcome

PROVIDER_KEY = "dlc"
TEXT_MAX = 64_000  # `AgentResult.text` (AGENT_TEXT_MAX)
CANCELLED = Failure("cancelled", "CANCELLED", "cancelled", "job cancelled")
TIMED_OUT = Failure("timed_out", "TIMEOUT", "timeout", "job timed out")
INVALID_PAYLOAD = Failure("failed", "INTERNAL_ERROR", "invalid_payload", "invalid job payload")
CRASHED = Failure("failed", "INTERNAL_ERROR", "crash", "job host failed")
FINISH_BACKOFF_S = (0.5, 1.0, 2.0)


@dataclass(frozen=True)
class DlcConfig:
    worker_id: str
    base_url: str  # `AGENT_RT_DLC_URL`
    hub_url: str | None = None  # tải spec đính kèm (`AGENT_RT_HUB_URL`)
    tokens: TokenSource | None = field(default=None, compare=False)
    poll_s: float = 15.0
    human_mode: str | None = None  # ask | decide | None (= mặc định của engine)
    # Chỉ test đơn vị (`httpx2.MockTransport`); None = mạng thật.
    transport: httpx2.AsyncBaseTransport | None = field(default=None, compare=False)
    hub_transport: httpx2.AsyncBaseTransport | None = field(default=None, compare=False)


class JobTimedOut(Exception):
    """Hết `payload.timeout_s` của lần claim."""


class DlcJobHost:
    """`JobHost` (queue/host.py) cho job `agent.cli` của provider `dlc`."""

    def __init__(self, pool: Pool, events: RunEvents, cfg: DlcConfig) -> None:
        self.pool, self.events, self.cfg = pool, events, cfg

    def client(self) -> DlcClient:
        return DlcClient(self.cfg.base_url, self.cfg.tokens, self.cfg.transport)

    async def run(self, job: ClaimedJob, control: StopControl) -> None:
        tenant = str(job.payload.get("tenant_id", ""))
        with bind_job(job.id, job.run_id, tenant):
            try:
                payload = JobPayload1.model_validate(job.payload)
            except ValidationError:
                await self.close(job, None, Outcome(INVALID_PAYLOAD))
                return
            started = time.monotonic()
            await self.events.started(job)
            try:
                outcome = await self._supervise(job, payload, control)
            except Exception as err:  # lỗi lập trình/IO lạ: không để job `running` mãi
                get_logger().error("job.host_failed", error=type(err).__name__)
                outcome = Outcome(CRASHED)
            if outcome is None:
                self.events.forget(job.id)
                return
            await self.close(job, payload, outcome, int((time.monotonic() - started) * 1000))

    async def _supervise(
        self, job: ClaimedJob, p: JobPayload1, control: StopControl
    ) -> Outcome | None:
        state = await self._load_state(p)
        work = asyncio.create_task(self._timed(DlcRun(self, job, p, state)))
        waiter = asyncio.create_task(control.stopped.wait())
        try:
            await asyncio.wait({work, waiter}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            waiter.cancel()
            work.cancel()
            [res] = await asyncio.gather(work, return_exceptions=True)
        if isinstance(res, Outcome):
            return res
        if isinstance(res, asyncio.CancelledError):
            return Outcome(CANCELLED) if control.reason == "cancel" else None
        if isinstance(res, JobTimedOut):
            return Outcome(TIMED_OUT)
        raise res

    @staticmethod
    async def _timed(run: DlcRun) -> Outcome:
        deadline = asyncio.timeout(run.p.timeout_s)
        try:
            async with deadline:
                return await run.execute()
        except TimeoutError as err:
            if deadline.expired():
                raise JobTimedOut from err
            raise

    async def _load_state(self, p: JobPayload1) -> DlcState:
        async with self.pool.acquire() as conn:
            raw = await sessions_sql.find_session(conn, _session_key(p))
        return DlcState.decode(raw)

    # ---------- Kết thúc ----------

    async def close(
        self, job: ClaimedJob, p: JobPayload1 | None, outcome: Outcome, latency_ms: int = 0
    ) -> None:
        f = outcome.failure
        output = {"kind": "agent_result", "result": {"status": "done", "text": _text(outcome)}}
        finish = (
            Finish("succeeded", result=output)
            if f is None
            else Finish(f.status, None, f.code, f.reason, f.message)
        )
        tx = FinishTx(finish, PROVIDER_KEY)
        if p is not None:
            session = (_session_key(p), outcome.state.encode()) if outcome.state else None
            tx = FinishTx(finish, PROVIDER_KEY, _usage(p, latency_ms), session=session)
        written = await self._write(job, tx)
        get_logger().info("job.finished", status=finish.status, code=finish.error_code)
        if not written:
            self.events.forget(job.id)
        elif f is None:
            await self.events.result(job, output, Tokens())
        else:
            await self.events.failed(job.id, job.run_id, f, Tokens())

    async def _write(self, job: ClaimedJob, tx: FinishTx) -> bool:
        for wait_s in (*FINISH_BACKOFF_S, None):
            try:
                async with self.pool.acquire() as conn:
                    done = await finish_sql.finish_tx(conn, job.id, self.cfg.worker_id, tx)
                return done is not None
            except DB_ERRORS as err:
                if wait_s is None:
                    raise
                get_logger().warning("job.finish_retry", error=type(err).__name__)
                await asyncio.sleep(wait_s)
        return False


def _text(outcome: Outcome) -> str:
    text = outcome.text or "(không có nội dung)"
    return text if len(text) <= TEXT_MAX else text[: TEXT_MAX - 1] + "…"


def _session_key(p: JobPayload1) -> SessionKey:
    return SessionKey(p.conversation_id, p.agent.id, PROVIDER_KEY, p.tenant_id)


def _usage(p: JobPayload1, latency_ms: int) -> UsageRow:
    keys = UsageKeys(p.tenant_id, p.run_id, p.step_id, p.user_id, p.agent.id, PROVIDER_KEY)
    return UsageRow(keys, PROVIDER_KEY, 0, 0, 0, 0, max(latency_ms, 0))
