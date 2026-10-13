"""WRK-FR-28 · WRK-FR-29 · HUB-BR-32 · HUB-BR-33 · P-c1 · test đơn vị các bản vá review bảo mật:
quét bí mật theo blob (NUL, `.gitattributes`), symlink/gitlink, `rmtree_ro` không theo symlink,
`rm` phải xác nhận container đã chết, ulimit + mạng `aif-prep`, trần diff sau giải mã
(cần `git`)."""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from agent_runtime.autofix import check as c
from agent_runtime.autofix import workspace as w
from agent_runtime.autofix.gitscan import RawChange, check_link_modes, parse_raw, scan_blob
from agent_runtime.autofix.oci import OciCli, OciError
from agent_runtime.autofix.rules import Limits, SandboxSpec, check_paths, container_args
from agent_runtime.sources.snapshot import rmtree_ro

BRANCH = "ai/0d6c3a51-8f0e-4b8a-9d3e-1c2b3a4d5e6f/fix-bug"
AKIA = "AKIA" + "ABCDEFGHIJKLMNOP"


def _ws(tmp: Path) -> w.Workspace:
    snap = tmp / "snap"
    (snap / "src").mkdir(parents=True)
    (snap / "src" / "a.ts").write_text("a\n")
    return w.prepare(tmp / "job", snap, "app", None, branch=BRANCH)


def _rules(r: c.CheckResult) -> list[tuple[str, str | None, str | None]]:
    return [(f.check, f.path, f.rule) for f in r.failures]


# ---------- (1) quét bí mật theo blob ----------


def test_wrk_fr_29_secret_in_nul_binary_file_caught(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_bytes(b"a\n\0\nconst k = '" + AKIA.encode() + b"';\n")
    r = c.run_checks(ws, [], Limits())
    assert [(f.check, f.path, f.line, f.rule) for f in r.failures] == [
        ("secrets", "src/a.ts", 3, "aws_access_key")
    ]
    assert r.diff is None


def test_wrk_fr_29_secret_utf16_caught(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "b.ts").write_bytes(f"k = '{AKIA}'\n".encode("utf-16-le"))
    r = c.run_checks(ws, [], Limits())
    assert _rules(r) == [("secrets", "src/b.ts", "aws_access_key")]


def test_wrk_fr_29_gitattributes_in_tree_cannot_hide(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / ".gitattributes").write_text("*.ts -diff\n*.js binary\n")
    (ws.ws_dir / "src" / "a.ts").write_text(f"a\nconst k = '{AKIA}';\n")
    (ws.ws_dir / "src" / "c.js").write_text(f"const k = '{AKIA}';\n")
    allow = ["src/**", ".gitattributes"]
    r = c.run_checks(ws, allow, Limits())
    assert _rules(r) == [
        ("secrets", "src/a.ts", "aws_access_key"),
        ("secrets", "src/c.js", "aws_access_key"),
    ]
    diff, _, _ = ws.diff()
    assert "Binary files" not in diff and AKIA in diff  # info/attributes thắng cây


def test_wrk_fr_29_gitattributes_needs_explicit_allowlist() -> None:
    got = check_paths([".gitattributes", "a/.gitmodules", "src/x.ts"], ["**"])
    assert [(f.path, f.rule) for f in got] == [
        (".gitattributes", "git_meta"),
        ("a/.gitmodules", "git_meta"),
    ]
    assert check_paths([".gitattributes"], ["src/**", ".gitattributes"]) == []


def test_wrk_fr_29_scan_blob_only_new_lines() -> None:
    old = f"x = '{AKIA}'\n".encode()
    assert scan_blob("a", old + b"y\n", old) == []
    got = scan_blob("a", b"y\n" + old, None)
    assert [(f.line, f.rule) for f in got] == [(2, "aws_access_key")]


def test_wrk_fr_29_unscannable_blob_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ws = _ws(tmp_path)
    monkeypatch.setattr(c, "SCAN_BLOB_MAX", 10)
    (ws.ws_dir / "src" / "a.ts").write_text("a\n" + "b" * 50 + "\n")
    r = c.run_checks(ws, [], Limits())
    assert _rules(r) == [("secrets", "src/a.ts", "unscannable")]


# ---------- (6) symlink / gitlink ----------


def test_wrk_fr_29_new_symlink_is_paths_failure(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    os.symlink("/etc/passwd", ws.ws_dir / "src" / "p")
    r = c.run_checks(ws, [], Limits())
    assert _rules(r) == [("paths", "src/p", "symlink")]


def test_wrk_fr_29_parse_raw_and_link_modes() -> None:
    z = "0" * 40
    raw = (
        f":000000 120000 {z} {'a' * 40} A\0l\0"
        f":100644 100644 {'b' * 40} {'c' * 40} M\0f\0"
        f":160000 000000 {'d' * 40} {z} D\0g\0"
        f":000000 160000 {z} {'e' * 40} A\0sub\0"
    ).encode()
    changes = parse_raw(raw)
    assert [(x.path, x.new_mode, x.status) for x in changes] == [
        ("l", "120000", "A"),
        ("f", "100644", "M"),
        ("g", "000000", "D"),
        ("sub", "160000", "A"),
    ]
    assert [(f.path, f.rule) for f in check_link_modes(changes)] == [
        ("l", "symlink"),
        ("sub", "symlink"),
    ]
    assert check_link_modes([RawChange("f", "100644", "100755", z, z, "M")]) == []


# ---------- (7) trần diff sau giải mã ----------


def test_wrk_fr_29_diff_bytes_counted_after_decode(tmp_path: Path) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_bytes(b"a\n" + b"\xff" * 4000 + b"\n")
    text, stats, _ = ws.diff()
    assert stats.bytes == len(text.encode()) > 3 * 4000  # U+FFFD = 3 byte


# ---------- (2) rmtree_ro không chmod qua symlink ----------


def test_hub_br_32_rmtree_ro_does_not_follow_symlinks(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / "victim"
    target.write_text("x")
    os.chmod(target, 0o400)
    os.chmod(outside, 0o500)
    tree = tmp_path / "work"
    (tree / "d").mkdir(parents=True)
    os.symlink(target, tree / "d" / "f")
    os.symlink(outside, tree / "dirlink")
    os.chmod(tree / "d", 0o500)
    rmtree_ro(tree)
    assert not tree.exists()
    assert stat.S_IMODE(target.stat().st_mode) == 0o400
    assert stat.S_IMODE(outside.stat().st_mode) == 0o500
    os.chmod(outside, 0o700)


def test_hub_br_32_rmtree_ro_symlink_root_only_unlinks(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep").write_text("x")
    link = tmp_path / "link"
    os.symlink(outside, link)
    rmtree_ro(link)
    assert not link.exists() and (outside / "keep").exists()


# ---------- (3)(5) argv: ulimit + mạng prep ----------


def test_hub_br_33_ulimits_and_prep_network() -> None:
    spec = SandboxSpec(job_id="j", image="i", host_workspace="/w", disk_mb=10)
    for phase in ("prep", "agent", "test"):
        argv = container_args(spec, phase=phase)
        ul = [argv[i + 1] for i, a in enumerate(argv) if a == "--ulimit"]
        assert ul == [f"fsize={10 << 20}:{10 << 20}", "nofile=8192:8192", "core=0:0"], phase
    prep = container_args(spec, phase="prep")
    assert prep[prep.index("--network") + 1] == "aif-prep"


# ---------- (4) rm phải xác nhận container đã chết ----------


def _cli(tmp_path: Path, inspect: str, net: str = "exit 1") -> str:
    """CLI giả: `rm` luôn lỗi; `container inspect`/`network inspect` theo kịch bản."""
    log = tmp_path / "argv.log"
    script = tmp_path / "fakedocker"
    script.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$*" >> "{log}"\n'
        'case "$1 $2" in\n'
        "  'rm -f') echo boom >&2; exit 1;;\n"
        f"  'container inspect') {inspect};;\n"
        f"  'network inspect') {net};;\n"
        "  *) exit 0;;\n"
        "esac\n"
    )
    script.chmod(0o755)
    return str(script)


@pytest.mark.parametrize(
    ("inspect", "alive"),
    [
        ("echo true; exit 0", True),
        ("echo 'Error: No such container: x' >&2; exit 1", False),
        ("echo false; exit 0", False),
        ("echo 'Cannot connect to the Docker daemon' >&2; exit 1", True),
    ],
)
async def test_wrk_fr_28_rm_confirms_dead(tmp_path: Path, inspect: str, alive: bool) -> None:
    oci = OciCli("docker", _cli(tmp_path, inspect))
    if alive:
        with pytest.raises(OciError) as err:
            await oci.rm("aif-j")
        assert err.value.reason == "rm_failed"
    else:
        await oci.rm("aif-j")


async def test_hub_br_33_prep_network_created(tmp_path: Path) -> None:
    oci = OciCli("docker", _cli(tmp_path, "exit 0"))
    await oci.run(SandboxSpec(job_id="j", image="i", host_workspace=str(tmp_path)), "prep")
    lines = (tmp_path / "argv.log").read_text().splitlines()
    assert lines[0] == "network inspect --format {{json .Options}} aif-prep"
    assert lines[1] == (
        "network create --label ai.autofix=1 -o com.docker.network.bridge.enable_icc=false aif-prep"
    )
    assert lines[2].startswith("run -d --name aif-j-prep")


@pytest.mark.parametrize(
    ("engine", "opts", "ok"),
    [
        ("docker", '{"com.docker.network.bridge.enable_icc":"false"}', True),
        ("docker", "{}", False),
        ("docker", '{"com.docker.network.bridge.enable_icc":"true"}', False),
        ("podman", '{"isolate":"true"}', True),
        ("podman", "null", False),
    ],
)
async def test_hub_br_33_existing_prep_network_must_be_isolated(
    tmp_path: Path, engine: str, opts: str, ok: bool
) -> None:
    oci = OciCli(
        "podman" if engine == "podman" else "docker", _cli(tmp_path, "exit 0", f"echo '{opts}'")
    )
    if ok:
        await oci.ensure_prep_network()
    else:
        with pytest.raises(OciError) as err:
            await oci.ensure_prep_network()
        assert err.value.reason == "network_failed"
    assert "network create" not in (tmp_path / "argv.log").read_text()


# ---------- (1b) review vòng 2: Counter + khối PEM, fail-closed cat-file, trần base ----------

_PEM_SAMPLE = "-----BEGIN RSA PRIVATE KEY-----\nU0FNUExFLUtFWQ==\n-----END RSA PRIVATE KEY-----\n"
_PEM_REAL = (
    "-----BEGIN RSA PRIVATE KEY-----\nUkVBTC1LRVktMQ==\nUkVBTC1LRVktMg==\n"
    "-----END RSA PRIVATE KEY-----\n"
)


def test_wrk_fr_29_duplicate_secret_line_counted() -> None:
    line = f"x = '{AKIA}'\n".encode()
    got = scan_blob("a", line + line, line)
    assert [(f.line, f.rule) for f in got] == [(2, "aws_access_key")]


def test_wrk_fr_29_pem_block_appended_with_same_header() -> None:
    base = ("doc\n" + _PEM_SAMPLE).encode()
    assert scan_blob("k.pem", base, base) == []
    got = scan_blob("k.pem", base + _PEM_REAL.encode(), base)
    assert [(f.line, f.rule) for f in got] == [(5, "private_key")]


def test_wrk_fr_29_pem_body_replaced_keeping_header_footer() -> None:
    base = _PEM_SAMPLE.encode()
    got = scan_blob("k.pem", _PEM_REAL.encode(), base)
    assert [(f.line, f.rule) for f in got] == [(1, "private_key")]
    unclosed = b"-----BEGIN PRIVATE KEY-----\nTkVXLUJPRFk=\n"
    assert [f.rule for f in scan_blob("k", unclosed, b"-----BEGIN PRIVATE KEY-----\n")] == [
        "private_key"
    ]


def test_wrk_fr_29_missing_blob_from_cat_file_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = _ws(tmp_path)
    (ws.ws_dir / "src" / "a.ts").write_text("a\nb\n")

    def no_blobs(_self: w.Workspace, _shas: list[str]) -> dict[str, bytes]:
        return {}  # `cat-file --batch` trả `<sha> missing`

    monkeypatch.setattr(w.Workspace, "blobs", no_blobs)
    r = c.run_checks(ws, [], Limits())
    assert _rules(r) == [("secrets", "src/a.ts", "unscannable")]


def test_wrk_fr_29_base_blob_counts_toward_total(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    snap = tmp_path / "snap"
    (snap / "src").mkdir(parents=True)
    (snap / "src" / "a.ts").write_text("x" * 100 + "\n")
    ws = w.prepare(tmp_path / "job", snap, "app", None, branch=BRANCH)
    (ws.ws_dir / "src" / "a.ts").write_text("y\n")
    monkeypatch.setattr(c, "SCAN_TOTAL_MAX", 50)
    r = c.run_checks(ws, [], Limits())
    assert _rules(r) == [("secrets", "src/a.ts", "unscannable")]


def test_hub_br_32_rmtree_ro_unreadable_dir(tmp_path: Path) -> None:
    tree = tmp_path / "work"
    (tree / "d" / "e").mkdir(parents=True)
    (tree / "d" / "e" / "f").write_text("x")
    os.chmod(tree / "d" / "e", 0o300)
    os.chmod(tree / "d", 0o300)
    rmtree_ro(tree)
    assert not tree.exists()
