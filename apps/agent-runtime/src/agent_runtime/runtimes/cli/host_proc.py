"""WRK-FR-04 · WRK-FR-05 · WRK-FR-14 · WRK-FR-24 · AC-W03 · AC-W04 · AC-W10 — tiến trình job host
phía cha (plan-runtime §2): spawn → giám sát (đọc sự kiện) → giết group → đóng pipe. Tách khỏi
`job_run.py` (PY-00); trạng thái lần chạy (`seen`, prompt, deadline…) đọc qua `RunState`.

Job host đã thoát, stdout bị cháu giữ → reader chờ `readline()` liền `DRAIN_S` sau lúc thoát thì
bỏ đọc (v2 N1); giết group + cây tích luỹ + process giữ pipe (`stdout_pipe.py`), đóng pipe (v2 N2).
Reader lỗi / dòng hỏng / dòng quá dài = lỗi phía cha → `INTERNAL_ERROR`, không đụng provider.
"""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import suppress
from pathlib import Path
from typing import TYPE_CHECKING, Literal, Protocol

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.log import get_logger
from agent_runtime.providers.base import (
    Confirm,
    Fatal,
    Final,
    Progress,
    ProviderEvent,
    RateLimit,
    Session,
    ToolUse,
    UsageEv,
)
from agent_runtime.providers.claude import mcp
from agent_runtime.runtimes.cli.joblog import append_envelope, events_log_path, stderr_log_path
from agent_runtime.runtimes.cli.outcome import BROKEN_SIGNALS, Seen
from agent_runtime.runtimes.cli.protocol import (
    EVENT_TOO_LARGE,
    INVALID_EVENT,
    MAX_LINE_BYTES,
    ChildRequest,
    child_argv,
    parse_event,
)
from agent_runtime.runtimes.cli.stdout_pipe import StdoutPipe
from agent_runtime.sandbox import process as pg
from agent_runtime.sandbox.env import TMP_SUBDIR, forbidden_roots, job_host_env, mcp_env

if TYPE_CHECKING:
    from agent_runtime.runtimes.cli.job_run import StopControl
    from agent_runtime.runtimes.cli.runner import CliJobHost, HostConfig

Outcome = Literal["exited", "stopped", "timeout", "lost"]
_PY_ENV_KEYS = ("VIRTUAL_ENV", "PYTHONPATH")
READER_FAILED = Fatal(code="INTERNAL_ERROR", msg="job host reader failed")
DRAIN_S = 1.0  # job host đã thoát: chờ thêm để đọc nốt stdout rồi bỏ (cháu giữ pipe)
EXIT_POLL_S = 0.1


class RunState(Protocol):
    """Phần trạng thái lần chạy mà `HostProcess` đọc/ghi (`JobRun` thoả cấu trúc)."""

    host: CliJobHost
    job: ClaimedJob
    payload: JobPayload1
    control: StopControl
    cfg: HostConfig
    seen: Seen
    work: Path
    deadline: float
    prompt: str
    retry: str | None
    resume_id: str | None

    def stopping(self) -> bool: ...


class HostProcess:
    """Một job host process con: spawn → giám sát → giết group → đóng pipe."""

    def __init__(self, run: RunState) -> None:
        self.run = run
        self.cfg = run.cfg
        self.proc: asyncio.subprocess.Process | None = None
        self.killed = False  # cha đã gửi tín hiệu cho group của lần chạy hiện tại
        self.pipe: StdoutPipe | None = None
        self.out: asyncio.StreamReader | None = None
        self.tree: dict[int, int] = {}  # N2: hậu duệ đã thấy khi job host còn sống (pid→start)
        self.wait_since: float | None = None  # N1: reader đang chờ `readline()` từ lúc này
        self.mcp_path: Path | None = None  # H2a §4.2: file cấu hình MCP của lần chạy hiện tại

    def reset(self) -> None:
        self.killed, self.tree, self.wait_since = False, {}, None
        self.mcp_path = None

    def _write_mcp(self) -> Path | None:
        """§4.2: agent có `payload.mcp`, không phải lần thử lại định dạng → ghi file 0600 (token
        claim) ngoài `work/<job_id>`; Orchestrator có `mcp` → bỏ qua + `warn` (H1-R17)."""
        payload, job = self.run.payload, self.run.job
        if payload.mcp is None:
            return None
        if payload.output != "agent_result":
            get_logger().warning("mcp.ignored", reason="orchestrator")
            return None
        if not mcp.mcp_enabled(payload, retry=self.run.retry is not None):
            return None
        if not job.token:  # claim luôn sinh token (RT1) — phòng hờ
            get_logger().warning("mcp.ignored", reason="no_token")
            return None
        return mcp.write_config(self.cfg.work_root, job.id, payload.mcp.url, job.token)

    def _prepare_work(self) -> None:
        self.run.work.mkdir(mode=0o700, parents=True, exist_ok=True)
        (self.run.work / TMP_SUBDIR).mkdir(mode=0o700, exist_ok=True)

    def _open_stderr(self) -> int:
        path = stderr_log_path(self.cfg.log_dir, self.run.job.id)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        return os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)

    async def spawn(self) -> None:
        self._prepare_work()
        self.mcp_path = self._write_mcp()
        py_env = {k: os.environ[k] for k in _PY_ENV_KEYS if os.environ.get(k)}
        env = job_host_env(self.cfg.home, self.run.work, self.cfg.app_env, py_env)
        if self.mcp_path is not None:
            env |= mcp_env(mcp.tool_timeout_ms(self.run.payload.timeout_s))
        self.pipe = pipe = StdoutPipe()
        err_fd = self._open_stderr()
        try:
            proc = await asyncio.create_subprocess_exec(
                *child_argv(self.cfg.python, self.run.job.id),
                stdin=asyncio.subprocess.PIPE,
                stdout=pipe.write_fd,
                stderr=err_fd,
                cwd=self.run.work,
                env=env,
                start_new_session=True,  # group mới, pgid = pid con
            )
        finally:
            os.close(err_fd)
            pipe.close_write()
        pg.track_host(proc.pid)
        self.out = await pipe.attach(MAX_LINE_BYTES)
        self.proc = proc

    async def record_pgid(self) -> bool:
        assert self.proc is not None
        async with self.run.host.pool.acquire() as conn:
            ok = await jobs_sql.set_pgid(conn, self.run.job.id, self.cfg.worker_id, self.proc.pid)
        if ok:
            get_logger().info("job.spawned", pgid=self.proc.pid)
        else:
            get_logger().warning("job.not_owned_after_spawn")
        return ok

    def _request(self) -> bytes:
        roots = forbidden_roots(self.cfg.home, self.cfg.work_root)
        payload = self.run.payload
        if self.run.prompt != payload.prompt:
            payload = payload.model_copy(update={"prompt": self.run.prompt})
        req = ChildRequest(
            job_id=self.run.job.id,
            payload=payload,
            work_dir=str(self.run.work),
            forbidden_roots=[str(r) for r in roots],
            resume_session_id=self.run.resume_id,
            retry_prompt=self.run.retry,
            mcp_config_path=str(self.mcp_path) if self.mcp_path is not None else None,
        )
        return req.model_dump_json().encode() + b"\n"

    async def supervise(self) -> Outcome:
        reader = asyncio.create_task(self._read())
        stop = asyncio.create_task(self.run.control.stopped.wait())
        gone = asyncio.create_task(self._host_gone())
        try:
            done, _ = await asyncio.wait(
                {reader, stop, gone},
                timeout=max(0.0, self.run.deadline - time.monotonic()),
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
            self.run.seen.fatal, self.run.seen.parent_fault = READER_FAILED, True
            return
        self._mark_exit()

    def _mark_exit(self) -> None:
        """#2c: thoát vì tín hiệu mà cha không gửi (systemd dừng cả cgroup…)."""
        code = self.proc.returncode if self.proc is not None else None
        self.run.seen.signaled = code is not None and code < 0 and not self.killed

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
                self.run.seen.fatal, self.run.seen.parent_fault = EVENT_TOO_LARGE, True
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
            append_envelope(events_log_path(self.cfg.log_dir, self.run.job.id), ev)
        if isinstance(ev, Progress):
            await self.run.host.events.progress(self.run.job, ev.label)
        elif isinstance(ev, UsageEv):
            self.run.seen.usage = ev
        elif isinstance(ev, Session):
            self.run.seen.session_id = ev.session_id
        elif isinstance(ev, ToolUse):
            self.run.seen.tool_used = True
        elif isinstance(ev, Confirm):
            if self.run.seen.confirm is None:  # §5 #3: giữ cái đầu
                self.run.seen.confirm = ev
        elif isinstance(ev, Final):
            self.run.seen.final = ev
        elif isinstance(ev, RateLimit):
            if ev.status in BROKEN_SIGNALS:
                self.run.seen.rate_limit = ev
            else:
                get_logger().info("provider.rate_limit_signal", status=ev.status[:40])
        else:  # Fatal
            self.run.seen.fatal, self.run.seen.parent_fault = ev, ev is INVALID_EVENT
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

    async def kill_leftovers(self) -> None:
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
            if self.mcp_path is not None:  # §4.2: xoá ngay sau lần chạy (cleanup 24 h phòng hờ)
                mcp.remove_config(self.mcp_path)
                self.mcp_path = None
