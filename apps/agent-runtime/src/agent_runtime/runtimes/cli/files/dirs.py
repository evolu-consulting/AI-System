"""H2c · R16 · R24 — chuẩn bị `work/<job_id>/{attachments,out}` (plan-runtime H2c §3.1).

Mỗi thư mục con cần dùng được làm mới: symlink/file đặt sẵn ⇒ `unlink` (không theo link); thư mục
cũ (lần claim trước của cùng `job_id`, requeue H2b — F11) ⇒ `shutil.rmtree` (3.12: dùng fd, không
theo symlink). Lỗi OS ném lên — người gọi đổi thành `failed attachment` (`why=path`).
"""

import os
import shutil
import stat
from pathlib import Path

ATTACHMENTS_SUBDIR = "attachments"
OUT_SUBDIR = "out"
_DIR_MODE = 0o700


def prepare_job_dirs(work: Path, *, attachments: bool, out: bool) -> None:
    """`work` 0o700; mỗi thư mục con cần dùng: xoá symlink/file/thư mục cũ rồi `mkdir(0o700)`."""
    work.mkdir(mode=_DIR_MODE, parents=True, exist_ok=True)
    for sub, need in ((ATTACHMENTS_SUBDIR, attachments), (OUT_SUBDIR, out)):
        if need:
            _fresh_dir(work / sub)


def _fresh_dir(path: Path) -> None:
    try:
        st = path.lstat()
    except FileNotFoundError:
        pass
    else:
        if stat.S_ISDIR(st.st_mode):
            shutil.rmtree(path)
        else:
            path.unlink()
    path.mkdir(mode=_DIR_MODE)
    if not stat.S_ISDIR(path.lstat().st_mode):  # bị thay giữa chừng
        raise NotADirectoryError(path.name)
    os.chmod(path, _DIR_MODE)  # bỏ ảnh hưởng umask
