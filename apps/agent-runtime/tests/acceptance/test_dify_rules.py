"""P28–P30 · hàm thuần Runtime H2a (`workflow.async`, MCP xác nhận) — unit, QW-PU, viết trước PY-01.

Chữ ký: `plan-runtime` §3.1 (`ErrKind`, `RetryFlags`, `retry_delay`, `map_failure`, `usage_row`,
`mask`, `StreamState`/`reduce`, `ClaimedJob.token`), §5 (`parse_confirmation`); bảng ca:
`test-plan-py.md`, `test-plan-cases` §1.9–1.10; nguồn `plan-runtime-dify` §3.2, §3.4, §3.5, §3.7.

Import trong thân test (`importlib`, như `test_contracts_hub.py`): trước PY-01 mỗi ca đỏ riêng ở
`ModuleNotFoundError`/`AttributeError` (module/hàm chưa có), không làm hỏng collect cả file.
`data` của `reduce` = object JSON nguyên dòng `data:` SSE Dify (`event`, `task_id`, `data{…}`,
`answer`, `metadata{usage}` — hình của `tools/hub-dev/src/dify-mock.ts`, RT9).
"""

from __future__ import annotations

import base64
import hashlib
import importlib
import json
import re
import secrets
from decimal import Decimal
from types import ModuleType
from typing import Any, get_args

import pytest

ERR_KINDS = ("connect", "http_5xx", "read", "http_4xx", "sse_error", "finished_failed", "empty")
NO_RETRY = ("http_4xx", "sse_error", "finished_failed", "empty")

# Vector dùng chung với Hub TS (`apps/hub-api/src/lib/job-token.test.ts`, R59/P01/P28).
TOKEN_VECTORS = (
    (
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
    ),
    (
        "test_job-token-vector_0123456789_abcdefghij",
        "612aac117a8936eada56e1dfb1a962d6c062699c16440affb607229af893ff22",
    ),
)
JOB_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
ENV_VARS = (
    "LOG_LEVEL",
    "AGENT_RT_WORKER_ID",
    "AGENT_RT_PROVIDERS",
    "AGENT_RT_WORK_DIR",
    "AGENT_RT_LOG_DIR",
    "AGENT_RT_ORPHAN_S",
    "AGENT_RT_HUB_URL",
    "AGENT_RT_DIFY_BACKOFF_S",
)


def _policy() -> ModuleType:
    return importlib.import_module("agent_runtime.runtimes.dify.policy")


def _stream() -> ModuleType:
    return importlib.import_module("agent_runtime.runtimes.dify.stream")


def _flags(first_seen: bool, side_effect: bool) -> Any:
    return _policy().RetryFlags(first_seen=first_seen, side_effect=side_effect)


# ───────────────────────── P28 · retry_delay (`-dify` §3.4) ─────────────────────────


def test_p28_err_kind_and_default_backoff() -> None:
    """P28 · `ErrKind` đủ 7 giá trị; `BACKOFF` mặc định `(2, 8)`; `RetryFlags` frozen."""
    p = _policy()
    assert set(get_args(p.ErrKind)) == set(ERR_KINDS)
    assert tuple(p.BACKOFF) == (2.0, 8.0)
    f = p.RetryFlags(first_seen=False, side_effect=True)
    with pytest.raises(AttributeError):
        f.side_effect = False  # frozen dataclass → FrozenInstanceError (⊂ AttributeError)


@pytest.mark.parametrize(
    ("err_kind", "side_effect"),
    [("connect", False), ("connect", True), ("http_5xx", False), ("read", False)],
)
def test_p28_retry_delay_retryable(err_kind: str, side_effect: bool) -> None:
    """P28 · lỗi thử lại được, chưa thấy sự kiện → 2.0 / 8.0 / None (lần 3, 4).
    `connect` = chưa gửi request ⇒ thử lại kể cả `side_effect`."""
    rd = _policy().retry_delay
    flags = _flags(False, side_effect)
    got = [rd(err_kind, n, flags) for n in (1, 2, 3, 4)]
    assert got == [2.0, 8.0, None, None]


def test_p28_retry_delay_custom_backoff() -> None:
    """P28 · `backoff=(0.2, 0.8)` (env test `AGENT_RT_DIFY_BACKOFF_S`) → 0.2 / 0.8 / None."""
    rd = _policy().retry_delay
    flags = _flags(False, False)
    got = [rd("connect", n, flags, (0.2, 0.8)) for n in (1, 2, 3)]
    assert got == [0.2, 0.8, None]
    assert rd("http_5xx", 1, flags, backoff=(0.2, 0.8)) == 0.2


@pytest.mark.parametrize("err_kind", ["http_5xx", "read", "http_4xx", "sse_error", "empty"])
def test_p28_retry_delay_side_effect_sent(err_kind: str) -> None:
    """P28 · Q6 · `side_effect` ∧ `err_kind ≠ connect` → None (request có thể đã chạy)."""
    rd = _policy().retry_delay
    assert [rd(err_kind, n, _flags(False, True)) for n in (1, 2)] == [None, None]


@pytest.mark.parametrize("err_kind", ERR_KINDS)
@pytest.mark.parametrize("side_effect", [False, True])
def test_p28_retry_delay_after_first_event(err_kind: str, side_effect: bool) -> None:
    """P28 · RQ5 · `first_seen` (đã nhận sự kiện ≠ ping) → None mọi `err_kind`, kể cả `connect`."""
    rd = _policy().retry_delay
    assert [rd(err_kind, n, _flags(True, side_effect)) for n in (1, 2)] == [None, None]


@pytest.mark.parametrize("err_kind", NO_RETRY)
def test_p28_retry_delay_never_retry(err_kind: str) -> None:
    """P28 · `http_4xx` (401/403/404/400/413/415/422/429), `sse_error`, `finished_failed`,
    `empty` → None ngay lần 1."""
    rd = _policy().retry_delay
    flags = _flags(False, False)
    assert [rd(err_kind, n, flags) for n in (1, 2)] == [None, None]


def test_p28_job_token_claimed_job_and_vector() -> None:
    """P28 · RT1/P4 · token claim: `secrets.token_urlsafe(32)` 43 ký tự base64url; hash =
    sha256 ASCII 32 byte = vector TS `hashJobToken`; `ClaimedJob.token` mặc định "" và không
    lộ qua `repr`."""
    jobs_sql = importlib.import_module("agent_runtime.db.jobs_sql")
    plain = jobs_sql.ClaimedJob(id="j1", payload={})
    assert plain.token == ""
    for token, hex_digest in TOKEN_VECTORS:
        assert JOB_TOKEN_RE.match(token)
        digest = hashlib.sha256(token.encode("ascii")).digest()
        assert (len(digest), digest.hex()) == (32, hex_digest)
        job = jobs_sql.ClaimedJob(id="j1", payload={"run_id": "r1"}, token=token)
        assert job.token == token
        assert token not in repr(job)
    assert JOB_TOKEN_RE.match(secrets.token_urlsafe(32))


def test_p28_settings_defaults_backoff_and_orphan(monkeypatch: pytest.MonkeyPatch) -> None:
    """P28 · Q-T5 · `Settings` không env: `orphan_s` = 60, `dify_backoff_s` = (2, 8);
    `AGENT_RT_DIFY_BACKOFF_S=0.2,0.8` → (0.2, 0.8)."""
    config = importlib.import_module("agent_runtime.config")
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("HOME", "/home/worker")
    monkeypatch.setenv("REDIS_URL", "redis://:pw@localhost:6379/0")
    monkeypatch.setenv("AGENT_RT_DATABASE_URL", "postgres://u:pw@localhost:5432/db")
    s = config.load_settings()
    assert s.orphan_s == 60
    assert tuple(s.dify_backoff_s) == (2.0, 8.0)
    monkeypatch.setenv("AGENT_RT_DIFY_BACKOFF_S", "0.2,0.8")
    assert tuple(config.load_settings().dify_backoff_s) == (0.2, 0.8)


# ───────────────────────── P29 · parse_confirmation (`plan-runtime` §5) ─────────────────────────

QUESTION = "Tạo thẻ Trello?"
CONFIRM = {"code": "CONFIRMATION_REQUIRED", "question": QUESTION, "choices": ["Đồng ý", "Huỷ"]}
HINT = "Hãy hỏi lại người dùng bằng đúng câu hỏi và hai lựa chọn trên rồi dừng."


def _blocks(*texts: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": t} for t in texts]


def _one_line(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False)  # = JSON.stringify: một dòng


def _parse(content: Any) -> Any:
    return importlib.import_module("agent_runtime.providers.base").parse_confirmation(content)


def _assert_confirm(got: Any, question: str, choices: list[str]) -> None:
    assert got is not None
    assert (got.question, list(got.choices)) == (question, choices)


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(_blocks(_one_line(CONFIRM), HINT), id="blocks-json-then-hint"),
        pytest.param(_blocks(_one_line(CONFIRM)), id="blocks-json-only"),
        pytest.param(f"{_one_line(CONFIRM)}\n{HINT}", id="str-cli-is-error-S2"),
        pytest.param(f"{_one_line(CONFIRM)}\n{HINT}\n{HINT}", id="str-multi-newline"),
        pytest.param(_one_line(CONFIRM), id="str-json-only"),
    ],
)
def test_p29_parse_confirmation_valid(content: Any) -> None:
    """P29 · FR-95 · khối đầu JSON đúng hình → `Confirm{question, choices}`; câu chỉ dẫn
    (khối 2 / sau `\\n` đầu) bỏ qua; `content` str (CLI `is_error`, spike S2) tách tại `\\n` đầu."""
    _assert_confirm(_parse(content), QUESTION, ["Đồng ý", "Huỷ"])


def test_p29_parse_confirmation_question_boundary() -> None:
    """P29 · `question` dài đúng 2 000 ký tự → nhận."""
    obj = {**CONFIRM, "question": "q" * 2000}
    _assert_confirm(_parse(_blocks(_one_line(obj), HINT)), "q" * 2000, ["Đồng ý", "Huỷ"])


def _bad(**kw: object) -> str:
    return _one_line({**CONFIRM, **kw})


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(_blocks(_bad(code="TOOL_ERROR"), HINT), id="code-khac"),
        pytest.param(_blocks(_bad(choices=["Đồng ý"])), id="choices-1"),
        pytest.param(_blocks(_bad(choices=["Đồng ý", "Huỷ", "Để sau"])), id="choices-3"),
        pytest.param(_blocks(_bad(choices=[1, 2])), id="choices-khong-str"),
        pytest.param(_blocks(_bad(question="")), id="question-rong"),
        pytest.param(_blocks(_bad(question="q" * 2001)), id="question-2001"),
        pytest.param(_blocks(_bad(question=None)), id="question-null"),
        pytest.param(_blocks("không phải JSON", HINT), id="khong-json"),
        pytest.param(_blocks(_one_line([CONFIRM])), id="json-mang"),
        pytest.param([], id="list-rong"),
        pytest.param("", id="str-rong"),
        pytest.param(f"{_bad(code='X')}\n{HINT}", id="str-code-khac"),
        pytest.param(f"lỗi tool\n{_one_line(CONFIRM)}", id="str-json-sau-newline"),
    ],
)
def test_p29_parse_confirmation_invalid(content: Any) -> None:
    """P29 · sai hình (`code` khác, `choices` ≠ 2 str, `question` rỗng/2 001, không JSON) → None."""
    assert _parse(content) is None


# ───────────────────────── P30 · map_failure (R11, `plan-errors` §2) ─────────────────────────


@pytest.mark.parametrize(
    ("err_kind", "status", "expected"),
    [
        ("connect", None, ("UPSTREAM_ERROR", "upstream")),
        ("http_5xx", 503, ("UPSTREAM_ERROR", "upstream")),
        ("http_5xx", 500, ("UPSTREAM_ERROR", "upstream")),
        ("read", None, ("UPSTREAM_ERROR", "upstream")),
        ("http_4xx", 401, ("NOT_CONFIGURED", "upstream")),
        ("http_4xx", 403, ("NOT_CONFIGURED", "upstream")),
        ("http_4xx", 404, ("NOT_CONFIGURED", "upstream")),
        ("http_4xx", 400, ("UPSTREAM_ERROR", "upstream")),
        ("http_4xx", 413, ("UPSTREAM_ERROR", "upstream")),
        ("http_4xx", 415, ("UPSTREAM_ERROR", "upstream")),
        ("http_4xx", 422, ("UPSTREAM_ERROR", "upstream")),
        ("http_4xx", 429, ("UPSTREAM_ERROR", "upstream")),
        ("sse_error", None, ("UPSTREAM_ERROR", "upstream")),
        ("finished_failed", None, ("UPSTREAM_ERROR", "upstream")),
        ("empty", None, ("UPSTREAM_ERROR", "invalid_output")),
    ],
)
def test_p30_map_failure(err_kind: str, status: int | None, expected: tuple[str, str]) -> None:
    """P30 · R11 · `(err_kind, http_status)` → `(code, reason)` theo `-dify` §3.4."""
    assert tuple(_policy().map_failure(err_kind, status)) == expected


# ───────────────────────── P30 · usage_row (R15, `-dify` §3.7) ─────────────────────────

CHAT_USAGE = {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15,
    "total_price": "0.0012",
    "currency": "USD",
}


@pytest.mark.parametrize(
    ("app_type", "usage", "expected"),
    [
        pytest.param(
            "workflow",
            {"status": "succeeded", "outputs": {}, "total_tokens": 30},
            (30, 0, Decimal(0)),
            id="workflow-total",
        ),
        pytest.param("workflow", None, (0, 0, Decimal(0)), id="workflow-none"),
        pytest.param("chat", CHAT_USAGE, (10, 5, Decimal("0.0012")), id="chat-usd"),
        pytest.param("agent", CHAT_USAGE, (10, 5, Decimal("0.0012")), id="agent-usd"),
        pytest.param("chat", None, (0, 0, Decimal(0)), id="chat-none"),
        pytest.param("chat", {**CHAT_USAGE, "currency": "RMB"}, (10, 5, Decimal(0)), id="chat-rmb"),
        pytest.param(
            "chat",
            {k: v for k, v in CHAT_USAGE.items() if k != "currency"},
            (10, 5, Decimal(0)),
            id="chat-no-currency",
        ),
    ],
)
def test_p30_usage_row(
    app_type: str, usage: dict[str, Any] | None, expected: tuple[int, int, Decimal]
) -> None:
    """P30 · R15 · chat/agent: prompt/completion; workflow: total/0; thiếu → 0/0; `cost_usd`
    chỉ khi USD (Decimal, không float); `latency_ms`, `feature_id` truyền nguyên."""
    row = _policy().usage_row(app_type, usage, 1234, "feat-1")
    assert (row.input_tokens, row.output_tokens, row.cost_usd) == expected
    assert isinstance(row.cost_usd, Decimal)
    assert (row.latency_ms, row.feature_id) == (1234, "feat-1")
    assert _policy().usage_row(app_type, usage, 0, None).feature_id is None


# ───────────────────────── P30 · mask (RT2, R17, `plan-runtime` §3.3 #4) ─────────────────────────

KEY = "LEAK_KEY_app-x9Q"  # 16 ký tự ASCII


def test_p30_mask_raw_base64_hex() -> None:
    """P30 · R17 · key thô / base64 / hex trong chuỗi → `***`."""
    b64 = base64.b64encode(KEY.encode()).decode()
    hx = KEY.encode().hex()
    text = f"401 {KEY} | b64={b64} | hex={hx}"
    out = _policy().mask(text, KEY)
    for form in (KEY, b64.rstrip("="), hx):
        assert form not in out
    assert out.startswith("401 *** | b64=")
    assert _policy().mask("không có gì", KEY) == "không có gì"


def test_p30_mask_then_truncate() -> None:
    """P30 · che **trước**, cắt ≤ `max_len` **sau** (key vắt qua mốc cắt không lộ phần đầu)."""
    m = _policy().mask
    out = m("a" * 295 + KEY + "b" * 50, KEY)
    assert len(out) <= 300
    assert "LEAK" not in out
    assert out.startswith("a" * 295 + "***")
    assert 0 < len(m("x" * 1000, KEY)) <= 300
    assert 0 < len(m("x" * 1000, KEY, max_len=10)) <= 10


# ───────────────────────── P30 · reduce (`-dify` §3.2, §3.5) ─────────────────────────

IDS = {"task_id": "t1", "workflow_run_id": "wr1", "message_id": "m1", "conversation_id": "c1"}


def _ev(event: str, **body: Any) -> tuple[str, dict[str, Any]]:
    return event, {**IDS, "event": event, **body}


def _state(app_type: str = "workflow") -> Any:
    return _stream().StreamState(app_type=app_type)


def test_p30_reduce_ping_keeps_state() -> None:
    """P30 · `ping` → state không đổi (không đặt `first_seen`), Step None."""
    s0 = _state()
    s1, step = _stream().reduce(s0, "ping", {})
    assert (s1, step) == (s0, None)
    assert s1.first_seen is False


def test_p30_reduce_workflow_started_task_id() -> None:
    """P30 · `workflow_started` → `task_id` (cho stop), `first_seen=true`, None."""
    st = _stream()
    s1, step = st.reduce(_state(), *_ev("workflow_started", data={"id": "wr1"}))
    assert (s1.task_id, s1.first_seen, step) == ("t1", True, None)


def test_p30_reduce_node_started_progress() -> None:
    """P30 · R12 · `node_started` → `nodes` tăng, `Progress(n)`; không mang tên node."""
    st = _stream()
    ev = _ev("node_started", data={"title": "NODE_SECRET_TITLE", "node_type": "llm"})
    s1, step1 = st.reduce(_state(), *ev)
    assert (s1.nodes, s1.first_seen, step1) == (1, True, st.Progress(n=1))
    s2, step2 = st.reduce(s1, *ev)
    assert (s2.nodes, step2) == (2, st.Progress(n=2))


def test_p30_reduce_agent_thought_progress() -> None:
    """P30 · §3.5 · `agent_thought` (app agent) → `Progress(n)` tăng như `node_started`."""
    st = _stream()
    s1, step = st.reduce(_state("agent"), *_ev("agent_thought", id="th1", thought="x"))
    assert (s1.nodes, s1.first_seen, step) == (1, True, st.Progress(n=1))


def test_p30_reduce_text_accumulates() -> None:
    """P30 · `text_chunk.data.text` (workflow) · `message.answer` / `agent_message.answer`
    (chat/agent) cộng dồn, `first_seen=true`, None."""
    st = _stream()
    s, step_a = st.reduce(_state(), *_ev("text_chunk", data={"text": "ab"}))
    s, step_b = st.reduce(s, *_ev("text_chunk", data={"text": "c"}))
    assert (s.text, s.first_seen, step_a, step_b) == ("abc", True, None, None)
    c, step_c = st.reduce(_state("chat"), *_ev("message", answer="x"))
    assert (c.text, c.first_seen, step_c) == ("x", True, None)
    a, _ = st.reduce(_state("agent"), *_ev("agent_message", answer="y"))
    a, _ = st.reduce(a, *_ev("agent_message", answer="z"))
    assert a.text == "yz"


def test_p30_reduce_workflow_finished_succeeded() -> None:
    """P30 · `workflow_finished` `succeeded` → `Finished`, giữ `outputs` (cho `final_text`)."""
    st = _stream()
    data = {"status": "succeeded", "outputs": {"text": "kq"}, "total_tokens": 30}
    s1, step = st.reduce(_state(), *_ev("workflow_finished", data=data))
    assert step == st.Finished()
    assert (dict(s1.outputs or {}), s1.first_seen) == ({"text": "kq"}, True)


@pytest.mark.parametrize("status", ["failed", "stopped"])
def test_p30_reduce_workflow_finished_failed(status: str) -> None:
    """P30 · R11 · `workflow_finished.status ∈ {failed, stopped}` → `Failed("finished_failed")`."""
    st = _stream()
    data: dict[str, Any] = {"status": status, "outputs": {}, "error": "boom"}
    s1, step = st.reduce(_state(), *_ev("workflow_finished", data=data))
    assert (step, s1.first_seen) == (st.Failed(kind="finished_failed"), True)


def test_p30_reduce_message_end_usage() -> None:
    """P30 · R15 · `message_end.metadata.usage` (chat) → lưu `usage`, `Finished`."""
    st = _stream()
    s1, step = st.reduce(_state("chat"), *_ev("message_end", metadata={"usage": CHAT_USAGE}))
    assert step == st.Finished()
    assert dict(s1.usage or {}) == CHAT_USAGE


def test_p30_reduce_error_event() -> None:
    """P30 · R11 · sự kiện `error` → `Failed("sse_error")`, `first_seen=true`."""
    st = _stream()
    ev = _ev("error", status=500, code="mock_error", message="mock")
    s1, step = st.reduce(_state(), *ev)
    assert (step, s1.first_seen) == (st.Failed(kind="sse_error"), True)


def test_p30_reduce_unknown_event() -> None:
    """P30 · sự kiện lạ (`node_finished`) → `first_seen=true`, Step None, text không đổi."""
    st = _stream()
    s1, step = st.reduce(_state(), *_ev("node_finished", data={"status": "succeeded"}))
    assert (s1.first_seen, step, s1.text, s1.nodes) == (True, None, "", 0)
