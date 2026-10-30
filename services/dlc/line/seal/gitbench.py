"""Real-git check of the incremental scan: a generated repo, commits touching a few files, full rescan vs
VersionedGraph.advance, and 'as of sha' answers compared with a fresh full scan of that commit.

    python -m line.seal.gitbench [--files 300] [--commits 10] [--touch 3]
"""

from __future__ import annotations

import argparse
import os
import random
import re
import shutil
import subprocess
import tempfile
import time
from typing import Any, Dict, List

from .scancache import BlobCache, VersionedGraph

_DEF = re.compile(r"^\s*(?:def|class|entity|service)\s+(\w+)", re.M)


def extract(path: str, text: str) -> Dict[str, Any]:
    """A deliberately small extractor: the declared names of a file."""
    return {"names": sorted(_DEF.findall(text))}


def _git(repo: str, *args: str) -> str:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout.strip()


def _write(repo: str, rel: str, rng: random.Random, n: int) -> None:
    full = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    if rel.endswith(".cds"):
        body = "".join("entity E%d_%d { key ID: UUID; v: Integer; }\n" % (n, i) for i in range(rng.randint(3, 12)))
    else:
        body = "".join("def f%d_%d(x):\n    return x + %d\n\n" % (n, i, i) for i in range(rng.randint(3, 12)))
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(body)


def make_repo(root: str, files: int, seed: int = 7) -> List[str]:
    rng = random.Random(seed)
    _git_init = ["git", "init", "-q", "-b", "main", root]
    subprocess.run(_git_init, check=True)
    _git(root, "config", "user.email", "bench@example.com")
    _git(root, "config", "user.name", "bench")
    paths = ["mod%02d/f%03d.%s" % (i % 12, i, "cds" if i % 3 == 0 else "py") for i in range(files)]
    for i, p in enumerate(paths):
        _write(root, p, rng, i)
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "base")
    return paths


def run(files: int = 300, commits: int = 10, touch: int = 3, seed: int = 7) -> Dict[str, Any]:
    tmp = tempfile.mkdtemp(prefix="sealbench-")
    try:
        repo = os.path.join(tmp, "r")
        paths = make_repo(repo, files, seed)
        rng = random.Random(seed + 1)
        shas = [_git(repo, "rev-parse", "HEAD")]
        for c in range(commits):
            for p in rng.sample(paths, touch):
                _write(repo, p, rng, 1000 + c)
            if c % 4 == 3:                                     # sometimes add and delete a file too
                newp = "mod99/new%03d.py" % c
                _write(repo, newp, rng, 2000 + c)
                paths.append(newp)
                victim = paths.pop(rng.randrange(len(paths) - 1))
                _git(repo, "rm", "-q", victim)
            _git(repo, "add", "-A")
            _git(repo, "commit", "-q", "-m", "seal %d" % c)
            shas.append(_git(repo, "rev-parse", "HEAD"))

        # incremental: one snapshot, then one layer per commit, shared cache
        cache = BlobCache()
        g = VersionedGraph(repo, cache, extract)
        t0 = time.perf_counter()
        g.snapshot(shas[0])
        t_base = time.perf_counter() - t0
        base_files = g.files_extracted
        t0 = time.perf_counter()
        for s in shas[1:]:
            g.advance(s)
        t_inc = time.perf_counter() - t0
        inc_files = g.files_extracted - base_files

        # full rescan per commit with a cold cache (what 'rescan after every seal' costs)
        full_files, t_full, mismatches = 0, 0.0, 0
        for s in shas[1:]:
            fresh = VersionedGraph(repo, BlobCache(), extract)
            t0 = time.perf_counter()
            fresh.snapshot(s)
            t_full += time.perf_counter() - t0
            full_files += fresh.files_extracted
            if fresh.as_of(s) != g.as_of(s):
                mismatches += 1
        # an old version is still answered exactly
        old_ok = VersionedGraph(repo, BlobCache(), extract)
        old_ok.snapshot(shas[len(shas) // 2])
        historic_ok = old_ok.as_of(shas[len(shas) // 2]) == g.as_of(shas[len(shas) // 2])
        stale = g.stale(shas[1], [paths[0], paths[1]])
        return {"files": files, "commits": commits, "touch_per_commit": touch,
                "base_scan_s": round(t_base, 3), "base_files": base_files,
                "incremental_s": round(t_inc, 3), "incremental_files": inc_files,
                "full_rescan_s": round(t_full, 3), "full_rescan_files": full_files,
                "speedup": round(t_full / t_inc, 1) if t_inc else None,
                "as_of_mismatches": mismatches, "historic_as_of_ok": historic_ok,
                "stale_example": sorted(stale)}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", type=int, default=300)
    ap.add_argument("--commits", type=int, default=10)
    ap.add_argument("--touch", type=int, default=3)
    a = ap.parse_args()
    r = run(a.files, a.commits, a.touch)
    for k, v in r.items():
        print("%-20s %s" % (k, v))
    return 0 if r["as_of_mismatches"] == 0 and r["historic_as_of_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
