"""WRK-FR-15 · AC-W02 · H1-R18 · H1-R24 · `hub.provider_state` (plan-db §5.4 "Provider OK/lỗi/hỏng",
plan-runtime §3.3).

SQL nguyên văn plan-db §5.4, tách hai câu của "Provider hỏng" (fail job `queued` · UPSERT trạng
thái) để người gọi giữ thứ tự khoá `K_CLAIM → jobs → provider_state` trong transaction "Kết thúc"
(`db/finish_sql.py`). Ngưỡng lỗi liên tiếp → `status='error'`: `ERROR_THRESHOLD`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from agent_runtime.db.pool import Conn

ERROR_THRESHOLD = 3

PROVIDER_OK = """UPDATE hub.provider_state SET consecutive_errors = 0, updated_at = now() WHERE provider_key = $1 AND consecutive_errors <> 0;"""  # noqa: E501

PROVIDER_ERROR = """INSERT INTO hub.provider_state (provider_key, consecutive_errors, last_error, updated_at) VALUES ($1, 1, $2, now()) ON CONFLICT (provider_key) DO UPDATE SET consecutive_errors = hub.provider_state.consecutive_errors + 1, last_error = EXCLUDED.last_error, updated_at = now() RETURNING consecutive_errors;"""  # noqa: E501

ERRORS_NOW = """SELECT consecutive_errors FROM hub.provider_state WHERE provider_key = $1;"""

FAIL_QUEUED = """UPDATE hub.jobs SET status = 'failed', error_code = 'ALL_PROVIDERS_EXHAUSTED', error_reason = $2, finished_at = now() WHERE status = 'queued' AND provider_key = $1 RETURNING id, run_id;"""  # noqa: E501 — plan-db §5.4 "Provider hỏng" ($4 → $2)

MARK_BROKEN = """INSERT INTO hub.provider_state (provider_key, status, cooldown_until, last_error, updated_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT (provider_key) DO UPDATE SET status = EXCLUDED.status, cooldown_until = EXCLUDED.cooldown_until, last_error = EXCLUDED.last_error, updated_at = now();"""  # noqa: E501 — plan-db §5.4 "Provider hỏng" ($5 → $4)

BrokenStatus = Literal["cooldown", "logged_out", "error"]


@dataclass(frozen=True)
class Broken:
    """Provider hỏng: `cooldown` (rate limit, `until` = giờ reset) | `logged_out` | `error`."""

    status: BrokenStatus
    until: datetime | None
    message: str

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
    await conn.execute(MARK_BROKEN, key, b.status, until, b.message[:500])
