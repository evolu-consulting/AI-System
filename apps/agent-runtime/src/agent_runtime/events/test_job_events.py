"""WRK-FR-03 · `RunEvents`: seq theo job, hình `RunEvent`, Redis lỗi không ném (unit)."""

from __future__ import annotations

import json
from typing import Any, cast

from redis.exceptions import ConnectionError as RedisConnectionError

from agent_runtime.db.jobs_sql import ClaimedJob, OrphanRow
from agent_runtime.events.job_events import RunEvents, Tokens
from agent_runtime.events.test_stream import FakeClient

JOB = "11111111-1111-4111-8111-111111111111"
RUN = "22222222-2222-4222-8222-222222222222"


def _events(client: FakeClient) -> list[dict[str, Any]]:
    return [json.loads(c[1][1]["e"]) for c in client.pipe.calls if c[0] == "xadd"]


def _job() -> ClaimedJob:
    return ClaimedJob(JOB, {"run_id": RUN, "provider_key": "fake-cli"})


async def test_wrk_fr_03_seq_per_job_and_shapes() -> None:
    client = FakeClient()
    ev = RunEvents(cast(Any, client), "w" * 100)
    await ev.started(_job())
    await ev.progress(_job(), "x" * 300)
    await ev.result(_job(), {"kind": "text", "text": "hi"}, Tokens(3, 4))
    got = _events(client)
    assert [e["type"] for e in got] == ["job.started", "job.progress", "job.result"]
    assert [e["seq"] for e in got] == [1, 2, 3]
    assert len(got[0]["worker_id"]) == 64 and len(got[1]["message"]) == 200
    assert got[2]["usage"] == {"input_tokens": 3, "output_tokens": 4}


async def test_wrk_fr_03_orphan_of_unknown_job_uses_large_seq() -> None:
    client = FakeClient()
    ev = RunEvents(cast(Any, client), "w1")
    await ev.orphaned(OrphanRow(JOB, RUN, None))
    (e,) = _events(client)
    assert e["type"] == "job.failed" and e["reason"] == "orphaned" and e["seq"] > 10**12


class _BrokenPipe:
    def xadd(self, *a: object, **kw: object) -> None: ...
    def expire(self, *a: object) -> None: ...

    async def execute(self) -> None:
        raise RedisConnectionError("down")

    async def __aenter__(self) -> _BrokenPipe:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


class _BrokenClient:
    def pipeline(self, *, transaction: bool = True) -> _BrokenPipe:
        return _BrokenPipe()


async def test_wrk_fr_03_redis_down_does_not_raise() -> None:
    ev = RunEvents(cast(Any, _BrokenClient()), "w1")
    await ev.started(_job())
