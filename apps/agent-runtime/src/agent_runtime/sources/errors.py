"""P-b · PF-S2 · Mã lỗi resolve (= `ResolveResult.code`, contract `hub.py`)."""

from __future__ import annotations

from typing import Literal

SourceErrorCode = Literal[
    "SOURCE_UNRESOLVABLE",
    "SOURCE_TOO_LARGE",
    "SOURCE_HOST_NOT_ALLOWED",
    "SOURCE_FORBIDDEN_KIND",
]


class SourceError(Exception):
    """Resolve/snapshot thất bại — mang mã lỗi cho `ResolveResult`."""

    def __init__(self, code: SourceErrorCode, message: str = "") -> None:
        super().__init__(message or code)
        self.code: SourceErrorCode = code
        self.message = message or code
