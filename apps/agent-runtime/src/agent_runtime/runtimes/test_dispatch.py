"""WRK-FR-04 · WRK-FR-06 · `JobRouter` (`plan-runtime` §3.1): chọn host theo `payload.type`; type
lạ/thiếu/chưa bật → host mặc định (CLI → `invalid_payload` như H1)."""

import asyncio

import pytest

from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.runtimes.dispatch import JobRouter, StopControl


class _Host:
    def __init__(self) -> None:
        self.ran: list[str] = []

    async def run(self, job: ClaimedJob, control: StopControl, /) -> None:
        self.ran.append(job.id)


class _Control:
    def __init__(self) -> None:
        self.stopped = asyncio.Event()
        self.reason: str | None = None


@pytest.mark.parametrize(
    ("payload", "want"),
    [
        ({"type": "agent.cli"}, "cli"),
        ({"type": "workflow.async"}, "dify"),
        ({"type": "khac"}, "cli"),
        ({}, "cli"),
        ({"type": 1}, "cli"),
    ],
)
async def test_wrk_fr_06_router_by_type(payload: dict[str, object], want: str) -> None:
    cli, dify = _Host(), _Host()
    router = JobRouter({"agent.cli": cli, "workflow.async": dify}, default=cli)
    await router.run(ClaimedJob(id="j", payload=dict(payload)), _Control())
    assert (cli.ran, dify.ran) == ((["j"], []) if want == "cli" else ([], ["j"]))


async def test_wrk_fr_06_router_dify_disabled_falls_back() -> None:
    cli = _Host()
    router = JobRouter({"agent.cli": cli}, default=cli)
    await router.run(ClaimedJob(id="j", payload={"type": "workflow.async"}), _Control())
    assert cli.ran == ["j"]
