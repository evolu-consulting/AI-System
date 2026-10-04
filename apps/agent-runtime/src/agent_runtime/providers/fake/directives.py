"""WRK-FR-10 · Phân tích `msg` của `fake-cli` (plan-runtime-fake §7): chỉ thị `#fake:*` và khối
`<message>` của Orchestrator (Q-T8: không echo cả prompt). Chỉ đọc tin hiện tại, không đọc history.
"""

from __future__ import annotations

import json
import re

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
