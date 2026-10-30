"""Incremental rescans: a content-addressed scan cache, a versioned graph and a coalescing rescan queue.

    cache = BlobCache(directory=None)                       # blob sha -> extracted facts (shared by every reader)
    g = VersionedGraph(repo, cache, extract)                # extract(path, text) -> dict
    g.snapshot(base_sha)                                    # first full scan (cached blobs are free)
    g.advance(new_sha)                                      # after a seal: only changed blobs are extracted
    g.as_of(sha)                                            # {path: facts} exactly as that commit had it
    g.stale(version_sha, touched_paths)                     # lazy freshness: which touched paths changed since
    q = RescanQueue(); q.request(repo, sha, priority); q.next(); q.done(repo)   # coalesced, single-flight

Why: after every seal a full rescan of the repo is wasted work; a seal changes a handful of files. The
cache is keyed by blob sha + file extension + extractor version, so the same file content is extracted
once, whatever repo, commit or consumer asks for it.
"""

from __future__ import annotations

import hashlib
import heapq
import itertools
import json
import os
import subprocess
import threading
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

Extract = Callable[[str, str], Dict[str, Any]]


def git(repo: str, *args: str) -> str:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True,
                          encoding="utf-8", errors="replace").stdout


def ls_tree(repo: str, sha: str) -> Dict[str, str]:
    out = {}
    for line in git(repo, "ls-tree", "-r", sha).splitlines():
        meta, path = line.split("\t", 1)
        parts = meta.split()
        if len(parts) == 3 and parts[1] == "blob":
            out[path] = parts[2]
    return out


def cat_blobs(repo: str, blobs: Iterable[str]) -> Dict[str, str]:
    """Read many blobs with one git process."""
    blobs = list(dict.fromkeys(blobs))
    if not blobs:
        return {}
    p = subprocess.run(["git", "-C", repo, "cat-file", "--batch"], input=("\n".join(blobs) + "\n").encode(),
                       capture_output=True, check=True)
    data, out, i = p.stdout, {}, 0
    for b in blobs:
        nl = data.index(b"\n", i)
        head = data[i:nl].decode().split()
        size = int(head[2]) if len(head) == 3 else 0
        out[b] = data[nl + 1:nl + 1 + size].decode("utf-8", "replace")
        i = nl + 1 + size + 1
    return out


class BlobCache:
    def __init__(self, directory: Optional[str] = None, extractor_version: str = "1"):
        self.directory = directory
        self.version = extractor_version
        self._mem: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self.hits = self.misses = 0

    def key(self, blob: str, path: str) -> str:
        ext = os.path.splitext(path)[1].lower()
        return hashlib.sha1(("%s|%s|%s" % (blob, ext, self.version)).encode()).hexdigest()

    def get(self, blob: str, path: str) -> Optional[Dict[str, Any]]:
        k = self.key(blob, path)
        with self._lock:
            if k in self._mem:
                self.hits += 1
                return self._mem[k]
        if self.directory:
            f = os.path.join(self.directory, k[:2], k + ".json")
            if os.path.isfile(f):
                with open(f, encoding="utf-8") as fh:
                    v = json.load(fh)
                with self._lock:
                    self._mem[k] = v
                    self.hits += 1
                return v
        return None

    def put(self, blob: str, path: str, facts: Dict[str, Any]) -> None:
        k = self.key(blob, path)
        with self._lock:
            self._mem[k] = facts
            self.misses += 1
        if self.directory:
            d = os.path.join(self.directory, k[:2])
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, k + ".json"), "w", encoding="utf-8") as fh:
                json.dump(facts, fh)


class VersionedGraph:
    """Base snapshot + one delta layer per later commit. Readers ask for a commit; nothing is rebuilt."""

    def __init__(self, repo: str, cache: BlobCache, extract: Extract):
        self.repo, self.cache, self.extract = repo, cache, extract
        self.base_sha = ""
        self._base: Dict[str, str] = {}                         # path -> blob
        self._layers: List[Tuple[str, Dict[str, Optional[str]]]] = []   # (sha, {path: blob | None})
        self._lock = threading.Lock()
        self.files_extracted = 0

    def _scan(self, files: Dict[str, str]) -> None:
        todo: Dict[str, Tuple[str, str]] = {}                   # cache key -> (path, blob): one extract per key
        for p, b in files.items():
            k = self.cache.key(b, p)
            if k not in todo and self.cache.get(b, p) is None:
                todo[k] = (p, b)
        texts = cat_blobs(self.repo, (b for _, b in todo.values()))
        for p, b in todo.values():
            self.cache.put(b, p, self.extract(p, texts.get(b, "")))
            self.files_extracted += 1

    def snapshot(self, sha: str) -> None:
        files = ls_tree(self.repo, sha)
        self._scan(files)
        with self._lock:
            self.base_sha, self._base, self._layers = sha, files, []

    def head(self) -> str:
        return self._layers[-1][0] if self._layers else self.base_sha

    def _files_at(self, idx: int) -> Dict[str, str]:
        files = dict(self._base)
        for _, layer in self._layers[:idx]:
            for p, b in layer.items():
                if b is None:
                    files.pop(p, None)
                else:
                    files[p] = b
        return files

    def advance(self, sha: str) -> Set[str]:
        """Add a layer for sha (a descendant of head). Returns the changed paths."""
        new = ls_tree(self.repo, sha)
        with self._lock:
            old = self._files_at(len(self._layers))
        layer: Dict[str, Optional[str]] = {p: b for p, b in new.items() if old.get(p) != b}
        layer.update({p: None for p in old if p not in new})
        self._scan({p: b for p, b in layer.items() if b})
        with self._lock:
            self._layers.append((sha, layer))
        return set(layer)

    def _index(self, sha: str) -> int:
        if sha == self.base_sha:
            return 0
        for i, (s, _) in enumerate(self._layers):
            if s == sha:
                return i + 1
        raise KeyError("unknown version %s" % sha)

    def as_of(self, sha: str) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            files = self._files_at(self._index(sha))
        return {p: self.cache.get(b, p) or {} for p, b in files.items()}

    def changed_since(self, old_sha: str, new_sha: str = "") -> Set[str]:
        with self._lock:
            a, b = self._index(old_sha), self._index(new_sha or self.head())
            out: Set[str] = set()
            for _, layer in self._layers[a:b]:
                out |= set(layer)
            return out

    def stale(self, version_sha: str, touched: Iterable[str]) -> Set[str]:
        """Lazy freshness: the touched paths that changed after the version a batch read."""
        return set(touched) & self.changed_since(version_sha)


class RescanQueue:
    """One rescan per repo at a time; requests that arrive meanwhile collapse into one with the newest
    sha and the highest priority."""

    def __init__(self):
        self._lock = threading.Lock()
        self._want: Dict[str, Tuple[str, float]] = {}          # repo -> (sha, priority)
        self._running: Set[str] = set()
        self._heap: List[Tuple[float, int, str]] = []
        self._tick = itertools.count()
        self.requests = self.runs = self.coalesced = 0

    def request(self, repo: str, sha: str, priority: float = 0.0) -> None:
        with self._lock:
            self.requests += 1
            if repo in self._want:
                self.coalesced += 1
                priority = max(priority, self._want[repo][1])
            self._want[repo] = (sha, priority)
            heapq.heappush(self._heap, (-priority, next(self._tick), repo))

    def next(self) -> Optional[Tuple[str, str]]:
        with self._lock:
            while self._heap:
                negp, _, repo = heapq.heappop(self._heap)
                if repo not in self._want or repo in self._running or -negp != self._want[repo][1]:
                    continue
                sha, _ = self._want.pop(repo)
                self._running.add(repo)
                self.runs += 1
                return repo, sha
            return None

    def done(self, repo: str) -> None:
        with self._lock:
            self._running.discard(repo)
            if repo in self._want:                              # arrived while running: run again later
                heapq.heappush(self._heap, (-self._want[repo][1], next(self._tick), repo))

    def pending(self) -> int:
        with self._lock:
            return len(self._want)
