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
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import ValidationError

from agent_runtime.contracts.hub import AgentResult, JobPayload1
from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import ClaimedJob, Finish
from agent_runtime.db.pool import Pool
from agent_runtime.events.job_events import Failure, RunEvents, Tokens
from agent_runtime.log import bind_job, get_logger
from agent_runtime.providers.base import Fatal, Final, Progress, ProviderEvent, UsageEv
from agent_runtime.runtimes.cli.joblog import append_envelope
from agent_runtime.runtimes.cli.protocol import (
    MAX_LINE_BYTES,
    ChildRequest,
    child_argv,
    parse_event,
)
from agent_runtime.sandbox.env import TMP_SUBDIR, forbidden_roots, job_host_env
from agent_runtime.sandbox.process import group_pids, kill_group

Outcome = Literal["exited", "stopped", "timeout", "lost"]
JOB_ERROR_CODES = frozenset(
    {"ALL_PROVIDERS_EXHAUSTED", "TIMEOUT", "CANCELLED", "UPSTREAM_ERROR", "INTERNAL_ERROR"}
)
CANCELLED = Failure("cancelled", "CANCELLED", "cancelled", "job cancelled")
TIMED_OUT = Failure("timed_out", "TIMEOUT", "timeout", "job timed out")
CRASHED = Failure("failed", "INTERNAL_ERROR", "crash", "job host exited without result")
INVALID_PAYLOAD = Failure("failed", "INTERNAL_ERROR", "invalid_payload", "invalid job payload")
INVALID_OUTPUT = Failure("failed", "UPSTREAM_ERROR", "invalid_output", "invalid provider output")
PROVIDER_ERROR = Failure("failed", "UPSTREAM_ERROR", None, "provider returned an error")
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


@dataclass
class _Seen:
    final: Final | None = None
    fatal: Fatal | None = None
    usage: UsageEv | None = None

    def tokens(self) -> Tokens:
        u = self.usage
        if u is None:
            return Tokens()
        return Tokens(u.input + u.cache_read + u.cache_write, u.output)


def stderr_log_path(log_dir: Path, job_id: str) -> Path:
    return log_dir / datetime.now(UTC).strftime("%Y-%m-%d") / f"{job_id}.stderr.log"


def events_log_path(log_dir: Path, job_id: str) -> Path:
    return log_dir / datetime.now(UTC).strftime("%Y-%m-%d") / f"{job_id}.events.jsonl"


def fatal_failure(f: Fatal) -> Failure:
    code = f.code if f.code in JOB_ERROR_CODES else "INTERNAL_ERROR"
    return Failure("failed", code, f.reason or "crash", f.msg or "job host fatal")


def build_output(payload: JobPayload1, final: Final) -> dict[str, Any] | None:
    """`job.result.output` (plan.md §2.3); sai hình → None (PY-10: retry 1 lần)."""
    if payload.output == "text":
        text = final.text if final.text is not None else final.raw_json
        if text is None or len(text) > 64_000:
            return None
        return {"kind": "text", "text": text}
    try:
        result = AgentResult.model_validate(final.structured)
    except ValidationError:
        return None
    return {"kind": "agent_result", "result": result.model_dump(mode="json")}


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
                await self.finish_failed(job, INVALID_PAYLOAD, Tokens())
                return
            try:
                await _Run(self, job, payload, control).execute()
            except Exception as err:  # spawn/IO lỗi: không để job `running` mãi (heartbeat)
                get_logger().error("job.host_failed", error=type(err).__name__)
                await self.finish_failed(job, CRASHED, Tokens())

    async def finish(self, job: ClaimedJob, f: Finish) -> bool:
        async with self.pool.acquire() as conn:
            ok = await jobs_sql.finish_job(conn, job.id, self.cfg.worker_id, f)
        get_logger().info("job.finished", status=f.status, code=f.error_code, written=ok)
        return ok

    async def finish_failed(self, job: ClaimedJob, f: Failure, usage: Tokens) -> None:
        row = Finish(f.status, None, f.code, f.reason, f.message[:500])
        if await self.finish(job, row):
            await self.events.failed(job.id, job.run_id, f, usage)
        else:
            self.events.forget(job.id)


class _Run:
    """Một lần chạy job: spawn → giám sát → giết group → ghi kết quả."""

    def __init__(
        self, host: CliJobHost, job: ClaimedJob, payload: JobPayload1, control: StopControl
    ) -> None:
        self.host, self.job, self.payload, self.control = host, job, payload, control
        self.cfg = host.cfg
        self.seen = _Seen()
        self.work = self.cfg.work_root / job.id
        self.proc: asyncio.subprocess.Process | None = None

    async def execute(self) -> None:
        outcome: Outcome = "lost"
        try:
            self.proc = await self._spawn()
            if await self._record_pgid():
                outcome = await self._supervise()
        finally:
            await self._kill_leftovers()
        await self._apply(outcome)

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
        )
        return req.model_dump_json().encode() + b"\n"

    async def _supervise(self) -> Outcome:
        reader = asyncio.create_task(self._read())
        stop = asyncio.create_task(self.control.stopped.wait())
        try:
            done, _ = await asyncio.wait(
                {reader, stop}, timeout=self.payload.timeout_s, return_when=asyncio.FIRST_COMPLETED
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
        elif isinstance(ev, Final):
            self.seen.final = ev
        elif isinstance(ev, Fatal):
            self.seen.fatal = ev
            return True
        # TODO(WRK-FR-14): PY-08/PY-11 — tool_use, session, rate_limit.
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
            await self.host.finish_failed(self.job, TIMED_OUT, self.seen.tokens())
        elif outcome == "stopped" and reason == "cancel":
            await self.host.finish_failed(self.job, CANCELLED, self.seen.tokens())
        elif outcome in ("stopped", "lost"):
            get_logger().info("job.stopped_no_write", reason=reason or outcome)
            self.host.events.forget(self.job.id)
        else:
            await self._apply_exit()

    async def _apply_exit(self) -> None:
        seen, tokens = self.seen, self.seen.tokens()
        if seen.fatal is not None:
            await self.host.finish_failed(self.job, fatal_failure(seen.fatal), tokens)
        elif seen.final is None:
            await self.host.finish_failed(self.job, CRASHED, tokens)
        elif seen.final.is_error:
            await self.host.finish_failed(self.job, PROVIDER_ERROR, tokens)
        elif (output := build_output(self.payload, seen.final)) is None:
            await self.host.finish_failed(self.job, INVALID_OUTPUT, tokens)
        elif await self.host.finish(self.job, Finish("succeeded", output)):
            await self.host.events.result(self.job, output, tokens)
        else:
            self.host.events.forget(self.job.id)
