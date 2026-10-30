"""Per-repository scan of one side, then ONE merged result (single repo: the plain old path, unchanged).

scan_side(directory, side, repos, root, llm, ...) -> {"inventory", "facts", "repos", "merged"}

Per repository (bounded pool of `parallel` workers, each result cached on disk):
  extract(tree) -> facts;  inventory(tree, key="<side>.<repo>") -> features   (a big repository is split by
  top-level folder inside inventory(); one model call never covers more than one repository)
  cache   <directory>/repos/<side>/<repo>.json  {"repo", "sha", "status": "ok", "facts", "inventory"}
          a resumed migration skips every repository whose cache is ok at the same sha
  failure one retry, then {"status": "failed", "error"}: the other repositories go on; the side fails only
          when every repository failed (REPO_SCAN_FAILED)

Merge:
  facts     union; paths prefixed '<repo>/'; modules = one per repository (normalised name); identifiers
            = the union, so the confirmation pass always searches the whole other estate
  features  ids '<side>.<repo>.<id>', every path prefixed, provenance kept ("repo", "repos").
            Cross-repo identity (the same business feature split over layer repositories, e.g. the db, srv
            and ui repositories of one object): two features of different repositories with the same OBJECT
            key (estate.object_key of the repository name) are merged when they have the same name (rename
            key) or share an identifier; same object, only a shared entity -> AMBIGUOUS: one model call per
            ambiguous group (role migrate_merge, fixture key '<side>.merge.<n>'); no answer = kept apart.
"""

from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from .. import codes
from ..codes import LineError
from ..llm.port import load_prompt
from . import extract as extract_mod
from . import inventory as inventory_mod
from .estate import object_key
from .tree import Tree

ROLE_MERGE = "migrate_merge"
MAX_GROUP = 12
MERGE_SCHEMA: Dict[str, Any] = {
    "type": "object", "required": ["groups"],
    "properties": {"groups": {"type": "array", "items": {
        "type": "object", "required": ["ids"],
        "properties": {"ids": {"type": "array", "items": {"type": "string"}}, "reason": {"type": "string"}}}}}}

_SLUG = re.compile(r"[^A-Za-z0-9_.-]+")


def slug(name: str) -> str:
    return _SLUG.sub("-", name.replace("/", "-")).strip("-") or "repo"


def _prefix(p: str, repo: str) -> str:
    return "%s/%s" % (repo, p) if p else p


def prefix_feature(f: Mapping[str, Any], side: str, repo: str) -> Dict[str, Any]:
    g = json.loads(json.dumps(f))
    local = str(f["id"])[len(side) + 1:] if str(f["id"]).startswith(side + ".") else str(f["id"])
    g["id"] = "%s.%s.%s" % (side, slug(repo), local)
    for e in g.get("evidence") or []:
        e["path"] = _prefix(e.get("path", ""), repo)
    g["tests"] = [_prefix(t, repo) for t in g.get("tests") or []]
    g["repo"] = repo
    g["repos"] = [repo]
    return g


def merge_facts(per_repo: Sequence[Tuple[str, Mapping[str, Any]]]) -> Dict[str, Any]:
    out = extract_mod.empty_facts()
    for repo, f in per_repo:
        for st in f.get("stacks") or []:
            if st not in out["stacks"]:
                out["stacks"].append(st)
        mk = extract_mod.module_key(repo.rsplit("/", 1)[-1])
        paths = [_prefix(p, repo) for ps in (f.get("modules") or {}).values() for p in ps]
        out["modules"].setdefault(mk, [])
        out["modules"][mk] += paths or [repo + "/"]
        for k in ("services", "entities", "handlers", "catalogue"):
            for n, p in (f.get(k) or {}).items():
                out[k].setdefault(n, _prefix(p, repo))
        for n, ps in (f.get("screens") or {}).items():
            out["screens"].setdefault(n, [])
            out["screens"][n] += [_prefix(p, repo) for p in ps]
        out["identifiers"] |= set(f.get("identifiers") or [])
        out["strings"] |= set(f.get("strings") or [])
        out["fixtures"] += [_prefix(p, repo) for p in f.get("fixtures") or []]
    out["strings"] -= out["identifiers"]
    out["catalogue"] = {n: p for n, p in out["catalogue"].items() if n not in out["identifiers"]}
    for k in ("modules", "screens"):
        out[k] = {n: sorted(set(v)) for n, v in sorted(out[k].items())}
    for k in ("services", "entities", "handlers", "catalogue"):
        out[k] = dict(sorted(out[k].items()))
    out["fixtures"] = sorted(set(out["fixtures"]))
    return out


# ---------------------------------------------------------------- cross-repo identity

def _low(xs: Any) -> set:
    return {str(x).lower() for x in xs or []}


class _UF:
    def __init__(self, ids: Sequence[str]):
        self.p = {i: i for i in ids}

    def find(self, x: str) -> str:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)

    def groups(self) -> List[List[str]]:
        out: Dict[str, List[str]] = {}
        for i in self.p:
            out.setdefault(self.find(i), []).append(i)
        return [sorted(v) for v in out.values()]


def pair_relation(a: Mapping[str, Any], b: Mapping[str, Any]) -> str:
    """'merge' | 'ambiguous' | '' for two features of DIFFERENT repositories of one side."""
    if a.get("repo") == b.get("repo") or object_key(a.get("repo", "")) != object_key(b.get("repo", "")):
        return ""
    if extract_mod.rename_key(a.get("name", "")) == extract_mod.rename_key(b.get("name", "")):
        return "merge"
    if _low(a.get("identifiers")) & _low(b.get("identifiers")):
        return "merge"
    if _low(a.get("entities")) & _low(b.get("entities")):
        return "ambiguous"
    return ""


def combine(group: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
    """One feature from several repositories' parts: the first part's id and name, everything else united."""
    first = dict(group[0])
    out = json.loads(json.dumps(first))
    out["merged_from"] = [g["id"] for g in group]
    out["repos"] = sorted({r for g in group for r in (g.get("repos") or [g.get("repo", "")]) if r})
    beh = []
    for g in group:
        b = (g.get("behaviour") or "").strip()
        if b and b not in beh:
            beh.append(b)
    out["behaviour"] = " ".join(beh)
    for k in ("evidence", "examples"):
        acc: List[Any] = []
        for g in group:
            acc += [x for x in g.get(k) or [] if x not in acc]
        out[k] = acc
    for k in ("identifiers", "entities", "interfaces", "tests"):
        out[k] = sorted({x for g in group for x in g.get(k) or []})
    kinds = [g.get("kind") for g in group if g.get("kind") and g.get("kind") != "other"]
    out["kind"] = kinds[0] if kinds else first.get("kind", "other")
    return out


def merge_features(features: Sequence[Mapping[str, Any]], side: str, llm: Any = None, *, run: str = "",
                   model: Any = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """-> (merged features, merge log [{"ids", "by": rule|model, "reason"}])."""
    feats = [dict(f) for f in features]
    by = {f["id"]: f for f in feats}
    ids = [f["id"] for f in feats]
    uf = _UF(ids)
    amb = _UF(ids)
    log: List[Dict[str, Any]] = []
    for i, a in enumerate(feats):
        for b in feats[i + 1:]:
            rel = pair_relation(a, b)
            if rel == "merge":
                uf.union(a["id"], b["id"])
            elif rel == "ambiguous":
                amb.union(a["id"], b["id"])
    for g in uf.groups():
        if len(g) > 1:
            log.append({"ids": g, "by": "rule", "reason": "same object, same name or a shared identifier"})
    n = 0
    for g in amb.groups():
        roots = sorted({uf.find(x) for x in g})
        if len(roots) < 2:
            continue
        n += 1
        if llm is None or len(roots) > MAX_GROUP:
            log.append({"ids": roots, "by": "skipped", "reason": "ambiguous group kept apart (%s)" % (
                "no model" if llm is None else "%d parts > %d" % (len(roots), MAX_GROUP))})
            continue
        parts = [combine([by[x] for x in sorted(i for i in ids if uf.find(i) == r)]) for r in roots]
        prompt = "\n\n".join([load_prompt(ROLE_MERGE), "## Parts (one business object, several repositories)\n"
                              + json.dumps([{"id": r, "name": p["name"], "repos": p["repos"], "kind": p["kind"],
                                             "behaviour": p["behaviour"], "entities": p["entities"],
                                             "identifiers": p["identifiers"][:40]} for r, p in zip(roots, parts)],
                                           indent=1)])
        try:
            res = llm.complete(ROLE_MERGE, prompt, MERGE_SCHEMA, key="%s.merge.%d" % (side, n), model=model, run=run)
            groups = (res.data or {}).get("groups") or []
        except LineError as e:
            log.append({"ids": roots, "by": "skipped", "reason": "model call failed: %s" % e.code})
            continue
        for grp in groups:
            members = [x for x in (grp.get("ids") or []) if x in roots]
            for x in members[1:]:
                uf.union(members[0], x)
            if len(members) > 1:
                log.append({"ids": members, "by": "model", "reason": str(grp.get("reason") or "")})
    out = []
    for g in sorted(uf.groups(), key=lambda g: ids.index(g[0])):
        group = [by[x] for x in sorted(g, key=ids.index)]
        out.append(group[0] if len(group) == 1 else combine(group))
    return out, log


# ---------------------------------------------------------------- the per-repo scan

def _cache_path(directory: str, side: str, repo: str) -> str:
    return os.path.join(directory, "repos", side, slug(repo) + ".json")


def _load(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _save(path: str, data: Mapping[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def scan_repo(repo: Mapping[str, Any], side: str, llm: Any, *, run: str = "", notes: str = "",
              max_chars: int = inventory_mod.MAX_CHUNK_CHARS, model: Any = None,
              tree_factory: Callable[[str, str], Any] = Tree) -> Dict[str, Any]:
    tree = tree_factory(repo["path"], repo.get("ref") or "")
    facts = extract_mod.extract(tree)
    inv = inventory_mod.inventory(tree, side, llm, run=run, notes=notes, facts=facts, max_chars=max_chars,
                                  model=model, key="%s.%s" % (side, slug(repo["name"])))
    return {"repo": repo["name"], "path": repo["path"], "ref": repo.get("ref") or "", "sha": repo.get("sha") or "",
            "status": "ok", "stacks": facts["stacks"], "facts": extract_mod.serialisable(facts),
            "inventory": {"features": [prefix_feature(f, side, repo["name"]) for f in inv["features"]],
                          "unproven": [prefix_feature(f, side, repo["name"]) for f in inv["unproven"]],
                          "chunks": inv["chunks"]}}


def scan_side(directory: str, side: str, repos: Sequence[Mapping[str, Any]], root: str, llm: Any, *,
              run: str = "", notes: str = "", parallel: int = 3, max_chars: int = inventory_mod.MAX_CHUNK_CHARS,
              model: Any = None, retries: int = 1, on_repo: Optional[Callable[[Dict[str, Any]], None]] = None,
              scan: Optional[Callable[..., Dict[str, Any]]] = None,
              llm_for: Optional[Callable[[Mapping[str, Any]], Any]] = None) -> Dict[str, Any]:
    """llm_for(repo) -> the model port for that repository's scan (its own budget); default ``llm``."""
    scan = scan or scan_repo
    results: Dict[str, Dict[str, Any]] = {}
    todo = []
    for r in repos:
        cached = _load(_cache_path(directory, side, r["name"]))
        if cached and cached.get("status") == "ok" and cached.get("sha", "") == (r.get("sha") or ""):
            cached["cached"] = True
            results[r["name"]] = cached
        else:
            todo.append(r)

    def job(r: Mapping[str, Any]) -> Dict[str, Any]:
        err = ""
        port = llm_for(r) if llm_for is not None else llm
        for _ in range(1 + max(0, retries)):
            try:
                return scan(r, side, port, run=run, notes=notes, max_chars=max_chars, model=model)
            except Exception as e:   # noqa: BLE001 - one repository never sinks the others
                err = "%s: %s" % (type(e).__name__, e)
                if getattr(e, "code", "") == codes.MIGRATION_BUDGET:
                    break               # retrying would only be refused again
        return {"repo": r["name"], "path": r["path"], "ref": r.get("ref") or "", "sha": r.get("sha") or "",
                "status": "failed", "error": err[:2000]}

    with ThreadPoolExecutor(max_workers=max(1, int(parallel or 1))) as pool:
        for r, res in zip(todo, pool.map(job, todo)):
            _save(_cache_path(directory, side, r["name"]), res)
            results[r["name"]] = res
    order = [r["name"] for r in repos]
    status = []
    for name in order:
        res = results[name]
        row = {"repo": name, "path": res.get("path", ""), "ref": res.get("ref", ""), "sha": res.get("sha", ""),
               "status": res["status"], "stacks": res.get("stacks") or [], "cached": bool(res.get("cached")),
               "features": len((res.get("inventory") or {}).get("features") or []), "error": res.get("error", "")}
        status.append(row)
        if on_repo:
            on_repo(row)
    ok = [results[n] for n in order if results[n]["status"] == "ok"]
    if not ok:
        raise LineError(codes.REPO_SCAN_FAILED, "every %s repository failed to scan" % side,
                        {"side": side, "repos": [{"repo": s["repo"], "error": s["error"]} for s in status]})
    facts = merge_facts([(res["repo"], res["facts"]) for res in ok])
    feats = [f for res in ok for f in res["inventory"]["features"]]
    unproven = [f for res in ok for f in res["inventory"]["unproven"]]
    merged, mlog = merge_features(feats, side, llm, run=run, model=model)
    inv = {"side": side, "tree": "%s (%d repositories)" % (root, len(repos)), "features": merged,
           "unproven": unproven, "chunks": sum(res["inventory"]["chunks"] for res in ok), "repos": status,
           "merged": mlog}
    return {"inventory": inv, "facts": facts, "repos": status, "merged": mlog}


__all__ = ["ROLE_MERGE", "scan_side", "scan_repo", "merge_features", "merge_facts", "pair_relation",
           "prefix_feature", "combine", "slug"]
