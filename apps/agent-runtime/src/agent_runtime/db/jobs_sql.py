"""WRK-FR-01 · WRK-FR-02 · WRK-FR-20 · WRK-FR-23 · WRK-FR-24 · WRK-BR-04 · WRK-BR-05 · H1-R20 —
SQL `hub.jobs` của Runtime, nguyên văn `plan-db.md` §5.4–5.5 (tham số asyncpg).

Chỉ đánh lại số tham số cho liền mạch (asyncpg không suy được kiểu tham số bị bỏ trống) và đổi hằng
`interval '60 seconds'` của quét orphan thành `$1` giây (`AGENT_RT_ORPHAN_S`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from agent_runtime.db.pool import Conn, Row

K_CLAIM = "SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim'));"

CLAIM_SELECT = """SELECT j.id, j.payload FROM hub.jobs j
JOIN hub.providers p ON p.key = j.provider_key AND p.enabled
LEFT JOIN hub.provider_state s ON s.provider_key = p.key
WHERE j.status = 'queued' AND j.cancel_requested_at IS NULL
  AND j.provider_key = ANY($1::text[])
  AND (s.status IS NULL OR s.status IN ('ok','busy') OR (s.status = 'cooldown' AND s.cooldown_until <= now()))
  AND (SELECT count(*) FROM hub.jobs r WHERE r.status = 'running' AND r.provider_key = j.provider_key) < p.max_concurrency
  AND (p.kind <> 'subscription' OR hub.tenant_sub_limit(j.tenant_id) IS NULL
       OR (SELECT count(*) FROM hub.jobs r JOIN hub.providers rp ON rp.key = r.provider_key
           WHERE r.status = 'running' AND r.tenant_id = j.tenant_id AND rp.kind = 'subscription')
          < hub.tenant_sub_limit(j.tenant_id))
  AND NOT EXISTS (SELECT 1 FROM hub.jobs b
       WHERE b.conversation_id = j.conversation_id AND b.agent_id = j.agent_id
         AND (b.status = 'running' OR (b.status = 'queued'
              AND (b.priority, b.created_at, b.id) < (j.priority, j.created_at, j.id))))
ORDER BY j.priority, j.created_at, j.id
LIMIT 1
FOR UPDATE OF j SKIP LOCKED;"""  # noqa: E501 — nguyên văn plan-db §5.4

CLAIM_UPDATE = """UPDATE hub.jobs SET status = 'running', worker_id = $2, started_at = now(), heartbeat_at = now(), attempts = attempts + 1
WHERE id = $1 AND status = 'queued';"""  # noqa: E501 — nguyên văn plan-db §5.4 ($3 → $1)

SET_PGID = (
    """UPDATE hub.jobs SET pgid = $3 WHERE id = $1 AND worker_id = $2 AND status = 'running';"""  # noqa: E501
)

HEARTBEAT = """UPDATE hub.jobs SET heartbeat_at = now() WHERE worker_id = $1 AND status = 'running' RETURNING id, cancel_requested_at IS NOT NULL AS cancel;"""  # noqa: E501

SWEEP_ORPHANS = """UPDATE hub.jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now() WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1) RETURNING id, run_id, worker_id, pgid;"""  # noqa: E501

RESTART_ORPHANS = """UPDATE hub.jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now() WHERE worker_id = $1 AND status = 'running' RETURNING id, run_id, pgid;"""  # noqa: E501

RESET_PROVIDERS = """UPDATE hub.provider_state SET status = 'ok', consecutive_errors = 0, cooldown_until = NULL, updated_at = now() WHERE provider_key = ANY($1::text[]) AND status IN ('error','logged_out');"""  # noqa: E501


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    payload: dict[str, Any]

    @property
    def run_id(self) -> str:
        return str(self.payload.get("run_id", ""))


@dataclass(frozen=True)
class OrphanRow:
    id: str
    run_id: str
    pgid: int | None
    worker_id: str | None = None


def _payload(raw: object) -> dict[str, Any]:
    value: object = json.loads(raw) if isinstance(raw, str | bytes) else raw
    return dict(value) if isinstance(value, dict) else {}  # pyright: ignore[reportUnknownArgumentType]


def _orphan(row: Row) -> OrphanRow:
    pgid = row["pgid"]
    return OrphanRow(
        id=str(row["id"]),
        run_id=str(row["run_id"]),
        pgid=int(pgid) if pgid else None,
        worker_id=row.get("worker_id"),
    )


async def claim_one(conn: Conn, providers: list[str], worker_id: str) -> ClaimedJob | None:
    """Một transaction READ COMMITTED: `K_CLAIM` → SELECT … SKIP LOCKED → `running`."""
    async with conn.transaction():
        await conn.execute(K_CLAIM)
        row = await conn.fetchrow(CLAIM_SELECT, providers)
        if row is None:
            return None
        status = await conn.execute(CLAIM_UPDATE, row["id"], worker_id)
        if status != "UPDATE 1":
            return None
        return ClaimedJob(id=str(row["id"]), payload=_payload(row["payload"]))


async def set_pgid(conn: Conn, job_id: str, worker_id: str, pgid: int) -> bool:
    return await conn.execute(SET_PGID, job_id, worker_id, pgid) == "UPDATE 1"


async def heartbeat(conn: Conn, worker_id: str) -> dict[str, bool]:
    """`{job_id: cancel}` cho mọi job `running` của `worker_id`."""
    rows = await conn.fetch(HEARTBEAT, worker_id)
    return {str(r["id"]): bool(r["cancel"]) for r in rows}


async def sweep_orphans(conn: Conn, orphan_s: float) -> list[OrphanRow]:
    return [_orphan(r) for r in await conn.fetch(SWEEP_ORPHANS, float(orphan_s))]


async def restart_orphans(conn: Conn, worker_id: str) -> list[OrphanRow]:
    return [_orphan(r) for r in await conn.fetch(RESTART_ORPHANS, worker_id)]


async def reset_providers(conn: Conn, providers: list[str]) -> None:
    await conn.execute(RESET_PROVIDERS, providers)
