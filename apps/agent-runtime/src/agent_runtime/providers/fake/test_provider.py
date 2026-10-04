"""WRK-FR-10 · P45a/b · fake-cli đủ chỉ thị (plan-runtime-fake §7) + registry theo APP_ENV."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest

from agent_runtime.contracts.hub import AgentResult, JobPayload1, OrchestratorDecision
from agent_runtime.providers.base import Final, ProviderEvent, ProviderJob, RateLimit, UsageEv
from agent_runtime.providers.fake.directives import message_of
from agent_runtime.providers.fake.provider import FAKE_TAIL, FakeProvider
from agent_runtime.providers.registry import get_provider

JOB = "c3000000-0000-4000-8000-000000000001"
RUN = "c3000000-0000-4000-8000-0000000000ee"


def make_job(tmp_path: Path, prompt: str, **over: Any) -> ProviderJob:
    work = tmp_path / "work"
    (work / JOB).mkdir(parents=True, exist_ok=True)
    pid = "c3000000-0000-4000-8000-0000000000"
    payload: dict[str, Any] = {
        "v": 1,
        "type": "agent.cli",
        "runtime": "agentic-cli",
        "job_id": JOB,
        "run_id": RUN,
        "step_id": pid + "01",
        "tenant_id": pid + "02",
        "user_id": pid + "03",
        "conversation_id": pid + "04",
        "flow_id": pid + "05",
        "feature_id": None,
        "agent_type_key": None,
        "mcp": None,
        "agent": {
            "id": pid + "06",
            "key": "a-one",
            "role": "orchestrator" if over.get("output") == "text" else "agent",
        },
        "provider_key": "fake-cli",
        "model": None,
        "step_index": 0,
        "max_turns": 5,
        "profile_steps": [{"provider_key": "fake-cli", "model": None, "on": []}],
        "system_prompt": "s",
        "prompt": prompt,
        "history": [],
        "use_session": False,
        "allowed_tools": ["Read", "Grep", "Glob"],
        "output": "agent_result",
        "timeout_s": 30,
    }
    payload.update(over)
    return ProviderJob(
        payload=JobPayload1.model_validate(payload),
        work_dir=str(work / JOB),
        forbidden_roots=[str(tmp_path / "home"), "/mnt", str(work)],
    )


async def run(job: ProviderJob) -> list[ProviderEvent]:
    out: list[ProviderEvent] = []

    async def emit(ev: ProviderEvent) -> None:
        out.append(ev)

    await FakeProvider().run(job, emit)
    return out


def final(evs: list[ProviderEvent]) -> Final:
    got = evs[-1]
    assert isinstance(got, Final)
    return got


def agent_text(evs: list[ProviderEvent]) -> str:
    res = AgentResult.model_validate(final(evs).structured).root
    return res.text if res.status != "need_input" else res.question  # pyright: ignore[reportAttributeAccessIssue]


def test_wrk_fr_10_registry_by_app_env() -> None:
    assert get_provider("fake-cli", "test") is not None
    assert get_provider("fake-cli", "development") is not None
    assert get_provider("fake-cli", "production") is None
    assert get_provider("fake-cli", None) is None


def test_p45a_message_block_only() -> None:
    prompt = "<agents>SECRET-A</agents><history>SECRET-H</history><message>xin chào</message>"
    assert message_of(prompt, orchestrator=True) == "xin chào"
    assert message_of(prompt, orchestrator=False) == prompt


async def test_p45a_p45b_orchestrator_echo(tmp_path: Path) -> None:
    prompt = "<agents>SECRET-A</agents><history>#fake:crash</history><message>xin chào</message>"
    evs = await run(make_job(tmp_path, prompt, output="text"))
    text = final(evs).text or ""
    assert text.startswith("echo: xin chào ") and "SECRET" not in text
    assert len(text.removeprefix("echo: xin chào ")) >= 120
    assert text.endswith(FAKE_TAIL)


async def test_wrk_fr_10_agent_echo_strips_directives(tmp_path: Path) -> None:
    evs = await run(make_job(tmp_path, "làm #fake:usage=3,4 đi"))
    assert agent_text(evs).startswith("echo: làm đi ")
    usage = evs[0]
    assert isinstance(usage, UsageEv) and (usage.input, usage.output, usage.model) == (3, 4, "fake")


async def test_wrk_fr_10_delegate_removes_only_its_directive(tmp_path: Path) -> None:
    prompt = "<message>#fake:delegate=a-one #fake:sleep=1 làm đi</message>"
    evs = await run(make_job(tmp_path, prompt, output="text"))
    assert OrchestratorDecision.model_validate_json(final(evs).text or "")
    assert json.loads(final(evs).text or "") == {
        "decision": "delegate",
        "agent": "a-one",
        "task": "#fake:sleep=1 làm đi",
    }


@pytest.mark.parametrize(
    ("directive", "status"), [("partial", "partial"), ("need_input", "need_input")]
)
async def test_wrk_fr_27_partial_need_input_shapes(
    tmp_path: Path, directive: str, status: str
) -> None:
    evs = await run(make_job(tmp_path, f"#fake:{directive} hỏi"))
    assert AgentResult.model_validate(final(evs).structured).root.status == status


@pytest.mark.parametrize(
    ("tool", "allowed", "want"),
    [
        ("Bash", ["Read"], "denied:tool_not_allowed"),
        ("Grep", ["Read"], "denied:tool_not_allowed"),
        ("Read", ["Read"], "allowed"),
    ],
)
async def test_wrk_fr_12_tool_via_hook(
    tmp_path: Path, tool: str, allowed: list[str], want: str
) -> None:
    evs = await run(make_job(tmp_path, f"#fake:tool={tool}", allowed_tools=allowed))
    assert evs[0].type == "tool_use" and agent_text(evs) == want


async def test_wrk_ac_w11_read_via_hook(tmp_path: Path) -> None:
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "c.txt").write_text("CANARY")
    bad = await run(make_job(tmp_path, f"#fake:read={tmp_path / 'home' / 'c.txt'}"))
    assert agent_text(bad) == "denied"
    (tmp_path / "work" / JOB / "ok.txt").write_text("hello")
    ok = await run(make_job(tmp_path, "#fake:read=ok.txt"))
    assert agent_text(ok) == "read: 5 chars"


async def test_wrk_br_02_env_lists_keys_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SOME_KEY_X", "VALUE-X")
    text = agent_text(await run(make_job(tmp_path, "#fake:env")))
    assert "SOME_KEY_X" in text and "VALUE-X" not in text


async def test_wrk_fr_15_ratelimit(tmp_path: Path) -> None:
    evs = await run(make_job(tmp_path, "#fake:ratelimit=1900000000"))
    assert isinstance(evs[0], RateLimit) and evs[0].resets_at == 1900000000
    assert final(evs).is_error
    evs = await run(make_job(tmp_path, "#fake:ratelimit"))
    assert isinstance(evs[0], RateLimit) and evs[0].resets_at is None


async def test_hub_h1_ac_10_badjson_counter_atomic(tmp_path: Path) -> None:
    job = make_job(tmp_path, "#fake:badjson=1")
    first = final(await run(job))
    assert first.structured is None and first.raw_json
    state = tmp_path / "work" / ".fake-state" / f"{RUN}.json"
    assert json.loads(state.read_text()) == {"badjson": 1}
    assert AgentResult.model_validate(final(await run(job)).structured).root.status == "done"
    assert not list(state.parent.glob("*.tmp"))
    assert UUID(RUN)
