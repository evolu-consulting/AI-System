"""WRK-FR-10 · Phân tích `msg` của `fake-cli` (plan-runtime-fake §7): chỉ thị `#fake:*` và khối
`<message>` của Orchestrator (Q-T8: không echo cả prompt). Chỉ đọc tin hiện tại, không đọc history
— trừ H2a S01: tin hiện tại là câu đồng ý → đọc tin user trước đó trong `<history>` để delegate lại.
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


_ARGS = "#fake:args="
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


def _history_users(prompt: str) -> list[str]:
    """Tin `user` trong khối `<history>` của prompt Orchestrator (JSON, `<` đã escape — plan H1
    §6.2), cũ → mới."""
    start = prompt.find(_HISTORY_OPEN)
    end = prompt.find(_HISTORY_CLOSE, start)
    if start < 0 or end < 0:
        return []
    try:
        items: object = json.loads(prompt[start + len(_HISTORY_OPEN) : end])
    except ValueError:
        return []
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
    """S01 (H2a AC-H22): tin hiện tại là câu đồng ý và tin user gần nhất trước đó (bỏ các câu đồng
    ý) có `#fake:delegate=<a>` → trả tin đó để Orchestrator giả delegate lại `<a>` cùng `task`."""
    if not is_agree(msg):
        return None
    for prev in reversed(_history_users(prompt)):
        if is_agree(prev):
            continue
        return prev if "delegate" in directives(prev) else None
    return None
