"""Multi-repo ESTATES: a product made of many git repositories (one per layer / object / app) is detected,
scanned PER REPO and merged into one result. Nothing ever reads the whole estate in one pass.

    repos = detect(path, manifest="", default_ref="")   # [{"name", "path", "ref", "sha"}]
    side = open_side(path, manifest="", default_ref="")  # a Tree (one repo) or an Estate (several)

detect():
  - path is a git repository (".git" dir or file)  -> one repo, today's single-tree behaviour
  - else the git repositories under path, searched to MAX_DEPTH levels; a repository is not searched
    further down; SKIP_DIRS (node_modules, vendor, build output, ...) are never entered
  - manifest (JSON or text) overrides detection:
        JSON  {"repos": [{"path": "...", "ref"?: "...", "name"?: "..."}]}  or the bare list
        text  one repo per line: "<path> [ref]"; '#' starts a comment; Markdown list bullets are ignored
    relative paths resolve against the manifest's folder.
Per-repo ref: the manifest's ref, else default_ref when that ref exists in the repo (a branch or tag name
shared by the estate), else HEAD (the repo's current checkout). A repo without commits is read from disk.

Estate offers the read API of Tree (files / read / contains / find / render / label) over all its repos,
with every path prefixed by the repo name ("<repo>/<path>"). So everything after the inventory (match,
confirmation pass, matrix, blast radius, report) runs on the merged estate unchanged, and the confirmation
pass searches the UNION of all repos of the other side, never one repo.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

from .. import codes
from ..codes import LineError
from ..ship._util import git
from .tree import SKIP_DIRS, Tree

MAX_DEPTH = 3
#: folders never searched for repositories (dependencies, build output, vendored code)
ESTATE_SKIP = set(SKIP_DIRS) | {"vendor", "third_party", "third-party", "bower_components", ".git"}


def is_repo(path: str) -> bool:
    return os.path.exists(os.path.join(path, ".git"))


def _ref_exists(path: str, ref: str) -> bool:
    return bool(ref) and git(path, "rev-parse", "-q", "--verify", ref + "^{commit}", check=False).returncode == 0


def _sha(path: str, ref: str) -> str:
    cp = git(path, "rev-parse", "-q", "--verify", (ref or "HEAD") + "^{commit}", check=False)
    return cp.stdout.strip() if cp.returncode == 0 else ""


def find_repos(root: str, max_depth: int = MAX_DEPTH) -> List[str]:
    """Git repositories under root (root itself excluded), breadth first, sorted by relative path."""
    out: List[str] = []
    frontier: List[Tuple[str, int]] = [(root, 0)]
    while frontier:
        d, depth = frontier.pop(0)
        if depth >= max_depth:
            continue
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        for n in names:
            full = os.path.join(d, n)
            if n in ESTATE_SKIP or n.startswith(".") or not os.path.isdir(full):
                continue
            if is_repo(full):
                out.append(full)
            else:
                frontier.append((full, depth + 1))
    return sorted(out, key=lambda p: os.path.relpath(p, root).replace("\\", "/").lower())


def read_manifest(path: str) -> List[Dict[str, str]]:
    """Repo list from a manifest file (see module doc)."""
    if not os.path.isfile(path):
        raise LineError(codes.NOT_FOUND, "repos manifest %s not found" % path, {"path": path})
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    base = os.path.dirname(os.path.abspath(path))
    items: List[Dict[str, str]] = []
    stripped = text.strip()
    if stripped.startswith(("{", "[")):
        try:
            data = json.loads(stripped)
        except ValueError as e:
            raise LineError(codes.CONFIG_INVALID, "repos manifest %s is not valid JSON: %s" % (path, e),
                            {"path": path}) from e
        rows = data.get("repos") if isinstance(data, Mapping) else data
        for r in rows or []:
            if isinstance(r, str):
                r = {"path": r}
            if isinstance(r, Mapping) and r.get("path"):
                items.append({"path": str(r["path"]), "ref": str(r.get("ref") or ""), "name": str(r.get("name") or "")})
    else:
        for line in text.splitlines():
            line = re.sub(r"#.*", "", line).strip()
            line = re.sub(r"^[-*+]\s+|^\d+[.)]\s+", "", line).strip().strip("`")
            if not line or line.startswith("|"):
                continue
            parts = line.split()
            items.append({"path": parts[0], "ref": parts[1] if len(parts) > 1 else "", "name": ""})
    out = []
    for it in items:
        p = it["path"] if os.path.isabs(it["path"]) else os.path.join(base, it["path"])
        it["path"] = os.path.abspath(p)
        out.append(it)
    if not out:
        raise LineError(codes.CONFIG_INVALID, "repos manifest %s lists no repository" % path, {"path": path})
    return out


def _name(root: str, path: str) -> str:
    rel = os.path.relpath(path, root).replace("\\", "/")
    return os.path.basename(path) if rel.startswith("..") or rel == "." else rel


def detect(path: str, manifest: str = "", default_ref: str = "", max_depth: int = MAX_DEPTH) -> List[Dict[str, str]]:
    """The repositories of one side: [{"name", "path", "ref", "sha"}] (one item = a single tree)."""
    path = os.path.abspath(path)
    if manifest:
        listed = read_manifest(manifest)
    elif is_repo(path):
        return [{"name": os.path.basename(path), "path": path, "ref": default_ref, "sha": _sha(path, default_ref),
                 "single": "1"}]
    else:
        if not os.path.isdir(path):
            raise LineError(codes.NOT_FOUND, "%s does not exist" % path, {"path": path})
        listed = [{"path": p, "ref": "", "name": ""} for p in find_repos(path, max_depth)]
        if not listed:
            raise LineError(codes.NOT_FOUND, "%s is neither a git repository nor a folder of git repositories "
                            "(searched %d levels)" % (path, max_depth), {"path": path})
    out: List[Dict[str, str]] = []
    seen = set()
    for it in listed:
        p = it["path"]
        if not os.path.isdir(p) or not is_repo(p):
            raise LineError(codes.NOT_FOUND, "%s is not a git repository" % p, {"path": p})
        ref = it.get("ref") or ""
        if ref and not _ref_exists(p, ref):
            raise LineError(codes.NOT_FOUND, "ref %s not found in %s" % (ref, p), {"path": p, "ref": ref})
        if not ref:
            ref = default_ref if _ref_exists(p, default_ref) else ("HEAD" if _ref_exists(p, "HEAD") else "")
        name = it.get("name") or _name(path, p)
        base, n = name, 2
        while name in seen:
            name, n = "%s~%d" % (base, n), n + 1
        seen.add(name)
        out.append({"name": name, "path": p, "ref": ref, "sha": _sha(p, ref)})
    return out


def is_estate(repos: Sequence[Mapping[str, Any]]) -> bool:
    return not (len(repos) == 1 and repos[0].get("single"))


class Estate:
    """Several repositories read as one tree: paths are '<repo name>/<path in repo>'."""

    def __init__(self, root: str, repos: Sequence[Mapping[str, Any]], trees: Optional[Mapping[str, Tree]] = None):
        self.path = os.path.abspath(root)
        self.ref = ""
        self.repos = [dict(r) for r in repos]
        self.trees: Dict[str, Tree] = dict(trees or {})
        for r in self.repos:
            if r["name"] not in self.trees and r.get("path"):
                self.trees[r["name"]] = Tree(r["path"], r.get("ref") or "")
        # longest names first, so 'a/b' wins over 'a' when both are repos
        self._names = sorted(self.trees, key=len, reverse=True)

    def label(self) -> str:
        return "%s (%d repositories)" % (self.path, len(self.trees))

    def split(self, rel: str) -> Tuple[Optional[Tree], str]:
        rel = rel.replace("\\", "/").lstrip("/")
        for n in self._names:
            if rel.startswith(n + "/"):
                return self.trees[n], rel[len(n) + 1:]
        return None, rel

    def files(self) -> List[str]:
        out: List[str] = []
        for n in sorted(self.trees):
            out += ["%s/%s" % (n, p) for p in self.trees[n].files()]
        return out

    def read(self, rel: str) -> str:
        t, p = self.split(rel)
        return t.read(p) if t is not None else ""

    def contains(self, rel: str, quote: str) -> bool:
        t, p = self.split(rel)
        return bool(t is not None and t.contains(p, quote))

    def find(self, words: Iterable[str], source_only: bool = True) -> Dict[str, List[str]]:
        words = list(words)
        out: Dict[str, List[str]] = {}
        for n in sorted(self.trees):
            for w, paths in self.trees[n].find(words, source_only=source_only).items():
                out.setdefault(w, []).extend("%s/%s" % (n, p) for p in paths)
        return out

    def render(self, paths: Iterable[str]) -> str:
        parts = []
        for rel in paths:
            t, p = self.split(rel)
            if t is not None:
                parts.append(t.render([p]).replace("=== %s " % p, "=== %s " % rel, 1))
        return "\n\n".join(parts)

    def chunks(self, max_chars: int) -> List[Tuple[str, List[str]]]:
        """Per repo (then per top-level folder inside a big repo) - never the whole estate at once."""
        out: List[Tuple[str, List[str]]] = []
        for n in sorted(self.trees):
            for name, paths in self.trees[n].chunks(max_chars):
                out.append(("%s.%s" % (n, name), ["%s/%s" % (n, p) for p in paths]))
        return out


Side = Union[Tree, Estate]


def open_side(path: str, repos: Sequence[Mapping[str, Any]], ref_override: str = "") -> Side:
    """Tree for a single repo, Estate otherwise. ref_override (e.g. the vanilla base ref) replaces each repo's
    ref; a repo that does not have that ref is left out (for the custom check: nothing of it is vanilla)."""
    if not is_estate(repos):
        return Tree(repos[0]["path"], ref_override or repos[0].get("ref") or "")
    if ref_override:
        kept = [dict(r, ref=ref_override) for r in repos if _ref_exists(r["path"], ref_override)]
        return Estate(path, kept)
    return Estate(path, repos)


# ---------------------------------------------------------------- cross-repo identity

_LAYERS = {"srv", "db", "app", "ui", "api", "svc", "service", "lib", "core", "web", "mta", "approuter", "router",
           "admin", "common", "shared", "job", "jobs", "batch", "model", "data", "ui5", "fiori", "react", "frontend",
           "backend", "server", "client"}


def object_key(repo_name: str) -> str:
    """The business object a layer repository belongs to: 'acme_db_bp', 'acme_srv_bp', 'acme_ui_bp',
    'db-bp', 'srv-bp' -> 'bp'. A name without a layer word keeps its last part ('group/inventory' ->
    'inventory')."""
    base = repo_name.replace("\\", "/").rsplit("/", 1)[-1]
    parts = [p for p in re.split(r"[^a-z0-9]+", re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", base).lower()) if p]
    for i, p in enumerate(parts):
        if p in _LAYERS:
            rest = [x for x in parts[i + 1:] if x not in _LAYERS]
            return "-".join(rest) or p
    return "-".join(parts[-1:]) or base.lower()


__all__ = ["MAX_DEPTH", "Estate", "Side", "detect", "find_repos", "read_manifest", "is_repo", "is_estate",
           "open_side", "object_key"]
