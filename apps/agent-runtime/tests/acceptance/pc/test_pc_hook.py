"""HUB-BR-32 · HUB-BR-33 · PC-R07 · P-c1 · hook chặn tool GỐC dưới `work/<job>/workspace/` và `git/`
(plan §5.7, spec §6 "Đua symlink với tool gốc") · test-plan P-c §3 P20–P23.

Mọi thao tác workspace chỉ qua `ws_*` trong container; Read/Grep/Glob/Write gốc vào
workspace/git ⇒ deny
nhãn `workspace`. Đối chứng: `sources/` (P-b) vẫn đọc được. Hộp đen trên `sandbox.hook`
(`SandboxPolicy`, `decide` — như `test_wrk_br_07_paths.py`). fs tạm, không DB/HTTP.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any

import pytest

JOB = "c0c00000-0000-4000-8000-0000000000b1"
TOOLS = frozenset({"Read", "Grep", "Glob"})


def _job(tmp_path: Path) -> Path:
    job = tmp_path / "work" / JOB
    for d in ("workspace/app-repo/src", "git", "sources/docs", "out"):
        (job / d).mkdir(parents=True, exist_ok=True)
    (job / "workspace/app-repo/src/a.ts").write_text("x")
    (job / "git/config").write_text("[core]")
    (job / "sources/docs/rule.md").write_text("r")
    return job


def _decide(tmp_path: Path, tool: str, data: dict[str, object]) -> Any:
    hook = importlib.import_module("agent_runtime.sandbox.hook")
    job = _job(tmp_path)
    pol = hook.SandboxPolicy(JOB, job, (tmp_path / "home", tmp_path / "work"), TOOLS, False)
    return hook.decide(pol, tool, {k: str(v).replace("{job}", str(job)) for k, v in data.items()})


@pytest.mark.parametrize(
    ("tool", "data"),
    [
        ("Read", {"file_path": "{job}/workspace/app-repo/src/a.ts"}),
        ("Read", {"file_path": "workspace/app-repo/src/a.ts"}),
        ("Read", {"file_path": "{job}/git/config"}),
        ("Grep", {"pattern": "x", "path": "workspace"}),
        ("Glob", {"pattern": "workspace/**"}),
        ("Glob", {"pattern": "*", "path": "{job}/git"}),
    ],
)
def test_hub_br_33_pc_r07_p20_native_tools_denied_in_workspace(
    tmp_path: Path, tool: str, data: dict[str, object]
) -> None:
    """HUB-BR-33 · PC-R07 · P20 · tool gốc dưới workspace/ hoặc git/ ⇒ deny, nhãn `workspace`."""
    got = _decide(tmp_path, tool, data)
    assert (got.allowed, got.label) == (False, "workspace")


def test_hub_br_32_p21_write_workspace_denied(tmp_path: Path) -> None:
    """HUB-BR-32 · P21 · Write/Edit gốc vào workspace ⇒ deny (dù vì tool không được
    cấp hay nhãn)."""
    for tool in ("Write", "Edit"):
        got = _decide(
            tmp_path, tool, {"file_path": "{job}/workspace/app-repo/src/a.ts", "content": "y"}
        )
        assert got.allowed is False


def test_pb_r11_p22_sources_still_readable(tmp_path: Path) -> None:
    """PB-R11 · P22 · đối chứng (P-b không đổi): Read `sources/<key>/…` vẫn được."""
    got = _decide(tmp_path, "Read", {"file_path": "{job}/sources/docs/rule.md"})
    assert got.allowed is True


def test_hub_br_33_p23_symlink_from_out_into_workspace_denied(tmp_path: Path) -> None:
    """HUB-BR-33 · spec §6 "Đua symlink" · P23 · symlink trong `out/` trỏ vào
    workspace ⇒ Read deny."""
    hook = importlib.import_module("agent_runtime.sandbox.hook")
    job = _job(tmp_path)
    (job / "out" / "link.ts").symlink_to(job / "workspace/app-repo/src/a.ts")
    pol = hook.SandboxPolicy(JOB, job, (tmp_path / "home", tmp_path / "work"), TOOLS, False)
    got = hook.decide(pol, "Read", {"file_path": str(job / "out" / "link.ts")})
    assert got.allowed is False
