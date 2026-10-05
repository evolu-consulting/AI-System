"""H2c · R16 · R24 · F11 — `prepare_job_dirs` (plan-runtime H2c §3.1)."""

import os
import stat
from pathlib import Path

from agent_runtime.runtimes.cli.files.dirs import prepare_job_dirs


def _mode(p: Path) -> int:
    return stat.S_IMODE(p.lstat().st_mode)


def test_wrk_fr_11_creates_only_needed_dirs_0700(tmp_path: Path) -> None:
    work = tmp_path / "w" / "job"
    prepare_job_dirs(work, attachments=True, out=False)
    assert (work / "attachments").is_dir() and _mode(work / "attachments") == 0o700
    assert not (work / "out").exists()
    prepare_job_dirs(work, attachments=False, out=True)
    assert _mode(work / "out") == 0o700


def test_wrk_fr_11_requeue_refreshes_dirs(tmp_path: Path) -> None:
    work = tmp_path / "job"
    (work / "attachments" / "sub").mkdir(parents=True)
    (work / "attachments" / "old.txt").write_text("x")
    (work / "out").mkdir()
    (work / "out" / "old.md").write_text("x")
    prepare_job_dirs(work, attachments=True, out=True)
    assert list((work / "attachments").iterdir()) == []
    assert list((work / "out").iterdir()) == []


def test_wrk_br_07_preplaced_symlink_and_file_replaced(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep").write_text("keep")
    work = tmp_path / "job"
    work.mkdir()
    os.symlink(outside, work / "attachments")
    (work / "out").write_text("file")
    prepare_job_dirs(work, attachments=True, out=True)
    for sub in ("attachments", "out"):
        assert stat.S_ISDIR((work / sub).lstat().st_mode)
    assert (outside / "keep").read_text() == "keep"


def test_wrk_br_07_returns_out_dir_id(tmp_path: Path) -> None:
    """Review H2c v1 #6: trả `DirId` của `out/` vừa tạo; không `out/` ⇒ None."""
    work = tmp_path / "job"
    assert prepare_job_dirs(work, attachments=True, out=False) is None
    got = prepare_job_dirs(work, attachments=False, out=True)
    st = (work / "out").lstat()
    assert got is not None and got.matches(st) and got.pair() == (st.st_dev, st.st_ino)
