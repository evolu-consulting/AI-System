"""WRK-FR-03 · int: Redis thật (REDIS_URL, db 15, dọn key sau test)."""

from __future__ import annotations

import os
from typing import Any

import pytest
from redis.asyncio import Redis

from agent_runtime.contracts.hub import RunEvent
from agent_runtime.events.stream import publish_run_event

pytestmark = pytest.mark.int


async def test_xadd_expire_real_redis() -> None:
    url = os.environ.get("REDIS_URL", "redis://redis:6379")
    r: Any = Redis.from_url(url, db=15, decode_responses=True)  # pyright: ignore[reportUnknownMemberType]
    key = "run:int-test-py05"
    try:
        await r.delete(key)
        ev = RunEvent.model_validate(
            {
                "v": 1,
                "job_id": "11111111-1111-4111-8111-111111111111",
                "seq": 1,
                "at": "2026-10-04T00:00:00Z",
                "type": "job.progress",
                "message": "x",
                "percent": 5,
            }
        )
        await publish_run_event(r, "int-test-py05", ev)
        entries = await r.xrange(key)
        assert len(entries) == 1 and '"job.progress"' in entries[0][1]["e"]
        assert 0 < await r.ttl(key) <= 86400
    finally:
        await r.delete(key)
        await r.aclose()
