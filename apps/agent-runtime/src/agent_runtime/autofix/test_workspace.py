"""WRK-FR-29 · HUB-FR-128 · PC-R05/R11 · P-c1 · test đơn vị `autofix/workspace.py` (cần `git`)."""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from agent_runtime.autofix import workspace as w
from agent_runtime.autofix.rules import Failure

BRANCH = "ai/0d6c3a51-8f0e-4b8a-9d3e-1c2b3a4d5e6f/fix-bug"


def _snapshot(root: Path) -> Path:
    snap = root / "snap"
    (snap / "src").mkdir(parents=True)
    (snap / "src" / "a.ts").write_text("export const a = 1;\n")
    (snap / "run.sh").write_text("#!/bin/sh\necho ok\n")
    os.chmod(snap / "run.sh", 0o555)
    os.chmod(snap / "src" / "a.ts", 0o444)
    return snap


def _prepare(tmp: Path, job: str = "job1", patch: Path | None = None) -> w.Workspace:
    return w.prepare(tmp / job, _snapshot_once(tmp), "fix-bug", patch, branch=BRANCH)


def _snapshot_once(tmp: Path) -> Path:
    snap = tmp / "snap"
    return snap if snap.exists() else _snapshot(tmp)


def test_wrk_fr_29_prepare_copy_writable_git_outside(tmp_path: Path) -> None:
    ws = _prepare(tmp_path)
    assert ws.ws_dir == tmp_path / "job1" / "workspace" / "fix-bug"
    assert ws.git_dir == tmp_path / "job1" / "git"
    assert not (ws.ws_dir / ".git").exists()
    assert len(ws.base_sha) == 40
    assert os.access(ws.ws_dir / "src" / "a.ts", os.W_OK)
    assert stat.S_IMODE((ws.ws_dir / "run.sh").stat().st_mode) & 0o100
    assert ws.git(["symbolic-ref", "--short", "HEAD"]).decode().strip() == BRANCH
    author = ws.git(["log", "-1", "--format=%an <%ae>"]).decode().strip()
    assert author == "ai-autofix <noreply@local>"


def test_wrk_fr_29_prepare_caps_size_failure_cleans(tmp_path: Path) -> None:
    caps = w.CopyCaps(max_files=1)
    with pytest.raises(w.WorkspaceError) as ei:
        w.prepare(tmp_path / "j", _snapshot(tmp_path), "fix-bug", None, caps=caps)
    assert ei.value.failure.check == "size"
    assert ei.value.failure.rule == "autofix_max_files"
    assert ei.value.base_sha == w.NULL_SHA
    assert not (tmp_path / "j" / "workspace" / "fix-bug").exists()
    with pytest.raises(w.WorkspaceError) as eb:
        w.prepare(tmp_path / "k", tmp_path / "snap", "fix-bug", None, caps=w.CopyCaps(max_bytes=5))
    assert eb.value.failure.rule == "autofix_max_bytes"


def test_wrk_fr_29_bad_key_and_branch_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        w.prepare(tmp_path / "j", _snapshot(tmp_path), "../x", None)
    with pytest.raises(ValueError):
        w.prepare(tmp_path / "j", tmp_path / "snap", "ok", None, branch="main")


def test_wrk_fr_29_diff_stats_and_changed(tmp_path: Path) -> None:
    ws = _prepare(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_text("export const a = 2;\n")
    (ws.ws_dir / "src" / "b.bin").write_bytes(b"\x00\x01\x02")
    (ws.ws_dir / "run.sh").unlink()
    diff, stats, head = ws.diff()
    assert head != ws.base_sha
    assert "GIT binary patch" in diff
    assert "+export const a = 2;" in diff
    assert (stats.files, stats.insertions, stats.deletions) == (3, 1, 3)
    assert stats.bytes == len(diff.encode())
    assert sorted(ws.changed_paths(head)) == ["run.sh", "src/a.ts", "src/b.bin"]


def test_wrk_fr_29_diff_no_changes_no_commit(tmp_path: Path) -> None:
    ws = _prepare(tmp_path)
    diff, stats, head = ws.diff()
    assert (diff, stats.files, head) == ("", 0, ws.base_sha)


def test_wrk_fr_29_diff_truncated_over_max(tmp_path: Path) -> None:
    ws = _prepare(tmp_path)
    (ws.ws_dir / "big.txt").write_text("x\n" * 500)
    diff, stats, _ = ws.diff(max_bytes=100)
    assert stats.bytes > 100
    assert len(diff.encode()) == 101


def test_hub_fr_128_pc_r11_base_patch_cumulative(tmp_path: Path) -> None:
    ws1 = _prepare(tmp_path, "r1")
    (ws1.ws_dir / "src" / "a.ts").write_text("export const a = 2;\n")
    (ws1.ws_dir / "img.bin").write_bytes(bytes(range(256)))
    diff1, _, _ = ws1.diff()
    patch = tmp_path / "base.patch"
    patch.write_bytes(diff1.encode())
    ws2 = _prepare(tmp_path, "r2", patch)
    assert (ws2.ws_dir / "img.bin").read_bytes() == bytes(range(256))
    assert ws2.head() != ws2.base_sha
    (ws2.ws_dir / "src" / "c.ts").write_text("c\n")
    diff2, stats2, _ = ws2.diff()
    assert "+export const a = 2;" in diff2
    assert "src/c.ts" in diff2
    assert stats2.files == 3


def test_hub_fr_128_pc_r11_bad_patch_apply_failure(tmp_path: Path) -> None:
    patch = tmp_path / "bad.patch"
    patch.write_text(
        "diff --git a/src/zz.ts b/src/zz.ts\n--- a/src/zz.ts\n+++ b/src/zz.ts\n"
        "@@ -1 +1 @@\n-nope\n+yes\n"
    )
    with pytest.raises(w.WorkspaceError) as ei:
        _prepare(tmp_path, "r2", patch)
    assert ei.value.failure.check == "apply_patch"
    assert len(ei.value.base_sha) == 40 and ei.value.base_sha != w.NULL_SHA


def test_hub_br_32_git_entries_detected(tmp_path: Path) -> None:
    ws = _prepare(tmp_path)
    (ws.ws_dir / "src" / ".GIT").write_text("gitdir: /etc\n")
    (ws.ws_dir / "sub" / ".git" / "x").mkdir(parents=True)
    assert ws.git_entries() == ["src/.GIT", "sub/.git"]


def test_hub_br_32_init_rejects_git_after_install(tmp_path: Path) -> None:
    ws_dir = w.copy_workspace(tmp_path / "j", _snapshot(tmp_path), "app", w.CopyCaps())
    (ws_dir / "node_modules" / "x" / ".git").mkdir(parents=True)
    with pytest.raises(w.WorkspaceError) as ei:
        w.init_git(tmp_path / "j", ws_dir, BRANCH, None)
    assert ei.value.failure == Failure(
        "install",
        path="node_modules/x/.git",
        rule="forbidden_name",
        detail="`.git` trong workspace sau pha cài (PB-R07)",
    )


def test_adr_0011_hooks_and_host_env_ignored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GIT_DIR", str(tmp_path / "evil"))
    monkeypatch.setenv("GIT_AUTHOR_NAME", "host-user")
    ws = _prepare(tmp_path)
    hooks = ws.git_dir / "hooks"
    hooks.mkdir(exist_ok=True)
    marker = tmp_path / "hook-ran"
    (hooks / "pre-commit").write_text(f"#!/bin/sh\ntouch {marker}\n")
    os.chmod(hooks / "pre-commit", 0o755)
    (ws.ws_dir / "n.txt").write_text("n\n")
    ws.diff()
    assert not marker.exists()
    assert not (tmp_path / "evil").exists()
    assert ws.git(["log", "-1", "--format=%an"]).decode().strip() == "ai-autofix"


def test_wrk_fr_29_dir_bytes(tmp_path: Path) -> None:
    ws = _prepare(tmp_path)
    before = ws.ws_bytes()
    (ws.ws_dir / "big").write_bytes(b"x" * 1000)
    assert ws.ws_bytes() == before + 1000


def test_wrk_fr_28_hand_over_chowns_only_as_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """R4: root ⇒ lchown cả cây (kể cả gốc, symlink không theo) về 1000; uid khác ⇒ không làm gì."""
    ws = tmp_path / "ws"
    (ws / "d").mkdir(parents=True)
    (ws / "d" / "f").write_text("x")
    (ws / "ln").symlink_to("/etc/passwd")
    calls: list[tuple[str, int, int, bool]] = []

    def fake_chown(
        p: object, uid: int, gid: int, *, dir_fd: int | None = None, follow_symlinks: bool = True
    ) -> None:
        calls.append((Path(str(p)).name, uid, gid, follow_symlinks))

    monkeypatch.setattr(os, "chown", fake_chown)
    monkeypatch.setattr(os, "geteuid", lambda: 1000)
    w.hand_over(ws)
    assert calls == []
    monkeypatch.setattr(os, "geteuid", lambda: 0)
    w.hand_over(ws)
    assert sorted(c[0] for c in calls) == ["d", "f", "ln", "ws"]
    assert all(c[1:] == (1000, 1000, False) for c in calls)
