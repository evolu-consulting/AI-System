"""CR-114 hub-warm-runtime — host `child --warm` thật (Linux, provider `fake-cli`): gắn job (cwd,
stderr, env), orphans.py nhận ra qua cwd, đóng stdin ⇒ thoát êm; và **số đo** spawn lạnh vs host
dựng sẵn: thời gian từ lúc có job tới sự kiện đầu tiên (`tasks.md` "Số đo")."""

from __future__ import annotations

import asyncio
import os
import sys
import time
from dataclasses import replace
from pathlib import Path

from agent_runtime.runtimes.cli.protocol import (
    MAX_LINE_BYTES,
    WARM_FLAG,
    ChildRequest,
    WarmBind,
    child_argv,
    parse_event,
)
from agent_runtime.runtimes.cli.runner import HostConfig
from agent_runtime.runtimes.cli.stdout_pipe import StdoutPipe
from agent_runtime.runtimes.cli.test_job_run import make_run
from agent_runtime.runtimes.cli.test_runner import payload
from agent_runtime.runtimes.cli.warm_host import discard_warm, make_pool, mem_ok, spawn_warm
from agent_runtime.sandbox import process as pg
from agent_runtime.sandbox.env import TMP_SUBDIR, job_host_env

ROUNDS = 3


def _cwd(pid: int) -> str:
    """= `queue/orphans.read_cwd` (lớp `runtimes` không import `queue`)."""
    try:
        return os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        return ""


def _cfg(tmp: Path) -> HostConfig:
    return HostConfig("w-1", tmp / "work", tmp / "logs", tmp, "test", 0.5)


def _request(tmp: Path, warm: bool) -> tuple[ChildRequest, Path]:
    p = payload()
    work = tmp / "work" / str(p.job_id)
    (work / TMP_SUBDIR).mkdir(mode=0o700, parents=True)
    bind = WarmBind(stderr_path=str(tmp / f"{p.job_id}.err"), env={"TMPDIR": str(work / ".tmp")})
    req = ChildRequest(
        job_id=str(p.job_id), payload=p, work_dir=str(work), forbidden_roots=[],
        warm=bind if warm else None,
    )  # fmt: skip
    return req, work


async def _first_event(proc: asyncio.subprocess.Process, out: asyncio.StreamReader,
                       req: ChildRequest) -> float:  # fmt: skip
    t0 = time.perf_counter()
    assert proc.stdin is not None
    proc.stdin.write(req.model_dump_json().encode() + b"\n")
    await proc.stdin.drain()
    proc.stdin.close()
    line = await out.readline()
    dt = time.perf_counter() - t0
    assert line and parse_event(line).type != "fatal", line
    await proc.wait()
    return dt


async def _cold(tmp: Path) -> float:
    """Như `HostProcess.spawn`: tính từ lúc có job (spawn) tới sự kiện đầu."""
    req, work = _request(tmp, warm=False)
    py_env = {k: os.environ[k] for k in ("VIRTUAL_ENV", "PYTHONPATH") if os.environ.get(k)}
    pipe = StdoutPipe()
    t0 = time.perf_counter()
    proc = await asyncio.create_subprocess_exec(
        *child_argv(sys.executable, req.job_id), stdin=asyncio.subprocess.PIPE,
        stdout=pipe.write_fd, cwd=work, env=job_host_env(tmp, work, "test", py_env),
        start_new_session=True,
    )  # fmt: skip
    pipe.close_write()
    out = await pipe.attach(MAX_LINE_BYTES)
    spawn_s = time.perf_counter() - t0
    try:
        return spawn_s + await _first_event(proc, out, req)
    finally:
        pipe.close()


async def test_cr114_warm_host_binds_job_and_orphan_check(tmp_path: Path) -> None:
    host = await spawn_warm(_cfg(tmp_path))
    req, work = _request(tmp_path, warm=True)
    cmd = Path(f"/proc/{host.proc.pid}/cmdline").read_bytes().split(b"\0")  # noqa: ASYNC240
    assert WARM_FLAG.encode() in cmd and Path(_cwd(host.proc.pid)).name == ".warm"  # chưa gắn
    try:
        assert host.proc.stdin is not None
        host.proc.stdin.write(req.model_dump_json().encode() + b"\n")
        await host.proc.stdin.drain()
        assert await host.out.readline()  # đã gắn: chạy provider
        cwd = _cwd(host.proc.pid)
        if cwd:  # còn sống lúc đọc ⇒ orphans.py nhận theo cwd `<job_id>`
            assert Path(cwd) == work
        host.proc.stdin.close()
        await host.proc.wait()
    finally:
        host.pipe.close()
        pg.untrack_host(host.proc.pid)
    assert os.path.exists(req.warm.stderr_path if req.warm else "")  # noqa: PTH110, ASYNC240


async def test_cr114_warm_host_bad_bind_env_refused(tmp_path: Path) -> None:
    host = await spawn_warm(_cfg(tmp_path))
    req, _ = _request(tmp_path, warm=True)
    req = req.model_copy(update={"warm": WarmBind(stderr_path="/dev/null", env={"HOME": "/x"})})
    assert host.proc.stdin is not None
    try:
        host.proc.stdin.write(req.model_dump_json().encode() + b"\n")
        host.proc.stdin.close()
        ev = parse_event(await host.out.readline())
        assert ev.type == "fatal"
        await host.proc.wait()
    finally:
        host.pipe.close()
        pg.untrack_host(host.proc.pid)
    assert host.proc.returncode == 2


async def test_cr114_host_process_uses_warm_host(tmp_path: Path) -> None:
    """`HostProcess.spawn` lấy host từ bể (không spawn lạnh) → job chạy hết tới `final`."""
    cfg = _cfg(tmp_path)
    pool = make_pool(cfg, 1)
    assert pool is not None
    cfg = replace(cfg, warm=pool)
    host = await spawn_warm(cfg)
    pool.idle.append(host)
    run, _ = make_run(tmp_path)
    run.cfg = run.proc_host.cfg = cfg
    hp = run.proc_host
    try:
        await hp.spawn()
        assert hp.proc is host.proc and hp.warm is not None
        assert await hp.supervise() == "exited"
        assert run.seen.final is not None and run.seen.fatal is None
    finally:
        await hp.kill_leftovers()
        await pool.close()


async def test_cr114_discard_idle_host_exits_clean(tmp_path: Path) -> None:
    host = await spawn_warm(_cfg(tmp_path))
    await discard_warm(host, 5.0)
    assert host.proc.returncode == 0  # EOF stdin ⇒ thoát êm, không cần giết


def test_cr114_mem_ok_reads_meminfo(tmp_path: Path) -> None:
    f = tmp_path / "meminfo"
    f.write_text("MemTotal: 8000000 kB\nMemAvailable:  300000 kB\n")
    assert not mem_ok(f, 512) and mem_ok(f, 256)
    assert mem_ok(tmp_path / "missing", 512)


def _ms(xs: list[float]) -> list[int]:
    return [round(x * 1000) for x in xs]


async def test_cr114_measure_cold_vs_warm_first_event(tmp_path: Path) -> None:
    """Số đo (in ra, ghi `tasks.md`): median 3 lượt; host dựng sẵn phải nhanh hơn rõ."""
    cold = sorted([await _cold(tmp_path / f"c{i}") for i in range(ROUNDS)])
    warm: list[float] = []
    for i in range(ROUNDS):
        host = await spawn_warm(_cfg(tmp_path / f"w{i}"))  # trả về khi host báo đã import xong
        req, _ = _request(tmp_path / f"w{i}", warm=True)
        try:
            warm.append(await _first_event(host.proc, host.out, req))
        finally:
            host.pipe.close()
            pg.untrack_host(host.proc.pid)
    warm.sort()
    c, w = cold[ROUNDS // 2], warm[ROUNDS // 2]
    print(f"\nCR-114 first-event cold={c * 1000:.0f}ms warm={w * 1000:.0f}ms "  # noqa: T201
          f"cold_all={_ms(cold)} warm_all={_ms(warm)}")  # fmt: skip
    assert w < c / 2
