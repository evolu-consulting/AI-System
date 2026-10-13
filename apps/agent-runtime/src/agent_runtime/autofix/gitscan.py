"""WRK-FR-29 · HUB-BR-33 · P-c1 · PC-R08 (1)(3) trên bản ghi git (thuần, không I/O): `parse_raw`
(`diff --raw -z`), symlink/gitlink ⇒ `paths` rule `symlink`, quét bí mật theo NỘI DUNG blob
(`scan_blob`; diff nhị phân/base85 hay `.gitattributes` không giấu được dòng thêm).
"""

from __future__ import annotations

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


def scan_blob(path: str, new: bytes, base: bytes | None = None) -> list[Failure]:
    """PC-R08(3) theo NỘI DUNG blob (không theo diff — diff nhị phân/base85 giấu dòng): dòng của
    `new` khớp mẫu bí mật và không có nguyên văn trong `base` ⇒ `secrets` (`line` = số dòng)."""
    old: set[str] = set()
    for data in _variants(base or b""):
        old.update(_blob_lines(data))
    out: list[Failure] = []
    seen: set[int] = set()
    for data in _variants(new):
        for no, line in enumerate(_blob_lines(data), 1):
            if no in seen or line in old:
                continue
            rule = secret_rule(line)
            if rule is not None:
                seen.add(no)
                detail = f"khớp mẫu bí mật `{rule}`"
                out.append(Failure("secrets", path=path[:1024], line=no, rule=rule, detail=detail))
    return out


def unscannable(path: str, size: int) -> Failure:
    detail = f"blob {size} bytes vượt trần quét bí mật"
    return Failure("secrets", path=path[:1024], rule="unscannable", detail=detail)
