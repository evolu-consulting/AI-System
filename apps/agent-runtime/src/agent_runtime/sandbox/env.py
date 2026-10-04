"""WRK-BR-02 · WRK-FR-26 · Env tường minh của job host (plan-runtime §5.3).

Danh sách trắng duy nhất — không kế thừa `os.environ`; không `AGENT_RT_*`, `REDIS_URL`,
`DATABASE_URL*`, `ANTHROPIC_API_KEY`, `JWT_*`, `HUB_*`. Biến tắt auto-update/telemetry/báo lỗi/
traffic không thiết yếu của CLI (S5): tên đã xác minh trong binary CLI 2.1.286 (spike PY-02 #10),
tác dụng chưa đo.
"""

from __future__ import annotations

from pathlib import Path

BASE_PATH = "/usr/local/bin:/usr/bin:/bin"
TMP_SUBDIR = ".tmp"
CLI_QUIET_ENV: dict[str, str] = {
    "DISABLE_AUTOUPDATER": "1",
    "DISABLE_TELEMETRY": "1",
    "DISABLE_ERROR_REPORTING": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
}


def job_host_env(
    home: Path, job_work: Path, app_env: str, python_env: dict[str, str] | None = None
) -> dict[str, str]:
    """`python_env`: chỉ `VIRTUAL_ENV`/`PYTHONPATH` của venv cha (khoá khác bị bỏ)."""
    env = {
        "HOME": str(home),
        "PATH": BASE_PATH,
        "LANG": "C.UTF-8",
        "TMPDIR": str(job_work / TMP_SUBDIR),
        "APP_ENV": app_env,
        **CLI_QUIET_ENV,
    }
    for key in ("VIRTUAL_ENV", "PYTHONPATH"):
        value = (python_env or {}).get(key)
        if value:
            env[key] = value
    return env


def forbidden_roots(home: Path, work_root: Path) -> tuple[Path, ...]:
    """§5.1 bước 5: HOME, `/mnt`, `AGENT_RT_WORK_DIR` (job khác) — truyền qua `ChildRequest`."""
    return (home, Path("/mnt"), work_root)
