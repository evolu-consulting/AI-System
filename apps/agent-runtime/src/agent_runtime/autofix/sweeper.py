"""WRK-BR-08 · P-c1 · ADR-0011 #5 · Dọn container tự-sửa mồ côi (plan-runtime §5.1).

Container `aif-<job>[-prep|-test]` (nhãn `ai.autofix=1`) mà job KHÔNG còn `running` trong DB
(Runtime chết giữa job, `rm` lỗi) ⇒ `rm -f`. Job còn `running` (worker này hay worker khác dùng
chung engine) ⇒ giữ. Chạy lúc khởi động rồi mỗi `SWEEP_S`; lỗi engine/DB ⇒ log, lượt sau thử lại.
"""

from __future__ import annotations

import asyncio
import re

from agent_runtime.autofix.oci import Oci, OciError
from agent_runtime.db.pool import DB_ERRORS, Pool
from agent_runtime.log import get_logger

SWEEP_S = 300.0
LIVE_SQL = "SELECT id::text AS id FROM hub.jobs WHERE id = ANY($1::uuid[]) AND status = 'running'"
_NAME = re.compile(
    r"^aif-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-(?:prep|test))?$"
)


def job_of(name: str) -> str | None:
    m = _NAME.match(name)
    return m.group(1) if m else None


def orphans(names: list[str], live: set[str]) -> list[str]:
    """Thuần: tên container cần xoá (tên lạ không đúng mẫu ⇒ bỏ qua, không đụng)."""
    return [n for n in names if (j := job_of(n)) is not None and j not in live]


async def sweep_once(oci: Oci, pool: Pool) -> int:
    names = await oci.ps()
    ids = sorted({j for n in names if (j := job_of(n)) is not None})
    if not ids:
        return 0
    async with pool.acquire() as conn:
        rows = await conn.fetch(LIVE_SQL, ids)
    gone = orphans(names, {str(r["id"]) for r in rows})
    for name in gone:
        await oci.rm(name)
    if gone:
        get_logger().warning("sandbox.orphans_removed", count=len(gone))
    return len(gone)


async def run_container_sweeper(oci: Oci, pool: Pool, interval_s: float = SWEEP_S) -> None:
    """Dịch vụ nền (`queue/runtime.py`) — chỉ khi sandbox dùng được."""
    while True:
        try:
            await sweep_once(oci, pool)
        except (OciError, *DB_ERRORS) as err:
            get_logger().warning("sandbox.sweep_failed", error=type(err).__name__)
        await asyncio.sleep(interval_s)
