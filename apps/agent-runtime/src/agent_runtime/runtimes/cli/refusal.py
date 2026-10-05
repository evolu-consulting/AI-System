"""WRK-FR-15 · R27 · F4 — phân loại `Final.is_error` của provider (plan-runtime H2b §4,
plan-errors §4).

Thuần; mẫu chữ một nguồn ở `providers/patterns.py` (cha không import SDK). Chỉ xét 300 ký tự đầu.
"""

from __future__ import annotations

from typing import Literal

from agent_runtime.providers.patterns import LOGGED_OUT, REJECTED, classify_text

TEXT_MAX = 300
IsErrorKind = Literal["rate", "auth", "refused"]


def classify_is_error(text: str | None, output_tokens: int) -> IsErrorKind | None:
    """`rate` / `auth` theo mẫu (rate trước, bất kể output); không khớp ∧ output 0 ⇒ `refused`."""
    status = classify_text((text or "")[:TEXT_MAX])
    if status == REJECTED:
        return "rate"
    if status == LOGGED_OUT:
        return "auth"
    return "refused" if output_tokens == 0 else None
