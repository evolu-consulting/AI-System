"""WRK-FR-10 · Phân tích `msg` của `fake-cli` (plan-runtime-fake §7): chỉ thị `#fake:*` và khối
`<message>` của Orchestrator (Q-T8: không echo cả prompt). Chỉ đọc tin hiện tại, không đọc history
— trừ H2a S01: tin hiện tại là câu đồng ý → đọc tin user trước đó trong `<history>` để delegate lại
(H2b PY-04: chỉ khi `<steps>` rỗng — TD #47; tin trước `@<key> …` ⇒ delegate `<key>`), và agent
nhận câu đồng ý không chỉ thị → chạy lại tin user trước trong `payload.history` (plan-runtime §6).
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import cast

from agent_runtime.providers.context import current_message

_DIRECTIVE = re.compile(r"#fake:([a-z_-]+)(?:=(\S+))?")
_DELEGATE = re.compile(r"#fake:delegate=\S*")
_OPEN, _CLOSE = "<message>", "</message>"


def message_of(prompt: str, *, orchestrator: bool) -> str:
    """Orchestrator: nội dung khối `<message>` cuối (sau `<steps_left>`; Hub có thể nối câu nhắc
    sau khối khi thử lại); Hub ghi khối là chuỗi JSON (plan H1 §6.2) → giải mã, không phải JSON
    thì giữ nguyên. Agent: `prompt` (bỏ khối "Ngữ cảnh trước" nếu runner dựng từ history —
    PY-11)."""
    if not orchestrator:
        return current_message(prompt)
    floor = max(prompt.rfind("</steps_left>"), 0)
    end = prompt.rfind(_CLOSE)
    start = prompt.find(_OPEN, floor, max(end, 0))
    if start < 0 or end < start:
        return prompt
    raw = prompt[start + len(_OPEN) : end].strip()
    try:
        decoded = json.loads(raw)
    except ValueError:
        return raw
    return decoded if isinstance(decoded, str) else raw


def directives(msg: str) -> dict[str, str]:
    return {m.group(1): m.group(2) or "" for m in _DIRECTIVE.finditer(msg)}


def clean(msg: str) -> str:
    return " ".join(_DIRECTIVE.sub(" ", msg).split())


def task_without_delegate(msg: str) -> str:
    """`task` gửi agent: bỏ riêng `#fake:delegate=…`, chỉ thị khác đi tiếp (S1)."""
    return " ".join(_DELEGATE.sub(" ", msg).split())


def seconds(raw: str | None) -> float:
    try:
        return max(0.0, float(raw or 0))
    except ValueError:
        return 0.0


def usage_pair(raw: str) -> tuple[int, int]:
    """`#fake:usage=<in>,<out>` (mặc định 10,20)."""
    try:
        a, b = raw.split(",", 1)
        return max(0, int(a)), max(0, int(b))
    except ValueError:
        return 10, 20


TURNS_MAX = 10


def turns(found: dict[str, str]) -> int:
    """H2b `#fake:turns=<n>` (1–10); vắng / sai → 1 (như H1)."""
    raw = found.get("turns", "")
    return min(TURNS_MAX, max(1, int(raw))) if raw.isdigit() else 1


_ARGS = "#fake:args="
_ASCII_WS = " \t\n\r\f\v"
_WS_SPLIT = re.compile(r"[ \t\n\r\f\v]+")
_TAG = re.compile(r"@[A-Za-z0-9][A-Za-z0-9_-]*")
_STEPS_OPEN, _STEPS_CLOSE = "<steps>", "</steps>"
_AGREE = frozenset({"đồng ý", "agree"})
_HISTORY_OPEN, _HISTORY_CLOSE = "<history>", "</history>"


def tool_args(msg: str) -> dict[str, object] | None:
    """`#fake:args=<json object>` (H2a `plan-runtime` §6): thiếu → `{}`; hỏng / không phải object →
    None. Đọc JSON từ ngay sau dấu `=` (`raw_decode`), nên chuỗi trong JSON được có khoảng trắng."""
    at = msg.find(_ARGS)
    if at < 0:
        return {}
    try:
        value, _ = json.JSONDecoder().raw_decode(msg, at + len(_ARGS))
    except ValueError:
        return None
    return cast(dict[str, object], value) if isinstance(value, dict) else None


def is_agree(text: str) -> bool:
    """= `isAgreeReply` TS (`confirm.rules.ts`): NFC, trim, lower ∈ {"đồng ý", "agree"}."""
    return unicodedata.normalize("NFC", text).strip().lower() in _AGREE


def _block(prompt: str, opening: str, closing: str) -> object:
    """Khối JSON `<tag>…</tag>` đầu tiên của prompt Orchestrator; vắng / hỏng → None."""
    start = prompt.find(opening)
    end = prompt.find(closing, start)
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(prompt[start + len(opening) : end])
    except ValueError:
        return None


def _has_steps(prompt: str) -> bool:
    """TD #47: run đã có kết quả step (khối `<steps>` khác `[]`)."""
    steps = _block(prompt, _STEPS_OPEN, _STEPS_CLOSE)
    return isinstance(steps, list) and len(cast(list[object], steps)) > 0


def _tokens(text: str) -> list[str]:
    return [t for t in _WS_SPLIT.split(text.strip(_ASCII_WS)) if t]


def _is_tag(token: str) -> bool:
    return _TAG.fullmatch(token) is not None


def strip_tags(text: str) -> str:
    """Bỏ các tag `@<key>` đầu tin (cú pháp R01; `@@` là chữ thường)."""
    toks = _tokens(text)
    i = 0
    while i < len(toks) and _is_tag(toks[i]):
        i += 1
    return " ".join(toks[i:])


def tag_delegate(text: str) -> str | None:
    """Tin bắt đầu bằng **đúng một** tag `@<key>` + nội dung → `#fake:delegate=<key> <nội dung>`."""
    toks = _tokens(text)
    if len(toks) < 2 or not _is_tag(toks[0]) or _is_tag(toks[1]):
        return None
    rest = text.strip(_ASCII_WS)[len(toks[0]) :].strip(_ASCII_WS)
    return f"#fake:delegate={toks[0][1:].lower()} {rest}"


def _history_users(prompt: str) -> list[str]:
    """Tin `user` trong khối `<history>` của prompt Orchestrator (JSON, `<` đã escape — plan H1
    §6.2), cũ → mới."""
    items = _block(prompt, _HISTORY_OPEN, _HISTORY_CLOSE)
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in cast(list[object], items):
        if isinstance(item, dict):
            h = cast(dict[str, object], item)
            content = h.get("content")
            if h.get("role") == "user" and isinstance(content, str):
                out.append(content)
    return out


def redelegate_message(prompt: str, msg: str) -> str | None:
    """S01 (H2a AC-H22): tin hiện tại là câu đồng ý, run chưa có kết quả step (`<steps>` `[]`,
    TD #47) và tin user gần nhất trước đó (bỏ các câu đồng ý) bắt đầu `@<key>` (đúng một tag) →
    `#fake:delegate=<key> <phần sau tag>`; có `#fake:delegate=<a>` → trả tin đó (delegate lại `<a>`
    cùng `task`)."""
    if not is_agree(msg) or _has_steps(prompt):
        return None
    for prev in reversed(_history_users(prompt)):
        if is_agree(prev):
            continue
        if (tagged := tag_delegate(prev)) is not None:
            return tagged
        return prev if "delegate" in directives(prev) else None
    return None


def agreed_message(msg: str, history: list[tuple[str, str]]) -> str | None:
    """Agent nhận câu đồng ý không chỉ thị → tin `user` gần nhất trong `history` (cũ → mới) không
    phải câu đồng ý, bỏ tag `@…` đầu — chạy lại như tin đó (gọi lại `#fake:tool`). Khác → None."""
    if directives(msg) or not is_agree(strip_tags(msg)):
        return None
    for role, content in reversed(history):
        if role == "user" and not is_agree(strip_tags(content)):
            return strip_tags(content)
    return None
