"""HUB-FR-95 · H2a-R21 · AC-H22 · `side_effect` phía agent CLI (`plan-runtime` §5 #3–#5):
`Confirm` qua giao thức con → `seen.confirm` (giữ cái đầu) → `build_output` ép `need_input` của Hub,
không thử lại/resume sau `Confirm`."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from agent_runtime.providers.base import Confirm, Fatal, Final
from agent_runtime.runtimes.cli.outcome import Seen, decide_exit
from agent_runtime.runtimes.cli.protocol import INVALID_EVENT, encode_event, parse_event
from agent_runtime.runtimes.cli.result import build_output, confirmation_forced
from agent_runtime.runtimes.cli.test_job_run import make_run
from agent_runtime.runtimes.cli.test_runner import payload

HUB = Confirm(question='Tạo thẻ Trello "A"?', choices=("Đồng ý", "Huỷ"))
FORCED = {
    "kind": "agent_result",
    "result": {"status": "need_input", "question": HUB.question, "choices": ["Đồng ý", "Huỷ"]},
}


def _agent(structured: Mapping[str, object] | None, **over: object) -> Final:
    return Final.model_validate({"kind": "agent_result", "structured": structured, **over})


def test_hub_fr_95_build_output_forces_need_input() -> None:
    """§5 #4: kết quả ≠ `need_input` (done / JSON hỏng / `is_error`) → `need_input` của Hub."""
    p = payload()
    done = _agent({"status": "done", "text": "Đã tạo thẻ"})
    assert build_output(p, done, HUB) == FORCED
    assert build_output(p, _agent(None, raw_json="{bad"), HUB) == FORCED
    assert build_output(p, _agent(None, is_error=True, subtype="error_max_turns"), HUB) == FORCED
    assert build_output(p, done) == {"kind": "agent_result", "result": done.structured}
    assert confirmation_forced(p, done, HUB) and not confirmation_forced(p, done, None)


def test_hub_fr_95_model_need_input_kept() -> None:
    """§5 #4: model tự trả `need_input` → giữ nguyên câu của model."""
    own = {"status": "need_input", "question": "Bạn chắc chứ?", "choices": ["Có", "Không"]}
    p = payload()
    assert build_output(p, _agent(own), HUB) == {"kind": "agent_result", "result": own}
    assert not confirmation_forced(p, _agent(own), HUB)


def test_hub_fr_95_text_output_not_forced() -> None:
    """Orchestrator (`output=text`) không có MCP ⇒ `confirm` không áp."""
    p = payload("text")
    final = Final(kind="text", text='{"decision":"answer","text":"x"}')
    assert build_output(p, final, HUB) == {"kind": "text", "text": final.text}
    assert not confirmation_forced(p, final, HUB)


def test_hub_fr_95_decide_exit_confirm_overrides_is_error() -> None:
    """Đã có `Confirm` + `final.is_error` (vd hết lượt sau tool) → `succeeded` `need_input`;
    không `Confirm` → lỗi như H1."""
    p = payload()
    v = decide_exit(p, Seen(final=_agent(None, is_error=True), confirm=HUB))
    assert v.failure is None and v.output == FORCED and v.provider == "ok"
    assert decide_exit(p, Seen(final=_agent(None, is_error=True))).failure is not None
    assert decide_exit(p, Seen()).failure is not None


def test_hub_fr_95_review1_c10_confirm_wins_over_fatal_and_no_final() -> None:
    """C10: CLI chết sau CONFIRMATION_REQUIRED (`fatal` hoặc thoát không `final`) → vẫn
    `need_input` của Hub, không đếm lỗi provider."""
    p = payload()
    for seen in (
        Seen(confirm=HUB),
        Seen(confirm=HUB, signaled=True),
        Seen(confirm=HUB, fatal=Fatal(code="INTERNAL_ERROR", msg="boom")),
    ):
        v = decide_exit(p, seen)
        assert (v.failure, v.output, v.provider) == (None, FORCED, "none")


def test_hub_fr_95_confirm_survives_next_attempt() -> None:
    seen = Seen(confirm=HUB, final=_agent({"status": "done", "text": "x"}))
    seen.next_attempt()
    assert seen.confirm == HUB and seen.final is None


def test_hub_fr_95_protocol_round_trip() -> None:
    """§5 #2: `Confirm` là `ChildEvent` hợp lệ; hình sai → `INVALID_EVENT`."""
    assert parse_event(encode_event(HUB)) == HUB
    bad = b'{"type":"confirm","question":"q","choices":["a"]}\n'
    assert parse_event(bad) is INVALID_EVENT


async def test_hub_fr_95_host_keeps_first_confirm_no_retry(tmp_path: Path) -> None:
    """§5 #3, #5: cha giữ `Confirm` đầu; có `Confirm` → `_retryable` False (không resume/thử
    lại định dạng)."""
    run, _ = make_run(tmp_path)
    second = Confirm(question="khác", choices=("a", "b"))
    assert run._retryable("exited")  # pyright: ignore[reportPrivateUsage]
    assert not await run.proc_host._on_event(HUB)  # pyright: ignore[reportPrivateUsage]
    assert not await run.proc_host._on_event(second)  # pyright: ignore[reportPrivateUsage]
    assert run.seen.confirm == HUB
    assert not run._retryable("exited")  # pyright: ignore[reportPrivateUsage]
