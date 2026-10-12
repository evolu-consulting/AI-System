"""P-b · CR-060 · vòng soát sau-UAT (reviewer Major #1, #2-B2, Minor #5) · WRK-FR-27 · HUB-FR-122.

PB-R05/HUB-BR-27 (AC-H36 "làm lại dùng bản ghim") · PB-R16 (dựng lại khi mất cache) · B2.
Hộp đen trên `agent_runtime.sources` (resolve → pin → mount theo pin), fs tạm — KHÔNG DB/HTTP.
`local_path`: pin = `{kind, path, snapshot_id}` (contract `hub.py`, không đổi). Một pin đã ghim
phải luôn mount ra CÙNG nội dung lúc resolve, kể cả khi repo bị sửa giữa các stage / khi "làm
lại"; chỉ resolve MỚI (run mới) mới thấy nội dung mới. Mất cache ⇒ dựng lại được, không lỗi.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

import pytest

from agent_runtime.contracts.hub import Source
from agent_runtime.sources import snapshot
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.mount import mount_all
from agent_runtime.sources.resolve import resolve_local

TENANT = "11111111-1111-4111-8111-111111111111"
RUN_1 = "22222222-2222-4222-8222-222222222221"
RUN_2 = "22222222-2222-4222-8222-222222222222"
ALLOW = ["docs/**"]
V1 = "# Quy định v1\n"
V2 = "# Quy định v2 — đã sửa sau khi ghim, dài hơn\n"


def _cfg(base: Path) -> tuple[SourceConfig, Path]:
    roots = base / "roots"
    repo = roots / "app"
    (repo / "docs").mkdir(parents=True)
    (repo / "docs" / "rule.md").write_text(V1, encoding="utf-8")
    return SourceConfig(cache_dir=base / "cache", local_roots=(roots,)), repo


def _edit(repo: Path, text: str) -> None:
    f = repo / "docs" / "rule.md"
    st0 = f.stat()
    f.write_text(text, encoding="utf-8")
    os.utime(f, ns=(st0.st_atime_ns, st0.st_mtime_ns + 5_000_000_000))  # mtime chắc chắn đổi


def _src(pin: dict[str, object]) -> Source:
    return Source.model_validate(
        {"key": "app", "kind": "local_path", "pin": pin, "allowlist": ALLOW}
    )


def _mounted(cfg: SourceConfig, work: Path, run_id: str, pin: dict[str, object]) -> str:
    mount_all(cfg, work, TENANT, run_id, [_src(pin)])
    return (work / "sources" / "app" / "docs" / "rule.md").read_text(encoding="utf-8")


def test_ac_h36_pb_r05_redo_uses_old_pin_after_repo_changed(tmp_path: Path) -> None:
    """AC-H36 · PB-R05 · HUB-BR-27 · job khác (stage sau / làm lại) cùng pin ⇒ nội dung LÚC GHIM."""
    cfg, repo = _cfg(tmp_path)
    pin, files, _size = resolve_local(cfg, TENANT, str(repo), ALLOW)
    assert files == 1
    assert _mounted(cfg, tmp_path / "w-job1", RUN_1, pin) == V1
    _edit(repo, V2)
    # Stage kế / "làm lại" cùng run ⇒ cùng pin.snapshot_id ⇒ PHẢI thấy V1 (không phải nội dung
    # hiện tại).
    assert _mounted(cfg, tmp_path / "w-job2", RUN_1, pin) == V1


def test_ac_h36_pb_r05_new_resolve_new_pin_new_content(tmp_path: Path) -> None:
    """AC-H36 · PB-R05 · run MỚI resolve lại ⇒ snapshot_id mới + nội dung mới; pin cũ vẫn ra nội
    dung cũ."""
    cfg, repo = _cfg(tmp_path)
    old, _, _ = resolve_local(cfg, TENANT, str(repo), ALLOW)
    assert _mounted(cfg, tmp_path / "w-a", RUN_1, old) == V1
    _edit(repo, V2)
    new, _, _ = resolve_local(cfg, TENANT, str(repo), ALLOW)
    assert new["kind"] == "local_path"
    assert new["snapshot_id"] != old["snapshot_id"]
    assert _mounted(cfg, tmp_path / "w-b", RUN_2, new) == V2
    # Sau khi run mới đã resolve, "làm lại" của run cũ vẫn dùng bản ghim cũ.
    assert _mounted(cfg, tmp_path / "w-c", RUN_1, old) == V1


def test_ac_h36_pb_r05_pin_snapshot_fixed_after_resolve_not_after_first_mount(
    tmp_path: Path,
) -> None:
    """PB-R05 · nội dung ghim = lúc RESOLVE (start), không phải lúc job đầu tiên mount."""
    cfg, repo = _cfg(tmp_path)
    pin, _, _ = resolve_local(cfg, TENANT, str(repo), ALLOW)
    _edit(repo, V2)  # sửa giữa start và job stage 0
    assert _mounted(cfg, tmp_path / "w-1", RUN_1, pin) == V1


def test_pb_r16_cache_lost_rebuilds_on_mount(tmp_path: Path) -> None:
    """PB-R16 · mất cache (LRU/xoá tay) ⇒ mount dựng lại từ realpath, không lỗi, chỉ-đọc."""
    cfg, repo = _cfg(tmp_path)
    pin, _, _ = resolve_local(cfg, TENANT, str(repo), ALLOW)
    snapshot.rmtree_ro(cfg.snapshots_dir)
    assert not cfg.snapshots_dir.exists()
    assert _mounted(cfg, tmp_path / "w-r", RUN_1, pin) == V1
    mode = (tmp_path / "w-r" / "sources" / "app" / "docs" / "rule.md").stat().st_mode
    assert stat.S_IMODE(mode) & 0o222 == 0


# ── B2 · commit lỗi thật ⇒ SOURCE_UNRESOLVABLE · Minor #5 thông điệp không lộ đường dẫn cache ──
def _boom(cache: Path):
    def replace(src: object, dst: object) -> None:
        raise PermissionError(13, "Permission denied", str(cache / "snapshots" / ".bld-x"))

    return replace


def test_b2_commit_oserror_raises_source_unresolvable_and_cleans_tmp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """B2 · os.replace lỗi thật (không phải thua đua) ⇒ SourceError SOURCE_UNRESOLVABLE, dọn tmp,
    không có final."""
    cache = tmp_path / "cache"
    tmp = cache / "snapshots" / ".bld-x"
    (tmp / "docs").mkdir(parents=True)
    (tmp / "docs" / "a.md").write_text("a", encoding="utf-8")
    final = cache / "snapshots" / "local" / TENANT / "k" / "leaf"
    monkeypatch.setattr(os, "replace", _boom(cache))
    with pytest.raises(SourceError) as ei:
        snapshot.commit(tmp, final)
    assert ei.value.code == "SOURCE_UNRESOLVABLE"
    assert not tmp.exists()
    assert not final.exists()


def test_minor5_commit_error_message_has_no_runtime_cache_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Minor #5 · thông điệp SourceError (gửi Hub qua ResolveResult) là chuỗi chung — không chứa
    đường dẫn cache."""
    cache = tmp_path / "cache"
    tmp = cache / "snapshots" / ".bld-x"
    tmp.mkdir(parents=True)
    final = cache / "snapshots" / "local" / TENANT / "k" / "leaf"
    monkeypatch.setattr(os, "replace", _boom(cache))
    with pytest.raises(SourceError) as ei:
        snapshot.commit(tmp, final)
    msg = f"{ei.value.message} {ei.value}"
    assert str(tmp_path) not in msg
    assert "/snapshots" not in msg
    assert ".bld-" not in msg


# ── B2 · dựng snapshot khi Runtime KHÔNG chạy root (prod) ──
_CHILD = textwrap.dedent(
    """
    import os, stat, sys
    from pathlib import Path
    from agent_runtime.sources.config import SourceConfig
    from agent_runtime.sources.resolve import resolve_local
    base = Path(sys.argv[1])
    roots = base / "roots"; repo = roots / "app"
    (repo / "docs").mkdir(parents=True)
    (repo / "docs" / "rule.md").write_text("x", encoding="utf-8")
    cfg = SourceConfig(cache_dir=base / "cache", local_roots=(roots,))
    pin, files, _ = resolve_local(cfg, "t1", str(repo), ["docs/**"])
    assert files == 1, files
    snaps = cfg.snapshots_dir
    leftovers = [p.name for p in snaps.rglob(".bld-*")]
    assert leftovers == [], leftovers
    leaves = [p for p in snaps.rglob("rule.md")]
    assert len(leaves) == 1, leaves
    leaf_root = leaves[0].parent.parent
    assert stat.S_IMODE(leaf_root.stat().st_mode) & 0o222 == 0, oct(leaf_root.stat().st_mode)
    assert stat.S_IMODE(leaves[0].stat().st_mode) & 0o222 == 0
    try:
        (leaf_root / "docs" / "new.md").write_text("y")
        raise SystemExit("ghi được vào snapshot chỉ-đọc")
    except PermissionError:
        pass
    print("OK", os.getuid())
    """
)


def _as_nobody() -> None:
    os.setgid(65534)
    os.setuid(65534)


@pytest.mark.skipif(not hasattr(os, "getuid"), reason="chỉ Linux (WRK-NFR-06)")
def test_b2_finalize_ro_non_root_build_commit_ok() -> None:
    """B2 · non-root: dựng → chỉ-đọc → rename nguyên tử thành công; gốc + file chỉ-đọc; không sót
    `.bld-*`.
    Test chạy root (container uv) ⇒ mô phỏng bằng tiến trình con hạ quyền uid/gid 65534 (nobody)."""
    base = Path(tempfile.mkdtemp(prefix="qc-pb-b2-", dir="/tmp"))
    try:
        os.chmod(base, 0o777)
        root = os.getuid() == 0
        r = subprocess.run(
            [sys.executable, "-c", _CHILD, str(base)],
            preexec_fn=_as_nobody if root else None,  # noqa: PLW1509
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert r.returncode == 0, r.stderr[-2000:]
        assert r.stdout.startswith("OK ")
        assert r.stdout.split()[1] != "0"
    finally:
        subprocess.run(["chmod", "-R", "u+w", str(base)], check=False)
        shutil.rmtree(base, ignore_errors=True)
