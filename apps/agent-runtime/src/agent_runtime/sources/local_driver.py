"""P-b · PF-S2 · PB-R03 · C7 · local_path: realpath dưới `HUB_SOURCE_LOCAL_ROOTS`, chống thoát
symlink; bỏ symlink/hardlink (PB-R07). Hàm thuần fs — không DB/HTTP.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.filter import segment_secret


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


def walk_files(root: Path) -> Iterator[tuple[str, Path, int]]:
    """(relpath POSIX, abspath, size) cho mỗi file THƯỜNG (không symlink, nlink==1); bỏ qua thư mục
    symlink và thư mục bí mật (không descend)."""
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [
            d
            for d in dirnames
            if not segment_secret(d) and not os.path.islink(os.path.join(dirpath, d))
        ]
        for name in filenames:
            full = Path(dirpath, name)
            try:
                st = full.lstat()
            except OSError:
                continue
            if os.path.islink(full) or not _is_regular(st.st_mode) or st.st_nlink > 1:
                continue
            rel = full.relative_to(root).as_posix()
            yield rel, full, st.st_size


def _is_regular(mode: int) -> bool:
    import stat

    return stat.S_ISREG(mode)
