"""P-b · PF-S2 · PB-R07 · C8 · test lọc bí mật + glob allowlist + trần. Hàm thuần (không I/O)."""

from __future__ import annotations

import pytest

from agent_runtime.sources.filter import (
    MAX_BYTES,
    MAX_FILES,
    Ceiling,
    TooLarge,
    allowed,
    compile_allowlist,
    is_secret,
    segment_secret,
)


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.production",
        "src/deep/nested/.ENV.local",  # case-insensitive, mọi độ sâu
        "src/deep/Id_Rsa.pub",
        "src/Secrets.yaml",
        "config/Credentials.json",
        "cert/server.PEM",
        "cert/app.key",
        "cert/a.p12",
        "cert/b.pfx",
        "cert/c.keystore",
        ".ssh/config",  # đoạn thư mục .ssh khớp đúng
        ".aws/credentials",
        ".npmrc",
        ".netrc",
    ],
)
def test_pb_r07_secret_filtered(path: str) -> None:
    assert is_secret(path) is True


@pytest.mark.parametrize(
    "path",
    [
        ".gitignore",  # C8: .git chỉ khớp đúng ".git"
        ".gitattributes",
        ".github/workflows/ci.yml",
        "README.md",
        "src/index.ts",
        "docs/keystore-guide.md",  # không phải *.keystore
    ],
)
def test_pb_r07_kept(path: str) -> None:
    assert is_secret(path) is False


def test_c8_git_exact_only() -> None:
    assert segment_secret(".git") is True
    assert segment_secret(".gitignore") is False
    assert segment_secret(".github") is False


@pytest.mark.parametrize(
    ("glob", "path", "ok"),
    [
        ("**", "a/b/c.ts", True),
        ("**/*", "README.md", True),
        ("src/**", "src/index.ts", True),
        ("src/**", "src/util/helper.ts", True),
        ("src/**", "docs/x.md", False),
        ("**/.env", ".env", True),  # (lọc vẫn thắng ở tầng is_secret)
        ("docs/**", "docs/notes.md", True),
        ("docs/**", "src/a.ts", False),
        ("f/**", "f/0001", True),
        ("zz/d0/**", "src/a.ts", False),
    ],
)
def test_allowlist_glob(glob: str, path: str, ok: bool) -> None:
    assert allowed(path, compile_allowlist([glob])) is ok


def test_allowlist_empty_matches_all() -> None:
    assert allowed("anything/here.ts", compile_allowlist([])) is True


def test_ceiling_files() -> None:
    c = Ceiling()
    with pytest.raises(TooLarge):
        for _ in range(MAX_FILES + 1):
            c.add(0)
    assert c.files == MAX_FILES + 1


def test_ceiling_bytes() -> None:
    c = Ceiling()
    with pytest.raises(TooLarge):
        c.add(MAX_BYTES + 1)
