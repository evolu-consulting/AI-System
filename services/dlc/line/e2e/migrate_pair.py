"""The sample pair of the feature migration flow (line/samples/migrate-pair) as two git repositories.

make_pair(workdir) -> {"v1": repo, "v1_base": "vanilla", "v2": repo}
  v1: commit 1 = the vanilla shop (tag "vanilla"), commit 2 = the customer's custom CSV export on top
  v2: the rewrite (package store/) on branch main; no export, a v2-only search, a different discount rate
"""

from __future__ import annotations

import os
import shutil

from ..config import LINE_DIR
from ..ship._util import git

PAIR = os.path.join(LINE_DIR, "samples", "migrate-pair")


def _copy(src: str, dst: str) -> None:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        rel = os.path.relpath(root, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for f in files:
            shutil.copyfile(os.path.join(root, f), os.path.join(dst, rel, f))


def _repo(path: str) -> None:
    os.makedirs(path, exist_ok=True)
    git(path, "init", "-q")
    git(path, "symbolic-ref", "HEAD", "refs/heads/main")


def _commit(path: str, msg: str) -> None:
    git(path, "add", "-A")
    git(path, "-c", "gc.auto=0", "commit", "-q", "-m", msg)


def make_pair(workdir: str) -> dict:
    v1, v2 = os.path.join(workdir, "v1"), os.path.join(workdir, "v2")
    _repo(v1)
    _copy(os.path.join(PAIR, "v1"), v1)
    _commit(v1, "shop v1.7 (vanilla)")
    git(v1, "tag", "vanilla")
    _copy(os.path.join(PAIR, "v1_custom"), v1)
    _commit(v1, "customer custom: CSV export")
    _repo(v2)
    _copy(os.path.join(PAIR, "v2"), v2)
    _commit(v2, "store v2")
    return {"v1": v1, "v1_base": "vanilla", "v2": v2}


__all__ = ["make_pair", "PAIR"]
