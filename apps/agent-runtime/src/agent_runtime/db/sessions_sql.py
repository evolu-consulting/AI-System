"""WRK-FR-14 · WRK-BR-03 · WRK-BR-06 · AC-W04 · H1-R23 — `hub.cli_sessions` (plan-db §3.3, §5.4).

Khoá PK `(conversation_id, agent_id, provider_key)`; **mọi** SELECT/UPSERT lọc thêm `tenant_id` của
payload (BR-06: không resume, không ghi đè session của tenant khác). UPSERT nguyên văn plan-db §5.4
"Kết thúc", chạy trong transaction đó (sau `usage_logs`, trước `provider_state`).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from agent_runtime.db.pool import Conn

SELECT_SESSION = """SELECT session_id FROM hub.cli_sessions
WHERE conversation_id = $1 AND agent_id = $2 AND provider_key = $3 AND tenant_id = $4;"""

UPSERT_SESSION = """INSERT INTO hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id, session_id, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (conversation_id, agent_id, provider_key) DO UPDATE
  SET session_id = EXCLUDED.session_id, updated_at = now()
  WHERE hub.cli_sessions.tenant_id = EXCLUDED.tenant_id;"""  # noqa: E501 — plan-db §5.4


@dataclass(frozen=True)
class SessionKey:
    """Khoá session lấy từ payload job (Hub đã kiểm)."""

    conversation_id: UUID
    agent_id: UUID
    provider_key: str
    tenant_id: UUID


async def find_session(conn: Conn, k: SessionKey) -> str | None:
    """`session_id` cùng khoá + cùng tenant; không có → None (BR-03: dùng history)."""
    row = await conn.fetchrow(
        SELECT_SESSION, k.conversation_id, k.agent_id, k.provider_key, k.tenant_id
    )
    return None if row is None else str(row["session_id"])


async def upsert_session(conn: Conn, k: SessionKey, session_id: str) -> None:
    await conn.execute(
        UPSERT_SESSION, k.conversation_id, k.agent_id, k.provider_key, k.tenant_id, session_id
    )
