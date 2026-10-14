"""HUB-FR-129 · WRK-FR-29 · C22 · C38 · C46 · P-c2 · SQL claim/kết thúc job `source.apply`
(provider_key NULL ⇒ KHÔNG qua claim `agent.cli`). Claim riêng như `source.resolve` (`resolve_sql`)
+ slot sandbox dùng chung: job Áp chỉ claim khi (job tự-sửa `running` + job `source.apply`
`running`) của worker này < `RUNTIME_SANDBOX_MAX` — vì Áp rebase dựng container test như tự-sửa.
`FINISH` ghi `error_reason` (C46: `'container'` khi lỗi sandbox).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from agent_runtime.db.jobs_sql import new_token
from agent_runtime.db.pool import Conn

# C22/C38: đếm job tự-sửa (`payload.autofix` object) **và** job `source.apply` đang chạy của worker
# ($1 = worker_id, $2 = RUNTIME_SANDBOX_MAX).
_SLOT = """(SELECT count(*) FROM hub.jobs a WHERE a.status = 'running' AND a.worker_id = $1
   AND (jsonb_typeof(a.payload->'autofix') = 'object' OR a.type = 'source.apply')) < $2"""

CLAIM_SELECT = f"""SELECT id, payload FROM hub.jobs
WHERE status = 'queued' AND type = 'source.apply' AND cancel_requested_at IS NULL
  AND {_SLOT}
ORDER BY priority, created_at, id
LIMIT 1 FOR UPDATE SKIP LOCKED;"""

CLAIM_UPDATE = """UPDATE hub.jobs SET status = 'running', worker_id = $2, started_at = now(),
  heartbeat_at = now(), attempts = attempts + 1, token_hash = $3
WHERE id = $1 AND status = 'queued';"""

FINISH = """UPDATE hub.jobs SET status = $3, error_code = $4, error_reason = $5, finished_at = now()
WHERE id = $1 AND worker_id = $2 AND status = 'running';"""


@dataclass(frozen=True)
class ApplyJob:
    id: str
    payload: dict[str, Any]
    token: str = field(default="", repr=False)


async def claim_apply(conn: Conn, worker_id: str, sandbox_max: int) -> ApplyJob | None:
    """Một transaction: SELECT (slot sandbox) … SKIP LOCKED → `running` + `token_hash` (RT1)."""
    token, digest = new_token()
    async with conn.transaction():
        row = await conn.fetchrow(CLAIM_SELECT, worker_id, sandbox_max)
        if row is None:
            return None
        status = await conn.execute(CLAIM_UPDATE, row["id"], worker_id, digest)
        if status != "UPDATE 1":
            return None
        raw = row["payload"]
        payload = json.loads(raw) if isinstance(raw, str | bytes) else dict(raw)
        return ApplyJob(id=str(row["id"]), payload=payload, token=token)


async def finish_apply(  # noqa: PLR0913
    conn: Conn,
    job_id: str,
    worker_id: str,
    status: str,
    error_code: str | None = None,
    error_reason: str | None = None,
) -> bool:
    """True nếu job còn `running` của worker này và đã chuyển trạng thái (0 dòng ⇒ không ghi)."""
    done = await conn.execute(FINISH, job_id, worker_id, status, error_code, error_reason)
    return done == "UPDATE 1"
