"""WRK-FR-28 · HUB-BR-33 · P-c1 · test đơn vị `autofix/oci.py` + `fake_oci.py` (không cần Docker:
CLI giả là script `sh`)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from agent_runtime.autofix.fake_oci import FakeOci
from agent_runtime.autofix.oci import ExecReq, OciCli, OciError, SandboxCfg, open_sandbox, run_proc
from agent_runtime.autofix.rules import SandboxSpec

_ENV = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}


def _cli(tmp_path: Path, mem_out: str) -> str:
    """CLI giả: ghi argv vào `argv.log`; `run --rm` in `mem_out` (memory.max)."""
    log = tmp_path / "argv.log"
    script = tmp_path / "fakedocker"
    script.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$*" >> "{log}"\n'
        'case "$1" in\n'
        f'  run) [ "$2" = "--rm" ] && echo {mem_out}; exit 0;;\n'
        "  ps) printf 'aif-a\\nother\\naif-b-test\\n'; exit 0;;\n"
        "  *) exit 0;;\n"
        "esac\n"
    )
    script.chmod(0o755)
    return str(script)


async def test_wrk_fr_28_run_proc_tail_and_stdin() -> None:
    req = ExecReq(cmd="", stdin=b"hello", tail_bytes=4)
    res = await run_proc(["sh", "-c", "cat; printf 123456 >&2"], req, _ENV)
    assert res.exit_code == 0
    assert (res.stdout, res.stderr, res.truncated) == (b"ello", b"3456", True)


async def test_wrk_fr_28_run_proc_timeout_kills_group() -> None:
    res = await run_proc(["sh", "-c", "sleep 30 & sleep 30"], ExecReq(cmd="", timeout_s=0.3), _ENV)
    assert res.timed_out is True
    assert res.exit_code is None
    assert res.ms < 10_000


async def test_wrk_fr_28_oci_cli_run_exec_ps(tmp_path: Path) -> None:
    oci = OciCli("docker", _cli(tmp_path, "0"))
    spec = SandboxSpec(job_id="j1", image="img", host_workspace=str(tmp_path), engine="podman")
    assert await oci.run(spec, "agent") == "aif-j1"
    await oci.exec("aif-j1", ExecReq(cmd='cat > "$1"', args=("a b.txt",), stdin=b"x"))
    assert await oci.ps() == ["aif-a", "aif-b-test"]
    lines = (tmp_path / "argv.log").read_text().splitlines()
    assert "--userns" not in lines[0]  # engine của driver thắng spec
    assert lines[1].startswith("exec -i --user 1000:1000 -w /workspace aif-j1 sh -c")
    assert lines[1].endswith("_ a b.txt")


async def test_hub_br_33_self_check(tmp_path: Path) -> None:
    ok = OciCli("docker", _cli(tmp_path, str(2048 * 1024 * 1024)))
    assert await ok.self_check("img", 2048) is None
    assert await OciCli("docker", _cli(tmp_path, "max")).self_check("img", 2048) == "cgroup"
    missing = OciCli("docker", str(tmp_path / "nope"))
    assert await missing.self_check("img", 2048) == "cli"
    with pytest.raises(OciError):
        await missing.ps()


async def test_hub_br_33_open_sandbox_modes(tmp_path: Path) -> None:
    def cfg(mode: str, env: str) -> SandboxCfg:
        return SandboxCfg(mode, "img", 2048, env, tmp_path)  # pyright: ignore[reportArgumentType]

    assert await open_sandbox(cfg("off", "test")) is None
    assert await open_sandbox(cfg("fake", "development")) is None
    assert isinstance(await open_sandbox(cfg("fake", "test")), FakeOci)


async def test_wrk_fr_28_fake_oci(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    oci = FakeOci(tmp_path / "fake")
    spec = SandboxSpec(job_id="j1", image="img", host_workspace=str(ws))
    name = await oci.run(spec, "test")
    assert name == "aif-j1-test"
    with pytest.raises(OciError):
        await oci.run(spec, "test")
    res = await oci.exec(
        name, ExecReq(cmd='cat > "$1"; echo "$HOME"', args=("f.txt",), stdin=b"hi")
    )
    assert (ws / "f.txt").read_text() == "hi"
    assert res.stdout.decode().strip() == str(tmp_path / "fake" / "tmp")
    assert await oci.ps() == [name]
    await oci.rm(name)
    with pytest.raises(OciError):
        await oci.exec(name, ExecReq(cmd="true"))
