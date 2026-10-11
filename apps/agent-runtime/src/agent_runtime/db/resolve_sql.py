"""P-b · PF-S2 · SQL claim/kết thúc job `source.resolve` (provider_key NULL ⇒ KHÔNG qua claim
`agent.cli`). Claim riêng: `type='source.resolve'`, SKIP LOCKED, ghi `token_hash` (RT1) để Runtime
gọi `/sources-resolved` bằng Bearer token.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agent_runtime.db.jobs_sql import new_token
from agent_runtime.db.pool import Conn

CLAIM_SELECT = """SELECT id, payload FROM hub.jobs
WHERE status = 'queued' AND type = 'source.resolve' AND cancel_requested_at IS NULL
ORDER BY priority, created_at, id
LIMIT 1 FOR UPDATE SKIP LOCKED;"""

CLAIM_UPDATE = """UPDATE hub.jobs SET status = 'running', worker_id = $2, started_at = now(),
  heartbeat_at = now(), attempts = attempts + 1, token_hash = $3
WHERE id = $1 AND status = 'queued';"""

FINISH = """UPDATE hub.jobs SET status = $3, result = $4, error_code = $5, finished_at = now()
WHERE id = $1 AND worker_id = $2 AND status = 'running';"""


@dataclass(frozen=True)
class ResolveJob:
    id: str
    payload: dict[str, Any]
    token: str = field(default="", repr=False)


async def claim_resolve(conn: Conn, worker_id: str) -> ResolveJob | None:
    token, digest = new_token()
    async with conn.transaction():
        row = await conn.fetchrow(CLAIM_SELECT)
        if row is None:
            return None
        status = await conn.execute(CLAIM_UPDATE, row["id"], worker_id, digest)
        if status != "UPDATE 1":
            return None
        import json

        raw = row["payload"]
        payload = json.loads(raw) if isinstance(raw, str | bytes) else dict(raw)
        return ResolveJob(id=str(row["id"]), payload=payload, token=token)


async def finish_resolve(  # noqa: PLR0913
    conn: Conn, job_id: str, worker_id: str, status: str, error_code: str | None
) -> None:
    await conn.execute(FINISH, job_id, worker_id, status, None, error_code)
