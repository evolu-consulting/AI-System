"""WRK-FR-15 · R27 · F4 — phân loại `Final.is_error` của provider (plan-runtime H2b §4,
plan-errors §4).

Thuần; mẫu chữ một nguồn ở `providers/patterns.py` (cha không import SDK). Chỉ xét 300 ký tự đầu.
TC-8 (Gate "F4 giữ mã H1 + `refused`", RV1-P2): `refused` chỉ khi provider báo từ chối thật —
`stop_reason == "refusal"` (Anthropic; `message_delta.delta.stop_reason` / `ResultMessage`) ∧ 0
output; không khớp mẫu, không tín hiệu ⇒ None (`PROVIDER_ERROR` H1).
"""

from __future__ import annotations

from typing import Literal

from agent_runtime.providers.patterns import LOGGED_OUT, REJECTED, classify_text

TEXT_MAX = 300
REFUSAL_STOP = "refusal"
IsErrorKind = Literal["rate", "auth", "refused"]


def classify_is_error(
    text: str | None, output_tokens: int, stop_reason: str | None = None
) -> IsErrorKind | None:
    """`rate` / `auth` theo mẫu (rate trước, bất kể output/tín hiệu); `stop_reason == "refusal"`
    ∧ output 0 ⇒ `refused`; còn lại None."""
    status = classify_text((text or "")[:TEXT_MAX])
    if status == REJECTED:
        return "rate"
    if status == LOGGED_OUT:
        return "auth"
    return "refused" if stop_reason == REFUSAL_STOP and output_tokens == 0 else None
