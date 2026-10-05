"""WRK-FR-15 · AC-W02 · H1-R18 · H1-R24 · `hub.provider_state` (plan-db §5.4 "Provider OK/lỗi/hỏng",
plan-runtime §3.3).

SQL nguyên văn plan-db §5.4, tách hai câu của "Provider hỏng" (fail job `queued` · UPSERT trạng
thái) để người gọi giữ thứ tự khoá `K_CLAIM → jobs → provider_state` trong transaction "Kết thúc"
(`db/finish_sql.py`). Ngưỡng lỗi liên tiếp → `status='error'`: `ERROR_THRESHOLD`.
H3a (plan-db H3a §2): `PROVIDER_OK` ghi `last_ok_at`, không đổi `status` (PL15); `MARK_BROKEN` thêm
loại cửa sổ + mức dùng (R02); `ENSURE_ROW` + `NOTE_WARNING` (R03).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from agent_runtime.db.pool import Conn

ERROR_THRESHOLD = 3

PROVIDER_OK = """INSERT INTO hub.provider_state (provider_key, last_ok_at) VALUES ($1, now()) ON CONFLICT (provider_key) DO UPDATE SET last_ok_at = now(), consecutive_errors = 0, updated_at = CASE WHEN hub.provider_state.consecutive_errors <> 0 THEN now() ELSE hub.provider_state.updated_at END;"""  # noqa: E501 — H3a plan-db §2 (R12: `last_ok_at` mỗi job thành công; không đổi `status` — PL15)

PROVIDER_ERROR = """INSERT INTO hub.provider_state (provider_key, consecutive_errors, last_error, updated_at) VALUES ($1, 1, $2, now()) ON CONFLICT (provider_key) DO UPDATE SET consecutive_errors = hub.provider_state.consecutive_errors + 1, last_error = EXCLUDED.last_error, updated_at = now() RETURNING consecutive_errors;"""  # noqa: E501

ERRORS_NOW = """SELECT consecutive_errors FROM hub.provider_state WHERE provider_key = $1;"""

FAIL_QUEUED = """UPDATE hub.jobs SET status = 'failed', error_code = 'ALL_PROVIDERS_EXHAUSTED', error_reason = $2, finished_at = now() WHERE status = 'queued' AND provider_key = $1 RETURNING id, run_id;"""  # noqa: E501 — plan-db §5.4 "Provider hỏng" ($4 → $2)

MARK_BROKEN = """INSERT INTO hub.provider_state (provider_key, status, cooldown_until, last_error, rate_limit_type, utilization, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (provider_key) DO UPDATE SET status = EXCLUDED.status, cooldown_until = EXCLUDED.cooldown_until, last_error = EXCLUDED.last_error, rate_limit_type = coalesce(EXCLUDED.rate_limit_type, hub.provider_state.rate_limit_type), utilization = coalesce(EXCLUDED.utilization, hub.provider_state.utilization), updated_at = now();"""  # noqa: E501 — H3a plan-db §2 (+ $5 type, $6 util — R02)

ENSURE_ROW = """INSERT INTO hub.provider_state (provider_key) VALUES ($1) ON CONFLICT (provider_key) DO NOTHING;"""  # noqa: E501 — H3a plan-db §2

NOTE_WARNING = """WITH old AS (SELECT warn_resets_at FROM hub.provider_state WHERE provider_key = $1 FOR UPDATE) UPDATE hub.provider_state s SET utilization = $2, rate_limit_type = coalesce($3, s.rate_limit_type), warn_at = now(), warn_resets_at = $4 FROM old WHERE s.provider_key = $1 RETURNING old.warn_resets_at IS DISTINCT FROM $4 AS first;"""  # noqa: E501 — H3a plan-db §2 (R03): không đổi `status`/`updated_at`


class WarningLike(Protocol):
    """`quota_rules.Warning` (H3a R03) — db không import `runtimes`."""

    @property
    def utilization(self) -> float | None: ...
    @property
    def rate_limit_type(self) -> str | None: ...
    @property
    def window(self) -> datetime: ...


BrokenStatus = Literal["cooldown", "logged_out", "error"]


@dataclass(frozen=True)
class Broken:
    """Provider hỏng: `cooldown` (rate limit, `until` = giờ reset) | `logged_out` | `error`."""

    status: BrokenStatus
    until: datetime | None
    message: str
    rate_limit_type: str | None = None  # H3a R02 (đã qua `clean_type`)
    utilization: float | None = None  # H3a R02 (đã qua `clean_util`)

    @property
    def reason(self) -> str:
        """`error_reason` của job `queued` bị fail (plan-db §5.4: `quota` khi `cooldown`)."""
        return "quota" if self.status == "cooldown" else "provider_unavailable"


# Ảnh hưởng của một job lên provider: OK (về 0) · lỗi (đếm) · hỏng · không đụng (huỷ/timeout/…).
ProviderEffect = Literal["ok", "error", "none"] | Broken


@dataclass(frozen=True)
class QueuedFail:
    id: str
    run_id: str


async def provider_ok(conn: Conn, key: str) -> None:
    await conn.execute(PROVIDER_OK, key)


async def provider_error(conn: Conn, key: str, message: str) -> None:
    await conn.execute(PROVIDER_ERROR, key, message[:500])


async def errors_now(conn: Conn, key: str) -> int:
    row = await conn.fetchrow(ERRORS_NOW, key)
    return int(row["consecutive_errors"]) if row is not None else 0


async def fail_queued(conn: Conn, key: str, reason: str) -> list[QueuedFail]:
    rows = await conn.fetch(FAIL_QUEUED, key, reason)
    return [QueuedFail(str(r["id"]), str(r["run_id"])) for r in rows]


async def mark_broken(conn: Conn, key: str, b: Broken) -> None:
    until = b.until if b.status == "cooldown" else None
    await conn.execute(
        MARK_BROKEN, key, b.status, until, b.message[:500], b.rate_limit_type, b.utilization
    )


async def note_warning(conn: Conn, key: str, w: WarningLike) -> bool:
    """H3a R03: ghi mức dùng + cửa sổ cảnh báo. True = cửa sổ mới (log `provider.quota_warning`)."""
    await conn.execute(ENSURE_ROW, key)
    row = await conn.fetchrow(NOTE_WARNING, key, w.utilization, w.rate_limit_type, w.window)
    return row is not None and bool(row["first"])
