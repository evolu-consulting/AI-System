"""WRK-NFR-04 · RQ1 · File log theo job (plan-runtime §9): `<LOG_DIR>/<ngày>/<job_id>.events.jsonl`
ghi **khung** message của job host (loại, tên tool, token, lỗi) — không text, label, tool result,
`session_id`. Quyền 0600; stderr nằm ở `<job_id>.stderr.log` (runner).
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agent_runtime.providers.base import (
    Fatal,
    Final,
    ProviderEvent,
    RateLimit,
    ToolUse,
    UsageEv,
)


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
    """Một dòng JSON; lỗi ghi file không được làm hỏng job (gọi nơi bắt `OSError`)."""
    line = {"ts": datetime.now(UTC).isoformat(timespec="milliseconds"), **event_envelope(ev)}
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, json.dumps(line, separators=(",", ":")).encode() + b"\n")
    finally:
        os.close(fd)
