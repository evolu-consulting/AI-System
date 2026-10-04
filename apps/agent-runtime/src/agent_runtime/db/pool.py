"""WRK-FR-01 · WRK-FR-02 · Kết nối Postgres của Runtime (plan-runtime §1.5 bước 3): pool asyncpg
cho claim/heartbeat/sweeper + một kết nối riêng cho LISTEN (role `agent_runtime`).

asyncpg không kèm kiểu đầy đủ ⇒ bọc một chỗ (`_PG: Any`), phần còn lại dùng `Conn`/`Pool` dưới đây.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from contextlib import AbstractAsyncContextManager
from typing import Any, Protocol

import asyncpg  # pyright: ignore[reportMissingTypeStubs]

Row = Mapping[str, Any]
NotifyCallback = Callable[[Any, int, str, str], object]

_PG: Any = asyncpg
POOL_MIN = 1
POOL_MAX = 4
CONNECT_TIMEOUT_S = 10.0
# Lỗi DB tạm thời (mạng, timeout, lỗi Postgres, kết nối asyncpg hỏng): vòng nền thử lại chu kỳ sau.
DB_ERRORS: tuple[type[Exception], ...] = (
    OSError,
    TimeoutError,
    _PG.PostgresError,
    _PG.InterfaceError,
)


class Conn(Protocol):
    async def execute(self, query: str, *args: object) -> str: ...
    async def fetch(self, query: str, *args: object) -> list[Row]: ...
    async def fetchrow(self, query: str, *args: object) -> Row | None: ...
    def transaction(self) -> AbstractAsyncContextManager[object]: ...


class ListenConn(Conn, Protocol):
    async def add_listener(self, channel: str, callback: NotifyCallback) -> None: ...
    def is_closed(self) -> bool: ...
    async def close(self) -> None: ...


class Pool(Protocol):
    def acquire(self) -> AbstractAsyncContextManager[Conn]: ...
    async def close(self) -> None: ...


async def create_pool(dsn: str) -> Pool:
    """Pool cho câu SQL ngắn (claim, heartbeat, sweeper, kết thúc job)."""
    pool: Pool = await _PG.create_pool(
        dsn, min_size=POOL_MIN, max_size=POOL_MAX, timeout=CONNECT_TIMEOUT_S
    )
    return pool


async def connect_listen(dsn: str) -> ListenConn:
    """Kết nối riêng cho `LISTEN job_enqueued` / `job_cancel` (không lấy từ pool)."""
    conn: ListenConn = await _PG.connect(dsn, timeout=CONNECT_TIMEOUT_S)
    return conn
