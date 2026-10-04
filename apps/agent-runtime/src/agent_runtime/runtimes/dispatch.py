"""WRK-FR-04 · WRK-FR-06 · `JobRouter`: chọn job host theo `job.payload["type"]` (`plan-runtime`
§3.1): `agent.cli` → `CliJobHost` (process con), `workflow.async` → `DifyJobHost` (process cha).

Type lạ/thiếu, hoặc type có host chưa bật (vd `workflow.async` khi `dify` ∉ `AGENT_RT_PROVIDERS`)
→ host mặc định (`CliJobHost`): validate `JobPayload1` thất bại → `failed`
`INTERNAL_ERROR`/`invalid_payload` như H1.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Protocol

from agent_runtime.db.jobs_sql import ClaimedJob


class StopControl(Protocol):
    """= `queue.host.JobControl` (lớp `runtimes` không import `queue`)."""

    @property
    def stopped(self) -> asyncio.Event: ...
    @property
    def reason(self) -> str | None: ...


class TypedHost(Protocol):
    async def run(self, job: ClaimedJob, control: StopControl, /) -> None: ...


class JobRouter:
    def __init__(self, hosts: Mapping[str, TypedHost], default: TypedHost) -> None:
        self._hosts, self._default = dict(hosts), default

    def host_for(self, job: ClaimedJob) -> TypedHost:
        kind = job.payload.get("type")
        return self._hosts.get(kind, self._default) if isinstance(kind, str) else self._default

    async def run(self, job: ClaimedJob, control: StopControl) -> None:
        await self.host_for(job).run(job, control)
