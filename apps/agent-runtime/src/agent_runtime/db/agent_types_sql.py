"""WRK-FR-25 · HUB-FR-90 · SQL Manifest `hub.agent_types` (plan-db §5.4 "Manifest", plan-runtime
§8). UPSERT mỗi loại agent của code; loại không còn → `available=false` (không xoá).

PY-04 ghi manifest tối thiểu để mốc "Runtime sẵn sàng" (bước 6 §1.5) có trước claim; PY-12 mở rộng.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

from agent_runtime.contracts.hub import AgentTypeManifest
from agent_runtime.db.pool import Conn

UPSERT = """INSERT INTO hub.agent_types (key, runtime, description, config_schema, version, worker_id, available, registered_at)
VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, true, now())
ON CONFLICT (key) DO UPDATE SET runtime = EXCLUDED.runtime, description = EXCLUDED.description,
  config_schema = EXCLUDED.config_schema, version = EXCLUDED.version, worker_id = EXCLUDED.worker_id,
  available = true, registered_at = now();"""  # noqa: E501

MARK_GONE = """UPDATE hub.agent_types SET available = false WHERE worker_id = $1 AND key <> ALL($2::text[]);"""  # noqa: E501


async def write_manifest(
    conn: Conn, worker_id: str, manifests: Sequence[AgentTypeManifest]
) -> None:
    """Một transaction: UPSERT từng loại rồi tắt loại cũ của `worker_id`."""
    async with conn.transaction():
        for m in manifests:
            await conn.execute(
                UPSERT,
                m.key,
                m.runtime,
                m.description.model_dump_json(),
                json.dumps(m.config_schema),
                m.version,
                worker_id,
            )
        await conn.execute(MARK_GONE, worker_id, [m.key for m in manifests])
