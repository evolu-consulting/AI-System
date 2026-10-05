"""WRK-FR-22 · H3a-R14(a) · `auth_status` với script giả thay CLI (`cli_path`): JSON true/false,
exit 1, JSON hỏng, treo (hạn rút ngắn), stdout quá lớn; `fake-cli` + file đếm `.calls`.
Không gọi CLI thật.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import cast

import pytest

from agent_runtime.runtimes.cli.probe import (
    PROBE_SUBDIR,
    ProbeHostCfg,
    note_call,
    probe_argv,
    read_fake,
)
from agent_runtime.runtimes.cli.probe import auth as mod
from agent_runtime.runtimes.cli.probe.auth import auth_status, cli_of
from agent_runtime.sandbox import process as pg

PII = "someone@example.com"


def cfg_of(tmp_path: Path, cli: Path | None = None, fake: Path | None = None) -> ProbeHostCfg:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    return ProbeHostCfg(
        python=sys.executable,
        home=home,
        work_dir=tmp_path / "work",
        app_env="test",
        cli_path=str(cli) if cli is not None else None,
        kill_grace_s=0.5,
        timeout_s=5,
        fake_file=fake,
    )


def script(tmp_path: Path, body: str) -> Path:
    """CLI giả: ghi argv + env + cwd ra `seen.json` rồi chạy `body` (sh)."""
    path = tmp_path / "fake-claude"
    seen = tmp_path / "seen.json"
    dump = (
        f"{sys.executable} -c \"import json,os,sys; json.dump({{'argv': sys.argv[1:], "
        f"'env': dict(os.environ), 'cwd': os.getcwd()}}, open('{seen}', 'w'))\" \"$@\""
    )
    path.write_text(f"#!/bin/sh\n{dump}\n{body}\n")
    path.chmod(0o700)
    return path


def seen_of(tmp_path: Path) -> dict[str, object]:
    return json.loads((tmp_path / "seen.json").read_text())


async def test_wrk_fr_22_auth_logged_in_true(tmp_path: Path) -> None:
    out = json.dumps({"loggedIn": True, "email": PII, "orgId": "org-1"})
    cli = script(tmp_path, f"echo '{out}'\necho '{PII}' >&2")
    cfg = cfg_of(tmp_path, cli)
    got, ms = await auth_status(cfg, "claude-sub")
    assert got is True and isinstance(ms, int) and ms >= 0
    seen = seen_of(tmp_path)
    assert seen["argv"] == ["auth", "status", "--json"]
    probe_dir = tmp_path / "work" / PROBE_SUBDIR / "claude-sub"
    assert seen["cwd"] == str(probe_dir)
    assert (probe_dir.stat().st_mode & 0o777) == 0o700
    env = cast(dict[str, str], seen["env"])
    assert env["HOME"] == str(cfg.home) and env["APP_ENV"] == "test"
    assert not any(k.startswith(("AGENT_RT_", "DATABASE_URL", "REDIS_URL", "HUB_")) for k in env)


async def test_wrk_fr_22_auth_no_pii_logged(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = json.dumps({"loggedIn": True, "email": PII})
    cli = script(tmp_path, f"echo '{out}'\necho '{PII}' >&2")
    await auth_status(cfg_of(tmp_path, cli), "claude-sub")
    captured = capsys.readouterr()
    assert PII not in captured.out and PII not in captured.err


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("echo '{\"loggedIn\": false}'", False),
        ("echo '{\"loggedIn\": false}'; exit 1", False),  # Spike S1 #4
        ("echo 'garbage'; exit 1", False),  # exit ≠ 0 ⇒ logged_out (PL7)
        ("echo 'not json'", None),  # PL7: exit 0 parse sai ⇒ lỗi probe
        ('echo \'{"loggedIn": "yes"}\'', None),
        ("echo '[]'", None),
    ],
)
async def test_wrk_fr_22_auth_outcomes(tmp_path: Path, body: str, expected: bool | None) -> None:
    got, _ = await auth_status(cfg_of(tmp_path, script(tmp_path, body)), "claude-sub")
    assert got is expected


async def test_wrk_fr_22_auth_hang_times_out_and_kills_group(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mod, "AUTH_TIMEOUT_S", 0.5)
    pid_file = tmp_path / "pid"
    cli = script(tmp_path, f"echo $$ > {pid_file}\nsleep 15")
    started = time.monotonic()
    got, ms = await auth_status(cfg_of(tmp_path, cli), "claude-sub")
    assert got is None and time.monotonic() - started < 5 and ms >= 500
    pid = int(pid_file.read_text())
    assert pg.group_pids(pid) == []


async def test_wrk_fr_22_auth_stdout_too_large(tmp_path: Path) -> None:
    cli = script(tmp_path, "head -c 70000 /dev/zero | tr '\\0' 'a'")
    got, _ = await auth_status(cfg_of(tmp_path, cli), "claude-sub")
    assert got is None


async def test_wrk_fr_22_auth_missing_cli(tmp_path: Path) -> None:
    got, _ = await auth_status(cfg_of(tmp_path, tmp_path / "nope"), "claude-sub")
    assert got is None


def test_wrk_fr_22_cli_of_bundled_default(tmp_path: Path) -> None:
    """Không `cli_path` ⇒ CLI đi kèm SDK (`_bundled/claude`) nếu có, không phải `PATH`."""
    got = cli_of(cfg_of(tmp_path))
    assert got is None or (got.name == "claude" and got.parent.name == "_bundled")


@pytest.mark.parametrize(
    ("text", "expected"),
    [(None, True), ("ok\n", True), ("logged_out\n", False), ("rejected:1\n", True), ("x", True)],
)
async def test_wrk_fr_22_auth_fake_cli(tmp_path: Path, text: str | None, expected: bool) -> None:
    fake = tmp_path / "probe.txt"
    if text is not None:
        fake.write_text(text)
    got, _ = await auth_status(cfg_of(tmp_path, fake=fake), "fake-cli")
    assert got is expected
    assert calls_of(fake) == "auth\n"


async def test_wrk_fr_22_no_calls_file_without_env(tmp_path: Path) -> None:
    got, _ = await auth_status(cfg_of(tmp_path), "fake-cli")
    assert got is True
    assert calls_files(tmp_path) == []


def test_wrk_fr_22_read_fake_and_calls(tmp_path: Path) -> None:
    fake = tmp_path / "probe.txt"
    cfg = cfg_of(tmp_path, fake=fake)
    assert read_fake(cfg) is None  # vắng file ⇒ ok
    fake.write_text("hang\nrest")
    assert read_fake(cfg) == "hang"
    note_call(cfg, "auth")
    note_call(cfg, "turn")
    assert Path(f"{fake}.calls").read_text().splitlines() == ["auth", "turn"]
    assert "probe" in " ".join(probe_argv("py", "fake-cli"))
    assert probe_argv("py", "k")[-1] == "--provider=k"


def calls_of(fake: Path) -> str:
    return Path(f"{fake}.calls").read_text()


def calls_files(root: Path) -> list[Path]:
    return list(root.glob("*.calls"))
