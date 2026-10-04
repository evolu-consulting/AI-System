"""WRK-FR-04 · WRK-FR-05 · WRK-FR-14 · WRK-FR-24 · WRK-BR-02 · WRK-BR-03 · WRK-BR-06 · WRK-NFR-06 ·
AC-W03 · AC-W04 · AC-W10 · HUB-H1-AC-04 · H1-R23 —
Job host phía cha (plan-runtime §1.2, §2.3): `CliJobHost.run(job, control)`.

Spawn `python -m agent_runtime.runtimes.cli.child --job-id=<id>` với `start_new_session=True`
(pgid = pid con), env tường minh (`sandbox/env.py`), cwd `work/<job_id>`, ghi `jobs.pgid`; gửi
`ChildRequest` qua stdin, đọc `ChildEvent` từ stdout. Dừng sớm theo `control.reason`:
`cancel` → giết group → `cancelled` · `lost` → giết group, không ghi · `shutdown` → chỉ giết group
(cha ghi `orphaned`). Hết `timeout_s` → giết group → `timed_out`. Rời `running` = trả slot
(WRK-FR-24). XADD chỉ sau commit có dòng (plan-db §8 R2).
Session §6 (luật `session.py`): resume theo `cli_sessions` + tenant, mất session → dựng từ history.
Một lần chạy (spawn → giám sát → kết quả) ở `job_run.py` `JobRun`; ở đây: payload, transaction
"Kết thúc" (lỗi DB → thử lại có backoff; hết lượt → `FinishWriteFailed` lên Supervisor, không ghi
`crashed` — heartbeat `orphaned` job lạc), XADD sau commit.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import ValidationError

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import jobs_sql
from agent_runtime.db.finish_sql import Finished, FinishTx, finish_tx
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.db.pool import DB_ERRORS, Conn, Pool
from agent_runtime.events.job_events import Failure, RunEvents, Tokens
from agent_runtime.log import bind_job, get_logger
from agent_runtime.runtimes.cli.job_run import JobRun, StopControl
from agent_runtime.runtimes.cli.joblog import events_log_path, stderr_log_path
from agent_runtime.runtimes.cli.outcome import (
    CRASHED,
    INVALID_PAYLOAD,
    Seen,
    Verdict,
    fatal_failure,
    queued_failure,
)
from agent_runtime.runtimes.cli.result import build_output

FINISH_BACKOFF_S = (0.5, 1.0, 2.0)  # ghi "Kết thúc" lỗi DB → thử lại (review H1 #1)


@dataclass(frozen=True)
class HostConfig:
    worker_id: str
    work_root: Path
    log_dir: Path
    home: Path
    app_env: str
    kill_grace_s: float
    python: str = field(default=sys.executable)
    # Đặt ngay trong signal handler SIGTERM/SIGINT của cha (review H1 #2): job host chết theo cha
    # trước khi `Supervisor.shutdown` kịp `request_stop` → coi như `shutdown`, không ghi.
    stopping: asyncio.Event = field(default_factory=asyncio.Event, compare=False)


_Seen = Seen  # tên cũ (test đơn vị PY-10)
__all__ = ["StopControl", "build_output", "events_log_path", "fatal_failure", "stderr_log_path"]


class FinishWriteFailed(Exception):
    """Ghi "Kết thúc" hết lượt thử (review H1 v2 M1): đi thẳng lên Supervisor, không chuyển
    `crashed` (có thể ghi đè kết quả đúng); heartbeat `orphaned` job còn `running` không ai giữ."""


class CliJobHost:
    """`JobHost` (queue/host.py) chạy job `agentic-cli` trong job host process con."""

    def __init__(self, pool: Pool, events: RunEvents, cfg: HostConfig) -> None:
        self.pool, self.events, self.cfg = pool, events, cfg

    async def run(self, job: ClaimedJob, control: StopControl) -> None:
        tenant = str(job.payload.get("tenant_id", ""))
        with bind_job(job.id, job.run_id, tenant):
            try:
                payload = JobPayload1.model_validate(job.payload)
            except ValidationError:
                await self.finish_failed(job, INVALID_PAYLOAD)
                return
            try:
                await JobRun(self, job, payload, control).execute()
            except FinishWriteFailed:
                raise
            except Exception as err:  # spawn/IO lỗi: không để job `running` mãi (heartbeat)
                get_logger().error("job.host_failed", error=type(err).__name__)
                await self.finish_failed(job, CRASHED)

    async def close(self, job: ClaimedJob, tx: FinishTx, v: Verdict, tokens: Tokens) -> None:
        """Transaction "Kết thúc" rồi XADD sau commit (R2): job mình, rồi job `queued` bị fail."""
        done = await self._finish(job, tx)
        f = v.failure
        log = get_logger()
        log.info(
            "job.finished", status=tx.finish.status, code=tx.finish.error_code, written=bool(done)
        )
        if done is None:
            self.events.forget(job.id)
            return
        if f is None:
            await self.events.result(job, v.output or {}, tokens, v.session_resumed)
        else:
            await self.events.failed(job.id, job.run_id, f, tokens)
        if done.broken is not None:
            b = done.broken
            log.warning("provider.broken", status=b.status, queued=len(done.queued_failed))
            for q in done.queued_failed:
                await self.events.failed(q.id, q.run_id, queued_failure(b), Tokens())

    async def _finish(self, job: ClaimedJob, tx: FinishTx) -> Finished | None:
        """Transaction "Kết thúc", lỗi DB → thử lại có backoff; hết lượt → `FinishWriteFailed`.
        Lần trước lỗi có thể đã commit (mất ack, review H1 v2 M2): lần sau 0 dòng mà job của mình đã
        ở đúng trạng thái `tx.finish` → coi như đã ghi (XADD đúng một lần; job `queued` bị fail cùng
        lần commit đó không XADD được — rủi ro chấp nhận, spec-decisions)."""
        retried = False
        for wait_s in (*FINISH_BACKOFF_S, None):
            try:
                async with self.pool.acquire() as conn:
                    done = await finish_tx(conn, job.id, self.cfg.worker_id, tx)
                    if done is None and retried and await self._ack_lost(conn, job, tx):
                        return Finished()
                    return done
            except DB_ERRORS as err:
                if wait_s is None:
                    raise FinishWriteFailed from err
                retried = True
                get_logger().warning("job.finish_retry", error=type(err).__name__)
                await asyncio.sleep(wait_s)
        return None

    async def _ack_lost(self, conn: Conn, job: ClaimedJob, tx: FinishTx) -> bool:
        if not await jobs_sql.finished_as(conn, job.id, self.cfg.worker_id, tx.finish):
            return False
        get_logger().warning("job.finish_ack_lost")
        return True

    async def finish_failed(self, job: ClaimedJob, f: Failure) -> None:
        """Lỗi trước khi có kết quả (payload sai, spawn lỗi): không usage, không đụng provider."""
        v = Verdict(f)
        key = str(job.payload.get("provider_key", ""))
        await self.close(job, FinishTx(v.finish(), key), v, Tokens())
