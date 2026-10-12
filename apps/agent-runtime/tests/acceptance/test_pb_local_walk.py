"""P-b · CR-060 · vòng soát sau-UAT (reviewer Major #2) · WRK-FR-27 · HUB-FR-122 · PB-R07 · B3.

PB-R07: lọc bí mật THẮNG allowlist, mọi độ sâu, không phân biệt hoa-thường. B3: cắt nhánh lúc
duyệt theo allowlist/thư mục nặng — trần 50 MB/2 000 tính SAU allowlist + lọc. `content_signature`:
chữ ký tập file allowlist. Hộp đen trên `local_driver.walk_files/content_signature` +
`resolve.resolve_local`; "không duyệt vào" quan sát bằng gián điệp `os.walk`.
fs tạm — KHÔNG DB/HTTP.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.filter import MAX_FILES
from agent_runtime.sources.local_driver import content_signature, walk_files
from agent_runtime.sources.resolve import resolve_local

TENANT = "11111111-1111-4111-8111-111111111111"


def _tree(root: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def _rels(root: Path, allow: list[str] | None) -> set[str]:
    return {rel for rel, _full, _size in walk_files(root, allow)}


@pytest.fixture
def walked(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Gián điệp `os.walk`: ghi mọi `dirpath` thực sự được liệt kê (sau khi `dirnames[:]` bị
    cắt)."""
    seen: list[str] = []
    real = os.walk

    def spy(
        top: str | os.PathLike[str], *a: object, **kw: object
    ) -> Iterator[tuple[str, list[str], list[str]]]:
        for dirpath, dirnames, filenames in real(top, *a, **kw):  # type: ignore[arg-type]
            seen.append(str(dirpath))
            yield dirpath, dirnames, filenames

    monkeypatch.setattr(os, "walk", spy)
    return seen


def _visited(root: Path, seen: list[str]) -> set[str]:
    out: set[str] = set()
    for d in seen:
        rel = Path(d).relative_to(root).as_posix()
        out.add("" if rel == "." else rel)
    return out


SECRET_TREE = {
    "a/b/keep.md": "k",
    "a/b/.env": "SECRET=1",
    "a/b/.ENV.local": "SECRET=2",
    "a/b/c/d/.env.production": "SECRET=3",
    "x/.gitignore": "node_modules",
    "x/.gitattributes": "* text=auto",
    "x/.git/config": "[core]",
    "x/.git/objects/ab/cdef": "blob",
    "k/server.pem": "-----BEGIN-----",
    "k/deep/app.KEY": "key",
    "k/id_rsa": "rsa",
    "k/id_rsa.pub": "rsa.pub",
    "k/Secrets.yaml": "s: 1",
    "k/credentials.json": "{}",
    "k/readme.md": "ok",
    "h/.ssh/config": "Host *",
    "h/.aws/credentials": "[default]",
    "h/.npmrc": "//registry/:_authToken=x",
}
SECRET_KEPT = {"a/b/keep.md", "x/.gitignore", "x/.gitattributes", "k/readme.md"}


@pytest.mark.parametrize("allow", [None, [], ["**"], ["a/**", "x/**", "k/**", "h/**"]])
def test_pb_r07_secret_filtered_at_any_depth_wins_over_allowlist(
    tmp_path: Path, allow: list[str] | None
) -> None:
    """PB-R07 · bí mật lồng sâu (`a/b/.env`, `x/.git/`, `*.pem`, `id_rsa*`, `.ssh/`…) bị lọc dù
    allowlist `**`."""
    _tree(tmp_path, SECRET_TREE)
    assert _rels(tmp_path, allow) == SECRET_KEPT


def test_pb_r07_secret_explicit_allowlist_still_filtered(tmp_path: Path) -> None:
    """PB-R07 · allowlist trỏ ĐÍCH DANH file/thư mục bí mật ⇒ vẫn lọc (lọc THẮNG allowlist)."""
    _tree(tmp_path, SECRET_TREE)
    allow = ["a/b/.env", "x/.git/**", "k/*.pem", "k/id_rsa", "h/.ssh/**"]
    assert _rels(tmp_path, allow) == set()


def test_b3_secret_and_heavy_dirs_not_descended(tmp_path: Path, walked: list[str]) -> None:
    """B3 · PB-R07 · không duyệt vào `.git`/`.ssh`/`node_modules`/`.venv` (kể cả lồng sâu) dù
    allowlist `**`."""
    _tree(
        tmp_path,
        {
            "src/a.ts": "a",
            "src/.git/HEAD": "ref",
            "a/b/.ssh/id": "x",
            "apps/web/node_modules/lib/index.js": "x",
            "apps/py/.venv/bin/python": "x",
            "apps/web/src/b.ts": "b",
        },
    )
    assert _rels(tmp_path, ["**"]) == {"src/a.ts", "apps/web/src/b.ts"}
    v = _visited(tmp_path, walked)
    for bad in ("src/.git", "a/b/.ssh", "apps/web/node_modules", "apps/py/.venv"):
        assert not any(d == bad or d.startswith(bad + "/") for d in v), (bad, sorted(v))


def test_b3_double_star_mid_segment_prunes_unrelated_branches(
    tmp_path: Path, walked: list[str]
) -> None:
    """B3 · glob `apps/**/docs/*.md`: `**` khớp 0+ đoạn; nhánh ngoài tiền tố (`other/`) không bị
    duyệt."""
    _tree(
        tmp_path,
        {
            "apps/docs/c.md": "c",
            "apps/x/docs/a.md": "a",
            "apps/x/y/docs/b.md": "b",
            "apps/x/src/z.ts": "z",
            "apps/x/docs/sub/deep.md": "d",
            "other/docs/d.md": "d",
            "other/big/e.md": "e",
        },
    )
    assert _rels(tmp_path, ["apps/**/docs/*.md"]) == {
        "apps/docs/c.md",
        "apps/x/docs/a.md",
        "apps/x/y/docs/b.md",
    }
    v = _visited(tmp_path, walked)
    assert not any(d == "other" or d.startswith("other/") for d in v), sorted(v)


def test_b3_glob_exhausted_does_not_descend_deeper(tmp_path: Path, walked: list[str]) -> None:
    """B3 · `docs/*.md` (không `**`): thư mục con `docs/sub` sâu hơn glob ⇒ không duyệt, không
    lấy."""
    _tree(tmp_path, {"docs/a.md": "a", "docs/sub/b.md": "b", "src/c.md": "c"})
    assert _rels(tmp_path, ["docs/*.md"]) == {"docs/a.md"}
    v = _visited(tmp_path, walked)
    assert "docs/sub" not in v
    assert "src" not in v


def test_pb_r07_symlink_and_hardlink_skipped(tmp_path: Path) -> None:
    """PB-R07 · symlink (file/thư mục, kể cả trỏ ra ngoài) và hardlink bị bỏ."""
    outside = tmp_path / "outside"
    _tree(outside, {"leak.md": "leak"})
    root = tmp_path / "repo"
    _tree(root, {"docs/a.md": "a", "docs/h1.md": "h"})
    os.link(root / "docs" / "h1.md", root / "docs" / "h2.md")
    os.symlink(outside / "leak.md", root / "docs" / "link.md")
    os.symlink(outside, root / "docs" / "linkdir", target_is_directory=True)
    assert _rels(root, ["**"]) == {"docs/a.md"}


def test_b3_ceiling_counts_after_prune_and_filter(tmp_path: Path) -> None:
    """B3 · PB-R07 · > 2 000 file nằm trong `node_modules`/`.git` không tính vào trần ⇒ resolve
    OK, đúng 1 file."""
    roots = tmp_path / "roots"
    repo = roots / "app"
    _tree(repo, {"docs/a.md": "a"})
    for d in ("node_modules/pkg", ".git/objects"):
        p = repo / d
        p.mkdir(parents=True)
        for i in range(MAX_FILES + 1):
            (p / f"f{i}.js").write_bytes(b"x")
    cfg = SourceConfig(cache_dir=tmp_path / "cache", local_roots=(roots,))
    pin, files, size = resolve_local(cfg, TENANT, str(repo), ["**"])
    assert pin["kind"] == "local_path"
    assert (files, size) == (1, 1)


# ── content_signature ──
def _bump(p: Path, text: str) -> None:
    st0 = p.stat()
    p.write_text(text, encoding="utf-8")
    os.utime(p, ns=(st0.st_atime_ns, st0.st_mtime_ns + 5_000_000_000))


def test_content_signature_stable_and_changes_on_allowed_edit(tmp_path: Path) -> None:
    """chữ ký ổn định khi không đổi; sửa/thêm/xoá file TRONG allowlist ⇒ đổi."""
    _tree(tmp_path, {"docs/a.md": "a", "docs/b.md": "b"})
    allow = ["docs/**"]
    s0 = content_signature(tmp_path, allow)
    assert s0 == content_signature(tmp_path, allow)
    _bump(tmp_path / "docs" / "a.md", "a-sửa-dài-hơn")
    s1 = content_signature(tmp_path, allow)
    assert s1 != s0
    _tree(tmp_path, {"docs/c.md": "c"})
    s2 = content_signature(tmp_path, allow)
    assert s2 != s1
    (tmp_path / "docs" / "c.md").unlink()
    assert content_signature(tmp_path, allow) != s2


def test_content_signature_ignores_outside_allowlist_and_secrets(tmp_path: Path) -> None:
    """chữ ký KHÔNG đổi khi chỉ thay file ngoài allowlist, file bí mật, hoặc trong thư mục bị
    cắt."""
    _tree(tmp_path, {"docs/a.md": "a", "src/x.ts": "x"})
    allow = ["docs/**"]
    s0 = content_signature(tmp_path, allow)
    _bump(tmp_path / "src" / "x.ts", "x-sửa")
    _tree(
        tmp_path,
        {
            "docs/.env": "S=1",
            "docs/k.pem": "p",
            "docs/node_modules/m.js": "m",
            "docs/.git/HEAD": "h",
        },
    )
    assert content_signature(tmp_path, allow) == s0


def test_content_signature_differs_by_allowlist(tmp_path: Path) -> None:
    """chữ ký phụ thuộc tập file allowlist (allowlist khác chọn tập khác ⇒ chữ ký khác)."""
    _tree(tmp_path, {"docs/a.md": "a", "src/x.ts": "x"})
    assert content_signature(tmp_path, ["docs/**"]) != content_signature(tmp_path, ["src/**"])
