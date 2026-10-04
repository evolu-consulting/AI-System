"""WRK-FR-14 · AC-W04 · H1-R23 · Session giả của `fake-cli` (plan-runtime-fake §7, plan-runtime §6).

File `<AGENT_RT_WORK_DIR>/.fake-sessions/<session_id>.json` (`{"word": …}`), ghi nguyên tử (tmp +
rename). Gốc work = cha của `work/<job_id>` (con không đọc env cha), như `state.py`.
Chỉ dùng khi `payload.use_session`: `remember=<w>` lưu chữ, `recall` đọc lại (chỉ khi resume đúng
id), `lost-session` hoặc id không có file → lỗi resume giống CLI ("No conversation found").
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import cast
from uuid import uuid4

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


def _file(work_dir: str, session_id: str) -> Path:
    return Path(work_dir).parent / ".fake-sessions" / f"{session_id}.json"


def load(work_dir: str, session_id: str) -> dict[str, str] | None:
    """None = không có session (id lạ, file mất/hỏng)."""
    if not _SAFE_ID.match(session_id):
        return None
    try:
        raw = json.loads(_file(work_dir, session_id).read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    items = cast("dict[object, object]", raw).items()
    return {str(k): str(v) for k, v in items}


def save(work_dir: str, session_id: str, data: dict[str, str]) -> None:
    path = _file(work_dir, session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(path)


def new_id() -> str:
    return f"fake-{uuid4().hex}"
