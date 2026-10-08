"""WRK-FR-22 · H3a-R14(b) · Bước lượt tối thiểu của probe phía cha (plan-runtime H3a §4.2):
spawn con `probe.child` (process group riêng, env danh sách trắng `job_host_env` + venv), một dòng
`ProbeRequest` qua stdin, gom sự kiện stdout vào `ProbeSeen`; stderr ⇒ `DEVNULL` (PL9).

Hạn `AGENT_RT_PROBE_TIMEOUT_S` ⇒ giết group ⇒ `timed_out=True`. Huỷ (shutdown) ⇒ giết group trong
`finally`. Log `claude.rate_limit{source:"probe"}` (khung, không giá trị — R04); không log nội dung.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from agent_runtime.log import get_logger
from agent_runtime.providers.base import (
    Fatal,
    Final,
    Models,
    ProbeRequest,
    ProviderEvent,
    RateLimit,
    UsageEv,
)
from agent_runtime.runtimes.cli.probe import ProbeHostCfg, note_call, probe_argv, probe_dir
from agent_runtime.runtimes.cli.protocol import EVENT_TOO_LARGE, MAX_LINE_BYTES, parse_event
from agent_runtime.runtimes.cli.quota_rules import clean_type, clean_util
from agent_runtime.sandbox import process as pg
from agent_runtime.sandbox.env import job_host_env

_PY_ENV_KEYS = ("VIRTUAL_ENV", "PYTHONPATH")
_RANK = {"allowed": 0, "allowed_warning": 1}  # còn lại (`rejected`/`logged_out`) = 2


@dataclass
class ProbeSeen:
    """`rt §2`: sự kiện gom từ con probe (thoả `quota_rules.ProbeSeenLike`)."""

    rate_limit: RateLimit | None = None
    final: Final | None = None
    fatal: Fatal | None = None
    usage: UsageEv | None = None
    models: Models | None = None  # CR-054

    def add(self, ev: ProviderEvent) -> bool:
        """True = ngừng đọc (fatal). `rate_limit` giữ tín hiệu nặng nhất (hỏng > cảnh báo > ok)."""
        if isinstance(ev, RateLimit):
            old = self.rate_limit
            if old is None or _RANK.get(ev.status, 2) >= _RANK.get(old.status, 2):
                self.rate_limit = ev
        elif isinstance(ev, Final):
            self.final = ev
        elif isinstance(ev, UsageEv):
            self.usage = ev
        elif isinstance(ev, Models):
            self.models = ev
        elif isinstance(ev, Fatal):
            self.fatal = ev
            return True
        return False


def _log_rate(key: str, ev: RateLimit) -> None:
    get_logger().info(
        "claude.rate_limit",
        provider=key,
        source="probe",
        status=ev.status[:40],
        rate_limit_type=clean_type(ev.rate_limit_type),
        utilization=clean_util(ev.utilization),
        resets_at=ev.resets_at,
        keys=ev.raw_shape,
    )


async def _spawn(cfg: ProbeHostCfg, key: str, cwd: Path) -> asyncio.subprocess.Process:
    py_env = {k: os.environ[k] for k in _PY_ENV_KEYS if os.environ.get(k)}
    proc = await asyncio.create_subprocess_exec(
        *probe_argv(cfg.python, key),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        cwd=cwd,
        env=job_host_env(cfg.home, cwd, cfg.app_env, py_env),
        start_new_session=True,  # group mới, pgid = pid con
        limit=MAX_LINE_BYTES,
    )
    pg.track_host(proc.pid)
    return proc


async def _talk(proc: asyncio.subprocess.Process, req: ProbeRequest, seen: ProbeSeen) -> None:
    assert proc.stdin is not None and proc.stdout is not None
    with suppress(BrokenPipeError, ConnectionResetError):
        proc.stdin.write(req.model_dump_json().encode() + b"\n")
        await proc.stdin.drain()
        proc.stdin.close()
    while True:
        try:
            line = await proc.stdout.readline()
        except ValueError:  # dòng vượt MAX_LINE_BYTES
            seen.fatal = EVENT_TOO_LARGE
            return
        if not line:
            break
        ev = parse_event(line)
        if isinstance(ev, RateLimit):
            _log_rate(req.provider_key, ev)
        if seen.add(ev):
            return
    await proc.wait()


async def _reap(proc: asyncio.subprocess.Process, grace_s: float) -> None:
    try:
        if proc.returncode is None or pg.group_pids(proc.pid):
            await pg.kill_group(proc.pid, proc.wait, grace_s)
        with suppress(ProcessLookupError):
            await proc.wait()
    finally:
        pg.untrack_host(proc.pid)


async def probe_turn(cfg: ProbeHostCfg, key: str, fake: str | None) -> tuple[ProbeSeen, bool]:
    """(seen, timed_out). `fake` = chỉ thị `fake-cli` (cha đọc file mỗi lượt — `read_fake`)."""
    note_call(cfg, "turn")
    cwd = probe_dir(cfg, key)
    req = ProbeRequest(provider_key=key, work_dir=str(cwd), cli_path=cfg.cli_path, fake=fake)
    seen = ProbeSeen()
    try:
        proc = await _spawn(cfg, key, cwd)
    except OSError:
        seen.fatal = Fatal(code="INTERNAL_ERROR", msg="probe child spawn failed")
        return seen, False
    try:
        async with asyncio.timeout(cfg.timeout_s):
            await _talk(proc, req, seen)
        return seen, False
    except TimeoutError:
        return seen, True
    finally:
        await _reap(proc, cfg.kill_grace_s)
