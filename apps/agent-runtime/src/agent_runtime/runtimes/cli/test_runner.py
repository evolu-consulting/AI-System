"""WRK-FR-04 · WRK-FR-05 · giao thức cha↔con, map kết quả/lỗi của job host (unit)."""

from __future__ import annotations

import io
import json
import sys
import uuid
from typing import Any

import pytest

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.providers.base import Fatal, Final, UsageEv
from agent_runtime.runtimes.cli import child
from agent_runtime.runtimes.cli.protocol import (
    ChildRequest,
    child_argv,
    encode_event,
    parse_event,
)
from agent_runtime.runtimes.cli.runner import build_output, fatal_failure


def payload(output: str = "agent_result", prompt: str = "xin chào") -> JobPayload1:
    ids = {k: str(uuid.uuid4()) for k in ("job_id", "run_id", "step_id", "tenant_id", "user_id")}
    data: dict[str, Any] = {
        "v": 1,
        "type": "agent.cli",
        "runtime": "agentic-cli",
        **ids,
        "conversation_id": str(uuid.uuid4()),
        "flow_id": str(uuid.uuid4()),
        "feature_id": None,
        "agent_type_key": None,
        "mcp": None,
        "agent": {"id": str(uuid.uuid4()), "key": "assistant", "role": "agent"},
        "provider_key": "fake-cli",
        "model": None,
        "step_index": 0,
        "max_turns": 3,
        "profile_steps": [{"provider_key": "fake-cli", "model": None, "on": []}],
        "system_prompt": "",
        "prompt": prompt,
        "history": [],
        "use_session": False,
        "allowed_tools": [],
        "output": output,
        "timeout_s": 60,
    }
    return JobPayload1.model_validate(data)


def test_wrk_fr_04_cmdline_matches_orphan_check() -> None:
    """queue/orphans.py chỉ giết group có cả module job host và `--job-id=<id>` trong cmdline."""
    argv = child_argv("/venv/bin/python", "j-1")
    assert argv[1:] == ["-m", "agent_runtime.runtimes.cli.child", "--job-id=j-1"]


def test_wrk_fr_04_event_roundtrip_and_bad_line() -> None:
    line = encode_event(UsageEv.model_validate({"in": 3, "out": 4}))
    assert json.loads(line)["in"] == 3
    ev = parse_event(line)
    assert isinstance(ev, UsageEv) and ev.input == 3 and ev.output == 4
    bad = parse_event(b"not json /home/secret\n")
    assert isinstance(bad, Fatal) and "secret" not in bad.msg


def test_wrk_fr_27_build_output() -> None:
    ok = Final(kind="agent_result", structured={"status": "done", "text": "x"})
    assert build_output(payload(), ok) == {
        "kind": "agent_result",
        "result": {"status": "done", "text": "x"},
    }
    assert build_output(payload(), Final(kind="agent_result", structured={"a": 1})) is None
    text = Final(kind="text", text='{"decision":"answer"}')
    assert build_output(payload("text"), text) == {"kind": "text", "text": '{"decision":"answer"}'}


def test_wrk_br_04_fatal_maps_to_job_failure() -> None:
    f = fatal_failure(Fatal(code="WEIRD", msg="m"))
    assert (f.status, f.code, f.reason) == ("failed", "INTERNAL_ERROR", "crash")
    g = fatal_failure(Fatal(code="UPSTREAM_ERROR", msg="m", reason="provider_unavailable"))
    assert (g.code, g.reason) == ("UPSTREAM_ERROR", "provider_unavailable")


def _run_child(monkeypatch: pytest.MonkeyPatch, argv: list[str], stdin: bytes) -> list[Any]:
    out = io.BytesIO()
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(stdin)))
    monkeypatch.setattr(sys, "stdout", io.TextIOWrapper(out))
    child.main(argv)
    sys.stdout.flush()
    return [json.loads(x) for x in out.getvalue().splitlines()]


def test_wrk_fr_04_child_runs_fake_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    p = payload(prompt="hi #fake:sleep=0")
    req = ChildRequest(job_id="j1", payload=p, work_dir="/tmp", forbidden_roots=[])
    evs = _run_child(monkeypatch, ["--job-id=j1"], req.model_dump_json().encode() + b"\n")
    assert evs[-1]["type"] == "final" and evs[-1]["structured"]["text"] == "echo: hi"


def test_wrk_fr_04_child_rejects_mismatch_and_prod_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    req = ChildRequest(job_id="j1", payload=payload(), work_dir="/tmp", forbidden_roots=[])
    line = req.model_dump_json().encode() + b"\n"
    assert _run_child(monkeypatch, ["--job-id=j2"], line)[0]["type"] == "fatal"
    monkeypatch.setenv("APP_ENV", "production")
    (ev,) = _run_child(monkeypatch, ["--job-id=j1"], line)
    assert ev["type"] == "fatal" and ev["reason"] == "provider_unavailable"
