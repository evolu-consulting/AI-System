"""WRK-FR-04 · WRK-FR-05 · WRK-FR-24 · WRK-BR-02 · WRK-NFR-06 · AC-W03 · AC-W10 · HUB-H1-AC-04 —
Job host phía cha (plan-runtime §1.2, §2.3): `CliJobHost.run(job, control)`.

Spawn `python -m agent_runtime.runtimes.cli.child --job-id=<id>` với `start_new_session=True`
(pgid = pid con), env tường minh (`sandbox/env.py`), cwd `work/<job_id>`, ghi `jobs.pgid`; gửi
`ChildRequest` qua stdin, đọc `ChildEvent` từ stdout. Dừng sớm theo `control.reason`:
`cancel` → giết group → `cancelled` · `lost` → giết group, không ghi · `shutdown` → chỉ giết group
(cha ghi `orphaned`). Hết `timeout_s` → giết group → `timed_out`. Rời `running` = trả slot
(WRK-FR-24). XADD chỉ sau commit có dòng (plan-db §8 R2).
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

from pydantic import ValidationError

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import jobs_sql
from agent_runtime.db.finish_sql import FinishTx, finish_tx
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.db.pool import Pool
from agent_runtime.events.job_events import Failure, RunEvents, Tokens
from agent_runtime.log import bind_job, get_logger
from agent_runtime.providers.base import (
    Fatal,
    Final,
    Progress,
    ProviderEvent,
    RateLimit,
    Session,
    UsageEv,
)
from agent_runtime.runtimes.cli.joblog import append_envelope
from agent_runtime.runtimes.cli.outcome import (
    BROKEN_SIGNALS,
    CANCELLED,
    CRASHED,
    INVALID_PAYLOAD,
    TIMED_OUT,
    Seen,
    Verdict,
    decide_exit,
    fatal_failure,
    queued_failure,
    usage_row,
)
from agent_runtime.runtimes.cli.prompt import retry_prompt
from agent_runtime.runtimes.cli.protocol import (
    MAX_LINE_BYTES,
    ChildRequest,
    child_argv,
    parse_event,
)
from agent_runtime.runtimes.cli.result import build_output, validation_hint
from agent_runtime.sandbox.env import TMP_SUBDIR, forbidden_roots, job_host_env
from agent_runtime.sandbox.process import group_pids, kill_group

Outcome = Literal["exited", "stopped", "timeout", "lost"]
_PY_ENV_KEYS = ("VIRTUAL_ENV", "PYTHONPATH")


class StopControl(Protocol):
    """= `queue.host.JobControl` (lớp `runtimes` không import `queue`)."""

    @property
    def stopped(self) -> asyncio.Event: ...
    @property
    def reason(self) -> str | None: ...


@dataclass(frozen=True)
class HostConfig:
    worker_id: str
    work_root: Path
    log_dir: Path
    home: Path
    app_env: str
    kill_grace_s: float
    python: str = field(default=sys.executable)


_Seen = Seen  # tên cũ (test đơn vị PY-10)
__all__ = ["build_output", "fatal_failure"]


def stderr_log_path(log_dir: Path, job_id: str) -> Path:
    return log_dir / datetime.now(UTC).strftime("%Y-%m-%d") / f"{job_id}.stderr.log"


def events_log_path(log_dir: Path, job_id: str) -> Path:
    return log_dir / datetime.now(UTC).strftime("%Y-%m-%d") / f"{job_id}.events.jsonl"


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
                await _Run(self, job, payload, control).execute()
            except Exception as err:  # spawn/IO lỗi: không để job `running` mãi (heartbeat)
                get_logger().error("job.host_failed", error=type(err).__name__)
                await self.finish_failed(job, CRASHED)

    async def close(self, job: ClaimedJob, tx: FinishTx, v: Verdict, tokens: Tokens) -> None:
        """Transaction "Kết thúc" rồi XADD sau commit (R2): job mình, rồi job `queued` bị fail."""
        async with self.pool.acquire() as conn:
            done = await finish_tx(conn, job.id, self.cfg.worker_id, tx)
        f = v.failure
        log = get_logger()
        log.info(
            "job.finished", status=tx.finish.status, code=tx.finish.error_code, written=bool(done)
        )
        if done is None:
            self.events.forget(job.id)
            return
        if f is None:
            await self.events.result(job, v.output or {}, tokens)
        else:
            await self.events.failed(job.id, job.run_id, f, tokens)
        if done.broken is not None:
            b = done.broken
            log.warning("provider.broken", status=b.status, queued=len(done.queued_failed))
            for q in done.queued_failed:
                await self.events.failed(q.id, q.run_id, queued_failure(b), Tokens())

    async def finish_failed(self, job: ClaimedJob, f: Failure) -> None:
        """Lỗi trước khi có kết quả (payload sai, spawn lỗi): không usage, không đụng provider."""
        v = Verdict(f)
        key = str(job.payload.get("provider_key", ""))
        await self.close(job, FinishTx(v.finish(), key), v, Tokens())


class _Run:
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
        self.deadline = time.monotonic() + payload.timeout_s

    async def execute(self) -> None:
        outcome = await self._attempt()
        if outcome == "exited" and (hint := self._invalid_hint()) is not None:
            sid = self.seen.session_id if self.payload.use_session else None
            self.retry = retry_prompt(self.payload.prompt, hint, resumed=sid is not None)
            self.resume_id = sid
            self.seen.next_attempt()
            get_logger().info("job.output_retry", resumed=sid is not None)
            outcome = await self._attempt()
        await self._apply(outcome)

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
        err_fd = self._open_stderr()
        try:
            return await asyncio.create_subprocess_exec(
                *child_argv(self.cfg.python, self.job.id),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=err_fd,
                cwd=self.work,
                env=env,
                start_new_session=True,  # group mới, pgid = pid con
                limit=MAX_LINE_BYTES,
            )
        finally:
            os.close(err_fd)

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
        req = ChildRequest(
            job_id=self.job.id,
            payload=self.payload,
            work_dir=str(self.work),
            forbidden_roots=[str(r) for r in roots],
            resume_session_id=self.resume_id,
            retry_prompt=self.retry,
        )
        return req.model_dump_json().encode() + b"\n"

    async def _supervise(self) -> Outcome:
        reader = asyncio.create_task(self._read())
        stop = asyncio.create_task(self.control.stopped.wait())
        try:
            done, _ = await asyncio.wait(
                {reader, stop},
                timeout=max(0.0, self.deadline - time.monotonic()),
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            stop.cancel()
        if reader in done:
            return "exited"
        await self._kill()
        reader.cancel()
        await asyncio.gather(reader, return_exceptions=True)
        if stop in done:
            return "stopped"
        return "timeout"

    async def _read(self) -> None:
        proc = self.proc
        assert proc is not None and proc.stdin is not None and proc.stdout is not None
        with suppress(BrokenPipeError, ConnectionResetError):
            proc.stdin.write(self._request())
            await proc.stdin.drain()
            proc.stdin.close()
        while True:
            try:
                line = await proc.stdout.readline()
            except ValueError:  # dòng vượt MAX_LINE_BYTES
                self.seen.fatal = Fatal(code="INTERNAL_ERROR", msg="child event too large")
                return
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
        elif isinstance(ev, Final):
            self.seen.final = ev
        elif isinstance(ev, RateLimit):
            if ev.status in BROKEN_SIGNALS:
                self.seen.rate_limit = ev
            else:
                get_logger().info("provider.rate_limit_signal", status=ev.status[:40])
        elif isinstance(ev, Fatal):
            self.seen.fatal = ev
            return True
        return False

    async def _kill(self) -> None:
        proc = self.proc
        if proc is None:
            return
        left = await kill_group(proc.pid, proc.wait, self.cfg.kill_grace_s)
        if left:
            get_logger().error("job.group_leak", count=len(left))

    async def _kill_leftovers(self) -> None:
        """Job host đã thoát / lỗi giữa chừng: group còn pid (cháu) → giết."""
        proc = self.proc
        if proc is None:
            return
        if proc.returncode is None or group_pids(proc.pid):
            await self._kill()
        with suppress(ProcessLookupError):
            await proc.wait()

    async def _apply(self, outcome: Outcome) -> None:
        reason = self.control.reason
        if outcome == "timeout":
            await self._close(Verdict(TIMED_OUT))
        elif outcome == "stopped" and reason == "cancel":
            await self._close(Verdict(CANCELLED))
        elif outcome in ("stopped", "lost"):
            get_logger().info("job.stopped_no_write", reason=reason or outcome)
            self.host.events.forget(self.job.id)
        else:
            await self._close(decide_exit(self.payload, self.seen))

    async def _close(self, v: Verdict) -> None:
        total = self.seen.total()
        latency = int((time.monotonic() - self.started) * 1000)
        f = v.failure
        tx = FinishTx(
            v.finish(),
            self.payload.provider_key,
            usage_row(self.payload, total, latency),
            v.provider,
            f.message if f is not None else "",
        )
        await self.host.close(self.job, tx, v, total.tokens())
