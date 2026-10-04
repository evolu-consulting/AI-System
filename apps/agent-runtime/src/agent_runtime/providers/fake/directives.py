"""WRK-FR-10 · Phân tích `msg` của `fake-cli` (plan-runtime-fake §7): chỉ thị `#fake:*` và khối
`<message>` của Orchestrator (Q-T8: không echo cả prompt). Chỉ đọc tin hiện tại, không đọc history.
"""

from __future__ import annotations

import re

_DIRECTIVE = re.compile(r"#fake:([a-z_-]+)(?:=(\S+))?")
_DELEGATE = re.compile(r"#fake:delegate=\S*")
_OPEN, _CLOSE = "<message>", "</message>"


def message_of(prompt: str, *, orchestrator: bool) -> str:
    """Orchestrator: nội dung khối `<message>` cuối (sau `<steps_left>`); agent: `prompt`."""
    if not orchestrator:
        return prompt
    body = prompt.rstrip()
    floor = body.rfind("</steps_left>")
    start = body.find(_OPEN, max(floor, 0))
    if start < 0 or not body.endswith(_CLOSE):
        return prompt
    return body[start + len(_OPEN) : -len(_CLOSE)]


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
