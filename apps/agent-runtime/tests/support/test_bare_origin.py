"""P-c2 · R3 · fixture `bare_origin` (cần git; không DB)."""

from __future__ import annotations

from pathlib import Path

from tests.support.bare_origin import insteadof_env, make_bare, refs


def test_make_bare_and_env(tmp_path: Path) -> None:
    sha = make_bare(tmp_path, "pc2-test", "app", {"src/a.js": "x\n"})
    assert len(sha) == 40
    assert refs(tmp_path / "pc2-test" / "app.git") == ["refs/heads/main"]
    env = insteadof_env(tmp_path, "pc2-test")
    assert env["GIT_CONFIG_VALUE_0"] == "https://github.com/pc2-test/"
