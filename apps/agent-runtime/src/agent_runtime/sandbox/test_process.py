"""WRK-FR-05 · AC-W03 · AC-W10 · kill_group: SIGTERM→SIGKILL group + cây `ppid` (unit, Linux)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from agent_runtime.sandbox.env import job_host_env
from agent_runtime.sandbox.process import descendants, group_pids, kill_group

# Con cùng group + cháu `setsid` (thoát group — dự phòng §13); bỏ qua SIGTERM để buộc SIGKILL.
SCRIPT = "trap '' TERM; sleep 300 & setsid sleep 301 & echo ready; wait"


async def _spawn() -> asyncio.subprocess.Process:
    proc = await asyncio.create_subprocess_exec(
        "sh", "-c", SCRIPT, stdout=asyncio.subprocess.PIPE, start_new_session=True
    )
    assert proc.stdout is not None
    await proc.stdout.readline()
    return proc


async def test_wrk_fr_05_cancel_kills_group_and_detached_tree() -> None:
    proc = await _spawn()
    pgid = proc.pid
    tree = descendants(pgid)
    assert len(tree) >= 2 and len(group_pids(pgid)) >= 2
    t0 = time.monotonic()
    left = await kill_group(pgid, proc.wait, grace_s=0.5)
    assert left == set()
    assert time.monotonic() - t0 < 5
    assert group_pids(pgid) == [] and descendants(pgid) == set()
    assert all(not group_pids(p) for p in tree)


async def test_wrk_fr_05_kill_group_of_exited_host_is_noop() -> None:
    proc = await asyncio.create_subprocess_exec("true", start_new_session=True)
    await proc.wait()
    assert await kill_group(proc.pid, proc.wait, grace_s=0.1) == set()


def test_wrk_br_02_env_whitelist_only() -> None:
    env = job_host_env(
        Path("/home/w"),
        Path("/w/work/j1"),
        "test",
        {"VIRTUAL_ENV": "/opt/venv", "REDIS_URL": "redis://x", "PYTHONPATH": ""},
    )
    assert set(env) == {"HOME", "PATH", "LANG", "TMPDIR", "APP_ENV", "VIRTUAL_ENV"}
    assert env["HOME"] == "/home/w" and env["TMPDIR"] == "/w/work/j1/.tmp"
    assert env["PATH"] == "/usr/local/bin:/usr/bin:/bin"
