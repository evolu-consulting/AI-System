"""H2c · R16 · R24 — chuẩn bị `work/<job_id>/{attachments,out}` (plan-runtime H2c §3.1).

Stub PY-00: thân ở PY-02.
"""

from pathlib import Path


def prepare_job_dirs(work: Path, *, attachments: bool, out: bool) -> None:
    """`work` 0o700; mỗi thư mục con cần dùng: xoá symlink/file/thư mục cũ rồi `mkdir(0o700)`."""
    raise NotImplementedError
