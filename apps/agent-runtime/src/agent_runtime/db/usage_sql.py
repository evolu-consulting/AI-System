"""WRK-FR-17 · AC-W09 · H1-R25 · `hub.usage_logs` mỗi job (plan-db §5.4 "Kết thúc", runtime §8).

Câu INSERT nguyên văn plan-db §5.4 (tham số đánh lại liền mạch, asyncpg không suy kiểu tham số bỏ
trống). `billing='subscription'`, `cost_usd=0`, `billable_usd=NULL`, `overage=false`,
`feature_id=NULL`. `ON CONFLICT (job_id) DO NOTHING` ⇒ đúng một dòng mỗi job.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from agent_runtime.db.pool import Conn

INSERT_USAGE = """INSERT INTO hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key, model, billing,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billable_usd, overage, latency_ms, job_id)
VALUES ($2, $3, $4, $5, NULL, $6, $7, $8, 'subscription', $9, $10, $11, $12, 0, NULL, false, $13, $1)
ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING;"""  # noqa: E501 — plan-db §5.4


@dataclass(frozen=True)
class UsageKeys:
    """Khoá của dòng usage — lấy từ payload job (Hub đã kiểm)."""

    tenant_id: UUID
    run_id: UUID
    step_id: UUID
    user_id: UUID
    agent_id: UUID
    provider_key: str


@dataclass(frozen=True)
class UsageRow:
    """`input_tokens` = tổng token vào (gồm cache); hai cột cache là phần bên trong."""

    keys: UsageKeys
    model: str | None
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    latency_ms: int


async def insert_usage(conn: Conn, job_id: str, u: UsageRow) -> None:
    k = u.keys
    await conn.execute(
        INSERT_USAGE,
        UUID(job_id),
        k.tenant_id,
        k.run_id,
        k.step_id,
        k.user_id,
        k.agent_id,
        k.provider_key,
        u.model,
        u.input_tokens,
        u.output_tokens,
        u.cache_read_tokens,
        u.cache_write_tokens,
        u.latency_ms,
    )
