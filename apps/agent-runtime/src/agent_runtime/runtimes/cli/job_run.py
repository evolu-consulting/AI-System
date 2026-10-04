"""WRK-FR-04 · WRK-FR-05 · WRK-FR-14 · WRK-FR-24 · WRK-BR-02 · WRK-BR-03 · WRK-BR-06 · AC-W03 ·
AC-W04 · AC-W10 · HUB-H1-AC-04 · H1-R23 — một lần chạy job `agentic-cli` phía cha
(plan-runtime §2.3): spawn job host → giám sát → giết group → ghi kết quả (`CliJobHost.close`).
Tách khỏi `runner.py`.

Dừng (plan-runtime §1.5, review H1 #2): process cha đang dừng (cờ đặt ngay trong signal handler)
hoặc `control.reason == "shutdown"` → không thử lại, không ghi (cha ghi `orphaned`) — trừ job đã có
kết quả thành công. Job host chết vì tín hiệu mà cha không gửi → không đếm lỗi provider.
Reader lỗi / dòng hỏng / dòng quá dài = lỗi phía cha → `INTERNAL_ERROR`, không đụng provider.
Job host đã thoát, stdout bị cháu giữ → reader chờ `readline()` liền `DRAIN_S` sau lúc thoát thì
bỏ đọc (v2 N1); giết group + cây tích luỹ + process giữ pipe (`stdout_pipe.py`), đóng pipe (v2 N2).
"""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import suppress
from dataclasses import replace
from typing import TYPE_CHECKING, Literal, Protocol

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import jobs_sql, sessions_sql
from agent_runtime.db.finish_sql import FinishTx
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.log import get_logger
from agent_runtime.providers.base import (
    Fatal,
    Final,
    Progress,
    ProviderEvent,
    RateLimit,
    Session,
    ToolUse,
    UsageEv,
)
from agent_runtime.providers.context import with_history
from agent_runtime.runtimes.cli.joblog import append_envelope, events_log_path, stderr_log_path
from agent_runtime.runtimes.cli.outcome import (
    BROKEN_SIGNALS,
    CANCELLED,
    TIMED_OUT,
    Seen,
    Verdict,
    decide_exit,
    usage_row,
)
from agent_runtime.runtimes.cli.prompt import retry_prompt
from agent_runtime.runtimes.cli.protocol import (
    EVENT_TOO_LARGE,
    INVALID_EVENT,
    MAX_LINE_BYTES,
    ChildRequest,
    child_argv,
    parse_event,
)
from agent_runtime.runtimes.cli.result import build_output, validation_hint
from agent_runtime.runtimes.cli.session import resume_failed, session_key
from agent_runtime.runtimes.cli.stdout_pipe import StdoutPipe
from agent_runtime.sandbox import process as pg
from agent_runtime.sandbox.env import TMP_SUBDIR, forbidden_roots, job_host_env

if TYPE_CHECKING:
    from agent_runtime.runtimes.cli.runner import CliJobHost

Outcome = Literal["exited", "stopped", "timeout", "lost"]
_PY_ENV_KEYS = ("VIRTUAL_ENV", "PYTHONPATH")
READER_FAILED = Fatal(code="INTERNAL_ERROR", msg="job host reader failed")
DRAIN_S = 1.0  # job host đã thoát: chờ thêm để đọc nốt stdout rồi bỏ (cháu giữ pipe)
EXIT_POLL_S = 0.1


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
        self.proc: asyncio.subprocess.Process | None = None
        self.retry: str | None = None  # prompt lần thử lại (agent, JSON hỏng)
        self.resume_id: str | None = None
        self.resumed = False  # lần chạy hiện tại resume session từ `cli_sessions`
        self.prompt = payload.prompt  # prompt gửi provider (có thể kèm khối history)
        self.skey = session_key(payload)
        self.deadline = time.monotonic() + payload.timeout_s
        self.killed = False  # cha đã gửi tín hiệu cho group của lần chạy hiện tại
        self.pipe: StdoutPipe | None = None
        self.out: asyncio.StreamReader | None = None
        self.tree: dict[int, int] = {}  # N2: hậu duệ đã thấy khi job host còn sống (pid→start)
        self.wait_since: float | None = None  # N1: reader đang chờ `readline()` từ lúc này

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
        return outcome == "exited" and not self.stopping()

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
        self.killed, self.tree, self.wait_since = False, {}, None
        try:
            self.proc = await self._spawn()
            if await self._record_pgid():
                outcome = await self._supervise()
        finally:
            await self._kill_leftovers()
        return outcome

    def _prepare_work(self) -> None:
        self.work.mkdir(mode=0o700, parents=True, exist_ok=True)
        (self.work / TMP_SUBDIR).mkdir(mode=0o700, exist_ok=True)

    def _open_stderr(self) -> int:
        path = stderr_log_path(self.cfg.log_dir, self.job.id)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        return os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)

    async def _spawn(self) -> asyncio.subprocess.Process:
        self._prepare_work()
        py_env = {k: os.environ[k] for k in _PY_ENV_KEYS if os.environ.get(k)}
        env = job_host_env(self.cfg.home, self.work, self.cfg.app_env, py_env)
        self.pipe = pipe = StdoutPipe()
        err_fd = self._open_stderr()
        try:
            proc = await asyncio.create_subprocess_exec(
                *child_argv(self.cfg.python, self.job.id),
                stdin=asyncio.subprocess.PIPE,
                stdout=pipe.write_fd,
                stderr=err_fd,
                cwd=self.work,
                env=env,
                start_new_session=True,  # group mới, pgid = pid con
            )
        finally:
            os.close(err_fd)
            pipe.close_write()
        pg.track_host(proc.pid)
        self.out = await pipe.attach(MAX_LINE_BYTES)
        return proc

    async def _record_pgid(self) -> bool:
        assert self.proc is not None
        async with self.host.pool.acquire() as conn:
            ok = await jobs_sql.set_pgid(conn, self.job.id, self.cfg.worker_id, self.proc.pid)
        if ok:
            get_logger().info("job.spawned", pgid=self.proc.pid)
        else:
            get_logger().warning("job.not_owned_after_spawn")
        return ok

    def _request(self) -> bytes:
        roots = forbidden_roots(self.cfg.home, self.cfg.work_root)
        payload = self.payload
        if self.prompt != payload.prompt:
            payload = payload.model_copy(update={"prompt": self.prompt})
        req = ChildRequest(
            job_id=self.job.id,
            payload=payload,
            work_dir=str(self.work),
            forbidden_roots=[str(r) for r in roots],
            resume_session_id=self.resume_id,
            retry_prompt=self.retry,
        )
        return req.model_dump_json().encode() + b"\n"

    async def _supervise(self) -> Outcome:
        reader = asyncio.create_task(self._read())
        stop = asyncio.create_task(self.control.stopped.wait())
        gone = asyncio.create_task(self._host_gone())
        try:
            done, _ = await asyncio.wait(
                {reader, stop, gone},
                timeout=max(0.0, self.deadline - time.monotonic()),
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            stop.cancel()
            gone.cancel()
        if reader in done:
            self._reader_done(reader)
            return "exited"
        if gone in done:  # #9: job host đã thoát, stdout còn bị cháu giữ
            get_logger().warning("job.stdout_held")
            await self._stop_reader(reader)
            self._mark_exit()
            return "exited"
        await self._kill()
        await self._stop_reader(reader)
        return "stopped" if stop in done else "timeout"

    async def _host_gone(self) -> None:
        """Xong khi job host đã thoát và reader chờ `readline()` liền `DRAIN_S` tính từ
        max(lúc thoát, lúc bắt đầu chờ) — xử lý sự kiện chậm (Redis) không tính (N1)."""
        proc = self.proc
        assert proc is not None
        while proc.returncode is None:  # noqa: ASYNC110 — `wait()` chờ cả pipe stdin
            self.tree.update(pg.stamp(pg.descendants(proc.pid)))  # N2: trước khi cháu mồ côi
            await asyncio.sleep(EXIT_POLL_S)
        exited = time.monotonic()
        while not self._pipe_held(exited):  # noqa: ASYNC110
            await asyncio.sleep(EXIT_POLL_S)

    def _pipe_held(self, exited: float) -> bool:
        since = self.wait_since
        return since is not None and time.monotonic() - max(since, exited) >= DRAIN_S

    @staticmethod
    async def _stop_reader(reader: asyncio.Task[None]) -> None:
        reader.cancel()
        await asyncio.gather(reader, return_exceptions=True)

    def _reader_done(self, reader: asyncio.Task[None]) -> None:
        """#5: reader ném lỗi → `INTERNAL_ERROR` phía cha (không đếm lỗi provider)."""
        if (err := reader.exception()) is not None:
            get_logger().error("job.reader_failed", error=type(err).__name__)
            self.seen.fatal, self.seen.parent_fault = READER_FAILED, True
            return
        self._mark_exit()

    def _mark_exit(self) -> None:
        """#2c: thoát vì tín hiệu mà cha không gửi (systemd dừng cả cgroup…)."""
        code = self.proc.returncode if self.proc is not None else None
        self.seen.signaled = code is not None and code < 0 and not self.killed

    async def _read(self) -> None:
        proc, out = self.proc, self.out
        assert proc is not None and proc.stdin is not None and out is not None
        self.wait_since = time.monotonic()  # ghi stdin cũng là chờ pipe (cháu giữ đầu đọc)
        with suppress(BrokenPipeError, ConnectionResetError):
            proc.stdin.write(self._request())
            await proc.stdin.drain()
            proc.stdin.close()
        while True:
            self.wait_since = time.monotonic()
            try:
                line = await out.readline()
            except ValueError:  # dòng vượt MAX_LINE_BYTES
                self.seen.fatal, self.seen.parent_fault = EVENT_TOO_LARGE, True
                return
            finally:
                self.wait_since = None
            if not line:
                break
            if await self._on_event(parse_event(line)):
                return
        await proc.wait()

    async def _on_event(self, ev: ProviderEvent) -> bool:
        """True = ngừng đọc (fatal)."""
        with suppress(OSError):  # khung message, không nội dung (RQ1)
            append_envelope(events_log_path(self.cfg.log_dir, self.job.id), ev)
        if isinstance(ev, Progress):
            await self.host.events.progress(self.job, ev.label)
        elif isinstance(ev, UsageEv):
            self.seen.usage = ev
        elif isinstance(ev, Session):
            self.seen.session_id = ev.session_id
        elif isinstance(ev, ToolUse):
            self.seen.tool_used = True
        elif isinstance(ev, Final):
            self.seen.final = ev
        elif isinstance(ev, RateLimit):
            if ev.status in BROKEN_SIGNALS:
                self.seen.rate_limit = ev
            else:
                get_logger().info("provider.rate_limit_signal", status=ev.status[:40])
        else:  # Fatal
            self.seen.fatal, self.seen.parent_fault = ev, ev is INVALID_EVENT
            return True
        return False

    async def _kill(self) -> None:
        proc = self.proc
        if proc is None:
            return
        self.killed = True
        left = await pg.kill_group(proc.pid, proc.wait, self.cfg.kill_grace_s, self._extra())
        if left:
            get_logger().error("job.group_leak", count=len(left))

    def _extra(self) -> dict[int, int]:
        """N2: cây đã tích luỹ + process còn giữ pipe stdout (cháu `setsid` ngoài cây/group)."""
        held = pg.pipe_holders(self.pipe.inode) if self.pipe is not None else set[int]()
        return {**self.tree, **pg.stamp(held)}

    async def _kill_leftovers(self) -> None:
        """Job host đã thoát / lỗi giữa chừng: group / cháu còn sống → giết; đóng pipe stdout."""
        proc = self.proc
        try:
            if proc is not None:
                left = pg.group_pids(proc.pid) or pg.still_alive(self._extra())
                if proc.returncode is None or left:
                    await self._kill()
                with suppress(ProcessLookupError):
                    await proc.wait()
                pg.untrack_host(proc.pid)
        finally:
            if self.pipe is not None:
                self.pipe.close()

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
            await self._close(decide_exit(self.payload, self.seen))

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
