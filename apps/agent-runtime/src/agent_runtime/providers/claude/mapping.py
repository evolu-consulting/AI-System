"""WRK-FR-10 · WRK-FR-15 · H1-R24 · H1-R26 · Map message/lỗi SDK → `ProviderEvent`
(plan-runtime §3.2, §3.3, §4).

Progress chỉ nhãn tĩnh theo tên tool (không đường dẫn/nội dung). Lỗi không lặp lại stderr/nội dung.
Spike PY-02 đã xác minh chữ chưa đăng nhập (`Not logged in · Please run /login`), mất session
(`ResultError`), `RateLimitEvent.status`; chữ hết quota thật + giờ reset trong text **chưa đo**
(chưa parse → `resets_at=None` ⇒ cooldown mặc định 30 phút ở PY-12). `model_usage` có nhiều khoá
(model phụ haiku đứng đầu) ⇒ model `usage` = model init, không có thì khoá `costUSD` lớn nhất (S9).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from typing import Any, cast

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeSDKError,
    CLIJSONDecodeError,
    CLINotFoundError,
    ProcessError,
    RateLimitEvent,
    ResultError,
    ResultMessage,
    SystemMessage,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from agent_runtime.providers import patterns
from agent_runtime.providers.base import (
    Confirm,
    Fatal,
    Final,
    Progress,
    ProviderEvent,
    RateLimit,
    ToolUse,
    UsageEv,
    parse_confirmation,
)
from agent_runtime.providers.claude.mcp import MCP_SERVER, TOOL_PREFIX
from agent_runtime.providers.patterns import LOGGED_OUT, REJECTED, classify_text

# H2b §4: mẫu chữ một nguồn ở `providers/patterns.py` (cha dùng lại cho F4) — giữ tên cũ.
RATE_RE = patterns.RATE_RE
AUTH_RE = patterns.AUTH_RE

TOOL_LABELS = {
    "Read": "Đang đọc tệp",
    "Grep": "Đang tìm trong tệp",
    "Glob": "Đang liệt kê tệp",
}
DEFAULT_TOOL_LABEL = "Đang dùng công cụ"
MCP_TOOL_LABEL = "Đang gọi công cụ"  # H2a §4.4: tool `mcp__hub__<k>` — nhãn tĩnh (H1-R26)
_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def init_session_id(msg: SystemMessage) -> str | None:
    """`SystemMessage(subtype="init")` — Python để `session_id` trong `data` (§3.2)."""
    if msg.subtype != "init":
        return None
    sid = msg.data.get("session_id")
    return sid if isinstance(sid, str) and sid else None


def init_model(msg: SystemMessage) -> str | None:
    """`SystemMessage(init).data["model"]` — model chính của lượt (S9)."""
    if msg.subtype != "init":
        return None
    model = msg.data.get("model")
    return model if isinstance(model, str) and model else None


def _cost(entry: object) -> float:
    cost = entry.get("costUSD") if isinstance(entry, dict) else None  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return float(cost) if isinstance(cost, int | float) else 0.0  # pyright: ignore[reportUnknownArgumentType]


def main_model(model_usage: dict[str, Any] | None) -> str | None:
    """Khoá `model_usage` có `costUSD` lớn nhất (không lấy khoá đầu — thường là haiku phụ)."""
    if not model_usage:
        return None
    return max(model_usage, key=lambda k: _cost(model_usage[k]))


def tool_events(msg: AssistantMessage) -> Iterator[ProviderEvent]:
    for block in msg.content:
        if isinstance(block, ToolUseBlock):
            yield ToolUse(name=block.name[:200] or "?")
            yield Progress(label=tool_label(block.name))


def mcp_tool_ids(msg: AssistantMessage) -> Iterator[str]:
    """Id `ToolUseBlock` của tool MCP Hub (`mcp__hub__*`) — để nhận ra kết quả của nó (§5 #2)."""
    for block in msg.content:
        if isinstance(block, ToolUseBlock) and block.name.startswith(TOOL_PREFIX):
            yield block.id


def confirm_events(msg: UserMessage, mcp_ids: set[str]) -> Iterator[Confirm]:
    """HUB-FR-95 · §5 #2: `ToolResultBlock(is_error)` của tool `mcp__hub__*` có khối đầu JSON
    `CONFIRMATION_REQUIRED` đúng hình → `Confirm` (content str khi lỗi — spike S2 — hoặc list)."""
    if isinstance(msg.content, str):
        return
    for block in msg.content:
        if not isinstance(block, ToolResultBlock) or not block.is_error:
            continue
        if block.tool_use_id not in mcp_ids or block.content is None:
            continue
        got = parse_confirmation(block.content)
        if got is not None:
            yield got


def tool_label(name: str) -> str:
    if name.startswith(TOOL_PREFIX):
        return MCP_TOOL_LABEL
    return TOOL_LABELS.get(name, DEFAULT_TOOL_LABEL)


def mcp_statuses(msg: SystemMessage) -> list[str]:
    """§4.5 · trạng thái server `hub` ở init (`data["mcp_servers"][].status`); chỉ `status`, không
    lấy `error`/config (S4: `get_mcp_status()` có header nguyên văn — không dùng)."""
    if msg.subtype != "init":
        return []
    servers: object = msg.data.get("mcp_servers")
    if not isinstance(servers, list):
        return []
    out: list[str] = []
    for item in cast(list[object], servers):
        if isinstance(item, dict):
            entry = cast(dict[str, object], item)
            status = entry.get("status")
            if entry.get("name") == MCP_SERVER:
                out.append(status[:40] if isinstance(status, str) else "?")
    return out


def rate_limit_event(msg: RateLimitEvent) -> RateLimit | None:
    """Chỉ `status=="rejected"` → sự kiện; `allowed_warning` để người gọi log."""
    info = msg.rate_limit_info
    if info.status != REJECTED:
        return None
    return RateLimit(status=REJECTED, resets_at=info.resets_at)


def result_signal(msg: ResultMessage) -> RateLimit | None:
    if not msg.is_error:
        return None
    if msg.api_error_status == 429:
        return RateLimit(status=REJECTED)
    if msg.api_error_status == 401:
        return RateLimit(status=LOGGED_OUT)
    status = classify_text(msg.result, *(msg.errors or []))
    return RateLimit(status=status) if status else None


def _int(usage: dict[str, Any], key: str) -> int:
    value = usage.get(key)
    return value if isinstance(value, int) and value >= 0 else 0


def usage_event(msg: ResultMessage, init: str | None = None) -> UsageEv | None:
    """Usage tổng của Result (thay phần cộng dồn từ `StreamEvent`); Result không mang `usage` ⇒
    None — không phát `UsageEv{0,…}` đè phần đã tích (review 1 F5)."""
    usage = msg.usage
    if not usage:
        return None
    model = init or main_model(msg.model_usage)
    return UsageEv.model_validate(
        {
            "in": _int(usage, "input_tokens"),
            "out": _int(usage, "output_tokens"),
            "cache_read": _int(usage, "cache_read_input_tokens"),
            "cache_write": _int(usage, "cache_creation_input_tokens"),
            "model": model,
        }
    )


def _json_object(text: str | None) -> dict[str, Any] | None:
    """JSON cuối trong `result` (bóc ```json); không phải object → None."""
    if not text:
        return None
    fenced = _FENCE.findall(text)
    candidates = [*reversed(fenced), text.strip()]
    for raw in candidates:
        try:
            value = json.loads(raw)
        except ValueError:
            continue
        if isinstance(value, dict):
            return cast(dict[str, Any], value)
    return None


def agent_structured(msg: ResultMessage) -> dict[str, Any] | None:
    """`structured_output` (hoặc JSON trong `result`); bỏ khoá `null` của schema phẳng."""
    raw: object = msg.structured_output
    obj = cast(dict[str, Any], raw) if isinstance(raw, dict) else _json_object(msg.result)
    if obj is None:
        return None
    return {k: v for k, v in obj.items() if v is not None}


def final_event(msg: ResultMessage, kind: str) -> Final:
    errors = [e[:500] for e in (msg.errors or [])][:10]
    common: dict[str, Any] = {
        "is_error": msg.is_error,
        "subtype": msg.subtype,
        "api_error_status": msg.api_error_status,
        "errors": errors,
    }
    if kind == "agent_result":
        structured = None if msg.is_error else agent_structured(msg)
        raw = msg.result if structured is None else None
        return Final(kind="agent_result", structured=structured, raw_json=raw, **common)
    return Final(kind="text", text=msg.result, **common)


def _process_error(err: ProcessError) -> list[ProviderEvent]:
    if isinstance(err, ResultError):
        status = str(err.api_error_status) if err.api_error_status is not None else None
        texts = [status, err.result, *err.errors]
    else:
        texts = [err.stderr]
    signal = classify_text(*texts)
    if signal == REJECTED:
        return [RateLimit(status=REJECTED), _exhausted("quota", "claude rate limited")]
    if signal == LOGGED_OUT:
        return [
            RateLimit(status=LOGGED_OUT),
            _exhausted("provider_unavailable", "claude not logged in"),
        ]
    code = err.exit_code if err.exit_code is not None else "?"
    return [Fatal(code="UPSTREAM_ERROR", msg=f"claude cli exited {code}", reason="crash")]


def _exhausted(reason: str, msg: str) -> Fatal:
    return Fatal(code="ALL_PROVIDERS_EXHAUSTED", msg=msg, reason=reason)


def error_events(err: ClaudeSDKError) -> list[ProviderEvent]:
    """Lỗi SDK → sự kiện; không kèm stderr/dòng JSON (có thể chứa đường dẫn/nội dung)."""
    if isinstance(err, CLINotFoundError):
        return [
            Fatal(code="UPSTREAM_ERROR", msg="claude cli not found", reason="provider_unavailable")
        ]
    if isinstance(err, ProcessError):
        return _process_error(err)
    if isinstance(err, CLIJSONDecodeError):
        return [Fatal(code="UPSTREAM_ERROR", msg="claude cli sent invalid json", reason="crash")]
    return [Fatal(code="UPSTREAM_ERROR", msg=f"claude sdk error: {type(err).__name__}")]
