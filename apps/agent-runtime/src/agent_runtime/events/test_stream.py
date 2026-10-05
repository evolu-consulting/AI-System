"""WRK-FR-03 · unit (giả lập pipeline, không cần Redis; quyết định ở spec-decisions)."""

from __future__ import annotations

import json
from typing import Any, Self, cast

from agent_runtime.contracts.hub import RunEvent
from agent_runtime.events.stream import encode_event, publish_run_event, stream_key

JOB = "11111111-1111-4111-8111-111111111111"


class FakePipe:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
        self.executed = 0

    def xadd(self, name: str, fields: dict[str, str], **kw: Any) -> None:
        self.calls.append(("xadd", (name, fields), kw))

    def expire(self, name: str, time: int) -> None:
        self.calls.append(("expire", (name, time), {}))

    async def execute(self) -> list[object]:
        self.executed += 1
        return []

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


class FakeClient:
    def __init__(self) -> None:
        self.pipe = FakePipe()

    def pipeline(self, *, transaction: bool = True) -> FakePipe:
        return self.pipe


def _progress() -> RunEvent:
    return RunEvent.model_validate(
        {
            "v": 1,
            "job_id": JOB,
            "seq": 2,
            "at": "2026-10-04T00:00:00Z",
            "type": "job.progress",
            "message": "đang chạy",
            "percent": None,
        }
    )


async def test_publish_xadd_maxlen_and_expire() -> None:
    c = FakeClient()
    await publish_run_event(cast("Any", c), "run-1", _progress())
    (op1, args1, kw1), (op2, args2, _) = c.pipe.calls
    assert (op1, args1[0], kw1) == ("xadd", "run:run-1", {"maxlen": 10000, "approximate": True})
    assert (op2, args2) == ("expire", ("run:run-1", 86400))
    assert c.pipe.executed == 1
    payload = json.loads(args1[1]["e"])
    assert payload["type"] == "job.progress" and payload["job_id"] == JOB
    assert set(args1[1]) == {"e"}


def test_stream_key() -> None:
    assert stream_key("abc") == "run:abc"


def _result(outputs: list[str] | None) -> RunEvent:
    body: dict[str, Any] = {
        "v": 1,
        "job_id": JOB,
        "seq": 3,
        "at": "2026-10-04T00:00:00Z",
        "type": "job.result",
        "output": {"kind": "text", "text": "ok"},
        "usage": {"input_tokens": 1, "output_tokens": 2},
        "session_resumed": False,
    }
    if outputs is not None:
        body["outputs"] = outputs
    return RunEvent.model_validate(body)


def test_wrk_fr_18_result_outputs_key_only_when_present() -> None:
    """H2c F10: không `outputs` ⇒ không khoá (y hệt H2b); có ⇒ mảng id."""
    assert "outputs" not in json.loads(encode_event(_result(None)))
    assert json.loads(encode_event(_progress()))["percent"] is None  # None khác giữ nguyên
    got = json.loads(encode_event(_result([JOB])))
    assert got["outputs"] == [JOB]


def test_wrk_fr_18_encode_by_type_not_codegen_class() -> None:
    """Review H2c v1 #5: chỉ `type == "job.result"` bỏ `outputs` rỗng; loại khác dump nguyên."""
    full = {"outputs": None}
    for ev, dropped in ((_progress(), {}), (_result(None), full), (_result([JOB]), {})):
        want = json.loads(ev.model_dump_json())
        for key in dropped:
            del want[key]
        assert json.loads(encode_event(ev)) == want
