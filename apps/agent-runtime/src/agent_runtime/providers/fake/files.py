"""H2c · WRK-FR-11 · WRK-FR-18 · R19 · R24 — chỉ thị file của `fake-cli` (plan-runtime H2c §6).

`#fake:files`: dòng `<name>:<sha256>` của file thường trong `work/<job_id>/attachments/` (sắp
theo tên, code point), vắng/rỗng ⇒ `(no files)`. `#fake:out=<a>[,<b>…]` ghi thẳng `out/<tên>`
(giả lập kết quả `Write`, không qua hook — kiểm đường Runtime → Hub): nội dung `fake output
<tên>\\n` hoặc `#fake:out-size=<n>` byte `a`; tên có `/`, `\\` ⇒ bỏ; ≤ 10 tên.
`#fake:out-link=<tên>` ⇒ symlink `out/<tên>` → `/etc/hostname`. `#fake:write=<path>` (qua hook
thật ở `provider.py`) ghi `fake write\\n` vào `path` tương đối `work/<job_id>` (`write_file`).
`out/` vắng (job không phải agent — R24) ⇒ `#fake:out*` không làm gì.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

ATTACHMENTS_DIR = "attachments"
OUT_DIR = "out"
NO_FILES = "(no files)"
OUT_NAMES_MAX = 10
OUT_SIZE_MAX = 20_971_521  # = ATTACH_MAX_BYTES + 1 (kiểm `too_large`)
LINK_TARGET = "/etc/hostname"
WRITE_TEXT = "fake write\n"
_CHUNK = 1_048_576


def files_text(work_dir: str) -> str:
    """`#fake:files`: `<name>:<sha256 hex>` mỗi file thường (không theo symlink), nối `\\n`."""
    root = Path(work_dir, ATTACHMENTS_DIR)
    try:
        with os.scandir(root) as it:
            names = sorted(d.name for d in it if d.is_file(follow_symlinks=False))
    except OSError:
        return NO_FILES
    lines = [f"{n}:{_sha256(root / n)}" for n in names]
    return "\n".join(lines) if lines else NO_FILES


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def out_names(raw: str) -> list[str]:
    """Tên của `#fake:out` (bỏ rỗng, có `/`/`\\`, `.`/`..`), ≤ 10."""
    names = [n for n in raw.split(",") if n and n not in (".", "..") and not _has_sep(n)]
    return names[:OUT_NAMES_MAX]


def _has_sep(name: str) -> bool:
    return "/" in name or "\\" in name


def _size(raw: str | None) -> int | None:
    if raw is None or not raw.isdigit():
        return None
    return min(int(raw), OUT_SIZE_MAX)


def write_outputs(work_dir: str, found: dict[str, str]) -> None:
    """`#fake:out`, `#fake:out-size`, `#fake:out-link` — trước kết quả."""
    out = Path(work_dir, OUT_DIR)
    if not out.is_dir() or out.is_symlink():
        return
    size = _size(found.get("out-size"))
    for name in out_names(found.get("out", "")):
        body = b"a" * size if size is not None else f"fake output {name}\n".encode()
        (out / name).write_bytes(body)
    link = found.get("out-link", "")
    if link and not _has_sep(link) and link not in (".", ".."):
        (out / link).symlink_to(LINK_TARGET)


def write_file(work_dir: str, raw: str) -> None:
    """`#fake:write` sau khi hook cho phép: ghi `fake write\\n` vào `raw` (tương đối work)."""
    Path(work_dir, raw).write_text(WRITE_TEXT, encoding="utf-8")
