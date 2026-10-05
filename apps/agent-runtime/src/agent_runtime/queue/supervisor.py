"""WRK-FR-04 · WRK-FR-05 · Theo dõi job đang chạy trong process này (plan-runtime §2.3 bước 2):
nguồn huỷ (LISTEN `job_cancel`, heartbeat, sweeper, SIGTERM) chỉ tác động job do process này giữ.

Review 1 C1: job `workflow.async` có thể bị requeue rồi chính process này claim lại cùng `id` khi
task cũ chưa thoát. `start` khi đã giữ `id` → dừng task cũ (`lost`) và task mới **chờ** task cũ
thoát rồi mới chạy (không hai lần chạy song song); task cũ thoát chỉ gỡ entry của chính nó. Câu ghi
SQL của Dify còn rào `token_hash` của lần claim (`db/workflow_sql.py`).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.log import get_logger
from agent_runtime.queue.host import JobControl, JobHost, StopReason


@dataclass
class _Held:
    job: ClaimedJob
    control: JobControl
    task: asyncio.Task[None]


class Supervisor:
    def __init__(self, host: JobHost) -> None:
        self._host = host
        self._held: dict[str, _Held] = {}

    def start(self, job: ClaimedJob) -> None:
        prev = self._held.get(job.id)
        if prev is not None:  # claim lại sau requeue khi task cũ chưa thoát (C1)
            get_logger().warning("job.reclaimed_while_held", job_id=job.id)
            prev.control.request_stop("lost")
        control = JobControl()
        before = prev.task if prev is not None else None
        task = asyncio.create_task(self._run(job, control, before), name=f"job-{job.id}")
        self._held[job.id] = _Held(job, control, task)

    async def _run(
        self, job: ClaimedJob, control: JobControl, before: asyncio.Task[None] | None = None
    ) -> None:
        try:
            if before is not None:  # không huỷ task cũ: để nó tự dọn (đóng stream, giết group)
                await asyncio.wait({before})
            await self._host.run(job, control)
        except Exception as err:  # job host lỗi không được kéo sập process cha
            get_logger().error("job.host_error", job_id=job.id, error=type(err).__name__)
        finally:
            held = self._held.get(job.id)
            if held is not None and held.control is control:  # chỉ gỡ entry của chính mình
                del self._held[job.id]

    def held(self) -> list[str]:
        return list(self._held)

    def holds(self, job_id: str) -> bool:
        return job_id in self._held

    def stop(self, job_id: str, reason: StopReason) -> bool:
        """Yêu cầu dừng job của process này; job lạ → bỏ qua (False)."""
        held = self._held.get(job_id)
        if held is None:
            return False
        held.control.request_stop(reason)
        return True

    async def shutdown(self, grace_s: float) -> None:
        """SIGTERM cha: dừng mọi job (`shutdown`), chờ tối đa `grace_s`, quá thì huỷ task."""
        tasks = [h.task for h in self._held.values()]
        for h in list(self._held.values()):
            h.control.request_stop("shutdown")
        if not tasks:
            return
        _, pending = await asyncio.wait(tasks, timeout=grace_s)
        for t in pending:
            t.cancel()
        if pending:
            await asyncio.wait(pending, timeout=1.0)
