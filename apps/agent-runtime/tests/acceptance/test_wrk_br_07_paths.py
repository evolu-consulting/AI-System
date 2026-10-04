"""WRK-BR-07 · AC-W05 · H1-R21 · P1: luật thuần `is_path_allowed` (plan-runtime §5.1, §5.4).

Module import trong thân ca (test-plan §1 "Cấm"): stub B0 → `NotImplementedError` (đỏ đúng lý do).
Dữ liệu: cây tạm `home/.claude`, `work/<job>`, `work/<job khác>`, symlink; `forbidden_roots` như
§5.3.
"""

from __future__ import annotations

import importlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

JOB = "c3000000-0000-4000-8000-000000000001"
OTHER = "c3000000-0000-4000-8000-000000000002"


@dataclass(frozen=True)
class Tree:
    home: Path
    work_root: Path
    job: Path
    other: Path

    @property
    def forbidden(self) -> tuple[Path, ...]:
        return (self.home, Path("/mnt"), self.work_root)


@pytest.fixture
def tree(tmp_path: Path) -> Tree:
    home, work_root = tmp_path / "home", tmp_path / "work"
    job, other = work_root / JOB, work_root / OTHER
    for d in (home / ".claude", job / "sub", other):
        d.mkdir(parents=True)
    (home / ".claude" / ".credentials.json").write_text("{}")
    (other / "secret.txt").write_text("x")
    (job / "a.txt").write_text("a")
    os.symlink(home / ".claude" / ".credentials.json", job / "cred-link")
    os.symlink(other / "secret.txt", job / "other-link")
    os.symlink(job / "loop-b", job / "loop-a")
    os.symlink(job / "loop-a", job / "loop-b")
    (work_root / f"{JOB}-x").mkdir()
    return Tree(home, work_root, job, other)


def decide(tree: Tree, raw: str) -> Any:
    paths = importlib.import_module("agent_runtime.sandbox.paths")
    return paths.is_path_allowed(raw, tree.job, tree.forbidden)


DENY: list[tuple[str, str | None]] = [
    ("../x", None),
    ("a/../../x", None),
    ("/etc/passwd", "outside"),
    ("cred-link", "home"),
    ("other-link", "other_job"),
    ("/mnt/c/Windows/win.ini", "mnt"),
    ("", None),
    ("a\0b", None),
    ("loop-a", None),
    ("{work_root}/" + JOB + "-x/f.txt", None),
    ("{home}/.claude/.credentials.json", "home"),
    ("../" + OTHER + "/secret.txt", "other_job"),
]


@pytest.mark.parametrize(("raw", "reason"), DENY)
def test_wrk_br_07_ac_w05_deny(tree: Tree, raw: str, reason: str | None) -> None:
    """AC-W05 · đường dẫn ngoài `work/<job_id>` (sau realpath) bị chặn; nhãn lý do theo §5.1 bước
    5."""
    raw = raw.format(work_root=tree.work_root, home=tree.home)
    got = decide(tree, raw)
    assert got.allowed is False
    if reason is not None:
        assert got.reason == reason


ALLOW = ["a.txt", "{job}/a.txt", ".", "sub/new/file.txt", "sub/../a.txt"]


@pytest.mark.parametrize("raw", ALLOW)
def test_wrk_br_07_ac_w05_allow(tree: Tree, raw: str) -> None:
    """AC-W05 · trong `work/<job_id>` (kể cả file chưa tồn tại) → cho phép, `reason` None."""
    got = decide(tree, raw.format(job=tree.job))
    assert got.allowed is True
    assert got.reason is None


UNSAFE_PATTERNS: list[tuple[str, dict[str, object]]] = [
    ("Glob", {"pattern": r"\.\./\.\./.claude/*"}),
    ("Glob", {"pattern": "[.][.]/[.][.]/.claude/*"}),
    ("Glob", {"pattern": ".?/.?/.claude/*"}),
    ("Glob", {"pattern": "?./x/*"}),
    ("Glob", {"pattern": "{..}/{..}/.claude/*"}),
    ("Glob", {"pattern": "{..,x}/**"}),
    ("Grep", {"pattern": "x", "glob": "[.][.]/**"}),
]


def _policy(tree: Tree, *, tools: frozenset[str], structured_output: bool = False) -> Any:
    hook = importlib.import_module("agent_runtime.sandbox.hook")
    return hook.SandboxPolicy(JOB, tree.job, tree.forbidden, tools, structured_output)


@pytest.mark.parametrize(("tool", "data"), UNSAFE_PATTERNS)
def test_wrk_br_07_ac_w11_glob_escape_patterns_denied(
    tree: Tree, tool: str, data: dict[str, object]
) -> None:
    """AC-W11 · mẫu glob thoát `work/<job>` (escape, lớp ký tự, `?`, brace) → deny `pattern`."""
    hook = importlib.import_module("agent_runtime.sandbox.hook")
    pol = _policy(tree, tools=frozenset({"Glob", "Grep"}))
    got = hook.decide(pol, tool, data)
    assert (got.allowed, got.reason, got.label) == (False, "path_not_allowed", "pattern")


def test_wrk_br_07_structured_output_by_role(tree: Tree) -> None:
    """WRK-BR-07 · `StructuredOutput`: agent có `output_format` được phép; Orchestrator deny."""
    hook = importlib.import_module("agent_runtime.sandbox.hook")
    data = {"status": "done", "text": "/home/x ../y"}
    agent = _policy(tree, tools=frozenset(), structured_output=True)
    orch = _policy(tree, tools=frozenset())
    assert hook.decide(agent, "StructuredOutput", data).allowed is True
    got = hook.decide(orch, "StructuredOutput", data)
    assert (got.allowed, got.reason) == (False, "tool_not_allowed")
