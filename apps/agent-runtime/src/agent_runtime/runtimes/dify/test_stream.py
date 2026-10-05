"""WRK-FR-06 · R12 — ca biên `stream` ngoài bảng khoá P30 (`final_text`, sự kiện thiếu trường)."""

from __future__ import annotations

from agent_runtime.runtimes.dify.stream import (
    OUTPUT_MAX,
    Failed,
    Finished,
    StreamState,
    final_text,
    reduce,
)


def test_wrk_fr_06_reduce_missing_fields_tolerated() -> None:
    s, step = reduce(StreamState(app_type="workflow"), "text_chunk", {"data": "x"})
    assert (s.text, s.first_seen, s.task_id, step) == ("", True, None, None)
    s, step = reduce(StreamState(app_type="chat"), "message_end", {})
    assert (s.usage, step) == (None, Finished())
    s, step = reduce(StreamState(app_type="workflow"), "workflow_finished", {})
    assert (s.outputs, step) == (None, Failed("finished_failed"))


def test_wrk_fr_06_reduce_task_id_kept_from_first_event() -> None:
    s, _ = reduce(StreamState(app_type="chat"), "message", {"task_id": "t1", "answer": "a"})
    s, _ = reduce(s, "message", {"task_id": "t2", "answer": "b"})
    assert (s.task_id, s.text) == ("t1", "ab")


def test_wrk_fr_06_final_text_table() -> None:
    assert final_text("abc", {"text": "x"}, None) == "abc"
    assert final_text("", {"text": "x"}, None) == "x"
    assert final_text("", {"out": {"a": 1}}, "out") == '{"a":1}'
    assert final_text("", {"n": 3}, "n") == "3"
    assert final_text("", {"text": ""}, None) is None
    assert final_text("", {"text": None}, None) is None
    assert final_text("", None, None) is None
    assert final_text("", {"x": "y"}, "text") is None


def test_review1_c5_text_capped_while_streaming() -> None:
    """C5: text nối dừng ở `OUTPUT_MAX` (bộ nhớ không tăng theo stream), phần thừa chỉ đếm."""
    s = StreamState(app_type="workflow")
    chunk = "x" * 30_000
    for _ in range(5):
        s, _ = reduce(s, "text_chunk", {"data": {"text": chunk}})
    assert (len(s.text), s.dropped) == (OUTPUT_MAX, 5 * 30_000 - OUTPUT_MAX)
    s, _ = reduce(s, "text_chunk", {"data": {"text": "tail"}})
    assert (len(s.text), s.dropped) == (OUTPUT_MAX, 5 * 30_000 - OUTPUT_MAX + 4)
    c = StreamState(app_type="chat")
    c, _ = reduce(c, "message", {"answer": "a" * (OUTPUT_MAX - 1)})
    c, _ = reduce(c, "message", {"answer": "bc"})
    assert (c.text[-1], len(c.text), c.dropped) == ("b", OUTPUT_MAX, 1)
