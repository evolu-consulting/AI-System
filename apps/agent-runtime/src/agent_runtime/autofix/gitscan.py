"""WRK-FR-29 · HUB-BR-33 · P-c1 · PC-R08 (1)(3) trên bản ghi git (thuần, không I/O): `parse_raw`
(`diff --raw -z`), symlink/gitlink ⇒ `paths` rule `symlink`, quét bí mật theo NỘI DUNG blob
(`scan_blob`; diff nhị phân/base85 hay `.gitattributes` không giấu được dòng thêm).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from agent_runtime.autofix.rules import Failure, path_failure, secret_rule

SCAN_BLOB_MAX = 8 * 1024 * 1024  # PC-R08(3): blob lớn hơn ⇒ không quét được ⇒ trượt
SCAN_TOTAL_MAX = 64 * 1024 * 1024


@dataclass(frozen=True)
class RawChange:
    """Một bản ghi `git diff --raw -z --no-renames --no-abbrev`."""

    path: str
    old_mode: str
    new_mode: str
    old_sha: str
    new_sha: str
    status: str


REGULAR_MODES = ("100644", "100755")
_LINK_MODES = {"120000": "symlink", "160000": "gitlink"}


def parse_raw(raw: bytes) -> list[RawChange]:
    """`:<om> <nm> <osha> <nsha> <S>\\0<path>\\0` lặp lại."""
    parts = raw.split(b"\0")
    out: list[RawChange] = []
    for i in range(0, len(parts) - 1, 2):
        head = parts[i].decode("ascii", "replace").lstrip(":").split()
        if len(head) < 5:
            continue
        path = parts[i + 1].decode("utf-8", "replace")
        out.append(RawChange(path, head[0], head[1], head[2], head[3], head[4][:1]))
    return out


def check_link_modes(changes: list[RawChange]) -> list[Failure]:
    """PC-R08(1): symlink (120000) / gitlink (160000) mới hoặc đổi ⇒ `paths` rule `symlink`."""
    out: list[Failure] = []
    for c in changes:
        kind = _LINK_MODES.get(c.new_mode)
        if c.status != "D" and kind is not None:
            out.append(path_failure(c.path, "symlink", f"{kind} mới/đổi không được phép"))
    return out


def _blob_lines(data: bytes) -> list[str]:
    return data.decode("utf-8", "replace").split("\n")


def _variants(data: bytes) -> list[bytes]:
    """Nội dung gốc + bản bỏ NUL (UTF-16/xen `\\0` không giấu được mẫu ASCII)."""
    return [data, data.replace(b"\0", b"")] if b"\0" in data else [data]


_PEM_BEGIN = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
_PEM_END = re.compile(r"-----END [A-Z ]*PRIVATE KEY-----")


def _new_lines(lines: list[str], base: Counter[str]) -> list[bool]:
    """Dòng thứ i là "thêm" khi số lần xuất hiện tới nó trong `new` vượt số lần trong `base`
    (Counter, không phải set: nối khối PEM thật có header trùng khoá mẫu vẫn bị bắt)."""
    used: Counter[str] = Counter()
    out: list[bool] = []
    for line in lines:
        used[line] += 1
        out.append(used[line] > base[line])
    return out


def _pem_body_hits(lines: list[str], base: Counter[str]) -> set[int]:
    """Chỉ số dòng nằm giữa `BEGIN … PRIVATE KEY` và `END …` có thân không có nguyên văn trong
    `base` (thay thân khoá cũ, giữ header/footer) ⇒ cả khối báo `private_key` tại dòng BEGIN."""
    hits: set[int] = set()
    begin: int | None = None
    fresh = False
    for i, line in enumerate(lines):
        if begin is None:
            if _PEM_BEGIN.search(line):
                begin, fresh = i, False
            continue
        if _PEM_END.search(line):
            if fresh:
                hits.add(begin)
            begin = None
        elif line.strip() and base[line] == 0:
            fresh = True
    if begin is not None and fresh:  # khối không đóng vẫn là thân khoá mới
        hits.add(begin)
    return hits


def _scan_lines(path: str, lines: list[str], base: Counter[str]) -> dict[int, Failure]:
    added = _new_lines(lines, base)
    pem = _pem_body_hits(lines, base)
    out: dict[int, Failure] = {}
    for i, line in enumerate(lines):
        rule = "private_key" if i in pem else (secret_rule(line) if added[i] else None)
        if rule is not None:
            detail = f"khớp mẫu bí mật `{rule}`"
            out[i + 1] = Failure("secrets", path=path[:1024], line=i + 1, rule=rule, detail=detail)
    return out


def scan_blob(path: str, new: bytes, base: bytes | None = None) -> list[Failure]:
    """PC-R08(3) theo NỘI DUNG blob (không theo diff — diff nhị phân/base85 giấu dòng): dòng
    "thêm" (đếm theo Counter so với `base`) khớp mẫu bí mật, hoặc khối PEM private key có thân
    mới ⇒ `secrets` (`line` = số dòng)."""
    old: Counter[str] = Counter()
    for data in _variants(base or b""):
        old |= Counter(_blob_lines(data))
    found: dict[int, Failure] = {}
    for data in _variants(new):
        for no, f in _scan_lines(path, _blob_lines(data), old).items():
            found.setdefault(no, f)
    return [found[no] for no in sorted(found)]


def unscannable(path: str, size: int, detail: str | None = None) -> Failure:
    detail = detail or f"blob {size} bytes vượt trần quét bí mật"
    return Failure("secrets", path=path[:1024], rule="unscannable", detail=detail)
