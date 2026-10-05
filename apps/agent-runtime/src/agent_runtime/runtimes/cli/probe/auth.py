"""WRK-FR-22 · H3a-R14(a) · Bước đăng nhập của probe (plan-runtime H3a §4.1, Spike S1 #2–#4):
`<CLI đi kèm SDK> auth status --json` — chỉ đọc file local, không mạng, không tốn quota.

Chỉ đọc khoá `loggedIn` (`quota_rules.auth_logged_in`). stdout có email/orgId (PII) ⇒ **không log**,
bỏ bytes sau khi đọc; stderr ⇒ `DEVNULL` (PL9). Hạn `AUTH_TIMEOUT_S` ⇒ giết group ⇒ None (lỗi
probe, PL7). `fake-cli`: không chạy process — chỉ thị `logged_out` ⇒ False, còn lại ⇒ True.
"""

from __future__ import annotations

import asyncio
import importlib.util
import time
from contextlib import suppress
from pathlib import Path

from agent_runtime.providers.keys import FAKE_KEY
from agent_runtime.runtimes.cli.probe import ProbeHostCfg, note_call, probe_dir, read_fake
from agent_runtime.runtimes.cli.quota_rules import auth_logged_in, parse_fake_probe
from agent_runtime.sandbox import process as pg
from agent_runtime.sandbox.env import job_host_env

AUTH_TIMEOUT_S = 15.0
AUTH_STDOUT_MAX = 64 * 1024
AUTH_ARGS = ("auth", "status", "--json")


def bundled_cli() -> Path | None:
    """Cùng đường `SubprocessCLITransport._find_bundled_cli` (không import gói SDK ~5 s)."""
    spec = importlib.util.find_spec("claude_agent_sdk")
    locations = spec.submodule_search_locations if spec is not None else None
    if not locations:
        return None
    path = Path(next(iter(locations))) / "_bundled" / "claude"
    return path if path.is_file() else None


def cli_of(cfg: ProbeHostCfg) -> Path | None:
    """`AGENT_RT_CLI_PATH` nếu có, ngược lại CLI đi kèm SDK; không có file ⇒ None."""
    if cfg.cli_path:
        path = Path(cfg.cli_path)
        return path if path.is_file() else None
    return bundled_cli()


async def _read_capped(stream: asyncio.StreamReader) -> bytes | None:
    """stdout tới EOF; vượt `AUTH_STDOUT_MAX` ⇒ None (không phải JSON trạng thái hợp lệ)."""
    buf = bytearray()
    while chunk := await stream.read(AUTH_STDOUT_MAX + 1 - len(buf)):
        buf += chunk
        if len(buf) > AUTH_STDOUT_MAX:
            return None
    return bytes(buf)


async def _status(proc: asyncio.subprocess.Process) -> bool | None:
    assert proc.stdout is not None
    async with asyncio.timeout(AUTH_TIMEOUT_S):
        out = await _read_capped(proc.stdout)
        if out is None:
            return None
        code = await proc.wait()
    return auth_logged_in(code, out)


async def _cli_status(cfg: ProbeHostCfg, cli: Path, cwd: Path) -> bool | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            str(cli),
            *AUTH_ARGS,
            cwd=cwd,
            env=job_host_env(cfg.home, cwd, cfg.app_env),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        return None
    pg.track_host(proc.pid)
    try:
        return await _status(proc)
    except TimeoutError:
        return None
    finally:
        if proc.returncode is None or pg.group_pids(proc.pid):
            await pg.kill_group(proc.pid, proc.wait, cfg.kill_grace_s)
        with suppress(ProcessLookupError):
            await proc.wait()
        pg.untrack_host(proc.pid)


async def auth_status(cfg: ProbeHostCfg, key: str) -> tuple[bool | None, int]:
    """(kết quả `auth_logged_in`, ms). Ghi `auth` vào file đếm trước bước (`rt §5`)."""
    started = time.monotonic()
    note_call(cfg, "auth")
    if key == FAKE_KEY:
        got: bool | None = parse_fake_probe(read_fake(cfg)).kind != "logged_out"
    else:
        cwd = probe_dir(cfg, key)
        cli = cli_of(cfg)
        got = None if cli is None else await _cli_status(cfg, cli, cwd)
    return got, int((time.monotonic() - started) * 1000)
