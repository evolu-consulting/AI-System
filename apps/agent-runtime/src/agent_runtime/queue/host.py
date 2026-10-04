"""WRK-FR-01 · WRK-FR-04 · WRK-FR-05 · Chỗ cắm giữa hàng đợi (PY-04) và job host (PY-06) / XADD
(PY-05).

`JobHost.run(job, control)` chạy một job đã claim tới khi xong; `control.stopped` được đặt khi phải
dừng sớm với `control.reason`: `cancel` (Hub huỷ → `cancelled`), `lost` (job không còn của mình →
giết group, không ghi), `shutdown` (SIGTERM cha → `failed`/`orphaned`, cha ghi SQL).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal, Protocol

from agent_runtime.db.jobs_sql import ClaimedJob, OrphanRow
from agent_runtime.log import get_logger

StopReason = Literal["cancel", "lost", "shutdown"]


@dataclass
class JobControl:
    stopped: asyncio.Event = field(default_factory=asyncio.Event)
    reason: StopReason | None = None

    def request_stop(self, reason: StopReason) -> None:
        if self.reason is None:
            self.reason = reason
        self.stopped.set()


class JobHost(Protocol):
    async def run(self, job: ClaimedJob, control: JobControl) -> None: ...


class JobEvents(Protocol):
    async def started(self, job: ClaimedJob) -> None: ...
    async def orphaned(self, row: OrphanRow) -> None: ...


class PendingJobHost:
    """Tạm tới PY-06: giữ job `running` (heartbeat vẫn chạy) cho tới khi bị dừng."""

    async def run(self, job: ClaimedJob, control: JobControl) -> None:
        # TODO(WRK-FR-04): PY-06 — spawn job host (`--job-id=<id>`), ghi pgid, chờ kết thúc.
        get_logger().warning("job.host_pending", job_id=job.id)
        await control.stopped.wait()


class LogJobEvents:
    """Tạm tới PY-05: chỉ log; XADD `job.started` / `job.failed INTERNAL_ERROR` do PY-05 nối."""

    async def started(self, job: ClaimedJob) -> None:
        # TODO(WRK-FR-03): PY-05 — XADD `job.started`.
        get_logger().info("job.started", job_id=job.id, run_id=job.run_id)

    async def orphaned(self, row: OrphanRow) -> None:
        # TODO(WRK-FR-03): PY-05 — XADD `job.failed{INTERNAL_ERROR}`.
        get_logger().warning("job.orphaned", job_id=row.id, run_id=row.run_id)
