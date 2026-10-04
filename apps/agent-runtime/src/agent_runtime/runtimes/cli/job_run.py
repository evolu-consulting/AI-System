"""WRK-FR-04 · WRK-FR-05 · WRK-FR-14 · WRK-FR-24 · WRK-BR-02 · WRK-BR-03 · WRK-BR-06 · AC-W03 ·
AC-W04 · AC-W10 · HUB-H1-AC-04 · H1-R23 — một lần chạy job `agentic-cli` phía cha
(plan-runtime §2.3): điều phối thử lại / resume / ghi kết quả (`CliJobHost.close`). Process con
(spawn, giám sát, giết group) ở `host_proc.py` `HostProcess` (PY-00). Tách khỏi `runner.py`.

Dừng (plan-runtime §1.5, review H1 #2): process cha đang dừng (cờ đặt ngay trong signal handler)
hoặc `control.reason == "shutdown"` → không thử lại, không ghi (cha ghi `orphaned`) — trừ job đã có
kết quả thành công. Job host chết vì tín hiệu mà cha không gửi → không đếm lỗi provider.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import replace
from typing import TYPE_CHECKING, Protocol

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import sessions_sql
from agent_runtime.db.finish_sql import FinishTx
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.log import get_logger
from agent_runtime.providers.context import with_history
from agent_runtime.runtimes.cli.host_proc import HostProcess, Outcome
from agent_runtime.runtimes.cli.outcome import (
    CANCELLED,
    TIMED_OUT,
    Seen,
    Verdict,
    decide_exit,
    usage_row,
)
from agent_runtime.runtimes.cli.prompt import retry_prompt
from agent_runtime.runtimes.cli.result import (
    build_output,
    confirmation_forced,
    validation_hint,
)
from agent_runtime.runtimes.cli.session import resume_failed, session_key

if TYPE_CHECKING:
    from agent_runtime.runtimes.cli.runner import CliJobHost


class StopControl(Protocol):
    """= `queue.host.JobControl` (lớp `runtimes` không import `queue`)."""

    @property
    def stopped(self) -> asyncio.Event: ...
    @property
    def reason(self) -> str | None: ...


class JobRun:
    """Một lần chạy job: spawn → giám sát → giết group → ghi kết quả."""

    def __init__(
        self, host: CliJobHost, job: ClaimedJob, payload: JobPayload1, control: StopControl
    ) -> None:
        self.host, self.job, self.payload, self.control = host, job, payload, control
        self.cfg = host.cfg
        self.seen = Seen()
        self.started = time.monotonic()
        self.work = self.cfg.work_root / job.id
        self.retry: str | None = None  # prompt lần thử lại (agent, JSON hỏng)
        self.resume_id: str | None = None
        self.resumed = False  # lần chạy hiện tại resume session từ `cli_sessions`
        self.prompt = payload.prompt  # prompt gửi provider (có thể kèm khối history)
        self.skey = session_key(payload)
        self.deadline = time.monotonic() + payload.timeout_s
        self.proc_host = HostProcess(self)

    def stopping(self) -> bool:
        """Process cha đang dừng (SIGTERM) — không thử lại, không ghi lỗi."""
        return self.control.reason == "shutdown" or self.cfg.stopping.is_set()

    async def execute(self) -> None:
        await self._load_session()
        outcome = await self._attempt()
        if self._retryable(outcome) and resume_failed(self.seen, self.resumed):
            self._rebuild_from_history()
            outcome = await self._attempt()
        if self._retryable(outcome) and (hint := self._invalid_hint()) is not None:
            sid = self.seen.session_id if self.payload.use_session else None
            self.retry = retry_prompt(self.prompt, hint, resumed=sid is not None)
            self.resume_id = sid
            self.seen.next_attempt()
            get_logger().info("job.output_retry", resumed=sid is not None)
            outcome = await self._attempt()
        await self._apply(outcome)

    def _retryable(self, outcome: Outcome) -> bool:
        """HUB-FR-95 §5 #5: đã có `Confirm` → không resume/thử lại (lượt sau là run mới)."""
        return outcome == "exited" and not self.stopping() and self.seen.confirm is None

    async def _load_session(self) -> None:
        """§6: session cùng khoá + tenant (BR-06) → resume; không → prompt kèm history (BR-03)."""
        if self.skey is not None:
            async with self.host.pool.acquire() as conn:
                self.resume_id = await sessions_sql.find_session(conn, self.skey)
        self.resumed = self.resume_id is not None
        if not self.resumed:
            self._use_history()

    def _use_history(self) -> None:
        if self.payload.output == "agent_result":  # Orchestrator đã có `<history>` trong prompt
            self.prompt = with_history(self.payload.prompt, self.payload.history)

    def _rebuild_from_history(self) -> None:
        """H1-R23: mất session → chạy lại 1 lần không resume, không báo lỗi user."""
        get_logger().info("job.session_lost")
        self.resume_id, self.resumed = None, False
        self.seen.next_attempt()
        self.seen.session_id = None
        self._use_history()

    def _invalid_hint(self) -> str | None:
        """Agent trả JSON sai hình (chưa thử lại) → lý do ngắn; ngược lại None."""
        f = self.seen.final
        if self.retry is not None or self.seen.fatal is not None or f is None or f.is_error:
            return None
        if self.payload.output != "agent_result" or build_output(self.payload, f) is not None:
            return None
        return validation_hint(f)

    async def _attempt(self) -> Outcome:
        outcome: Outcome = "lost"
        hp = self.proc_host
        hp.reset()
        try:
            await hp.spawn()
            if await hp.record_pgid():
                outcome = await hp.supervise()
        finally:
            await hp.kill_leftovers()
        return outcome

    async def _apply(self, outcome: Outcome) -> None:
        reason = self.control.reason
        exited = outcome == "exited"
        if outcome == "stopped" and reason == "shutdown" and self._succeeded():
            outcome = "exited"  # M3: đã đọc `Final` hợp lệ trước shutdown → vẫn ghi kết quả
        elif exited and self.stopping() and not self._succeeded():
            outcome, reason = "stopped", "shutdown"
        if outcome == "timeout":
            await self._close(Verdict(TIMED_OUT))
        elif outcome == "stopped" and reason == "cancel":
            await self._close(Verdict(CANCELLED))
        elif outcome in ("stopped", "lost"):
            get_logger().info("job.stopped_no_write", reason=reason or outcome)
            self.host.events.forget(self.job.id)
        else:
            v = decide_exit(self.payload, self.seen)
            if v.failure is None and confirmation_forced(
                self.payload, self.seen.final, self.seen.confirm
            ):
                get_logger().info("job.confirmation_forced")  # không nội dung (§5 #4)
            await self._close(v)

    def _succeeded(self) -> bool:
        return decide_exit(self.payload, self.seen).failure is None

    async def _close(self, v: Verdict) -> None:
        total = self.seen.total()
        latency = int((time.monotonic() - self.started) * 1000)
        f = v.failure
        sid = self.seen.session_id
        session = (self.skey, sid) if self.skey is not None and sid and f is None else None
        tx = FinishTx(
            v.finish(),
            self.payload.provider_key,
            usage_row(self.payload, total, latency),
            v.provider,
            f.message if f is not None else "",
            session,
        )
        if f is None:
            v = replace(v, session_resumed=self.resumed)
        await self.host.close(self.job, tx, v, total.tokens())
