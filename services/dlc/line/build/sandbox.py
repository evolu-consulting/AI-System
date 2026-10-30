"""Sandbox (block 11): one git worktree per unit of the target repo, under the line's workroot.

  sb = Sandbox(repo, workroot)            # workroot default: config.workroot (LINE_WORKROOT)
  path = sb.create(unit)                  # git worktree add -B line/<run>/<unit> <workroot>/<run>/<unit> <base>
  d = sb.diff(unit)                       # Diff(files=[(status, path)], patch, base); untracked included
  sb.cleanup(unit, delete_branch=False)   # git worktree remove --force; prune

create() is idempotent: an existing worktree of the unit is reused (retry from checkpoint).
The base is the commit the target repo's HEAD pointed at when the worktree was made; it is
kept in git as the ref refs/line-base/<run>/<unit>, so diff() needs no outside state.
Build noise (__pycache__, *.pyc, .pytest_cache) is ignored. Git failures raise
LineError(BUILD_FAIL) with the git command and stderr in detail.
"""

from __future__ import annotations

import fnmatch
import hashlib
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..config import Config
from ..contracts import Unit, from_dict
from ._common import cfg_or_default

IGNORED = ("__pycache__/*", "*/__pycache__/*", "*.pyc", ".pytest_cache/*", "*/.pytest_cache/*",
           "node_modules/*", "*/node_modules/*")
#: never part of a unit's change, even where the repo's own .gitignore forgot them (a new Node app has none yet):
#: written to the repo's info/exclude, which every unit worktree shares
EXCLUDE = ("node_modules/", "__pycache__/", ".pytest_cache/")
#: paths per `git diff -- <paths>` call: Windows refuses a command line over 32k characters
PATHS_PER_CALL = 200


@dataclass
class Diff:
    base: str
    files: List[Tuple[str, str]] = field(default_factory=list)   # (status A/M/D/..., repo-relative path)
    patch: str = ""

    @property
    def paths(self) -> List[str]:
        return [p for _, p in self.files]

    @property
    def empty(self) -> bool:
        return not self.files

    @property
    def sha(self) -> str:
        return hashlib.sha1(self.patch.encode("utf-8", "replace")).hexdigest() if self.files else ""


def _git(cwd: str, *args: str, check: bool = True) -> str:
    cmd = ["git", "-c", "core.safecrlf=false", "-c", "core.quotepath=false"] + list(args)
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
    out = p.stdout.decode("utf-8", "replace")
    if check and p.returncode != 0:
        raise LineError(codes.BUILD_FAIL, "git %s failed: %s" % (args[0], p.stderr.decode("utf-8", "replace").strip()),
                        {"cmd": list(args), "cwd": cwd, "rc": p.returncode})
    return out


def _uid(unit: Any) -> Tuple[str, str]:
    if isinstance(unit, Unit):
        return unit.run, unit.id
    if isinstance(unit, Mapping):
        return str(unit.get("run", "")), str(unit["id"])
    raise TypeError("unit must be a Unit or a unit row")


def same_path_key(path: str) -> str:
    """Comparable form of a path: realpath (resolves Windows 8.3 short names such as STHUYT~1 and links,
    as git prints the long form) + normcase."""
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def _safe(s: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in s) or "_"


class Sandbox:
    def __init__(self, repo: str, workroot: Optional[str] = None, cfg: Optional[Config] = None,
                 base_ref: str = "HEAD"):
        self.repo = os.path.abspath(repo)
        self.workroot = os.path.abspath(workroot or cfg_or_default(cfg).workroot)
        self.base_ref = base_ref

    # names
    def path(self, unit: Any) -> str:
        run, uid = _uid(unit)
        return os.path.join(self.workroot, _safe(run), _safe(uid))

    def branch(self, unit: Any) -> str:
        run, uid = _uid(unit)
        return "line/%s/%s" % (_safe(run), _safe(uid))

    def _base_ref(self, unit: Any) -> str:
        run, uid = _uid(unit)
        return "refs/line-base/%s/%s" % (_safe(run), _safe(uid))

    def _registered(self, path: str) -> bool:
        out = _git(self.repo, "worktree", "list", "--porcelain")
        want = same_path_key(path)
        for line in out.splitlines():
            if line.startswith("worktree "):
                if same_path_key(line[9:].strip()) == want:
                    return True
        return False

    # api
    def create(self, unit: Any) -> str:
        path = self.path(unit)
        if os.path.isdir(path) and self._registered(path):
            return path
        if os.path.exists(path):          # stale directory from a crash: drop it
            shutil.rmtree(path, ignore_errors=True)
        _git(self.repo, "worktree", "prune")
        base = _git(self.repo, "rev-parse", "--verify", self.base_ref + "^{commit}").strip()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self._exclude()
        _git(self.repo, "worktree", "add", "-f", "-B", self.branch(unit), path, base)
        _git(self.repo, "update-ref", self._base_ref(unit), base)
        return path

    def _exclude(self) -> None:
        """EXCLUDE in the repo's info/exclude (once): a builder's `npm install` in a new app without a .gitignore
        staged 2,000 files of node_modules into its change."""
        try:
            common = _git(self.repo, "rev-parse", "--git-common-dir").strip()
            info = os.path.join(common if os.path.isabs(common) else os.path.join(self.repo, common), "info")
            fn = os.path.join(info, "exclude")
            have = open(fn, encoding="utf-8", errors="replace").read().splitlines() if os.path.isfile(fn) else []
            add = [e for e in EXCLUDE if e not in have]
            if add:
                os.makedirs(info, exist_ok=True)
                with open(fn, "a", encoding="utf-8", newline="\n") as fh:
                    if have and have[-1].strip():
                        fh.write("\n")
                    fh.write("# line: never part of a unit's change\n" + "\n".join(add) + "\n")
        except (OSError, LineError):
            pass

    def base(self, unit: Any) -> str:
        return _git(self.repo, "rev-parse", "--verify", self._base_ref(unit)).strip()

    def diff(self, unit: Any) -> Diff:
        """Everything the builder changed vs the base: committed, staged, unstaged and untracked."""
        path = self.path(unit)
        if not os.path.isdir(path):
            raise LineError(codes.NOT_FOUND, "no worktree for unit", {"path": path})
        base = self.base(unit)
        _git(path, "add", "-A")
        files: List[Tuple[str, str]] = []
        for line in _git(path, "diff", "--cached", "--no-renames", "--name-status", base).splitlines():
            if not line.strip():
                continue
            status, _, p = line.partition("\t")
            p = p.strip().replace("\\", "/")
            if any(fnmatch.fnmatchcase(p, pat) for pat in IGNORED):
                continue
            files.append((status.strip()[:1], p))
        paths = [p for _, p in files]
        patch = "".join(_git(path, "diff", "--cached", "--no-renames", base, "--", *paths[i:i + PATHS_PER_CALL])
                        for i in range(0, len(paths), PATHS_PER_CALL))
        _git(path, "reset", "-q", check=False)      # leave the builder's index as it was (unstaged)
        return Diff(base=base, files=files, patch=patch)

    def cleanup(self, unit: Any, delete_branch: bool = False) -> None:
        path = self.path(unit)
        if os.path.isdir(path) and self._registered(path):
            _git(self.repo, "worktree", "remove", "--force", path, check=False)
        if os.path.exists(path):
            shutil.rmtree(path, ignore_errors=True)
        _git(self.repo, "worktree", "prune", check=False)
        if delete_branch:
            _git(self.repo, "branch", "-D", self.branch(unit), check=False)
            _git(self.repo, "update-ref", "-d", self._base_ref(unit), check=False)
