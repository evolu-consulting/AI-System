"""H2a-R12 · `plan-runtime-dify` §3.5: gộp `job.progress` ≤ 1/giây, giữ sự kiện mới nhất; `close`
bỏ sự kiện còn chờ (không có tiến độ sau kết thúc)."""

import asyncio

from agent_runtime.runtimes.dify.progress import Throttle, retry_message, step_message


async def test_wrk_fr_07_throttle_keeps_latest_and_spaces() -> None:
    sent: list[tuple[float, str]] = []
    loop = asyncio.get_running_loop()

    async def publish(m: str) -> None:
        sent.append((loop.time(), m))

    t = Throttle(publish, interval_s=0.2)
    t.push("a")
    await asyncio.sleep(0.01)
    t.push("b")
    t.push("c")
    await asyncio.sleep(0.3)
    await t.close()
    assert [m for _, m in sent] == ["a", "c"]
    assert sent[1][0] - sent[0][0] >= 0.19


async def test_wrk_fr_07_throttle_close_drops_pending() -> None:
    sent: list[str] = []

    async def publish(m: str) -> None:
        sent.append(m)

    t = Throttle(publish, interval_s=5)
    t.push("a")
    await asyncio.sleep(0.01)
    t.push("b")
    await t.close()
    t.push("c")
    await asyncio.sleep(0.01)
    assert sent == ["a"]


def test_wrk_fr_07_static_messages() -> None:
    assert step_message(3) == "Đang chạy bước 3"
    assert retry_message(1, 2) == "Đang thử lại (1/2)"
