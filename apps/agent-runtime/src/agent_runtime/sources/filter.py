"""P-b · PF-S2 · PB-R07 · C8 · Lọc bí mật (basename mọi độ sâu, thắng allowlist) + glob allowlist
(tương đương `picomatch`) + trần 50 MB / 2 000 file. Hàm thuần — test được, không I/O.

Lọc THẮNG allowlist: path bị loại nếu BẤT KỲ đoạn nào (thư mục/tên) khớp luật bí mật. Mục KHÔNG
`*` khớp đoạn **đúng** (`.git` chỉ khớp `.git`, giữ `.gitignore`/`.github`); mục có `*` khớp glob
(`.env*`, `id_rsa*`, `secrets*`, `credentials*`, `*.pem/key/pfx/p12/keystore`). Không phân biệt hoa.
"""

from __future__ import annotations

import re
from fnmatch import fnmatchcase

MAX_FILES = 2000
MAX_BYTES = 50 * 1024 * 1024

# Mục không `*` ⇒ khớp đoạn đúng (case-insensitive).
_SECRET_EXACT = frozenset({".git", ".ssh", ".aws", ".npmrc", ".netrc"})
# Mục có `*` ⇒ glob trên đoạn (lowercase hai vế).
_SECRET_GLOB = (
    ".env*",
    "id_rsa*",
    "secrets*",
    "credentials*",
    "*.pem",
    "*.key",
    "*.pfx",
    "*.p12",
    "*.keystore",
)


def segment_secret(seg: str) -> bool:
    low = seg.lower()
    if low in _SECRET_EXACT:
        return True
    return any(fnmatchcase(low, pat) for pat in _SECRET_GLOB)


def is_secret(relpath: str) -> bool:
    """True nếu BẤT KỲ đoạn nào của `relpath` là bí mật (PB-R07, mọi độ sâu)."""
    return any(segment_secret(seg) for seg in relpath.split("/") if seg)


def _glob_to_regex(glob: str) -> str:
    out: list[str] = []
    i, n = 0, len(glob)
    while i < n:
        if glob[i : i + 3] == "**/":
            out.append("(?:[^/]+/)*")  # ** + / ⇒ không hoặc nhiều đoạn
            i += 3
        elif glob[i : i + 2] == "**":
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return "^" + "".join(out) + "$"


def _compile(allowlist: tuple[str, ...]) -> list[re.Pattern[str]]:
    return [re.compile(_glob_to_regex(g)) for g in allowlist]


def allowed(relpath: str, patterns: list[re.Pattern[str]]) -> bool:
    """allowlist rỗng ⇒ cả nguồn (patterns rỗng ⇒ True). Ngược lại khớp ≥1 glob."""
    if not patterns:
        return True
    return any(p.match(relpath) for p in patterns)


class Ceiling:
    """Đếm file/byte của các mục GIỮ LẠI (sau allowlist+lọc); vượt ⇒ `TooLarge`."""

    def __init__(self) -> None:
        self.files = 0
        self.bytes = 0

    def add(self, size: int) -> None:
        self.files += 1
        self.bytes += size
        if self.files > MAX_FILES or self.bytes > MAX_BYTES:
            raise TooLarge(self.files, self.bytes)


class TooLarge(Exception):
    def __init__(self, files: int, size: int) -> None:
        super().__init__(f"snapshot over ceiling: {files} files / {size} bytes")
        self.files = files
        self.bytes = size


def compile_allowlist(allowlist: tuple[str, ...] | list[str]) -> list[re.Pattern[str]]:
    return _compile(tuple(allowlist))
