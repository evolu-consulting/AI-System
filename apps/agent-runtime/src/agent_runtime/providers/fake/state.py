"""WRK-FR-10 · readiness #23 · Bộ đếm `#fake:badjson=<n>` theo `run_id`: file
`<AGENT_RT_WORK_DIR>/.fake-state/<run_id>.json` (`{"badjson": k}`), ghi nguyên tử (tmp + rename).
Mỗi job một process con nên không giữ trong bộ nhớ. Con không đọc env cha: thư mục gốc work =
cha của `work/<job_id>`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


def _file(work_dir: str, run_id: str) -> Path:
    return Path(work_dir).parent / ".fake-state" / f"{run_id}.json"


def bump_badjson(work_dir: str, run_id: str, limit: int) -> bool:
    """True nếu lần này còn phải trả JSON hỏng (đếm < `limit`) — và tăng bộ đếm."""
    path = _file(work_dir, run_id)
    try:
        count = int(json.loads(path.read_text()).get("badjson", 0))
    except (OSError, ValueError, AttributeError):
        count = 0
    if count >= limit:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"badjson": count + 1}))
    tmp.replace(path)
    return True
