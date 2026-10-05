"""WRK-FR-22 · WRK-FR-15 · H3a-R11 · R15 · R16 · PL4 · PL5 · PL8 — SQL probe + transaction áp
kết quả probe (plan-db H3a §3–4).

Thứ tự khoá (plan H3a §5): khoá phiên `hub.provider.probe` (người gọi, ngoài transaction) → khoẻ:
chỉ hàng `provider_state` (0 lần `K_CLAIM`) · chuyển sang hỏng: `K_CLAIM → jobs (FAIL_QUEUED) →
provider_state`. Rào R15: so `updated_at` của snapshot đọc sau khi có khoá — trạng thái mới hơn (job
hoặc người khác ghi trong lúc probe) thắng, `apply_probe` trả `None` (log `probe.stale`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from agent_runtime.db.jobs_sql import K_CLAIM
from agent_runtime.db.pool import Conn, Row
from agent_runtime.db.provider_state_sql import (
    ERROR_THRESHOLD,
    Broken,
    BrokenStatus,
    QueuedFail,
    errors_now,
    fail_queued,
    note_warning,
)
from agent_runtime.runtimes.cli.quota_rules import ProbeResult, ProviderSnap, probe_transition

_COLS = "p.key, s.status, s.cooldown_until, s.last_probe_at, s.last_ok_at, s.consecutive_errors, s.updated_at, now() AS db_now FROM hub.providers p LEFT JOIN hub.provider_state s ON s.provider_key = p.key"  # noqa: E501

PROBE_TARGETS = f"""SELECT {_COLS} WHERE p.key = ANY($1::text[]) AND p.kind = 'subscription' AND p.enabled ORDER BY p.key;"""  # noqa: E501

PROBE_SNAPSHOT = f"""SELECT {_COLS} WHERE p.key = $1 AND p.kind = 'subscription' AND p.enabled;"""  # noqa: E501

PROBE_TRY_LOCK = (
    """SELECT pg_try_advisory_lock(hashtext('hub.provider.probe'), hashtext($1)) AS ok;"""  # noqa: E501
)

PROBE_UNLOCK = """SELECT pg_advisory_unlock(hashtext('hub.provider.probe'), hashtext($1));"""

PROBE_HEALTHY = """INSERT INTO hub.provider_state (provider_key, last_probe_at, last_ok_at, rate_limit_type, utilization) VALUES ($1, now(), now(), $2, $3) ON CONFLICT (provider_key) DO UPDATE SET last_probe_at = now(), last_ok_at = now(), rate_limit_type = coalesce(EXCLUDED.rate_limit_type, hub.provider_state.rate_limit_type), utilization = coalesce(EXCLUDED.utilization, hub.provider_state.utilization) WHERE hub.provider_state.status IN ('ok', 'busy') RETURNING 1;"""  # noqa: E501

PROBE_RECOVER = """UPDATE hub.provider_state SET status = 'ok', consecutive_errors = 0, cooldown_until = NULL, last_probe_at = now(), last_ok_at = now(), rate_limit_type = coalesce($3, rate_limit_type), utilization = coalesce($4, utilization), updated_at = now() WHERE provider_key = $1 AND updated_at = $2 AND status <> 'ok' RETURNING 1;"""  # noqa: E501

PROBE_MARK_BROKEN = """INSERT INTO hub.provider_state (provider_key, status, cooldown_until, last_error, rate_limit_type, utilization, last_probe_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now(), now()) ON CONFLICT (provider_key) DO UPDATE SET status = EXCLUDED.status, cooldown_until = EXCLUDED.cooldown_until, last_error = EXCLUDED.last_error, rate_limit_type = coalesce(EXCLUDED.rate_limit_type, hub.provider_state.rate_limit_type), utilization = coalesce(EXCLUDED.utilization, hub.provider_state.utilization), last_probe_at = now(), updated_at = now() WHERE hub.provider_state.updated_at IS NOT DISTINCT FROM $7 RETURNING 1;"""  # noqa: E501

PROBE_ERROR = """INSERT INTO hub.provider_state (provider_key, consecutive_errors, last_error, last_probe_at, updated_at) VALUES ($1, 1, $2, now(), now()) ON CONFLICT (provider_key) DO UPDATE SET consecutive_errors = hub.provider_state.consecutive_errors + 1, last_error = EXCLUDED.last_error, last_probe_at = now(), updated_at = now() RETURNING consecutive_errors, status;"""  # noqa: E501

PROBE_SEEN = """UPDATE hub.provider_state SET last_probe_at = now() WHERE provider_key = $1;"""

_HEALTHY = (None, "ok", "busy")


@dataclass(frozen=True)
class Applied:
    """Đã commit. `broken` ≠ None ⇒ người gọi log + XADD `job.failed` cho `queued_failed` (R2)."""

    from_status: str | None
    to_status: str | None
    queued_failed: list[QueuedFail] = field(default_factory=list[QueuedFail])
    broken: Broken | None = None
    warned: bool = False  # `NOTE_WARNING.first` ⇒ log `provider.quota_warning`


class _Fenced(Exception):
    """`PROBE_MARK_BROKEN` 0 hàng (trạng thái mới hơn snapshot) ⇒ ROLLBACK."""


def snap_of(row: Row) -> ProviderSnap:
    errors = row["consecutive_errors"]
    return ProviderSnap(
        row["status"],
        row["cooldown_until"],
        row["last_probe_at"],
        row["last_ok_at"],
        int(errors) if errors is not None else 0,
        row["updated_at"],
        row["db_now"],
    )


async def targets(conn: Conn, keys: list[str]) -> list[tuple[str, ProviderSnap]]:
    rows = await conn.fetch(PROBE_TARGETS, keys)
    return [(str(r["key"]), snap_of(r)) for r in rows]


async def snapshot(conn: Conn, key: str) -> ProviderSnap | None:
    """None = provider đã bị tắt / không còn là subscription."""
    row = await conn.fetchrow(PROBE_SNAPSHOT, key)
    return snap_of(row) if row is not None else None


async def try_lock(conn: Conn, key: str) -> bool:
    row = await conn.fetchrow(PROBE_TRY_LOCK, key)
    return row is not None and bool(row["ok"])


async def unlock(conn: Conn, key: str) -> None:
    await conn.execute(PROBE_UNLOCK, key)


async def apply_probe(
    conn: Conn, key: str, snap: ProviderSnap, result: ProbeResult
) -> Applied | None:
    """plan-db H3a §4. None = bị rào (không ghi gì)."""
    t = probe_transition(snap, result)
    if t == "broken":
        return await _broken(conn, key, snap, _broken_of(result))
    if t == "error":
        return await _error(conn, key, snap, result)
    if t == "seen":
        await conn.execute(PROBE_SEEN, key)
        return Applied(snap.status, snap.status)
    rtype, util = result.rate_limit_type, result.utilization
    if t == "healthy":
        row = await conn.fetchrow(PROBE_HEALTHY, key, rtype, util)
    else:
        row = await conn.fetchrow(PROBE_RECOVER, key, snap.updated_at, rtype, util)
    if row is None:
        return None
    w = result.warning
    warned = w is not None and await note_warning(conn, key, w)
    return Applied(snap.status, "ok", warned=warned)


def _broken_of(result: ProbeResult) -> Broken:
    status: BrokenStatus = "cooldown" if result.kind == "cooldown" else "logged_out"
    until = result.until if status == "cooldown" else None
    return Broken(status, until, result.message, result.rate_limit_type, result.utilization)


async def _error(conn: Conn, key: str, snap: ProviderSnap, result: ProbeResult) -> Applied | None:
    """PL5: chỉ chuyển `error` khi provider đang khoẻ và chạm ngưỡng; còn lại chỉ đếm."""
    if snap.status not in _HEALTHY or snap.consecutive_errors + 1 < ERROR_THRESHOLD:
        await conn.execute(PROBE_ERROR, key, result.message[:500])
        return Applied(snap.status, snap.status)
    return await _broken(conn, key, snap, Broken("error", None, result.message))


async def _broken(conn: Conn, key: str, snap: ProviderSnap, b: Broken) -> Applied | None:
    """`K_CLAIM → jobs → provider_state` (PL8). `error` (lỗi probe): đọc lại số lỗi dưới khoá (mọi
    lần đếm lỗi job đều giữ `K_CLAIM`), chưa tới ngưỡng ⇒ chỉ đếm."""
    msg, count = b.message[:500], b.status == "error"
    try:
        async with conn.transaction():
            await conn.execute(K_CLAIM)
            if count and await errors_now(conn, key) + 1 < ERROR_THRESHOLD:
                await conn.execute(PROBE_ERROR, key, msg)
                return Applied(snap.status, snap.status)
            queued = await fail_queued(conn, key, b.reason)
            args = (key, b.status, b.until, msg, b.rate_limit_type, b.utilization, snap.updated_at)
            if await conn.fetchrow(PROBE_MARK_BROKEN, *args) is None:
                raise _Fenced
            if count:  # như H1 "Kết thúc": lần lỗi chạm ngưỡng cũng được đếm
                await conn.execute(PROBE_ERROR, key, msg)
            return Applied(snap.status, b.status, queued, b)
    except _Fenced:
        return None
