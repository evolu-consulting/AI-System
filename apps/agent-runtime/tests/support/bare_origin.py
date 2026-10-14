"""P-c2 · R3 · Fixture nguồn git cục bộ cho `ApplyHost` thật (plan-runtime §5.3, C6): repo bare +
`GIT_CONFIG_*` insteadOf `https://github.com/<owner>/` → `file://<dir>/`. Chỉ test/dev
(`RUNTIME_ENV=test`); không chứa test."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

_IDENT = {
    "GIT_AUTHOR_NAME": "fx",
    "GIT_AUTHOR_EMAIL": "fx@local",
    "GIT_COMMITTER_NAME": "fx",
    "GIT_COMMITTER_EMAIL": "fx@local",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_TERMINAL_PROMPT": "0",
}


def _git(cwd: Path, *args: str) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_CONFIG_")}
    env.update(_IDENT)
    r = subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True)
    return r.stdout.strip()


def make_bare(
    root: Path, owner: str, repo: str, files: dict[str, str], branch: str = "main"
) -> str:
    """Tạo `<root>/<owner>/<repo>.git` (bare) có 1 commit `files`; trả SHA commit đó."""
    bare = root / owner / f"{repo}.git"
    bare.mkdir(parents=True)
    _git(bare, "init", "--bare", "-b", branch)
    work = root / f"_seed-{repo}"
    work.mkdir()
    _git(work, "init", "-b", branch)
    for rel, text in files.items():
        f = work / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8", newline="\n")
    _git(work, "add", "-A")
    _git(work, "commit", "-m", "seed")
    _git(work, "push", str(bare), branch)
    return _git(work, "rev-parse", "HEAD")


def insteadof_env(root: Path, owner: str) -> dict[str, str]:
    """Env `GIT_CONFIG_*`: `https://github.com/<owner>/` → `file://<root>/<owner>/`."""
    return {
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": f"url.file://{(root / owner).as_posix()}/.insteadOf",
        "GIT_CONFIG_VALUE_0": f"https://github.com/{owner}/",
    }


def refs(bare: Path) -> list[str]:
    return _git(bare, "for-each-ref", "--format=%(refname)").splitlines()
