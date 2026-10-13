"""WRK-FR-28 · HUB-BR-32 · P-c1 · `ws_tools` trên `FakeOci` (plan-runtime §5.5) + sweeper thuần."""

from __future__ import annotations

from pathlib import Path

import pytest

from agent_runtime.autofix.fake_oci import FakeOci
from agent_runtime.autofix.host import to_command
from agent_runtime.autofix.rules import SandboxSpec
from agent_runtime.autofix.sweeper import job_of, orphans
from agent_runtime.autofix.ws_tools import WsError, WsSession, WsTarget, call, load_commands

JOB = "c0c00000-0000-4000-8000-0000000000a1"


async def _session(tmp_path: Path, max_ws_bytes: int = 10_000_000) -> tuple[WsSession, Path]:
    ws = tmp_path / "work" / JOB / "workspace" / "app"
    (ws / "src").mkdir(parents=True)
    (ws / "src" / "a.js").write_text("x = 1;\ny = 1;\n", encoding="utf-8")
    oci = FakeOci(tmp_path / "fake")
    name = await oci.run(SandboxSpec(JOB, "img", str(ws)), "agent")
    log = tmp_path / "work" / JOB / "cmds.jsonl"
    t = WsTarget(
        engine="fake",
        container=name,
        ws_dir=str(ws),
        log_path=str(log),
        max_ws_bytes=max_ws_bytes,
        fake_dir=str(tmp_path / "fake"),
    )
    return WsSession(t, oci), ws


async def test_wrk_fr_28_ws_write_edit_read_exec_logged(tmp_path: Path) -> None:
    s, ws = await _session(tmp_path)
    assert await s.write("src/new/b.js", "b = 2;\n") == "đã ghi src/new/b.js"
    assert (ws / "src/new/b.js").read_text(encoding="utf-8") == "b = 2;\n"
    await s.edit("src/a.js", "x = 1;", "x = 2;")
    assert (ws / "src/a.js").read_text(encoding="utf-8").startswith("x = 2;")
    assert await s.read("src/a.js", offset=1, limit=1) == "y = 1;\n"
    got = await s.exec("ls src")
    assert got["exit_code"] == 0 and "a.js" in got["stdout"]
    cmds = load_commands(Path(s.t.log_path))
    assert [(c["tool"], c["arg"]) for c in cmds] == [
        ("write", "src/new/b.js"),
        ("edit", "src/a.js"),
        ("read", "src/a.js"),
        ("exec", "ls src"),
    ]
    assert cmds[-1]["exit_code"] == 0 and "exit_code" not in cmds[0]
    assert [c.tool for c in map(to_command, cmds) if c is not None] == [
        "write",
        "edit",
        "read",
        "exec",
    ]


@pytest.mark.parametrize("path", ["/etc/passwd", "../x", "a/../../x", ""])
async def test_hub_br_32_ws_paths_must_stay_relative(tmp_path: Path, path: str) -> None:
    s, _ = await _session(tmp_path)
    with pytest.raises(WsError) as err:
        await s.write(path, "x")
    assert err.value.code == "bad_path"


async def test_wrk_fr_28_ws_edit_errors_like_edit(tmp_path: Path) -> None:
    s, _ = await _session(tmp_path)
    with pytest.raises(WsError, match="no_match"):
        await s.edit("src/a.js", "zzz", "q")
    with pytest.raises(WsError, match="ambiguous"):
        await s.edit("src/a.js", "= 1;", "= 3;")
    assert "2 chỗ" in await s.edit("src/a.js", "= 1;", "= 3;", replace_all=True)
    with pytest.raises(WsError, match="read_failed"):
        await s.read("src/khong-co.js")


async def test_wrk_fr_28_ws_exec_size_cap_and_call_dispatch(tmp_path: Path) -> None:
    s, _ = await _session(tmp_path, max_ws_bytes=10)
    with pytest.raises(WsError, match="size"):
        await call(s, "ws_exec", {"cmd": "true"})
    with pytest.raises(WsError, match="bad_args"):
        await call(s, "ws_write", {"path": "a"})
    with pytest.raises(WsError, match="unknown_tool"):
        await call(s, "ws_rm", {})


def test_wrk_br_08_sweeper_orphans_only_dead_jobs() -> None:
    live = "c0c00000-0000-4000-8000-0000000000b2"
    names = [f"aif-{JOB}", f"aif-{JOB}-test", f"aif-{live}", "aif-khac", "web-1"]
    assert job_of(f"aif-{live}-prep") == live
    assert orphans(names, {live}) == [f"aif-{JOB}", f"aif-{JOB}-test"]
