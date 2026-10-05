"""Review 1 C8 · `DifyJobHost._supervise`: hết `timeout_s` thật → `TIMED_OUT`; `TimeoutError` khác
(vd pool DB) không bị coi là hết giờ job."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, cast

import pytest

from agent_runtime.runtimes.dify.host import TIMED_OUT, DifyConfig, DifyJobHost
from agent_runtime.runtimes.dify.job_run import DifyRun, Outcome


@dataclass
class _Control:
    stopped: asyncio.Event = field(default_factory=asyncio.Event)
    reason: str | None = None


class _Run:
    def __init__(self, timeout_s: float, body: Any) -> None:
        self.p = SimpleNamespace(timeout_s=timeout_s)
        self._body = body
        self.stopped = False

    async def execute(self) -> Outcome:
        return cast(Outcome, await self._body())

    async def stop(self) -> None:
        self.stopped = True

    def usage(self) -> None:
        return None


def _host() -> DifyJobHost:
    return DifyJobHost(cast(Any, None), cast(Any, None), DifyConfig("w", "http://hub"))


async def test_review1_c8_real_deadline_is_timed_out() -> None:
    run = _Run(0.05, lambda: asyncio.sleep(5))
    got = await _host()._supervise(cast(DifyRun, run), _Control())  # pyright: ignore[reportPrivateUsage]
    assert got == Outcome(TIMED_OUT) and run.stopped


async def test_review1_c8_other_timeout_error_is_not_job_timeout() -> None:
    async def db_timeout() -> None:
        raise TimeoutError("pool acquire")

    run = _Run(30, db_timeout)
    with pytest.raises(TimeoutError, match="pool acquire"):
        await _host()._supervise(cast(DifyRun, run), _Control())  # pyright: ignore[reportPrivateUsage]
    assert not run.stopped
