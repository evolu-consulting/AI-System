"""P01–P09 · hàm thuần Runtime H2b (stream `delta`, F4 `is_error`, F5 usage) — unit, QW-PU.

Chữ ký: `plan-runtime.md` §3.2 (`StreamScanner`), §3.3 (`split_utf16`, `DeltaBuffer`), §4
(`classify_is_error`, `providers/patterns.py`), §5 (`UsageAcc`), §8 (env `AGENT_RT_DELTA_*`);
mẫu F4 `plan-errors.md` §4; bảng ca `test-plan-py.md` §1; dữ liệu usage theo `spike-stream.md` #6
(nguồn `message_start` → `message_delta` cùng id, bản sau thay bản trước).

Import trong thân test (`importlib`, như `test_dify_rules.py`): trước PY-01 mỗi ca đỏ riêng ở
`ModuleNotFoundError`/`AttributeError`, không làm hỏng collect cả file. P09 xanh ở PY-03 (L8).
`split_utf16` cắt theo đơn vị UTF-16 — chỉ assert hàm Runtime; zod/pydantic đếm code point (BC6),
không assert ở đây.
"""

from __future__ import annotations

import importlib
import json
import random
from collections.abc import Iterable
from types import ModuleType
from typing import Any

import pytest
from pydantic import ValidationError

ANSWER = '{"decision":"answer","text":"Xin chào"}'
ENV_VARS = (
    "LOG_LEVEL",
    "AGENT_RT_WORKER_ID",
    "AGENT_RT_PROVIDERS",
    "AGENT_RT_WORK_DIR",
    "AGENT_RT_LOG_DIR",
    "AGENT_RT_HUB_URL",
    "AGENT_RT_DELTA_FLUSH_MS",
    "AGENT_RT_DELTA_FLUSH_CHARS",
)


def _scan_mod() -> ModuleType:
    return importlib.import_module("agent_runtime.providers.stream_scan")


def _delta() -> ModuleType:
    return importlib.import_module("agent_runtime.runtimes.cli.delta")


def _scanner(mode: str) -> Any:
    return _scan_mod().StreamScanner(mode)


def _feed_all(sc: Any, chunks: Iterable[str]) -> list[list[str]]:
    return [list(sc.feed(c)) for c in chunks]


def _run(mode: str, chunks: Iterable[str]) -> tuple[Any, str]:
    sc = _scanner(mode)
    out = _feed_all(sc, chunks)
    return sc, "".join(p for parts in out for p in parts)


def _cut(doc: str, points: Iterable[int]) -> list[str]:
    idx = [0, *sorted(points), len(doc)]
    return [doc[a:b] for a, b in zip(idx, idx[1:], strict=False)]


def _units(s: str) -> int:
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def _has_lone_surrogate(s: str) -> bool:
    return any(0xD800 <= ord(c) <= 0xDFFF for c in s)


# ───────────────────────── P01 · StreamScanner orchestrator (§3.2) ─────────────────────────


def test_p01_answer_whole_doc() -> None:
    """P01 · một chunk → `Xin chào`, `kind=answer`, `state=closed`; trước `{`: `seeking`."""
    sc = _scanner("orchestrator")
    assert sc.state == "seeking"
    assert sc.kind is None
    assert "".join(sc.feed(ANSWER)) == "Xin chào"
    assert sc.kind == "answer"
    assert sc.state == "closed"


def test_p01_answer_every_split() -> None:
    """P01 · cắt từng ký tự, mọi cách 2, 3 phần → nối `feed` = `Xin chào`, `closed`."""
    n = len(ANSWER)
    cuts: list[list[str]] = [list(ANSWER)]
    cuts += [_cut(ANSWER, [i]) for i in range(1, n)]
    cuts += [_cut(ANSWER, [i, j]) for i in range(1, n) for j in range(i + 1, n)]
    for chunks in cuts:
        sc, text = _run("orchestrator", chunks)
        assert text == "Xin chào", chunks
        assert (sc.kind, sc.state) == ("answer", "closed"), chunks


def test_p01_streaming_state_mid_text() -> None:
    """P01 · đang trong chuỗi `text` → `state=streaming`, đã phát phần đã đọc."""
    sc = _scanner("orchestrator")
    assert "".join(sc.feed('{"decision":"answer","text":"Xin ')) == "Xin "
    assert (sc.kind, sc.state) == ("answer", "streaming")
    assert "".join(sc.feed('chào"}')) == "chào"
    assert sc.state == "closed"


@pytest.mark.parametrize(
    "prefix",
    ["```json\n", "Đây là JSON: ", "\n  ", 'chữ có "ngoặc" và text: '],
)
def test_p01_skip_before_brace(prefix: str) -> None:
    """P01 · fence / chữ trước `{` đầu tiên bị bỏ qua (cả khi cắt từng ký tự)."""
    doc = prefix + ANSWER + "\n```"
    for chunks in ([doc], list(doc)):
        sc, text = _run("orchestrator", chunks)
        assert text == "Xin chào"
        assert sc.state == "closed"


@pytest.mark.parametrize(
    "doc",
    [
        '{"meta":{"text":"x","a":["{\\"}"]},"decision":"answer","text":"Xin chào"}',
        '{"decision":"answer","meta":{"text":"x","a":["{\\"}",{"text":"y"}]},"text":"Xin chào"}',
        '{"decision":"answer","note":"\\"text\\":\\"x\\"","text":"Xin chào"}',
    ],
)
def test_p01_nested_values_do_not_trigger(doc: str) -> None:
    """P01 · khoá `text` lồng / chuỗi chứa `{`, `"` không kích hoạt; chỉ `text` cấp 1 được phát."""
    assert json.loads(doc)["text"] == "Xin chào"
    for chunks in ([doc], list(doc)):
        sc, text = _run("orchestrator", chunks)
        assert text == "Xin chào"
        assert sc.state == "closed"


def test_p01_feed_after_closed_or_off() -> None:
    """P01 · `feed` sau `closed` / `off` → `[]`, state giữ nguyên."""
    sc = _scanner("orchestrator")
    sc.feed(ANSWER)
    assert list(sc.feed('{"decision":"answer","text":"lần 2"}')) == []
    assert sc.state == "closed"
    off = _scanner("orchestrator")
    off.feed('{"decision":"ask","text":"x"}')
    assert list(off.feed('{"decision":"answer","text":"y"}')) == []
    assert off.state == "off"


# ───────────────────────── P02 · StreamScanner agent (§3.2) ─────────────────────────


@pytest.mark.parametrize("status", ["done", "partial"])
def test_p02_agent_status_then_text(status: str) -> None:
    """P02 · `status` ∈ {done, partial} trước `text` → `kind=status`, phát `text`."""
    doc = f'{{"status":"{status}","text":"Xong việc","extra":{{"a":1}}}}'
    for chunks in ([doc], list(doc)):
        sc, text = _run("agent", chunks)
        assert text == "Xong việc"
        assert (sc.kind, sc.state) == (status, "closed")


# fmt: off
OFF_CASES = [  # P01 orchestrator: `text` trước `decision`, decision ≠ answer, thiếu, JSON hỏng
    ("orchestrator", '{"text":"Xin chào","decision":"answer"}'),
    ("orchestrator", '{"decision":"delegate","text":"Xin chào","agent":"writer"}'),
    ("orchestrator", '{"decision":"ask","text":"Bạn muốn gì?"}'),
    ("orchestrator", '{"text":"Xin chào"}'), ("orchestrator", '{"status":"done","text":"Xin"}'),
    ("orchestrator", '{"decision" "answer","text":"Xin chào"}'), ("orchestrator", '{xyz,"t":"a"}'),
    # P02 agent: need_input, `text` trước `status`, `status` lồng, khoá Orchestrator, status lạ
    ("agent", '{"status":"need_input","text":"Bạn cần gì?"}'),
    ("agent", '{"text":"Xong","status":"done"}'), ("agent", '{"x":{"status":"done"},"text":"X"}'),
    ("agent", '{"decision":"answer","text":"Xong"}'), ("agent", '{"status":"weird","text":"Xong"}'),
]
# fmt: on


@pytest.mark.parametrize(("mode", "doc"), OFF_CASES, ids=range(len(OFF_CASES)))
def test_p01_p02_no_stream_off(mode: str, doc: str) -> None:
    """P01/P02 · không đủ điều kiện / JSON hỏng trước khi stream → không phát, `off`, không ném."""
    for chunks in ([doc], list(doc)):
        sc, text = _run(mode, chunks)
        assert (text, sc.state, sc.kind) == ("", "off", None), chunks


# ───────────────────────── P03 · escape, surrogate (§3.2) ─────────────────────────


def _answer_doc(raw_json_text: str) -> str:
    return '{"decision":"answer","text":"' + raw_json_text + '"}'


def test_p03_all_escapes_decoded() -> None:
    """P03 · `\\n \\t \\r \\b \\f \\" \\\\ \\/ \\u00e1` giải đúng (một chunk và từng ký tự)."""
    doc = _answer_doc(r"a\nb\tc\rd\be\ff\"g\\h\/i\u00e1")
    expected = json.loads(doc)["text"]
    assert expected == 'a\nb\tc\rd\be\ff"g\\h/iá'
    for chunks in ([doc], list(doc)):
        _, text = _run("orchestrator", chunks)
        assert text == expected


@pytest.mark.parametrize(
    ("raw", "cut_after"),
    [
        (r"a\nb", "a\\"),
        (r"a\u00e1b", "a\\u00"),
        (r"a\u00e1b", "a\\u"),
        (r"a\"b", "a\\"),
        (r"a\\b", "a\\"),
    ],
)
def test_p03_escape_split_across_chunks(raw: str, cut_after: str) -> None:
    """P03 · escape cắt giữa 2 chunk → chunk đầu không phát dở (luôn là tiền tố của chữ đúng)."""
    doc = _answer_doc(raw)
    expected = json.loads(doc)["text"]
    at = doc.index(raw) + len(cut_after)
    sc = _scanner("orchestrator")
    first = "".join(sc.feed(doc[:at]))
    assert expected.startswith(first)
    assert first in ("", "a")
    assert first + "".join(sc.feed(doc[at:])) == expected


@pytest.mark.parametrize("cut", ["\\ud83d", "\\ud83d\\", "\\ud83d\\ude", "\\ud8"])
def test_p03_surrogate_pair_across_chunks(cut: str) -> None:
    """P03 · `\\ud83d` | `\\ude00` ở hai chunk → phát đúng một `😀`, không bao giờ surrogate lẻ."""
    raw = r"\ud83d\ude00"
    doc = _answer_doc(raw)
    at = doc.index(raw) + len(cut)
    sc = _scanner("orchestrator")
    parts = [*sc.feed(doc[:at]), *sc.feed(doc[at:])]
    assert "".join(parts) == "😀"
    assert not any(_has_lone_surrogate(p) for p in parts)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (r"\ud83dx", "\ufffdx"),
        (r"\ude00x", "\ufffdx"),
        (r"a\ud83d", "a\ufffd"),
        (r"\ud83d\u00e1", "\ufffdá"),
    ],
)
def test_p03_lone_surrogate_replaced(raw: str, expected: str) -> None:
    """P03 · surrogate lẻ (high không có low, low trơ, high cuối chuỗi) → `U+FFFD`."""
    doc = _answer_doc(raw)
    for chunks in ([doc], list(doc)):
        sc, text = _run("orchestrator", chunks)
        assert text == expected
        assert not _has_lone_surrogate(text)
        assert sc.state == "closed"


def test_p03_raw_utf8_passes() -> None:
    """P03 · UTF-8 thô (`á`, emoji, chữ ghép) đi qua nguyên vẹn, cắt ở mọi vị trí."""
    doc = _answer_doc("Tiếng Việt á 😀👍🏽 中文")
    expected = json.loads(doc)["text"]
    for i in range(1, len(doc)):
        _, text = _run("orchestrator", _cut(doc, [i]))
        assert text == expected


# ───────────────────────── P04 · thuộc tính ngẫu nhiên (§3.2) ─────────────────────────

ALPHABET = list('abc xyz{}[]":,\\/\n\t\r\b\fáêọ😀🎉中') + ["\u2028", "\x01", "text", "decision"]


def _random_doc(rng: random.Random) -> tuple[str, str, str]:
    text = "".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 60)))
    mode = rng.choice(["orchestrator", "agent"])
    obj: dict[str, Any] = (
        {"decision": "answer"}
        if mode == "orchestrator"
        else {"status": rng.choice(["done", "partial"])}
    )
    if rng.random() < 0.5:
        obj["meta"] = {"text": 'lồng {"', "a": ["}", {"status": "need_input"}], "n": 1.5}
    obj["text"] = text
    if rng.random() < 0.5:
        obj["tail"] = [None, True, 'x"}']
    doc = json.dumps(
        obj, ensure_ascii=rng.random() < 0.5, separators=rng.choice([None, (",", ":")])
    )
    if rng.random() < 0.3:
        doc = "```json\n" + doc + "\n```"
    return mode, doc, text


def test_p04_random_docs_random_splits() -> None:
    """P04 · 200 JSON ngẫu nhiên (seed cố định) × cách cắt ngẫu nhiên → nối `feed` = `text`."""
    rng = random.Random(20261005)
    for _ in range(200):
        mode, doc, text = _random_doc(rng)
        k = rng.randint(0, min(12, len(doc) - 1))
        chunks = _cut(doc, rng.sample(range(1, len(doc)), k))
        sc = _scanner(mode)
        parts = [p for c in chunks for p in sc.feed(c)]
        assert "".join(parts) == text, (doc, chunks)
        assert not any(_has_lone_surrogate(p) for p in parts), doc
        assert sc.state == "closed", doc


# ───────────────────────── P05 · split_utf16 (§3.3) ─────────────────────────


def _check_split(src: str, parts: list[str], max_units: int) -> None:
    assert "".join(parts) == src
    assert all(p and _units(p) <= max_units for p in parts)
    assert not any(_has_lone_surrogate(p) for p in parts)


@pytest.mark.parametrize(
    ("src", "n_parts"),
    [("", 0), ("a" * 4000, 1), ("a" * 4001, 2), ("a" * 8000, 2), ("a" * 8001, 3)],
    ids=["0", "4000", "4001", "8000", "8001"],
)
def test_p05_split_ascii(src: str, n_parts: int) -> None:
    """P05 · `""` → `[]`; 4 000 → 1; 4 001 → 2; 8 001 → 3; mỗi phần ≤ 4 000 đơn vị (mặc định)."""
    parts = list(_delta().split_utf16(src))
    assert len(parts) == n_parts
    _check_split(src, parts, 4000)


def test_p05_split_never_cuts_code_point() -> None:
    """P05 · 3 999 ASCII + emoji (2 đơn vị) → `[3999 ký tự, emoji]`."""
    src = "a" * 3999 + "😀"
    assert list(_delta().split_utf16(src)) == ["a" * 3999, "😀"]


@pytest.mark.parametrize("max_units", [2, 3, 5, 4000])
def test_p05_split_emoji_custom_max(max_units: int) -> None:
    """P05 · `max_units` tuỳ chọn; chuỗi toàn emoji không bị cắt giữa cặp surrogate."""
    src = "😀á" * 50 + "👍🏽" * 30
    _check_split(src, list(_delta().split_utf16(src, max_units)), max_units)
    _check_split(src, list(_delta().split_utf16(src, max_units=max_units)), max_units)


def test_p05_split_random() -> None:
    """P05 · chuỗi ngẫu nhiên tới 12 000 code point → mọi phần ≤ 4 000 đơn vị, nối = gốc."""
    rng = random.Random(7)
    for _ in range(30):
        src = "".join(rng.choice("ab á😀中\n") for _ in range(rng.randint(0, 12000)))
        parts = list(_delta().split_utf16(src))
        _check_split(src, parts, 4000)
        assert len(parts) >= -(-_units(src) // 4000)


# ───────────────────────── P06 · DeltaBuffer (§3.3) ─────────────────────────


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def _buf(clock: FakeClock, **kw: Any) -> Any:
    return _delta().DeltaBuffer(clock=clock, **kw)


def test_p06_time_flush_defaults() -> None:
    """P06 · mặc định 100 ms: 50 ký tự t=0 → `[]`, chưa `due`; t=0,1 s → `due`, `add` xả."""
    clk = FakeClock()
    buf = _buf(clk)
    assert list(buf.add("x" * 50)) == []
    assert buf.due() is False
    assert buf.wait_s() == pytest.approx(0.1)
    clk.t = 0.06
    assert buf.wait_s() == pytest.approx(0.04)
    clk.t = 0.0999
    assert buf.due() is False
    clk.t = 0.1
    assert buf.due() is True
    assert buf.wait_s() <= 1e-9
    assert "".join(buf.add("y")) == "x" * 50 + "y"
    clk.t = 0.15
    assert list(buf.add("z" * 10)) == []
    assert buf.due() is False
    assert buf.wait_s() == pytest.approx(0.05)


def test_p06_char_flush_defaults() -> None:
    """P06 · mặc định 200 ký tự: 199 → giữ; thêm 1 (≥ 200) → xả ngay; 250 một lần → xả ngay."""
    clk = FakeClock()
    buf = _buf(clk)
    assert list(buf.add("a" * 199)) == []
    assert "".join(buf.add("b")) == "a" * 199 + "b"
    assert list(buf.take()) == []
    assert "".join(_buf(FakeClock()).add("c" * 250)) == "c" * 250


def test_p06_take_flushes_rest() -> None:
    """P06 · `take()` xả hết phần còn; gọi lại → `[]`."""
    buf = _buf(FakeClock())
    buf.add("abc")
    buf.add("đê")
    assert "".join(buf.take()) == "abcđê"
    assert list(buf.take()) == []


def test_p06_custom_thresholds() -> None:
    """P06 · `flush_chars`/`flush_ms` tuỳ chọn."""
    clk = FakeClock()
    buf = _buf(clk, flush_chars=10, flush_ms=1000)
    assert list(buf.add("123456789")) == []
    clk.t = 0.5
    assert buf.due() is False
    assert "".join(buf.add("0")) == "1234567890"
    clk.t = 0.6
    buf.add("x")
    clk.t = 1.6
    assert buf.due() is True


def test_p06_chunks_respect_max_units() -> None:
    """P06 · mỗi chunk ≤ `max_units` (UTF-16), không cắt emoji; nối = đầu vào."""
    clk = FakeClock()
    buf = _buf(clk, flush_chars=10, max_units=4)
    out = [*buf.add("abcdefghij😀😀k"), *buf.take()]
    assert "".join(out) == "abcdefghij😀😀k"
    assert all(o and _units(o) <= 4 for o in out)
    assert not any(_has_lone_surrogate(o) for o in out)


def test_p06_random_sequence_preserves_text() -> None:
    """P06 · chuỗi `add` ngẫu nhiên + đồng hồ tiến → nối mọi chunk (kể cả `take`) = nối đầu vào."""
    rng = random.Random(42)
    clk = FakeClock()
    buf = _buf(clk)
    src: list[str] = []
    out: list[str] = []
    for _ in range(300):
        piece = "".join(rng.choice("ab á😀\n") for _ in range(rng.randint(1, 40)))
        src.append(piece)
        clk.t += rng.choice([0.0, 0.01, 0.05, 0.2])
        out += buf.add(piece)
    out += buf.take()
    assert "".join(out) == "".join(src)
    assert all(_units(o) <= 4000 for o in out)


# ───────────────────────── P07 · classify_is_error (§4, `plan-errors` §4) ─────────────────────────

LONG = "x" * 300


# TC-8: mỗi chữ × (output, stop_reason); `refused` chỉ khi `stop_reason == "refusal"` ∧ 0 output.
RATE = ["You've hit your usage limit", "Rate limit exceeded", "Error 429", "USAGE LIMIT reached",
        "x" * 289 + "usage limit", "Please run /login — usage limit"]  # fmt: skip
AUTH = ["Not logged in · Please run /login", "Invalid API key", "OAuth token has expired",
        "HTTP 401", "not logged in"]  # fmt: skip
OTHER = ["403 Forbidden", "I can't help with that.", None, "", "Error 4290",
         LONG + "usage limit", "x" * 295 + "usage limit", "Prompt is too long"]  # fmt: skip
SIG = [(0, None), (120, None), (0, "refusal"), (7, "refusal"), (0, "end_turn")]
P07_CASES: list[tuple[str | None, int, str | None, str | None]] = [
    *[(t, o, r, "rate") for t in RATE for o, r in SIG],
    *[(t, o, r, "auth") for t in AUTH for o, r in SIG],
    *[(t, o, r, "refused" if (o, r) == (0, "refusal") else None) for t in OTHER for o, r in SIG],
]


@pytest.mark.parametrize(("text", "out", "stop", "expected"), P07_CASES, ids=range(len(P07_CASES)))
def test_p07_classify_is_error(text: Any, out: int, stop: Any, expected: Any) -> None:
    """P07 · TC-8: rate trước auth, bất kể output/tín hiệu; `stop_reason == "refusal"` ∧ output 0
    → `refused`; còn lại None (PROVIDER_ERROR H1); 300 ký tự đầu; chữ ký 2 tham số cũ vẫn dùng."""
    refusal = importlib.import_module("agent_runtime.runtimes.cli.refusal")
    assert stop is not None or refusal.classify_is_error(text, out) == expected
    assert refusal.classify_is_error(text, out, stop_reason=stop) == expected


def test_p07_patterns_module_single_source() -> None:
    """P07 · `RATE_RE`/`AUTH_RE`/`classify_text` ở `providers/patterns.py`; `mapping` dùng lại."""
    patterns = importlib.import_module("agent_runtime.providers.patterns")
    mapping = importlib.import_module("agent_runtime.providers.claude.mapping")
    assert mapping.RATE_RE.pattern == patterns.RATE_RE.pattern
    assert mapping.AUTH_RE.pattern == patterns.AUTH_RE.pattern
    assert patterns.classify_text("Rate limit", "/login") == "rejected"
    assert patterns.classify_text("Not logged in") == "logged_out"
    assert patterns.classify_text("403 Forbidden") is None


# ───────────────────────── P08 · UsageAcc (§5, spike #6) ─────────────────────────

MODEL = "claude-opus-5-5"


def _acc() -> Any:
    return importlib.import_module("agent_runtime.providers.claude.usage_acc").UsageAcc()


def _u(i: int = 0, o: int = 0, cr: int = 0, cc: int = 0, **extra: Any) -> dict[str, Any]:
    return {
        "input_tokens": i,
        "output_tokens": o,
        "cache_read_input_tokens": cr,
        "cache_creation_input_tokens": cc,
        **extra,
    }


def _tot(ev: Any) -> tuple[int, int, int, int]:
    base = importlib.import_module("agent_runtime.providers.base")
    assert isinstance(ev, base.UsageEv)
    return (ev.input, ev.output, ev.cache_read, ev.cache_write)


def test_p08_two_messages_sum() -> None:
    """P08 · 2 `message_id` khác → cộng đủ 4 trường (cache_creation → `cache_write`)."""
    acc = _acc()
    assert _tot(acc.add("m1", _u(10, 5, 100, 7), MODEL)) == (10, 5, 100, 7)
    assert _tot(acc.add("m2", _u(3, 2, 50, 1), MODEL)) == (13, 7, 150, 8)


def test_p08_same_id_replaces() -> None:
    """P08 · cùng id 2 lần → bản sau thay bản trước; bản y hệt → tổng không đổi → `None`."""
    acc = _acc()
    acc.add("m1", _u(10, 5), MODEL)
    assert _tot(acc.add("m1", _u(10, 9), MODEL)) == (10, 9, 0, 0)
    assert acc.add("m1", _u(10, 9), MODEL) is None
    assert _tot(acc.add("m2", _u(1, 1), MODEL)) == (11, 10, 0, 0)


def test_p08_spike_message_start_then_delta() -> None:
    """P08 · chuỗi spike #6: `message_start` out 8 → `message_delta` out 702 (không 710) → m2."""
    acc = _acc()
    ev = acc.add("m1", _u(2, 8, 0, 1049), MODEL)
    assert _tot(ev) == (2, 8, 0, 1049)
    assert ev.model == MODEL
    delta = _u(2, 702, 0, 1049, output_tokens_details={"thinking_tokens": 0}, iterations=[])
    assert _tot(acc.add("m1", delta, MODEL)) == (2, 702, 0, 1049)
    assert _tot(acc.add("m2", _u(2, 24, 2194, 0), MODEL)) == (4, 726, 2194, 1049)


def test_p08_usage_none() -> None:
    """P08 · `usage=None` → `None`, tổng không đổi."""
    acc = _acc()
    assert acc.add("m1", None, MODEL) is None
    acc.add("m1", _u(1, 2), MODEL)
    assert acc.add("m2", None, MODEL) is None
    assert _tot(acc.add("m3", _u(1, 1), MODEL)) == (2, 3, 0, 0)


def test_p08_none_id_is_new_message() -> None:
    """P08 · Q-T7 · `message_id=None` → mỗi lần là message mới (cộng)."""
    acc = _acc()
    assert _tot(acc.add(None, _u(5, 3), MODEL)) == (5, 3, 0, 0)
    assert _tot(acc.add(None, _u(5, 3), MODEL)) == (10, 6, 0, 0)


def test_p08_missing_keys_zero() -> None:
    """P08 · khoá vắng = 0 (`message_delta` có thể chỉ mang một phần trường)."""
    acc = _acc()
    assert _tot(acc.add("m1", {"output_tokens": 4}, None)) == (0, 4, 0, 0)


# ───────────────────────── P09 · Settings `AGENT_RT_DELTA_*` (§8, xanh ở PY-03 — L8) ─────────


def _base_env(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    config = importlib.import_module("agent_runtime.config")
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("HOME", "/home/worker")
    monkeypatch.setenv("REDIS_URL", "redis://:pw@localhost:6379/0")
    monkeypatch.setenv("AGENT_RT_DATABASE_URL", "postgres://u:pw@localhost:5432/db")
    return config


def test_p09_delta_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """P09 · không env → `delta_flush_ms` 100, `delta_flush_chars` 200."""
    s = _base_env(monkeypatch).load_settings()
    assert s.delta_flush_ms == 100
    assert s.delta_flush_chars == 200


MS, CH = "AGENT_RT_DELTA_FLUSH_MS", "AGENT_RT_DELTA_FLUSH_CHARS"


@pytest.mark.parametrize(
    ("name", "value", "ok"),
    [(MS, "10", True), (MS, "1000", True), (CH, "1", True), (CH, "4000", True)]
    + [(MS, "9", False), (MS, "1001", False), (MS, "abc", False), (CH, "0", False)]
    + [(CH, "4001", False)],
)
def test_p09_delta_bounds(monkeypatch: pytest.MonkeyPatch, name: str, value: str, ok: bool) -> None:
    """P09 · biên 10–1 000 ms, 1–4 000 ký tự nhận; ngoài khoảng / không số → `ValidationError`."""
    config = _base_env(monkeypatch)
    assert {"delta_flush_ms", "delta_flush_chars"} <= set(config.Settings.model_fields)
    monkeypatch.setenv(name, value)
    if ok:
        field = "delta_flush_ms" if name == MS else "delta_flush_chars"
        assert getattr(config.load_settings(), field) == int(value)
        return
    with pytest.raises(ValidationError):
        config.load_settings()
