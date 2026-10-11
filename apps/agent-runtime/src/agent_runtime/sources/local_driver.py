"""P-b · PF-S2 · PB-R03 · C7 · local_path: realpath dưới `HUB_SOURCE_LOCAL_ROOTS`, chống thoát
symlink; bỏ symlink/hardlink (PB-R07). Hàm thuần fs — không DB/HTTP.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from fnmatch import fnmatchcase
from pathlib import Path

from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.filter import allowed, compile_allowlist, is_secret, segment_secret

# PB-R07 · B3 · thư mục sinh ra / nặng không bao giờ là nguồn: cắt nhánh NGAY trong `os.walk` trước
# khi đụng trần (repo lớn có `node_modules`/`.venv` dưới `apps/**` mà glob `**` vẫn khớp — allowlist
# một mình không cắt được). `.git`/`.ssh`… đã là bí mật ở `filter.segment_secret`.
_PRUNE_DIRS = frozenset({"node_modules", ".venv", "venv", ".git", ".data", "dist", ".turbo"})


def resolve_root(cfg: SourceConfig, path: str) -> Path:
    """realpath của `path` phải nằm trong gốc cho phép và là thư mục; không ⇒ UNRESOLVABLE."""
    if not cfg.local_roots:
        raise SourceError("SOURCE_UNRESOLVABLE", "không cấu hình gốc local")
    rp = Path(os.path.realpath(path))
    roots = [Path(os.path.realpath(str(r))) for r in cfg.local_roots]
    if not any(rp == r or r in rp.parents for r in roots):
        raise SourceError("SOURCE_UNRESOLVABLE", "đường dẫn ngoài gốc cho phép")
    if not rp.is_dir() or os.path.islink(path):
        # `path` chính nó là symlink (LP-04 swap) ⇒ realpath thoát gốc đã bắt ở trên; phòng hờ.
        if not rp.is_dir():
            raise SourceError("SOURCE_UNRESOLVABLE", "không phải thư mục")
    return rp


def walk_files(root: Path, allowlist: list[str] | None = None) -> Iterator[tuple[str, Path, int]]:
    """(relpath POSIX, abspath, size) cho mỗi file THƯỜNG (không symlink, nlink==1) GIỮ LẠI sau lọc.

    B3: cắt nhánh TRONG `os.walk` (`dirnames[:]`) các thư mục symlink/bí mật/`_PRUNE_DIRS` VÀ các
    nhánh không thể dẫn tới mục allowlist nào (prefix không khớp) — và áp `is_secret`/`allowed` cho
    file NGAY lúc duyệt, TRƯỚC khi gọi phía dùng đụng trần 50 MB/2 000. Nhờ vậy repo lớn + allowlist
    hẹp chỉ duyệt phần cho phép (không quét `node_modules`/`.git`). allowlist rỗng/None ⇒ cả cây
    (trừ prune/bí mật)."""
    globs = [g for g in (allowlist or []) if g]
    seg_lists = [g.split("/") for g in globs]
    patterns = compile_allowlist(globs)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        reldir = Path(dirpath).relative_to(root).as_posix()
        reldir = "" if reldir == "." else reldir
        dirnames[:] = [d for d in dirnames if _descend(dirpath, reldir, d, seg_lists)]
        for name in filenames:
            full = Path(dirpath, name)
            rel = (f"{reldir}/{name}" if reldir else name)
            if is_secret(rel) or not allowed(rel, patterns):
                continue
            try:
                st = full.lstat()
            except OSError:
                continue
            if os.path.islink(full) or not _is_regular(st.st_mode) or st.st_nlink > 1:
                continue
            yield rel, full, st.st_size


def _descend(dirpath: str, reldir: str, name: str, seg_lists: list[list[str]]) -> bool:
    """Có nên đi vào thư mục con `name`? Không nếu: bí mật, symlink, thuộc `_PRUNE_DIRS`, hoặc
    (có allowlist) không nhánh nào của allowlist có thể dẫn qua thư mục này."""
    if segment_secret(name) or name in _PRUNE_DIRS:
        return False
    if os.path.islink(os.path.join(dirpath, name)):
        return False
    if not seg_lists:
        return True
    segs = (f"{reldir}/{name}" if reldir else name).split("/")
    return any(_prefix_ok(segs, gs) for gs in seg_lists)


def _prefix_ok(dir_segs: list[str], glob_segs: list[str]) -> bool:
    """`dir_segs` có thể là TIỀN TỐ của một path khớp `glob_segs` không? (`**` khớp 0+ đoạn.)
    Nếu còn đoạn thư mục nhưng glob đã cạn ⇒ file sẽ sâu hơn glob cho phép ⇒ False."""
    seen: set[tuple[int, int]] = set()
    stack = [(0, 0)]
    while stack:
        i, j = stack.pop()
        if i == len(dir_segs):
            return True  # hết đoạn thư mục, glob còn chỗ cho file sâu hơn
        if j == len(glob_segs) or (i, j) in seen:
            continue
        seen.add((i, j))
        if glob_segs[j] == "**":
            stack.append((i, j + 1))  # `**` khớp 0 đoạn
            stack.append((i + 1, j))  # `**` khớp đoạn hiện tại, giữ nguyên `**`
        elif fnmatchcase(dir_segs[i].lower(), glob_segs[j].lower()):
            stack.append((i + 1, j + 1))
    return False


def _is_regular(mode: int) -> bool:
    import stat

    return stat.S_ISREG(mode)
