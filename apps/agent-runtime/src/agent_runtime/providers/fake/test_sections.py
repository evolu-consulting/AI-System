"""WRK-FR-10 · P-a B1 · fake-cli phát mục `## …` + hỏi (`#fake:ask`) cho stage dev."""

from __future__ import annotations

from pathlib import Path

from agent_runtime.contracts.hub import AgentResult
from agent_runtime.providers.fake.directives import ask_question, sections_of

from .test_provider import agent_text, final, make_job, run


def test_sections_of_directive_and_member_marker() -> None:
    # Stage agent đơn: `#fake:sections=A|B|C` (tên có dấu cách), cắt ở chỉ thị kế tiếp.
    assert sections_of("làm đi #fake:sections=Bảng ý|Số tiền") == ["Bảng ý", "Số tiền"]
    assert sections_of("x #fake:sections=Phạm vi|Luật #fake:ask=hỏi?") == ["Phạm vi", "Luật"]
    # Thành viên nhóm (team-exec không truyền instruction): dòng `Mục của bạn: …`.
    assert sections_of("nội dung\n\nMục của bạn: Contract, DB, Tasks.") == [
        "Contract",
        "DB",
        "Tasks",
    ]
    assert sections_of("không có gì") == []


def test_ask_question_value_or_default() -> None:
    assert ask_question("x #fake:ask=Bạn muốn ưu tiên gì?") == "Bạn muốn ưu tiên gì?"
    assert ask_question("x #fake:ask=A? #fake:sections=X") == "A?"
    assert ask_question("không hỏi") == "Bạn chọn gì?"


async def test_b1_agent_emits_section_headings(tmp_path: Path) -> None:
    evs = await run(make_job(tmp_path, "đọc hoá đơn #fake:sections=Bảng ý|Số tiền"))
    res = AgentResult.model_validate(final(evs).structured).root
    assert res.status == "done"
    assert "## Bảng ý" in res.text and "## Số tiền" in res.text  # pyright: ignore[reportAttributeAccessIssue]


async def test_b1_team_member_sections_from_marker(tmp_path: Path) -> None:
    evs = await run(make_job(tmp_path, "yêu cầu X\n\nMục của bạn: Contract, DB, Tasks."))
    res = AgentResult.model_validate(final(evs).structured).root
    assert res.status == "done"
    text = res.text  # pyright: ignore[reportAttributeAccessIssue]
    assert "## Contract" in text and "## DB" in text and "## Tasks" in text


async def test_b1_agent_ask_uses_custom_question(tmp_path: Path) -> None:
    evs = await run(make_job(tmp_path, "viết spec #fake:ask=Ưu tiên phạm vi nào?"))
    res = AgentResult.model_validate(final(evs).structured).root
    assert res.status == "need_input"
    assert agent_text(evs) == "Ưu tiên phạm vi nào?"


async def test_b1_plain_echo_still_default(tmp_path: Path) -> None:
    evs = await run(make_job(tmp_path, "chỉ chào thôi"))
    assert agent_text(evs).startswith("echo: chỉ chào thôi ")
