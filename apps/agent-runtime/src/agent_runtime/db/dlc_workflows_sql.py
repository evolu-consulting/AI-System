"""DLC-R14 · đọc preset workflow DLC (`hub.dlc_workflows`, danh mục platform do Evolu Control sửa):
theo key (tin chat bắt đầu bằng `#key`) hoặc workflow mặc định của process. Chỉ đọc; workflow tắt
không dùng.
"""

from __future__ import annotations

from dataclasses import dataclass

from agent_runtime.db.pool import Conn, Row

BY_KEY = (
    """SELECT key, process, human_mode, lane FROM hub.dlc_workflows WHERE key = $1 AND enabled;"""
)
DEFAULT_OF = """SELECT key, process, human_mode, lane FROM hub.dlc_workflows
WHERE process = $1 AND is_default AND enabled LIMIT 1;"""


@dataclass(frozen=True)
class DlcPreset:
    key: str
    process: str
    human_mode: str | None
    lane: str | None


def _preset(row: Row | None) -> DlcPreset | None:
    if row is None:
        return None
    return DlcPreset(str(row["key"]), str(row["process"]), row["human_mode"], row["lane"])


async def preset_by_key(conn: Conn, key: str) -> DlcPreset | None:
    return _preset(await conn.fetchrow(BY_KEY, key))


async def default_preset(conn: Conn, process: str) -> DlcPreset | None:
    return _preset(await conn.fetchrow(DEFAULT_OF, process))
