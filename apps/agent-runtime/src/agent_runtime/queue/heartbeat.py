"""WRK-FR-02 · WRK-FR-05 · Heartbeat 10 s — một câu theo `worker_id` (plan-db §5.4 "Heartbeat").

Kết quả `{id, cancel}`: `cancel` → huỷ (dự phòng mất `job_cancel`); job đang giữ mà không có trong
kết quả = không còn của mình → giết group, không ghi gì (`lost`).
"""

from __future__ import annotations

import asyncio

from agent_runtime.db import jobs_sql
from agent_runtime.db.pool import Pool
from agent_runtime.log import get_logger
from agent_runtime.queue.supervisor import Supervisor


def reconcile(sup: Supervisor, held: list[str], beat: dict[str, bool]) -> None:
    """`held` chụp TRƯỚC câu heartbeat: job claim sau đó không bị coi là `lost`."""
    for job_id in held:
        if job_id not in beat:
            sup.stop(job_id, "lost")
        elif beat[job_id]:
            sup.stop(job_id, "cancel")


async def beat_once(pool: Pool, sup: Supervisor, worker_id: str) -> None:
    held = sup.held()
    async with pool.acquire() as conn:
        beat = await jobs_sql.heartbeat(conn, worker_id)
    reconcile(sup, held, beat)


async def run_heartbeat(pool: Pool, sup: Supervisor, worker_id: str, every_s: float) -> None:
    while True:
        await asyncio.sleep(every_s)
        try:
            await beat_once(pool, sup, worker_id)
        except (OSError, TimeoutError) as err:  # DB chập chờn: thử lại chu kỳ sau
            get_logger().warning("heartbeat.failed", error=type(err).__name__)
