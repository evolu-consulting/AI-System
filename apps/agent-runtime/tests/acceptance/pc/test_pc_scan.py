"""WRK-FR-28 · WRK-FR-29 · HUB-BR-32 · HUB-BR-33 · PC-R08 · P-c1 · các vá bảo mật review (spec §9
"vá review bảo mật P-c1"): quét bí mật theo NỘI DUNG blob, symlink/gitlink, `.gitattributes`,
dọn workspace không theo symlink · test-plan P-c §3 P24–P32.

Hộp đen trên `workspace.prepare` (plan §5.8) + `check.run_checks` (plan §5.3) + `rmtree_ro`;
cần `git` (container `scripts/run.ts`). fs tạm, không DB/HTTP.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from agent_runtime.autofix import check, workspace
from agent_runtime.autofix.rules import Limits
from agent_runtime.sources.snapshot import rmtree_ro

BRANCH = "ai/0d6c3a51-8f0e-4b8a-9d3e-1c2b3a4d5e6f/fix-bug"
KEY = "AKIA" + "QCQCQCQCQCQCQCQC"  # khoá giả test-plan P-c §1


def _ws(tmp: Path, files: dict[str, bytes] | None = None) -> workspace.Workspace:
    snap = tmp / "snap"
    for rel, data in (files or {"src/a.ts": b"a\n"}).items():
        (snap / rel).parent.mkdir(parents=True, exist_ok=True)
        (snap / rel).write_bytes(data)
    return workspace.prepare(tmp / "job", snap, "app", None, branch=BRANCH)


def _fails(res: check.CheckResult) -> list[tuple[str, str | None, str | None]]:
    return [(f.check, f.path, f.rule) for f in res.failures]


def test_wrk_fr_29_p24_secret_in_nul_file_fails_secrets(tmp_path: Path) -> None:
    """P24 · PC-R08(3): file có byte NUL (git coi nhị phân) chứa khoá ⇒ `secrets` ở đúng file,
    dòng 3, không lưu diff."""
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_bytes(f"a\n\0\nk = '{KEY}';\n".encode())
    res = check.run_checks(ws, [], Limits())
    assert [(f.check, f.path, f.line) for f in res.failures] == [("secrets", "src/a.ts", 3)]
    assert res.diff is None


def test_wrk_fr_29_p25_gitattributes_cannot_hide_secret(tmp_path: Path) -> None:
    """P25 · PC-R08(1)(3): `.gitattributes` `*.ts -diff` trong cây không che khoá: allowlist
    không nêu `.gitattributes` ⇒ trượt `paths` `git_meta`; allowlist nêu rõ ⇒ khoá vẫn bị
    `secrets` bắt."""
    ws = _ws(tmp_path)
    (ws.ws_dir / ".gitattributes").write_text("*.ts -diff\n*.js binary\n")
    (ws.ws_dir / "src" / "a.ts").write_text(f"a\nk = '{KEY}';\n")
    first = check.run_checks(ws, [], Limits())
    assert ("paths", ".gitattributes", "git_meta") in _fails(first)
    explicit = check.run_checks(ws, ["src/**", ".gitattributes"], Limits())
    assert _fails(explicit) == [("secrets", "src/a.ts", "aws_access_key")]


def test_wrk_fr_29_p26_utf16_secret_caught(tmp_path: Path) -> None:
    """P26 · PC-R08(3): file UTF-16 (xen NUL) chứa khoá ⇒ vẫn `secrets`."""
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "b.ts").write_bytes(f"k = '{KEY}'\n".encode("utf-16-le"))
    res = check.run_checks(ws, [], Limits())
    assert [(f.check, f.path) for f in res.failures] == [("secrets", "src/b.ts")]


def test_wrk_fr_29_p27_preexisting_secret_line_not_reported(tmp_path: Path) -> None:
    """P27 · PC-R08(3): dòng khoá đã có ở base, agent chỉ thêm dòng sạch ⇒ không báo lỗi;
    thêm một dòng khoá MỚI cạnh dòng cũ ⇒ báo."""
    ws = _ws(tmp_path, {"src/a.ts": f"old = '{KEY}';\n".encode()})
    target = ws.ws_dir / "src" / "a.ts"
    target.write_text(f"old = '{KEY}';\nclean = 1;\n")
    assert check.run_checks(ws, [], Limits()).failures == []
    target.write_text(f"old = '{KEY}';\nnew = '{KEY}';\n")
    res = check.run_checks(ws, [], Limits())
    assert [(f.check, f.path) for f in res.failures] == [("secrets", "src/a.ts")]


def test_wrk_fr_29_p28_new_symlink_fails_paths_symlink(tmp_path: Path) -> None:
    """P28 · PC-R08(1): symlink mới (mode 120000) trong diff ⇒ `paths` rule `symlink`,
    không lưu diff (kể cả khi đích nằm trong allowlist)."""
    ws = _ws(tmp_path)
    os.symlink("/etc/passwd", ws.ws_dir / "src" / "link")
    res = check.run_checks(ws, ["src/**"], Limits())
    assert _fails(res) == [("paths", "src/link", "symlink")]
    assert res.diff is None


def test_hub_br_32_p29_rmtree_ro_does_not_touch_symlink_targets(tmp_path: Path) -> None:
    """P29 · HUB-BR-32 · dọn workspace: symlink (file/thư mục) trỏ ra ngoài cây ⇒ xoá liên kết,
    đích ngoài KHÔNG đổi mode, nội dung còn nguyên."""
    outside = tmp_path / "outside"
    outside.mkdir()
    victim = outside / "victim"
    victim.write_text("x")
    victim.chmod(0o400)
    outside.chmod(0o500)
    tree = tmp_path / "work"
    (tree / "d").mkdir(parents=True)
    os.symlink(victim, tree / "d" / "f")
    os.symlink(outside, tree / "dirlink")
    (tree / "d").chmod(0o500)
    try:
        rmtree_ro(tree)
        assert not tree.exists()
        assert stat.S_IMODE(victim.stat().st_mode) == 0o400
        assert stat.S_IMODE(outside.stat().st_mode) == 0o500
        assert victim.read_text() == "x"
    finally:
        outside.chmod(0o700)


SAMPLE_PEM = "-----BEGIN RSA PRIVATE KEY-----\nSAMPLEKEYBODYAAAA\n-----END RSA PRIVATE KEY-----\n"
REAL_PEM = (
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAqcqcqcqcqcqcqcqc\nZmFrZWJvZHk=\n"
    "-----END RSA PRIVATE KEY-----\n"
)


def test_wrk_fr_29_p30_real_pem_appended_to_file_with_sample_key_fails(tmp_path: Path) -> None:
    """P30 · PC-R08(3): base đã có khoá MẪU cùng header; agent nối khối PEM private key thật
    (header trùng base) ⇒ `secrets` rule `private_key`, ở file đó."""
    ws = _ws(tmp_path, {"src/k.ts": f"// ví dụ\n{SAMPLE_PEM}".encode()})
    (ws.ws_dir / "src" / "k.ts").write_text(f"// ví dụ\n{SAMPLE_PEM}{REAL_PEM}")
    res = check.run_checks(ws, [], Limits())
    assert ("secrets", "src/k.ts", "private_key") in _fails(res)
    assert res.diff is None


def test_wrk_fr_29_p31_pem_body_replaced_keeping_header_footer_fails(tmp_path: Path) -> None:
    """P31 · PC-R08(3): thay thân khoá, giữ nguyên header/footer của khoá mẫu ở base ⇒ vẫn
    `private_key`."""
    ws = _ws(tmp_path, {"src/k.ts": SAMPLE_PEM.encode()})
    (ws.ws_dir / "src" / "k.ts").write_text(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAqcqcqcqcqcqc\n"
        "-----END RSA PRIVATE KEY-----\n"
    )
    res = check.run_checks(ws, [], Limits())
    assert ("secrets", "src/k.ts", "private_key") in _fails(res)


def test_wrk_fr_29_p32_pem_unchanged_not_reported(tmp_path: Path) -> None:
    """P32 · PC-R08(3) đối chứng: khoá mẫu có sẵn ở base, agent chỉ thêm dòng sạch ⇒ không báo."""
    ws = _ws(tmp_path, {"src/k.ts": SAMPLE_PEM.encode()})
    (ws.ws_dir / "src" / "k.ts").write_text(f"{SAMPLE_PEM}clean = 1;\n")
    assert check.run_checks(ws, [], Limits()).failures == []


def test_wrk_fr_29_p33_secret_line_repeated_once_more_fails(tmp_path: Path) -> None:
    """P33 · PC-R08(3): dòng bí mật có 1 lần ở base, 2 lần ở bản mới (lặp đúng dòng cũ) ⇒ báo
    (đếm theo số lần, không theo tập)."""
    line = f"old = '{KEY}';\n"
    ws = _ws(tmp_path, {"src/a.ts": line.encode()})
    (ws.ws_dir / "src" / "a.ts").write_text(line + line)
    res = check.run_checks(ws, [], Limits())
    assert [(f.check, f.path, f.line) for f in res.failures] == [("secrets", "src/a.ts", 2)]


def test_wrk_fr_29_p34_cat_file_missing_blob_is_unscannable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """P34 · PC-R08(3) fail-closed: `git cat-file` không trả blob đã xin ⇒ `secrets` rule
    `unscannable` (không coi là sạch), không lưu diff."""
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_text("a\nb = 2;\n")

    def _no_blobs(self: workspace.Workspace, shas: list[str]) -> dict[str, bytes]:
        return {}

    monkeypatch.setattr(workspace.Workspace, "blobs", _no_blobs)
    res = check.run_checks(ws, [], Limits())
    assert _fails(res) == [("secrets", "src/a.ts", "unscannable")]
    assert res.diff is None
