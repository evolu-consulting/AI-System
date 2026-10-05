"""WRK-FR-03 · R20 · Gom và cắt `delta` (plan-runtime H2b §3.3) — thuần, đồng hồ tiêm được.

`split_utf16` đếm đơn vị UTF-16, không cắt giữa code point (zod/pydantic đếm code point — BC6 ⇒
cắt UTF-16 chặt hơn cần thiết, luôn hợp lệ). `DeltaBuffer` xả khi ≥ `flush_chars` ký tự hoặc
≥ `flush_ms` từ lần xả trước (mốc ban đầu = lúc tạo); `DeltaPump` (PY-03) lo hẹn giờ + XADD.
"""

from __future__ import annotations

import time
from collections.abc import Callable

MAX_UNITS = 4000


def split_utf16(text: str, max_units: int = MAX_UNITS) -> list[str]:
    """Cắt thành các phần ≤ `max_units` đơn vị UTF-16 (`""` ⇒ `[]`)."""
    if len(text) * 2 <= max_units:
        return [text] if text else []
    parts: list[str] = []
    start = units = 0
    for i, c in enumerate(text):
        w = 2 if ord(c) > 0xFFFF else 1
        if units + w > max_units:
            parts.append(text[start:i])
            start, units = i, 0
        units += w
    if start < len(text):
        parts.append(text[start:])
    return parts


class DeltaBuffer:
    def __init__(
        self,
        flush_chars: int = 200,
        flush_ms: int = 100,
        max_units: int = MAX_UNITS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._chars = flush_chars
        self._wait = flush_ms / 1000
        self._max = max_units
        self._clock = clock
        self._parts: list[str] = []
        self._len = 0
        self._last = clock()

    def add(self, text: str) -> list[str]:
        """Thêm chữ; trả các chunk phải XADD ngay (đủ ký tự hoặc tới hạn), ngược lại `[]`."""
        if text:
            self._parts.append(text)
            self._len += len(text)
        if self._len >= self._chars or self.due():
            return self.take()
        return []

    @property
    def pending(self) -> bool:
        """Còn chữ chờ xả."""
        return self._len > 0

    def due(self) -> bool:
        """Có chữ chờ và đã tới hạn theo thời gian."""
        return self._len > 0 and self.wait_s() <= 0

    def wait_s(self) -> float:
        """Giây còn lại tới hạn xả theo thời gian (≤ 0 khi đã tới hạn)."""
        return self._wait - (self._clock() - self._last)

    def take(self) -> list[str]:
        """Xả hết bộ đệm (chunk ≤ `max_units`); rỗng ⇒ `[]`."""
        if not self._parts:
            return []
        text = "".join(self._parts)
        self._parts, self._len = [], 0
        self._last = self._clock()
        return split_utf16(text, self._max)
