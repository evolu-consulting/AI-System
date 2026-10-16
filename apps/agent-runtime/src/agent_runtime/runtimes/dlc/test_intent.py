"""DLC-R03 · DLC-R04 · đọc tin chat → việc; câu trả lời cho câu hỏi của run đang đỗ."""

from __future__ import annotations

from agent_runtime.runtimes.dlc.intent import answers_for, fold, message_of, parse, split_preset

QS = [
    {
        "qid": "Q1",
        "decision": "Thời hạn mượn?",
        "options": [{"id": "a", "text": "14 ngày"}, {"id": "b", "text": "30 ngày"}],
        "recommended": "a",
    },
    {
        "qid": "Q2",
        "decision": "Phạt trễ?",
        "options": [{"id": "x", "text": "Có"}],
        "recommended": "x",
    },
]


def test_dlc_r03_fold_drops_vietnamese_marks() -> None:
    assert fold("Tiếp Tục") == "tiep tuc" and fold("Đồng ý") == "dong y"


def test_dlc_r03_message_strips_attachments_block_and_mention() -> None:
    prompt = "@dlc  Làm app này\n\n<attachments>\n- spec.md\n</attachments>"
    assert message_of(prompt) == "Làm app này"


def test_dlc_r03_commands() -> None:
    assert parse("trạng thái").kind == "status"
    assert parse("Tạm dừng").kind == "pause"
    assert parse("tiếp tục").kind == "resume"
    assert parse("huỷ").kind == "cancel"
    retry = parse("thử lại: dùng sqlite thay vì file json")
    assert retry.kind == "retry" and retry.text == "dùng sqlite thay vì file json"
    assert parse("app").kind == "app" and parse("mở app?").kind == "app"
    new = parse("dự án mới # Todo")
    assert new.kind == "new" and new.text == "# Todo"


def test_dlc_r03_app_word_inside_a_spec_is_content() -> None:
    assert parse("App quản lý kho đơn giản").kind == "content"


def test_dlc_r03_long_message_is_never_a_command() -> None:
    spec = "trạng thái " + "x" * 200
    assert parse(spec).kind == "content"


def test_dlc_r03_bug_report() -> None:
    assert parse("lỗi: bấm Lưu không lưu").kind == "bug"
    assert parse("bug - empty text accepted").kind == "bug"


def test_dlc_r04_answers_by_line_option_and_free_text() -> None:
    got = answers_for("1: b\nQ2 = không phạt", QS)
    assert got == [
        {"qid": "Q1", "option": "b"},
        {"qid": "Q2", "option": "other", "text": "không phạt"},
    ]


def test_dlc_r04_answer_by_option_text() -> None:
    assert answers_for("1: 30 ngày", QS) == [{"qid": "Q1", "option": "b"}]


def test_dlc_r04_ok_takes_every_recommendation() -> None:
    assert answers_for("OK", QS) == [{"qid": "Q1", "option": "a"}, {"qid": "Q2", "option": "x"}]
    assert answers_for("theo đề xuất", QS)[0] == {"qid": "Q1", "option": "a"}


def test_dlc_r04_single_question_takes_whole_message() -> None:
    assert answers_for("21 ngày", QS[:1]) == [{"qid": "Q1", "option": "other", "text": "21 ngày"}]


def test_dlc_r04_unreadable_answers_for_several_questions() -> None:
    assert answers_for("không biết", QS) == []


def test_dlc_r14_split_preset() -> None:
    assert split_preset("#quick-fix lỗi: x") == ("quick-fix", "lỗi: x")
    assert split_preset("#dlc-new") == ("dlc-new", "")
    assert split_preset("# Heading spec") == (None, "# Heading spec")
    assert split_preset("không có") == (None, "không có")
