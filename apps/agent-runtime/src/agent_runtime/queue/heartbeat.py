"""WRK-FR-02 · WRK-FR-05 · WRK-FR-23 · WRK-FR-24 · Heartbeat 10 s — một câu theo `worker_id`
(plan-db §5.4 "Heartbeat").

Kết quả `{id, cancel}`: `cancel` → huỷ (dự phòng mất `job_cancel`); job đang giữ mà không có trong
kết quả = không còn của mình → giết group, không ghi gì (`lost`).
Chiều ngược (review H1 #1): job `running` của `worker_id` mà process **không giữ** (task đã thoát vì
ghi kết thúc lỗi DB) — heartbeat vẫn làm mới nên sweeper không bao giờ thấy → giữ slot mãi. Hai lần
heartbeat liền nhau đều thấy "lạc" (job vừa claim chưa kịp `start` chỉ lạc một lần) → `orphaned`
bằng SQL có điều kiện `worker_id` + `running`, rồi XADD.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import OrphanRow
from agent_runtime.db.pool import DB_ERRORS, Pool
from agent_runtime.log import get_logger
from agent_runtime.queue.host import JobEvents
from agent_runtime.queue.supervisor import Supervisor
from agent_runtime.queue.sweeper import SweepConfig, settle


def reconcile(sup: Supervisor, held: list[str], beat: dict[str, bool]) -> None:
    """`held` chụp TRƯỚC câu heartbeat: job claim sau đó không bị coi là `lost`."""
    for job_id in held:
        if job_id not in beat:
            sup.stop(job_id, "lost")
        elif beat[job_id]:
            sup.stop(job_id, "cancel")


def strays(
    beat: dict[str, bool], held_now: list[str], suspects: set[str]
) -> tuple[set[str], set[str]]:
    """(`lạc` lần thứ hai → orphan, `lạc` lần đầu → nghi). `held_now` chụp SAU câu heartbeat."""
    lost = set(beat) - set(held_now)
    return lost & suspects, lost - suspects


@dataclass
class Heartbeat:
    pool: Pool
    sup: Supervisor
    events: JobEvents
    cfg: SweepConfig
    suspects: set[str] = field(default_factory=set[str])

    async def beat_once(self) -> int:
        """Một chu kỳ; trả số job lạc đã `orphaned`."""
        held = self.sup.held()
        async with self.pool.acquire() as conn:
            beat = await jobs_sql.heartbeat(conn, self.cfg.worker_id)
        reconcile(self.sup, held, beat)
        confirmed, self.suspects = strays(beat, self.sup.held(), self.suspects)
        return await self._orphan(confirmed) if confirmed else 0

    async def _orphan(self, ids: set[str]) -> int:
        rows: list[OrphanRow] = []
        async with self.pool.acquire() as conn:
            for job_id in sorted(ids):
                if (row := await jobs_sql.orphan_one(conn, job_id, self.cfg.worker_id)) is not None:
                    rows.append(row)
        if rows:
            get_logger().error("heartbeat.stray_orphaned", count=len(rows))
        await settle(rows, self.events, self.cfg.kill_grace_s)
        return len(rows)

    async def run(self, every_s: float) -> None:
        while True:
            await asyncio.sleep(every_s)
            try:
                await self.beat_once()
            except DB_ERRORS as err:  # DB chập chờn / lỗi Postgres: thử lại chu kỳ sau
                get_logger().warning("heartbeat.failed", error=type(err).__name__)
