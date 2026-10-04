"""WRK-FR-03 · WRK-FR-04 · WRK-FR-05 · `JobEvents` thật: dựng `RunEvent` (plan.md §2.3) và XADD
`run:<run_id>` qua `publish_run_event`.

Luật người gọi (plan-db §8 R2): chỉ gọi **sau commit** và khi câu cập nhật có dòng. `seq` tăng theo
job trong process này; job không do process này giữ (orphan khi khởi động lại / worker khác) →
`seq` = epoch ms (luôn lớn hơn bộ đếm của process đã chết). Redis lỗi → log `warn`, không ném
(trạng thái thật ở DB; Hub dựng lại từ DB).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError

from agent_runtime.contracts.hub import RunEvent
from agent_runtime.db.jobs_sql import ClaimedJob, OrphanRow
from agent_runtime.events.stream import publish_run_event
from agent_runtime.log import get_logger

WORKER_ID_MAX = 64
FailStatus = Literal["failed", "cancelled", "timed_out"]


@dataclass(frozen=True)
class Failure:
    status: FailStatus
    code: str
    reason: str | None
    message: str


@dataclass(frozen=True)
class Tokens:
    input_tokens: int = 0
    output_tokens: int = 0

    def as_dict(self) -> dict[str, int]:
        return {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens}


ORPHANED = Failure("failed", "INTERNAL_ERROR", "orphaned", "job orphaned (worker stopped)")


async def connect_redis(url: str) -> Redis:
    """plan-runtime §1.5 bước 4: client + PING (lỗi → khởi động thất bại, exit 1)."""
    client = Redis.from_url(url)  # pyright: ignore[reportUnknownMemberType]
    try:
        await client.ping()  # pyright: ignore[reportUnknownMemberType]
    except BaseException:
        await client.aclose()
        raise
    return client


class RunEvents:
    def __init__(self, client: Redis, worker_id: str) -> None:
        self._client = client
        self._worker_id = worker_id[:WORKER_ID_MAX]
        self._seq: dict[str, int] = {}

    def _next(self, job_id: str) -> int:
        seq = self._seq.get(job_id, 0) + 1
        self._seq[job_id] = seq
        return seq

    async def _publish(self, run_id: str, seq: int, body: dict[str, Any]) -> None:
        log = get_logger()
        data = {"v": 1, "seq": seq, "at": datetime.now(UTC).isoformat(), **body}
        try:
            event = RunEvent.model_validate(data)
        except ValidationError as err:
            log.error("xadd.invalid_event", type=body.get("type"), errors=err.error_count())
            return
        try:
            await publish_run_event(self._client, run_id, event)
        except (RedisError, OSError) as err:
            log.warning("xadd.failed", type=body.get("type"), error=type(err).__name__)

    async def started(self, job: ClaimedJob) -> None:
        body = {
            "type": "job.started",
            "job_id": job.id,
            "worker_id": self._worker_id,
            "provider_key": job.payload.get("provider_key"),
        }
        await self._publish(job.run_id, self._next(job.id), body)

    async def progress(self, job: ClaimedJob, message: str) -> None:
        body = {"type": "job.progress", "job_id": job.id, "message": message[:200], "percent": None}
        await self._publish(job.run_id, self._next(job.id), body)

    async def result(self, job: ClaimedJob, output: dict[str, Any], usage: Tokens) -> None:
        body = {
            "type": "job.result",
            "job_id": job.id,
            "output": output,
            "usage": usage.as_dict(),
            "session_resumed": False,  # TODO(WRK-FR-14): PY-11 — resume session.
        }
        await self._publish(job.run_id, self._next(job.id), body)
        self._seq.pop(job.id, None)

    async def failed(self, job_id: str, run_id: str, f: Failure, usage: Tokens) -> None:
        seq = self._next(job_id) if job_id in self._seq else int(time.time() * 1000)
        body = {
            "type": "job.failed",
            "job_id": job_id,
            "status": f.status,
            "code": f.code,
            "reason": f.reason,
            "message": f.message[:500],
            "usage": usage.as_dict(),
        }
        await self._publish(run_id, seq, body)
        self._seq.pop(job_id, None)

    async def orphaned(self, row: OrphanRow) -> None:
        await self.failed(row.id, row.run_id, ORPHANED, Tokens())

    def forget(self, job_id: str) -> None:
        """Job bị dừng không ghi (`lost`/`shutdown`): bên ghi SQL phát sự kiện kết thúc."""
        self._seq.pop(job_id, None)
