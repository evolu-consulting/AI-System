"""WRK-BR-07 · AC-W05 · H1-R21 · Luật thuần đường dẫn sandbox (plan-runtime §5.1).

Chỉ cho phép đường dẫn mà sau `realpath` nằm trong `work/<job_id>/`. Không I/O ngoài
`os.path.realpath` (và `lstat` nó gọi). Symlink vòng → deny (spec-decisions QW-P ghi chú 1).
Mọi lỗi bất ngờ → deny (fail-closed). `forbidden_roots` = `(Settings.home, /mnt, WORK_DIR)` chỉ
dùng để gắn nhãn lý do cho log; quyết định allow chỉ dựa vào `work_dir`.
"""

import errno
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

DenyReason = Literal["empty", "home", "mnt", "other_job", "outside", "loop", "invalid"]

_MNT = "/mnt"


@dataclass(frozen=True)
class PathDecision:
    allowed: bool
    reason: DenyReason | None = None


_ALLOW = PathDecision(allowed=True)


def _deny(reason: DenyReason) -> PathDecision:
    return PathDecision(allowed=False, reason=reason)


def _under(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def _strict_error(resolved: str) -> DenyReason | None:
    """`realpath(strict=True)` trên kết quả đã giải: vòng symlink / lỗi quyền → nhãn deny;
    thành phần chưa tồn tại thì bỏ qua (file mới trong work vẫn được ghi)."""
    try:
        os.path.realpath(resolved, strict=True)
    except (FileNotFoundError, NotADirectoryError):
        return None
    except OSError as exc:
        return "loop" if exc.errno == errno.ELOOP else "invalid"
    return None


def _label(resolved: str, base: str, forbidden_roots: tuple[Path, ...]) -> DenyReason:
    if _under(resolved, os.path.dirname(base)):
        return "other_job"
    if _under(resolved, _MNT):
        return "mnt"
    if any(_under(resolved, os.path.realpath(root)) for root in forbidden_roots):
        return "home"
    return "outside"


def _decide(raw: str, work_dir: Path, forbidden_roots: tuple[Path, ...]) -> PathDecision:
    if not work_dir.is_absolute():
        return _deny("invalid")
    if raw.startswith("~"):
        # Tool CLI có thể tự mở rộng `~` thành HOME → coi như home, không nối vào work.
        return _deny("home")
    base = os.path.realpath(work_dir)
    joined = raw if os.path.isabs(raw) else os.path.join(work_dir, raw)
    resolved = os.path.realpath(joined)
    strict_err = _strict_error(resolved)
    if strict_err is not None:
        return _deny(strict_err)
    if _under(resolved, base):
        return _ALLOW
    return _deny(_label(resolved, base, forbidden_roots))


def is_path_allowed(raw: str, work_dir: Path, forbidden_roots: tuple[Path, ...]) -> PathDecision:
    """AC-W05 · allow ⇔ `realpath(raw)` == `realpath(work_dir)` hoặc nằm dưới nó."""
    if not raw or "\0" in raw:
        return _deny("empty")
    try:
        return _decide(raw, work_dir, forbidden_roots)
    except Exception:  # noqa: BLE001 — fail-closed: lỗi bất ngờ nào cũng là deny
        return _deny("invalid")
