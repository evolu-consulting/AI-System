"""WRK-FR-03 · WRK-FR-15 · WRK-FR-17 · H2b PY-04 (plan-runtime §6) — `fake-cli`: `#fake:stream*`,
`answer-len`, `turns`, `is-error`; TD #47; delegate lại theo tag; agent "Đồng ý" dùng lại
chỉ thị."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agent_runtime.providers.base import Delta, Final, ProviderEvent, RateLimit, UsageEv
from agent_runtime.providers.fake.directives import (
    agreed_message,
    redelegate_message,
    strip_tags,
    turns,
)
from agent_runtime.providers.fake.provider import IS_ERROR_TEXT
from agent_runtime.providers.fake.test_mcp import (
    _orch_prompt,  # pyright: ignore[reportPrivateUsage]
)
from agent_runtime.providers.fake.test_provider import make_job, run


def _orch(msg: str) -> str:
    return f"<message>{json.dumps(msg, ensure_ascii=False)}</message>"


def deltas(evs: list[ProviderEvent]) -> list[Delta]:
    return [e for e in evs if isinstance(e, Delta)]


def last_final(evs: list[ProviderEvent]) -> Final:
    out = [e for e in evs if isinstance(e, Final)]
    assert len(out) == 1
    return out[0]


async def go(tmp_path: Path, prompt: str, stream: bool | None = True, **over: Any) -> Any:
    extra = {"stream": stream} if stream is not None else {}
    return await run(make_job(tmp_path, prompt, **extra, **over))


async def test_wrk_fr_03_orchestrator_stream_joins_to_answer(tmp_path: Path) -> None:
    evs = await go(tmp_path, _orch("#fake:stream=5 #fake:answer-len=300 viết"), output="text")
    ds = deltas(evs)
    text = json.loads(last_final(evs).text or "")["text"]
    assert len(text) == 300
    assert {d.kind for d in ds} == {"answer"} and "".join(d.text for d in ds) == text
    assert evs.index(ds[-1]) < evs.index(last_final(evs))


@pytest.mark.parametrize("stream", [None, False])
async def test_wrk_fr_03_no_stream_flag_no_delta(tmp_path: Path, stream: bool | None) -> None:
    evs = await go(tmp_path, _orch("#fake:stream=5 viết"), stream, output="text")
    assert deltas(evs) == []


async def test_wrk_fr_03_retry_attempt_does_not_stream(tmp_path: Path) -> None:
    job = make_job(tmp_path, "#fake:stream=3 trả lời", stream=True)
    evs = await run(job.model_copy(update={"retry_prompt": "sửa JSON"}))
    assert deltas(evs) == []


@pytest.mark.parametrize(
    ("msg", "kind"), [("#fake:stream=4 a", "done"), ("#fake:partial #fake:stream a", "partial")]
)
async def test_wrk_fr_03_agent_kinds(tmp_path: Path, msg: str, kind: str) -> None:
    evs = await go(tmp_path, msg)
    res = last_final(evs).structured or {}
    assert res["status"] == kind
    assert "".join(d.text for d in deltas(evs)) == res["text"]
    assert {d.kind for d in deltas(evs)} == {kind}


@pytest.mark.parametrize(
    ("msg", "over"),
    [
        ("#fake:need_input #fake:stream a", {}),
        (_orch("#fake:delegate=assistant #fake:stream việc"), {"output": "text"}),
        (_orch("#fake:stream=5 #fake:stream-order=text-first viết"), {"output": "text"}),
        ("#fake:stream=5 #fake:stream-order=text-first viết", {}),
    ],
)
async def test_wrk_fr_03_scanner_off(tmp_path: Path, msg: str, over: dict[str, Any]) -> None:
    evs = await go(tmp_path, msg, **over)
    assert deltas(evs) == []
    f = last_final(evs)
    if "text-first" in msg and f.kind == "text":
        assert json.loads(f.text or "")["decision"] == "answer"


async def test_wrk_fr_03_stream_diverge_and_badjson(tmp_path: Path) -> None:
    evs = await go(tmp_path / "d", _orch("#fake:stream=3 #fake:stream-diverge viết"), output="text")
    text = json.loads(last_final(evs).text or "")["text"]
    streamed = "".join(d.text for d in deltas(evs))
    assert len(streamed) == len(text) and streamed[0] != text[0] and streamed[1:] == text[1:]
    evs = await go(tmp_path / "b", "#fake:stream=3 #fake:stream-badjson a")
    f = last_final(evs)
    assert deltas(evs) and f.structured is None and f.raw_json
    evs = await go(tmp_path / "o", _orch("#fake:stream #fake:stream-badjson a"), output="text")
    with pytest.raises(ValueError):
        json.loads(last_final(evs).text or "")


async def test_wrk_fr_03_answer_len_one_segment(tmp_path: Path) -> None:
    evs = await go(tmp_path, _orch("#fake:stream=1 #fake:answer-len=9000 viết"), output="text")
    assert len(deltas(evs)) == 1 and len(deltas(evs)[0].text) == 9000


async def test_wrk_fr_17_turns_cumulative_usage(tmp_path: Path) -> None:
    evs = await go(tmp_path, "#fake:turns=3 #fake:usage=10,5 a", None)
    us = [(u.input, u.output) for u in evs if isinstance(u, UsageEv)]
    assert us == [(10, 5), (20, 10), (30, 15)]
    assert turns({}) == 1 and turns({"turns": "99"}) == 10 and turns({"turns": "x"}) == 1


@pytest.mark.parametrize("kind", ["rate", "auth", "refused", "error"])
async def test_wrk_fr_15_is_error(tmp_path: Path, kind: str) -> None:
    evs = await go(tmp_path, f"#fake:is-error={kind} a", None)
    f = last_final(evs)
    assert f.is_error and f.text == IS_ERROR_TEXT[kind]
    assert f.stop_reason == ("refusal" if kind == "refused" else None)  # TC-8
    assert not any(isinstance(e, RateLimit) for e in evs)
    assert [(u.input, u.output) for u in evs if isinstance(u, UsageEv)] == [(10, 0)]
    evs = await go(tmp_path / "u", f"#fake:is-error={kind} #fake:usage=10,5 a", None)
    assert [(u.input, u.output) for u in evs if isinstance(u, UsageEv)] == [(10, 5)]


TASK = '#fake:tool=create-trello-card #fake:args={"title":"A"} Tạo thẻ A'


def test_hub_fr_95_redelegate_td47_and_tag() -> None:
    prev = [{"role": "user", "content": "#fake:delegate=trello " + TASK}]
    done = _orch_prompt(prev, "Đồng ý").replace(
        "<steps>\n[]\n</steps>", '<steps>\n[{"agent":"trello","status":"done"}]\n</steps>'
    )
    assert redelegate_message(done, "Đồng ý") is None  # TD #47: đã có kết quả step
    tagged = _orch_prompt([{"role": "user", "content": "@Trello  " + TASK}], "Đồng ý")
    assert redelegate_message(tagged, "Đồng ý") == "#fake:delegate=trello " + TASK
    two = _orch_prompt([{"role": "user", "content": "@trello @helper x"}], "Đồng ý")
    assert redelegate_message(two, "Đồng ý") is None
    bare = _orch_prompt([{"role": "user", "content": "@trello"}], "Đồng ý")
    assert redelegate_message(bare, "Đồng ý") is None


def test_hub_fr_95_agent_agree_reuses_previous_directives() -> None:
    history = [("user", "@trello " + TASK), ("assistant", "Tạo thẻ?"), ("user", "Đồng ý")]
    assert agreed_message("Đồng ý", history) == TASK
    assert agreed_message("@trello Agree", history) == TASK
    assert agreed_message("Huỷ", history) is None
    assert agreed_message("Đồng ý #fake:sleep=1", history) is None
    assert agreed_message("Đồng ý", [("user", "Đồng ý")]) is None


async def test_hub_fr_95_agent_agree_runs_previous_message(tmp_path: Path) -> None:
    history = [{"role": "user", "content": "@helper #fake:partial làm"}]
    evs = await go(tmp_path, "Đồng ý", None, history=history)
    assert (last_final(evs).structured or {})["status"] == "partial"


def test_hub_fr_95_strip_tags_keeps_newlines() -> None:
    """Review 1 #8: bỏ tag đầu bằng cắt tiền tố — xuống dòng/khoảng trắng bên trong giữ nguyên."""
    assert strip_tags("@trello  @helper\nDòng 1\n\nDòng  2 \n") == "Dòng 1\n\nDòng  2"
    assert strip_tags("@trello") == ""
    assert strip_tags("@@x a") == "@@x a"
    assert strip_tags("@trello,x b") == "@trello,x b"
    history = [("user", "@trello #fake:tool=a\n  dòng hai"), ("user", "Đồng ý")]
    assert agreed_message("@trello\tĐồng ý", history) == "#fake:tool=a\n  dòng hai"
