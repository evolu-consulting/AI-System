"""WRK-FR-05 · WRK-FR-15 · WRK-FR-24 · review H1 v2 N1/N2 (unit, Linux) — `JobRun` với pipe
stdout do cha tạo: xử lý sự kiện chậm không bị tính là "cháu giữ pipe"; cháu `setsid` ra đời rồi job
host chết ngay vẫn bị giết, pipe đóng (không rò fd)."""

from __future__ import annotations

import asyncio
import os
import shlex
import time
from pathlib import Path

from agent_runtime.providers.base import Final, Progress
from agent_runtime.runtimes.cli import host_proc as hp
from agent_runtime.runtimes.cli.outcome import decide_exit
from agent_runtime.runtimes.cli.protocol import encode_event
from agent_runtime.runtimes.cli.test_job_run import make_run, start
from agent_runtime.sandbox import process as pg

FINAL = Final(kind="agent_result", structured={"status": "done", "text": "x"})


def _printf(*lines: bytes) -> str:
    return "printf '%s\\n' " + " ".join(shlex.quote(b.decode().rstrip("\n")) for b in lines)


async def test_wrk_fr_15_slow_progress_then_final_kept(tmp_path: Path) -> None:
    """N1: `Progress` xử lý (Redis) lâu hơn `DRAIN_S` sau khi job host thoát, rồi `Final` → kết quả
    còn, không đếm lỗi provider."""
    run, host = make_run(tmp_path)
    host.events.progress_s = hp.DRAIN_S + 0.8
    await start(run, _printf(encode_event(Progress(label="p")), encode_event(FINAL)) + "; exit 0")
    assert await run.proc_host.supervise() == "exited"
    await run.proc_host.kill_leftovers()
    assert run.seen.final == FINAL
    v = decide_exit(run.payload, run.seen)
    assert v.failure is None and v.provider != "error"


def _fds_on(inode: int) -> list[str]:
    target, out = f"pipe:[{inode}]", list[str]()
    for fd in os.listdir("/proc/self/fd"):
        try:
            if os.readlink(f"/proc/self/fd/{fd}") == target:
                out.append(fd)
        except OSError:
            continue
    return out


async def test_wrk_fr_05_setsid_grandchild_killed_pipe_closed(tmp_path: Path) -> None:
    """N2: job host `setsid sleep 30 &` rồi `exit 0` (cháu ngoài group, mồ côi trước khi chụp cây)
    → cháu bị giết, không còn ai giữ pipe, Runtime không rò fd pipe."""
    run, _ = make_run(tmp_path)
    await start(run, "setsid sleep 30 & exit 0")
    assert run.proc_host.pipe is not None
    inode = run.proc_host.pipe.inode
    t0 = time.monotonic()
    assert await run.proc_host.supervise() == "exited"
    held = pg.stamp(pg.pipe_holders(inode))
    assert held  # cháu còn giữ đầu ghi
    await run.proc_host.kill_leftovers()
    assert time.monotonic() - t0 < hp.DRAIN_S + 5
    assert pg.pipe_holders(inode) == set()
    assert pg.still_alive(held) == set()
    await asyncio.sleep(0.05)  # `transport.close()` đóng fd ở vòng lặp kế
    assert run.proc_host.pipe.transport is None and _fds_on(inode) == []
