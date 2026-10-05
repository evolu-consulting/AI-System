"""WRK-NFR-04 · RQ1 · File log theo job (plan-runtime §9): `<LOG_DIR>/<ngày>/<job_id>.events.jsonl`
ghi **khung** message của job host (loại, tên tool, token, lỗi) — không text, label, tool result,
`session_id`. Quyền 0600; stderr nằm ở `<job_id>.stderr.log` (runner). Ngoại lệ H2b F4
(plan-runtime §4): chữ result của `is_error` (đã che, ≤ 300) — `append_is_error`.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agent_runtime.log import redact_text
from agent_runtime.providers.base import (
    Fatal,
    Final,
    ProviderEvent,
    RateLimit,
    ToolUse,
    UsageEv,
)


def stderr_log_path(log_dir: Path, job_id: str) -> Path:
    return log_dir / datetime.now(UTC).strftime("%Y-%m-%d") / f"{job_id}.stderr.log"


def events_log_path(log_dir: Path, job_id: str) -> Path:
    return log_dir / datetime.now(UTC).strftime("%Y-%m-%d") / f"{job_id}.events.jsonl"


def event_envelope(ev: ProviderEvent) -> dict[str, Any]:
    out: dict[str, Any] = {"type": ev.type}
    if isinstance(ev, ToolUse):
        out["tool_name"] = ev.name
    elif isinstance(ev, UsageEv):
        out["usage"] = {
            "in": ev.input,
            "out": ev.output,
            "cache_read": ev.cache_read,
            "cache_write": ev.cache_write,
        }
    elif isinstance(ev, Final):
        out |= {"subtype": ev.subtype, "is_error": ev.is_error, "errors": len(ev.errors)}
    elif isinstance(ev, Fatal):
        out |= {"code": ev.code, "reason": ev.reason}
    elif isinstance(ev, RateLimit):
        out["status"] = ev.status
    return out


def append_envelope(path: Path, ev: ProviderEvent) -> None:
    """Một dòng JSON; lỗi ghi file không được làm hỏng job (gọi nơi bắt `LOG_WRITE_ERRORS`)."""
    _append(path, event_envelope(ev))


IS_ERROR_TEXT_MAX = 300
LOG_WRITE_ERRORS = (OSError, UnicodeError)  # người gọi bắt: lỗi ghi log không làm hỏng job


def append_is_error(path: Path, kind: str | None, text: str) -> None:
    """F4: phân loại + chữ result đã che rồi mới cắt ≤ 300 ký tự (bí mật vắt qua mốc cắt vẫn bị
    che — review 1 #6); chỉ log job, không sự kiện/DB."""
    _append(path, {"type": "is_error", "kind": kind, "text": redact_text(text)[:IS_ERROR_TEXT_MAX]})


def log_line(body: dict[str, Any]) -> bytes:
    """Một dòng JSONL (review 1 #7): U+2028/U+2029 escape (trình đọc theo dòng không tách nhầm);
    surrogate lẻ ⇒ `?` thay vì ném `UnicodeEncodeError`."""
    line = {"ts": datetime.now(UTC).isoformat(timespec="milliseconds"), **body}
    data = json.dumps(line, separators=(",", ":"), ensure_ascii=False)
    data = data.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return data.encode("utf-8", errors="replace") + b"\n"


def _append(path: Path, body: dict[str, Any]) -> None:
    data = log_line(body)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)
