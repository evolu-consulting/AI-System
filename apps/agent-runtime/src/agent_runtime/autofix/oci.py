"""HUB-BR-33 · WRK-BR-08 · WRK-FR-28 · P-c1 · Driver container `OciCli` (ADR-0011 #1, #3, #5;
plan-runtime §5.1–§5.2). Gọi `docker`/`podman` bằng MẢNG đối số (không shell), timeout mọi lệnh,
env của CLI chỉ gồm biến cần để tới engine (không token/secret của Runtime).

Tự kiểm lúc khởi động (`open_sandbox`): CLI chạy được → ảnh có → container thử đọc
`/sys/fs/cgroup/memory.max` = trần đặt (cgroup v1/không delegate ⇒ trần bị bỏ qua âm thầm). Sai ⇒
log `sandbox.unavailable`, coi như `off` (job tự-sửa lỗi `container`).
"""

from __future__ import annotations

import asyncio
import os
import signal
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal, Protocol

from agent_runtime.autofix.rules import (
    UID_GID,
    WORKSPACE,
    Engine,
    Phase,
    SandboxSpec,
    container_args,
    container_name,
)
from agent_runtime.log import get_logger

SandboxMode = Literal["off", "docker", "podman", "fake"]
TAIL_BYTES = 32 * 1024
CTL_TIMEOUT_S = 120.0
_DRAIN_GRACE_S = 2.0
_CLI_ENV_KEYS = (
    "PATH",
    "HOME",
    "DOCKER_HOST",
    "DOCKER_CONFIG",
    "XDG_RUNTIME_DIR",
    "CONTAINER_HOST",
)


@dataclass(frozen=True)
class ExecReq:
    """Một lệnh: `cmd` chạy bằng `sh -c cmd _ *args` (đối số không nội suy vào chuỗi)."""

    cmd: str
    args: tuple[str, ...] = ()
    stdin: bytes | None = None
    timeout_s: float = CTL_TIMEOUT_S
    tail_bytes: int = TAIL_BYTES


@dataclass(frozen=True)
class ExecResult:
    exit_code: int | None  # None = hết giờ (đã kill)
    stdout: bytes
    stderr: bytes
    truncated: bool  # stdout/stderr bị cắt chỉ giữ đuôi
    timed_out: bool
    ms: int


class OciError(Exception):
    """Lỗi engine (dựng/exec container). `reason` là mã ngắn, không chứa secret."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"oci {reason}: {detail}" if detail else f"oci {reason}")
        self.reason = reason
        self.detail = detail


class Oci(Protocol):
    async def run(self, spec: SandboxSpec, phase: Phase) -> str: ...
    async def exec(self, name: str, req: ExecReq) -> ExecResult: ...
    async def rm(self, name: str) -> None: ...
    async def ps(self) -> list[str]: ...


class _Tail:
    def __init__(self, limit: int) -> None:
        self.buf = bytearray()
        self.cut = False
        self._limit = limit

    async def pump(self, stream: asyncio.StreamReader | None) -> None:
        if stream is None:
            return
        while chunk := await stream.read(65536):
            self.buf += chunk
            if len(self.buf) > self._limit:
                del self.buf[: len(self.buf) - self._limit]
                self.cut = True


def _killpg(proc: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


async def _feed(proc: asyncio.subprocess.Process, data: bytes | None) -> None:
    if proc.stdin is None:
        return
    try:
        if data:
            proc.stdin.write(data)
            await proc.stdin.drain()
        proc.stdin.close()
    except (BrokenPipeError, ConnectionResetError):
        pass


async def run_proc(
    argv: list[str], req: ExecReq, env: dict[str, str], cwd: Path | None = None
) -> ExecResult:
    """Chạy `argv` (nhóm tiến trình riêng); hết `timeout_s` ⇒ SIGKILL cả nhóm. Giữ đuôi output."""
    t0 = time.monotonic()
    stdin = asyncio.subprocess.PIPE if req.stdin is not None else asyncio.subprocess.DEVNULL
    proc = await asyncio.create_subprocess_exec(  # noqa: S603 — mảng đối số, không shell
        *argv,
        stdin=stdin,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=cwd,
        start_new_session=True,
    )
    out, err = _Tail(req.tail_bytes), _Tail(req.tail_bytes)
    pumps = asyncio.gather(out.pump(proc.stdout), err.pump(proc.stderr), _feed(proc, req.stdin))
    timed_out = False
    try:
        await asyncio.wait_for(proc.wait(), req.timeout_s)
    except TimeoutError:
        timed_out = True
        _killpg(proc)
        await proc.wait()
    except BaseException:  # bị huỷ từ ngoài (job dừng) ⇒ không để tiến trình sót
        _killpg(proc)
        pumps.cancel()
        raise
    try:
        await asyncio.wait_for(pumps, _DRAIN_GRACE_S)
    except TimeoutError:  # con cháu giữ pipe sau khi tiến trình chính thoát
        _killpg(proc)
    return ExecResult(
        exit_code=None if timed_out else proc.returncode,
        stdout=bytes(out.buf),
        stderr=bytes(err.buf),
        truncated=out.cut or err.cut,
        timed_out=timed_out,
        ms=int((time.monotonic() - t0) * 1000),
    )


def _ctl(timeout_s: float = CTL_TIMEOUT_S) -> ExecReq:
    return ExecReq(cmd="", timeout_s=timeout_s, tail_bytes=8192)


def _short(raw: bytes) -> str:
    return raw.decode("utf-8", "replace").strip()[-300:]


class OciCli:
    """`docker`/`podman` qua CLI. `cli` = đường dẫn nhị phân (mặc định tên engine trên PATH)."""

    def __init__(self, engine: Engine, cli: str | None = None) -> None:
        self.engine: Engine = engine
        self._bin = cli or engine

    def _env(self) -> dict[str, str]:
        return {k: v for k in _CLI_ENV_KEYS if (v := os.environ.get(k))}

    async def _cli(self, args: list[str], req: ExecReq) -> ExecResult:
        try:
            return await run_proc([self._bin, *args], req, self._env())
        except OSError as err:  # nhị phân không có / không chạy được
            raise OciError("cli", type(err).__name__) from err

    async def run(self, spec: SandboxSpec, phase: Phase) -> str:
        """Dựng container `-d` (sleep infinity); trùng tên/lỗi ⇒ `OciError("run_failed")`."""
        argv = container_args(replace(spec, engine=self.engine), phase=phase)
        res = await self._cli(argv, _ctl())
        if res.exit_code != 0:
            raise OciError("run_failed", _short(res.stderr))
        return container_name(spec.job_id, phase)

    async def exec(self, name: str, req: ExecReq) -> ExecResult:
        """`exec [-i] --user 1000:1000 -w /workspace <ctr> sh -c <cmd> _ <args…>`; hết giờ ⇒ kill
        mọi tiến trình user 1000 trong container (PID 1 `sleep` được kernel bảo vệ)."""
        head = ["exec", *(["-i"] if req.stdin is not None else [])]
        argv = [*head, "--user", UID_GID, "-w", WORKSPACE, name, "sh", "-c", req.cmd, "_"]
        res = await self._cli([*argv, *req.args], req)
        if res.timed_out:
            kill = ["exec", "--user", UID_GID, name, "sh", "-c", "kill -9 -1"]
            await self._cli(kill, _ctl(10))
        return res

    async def rm(self, name: str) -> None:
        res = await self._cli(["rm", "-f", name], _ctl(30))
        if res.exit_code != 0:
            get_logger().warning("sandbox.rm_failed", container=name, error=_short(res.stderr))

    async def ps(self) -> list[str]:
        """Tên container nhãn `ai.autofix=1` (mọi trạng thái) — cho sweeper."""
        args = ["ps", "-a", "--filter", "label=ai.autofix=1", "--format", "{{.Names}}"]
        res = await self._cli(args, _ctl(30))
        if res.exit_code != 0:
            raise OciError("ps_failed", _short(res.stderr))
        return [n for n in res.stdout.decode("utf-8", "replace").split() if n.startswith("aif-")]

    async def self_check(self, image: str, memory_mb: int) -> str | None:
        """None = đạt; ngược lại mã lý do `cli` | `image` | `cgroup`."""
        try:
            if (await self._cli(["version"], _ctl(20))).exit_code != 0:
                return "cli"
            if (await self._cli(["image", "inspect", image], _ctl(20))).exit_code != 0:
                return "image"
            mem = f"{memory_mb}m"
            probe = ["run", "--rm", "--network", "none", "--memory", mem, "--memory-swap", mem]
            probe += ["--user", UID_GID, image, "cat", "/sys/fs/cgroup/memory.max"]
            res = await self._cli(probe, _ctl(60))
        except OciError:
            return "cli"
        want = str(memory_mb * 1024 * 1024).encode()
        return None if res.exit_code == 0 and res.stdout.strip() == want else "cgroup"


@dataclass(frozen=True)
class SandboxCfg:
    mode: SandboxMode
    image: str
    memory_mb: int
    app_env: str
    fake_dir: Path


async def open_sandbox(cfg: SandboxCfg) -> Oci | None:
    """Khởi động Runtime: `off` ⇒ None; `fake` chỉ khi APP_ENV=test; engine thật ⇒ tự kiểm."""
    log = get_logger()
    if cfg.mode == "off":
        log.info("sandbox.off")
        return None
    if cfg.mode == "fake":
        if cfg.app_env != "test":
            log.error("sandbox.unavailable", engine="fake", reason="fake_not_test")
            return None
        from agent_runtime.autofix.fake_oci import FakeOci  # tránh import vòng

        log.warning("sandbox.fake", workdir=str(cfg.fake_dir))
        return FakeOci(cfg.fake_dir)
    oci = OciCli(cfg.mode)
    reason = await oci.self_check(cfg.image, cfg.memory_mb)
    if reason is not None:
        log.warning("sandbox.unavailable", engine=cfg.mode, image=cfg.image, reason=reason)
        return None
    log.info("sandbox.ready", engine=cfg.mode, image=cfg.image)
    return oci
