"""WRK-FR-05 · AC-W03 · AC-W10 · kill_group: SIGTERM→SIGKILL group + cây `ppid` (unit, Linux)."""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest

from agent_runtime.sandbox.env import job_host_env
from agent_runtime.sandbox.process import (
    descendants,
    group_pids,
    kill_group,
    reap_strays,
    track_host,
    untrack_host,
)

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


def _stat_line(pid: int, state: str, ppid: int, pgrp: int) -> str:
    return f"{pid} (sh) {state} {ppid} {pgrp} 0 0"


def test_wrk_fr_05_reap_strays_only_orphan_zombies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review H1 #7: thu zombie `ppid` = Runtime (cháu mồ côi); không đụng job host đang theo dõi,
    trưởng group (job host) hay zombie của process khác."""
    me = os.getpid()
    rows = {
        101: ("Z", me, 50),  # cháu mồ côi → thu
        102: ("Z", me, 102),  # trưởng group = job host → bỏ
        103: ("Z", me, 60),  # job host đang theo dõi → bỏ
        104: ("Z", 1, 50),  # con process khác → bỏ
        105: ("S", me, 50),  # còn sống → bỏ
    }
    for pid, (st, ppid, pgrp) in rows.items():
        (tmp_path / str(pid)).mkdir()
        (tmp_path / str(pid) / "stat").write_text(_stat_line(pid, st, ppid, pgrp))
    reaped: list[int] = []

    def waitpid(pid: int, _opts: int) -> tuple[int, int]:
        reaped.append(pid)
        return pid, 0

    monkeypatch.setattr(os, "waitpid", waitpid)
    track_host(103)
    try:
        assert reap_strays(tmp_path) == 1
    finally:
        untrack_host(103)
    assert reaped == [101]
