"""WRK-FR-04 · WRK-FR-06 · `JobRouter`: chọn job host theo `job.payload["type"]` (`plan-runtime`
§3.1): `agent.cli` → `CliJobHost` (process con), `workflow.async` → `DifyJobHost` (process cha).

P-c1 (plan-runtime §5.1): `agent.cli` có `payload.autofix` → `AutofixHost` (ghép ở `main`).
DLC-R01: `agent.cli` có `provider_key` thuộc `by_provider` (vd `dlc` → `DlcJobHost`, HTTP trong
process cha) chọn host đó trước khi xét `type`.

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


AUTOFIX_TYPE = "agent.cli"


class JobRouter:
    def __init__(
        self,
        hosts: Mapping[str, TypedHost],
        default: TypedHost,
        autofix: TypedHost | None = None,
        by_provider: Mapping[str, TypedHost] | None = None,
    ) -> None:
        self._hosts, self._default, self._autofix = dict(hosts), default, autofix
        self._by_provider = dict(by_provider or {})

    def host_for(self, job: ClaimedJob) -> TypedHost:
        provider = job.payload.get("provider_key")
        if job.payload.get("type") == "agent.cli" and isinstance(provider, str):
            host = self._by_provider.get(provider)
            if host is not None:
                return host
        kind = job.payload.get("type")
        if self._autofix is not None and kind == AUTOFIX_TYPE and job.payload.get("autofix"):
            return self._autofix  # P-c1: `AutofixHost` (sandbox None ⇒ `failed/container`)
        return self._hosts.get(kind, self._default) if isinstance(kind, str) else self._default

    async def run(self, job: ClaimedJob, control: StopControl) -> None:
        await self.host_for(job).run(job, control)
