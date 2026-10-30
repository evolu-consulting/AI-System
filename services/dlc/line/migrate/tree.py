"""Read-only view of one code tree: a git repository at a ref, or a working directory.

Tree(path, ref="")      ref given -> files come from `git ls-tree` / `git show` (the working tree is never
                        touched); no ref -> the directory on disk (VCS and build folders skipped).
  files()               sorted relative paths ("/" separators) of the text files worth reading
  read(path)            text of one file ("" when it is not there or not text)
  chunks(max_chars)     [("all", paths)] when the tree fits, else [(name, [paths])] grouped by top-level
                        folder, each at most max_chars of text
  find(words)           {word: [paths]} source files (not config/data, not test fixtures) containing the word
"""

from __future__ import annotations

import os
import re
from typing import Dict, Iterable, List, Optional, Tuple

from .. import codes
from ..codes import LineError
from ..ship._util import git

SKIP_DIRS = {".git", "__pycache__", "node_modules", "dist", "build", ".venv", "venv", ".idea", ".vscode",
             ".mypy_cache", ".pytest_cache", "coverage", ".tox", "target", "bin", "obj"}
TEXT_EXT = {".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".kt", ".cs", ".go", ".rb", ".php", ".abap", ".cds",
            ".sql", ".xml", ".html", ".css", ".scss", ".vue", ".md", ".txt", ".json", ".yaml", ".yml", ".toml",
            ".ini", ".cfg", ".properties", ".sh", ".ps1", ".bat", ".csv", ".graphql", ".proto"}
#: config / data files: read by the inventory, but never proof that a feature is BUILT (they name things
#: that may never have been implemented)
NON_SOURCE_EXT = {".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".properties", ".csv", ".md", ".txt"}
MAX_FILE_CHARS = 60000
FIXTURE_SEGS = ("fixtures", "fixture", "__fixtures__", "testdata", "test-data", "mocks", "__mocks__")


class Tree:
    def __init__(self, path: str, ref: str = ""):
        self.path = os.path.abspath(path)
        self.ref = ref or ""
        if not os.path.isdir(self.path):
            raise LineError(codes.NOT_FOUND, "tree %s does not exist" % self.path, {"path": self.path})
        if self.ref and git(self.path, "rev-parse", "-q", "--verify", self.ref + "^{commit}",
                            check=False).returncode != 0:
            raise LineError(codes.NOT_FOUND, "ref %s not found in %s" % (self.ref, self.path),
                            {"path": self.path, "ref": self.ref})
        self._files: Optional[List[str]] = None
        self._cache: Dict[str, str] = {}

    def label(self) -> str:
        return "%s@%s" % (self.path, self.ref) if self.ref else self.path

    def files(self) -> List[str]:
        if self._files is None:
            if self.ref:
                out = git(self.path, "ls-tree", "-r", "--name-only", self.ref).stdout.splitlines()
                names = [p.strip() for p in out if p.strip()]
            else:
                names = []
                for root, dirs, fnames in os.walk(self.path):
                    dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".line"))
                    for f in fnames:
                        names.append(os.path.relpath(os.path.join(root, f), self.path).replace("\\", "/"))
            keep = []
            for p in names:
                parts = p.split("/")
                if any(seg in SKIP_DIRS for seg in parts[:-1]):
                    continue
                if os.path.splitext(p)[1].lower() in TEXT_EXT:
                    keep.append(p)
            self._files = sorted(keep)
        return list(self._files)

    def read(self, rel: str) -> str:
        rel = rel.replace("\\", "/").lstrip("/")
        if rel in self._cache:
            return self._cache[rel]
        text = ""
        if self.ref:
            cp = git(self.path, "show", "%s:%s" % (self.ref, rel), check=False)
            text = cp.stdout if cp.returncode == 0 else ""
        else:
            full = os.path.join(self.path, rel)
            if os.path.isfile(full):
                try:
                    with open(full, encoding="utf-8", errors="replace") as fh:
                        text = fh.read(MAX_FILE_CHARS + 1)
                except OSError:
                    text = ""
        text = text.replace("\r\n", "\n")[:MAX_FILE_CHARS]
        self._cache[rel] = text
        return text

    def chunks(self, max_chars: int) -> List[Tuple[str, List[str]]]:
        files = self.files()
        if sum(len(self.read(p)) for p in files) <= max_chars:
            return [("all", files)] if files else []
        groups: Dict[str, List[str]] = {}
        for p in files:
            top = p.split("/")[0] if "/" in p else "root"
            groups.setdefault(top, []).append(p)
        out: List[Tuple[str, List[str]]] = []
        for name in sorted(groups):
            cur: List[str] = []
            size = 0
            n = 0
            for p in groups[name]:
                ln = len(self.read(p))
                if cur and size + ln > max_chars:
                    out.append(("%s.%d" % (name, n) if n else name, cur))
                    n += 1
                    cur, size = [], 0
                cur.append(p)
                size += ln
            if cur:
                out.append(("%s.%d" % (name, n) if n else name, cur))
        return out

    def render(self, paths: Iterable[str]) -> str:
        """Files as the model sees them: a header per file and numbered lines."""
        parts = []
        for p in paths:
            body = self.read(p)
            lines = body.split("\n")
            parts.append("=== %s (%d lines)\n%s" % (p, len(lines), "\n".join(
                "%4d| %s" % (i + 1, ln) for i, ln in enumerate(lines))))
        return "\n\n".join(parts)

    def contains(self, rel: str, quote: str) -> bool:
        """Is quote in the file (whitespace-normalized)?"""
        q = _norm(quote)
        return bool(q) and q in _norm(self.read(rel))

    def find(self, words: Iterable[str], source_only: bool = True) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {}
        pats = {w: re.compile(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9_])" % re.escape(w)) for w in words if w and len(w) >= 3}
        if not pats:
            return out
        for p in self.files():
            if source_only and os.path.splitext(p)[1].lower() in NON_SOURCE_EXT:
                continue
            if any(seg in FIXTURE_SEGS for seg in p.lower().split("/")[:-1]):
                continue                    # test fixtures are not product code
            text = self.read(p)
            for w, rx in pats.items():
                if rx.search(text):
                    out.setdefault(w, []).append(p)
        return out


def _norm(s: str) -> str:
    return " ".join((s or "").split())


__all__ = ["Tree", "NON_SOURCE_EXT", "MAX_FILE_CHARS"]
