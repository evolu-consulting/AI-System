"""Needs: what PEOPLE must find and put in before the AI can work well (the "Business needs" / "Technical needs" of
docs/flow-enhance_bugfix.html). Without them an agent guesses. A process and each of its steps list their needs as
data; the engine only checks whether each one is there, at the START of a run (the design phase), never in the
middle: a missing "block" need parks the run for its owner, a missing "warn" need lets the run go on and every
agent is told about it, so what it had to assume is flagged.

A need:
    {"id", "what", "kind": "business" | "technical", "owner": <role>, "scope": "project" | "run",
     "where": {...}, "required": "block" | "warn", "flows": [flow, ...]}
"flows" (optional) limits the need to runs of those flows (an enhancement's key, not a bug fix's); none = every flow.
where:
    {"repo": "<path>"}               the path (file or folder, not empty) on the target's main branch
    {"pack": "<glob>"}                a file of the run's request pack matching the glob
    {"store": {"query": "...", "min_chars": n, "contains": [words]}}   the project's knowledge store answers
                                      the query with >= n chars that hold every word of "contains"
    {}                                only what a person supplies for it (POST at the needs gate)
Whatever a person supplies at the needs gate (pack/needs/<id>/...) always counts.

    collect(definition, flow) -> [need]     the process's needs then each step's (each with its step id) for the flow
    check(definition, pipe, flow) -> [row]  row = need + {"ok", "how"}
    missing_text(rows) -> what agents are told about missing "warn" needs
"""

from __future__ import annotations

import fnmatch
import os
from typing import Any, Dict, List

NEEDS_DIR = "needs"
KINDS = ("business", "technical")


def _for_flow(n: Dict[str, Any], flow: str) -> bool:
    flows = [str(f).strip().lower() for f in n.get("flows") or []]
    return not flows or not flow or flow.strip().lower() in flows


def collect(definition: Any, flow: str = "") -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for n in definition.data.get("needs") or []:
        if _for_flow(n, flow):
            out.append(dict(n, step=""))
    for s in definition.steps():
        for n in s.get("needs") or []:
            if _for_flow(n, flow):
                out.append(dict(n, step=s["id"]))
    return out


def validate(needs: List[Dict[str, Any]]) -> None:
    seen = set()
    for n in needs:
        nid = str(n.get("id") or "")
        if not nid or nid in seen:
            raise ValueError("every need needs a unique id (%r)" % nid)
        seen.add(nid)
        if not n.get("what") or not n.get("owner"):
            raise ValueError("need %s: what and owner (the role that supplies it) are required" % nid)
        if n.get("kind") and n["kind"] not in KINDS:
            raise ValueError("need %s: kind must be business or technical" % nid)
        if n.get("required", "block") not in ("block", "warn"):
            raise ValueError("need %s: required must be block or warn" % nid)
        if n.get("scope", "project") not in ("project", "run"):
            raise ValueError("need %s: scope must be project or run" % nid)
        if n.get("flows") is not None and not isinstance(n["flows"], list):
            raise ValueError("need %s: flows must be a list of flow names" % nid)


def supplied_dir(pack: str, nid: str) -> str:
    return os.path.join(pack, NEEDS_DIR, nid)


def _supplied(pack: str, nid: str) -> List[str]:
    d = supplied_dir(pack, nid)
    return sorted(f for f in os.listdir(d)) if os.path.isdir(d) else []


def _repo(pipe: Any, path: str) -> bool:
    from ..ship._util import git
    path = path.strip("/\\")
    cp = git(pipe.repo, "ls-tree", "-r", "--name-only", "main", "--", path, check=False)
    if cp.returncode != 0 or not cp.stdout.strip():
        return False
    for f in cp.stdout.splitlines():
        sz = git(pipe.repo, "cat-file", "-s", "main:%s" % f, check=False)
        if sz.returncode == 0 and int((sz.stdout or "0").strip() or 0) > 0:
            return True
    return False


def _pack(pipe: Any, pattern: str) -> List[str]:
    out = []
    for root, _dirs, files in os.walk(pipe.pack):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), pipe.pack).replace("\\", "/")
            if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(f, pattern):
                out.append(rel)
    return out


def _store(pipe: Any, spec: Dict[str, Any], role: str) -> tuple:
    """(chars the project's knowledge store answers, the store's error or ''). With spec "contains" (words that
    only the needed document has), the answer counts only when it holds every one of them: a project's store
    also holds the run's own request, which must not pass for the knowledge people were asked to supply."""
    rag = getattr(pipe, "rag", None)
    if rag is None or not spec.get("query"):
        return 0, "no knowledge store configured"
    try:
        hits = rag.retrieve(role or "spec_analyst", "needs", ["*"], int(spec.get("max_chars") or 4000),
                            query=str(spec["query"]))
    except Exception as e:   # noqa: BLE001 - the store could not answer: say so, it is not "missing knowledge"
        return 0, str(e)[:300]
    down = getattr(rag, "_degraded", {}) or {}
    if not hits and "retrieve" in down:   # a resilient port answers [] while degraded: that is not "missing"
        return 0, "knowledge store degraded: %s" % str(down["retrieve"])[:300]
    text = "".join(str(h.get("text") or "") for h in hits or []).strip()
    words = [str(w) for w in spec.get("contains") or []]
    missing = [w for w in words if w.lower() not in text.lower()]
    if missing:
        return 0, "the store's answer lacks %s" % ", ".join(repr(w) for w in missing)
    return len(text), ""


def check(definition: Any, pipe: Any, flow: str = "") -> List[Dict[str, Any]]:
    rows = []
    for n in collect(definition, flow):
        w = n.get("where") or {}
        got = _supplied(pipe.pack, n["id"])
        ok, how = bool(got), ("supplied: %s" % ", ".join(got)) if got else ""
        if not ok and w.get("repo"):
            ok = _repo(pipe, str(w["repo"]))
            how = "repository %s" % w["repo"] if ok else "nothing at %s on main" % w["repo"]
        if not ok and w.get("pack"):
            files = _pack(pipe, str(w["pack"]))
            ok, how = bool(files), ("request files: %s" % ", ".join(files[:5])) if files else "no request file %s" % w["pack"]
        if not ok and w.get("store"):
            n_chars, err = _store(pipe, w["store"], n.get("role") or "")
            ok = n_chars >= int(w["store"].get("min_chars") or 1)
            how = ("knowledge store: %s" % err) if err else                 "knowledge store: %d chars for %r" % (n_chars, w["store"].get("query"))
        if not ok and not how:
            how = "not supplied yet"
        rows.append(dict(n, ok=ok, how=how, required=n.get("required", "block"), scope=n.get("scope", "project"),
                         kind=n.get("kind", "business")))
    return rows


def blocking(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [r for r in rows if not r["ok"] and r["required"] == "block"]


def missing_text(rows: List[Dict[str, Any]]) -> str:
    miss = [r for r in rows if not r["ok"]]
    if not miss:
        return ""
    lines = ["KNOWLEDGE THAT WAS NOT SUPPLIED (do not invent it: where your work depends on it, say so and mark what "
             "you had to assume under ASSUMED:):"]
    lines += ["- %s (%s, owner %s)" % (r["what"], r["kind"], r["owner"]) for r in miss]
    return "\n".join(lines) + "\n"


def table(rows: List[Dict[str, Any]]) -> str:
    if not rows:
        return "No needs declared."
    out = ["| Need | Kind | Owner | Scope | Required | Status |", "|---|---|---|---|---|---|"]
    for r in rows:
        what = r["what"] + (" (only for %s)" % ", ".join(r["flows"]) if r.get("flows") else "")
        out.append("| %s: %s | %s | %s | %s | %s | %s |" % (r["id"], what, r["kind"], r["owner"], r["scope"],
                                                          r["required"], ("ok (%s)" % r["how"]) if r["ok"] else
                                                          "**missing** (%s)" % r["how"]))
    return "\n".join(out)


__all__ = ["collect", "validate", "check", "blocking", "missing_text", "table", "supplied_dir", "NEEDS_DIR"]
