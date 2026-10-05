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
from contextlib import suppress
from dataclasses import replace
from typing import TYPE_CHECKING, Protocol

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import sessions_sql
from agent_runtime.db.finish_sql import FinishTx
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.events.job_events import Failure
from agent_runtime.log import get_logger
from agent_runtime.providers.context import with_history
from agent_runtime.runtimes.cli.delta_pump import DeltaPump
from agent_runtime.runtimes.cli.files.dirs import ATTACHMENTS_SUBDIR, OUT_SUBDIR, prepare_job_dirs
from agent_runtime.runtimes.cli.files.fetch import (
    FetchFailed,
    FetchOk,
    FetchTimedOut,
    FetchWhy,
    FilesCall,
    fetch_attachments,
)
from agent_runtime.runtimes.cli.files.outputs import send_outputs
from agent_runtime.runtimes.cli.files.rules import wants_outputs
from agent_runtime.runtimes.cli.host_proc import HostProcess, Outcome
from agent_runtime.runtimes.cli.joblog import LOG_WRITE_ERRORS, append_is_error, events_log_path
from agent_runtime.runtimes.cli.outcome import (
    CANCELLED,
    TIMED_OUT,
    Seen,
    Verdict,
    decide_exit,
    is_error_kind,
    is_error_text,
    usage_row,
)
from agent_runtime.runtimes.cli.prompt import retry_prompt
from agent_runtime.runtimes.cli.result import (
    build_output,
    confirmation_forced,
    validation_hint,
)
from agent_runtime.runtimes.cli.session import resume_failed, session_key
from agent_runtime.runtimes.hub_http import make_hub_client

if TYPE_CHECKING:
    from agent_runtime.runtimes.cli.runner import CliJobHost


def attachment_failure(why: FetchWhy) -> Failure:
    """H2c F5: tải file lỗi ⇒ `failed INTERNAL_ERROR attachment` (Hub: `run.failed` câu H1)."""
    return Failure("failed", "INTERNAL_ERROR", "attachment", f"attachment fetch failed: {why}")


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
        self.pump = DeltaPump(host.events, job, self.cfg)  # H2b §3.5: một bộ gom cho cả job

    def stopping(self) -> bool:
        """Process cha đang dừng (SIGTERM) — không thử lại, không ghi lỗi."""
        return self.control.reason == "shutdown" or self.cfg.stopping.is_set()

    async def execute(self) -> None:
        try:
            await self._execute()
        finally:
            await self.pump.close()  # `_close` đã xả; còn lại = dừng không ghi / lỗi giữa chừng

    async def _execute(self) -> None:
        if not await self._prepare_files():
            return
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

    async def _prepare_files(self) -> bool:
        """H2c §3.1/§3.3: làm mới `attachments/` (có file) và `out/` (role `agent`), tải file
        trước khi chạy provider. Một lần mỗi claim (thử lại trong claim không tải lại)."""
        items = self.payload.attachments or []
        out = self.payload.agent.role == "agent"
        if not items and not out:
            return True
        try:
            prepare_job_dirs(self.work, attachments=bool(items), out=out)
        except OSError as err:
            get_logger().warning("job.attachment_failed", why="path", error=type(err).__name__)
            await self.host.finish_failed(self.job, attachment_failure("path"))
            return False
        if not items:
            return True
        async with make_hub_client(self.cfg.hub_transport) as client:
            call = FilesCall(
                client, self.cfg.hub_url, self.job, self.deadline, self.control.stopped
            )
            res = await fetch_attachments(call, items, self.work / ATTACHMENTS_SUBDIR)
        if isinstance(res, FetchOk):
            return True
        if isinstance(res, FetchFailed):
            await self.host.finish_failed(self.job, attachment_failure(res.why))
        elif isinstance(res, FetchTimedOut):
            await self._close(Verdict(TIMED_OUT))
        else:  # FetchStopped: cancel ⇒ `cancelled`; shutdown/lost ⇒ không ghi
            await self._apply("stopped")
        return False

    def _retryable(self, outcome: Outcome) -> bool:
        """HUB-FR-95 §5 #5: đã có `Confirm` → không resume/thử lại (lượt sau là run mới). H2b R21:
        đã phát `job.delta` → không thử lại JSON, không dựng lại session."""
        if self.seen.streamed:
            return False
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
            self._log_is_error()
            if v.failure is None and confirmation_forced(
                self.payload, self.seen.final, self.seen.confirm
            ):
                get_logger().info("job.confirmation_forced")  # không nội dung (§5 #4)
            await self._close(v)

    def _log_is_error(self) -> None:
        """F4: chữ result của `is_error` chỉ vào log job (che, ≤ 300) — không vào sự kiện/DB."""
        f = self.seen.final
        if f is None or not f.is_error or self.seen.confirm is not None:
            return
        kind = is_error_kind(self.seen)
        get_logger().info("job.is_error", kind=kind, rate_limit=self.seen.rate_limit is not None)
        with suppress(*LOG_WRITE_ERRORS):
            append_is_error(events_log_path(self.cfg.log_dir, self.job.id), kind, is_error_text(f))

    def _succeeded(self) -> bool:
        return decide_exit(self.payload, self.seen).failure is None

    async def _send_outputs(self, v: Verdict) -> Verdict:
        """H2c R25 (§5): job agent thành công `done`/`partial` ⇒ đẩy `out/` (lần claim hiện hành —
        `prepare_job_dirs` đã làm mới) lên Hub **trước** `FinishTx` (job còn `running`). Không làm
        job `failed`; huỷ giữa chừng ⇒ ngừng, giữ id đã có."""
        if v.failure is not None or not wants_outputs(self.payload.agent.role, v.output):
            return v
        async with make_hub_client(self.cfg.hub_transport) as client:
            call = FilesCall(
                client, self.cfg.hub_url, self.job, self.deadline, self.control.stopped
            )
            ids = await send_outputs(call, self.work / OUT_SUBDIR)
        return replace(v, outputs=ids) if ids else v

    async def _close(self, v: Verdict) -> None:
        await self.pump.drain()  # H2b H6: mọi `job.delta` trước `job.result`/`job.failed`
        v = await self._send_outputs(v)
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
