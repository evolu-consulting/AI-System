"""DLC-R01 · DLC-R02 · DLC-R08 · `JobRouter` chọn `DlcJobHost` theo `provider_key`; cấu hình `dlc`;
huỷ job chat → `cancelled`."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, cast

import pytest
from pydantic import ValidationError

from agent_runtime.config import Settings
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.runtimes.dispatch import JobRouter, StopControl
from agent_runtime.runtimes.dlc.host import CANCELLED, DlcConfig, DlcJobHost
from agent_runtime.runtimes.dlc.job_run import DlcRun, DlcState
from agent_runtime.runtimes.dlc.test_job_run import payload

BASE_ENV = {
    "APP_ENV": "development",
    "HOME": "/home/worker",
    "REDIS_URL": "redis://localhost:6379",
    "AGENT_RT_DATABASE_URL": "postgres://x@localhost/db",
    "AGENT_RT_PROVIDERS": "dlc",
}


class _Host:
    async def run(self, job: ClaimedJob, control: StopControl, /) -> None:
        return None


@dataclass
class _Control:
    stopped: asyncio.Event = field(default_factory=asyncio.Event)
    reason: str | None = None


def _job(kind: str, provider: str) -> ClaimedJob:
    return ClaimedJob("j", {"type": kind, "provider_key": provider})


def test_dlc_r01_router_picks_host_by_provider_for_agent_cli() -> None:
    cli, dlc, dify = _Host(), _Host(), _Host()
    hosts = {"agent.cli": cli, "workflow.async": dify}
    router = JobRouter(hosts, default=cli, by_provider={"dlc": dlc})
    assert router.host_for(_job("agent.cli", "dlc")) is dlc
    assert router.host_for(_job("agent.cli", "claude-sub")) is cli
    assert router.host_for(_job("workflow.async", "dlc")) is dify


async def test_dlc_r08_cancel_from_chat_is_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    host = DlcJobHost(cast(Any, None), cast(Any, None), DlcConfig("w", "http://dlc"))

    async def load(_: object) -> DlcState:
        return DlcState()

    async def slow(_: DlcRun) -> None:
        await asyncio.sleep(5)

    monkeypatch.setattr(host, "_load_state", load)
    monkeypatch.setattr(DlcRun, "execute", slow)
    p = payload("trạng thái")
    control = _Control(reason="cancel")
    job = ClaimedJob(str(p.job_id), p.model_dump(mode="json"))
    task = asyncio.create_task(host._supervise(job, p, control))  # pyright: ignore[reportPrivateUsage]
    await asyncio.sleep(0.05)
    control.stopped.set()
    out = await task
    assert out is not None and out.failure == CANCELLED


def test_dlc_r02_config_requires_url_and_full_client_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for k, v in BASE_ENV.items():
        monkeypatch.setenv(k, v)
    with pytest.raises(ValidationError, match="AGENT_RT_DLC_URL"):
        Settings()  # pyright: ignore[reportCallIssue]
    monkeypatch.setenv("AGENT_RT_DLC_URL", "http://127.0.0.1:8796")
    monkeypatch.setenv("AGENT_RT_DLC_CLIENT_ID", "ai-system")
    with pytest.raises(ValidationError, match="đặt đủ cả ba"):
        Settings()  # pyright: ignore[reportCallIssue]
    monkeypatch.setenv("AGENT_RT_DLC_TOKEN_URL", "https://kc/realms/dlc/token")
    monkeypatch.setenv("AGENT_RT_DLC_CLIENT_SECRET", "s")
    s = Settings()  # pyright: ignore[reportCallIssue]
    assert s.dlc_url == "http://127.0.0.1:8796" and s.safe_summary()["dlc_auth"] is True
