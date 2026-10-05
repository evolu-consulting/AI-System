"""WRK-FR-15 · H1-R24 · R27 · Mẫu chữ lỗi provider — một nguồn cho con (`claude/mapping.py`) và
cha (`runtimes/cli/refusal.py`, F4) (plan-runtime H2b §4).

Thuần (không import SDK) để cha phân loại `is_error` mà không kéo `claude_agent_sdk`.
"""

from __future__ import annotations

import re

RATE_RE = re.compile(r"usage limit|rate limit|\b429\b", re.IGNORECASE)
AUTH_RE = re.compile(r"/login|not logged in|\b401\b|invalid api key|oauth token", re.IGNORECASE)
REJECTED = "rejected"
LOGGED_OUT = "logged_out"


def classify_text(*texts: str | None) -> str | None:
    """`rejected` (hết quota) | `logged_out` | None — rate trước auth (H1 §3.3)."""
    joined = "\n".join(t for t in texts if t)
    if RATE_RE.search(joined):
        return REJECTED
    if AUTH_RE.search(joined):
        return LOGGED_OUT
    return None
