"""CR-114 hub-warm-runtime · WRK-FR-04 · WRK-BR-02 — bể job host dựng sẵn (`RUNTIME_WARM_POOL`).

Mỗi host trong bể là một process `child --warm` **mới**, đã import xong provider/SDK, đang chờ một
dòng `ChildRequest` trên stdin. `take()` trao host cho đúng **một** job rồi bể quên nó (không trả
lại, không dùng lại giữa job/tenant — cách ly như spawn lạnh); bể tự dựng bù nền.

- `size` = trần host chờ + đang dựng; `mem_ok()` sai ⇒ không dựng thêm (trần bộ nhớ).
- Host chờ chết (crash) ⇒ gỡ khỏi bể + dựng bù; `MAX_CRASHES` lần chết liền (chưa ai dùng) ⇒ ngưng
  dựng (tránh vòng crash), job quay về spawn lạnh.
- `drain()` (manifest/cấu hình đổi, dừng process) ⇒ huỷ mọi host chờ; host đang dựng dở bị huỷ khi
  dựng xong (đếm `generation`). `close()` = drain + không dựng nữa.
Logic thuần trên `spawn`/`discard`/`alive`/`wait` tiêm vào (test đơn vị không cần process thật).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

from agent_runtime.log import get_logger

MAX_CRASHES = 3


@dataclass(frozen=True)
class WarmOps[H]:
    spawn: Callable[[], Awaitable[H]]
    discard: Callable[[H], Coroutine[Any, Any, None]]
    wait: Callable[[H], Awaitable[object]]  # xong khi host thoát
    alive: Callable[[H], bool]
    mem_ok: Callable[[], bool] = field(default=lambda: True)


class WarmPool[H]:
    def __init__(self, size: int, ops: WarmOps[H]) -> None:
        self.size, self.ops = size, ops
        self.idle: list[H] = []
        self.spawning = 0
        self.generation = 0
        self.crashes = 0
        self.closed = False
        self._tasks: set[asyncio.Task[None]] = set()

    @property
    def disabled(self) -> bool:
        return self.closed or self.size <= 0 or self.crashes >= MAX_CRASHES

    def fill(self) -> None:
        """Dựng bù tới `size` (không chờ). Gọi lúc khởi động và sau mỗi `take`/crash."""
        while not self.disabled and len(self.idle) + self.spawning < self.size:
            if not self.ops.mem_ok():
                get_logger().info("warm.skip_low_memory")
                return
            self.spawning += 1
            self._bg(self._spawn_one(self.generation))

    def take(self) -> H | None:
        """Host chờ còn sống đầu tiên (rời bể, dùng một lần) hoặc None ⇒ spawn lạnh."""
        host: H | None = None
        while self.idle:
            cand = self.idle.pop(0)
            if self.ops.alive(cand):
                host = cand
                break
            self._bg(self.ops.discard(cand))
        if host is not None:
            self.crashes = 0
        self.fill()
        return host

    async def drain(self) -> None:
        self.generation += 1
        hosts, self.idle = self.idle, []
        await asyncio.gather(*(self.ops.discard(h) for h in hosts), return_exceptions=True)

    async def close(self) -> None:
        self.closed = True
        await self.drain()
        tasks = list(self._tasks)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def _bg(self, coro: Coroutine[Any, Any, None]) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _spawn_one(self, gen: int) -> None:
        try:
            host = await self.ops.spawn()
        except Exception as err:  # dựng lỗi = một lần crash; job vẫn spawn lạnh được
            self.spawning -= 1
            self.crashes += 1
            get_logger().warning("warm.spawn_failed", error=type(err).__name__)
            self.fill()
            return
        self.spawning -= 1
        if gen != self.generation or self.closed:  # đã drain trong lúc dựng
            await self.ops.discard(host)
            return
        self.idle.append(host)
        self._bg(self._watch(host))

    async def _watch(self, host: H) -> None:
        """Host chờ thoát khi chưa ai lấy ⇒ crash: gỡ, đếm, dựng bù."""
        await self.ops.wait(host)
        if host not in self.idle:
            return  # đã được `take`/`drain` — không phải việc của bể
        self.idle.remove(host)
        self.crashes += 1
        get_logger().warning("warm.idle_died", crashes=self.crashes)
        await self.ops.discard(host)
        self.fill()
