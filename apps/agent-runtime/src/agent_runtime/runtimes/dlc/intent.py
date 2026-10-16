"""DLC-R03 · DLC-R04 · (thuần) Đọc tin chat gửi agent DLC thành một việc cụ thể và câu trả lời cho
câu hỏi.

Không gọi model: lệnh ngắn bắt đầu bằng từ khoá (vi/en) là lệnh điều khiển; còn lại là nội dung —
spec cho New System / Enhancement, hoặc mô tả lỗi khi bắt đầu bằng "bug"/"lỗi"/"fix". Khối
`<attachments>` Hub nối vào prompt (H2c P10) và tag `@agent` đầu tin bị bỏ trước khi đọc.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

from agent_runtime.runtimes.dlc.client import objs

Kind = Literal["status", "pause", "resume", "cancel", "retry", "app", "new", "bug", "content"]

COMMAND_MAX = 80  # tin dài hơn luôn là nội dung (spec), không phải lệnh
_COMMANDS: tuple[tuple[Kind, tuple[str, ...]], ...] = (
    ("status", ("status", "trang thai", "tien do", "sao roi", "the nao roi", "progress")),
    ("pause", ("pause", "tam dung", "dung lai")),
    ("resume", ("resume", "tiep tuc", "chay tiep", "continue")),
    ("cancel", ("cancel", "huy")),
    ("retry", ("retry", "thu lai")),
    ("app", ("app", "mo app", "open app", "chay app", "start app")),
    ("new", ("du an moi", "project moi", "new project")),
)
_BUG = ("bug", "loi", "fix", "sua loi")
_ACCEPT_ALL = ("ok", "dong y", "theo de xuat", "recommended", "mac dinh", "default", "yes", "co")
_ANSWER_LINE = re.compile(r"^\s*(?:q\s*)?(\d+)\s*[:.)=\-]\s*(.+?)\s*$", re.IGNORECASE)
_MENTION = re.compile(r"^\s*(?:@\S+\s+)+")
_PRESET = re.compile(r"^#([a-z][a-z0-9-]{1,47})(?:\s+|$)")


@dataclass(frozen=True)
class Intent:
    kind: Kind
    text: str  # phần còn lại (gợi ý cho retry, mô tả lỗi, spec)


def fold(text: str) -> str:
    """Chữ thường, bỏ dấu tiếng Việt (đ → d) để so từ khoá."""
    s = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def message_of(prompt: str) -> str:
    """Tin của người dùng: bỏ khối `<attachments>` cuối prompt và tag `@agent` đầu tin."""
    cut = prompt.find("\n\n<attachments")
    body = prompt if cut < 0 else prompt[:cut]
    return _MENTION.sub("", body).strip()


def split_preset(message: str) -> tuple[str | None, str]:
    """DLC-R14 · `#key …` ở đầu tin chọn workflow DLC `key` (Evolu Control › Workflow Process);
    trả (key, phần còn lại)."""
    m = _PRESET.match(message.strip())
    if not m:
        return None, message
    return m.group(1), message.strip()[m.end() :]


def _starts(folded: str, word: str) -> bool:
    return folded == word or folded.startswith(word + " ") or folded.startswith(word + ":")


def _exact(folded: str, word: str) -> bool:
    return folded.rstrip(" ?!.") == word


def parse(message: str) -> Intent:
    """Lệnh điều khiển (tin ngắn, bắt đầu bằng từ khoá) hoặc nội dung."""
    text = message.strip()
    folded = fold(text)
    if len(text) <= COMMAND_MAX:
        for kind, words in _COMMANDS:
            # "app" chỉ khi cả tin là lệnh: "App quản lý kho…" là spec, không phải mở app.
            match = _exact if kind == "app" else _starts
            hit = next((w for w in words if match(folded, w)), None)
            if hit is not None:
                return Intent(kind, text[len(hit) :].lstrip(" :").strip())
    if any(_starts(folded, w) for w in _BUG):
        return Intent("bug", text)
    return Intent("content", text)


# ---------- câu trả lời cho câu hỏi của run đang đỗ (FRONTEND-INTEGRATION §5.5) ----------


def _option_id(question: dict[str, Any], value: str) -> str | None:
    want = fold(value).strip()
    for opt in objs(question.get("options")):
        oid, otext = str(opt.get("id", "")), str(opt.get("text", ""))
        if want in (fold(oid), fold(otext)):
            return oid
    return None


def _answer(question: dict[str, Any], value: str) -> dict[str, str]:
    qid = str(question.get("qid", ""))
    if fold(value).strip() in _ACCEPT_ALL and question.get("recommended"):
        return {"qid": qid, "option": str(question["recommended"])}
    oid = _option_id(question, value)
    return {"qid": qid, "option": oid} if oid else {"qid": qid, "option": "other", "text": value}


def answers_for(message: str, questions: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Câu trả lời theo dòng `1: a` / `Q2 = 30 ngày`; "ok"/"theo đề xuất" = mọi câu theo đề xuất;
    một câu hỏi thì cả tin là câu trả lời. Câu không được trả lời bị bỏ (run vẫn đỗ)."""
    text = message.strip()
    if not questions or not text:
        return []
    if fold(text) in _ACCEPT_ALL:
        return [_answer(q, text) for q in questions if q.get("recommended")]
    by_no = {i + 1: q for i, q in enumerate(questions)}
    by_qid = {fold(str(q.get("qid", ""))): q for q in questions}
    out: list[dict[str, str]] = []
    for line in text.splitlines():
        m = _ANSWER_LINE.match(line)
        if not m:
            continue
        n, value = int(m.group(1)), m.group(2)
        q = by_qid.get(f"q{n}") or by_no.get(n)
        if q is not None:
            out.append(_answer(q, value))
    if not out and len(questions) == 1:
        out.append(_answer(questions[0], text))
    return out
