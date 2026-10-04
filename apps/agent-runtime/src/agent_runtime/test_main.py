"""WRK-NFR-04 · vòng đời process cha (plan-runtime §1.5)."""

import asyncio
import io
import os
import signal
from pathlib import Path

import pytest

from agent_runtime.config import load_settings
from agent_runtime.log import configure_logging
from agent_runtime.main import EXIT_CONFIG, main, run, serve


@pytest.fixture(autouse=True)
def quiet_log() -> io.StringIO:
    buf = io.StringIO()
    configure_logging("info", worker_id="w-test", stream=buf)
    return buf


async def test_wrk_nfr_04_serve_stops_cleanly() -> None:
    stop = asyncio.Event()

    async def svc() -> None:
        await asyncio.sleep(3600)

    asyncio.get_running_loop().call_later(0.05, stop.set)
    assert await asyncio.wait_for(serve(stop, [svc]), 2) == 0


async def test_wrk_nfr_04_serve_task_failure_exits_1(quiet_log: io.StringIO) -> None:
    async def boom() -> None:
        raise RuntimeError("postgres://u:pw_x@h/db down")

    assert await asyncio.wait_for(serve(asyncio.Event(), [boom]), 2) == 1
    assert "runtime.task_failed" in quiet_log.getvalue()
    assert "pw_x" not in quiet_log.getvalue()


async def test_wrk_nfr_04_sigterm_exits_0(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379")
    monkeypatch.setenv("AGENT_RT_DATABASE_URL", "postgres://a:b@h/d")
    settings = load_settings()
    asyncio.get_running_loop().call_later(0.05, os.kill, os.getpid(), signal.SIGTERM)
    assert await asyncio.wait_for(run(settings), 2) == 0


def test_wrk_nfr_04_invalid_config_exits_2(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("AGENT_RT_DATABASE_URL", "postgres://a:secret_in_env@h/d")
    monkeypatch.delenv("REDIS_URL", raising=False)
    assert main() == EXIT_CONFIG
    out = capsys.readouterr().out
    assert "runtime.config_invalid" in out and "REDIS_URL" in out
    assert "secret_in_env" not in out
