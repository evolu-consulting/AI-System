"""CR-114 hub-warm-runtime · WRK-FR-23 — orphans.py nhận host dựng sẵn (`--warm`) theo cwd
`work/<job_id>` (không có `--job-id` trong cmdline); spawn lạnh giữ nguyên."""

from __future__ import annotations

from pathlib import Path

from agent_runtime.queue.orphans import is_job_host, read_cwd

MOD = "python -m agent_runtime.runtimes.cli.child"
JOB = "0b6f1c1e-0000-4000-8000-000000000001"


def test_cr114_orphan_check_warm_by_cwd() -> None:
    assert is_job_host(f"{MOD} --warm", JOB, f"/w/{JOB}")
    assert is_job_host(f"{MOD} --warm", JOB, f"/w/{JOB} (deleted)")
    assert not is_job_host(f"{MOD} --warm", JOB, "/w/.warm")  # chưa gắn job
    assert not is_job_host(f"{MOD} --warm", "other", f"/w/{JOB}")
    assert not is_job_host("sleep --warm", JOB, f"/w/{JOB}")
    assert not is_job_host(f"{MOD} --warm", "", "/w/")
    assert is_job_host(f"{MOD} --job-id={JOB}", JOB)  # spawn lạnh giữ nguyên
    assert not is_job_host(f"{MOD} --job-id=x", JOB, f"/w/{JOB}")  # cwd chỉ áp cho `--warm`


def test_cr114_read_cwd(tmp_path: Path) -> None:
    (tmp_path / "42").mkdir()
    (tmp_path / "42" / "cwd").symlink_to(tmp_path / JOB)
    assert Path(read_cwd(42, tmp_path)).name == JOB
    assert read_cwd(43, tmp_path) == ""
