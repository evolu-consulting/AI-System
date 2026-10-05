"""H2c · R16 · R24 — chuẩn bị `work/<job_id>/{attachments,out}` (plan-runtime H2c §3.1).

Mỗi thư mục con cần dùng được làm mới: symlink/file đặt sẵn ⇒ `unlink` (không theo link); thư mục
cũ (lần claim trước của cùng `job_id`, requeue H2b — F11) ⇒ `shutil.rmtree` (3.12: dùng fd, không
theo symlink). Lỗi OS ném lên — người gọi đổi thành `failed attachment` (`why=path`).
Trả `DirId` (dev, ino) của `out/` vừa tạo để `send_outputs` so lại (review H2c v1 #6: `out/` bị
thay bằng symlink/thư mục khác trong lúc chạy ⇒ không gửi; hook `Write` cũng so lại).
"""

import os
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path

ATTACHMENTS_SUBDIR = "attachments"
OUT_SUBDIR = "out"
_DIR_MODE = 0o700


@dataclass(frozen=True)
class DirId:
    """Danh tính thư mục (`st_dev`, `st_ino`) — so lại sau khi provider chạy."""

    dev: int
    ino: int

    @classmethod
    def of(cls, st: os.stat_result) -> "DirId":
        return cls(st.st_dev, st.st_ino)

    def pair(self) -> tuple[int, int]:
        """Dạng gửi process con (`ProviderJob.out_dir_id` → `SandboxPolicy.out_id`)."""
        return (self.dev, self.ino)

    def matches(self, st: os.stat_result) -> bool:
        return (st.st_dev, st.st_ino) == (self.dev, self.ino)


def prepare_job_dirs(work: Path, *, attachments: bool, out: bool) -> DirId | None:
    """`work` 0o700; mỗi thư mục con cần dùng: xoá symlink/file/thư mục cũ rồi `mkdir(0o700)`.
    Trả `DirId` của `out/` (None khi không cần `out/`)."""
    work.mkdir(mode=_DIR_MODE, parents=True, exist_ok=True)
    if attachments:
        _fresh_dir(work / ATTACHMENTS_SUBDIR)
    if not out:
        return None
    _fresh_dir(work / OUT_SUBDIR)
    return DirId.of((work / OUT_SUBDIR).lstat())


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
