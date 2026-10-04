"""WRK-FR-01 · WRK-FR-02 · WRK-FR-05 · H1-R20 — unit: supervisor, heartbeat, listener, orphans."""

import asyncio
import json
from pathlib import Path

from agent_runtime.db.jobs_sql import ClaimedJob, _payload  # pyright: ignore[reportPrivateUsage]
from agent_runtime.queue.heartbeat import reconcile
from agent_runtime.queue.host import JobControl
from agent_runtime.queue.listener import CH_CANCEL, CH_ENQUEUED, Listener
from agent_runtime.queue.orphans import is_job_host, read_cmdline
from agent_runtime.queue.supervisor import Supervisor

JOB = "c3000000-0000-4000-8000-000000000001"
JOB2 = "c3000000-0000-4000-8000-000000000002"


class _Host:
    def __init__(self) -> None:
        self.reasons: dict[str, str | None] = {}

    async def run(self, job: ClaimedJob, control: JobControl) -> None:
        await control.stopped.wait()
        self.reasons[job.id] = control.reason


async def _held(*ids: str) -> tuple[Supervisor, _Host]:
    host = _Host()
    sup = Supervisor(host)
    for i in ids:
        sup.start(ClaimedJob(i, {"run_id": "r"}))
    await asyncio.sleep(0)
    return sup, host


async def test_wrk_fr_05_heartbeat_cancel_and_lost() -> None:
    sup, host = await _held(JOB, JOB2)
    reconcile(sup, [JOB, JOB2], {JOB: True})
    await asyncio.sleep(0.01)
    assert host.reasons == {JOB: "cancel", JOB2: "lost"}
    assert sup.held() == []


async def test_wrk_fr_02_heartbeat_keeps_running_job() -> None:
    sup, host = await _held(JOB)
    reconcile(sup, [JOB], {JOB: False})
    await asyncio.sleep(0.01)
    assert host.reasons == {} and sup.holds(JOB)
    await sup.shutdown(1)
    assert host.reasons == {JOB: "shutdown"}


async def test_wrk_fr_05_stop_unknown_job_ignored() -> None:
    sup, _ = await _held()
    assert sup.stop(JOB, "cancel") is False


async def test_wrk_fr_01_listener_wakes_and_cancels() -> None:
    sup, host = await _held(JOB)
    wake = asyncio.Event()

    async def never() -> object:
        raise AssertionError

    lis = Listener(never, wake, sup)  # pyright: ignore[reportArgumentType]
    lis.on_notify(None, 1, CH_ENQUEUED, json.dumps({"v": 1, "job_id": JOB2, "provider_key": "x"}))
    assert wake.is_set()
    lis.on_notify(None, 1, CH_CANCEL, "không phải json")
    lis.on_notify(None, 1, CH_CANCEL, json.dumps({"v": 1, "job_id": JOB, "run_id": JOB2}))
    await asyncio.sleep(0.01)
    assert host.reasons == {JOB: "cancel"}


def test_h1_r20_job_host_cmdline_match(tmp_path: Path) -> None:
    line = f"/opt/venv/bin/python -m agent_runtime.runtimes.cli.child --job-id={JOB}"
    assert is_job_host(line, JOB)
    assert not is_job_host(line, JOB2)
    assert not is_job_host(f"sleep 100 --job-id={JOB}", JOB)
    (tmp_path / "42").mkdir()
    (tmp_path / "42" / "cmdline").write_bytes(line.replace(" ", "\0").encode() + b"\0")
    assert is_job_host(read_cmdline(42, tmp_path), JOB)
    assert read_cmdline(43, tmp_path) == ""


def test_wrk_fr_01_payload_parse() -> None:
    assert _payload('{"run_id": "r"}') == {"run_id": "r"}
    assert _payload({"a": 1}) == {"a": 1}
    assert _payload("[1]") == {}
