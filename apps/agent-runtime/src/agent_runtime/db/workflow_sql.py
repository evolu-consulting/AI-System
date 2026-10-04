"""WRK-FR-06 · WRK-FR-07 · HUB-FR-80 · H2a-R8 · R15 · RT5 · RT6 — SQL job `workflow.async`
(`plan-runtime-dify` §3.4 "Đánh dấu đã gửi", §3.7 "Kết thúc và usage").

`mark_dispatched` (Q6): ngay trước request Dify đầu của lần claim khi `payload.side_effect`; 0 dòng
= mất job (không gọi Dify). "Kết thúc": một transaction = câu Kết thúc H1 (`jobs_sql.FINISH`) +
INSERT usage biến thể `dify` (`billing/provider_key='dify'`, `model/agent_id` NULL, cache NULL,
`ON CONFLICT (job_id) DO NOTHING` — claim lại sau requeue không nhân đôi). Không đụng
`provider_state` (RT6). Job không còn `running` của mình → ROLLBACK, không XADD.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from agent_runtime.db import jobs_sql
from agent_runtime.db.jobs_sql import Finish
from agent_runtime.db.pool import Conn

MARK_DISPATCHED = """UPDATE hub.jobs SET dispatched_at = now() WHERE id = $1 AND worker_id = $2 AND status = 'running';"""  # noqa: E501 — nguyên văn -dify §3.4

INSERT_DIFY_USAGE = """INSERT INTO hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key, model, billing,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billable_usd, overage, latency_ms, job_id)
VALUES ($2, $3, $4, $5, $6, NULL, 'dify', NULL, 'dify', $7, $8, NULL, NULL, $9, NULL, false, $10, $1)
ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING;"""  # noqa: E501 — -dify §3.7, RT5


@dataclass(frozen=True)
class DifyUsage:
    """Khoá lấy từ payload (Hub đã kiểm); số liệu từ `policy.usage_row`."""

    tenant_id: UUID
    run_id: UUID
    step_id: UUID
    user_id: UUID
    feature_id: UUID | None
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    latency_ms: int


async def mark_dispatched(conn: Conn, job_id: str, worker_id: str) -> bool:
    return await conn.execute(MARK_DISPATCHED, job_id, worker_id) == "UPDATE 1"


async def insert_dify_usage(conn: Conn, job_id: str, u: DifyUsage) -> None:
    await conn.execute(
        INSERT_DIFY_USAGE,
        UUID(job_id),
        u.tenant_id,
        u.run_id,
        u.step_id,
        u.user_id,
        u.feature_id,
        u.input_tokens,
        u.output_tokens,
        u.cost_usd,
        u.latency_ms,
    )


class _NotOwned(Exception):
    """Job không còn `running` của mình → rollback."""


async def finish_dify(
    conn: Conn, job_id: str, worker_id: str, done: tuple[Finish, DifyUsage | None]
) -> bool:
    """True = đã commit (người gọi XADD sau). False = 0 dòng (không XADD)."""
    finish, usage = done
    try:
        async with conn.transaction():
            if not await jobs_sql.finish_job(conn, job_id, worker_id, finish):
                raise _NotOwned
            if usage is not None:
                await insert_dify_usage(conn, job_id, usage)
    except _NotOwned:
        return False
    return True
