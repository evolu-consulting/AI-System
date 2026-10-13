"""WRK-FR-29 · PC-R08/R09 · P-c1 · test đơn vị `autofix/check.run_checks` (cần `git`)."""

from __future__ import annotations

from pathlib import Path

from agent_runtime.autofix import check as c
from agent_runtime.autofix import workspace as w
from agent_runtime.autofix.rules import Limits

BRANCH = "ai/0d6c3a51-8f0e-4b8a-9d3e-1c2b3a4d5e6f/fix-bug"
AKIA = "AKIA" + "ABCDEFGHIJKLMNOP"


def _ws(tmp: Path) -> w.Workspace:
    snap = tmp / "snap"
    (snap / "src").mkdir(parents=True)
    (snap / "src" / "a.ts").write_text("a\n")
    (snap / "docs").mkdir()
    (snap / "docs" / "r.md").write_text("r\n")
    return w.prepare(tmp / "job", snap, "app", None, branch=BRANCH)


def test_wrk_fr_29_pc_r09_no_changes(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    r = c.run_checks(ws, [], Limits())
    assert (r.status, r.failures, r.diff, r.head_sha) == ("no_changes", [], "", ws.base_sha)


def test_wrk_fr_29_ok_diff(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_text("b\n")
    r = c.run_checks(ws, ["src/**"], Limits())
    assert r.status == "ok"
    assert r.diff is not None and "+b" in r.diff
    assert r.stats is not None and r.stats.files == 1
    assert r.head_sha != ws.base_sha


def test_wrk_fr_29_paths_first_then_stop(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "docs" / "r.md").write_text(f"{AKIA}\n")
    r = c.run_checks(ws, ["src/**"], Limits())
    assert r.status == "check_failed"
    assert [(f.check, f.path, f.rule) for f in r.failures] == [
        ("paths", "docs/r.md", "not_allowed")
    ]
    assert r.diff is None


def test_wrk_fr_29_forbidden_name_beats_allowlist(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / ".env").write_text("X=1\n")
    r = c.run_checks(ws, ["**"], Limits())
    assert [(f.check, f.rule) for f in r.failures] == [("paths", "forbidden_name")]


def test_wrk_fr_29_size_files(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    for i in range(3):
        (ws.ws_dir / "src" / f"n{i}.ts").write_text("n\n")
    r = c.run_checks(ws, [], Limits(max_files=2))
    assert [(f.check, f.rule) for f in r.failures] == [("size", "diff_files")]
    assert r.diff is None and r.stats is not None and r.stats.files == 3


def test_wrk_fr_29_workspace_too_big_before_git(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "big").write_bytes(b"x" * 4096)
    r = c.run_checks(ws, [], Limits(max_ws_bytes=1024))
    assert [(f.check, f.rule) for f in r.failures] == [("size", "workspace_bytes")]
    assert r.head_sha == ws.base_sha
    assert ws.head() == ws.base_sha  # chưa commit


def test_wrk_fr_29_secrets_line(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_text(f"a\nconst k = '{AKIA}';\n")
    r = c.run_checks(ws, [], Limits())
    assert [(f.check, f.path, f.line, f.rule) for f in r.failures] == [
        ("secrets", "src/a.ts", 2, "aws_access_key")
    ]
    assert AKIA not in repr(r.failures)


def test_hub_br_32_dot_git_in_workspace_is_paths(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / ".git").write_text("gitdir: /etc\n")
    r = c.run_checks(ws, ["**"], Limits())
    assert [(f.check, f.path, f.rule) for f in r.failures] == [
        ("paths", "src/.git", "forbidden_name")
    ]


def test_wrk_fr_29_failures_capped(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    for i in range(60):
        (ws.ws_dir / "docs" / f"x{i}.md").write_text("x\n")
    r = c.run_checks(ws, ["src/**"], Limits())
    assert len(r.failures) == c.AUTOFIX_FAILURES_MAX
