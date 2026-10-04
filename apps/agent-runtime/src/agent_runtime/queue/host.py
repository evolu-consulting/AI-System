"""WRK-FR-01 · WRK-FR-04 · WRK-FR-05 · Chỗ cắm giữa hàng đợi và job host / XADD. Bản thật:
`runtimes/cli/runner.py` `CliJobHost` và `events/job_events.py` `RunEvents` (nối ở `main`).

`JobHost.run(job, control)` chạy một job đã claim tới khi xong; `control.stopped` được đặt khi phải
dừng sớm với `control.reason`: `cancel` (Hub huỷ → `cancelled`), `lost` (job không còn của mình →
giết group, không ghi), `shutdown` (SIGTERM cha → `failed`/`orphaned`, cha ghi SQL).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal, Protocol

from agent_runtime.db.jobs_sql import ClaimedJob, OrphanRow

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
