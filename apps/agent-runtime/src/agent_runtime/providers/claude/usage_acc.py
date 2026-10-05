"""WRK-FR-17 · R28 · F5 — usage cộng dồn theo message (plan-runtime H2b §5, spike PY-S2 S1).

Nguồn: `StreamEvent` `message_start.message.usage` rồi `message_delta.usage` cùng id (bản sau
**thay** bản trước, không cộng hai lần); `message_id=None` ⇒ message mới. Thuần (không SDK).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from agent_runtime.providers.base import UsageEv

_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
Totals = tuple[int, int, int, int]


def _int(usage: Mapping[str, Any], key: str) -> int:
    value = usage.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


class UsageAcc:
    def __init__(self) -> None:
        self._by_id: dict[str, Totals] = {}
        self._anon: list[Totals] = []
        self._last: Totals = (0, 0, 0, 0)

    def add(
        self, message_id: str | None, usage: Mapping[str, Any] | None, model: str | None
    ) -> UsageEv | None:
        """Ghi usage của message; trả `UsageEv` **cộng dồn** khi tổng đổi, None khi không."""
        if usage is None:
            return None
        row: Totals = (
            _int(usage, _KEYS[0]),
            _int(usage, _KEYS[1]),
            _int(usage, _KEYS[2]),
            _int(usage, _KEYS[3]),
        )
        if message_id is None:
            self._anon.append(row)
        else:
            self._by_id[message_id] = row
        rows = [*self._by_id.values(), *self._anon]
        total: Totals = (
            sum(r[0] for r in rows),
            sum(r[1] for r in rows),
            sum(r[2] for r in rows),
            sum(r[3] for r in rows),
        )
        if total == self._last:
            return None
        self._last = total
        i, o, cr, cw = total
        return UsageEv.model_validate(
            {"in": i, "out": o, "cache_read": cr, "cache_write": cw, "model": model}
        )
