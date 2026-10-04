"""WRK-NFR-04 · vòng đời process cha (plan-runtime §1.5)."""

import asyncio
import io
import os
import signal
from pathlib import Path
from typing import Any

import pytest

from agent_runtime import main as main_mod
from agent_runtime.config import Settings, load_settings
from agent_runtime.log import configure_logging
from agent_runtime.main import EXIT_CONFIG, main, run, serve
from agent_runtime.providers.keys import is_available
from agent_runtime.queue.runtime import registry_providers


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


class _FakeQueue:
    def __init__(self) -> None:
        self.shut = False

    def services(self) -> list[Any]:
        return []

    async def shutdown(self) -> None:
        self.shut = True


def _settings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Settings:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379")
    monkeypatch.setenv("AGENT_RT_DATABASE_URL", "postgres://a:b@h/d")
    return load_settings()


async def test_wrk_nfr_04_sigterm_exits_0(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = _settings(monkeypatch, tmp_path)
    fake = _FakeQueue()

    async def start(_s: Settings) -> Any:
        return fake

    monkeypatch.setattr(main_mod, "start_queue", start)
    asyncio.get_running_loop().call_later(0.05, os.kill, os.getpid(), signal.SIGTERM)
    assert await asyncio.wait_for(run(settings), 2) == 0
    assert fake.shut


async def test_wrk_nfr_04_sigterm_during_startup_exits_0(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = _settings(monkeypatch, tmp_path)

    async def start(_s: Settings) -> Any:
        await asyncio.sleep(3600)

    monkeypatch.setattr(main_mod, "start_queue", start)
    asyncio.get_running_loop().call_later(0.05, os.kill, os.getpid(), signal.SIGTERM)
    assert await asyncio.wait_for(run(settings), 2) == 0


async def test_wrk_nfr_04_startup_failure_exits_1(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, quiet_log: io.StringIO
) -> None:
    settings = _settings(monkeypatch, tmp_path)

    async def start(_s: Settings) -> Any:
        raise OSError("postgres://a:pw_y@h/d unreachable")

    monkeypatch.setattr(main_mod, "start_queue", start)
    assert await asyncio.wait_for(run(settings), 2) == 1
    assert "runtime.startup_failed" in quiet_log.getvalue()
    assert "pw_y" not in quiet_log.getvalue()


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


def test_wrk_fr_10_unknown_provider_exits_2(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    """Review H1 #8: `AGENT_RT_PROVIDERS` lọc theo registry (`APP_ENV`); khoá lạ → exit 2 có log."""
    _settings(monkeypatch, tmp_path)
    monkeypatch.setenv("AGENT_RT_PROVIDERS", "claude-sub,nope-cli")
    assert main() == EXIT_CONFIG
    out = capsys.readouterr().out
    assert "runtime.config_invalid" in out and "nope-cli" in out


def test_wrk_fr_10_registry_providers_by_app_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("AGENT_RT_PROVIDERS", "fake-cli,claude-sub,fake-cli")
    assert registry_providers(_settings(monkeypatch, tmp_path)) == ["fake-cli", "claude-sub"]
    assert not is_available("fake-cli", "production") and is_available("claude-sub", "production")
