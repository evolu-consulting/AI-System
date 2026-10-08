"""HUB-FR-60 · CR-054 — ghi danh mục model của provider (`hub.provider_models`, 0018) từ probe.

Thay cả danh mục của provider trong một transaction (xoá rồi chèn theo thứ tự CLI trả về): Studio
(Agent Forge) chỉ đọc. Danh mục rỗng không gọi tới đây (giữ bản cũ). Không log nội dung.
"""

from __future__ import annotations

from collections.abc import Sequence

from agent_runtime.db.pool import Conn
from agent_runtime.providers.base import ModelInfo

DELETE_MODELS = """DELETE FROM hub.provider_models WHERE provider_key = $1;"""

INSERT_MODEL = """INSERT INTO hub.provider_models
  (provider_key, value, resolved_model, display_name, description, position, fetched_at)
VALUES ($1, $2, $3, $4, $5, $6, now());"""


async def replace(conn: Conn, provider_key: str, models: Sequence[ModelInfo]) -> None:
    async with conn.transaction():
        await conn.execute(DELETE_MODELS, provider_key)
        for i, m in enumerate(models):
            await conn.execute(
                INSERT_MODEL,
                provider_key,
                m.value,
                m.resolved_model,
                m.display_name,
                m.description,
                i,
            )
