"""WRK-FR-06 · WRK-FR-07 · HUB-FR-80 · H2a-R11 · R13 · R15 · R17 — luật thuần `workflow.async`.

Thử lại (`plan-runtime-dify` §3.4), ánh xạ lỗi Dify (`plan-errors` §2), dòng usage `billing=dify`
(`-dify` §3.7), che app-key (`plan-runtime` §3.3 #4). Không I/O, không import ngoài stdlib.
"""

from __future__ import annotations

import base64
import re
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from urllib.parse import quote, quote_plus

ErrKind = Literal[
    "connect", "http_5xx", "read", "http_4xx", "sse_error", "finished_failed", "empty"
]
# connect: ConnectError/ConnectTimeout (chưa gửi) · read: ReadError/RemoteProtocolError/ReadTimeout
# · empty: kết quả rỗng. `Settings.dify_backoff_s` (AGENT_RT_DIFY_BACKOFF_S) ghi đè mặc định.
BACKOFF: tuple[float, ...] = (2.0, 8.0)
MAX_RETRIES = 2  # tối đa 3 lần gọi trong một lần claim (1 + 2 retry)
MASK = "***"
DETAIL_MAX = 300

FailCode = Literal["UPSTREAM_ERROR", "NOT_CONFIGURED"]
FailReason = Literal["upstream", "invalid_output"]
AppType = Literal["workflow", "chat", "agent"]

_RETRYABLE: frozenset[str] = frozenset({"connect", "http_5xx", "read"})
_NOT_CONFIGURED_STATUS = frozenset({401, 403, 404})


@dataclass(frozen=True)
class RetryFlags:
    first_seen: bool  # đã nhận sự kiện SSE ≠ `ping` trong lần gọi này
    side_effect: bool  # `payload.side_effect` (Q6)


def retry_delay(
    err_kind: ErrKind, attempt: int, flags: RetryFlags, backoff: tuple[float, ...] = BACKOFF
) -> float | None:
    """Giây chờ trước lần gọi kế, None = không thử lại. `attempt` = số lần đã gọi (1-based)."""
    if flags.first_seen or err_kind not in _RETRYABLE:
        return None
    if flags.side_effect and err_kind != "connect":
        return None  # Q6: request có thể đã chạy ở Dify
    if attempt < 1 or attempt > min(MAX_RETRIES, len(backoff)):
        return None
    return float(backoff[attempt - 1])


def map_failure(err_kind: ErrKind, http_status: int | None) -> tuple[FailCode, FailReason]:
    """R11 · `(err_kind, http_status)` → `(code, reason)` của `job.failed` (`plan-errors` §2)."""
    if err_kind == "http_4xx" and http_status in _NOT_CONFIGURED_STATUS:
        return "NOT_CONFIGURED", "upstream"
    if err_kind == "empty":
        return "UPSTREAM_ERROR", "invalid_output"
    return "UPSTREAM_ERROR", "upstream"


@dataclass(frozen=True)
class UsageRow:
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    latency_ms: int
    feature_id: str | None


def _count(value: object) -> int:
    """Số token không âm từ int/chuỗi số; khác (thiếu, rác, bool, âm) → 0 (không bịa)."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0


def _price(value: object) -> Decimal:
    """`total_price` (chuỗi/số) → Decimal ≥ 0 hữu hạn; khác → 0. Không đi qua float."""
    if isinstance(value, bool) or not isinstance(value, str | int | float):
        return Decimal(0)
    try:
        d = Decimal(str(value).strip())
    except InvalidOperation:
        return Decimal(0)
    return d if d.is_finite() and d >= 0 else Decimal(0)


def usage_row(
    app_type: AppType, usage: Mapping[str, Any] | None, latency_ms: int, feature_id: str | None
) -> UsageRow:
    """R15 · `usage` = `workflow_finished.data` (workflow) | `message_end.metadata.usage`
    (chat/agent) | None. workflow: `total_tokens`/0; chat/agent: prompt/completion;
    `cost_usd` chỉ khi `currency == "USD"`."""
    u: Mapping[str, Any] = usage or {}
    if app_type == "workflow":
        tokens_in, tokens_out = _count(u.get("total_tokens")), 0
    else:
        tokens_in, tokens_out = _count(u.get("prompt_tokens")), _count(u.get("completion_tokens"))
    cost = _price(u.get("total_price")) if u.get("currency") == "USD" else Decimal(0)
    return UsageRow(tokens_in, tokens_out, cost, latency_ms, feature_id)


def _key_forms(key: str) -> list[str]:
    """Các dạng mã hoá của key (thô, base64 ± padding, base64url ± padding, hex thường/hoa,
    percent-encoded `%XX` hoa/thường, `+` cho dấu cách — review 1 C7), dài trước."""
    raw = key.encode("utf-8")
    b64 = base64.b64encode(raw).decode("ascii")
    b64u = base64.urlsafe_b64encode(raw).decode("ascii")
    hx = raw.hex()
    forms = {key, b64, b64.rstrip("="), b64u, b64u.rstrip("="), hx, hx.upper()}
    for pct in (quote(key, safe=""), quote_plus(key, safe="")):
        forms |= {pct, _PCT.sub(lambda m: m.group(0).lower(), pct)}
    return sorted((f for f in forms if f), key=len, reverse=True)


_PCT = re.compile(r"%[0-9A-F]{2}")


def mask(text: str, key: str, max_len: int = DETAIL_MAX) -> str:
    """R17 · che key (thô/base64/hex → `***`) **trước**, rồi cắt ≤ `max_len`."""
    out = text
    if key:
        for form in _key_forms(key):
            out = out.replace(form, MASK)
    return out[: max(max_len, 0)]
