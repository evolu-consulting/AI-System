"""WRK-FR-13 · HUB-FR-95 · AC-H12 · AC-H22 · `fake-cli` + MCP (`plan-runtime` §6, PY-06):
`#fake:tool=<key>` (key ∈ `payload.mcp.tools`) → `tools/call` (client giả qua monkeypatch), giữ
nghĩa H1 khi không khớp; `#fake:args`; `#fake:mcp-list`; Orchestrator đồng ý → delegate lại (S01).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agent_runtime.providers.base import Confirm, ProviderJob, ToolUse
from agent_runtime.providers.claude import mcp
from agent_runtime.providers.fake import provider as mod
from agent_runtime.providers.fake.directives import is_agree, redelegate_message, tool_args
from agent_runtime.providers.fake.test_provider import JOB, agent_text, final, make_job, run

URL = "http://127.0.0.1:1/mcp"
TOKEN = "T" * 43
MCP = {"url": URL, "tools": ["check-invoice", "create-trello-card"]}
HUB = Confirm(question="Tạo thẻ?", choices=("Đồng ý", "Huỷ"))


def mcp_job(tmp_path: Path, prompt: str, **over: Any) -> ProviderJob:
    job = make_job(tmp_path, prompt, mcp=MCP, **over)
    path = mcp.write_config(tmp_path / "work", JOB, URL, TOKEN)
    return job.model_copy(update={"mcp_config_path": str(path)})


class Calls:
    def __init__(self, answer: str | Confirm = "kết quả tool") -> None:
        self.answer = answer
        self.seen: list[tuple[str, ...]] = []

    async def call(self, url: str, auth: str, key: str, args: dict[str, Any]) -> str | Confirm:
        self.seen.append((url, auth, key, json.dumps(args, ensure_ascii=False)))
        return self.answer

    async def list(self, url: str, auth: str) -> str:
        self.seen.append((url, auth, "tools/list"))
        return "check-invoice,create-trello-card | Kiểm tra"


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Calls:
    c = Calls()
    monkeypatch.setattr(mod, "call_tool", c.call)
    monkeypatch.setattr(mod, "list_tools", c.list)
    return c


def test_wrk_fr_13_tool_args_parse() -> None:
    """`#fake:args=<json>`: thiếu → `{}`; hỏng / không phải object → None; chuỗi có khoảng trắng."""
    assert tool_args('#fake:tool=x #fake:args={"x":"HD-1","y":"ghi chú"} #fake:sleep=3') == {
        "x": "HD-1",
        "y": "ghi chú",
    }
    assert tool_args("#fake:tool=x") == {}
    assert tool_args('#fake:args={"x":') is None
    assert tool_args("#fake:args=[1,2]") is None


async def test_wrk_fr_13_fake_calls_mcp_tool(tmp_path: Path, calls: Calls) -> None:
    """Key ∈ `payload.mcp.tools` → `tool_use{mcp__hub__<key>}` + gọi MCP với Bearer từ file."""
    prompt = '#fake:tool=check-invoice #fake:args={"x":"HD-1"}'
    evs = await run(mcp_job(tmp_path, prompt))
    assert calls.seen == [(URL, f"Bearer {TOKEN}", "check-invoice", '{"x": "HD-1"}')]
    assert ToolUse(name="mcp__hub__check-invoice") in evs
    assert agent_text(evs) == "kết quả tool"


async def test_hub_fr_95_fake_confirm_event(tmp_path: Path, calls: Calls) -> None:
    """`CONFIRMATION_REQUIRED` → phát `Confirm` trước `final` (cha ép `need_input`, §5 #4)."""
    calls.answer = HUB
    evs = await run(mcp_job(tmp_path, "#fake:tool=create-trello-card"))
    assert HUB in evs and evs.index(HUB) < len(evs) - 1
    assert final(evs).structured == {"status": "done", "text": "confirmation_required"}


@pytest.mark.parametrize(
    ("prompt", "want"),
    [
        ("#fake:tool=khac-tool", "denied:tool_not_allowed"),  # ∉ mcp.tools → nghĩa H1
        ("#fake:tool=mcp__other__x", "denied:tool_not_allowed"),
        ("#fake:tool=Read", "allowed"),
        ('#fake:tool=check-invoice #fake:args={"x":', "bad_args"),
    ],
)
async def test_wrk_fr_13_fake_non_mcp_keeps_h1(
    tmp_path: Path, calls: Calls, prompt: str, want: str
) -> None:
    evs = await run(mcp_job(tmp_path, prompt))
    assert agent_text(evs) == want
    assert calls.seen == []


@pytest.mark.parametrize("case", ["no_file", "retry", "no_payload_mcp"])
async def test_wrk_fr_13_fake_no_mcp_without_config(
    tmp_path: Path, calls: Calls, case: str
) -> None:
    """Không file cấu hình / lần thử lại định dạng / payload không `mcp` → không gọi MCP (H1)."""
    job = mcp_job(tmp_path, "#fake:tool=check-invoice")
    if case == "no_file":
        job = job.model_copy(update={"mcp_config_path": None})
    elif case == "retry":
        job = job.model_copy(update={"retry_prompt": "chỉ JSON"})
    else:
        job = make_job(tmp_path, "#fake:tool=check-invoice")
    evs = await run(job)
    assert agent_text(evs) == "denied:tool_not_allowed"
    assert calls.seen == []


async def test_wrk_fr_13_fake_mcp_list(tmp_path: Path, calls: Calls) -> None:
    evs = await run(mcp_job(tmp_path, "#fake:mcp-list"))
    assert agent_text(evs) == "check-invoice,create-trello-card | Kiểm tra"
    assert calls.seen == [(URL, f"Bearer {TOKEN}", "tools/list")]
    plain = await run(make_job(tmp_path / "p", "#fake:mcp-list"))
    assert agent_text(plain) == "mcp_unavailable"


async def test_h1_r17_fake_orchestrator_ignores_mcp(tmp_path: Path, calls: Calls) -> None:
    """Orchestrator (kể cả có file) không gọi MCP: `#fake:tool` → nghĩa H1 (deny)."""
    prompt = "<message>#fake:tool=check-invoice</message>"
    job = mcp_job(tmp_path, prompt, output="text", allowed_tools=[])
    text = final(await run(job)).text or ""
    assert json.loads(text)["text"] == "denied:tool_not_allowed"
    assert calls.seen == []


def _orch_prompt(history: list[dict[str, str]], message: str) -> str:
    hist = json.dumps(history, ensure_ascii=False).replace("<", "\\u003c")
    return (
        '<agents>\n[{"key":"trello"}]\n</agents>\n<history>\n'
        + hist
        + "\n</history>\n<steps>\n[]\n</steps>\n<steps_left>\n4\n</steps_left>\n<message>\n"
        + json.dumps(message, ensure_ascii=False)
        + "\n</message>"
    )


TASK = '#fake:delegate=trello #fake:tool=create-trello-card #fake:args={"title":"A"} Tạo thẻ A'


@pytest.mark.parametrize("reply", ["Đồng ý", "  đồng ý ", "Agree", "AGREE"])
async def test_hub_fr_95_orchestrator_redelegates_on_agree(tmp_path: Path, reply: str) -> None:
    """S01: câu đồng ý (như `isAgreeReply`) + tin user trước có `#fake:delegate=<a>` → delegate
    lại `<a>` với `task` = tin trước bỏ chỉ thị delegate."""
    history = [
        {"role": "user", "content": TASK},
        {"role": "assistant", "content": 'Tạo thẻ Trello "A"?'},
    ]
    job = make_job(tmp_path, _orch_prompt(history, reply), output="text", allowed_tools=[])
    got = json.loads(final(await run(job)).text or "")
    assert got == {
        "decision": "delegate",
        "agent": "trello",
        "task": '#fake:tool=create-trello-card #fake:args={"title":"A"} Tạo thẻ A',
    }


def test_hub_fr_95_redelegate_rules() -> None:
    assert is_agree("Đồng ý") and is_agree("agree") and not is_agree("Huỷ")
    prompt = _orch_prompt([{"role": "user", "content": TASK}], "Đồng ý")
    assert redelegate_message(prompt, "Huỷ") is None
    assert redelegate_message(prompt, "Đồng ý") == TASK
    no_delegate = _orch_prompt([{"role": "user", "content": "chào"}], "Đồng ý")
    assert redelegate_message(no_delegate, "Đồng ý") is None
    agreed_twice = _orch_prompt(
        [{"role": "user", "content": TASK}, {"role": "user", "content": "Đồng ý"}], "Đồng ý"
    )
    assert redelegate_message(agreed_twice, "Đồng ý") == TASK
    assert redelegate_message("<message>Đồng ý</message>", "Đồng ý") is None
