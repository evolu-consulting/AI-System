"""CR-114 hub-warm-runtime — logic bể host dựng sẵn (`warm_pool.py`) trên host giả: dựng, lấy,
dựng bù, drain, trần, host chờ chết, vòng crash. Không process thật, không ngủ chờ."""

from __future__ import annotations

import asyncio

from agent_runtime.runtimes.cli.warm_pool import MAX_CRASHES, WarmOps, WarmPool


class _Host:
    def __init__(self, n: int) -> None:
        self.n = n
        self.dead = asyncio.Event()
        self.discarded = False


class _Ops:
    def __init__(self, *, fail: int = 0, mem: bool = True) -> None:
        self.made: list[_Host] = []
        self.fail = fail
        self.mem = mem
        self.gate: asyncio.Event | None = None  # đặt ⇒ spawn chờ tới khi set

    async def spawn(self) -> _Host:
        if self.gate is not None:
            await self.gate.wait()
        if self.fail > 0:
            self.fail -= 1
            raise OSError("spawn failed")
        h = _Host(len(self.made))
        self.made.append(h)
        return h

    async def discard(self, h: _Host) -> None:
        h.discarded = True
        h.dead.set()

    def ops(self) -> WarmOps[_Host]:
        return WarmOps(
            spawn=self.spawn,
            discard=self.discard,
            wait=lambda h: h.dead.wait(),
            alive=lambda h: not h.dead.is_set(),
            mem_ok=lambda: self.mem,
        )


async def _settle(pool: WarmPool[_Host]) -> None:
    """Nhường vòng lặp cho các lượt dựng/watcher nền chạy hết (host giả không chờ I/O)."""
    for _ in range(20):
        await asyncio.sleep(0)


async def test_cr114_fill_to_size() -> None:
    o = _Ops()
    pool = WarmPool(2, o.ops())
    pool.fill()
    await _settle(pool)
    assert len(pool.idle) == 2 and len(o.made) == 2
    pool.fill()  # đủ rồi ⇒ không dựng thêm (trần)
    await _settle(pool)
    assert len(o.made) == 2
    await pool.close()


async def test_cr114_take_is_single_use_and_refills() -> None:
    o = _Ops()
    pool = WarmPool(1, o.ops())
    pool.fill()
    await _settle(pool)
    a = pool.take()
    assert a is not None and a is o.made[0] and a not in pool.idle
    await _settle(pool)
    b = pool.take()
    assert b is o.made[1] and b is not a  # host mới, không dùng lại host đã trao job
    a.dead.set()  # job xong, host thoát — không tính là crash của bể
    await _settle(pool)
    assert pool.crashes == 0 and not a.discarded
    await pool.close()


async def test_cr114_take_empty_returns_none_cold_path() -> None:
    o = _Ops()
    o.gate = asyncio.Event()
    pool = WarmPool(1, o.ops())
    pool.fill()
    assert pool.take() is None  # còn đang dựng ⇒ spawn lạnh, không chờ
    assert pool.spawning == 1  # take không dựng trùng khi đã đủ (đang dựng tính vào trần)
    o.gate.set()
    await _settle(pool)
    assert len(pool.idle) == 1
    await pool.close()


async def test_cr114_disabled_when_size_zero() -> None:
    o = _Ops()
    pool = WarmPool(0, o.ops())
    pool.fill()
    assert pool.take() is None and o.made == []


async def test_cr114_low_memory_skips_spawn() -> None:
    o = _Ops(mem=False)
    pool = WarmPool(2, o.ops())
    pool.fill()
    await _settle(pool)
    assert o.made == [] and pool.take() is None


async def test_cr114_idle_crash_removed_and_refilled() -> None:
    o = _Ops()
    pool = WarmPool(1, o.ops())
    pool.fill()
    await _settle(pool)
    first = o.made[0]
    first.dead.set()  # host chờ chết
    await _settle(pool)
    assert first not in pool.idle and first.discarded
    assert pool.crashes == 1 and len(pool.idle) == 1 and pool.idle[0] is o.made[1]
    assert pool.take() is o.made[1]
    assert pool.crashes == 0  # trao được job ⇒ xoá đếm crash
    await pool.close()


async def test_cr114_take_skips_dead_host() -> None:
    o = _Ops()
    pool = WarmPool(2, o.ops())
    pool.fill()
    await _settle(pool)
    a, b = o.made
    pool.ops = WarmOps(o.spawn, o.discard, lambda h: asyncio.Event().wait(), lambda h: h is not a)
    assert pool.take() is b  # a đã chết (watcher chưa kịp gỡ) ⇒ bỏ qua
    await pool.close()


async def test_cr114_crash_loop_disables_pool() -> None:
    o = _Ops(fail=MAX_CRASHES)
    pool = WarmPool(1, o.ops())
    pool.fill()
    await _settle(pool)
    assert pool.crashes == MAX_CRASHES and pool.disabled
    assert pool.take() is None and o.made == []


async def test_cr114_drain_discards_idle_and_inflight() -> None:
    o = _Ops()
    pool = WarmPool(2, o.ops())
    pool.fill()
    await _settle(pool)
    idle = list(pool.idle)
    o.gate = asyncio.Event()
    pool.take()  # dựng bù 1 host — đang dựng dở
    await pool.drain()  # vd manifest đổi
    assert pool.idle == [] and idle[1].discarded
    o.gate.set()
    await _settle(pool)
    assert o.made[-1].discarded and pool.idle == []  # host dựng xong sau drain bị huỷ
    pool.fill()  # sau drain dựng lại theo cấu hình mới
    await _settle(pool)
    assert len(pool.idle) == 2
    await pool.close()
    assert all(h.discarded for h in o.made[-2:]) and pool.disabled
