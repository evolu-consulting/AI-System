"""WRK-FR-17 · WRK-FR-15 · H1-R24 · H1-R25 · AC-W02 · AC-W09 — transaction "Kết thúc" (plan-db §5.4,
plan-runtime §8): một transaction cho `jobs` + `usage_logs` + (`cli_sessions`, PY-11) +
`provider_state`; người gọi XADD **sau** commit (R2).

Thứ tự khoá: `K_CLAIM` (chỉ khi job có thể làm provider hỏng — rate limit / lỗi) → `jobs` (job của
mình, rồi job `queued` cùng provider khi hỏng) → `usage_logs` → `cli_sessions` → `provider_state`.
Job không còn `running` của mình → ROLLBACK, không ghi gì, không XADD.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from agent_runtime.db import jobs_sql
from agent_runtime.db import provider_state_sql as ps
from agent_runtime.db.jobs_sql import K_CLAIM, Finish
from agent_runtime.db.pool import Conn
from agent_runtime.db.provider_state_sql import Broken, ProviderEffect, QueuedFail
from agent_runtime.db.usage_sql import UsageRow, insert_usage


@dataclass(frozen=True)
class FinishTx:
    """Đầu vào transaction "Kết thúc". `usage` None = job chưa báo usage (không ghi dòng)."""

    finish: Finish
    provider_key: str
    usage: UsageRow | None = None
    provider: ProviderEffect = "none"
    error_message: str = ""


@dataclass(frozen=True)
class Finished:
    """Đã commit. `queued_failed`: job `queued` bị fail vì provider hỏng (người gọi XADD)."""

    broken: Broken | None = None
    queued_failed: list[QueuedFail] = field(default_factory=list[QueuedFail])


class _NotOwned(Exception):
    """Job không còn `running` của mình → rollback."""


async def finish_tx(conn: Conn, job_id: str, worker_id: str, tx: FinishTx) -> Finished | None:
    """None = 0 dòng (không XADD). Ngược lại: đã commit đủ các bảng."""
    try:
        async with conn.transaction():
            return await _body(conn, job_id, worker_id, tx)
    except _NotOwned:
        return None


async def _body(conn: Conn, job_id: str, worker_id: str, tx: FinishTx) -> Finished:
    key, effect = tx.provider_key, tx.provider
    if isinstance(effect, Broken) or effect == "error":
        await conn.execute(K_CLAIM)  # chặn claim tới khi provider_state đã đổi
    if not await jobs_sql.finish_job(conn, job_id, worker_id, tx.finish):
        raise _NotOwned
    broken = effect if isinstance(effect, Broken) else None
    if effect == "error" and await ps.errors_now(conn, key) + 1 >= ps.ERROR_THRESHOLD:
        # Đọc dưới K_CLAIM (mọi lần đếm lỗi đều giữ K_CLAIM) ⇒ jobs trước provider_state.
        broken = Broken("error", None, tx.error_message)
    queued = await ps.fail_queued(conn, key, broken.reason) if broken else []
    if tx.usage is not None:
        await insert_usage(conn, job_id, tx.usage)
    # PY-11 cắm ở đây: UPSERT `hub.cli_sessions` (plan-db §5.4, chỉ khi use_session + succeeded +
    # có session_id) — sau usage_logs, trước provider_state (thứ tự khoá §3.5).
    if effect == "ok":
        await ps.provider_ok(conn, key)
    elif effect == "error":
        await ps.provider_error(conn, key, tx.error_message)
    if broken is not None:
        await ps.mark_broken(conn, key, broken)
    return Finished(broken, queued)
