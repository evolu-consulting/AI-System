"""HUB-BR-33 · WRK-FR-29 · P-c1 · helper test Runtime (test-plan P-c §2 "Runtime"). Không chứa test.

Nạp `agent_runtime.autofix.rules` trong THÂN ca (`importlib`, như
`test_files_rules.py`): module chưa có ⇒
mỗi ca đỏ riêng ở `ModuleNotFoundError`, không làm hỏng collect cả file.

Kiểu chưa khai báo đủ trong plan §4 (`SandboxSpec`, `DiffStats`, `Limits`, `Failure`) — mặc định qc
(test-plan §6 G1–G3, backend-lead theo hoặc ghi Tranh chấp):
- `SandboxSpec(job_id, image, host_workspace, engine="docker", cpus=2.0, memory_mb=2048, pids=512,
  tmp_mb=256)` (kwargs).
- `DiffStats(files, insertions, deletions, bytes)`; `Limits()` mặc định = 2 MiB / 300 file / 4 GiB.
- `Failure` có thuộc tính hoặc khoá `check`, `path`, `line`, `rule`, `detail` (như contract
  `AutofixFailure`).
"""

from __future__ import annotations

import importlib
from types import ModuleType
from typing import Any

JOB = "c0c00000-0000-4000-8000-0000000000a1"
IMAGE = "ai-sandbox:qc"
HOST_WS = "/srv/work/c0c00000-0000-4000-8000-0000000000a1/workspace/app-repo"


def rules() -> ModuleType:
    return importlib.import_module("agent_runtime.autofix.rules")


def spec(**over: Any) -> Any:
    kw: dict[str, Any] = {
        "job_id": JOB,
        "image": IMAGE,
        "host_workspace": HOST_WS,
        "engine": "docker",
        "cpus": 2.0,
        "memory_mb": 2048,
        "pids": 512,
        "tmp_mb": 256,
    }
    kw.update(over)
    return rules().SandboxSpec(**kw)


def fget(f: Any, key: str) -> Any:
    """Trường của `Failure` (dataclass/pydantic hay dict)."""
    if isinstance(f, dict):
        return f.get(key)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return getattr(f, key, None)


def checks(fs: list[Any]) -> list[str]:
    return [str(fget(f, "check")) for f in fs]


def flag_value(argv: list[str], flag: str) -> list[str]:
    """Mọi giá trị đi sau `flag` (dạng `--x v`) hoặc gắn liền (`--x=v`)."""
    out: list[str] = []
    for i, a in enumerate(argv):
        if a == flag and i + 1 < len(argv):
            out.append(argv[i + 1])
        elif a.startswith(flag + "="):
            out.append(a.split("=", 1)[1])
    return out
