"""WRK-FR-03 · R19–R21 · H2b PY-03 — `DeltaPump` (gom + hẹn giờ + XADD), `RunEvents.delta`, phía
cha `_on_event(Delta)` / không thử lại khi đã phát / `drain` trước `_close` (unit)."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.events.job_events import RunEvents, Tokens
from agent_runtime.events.test_stream import FakeClient
from agent_runtime.providers.base import Delta, Final
from agent_runtime.runtimes.cli.delta_pump import DeltaPump
from agent_runtime.runtimes.cli.job_run import JobRun
from agent_runtime.runtimes.cli.outcome import CANCELLED, Verdict
from agent_runtime.runtimes.cli.runner import HostConfig
from agent_runtime.runtimes.cli.test_job_run import JobControl
from agent_runtime.runtimes.cli.test_runner import payload

JOB = ClaimedJob("c3000000-0000-4000-8000-0000000000d1", {"run_id": "r"})


class Sink:
    def __init__(self) -> None:
        self.log: list[tuple[str, str]] = []  # (kind | "close", text)

    async def delta(self, job: ClaimedJob, kind: str, text: str) -> None:
        self.log.append((kind, text))

    async def progress(self, job: ClaimedJob, label: str) -> None:
        return None

    def forget(self, job_id: str) -> None:
        self.log.append(("forget", job_id))


@dataclass(frozen=True)
class Cfg:
    delta_flush_ms: int
    delta_flush_chars: int


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


async def test_wrk_fr_03_pump_flushes_by_chars_and_keeps_first_kind() -> None:
    sink, clock = Sink(), Clock()
    pump = DeltaPump(sink, JOB, Cfg(1000, 5), clock)
    await pump.add("answer", "abc")
    assert sink.log == [] and pump.streamed
    await pump.add("answer", "de")
    await pump.add("done", "lạc")  # kind khác ⇒ bỏ
    await pump.add("answer", "f")
    await pump.drain()
    assert sink.log == [("answer", "abcde"), ("answer", "f")]
    assert pump.sent == 2


async def test_wrk_fr_03_pump_timer_flushes_rest() -> None:
    sink = Sink()
    pump = DeltaPump(sink, JOB, Cfg(20, 4000))
    await pump.add("answer", "x")  # mốc ban đầu = lúc tạo ⇒ chưa tới hạn
    await pump.add("answer", "y")
    await asyncio.sleep(0.1)
    assert "".join(t for _, t in sink.log) == "xy"
    await pump.drain()
    assert len(sink.log) >= 1


async def test_wrk_fr_03_pump_splits_over_4000_units() -> None:
    sink = Sink()
    pump = DeltaPump(sink, JOB, Cfg(1000, 200))
    await pump.add("done", "😀" * 2500)  # 5 000 đơn vị UTF-16
    await pump.drain()
    assert [len(t.encode("utf-16-le")) // 2 for _, t in sink.log] == [4000, 1000]


async def test_wrk_fr_03_pump_close_drops_without_xadd() -> None:
    sink = Sink()
    pump = DeltaPump(sink, JOB, Cfg(50, 4000))
    await pump.add("answer", "x")
    await pump.close()
    await asyncio.sleep(0.1)
    assert sink.log == []


async def test_wrk_fr_03_run_events_delta_shares_seq() -> None:
    client = FakeClient()
    ev = RunEvents(cast(Any, client), "w")
    job = ClaimedJob(
        "11111111-1111-4111-8111-111111111111", {"run_id": "r", "provider_key": "fake-cli"}
    )
    await ev.started(job)
    await ev.delta(job, "answer", "chữ")
    await ev.result(job, {"kind": "text", "text": "chữ"}, Tokens())
    got = [json.loads(c[1][1]["e"]) for c in client.pipe.calls if c[0] == "xadd"]
    assert [(e["type"], e["seq"]) for e in got] == [
        ("job.started", 1),
        ("job.delta", 2),
        ("job.result", 3),
    ]
    assert (got[1]["kind"], got[1]["text"]) == ("answer", "chữ")


class _Host:
    def __init__(self, cfg: HostConfig, sink: Sink) -> None:
        self.cfg, self.events, self.sink = cfg, sink, sink

    async def close(self, job: ClaimedJob, tx: Any, v: Verdict, tokens: Any) -> None:
        self.sink.log.append(("close", v.failure.code if v.failure else "ok"))


def _run(
    tmp_path: Path, stream: bool | None, control: JobControl | None = None
) -> tuple[JobRun, Sink]:
    cfg = HostConfig("w-1", tmp_path, tmp_path, tmp_path, "test", 0.1, delta_flush_ms=1000)
    sink = Sink()
    p = payload(output="text")
    if stream is not None:
        p = p.model_copy(update={"stream": stream})
    run = JobRun(_Host(cfg, sink), JOB, p, control or JobControl())  # pyright: ignore[reportArgumentType]
    return run, sink


async def test_wrk_fr_03_on_event_delta_only_when_stream(tmp_path: Path) -> None:
    for stream in (None, False):
        run, _ = _run(tmp_path, stream)
        await run.proc_host._on_event(Delta(kind="answer", text="x"))  # pyright: ignore[reportPrivateUsage]
        assert not run.seen.streamed and not run.pump.streamed
    run, _ = _run(tmp_path, True)
    run.retry = "lần thử lại"
    await run.proc_host._on_event(Delta(kind="answer", text="x"))  # pyright: ignore[reportPrivateUsage]
    assert not run.seen.streamed
    run, _ = _run(tmp_path, True)
    assert not await run.proc_host._on_event(Delta(kind="answer", text="x"))  # pyright: ignore[reportPrivateUsage]
    assert run.seen.streamed and run._retryable("exited") is False  # pyright: ignore[reportPrivateUsage]
    run.seen.next_attempt()
    assert run.seen.streamed  # giữ qua lần chạy sau


async def test_wrk_fr_03_drain_before_close_every_written_branch(tmp_path: Path) -> None:
    run, sink = _run(tmp_path, True)
    await run.pump.add("answer", "a")
    run.seen.final = Final(kind="text", text='{"decision":"answer","text":"a"}')
    await run._apply("exited")  # pyright: ignore[reportPrivateUsage]
    assert sink.log == [("answer", "a"), ("close", "ok")]
    control = JobControl()
    control.request_stop("cancel")
    run, sink = _run(tmp_path, True, control)
    await run.pump.add("answer", "b")
    await run._apply("stopped")  # pyright: ignore[reportPrivateUsage]
    assert sink.log == [("answer", "b"), ("close", CANCELLED.code)]


async def test_wrk_fr_03_stopped_no_write_drops_deltas(tmp_path: Path) -> None:
    run, sink = _run(tmp_path, True)
    await run.pump.add("answer", "a")
    await run._apply("lost")  # pyright: ignore[reportPrivateUsage]
    await run.pump.close()
    assert sink.log == [("forget", JOB.id)]


class GateSink(Sink):
    """XADD treo tới khi mở cổng (giả Redis chậm) — để huỷ reader giữa XADD."""

    def __init__(self) -> None:
        super().__init__()
        self.gate, self.entered = asyncio.Event(), asyncio.Event()

    async def delta(self, job: ClaimedJob, kind: str, text: str) -> None:
        self.entered.set()
        await self.gate.wait()
        self.log.append((kind, text))


async def test_wrk_fr_03_cancel_mid_xadd_keeps_taken_chunks() -> None:
    """Review 1 #3: huỷ reader giữa XADD ⇒ mẻ đã `take()` vẫn XADD đủ (không hở `seq`); chữ sau
    và `drain` chờ mẻ đang bay xong (giữ thứ tự)."""
    sink = GateSink()
    pump = DeltaPump(sink, JOB, Cfg(1000, 1))
    reader = asyncio.create_task(pump.add("done", "😀" * 2500))  # 2 chunk: 4 000 + 1 000 đơn vị
    await sink.entered.wait()
    reader.cancel()
    await asyncio.gather(reader, return_exceptions=True)
    later = asyncio.create_task(pump.add("done", "z"))
    await asyncio.sleep(0.01)
    assert sink.log == []
    sink.gate.set()
    await later
    await pump.drain()
    assert [len(t.encode("utf-16-le")) // 2 for _, t in sink.log] == [4000, 1000, 1]
    assert sink.log[-1] == ("done", "z") and pump.sent == 3


async def test_wrk_fr_03_close_waits_inflight_xadd() -> None:
    """Review 1 #3: `close` (dừng không ghi / lỗi giữa chừng) chờ mẻ đang bay — không XADD sau
    sự kiện kết thúc."""
    sink = GateSink()
    pump = DeltaPump(sink, JOB, Cfg(1000, 1))
    reader = asyncio.create_task(pump.add("answer", "ab"))
    await sink.entered.wait()
    reader.cancel()
    await asyncio.gather(reader, return_exceptions=True)
    closing = asyncio.create_task(pump.close())
    await asyncio.sleep(0.01)
    assert not closing.done()
    sink.gate.set()
    await closing
    assert sink.log == [("answer", "ab")]
