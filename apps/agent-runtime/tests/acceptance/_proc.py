"""WRK-FR-01 · WRK-NFR-04 · Runtime thật trong test P: `python -m agent_runtime` (test-plan §2).

Env tường minh (Q-T4: `HOME` = thư mục tạm có `.claude/.credentials.json` mồi; không bao giờ đụng
`~/.claude` thật).
Thêm biến "secret" giả để P18 kiểm process con không kế thừa (WRK-BR-02).
"""

from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from tests.acceptance._rt import APP, cmdline, redis_url, rt_db_url

CANARY = "CANARY-CRED-7f3a91"
SECRET_ENV = {
    "ANTHROPIC_API_KEY": "sk-qc-not-real",
    "JWT_PRIVATE_KEY": "qc-not-real",
    "HUB_INTERNAL_TOKEN": "qc-not-real",
}


@dataclass(frozen=True)
class Sandbox:
    root: Path
    home: Path
    work: Path
    logs: Path

    @classmethod
    def make(cls, root: Path) -> Sandbox:
        """`HOME` tạm + file mồi chứa canary (`~/.claude/.credentials.json`, `~/.codex/x`)."""
        home, work, logs = root / "home", root / "work", root / "logs"
        for d in (home / ".claude", home / ".codex", work, logs):
            d.mkdir(parents=True, exist_ok=True)
        (home / ".claude" / ".credentials.json").write_text(f'{{"token":"{CANARY}"}}')
        (home / ".codex" / "x").write_text(CANARY)
        return cls(root, home, work, logs)


class Runtime:
    """Một process Runtime cha; `start_new_session` để dọn được cả group khi teardown."""

    def __init__(self, box: Sandbox, worker: str, env: dict[str, str]) -> None:
        self.box, self.worker, self.expected_exit = box, worker, False
        self.out = box.root / f"rt-{worker}.stdout"
        self.err = box.root / f"rt-{worker}.stderr"
        bin_dir = str(Path(sys.executable).parent)
        base = {
            "PATH": f"{bin_dir}:/usr/local/bin:/usr/bin:/bin",
            "LANG": "C.UTF-8",
            "HOME": str(box.home),
            "APP_ENV": "test",
            "AGENT_RT_DATABASE_URL": rt_db_url(),
            "REDIS_URL": redis_url(),
            "AGENT_RT_WORKER_ID": worker,
            "AGENT_RT_PROVIDERS": "fake-cli",
            "AGENT_RT_WORK_DIR": str(box.work),
            "AGENT_RT_LOG_DIR": str(box.logs),
            "AGENT_RT_CLEANUP_S": "1",
            **SECRET_ENV,
        }
        if venv := os.environ.get("VIRTUAL_ENV"):
            base["VIRTUAL_ENV"] = venv
        with self.out.open("ab") as so, self.err.open("ab") as se:
            self.proc = subprocess.Popen(
                [sys.executable, "-m", "agent_runtime"],
                cwd=APP,
                env={**base, **env},
                stdout=so,
                stderr=se,
                start_new_session=True,
            )

    def dead(self) -> str | None:
        code = self.proc.poll()
        if code is None or self.expected_exit:
            return None
        tail = self.err.read_text(errors="replace")[-600:]
        return f"Runtime {self.worker} thoát sớm code={code}; stderr: {tail}"

    def stdout(self) -> str:
        return self.out.read_text(errors="replace")

    def signal(self, sig: signal.Signals) -> None:
        self.expected_exit = True
        os.kill(self.proc.pid, sig)

    async def wait_exit(self, limit_s: float) -> int | None:
        """Chờ exit theo điều kiện; quá giờ → None."""
        self.expected_exit = True
        deadline = time.monotonic() + limit_s
        while self.proc.poll() is None and time.monotonic() < deadline:  # noqa: ASYNC110
            await asyncio.sleep(0.05)
        return self.proc.poll()

    def kill_all(self) -> None:
        self.expected_exit = True
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGKILL)
        self.proc.wait(timeout=5)


def kill_job_hosts(job_ids: list[str]) -> None:
    """Teardown: giết group của process có `--job-id=<id>` của ca (không chạm process khác)."""
    if not job_ids:
        return
    for p in Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        line = cmdline(int(p.name))
        if any(j in line for j in job_ids):
            try:
                os.killpg(os.getpgid(int(p.name)), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass


def kill_groups(pgids: list[int]) -> None:
    for g in pgids:
        try:
            os.killpg(g, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
