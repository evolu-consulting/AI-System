"""LINE_SCAN_CACHE: content-addressed scan cache for feature migrations (line.seal.scancache underneath).

    d = cache_dir(cfg, migration_dir)          # "" = off; "1" -> <migration dir>/scancache; else a shared dir
    llm = CachedLlm(llm, d)                    # model answers keyed by sha1(role, prompt, schema, model)
    fresh = freshness(d, v2_path, scanned_sha, touched)   # as-of graph: what changed on v2 since the scan

Why content-addressed: the expensive part of a scan is the model reading chunks of code. A chunk's prompt
is built from the files' text, so an unchanged chunk yields the same prompt and its answer is reused - by a
resumed migration, by the next migration of the same estate, or by another repository that vendors the same
files. A commit that changes three files re-sends only the chunks holding them. The per-repository commit
cache of scan.py stays in front of this (same sha: nothing is read at all).

freshness() keeps a VersionedGraph of the v2 repository (base = the commit the inventory read, one layer per
later commit, per-file facts cached by blob sha): when the target moved before the build (another run sealed
and merged), the blast radius is recomputed if a path it relies on changed, and the report says so.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from typing import Any, Dict, Iterable, Mapping, Optional

from ..contracts import LlmResult
from ..seal.scancache import BlobCache, VersionedGraph
from ..ship._util import git

_IDENT = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b")
CACHE_VERSION = "1"


def cache_dir(cfg: Any, migration_dir: str) -> str:
    v = str(getattr(cfg, "scan_cache", "") or "").strip()
    if v.lower() in ("", "0", "false", "off", "no"):
        return ""
    d = os.path.join(migration_dir, "scancache") if v.lower() in ("1", "true", "on", "yes") else os.path.abspath(v)
    os.makedirs(d, exist_ok=True)
    return d


class CachedLlm:
    """LlmPort wrapper: complete() answers from the cache when the same role saw the same prompt before."""

    def __init__(self, inner: Any, directory: str):
        self.inner = inner
        self.directory = os.path.join(directory, "llm")
        os.makedirs(self.directory, exist_ok=True)
        self._lock = threading.Lock()
        self.hits = self.misses = 0

    def _key(self, role: str, prompt: str, schema: Any, model: Any) -> str:
        blob = json.dumps([CACHE_VERSION, role, prompt, schema, model or ""], sort_keys=True, default=str)
        return hashlib.sha1(blob.encode("utf-8", "replace")).hexdigest()

    def complete(self, role: str, prompt: str, schema: Any = None, **kw: Any) -> Any:
        k = self._key(role, prompt, schema, kw.get("model"))
        path = os.path.join(self.directory, k[:2], k + ".json")
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    hit = json.load(fh)
                with self._lock:
                    self.hits += 1
                return LlmResult(hit.get("data"), hit.get("text", ""), {}, 0.0, hit.get("model", ""), "")
            except (OSError, ValueError):
                pass
        res = self.inner.complete(role, prompt, schema, **kw)
        with self._lock:
            self.misses += 1
        if getattr(res, "data", None) is not None or getattr(res, "text", ""):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".%d.tmp" % threading.get_ident()
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"data": res.data, "text": res.text, "model": getattr(res, "model", ""), "role": role}, fh)
            os.replace(tmp, path)
        return res

    def stats(self) -> Dict[str, int]:
        return {"hits": self.hits, "misses": self.misses}

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)


def _facts_of(path: str, text: str) -> Dict[str, Any]:
    """Per-file facts for the as-of graph: the identifiers a file declares or uses."""
    return {"identifiers": sorted(set(_IDENT.findall(text or "")))[:2000]}


def is_git(path: str) -> bool:
    return bool(path) and git(path, "rev-parse", "-q", "--verify", "HEAD", check=False).returncode == 0


def head(path: str) -> str:
    cp = git(path, "rev-parse", "HEAD", check=False)
    return cp.stdout.strip() if cp.returncode == 0 else ""


def freshness(directory: str, repo: str, scanned_sha: str, touched: Iterable[str] = ()) -> Dict[str, Any]:
    """{"scanned", "head", "changed": [paths], "stale": [touched paths that changed], "extracted": n}."""
    out: Dict[str, Any] = {"scanned": scanned_sha, "head": "", "changed": [], "stale": [], "extracted": 0}
    if not directory or not scanned_sha or not is_git(repo):
        return out
    now = head(repo)
    out["head"] = now
    if now == scanned_sha:
        return out
    g = VersionedGraph(repo, BlobCache(os.path.join(directory, "blobs")), _facts_of)
    g.snapshot(scanned_sha)
    changed = sorted(g.advance(now))
    out["changed"] = changed
    out["stale"] = sorted(g.stale(scanned_sha, touched))
    out["extracted"] = g.files_extracted
    return out


__all__ = ["cache_dir", "CachedLlm", "freshness", "head", "is_git"]
