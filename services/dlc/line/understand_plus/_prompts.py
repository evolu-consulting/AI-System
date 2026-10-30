"""Prompt parts: a prompt file may hold several parts, each starting with a line
`=== PART <name> ===`. Text before the first marker is shared and prefixed to every part."""

from __future__ import annotations

import re
from typing import Dict

from ..understand._common import load_prompt

_MARK = re.compile(r"^=== PART ([A-Za-z0-9_\-]+) ===\s*$", re.M)


def parts(name: str) -> Dict[str, str]:
    text = load_prompt(name)
    marks = list(_MARK.finditer(text))
    if not marks:
        return {"": text}
    head = text[:marks[0].start()].strip()
    out = {}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = text[m.end():end].strip()
        out[m.group(1)] = (head + "\n\n" + body).strip() if head else body
    return out


def load_part(name: str, part: str) -> str:
    p = parts(name)
    return p.get(part) or p.get("") or "\n\n".join(p.values())
