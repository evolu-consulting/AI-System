"""HUB-BR-33 · WRK-BR-08 · WRK-NFR-02 · ADR-0011 #1–#5 · P-c1 · bộ CONTAINER THẬT
(`bun run test:pc:sandbox`,
tasks R4) · test-plan P-c §3 S01–S08.

Tách riêng: tên `sandbox_check.py` KHÔNG khớp `python_files` ⇒ `uv run pytest`
thường không gom; chạy bằng
đường dẫn tường minh `uv run pytest tests/acceptance/pc/sandbox_check.py` (cần Docker/Podman + ảnh
`RUNTIME_SANDBOX_IMAGE` từ `bun run sandbox:image`). Thiếu CLI/ảnh ⇒ ĐỎ với thông
báo rõ (không skip).
argv dựng bằng `rules.container_args` (plan §5.2) — kiểm hành vi thật của cờ, không chỉ chuỗi.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest

from tests.acceptance.pc._pc import JOB, rules, spec

ENGINE = os.environ.get("RUNTIME_SANDBOX", "docker")
IMAGE = os.environ.get("RUNTIME_SANDBOX_IMAGE", "")
NAME = f"aif-{JOB}"
CLEAN_ENV = {
    "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    "HOME": os.environ.get("HOME", "/tmp"),
}


def _cli(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 — mảng đối số, không shell
        [ENGINE, *args],
        capture_output=True,
        text=True,
        timeout=120,
        env=env or CLEAN_ENV,
        check=False,
    )


def _exec(cmd: str) -> subprocess.CompletedProcess[str]:
    return _cli("exec", "--user", "1000:1000", "-w", "/workspace", NAME, "sh", "-c", cmd)


@pytest.fixture
def box(tmp_path: Path) -> Iterator[Path]:
    assert shutil.which(ENGINE), f"qc: cần CLI {ENGINE} (RUNTIME_SANDBOX)"
    assert IMAGE, "qc: cần RUNTIME_SANDBOX_IMAGE (bun run sandbox:image)"
    ws = tmp_path / "workspace"
    ws.mkdir()
    ws.chmod(0o777)
    _cli("rm", "-f", NAME)
    argv: list[str] = rules().container_args(
        spec(image=IMAGE, host_workspace=str(ws), engine=ENGINE), phase="agent"
    )
    env = {**CLEAN_ENV, "GITHUB_TOKEN": "qc-ghtoken-Zx9Pq7Lm"}
    started = _cli(*argv, env=env)
    assert started.returncode == 0, started.stderr
    try:
        yield ws
    finally:
        _cli("rm", "-f", NAME)


def test_hub_br_33_s01_no_network(box: Path) -> None:
    """HUB-BR-33 · ADR-0011 #3 · S01 · `--network none`: chỉ `lo`; kết nối ra ngoài thất bại."""
    nets = _exec("ls /sys/class/net").stdout.split()
    assert nets == ["lo"]
    probe = "import socket; socket.create_connection(('1.1.1.1', 53), timeout=3)"
    assert _exec(f'python3 -c "{probe}"').returncode != 0


def test_hub_br_32_s02_rootfs_readonly_only_workspace_writable(box: Path) -> None:
    """HUB-BR-32 · S02 · rootfs read-only; chỉ /workspace (về đúng thư mục host) và
    /tmp ghi được."""
    assert _exec("touch /etc/qc-x").returncode != 0
    assert _exec("touch /usr/qc-x").returncode != 0
    assert _exec("touch /tmp/qc-x").returncode == 0
    assert _exec("echo hi > /workspace/qc.txt").returncode == 0
    assert (box / "qc.txt").read_text().strip() == "hi"


def test_hub_br_33_s03_non_root_no_caps(box: Path) -> None:
    """HUB-BR-33 · S03 · uid 1000; CapEff = 0; no-new-privileges (NoNewPrivs 1)."""
    assert _exec("id -u").stdout.strip() == "1000"
    status = _exec("cat /proc/self/status").stdout
    assert "CapEff:\t0000000000000000" in status
    assert "NoNewPrivs:\t1" in status


def test_wrk_nfr_02_s04_cgroup_limits(box: Path) -> None:
    """WRK-NFR-02 · ADR-0011 #3 · S04 · cgroup memory.max = 2 GiB, pids.max = 512."""
    assert _exec("cat /sys/fs/cgroup/memory.max").stdout.strip() == str(2048 * 1024 * 1024)
    assert _exec("cat /sys/fs/cgroup/pids.max").stdout.strip() == "512"


def test_hub_br_33_s05_no_host_secret_env(box: Path) -> None:
    """HUB-BR-33 · spec §6 "Lộ secret" · S05 · biến host (token) KHÔNG vào container."""
    out = _exec("env").stdout
    assert "Zx9Pq7Lm" not in out
    assert "GITHUB_TOKEN" not in out


def test_hub_br_32_s06_no_host_paths(box: Path) -> None:
    """HUB-BR-32 · S06 · chỉ mount /workspace: không thấy sources/, git/, socket engine."""
    mounts = _exec("cat /proc/mounts").stdout
    assert " /workspace " in mounts
    for bad in ("sources", "/git ", "docker.sock", "podman.sock"):
        assert bad not in mounts


def test_hub_br_33_s07_remove_by_label(box: Path) -> None:
    """HUB-BR-33 · plan §5.1 sweeper · S07 · tìm được theo nhãn `ai.job=<job>`, `rm
    -f` xong không còn."""
    ps = _cli("ps", "-a", "--filter", f"label=ai.job={JOB}", "--format", "{{.Names}}")
    assert NAME in ps.stdout
    _cli("rm", "-f", NAME)
    ps2 = _cli("ps", "-a", "--filter", f"label=ai.job={JOB}", "--format", "{{.Names}}")
    assert ps2.stdout.strip() == ""


def test_hub_br_33_s08_pids_limit_enforced(box: Path) -> None:
    """HUB-BR-33 · S08 · fork bomb bị trần pids (lệnh kết thúc, container còn sống)."""
    bomb = "i=0; while [ $i -lt 600 ]; do sleep 30 & i=$((i+1)); done 2>/dev/null; echo done"
    _exec(bomb)
    n = int(_exec("ls /proc | grep -c '^[0-9]'").stdout.strip() or "0")
    assert n <= 512
    assert _exec("true").returncode == 0
