"""The living spec: approved artifacts are committed with the change they describe, and an index ties each item to
the files it touched, so a later run sees which earlier items the code has moved away from.

In the target repository (the folder is the build step's persist.dir, default .dlc):
    <dir>/changes/<run>/<artifact>.md   every artifact of persist.artifacts, as approved, with a header
    <dir>/index.json                    {"items": {"<run>:<id>": {"title", "run", "artifact", "files", "refs"}}}

Which items there are and which files they touched comes from the definition: persist.items_from names the
artifact whose "items" pattern defines the ids; persist.links_from names artifacts whose lines tie an id to a path
(a line that mentions both is a link); only paths the change really touched count.

    persist(wt, run, definition, docs, changed, settled, extra) -> [written paths]   before the change is committed;
        settled {artifact: [lines]} = the conditions people approved the artifact with, appended under SETTLED;
        extra {file name: text} = more files of the change's folder (the gates' decision history, line.decisions)
    drift(repo, ref, index_dir) -> [{"item", "title", "files", "commits"}]   items whose files changed after them
    drift_text(rows) -> markdown for the Spec Agent and the gate
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import Any, Dict, List, Optional

from . import artifacts as A

INDEX = "index.json"
MAX_DRIFT = 40
SETTLED = "## Settled at the gates"


def _git(repo: str, *args: str) -> Optional[str]:
    try:
        p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    return p.stdout if p.returncode == 0 else None


def _title(doc: str, item: str) -> str:
    for ln in doc.splitlines():
        if ln.lstrip().startswith("#") and item in ln:
            return ln.lstrip("# ").strip()[:200]
    return item


def _settled_text(rows: List[str]) -> str:
    out = ["", SETTLED, ""]
    for row in rows:
        first, *rest = row.strip().splitlines() or [""]
        out.append("- " + first)
        out += ["  " + ln for ln in rest]
    return "\n".join(out) + "\n"


def persist(wt: str, run: str, definition: Any, docs: Dict[str, str], changed: List[str],
            settled: Optional[Dict[str, List[str]]] = None, extra: Optional[Dict[str, str]] = None) -> List[str]:
    spec = (definition.step("build") or {}).get("persist") or {}
    if not spec:
        return []
    root = str(spec.get("dir") or ".dlc").strip("/\\")
    out: List[str] = []
    cdir = os.path.join(wt, root, "changes", run)
    os.makedirs(cdir, exist_ok=True)
    for name, text in (extra or {}).items():      # e.g. decisions.md: the decisions people took at the gates
        path = os.path.join(cdir, os.path.basename(name))
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text.rstrip() + "\n")
        out.append(path)
    for art in spec.get("artifacts") or []:
        if not docs.get(art):
            continue
        path = os.path.join(cdir, art + ".md")
        head = "<!-- dlc: run %s, process %s, artifact %s (%s) -->\n" % (
            run, definition.ref() if hasattr(definition, "ref") else definition.id, art,
            definition.artifact(art).get("title") or art)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(head + docs[art].rstrip() + "\n" + (_settled_text(settled[art]) if (settled or {}).get(art) else ""))
        out.append(path)
    src = str(spec.get("items_from") or "")
    if src and docs.get(src):
        items = A.ids(docs[src], definition.artifact(src).get("items", ""))
        idx_path = os.path.join(wt, root, INDEX)
        try:
            with open(idx_path, encoding="utf-8") as fh:
                index = json.load(fh)
        except (OSError, ValueError):
            index = {}
        rows = dict(index.get("items") or {})
        touched = [c.replace("\\", "/") for c in changed if not c.replace("\\", "/").startswith(root + "/")]
        for item in items:
            files: List[str] = []
            refs: List[str] = []
            for art in spec.get("links_from") or []:
                for ln in A.lines_with(docs.get(art, ""), [item])[item]:
                    refs.append("%s: %s" % (art, ln[:200]))
                    files += [f for f in touched if f in ln or os.path.basename(f) in ln]
            rows["%s:%s" % (run, item)] = {"title": _title(docs[src], item), "run": run, "artifact": src,
                                           "files": sorted(set(files)), "refs": refs[:10],
                                           "process": definition.ref() if hasattr(definition, "ref") else ""}
        index = {"version": 1, "items": rows}
        os.makedirs(os.path.dirname(idx_path), exist_ok=True)
        with open(idx_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(index, fh, indent=1, sort_keys=True)
            fh.write("\n")
        out.append(idx_path)
    return out


def drift(repo: str, ref: str = "main", index_dir: str = ".dlc") -> List[Dict[str, Any]]:
    """Items of earlier runs whose files were changed by a commit that is not the item's own run."""
    raw = _git(repo, "show", "%s:%s/%s" % (ref, index_dir.strip("/\\"), INDEX))
    try:
        rows = (json.loads(raw) if raw else {}).get("items") or {}
    except ValueError:
        return []
    out: List[Dict[str, Any]] = []
    first: Dict[str, Optional[str]] = {}
    for key, r in sorted(rows.items()):
        files, run = list(r.get("files") or []), str(r.get("run") or "")
        if not files or not run:
            continue
        if run not in first:      # the oldest commit of the item's own run on ref
            shas = (_git(repo, "log", "--format=%H", "--grep=^line %s:" % run, ref) or "").split()
            first[run] = shas[-1] if shas else None
        since = first[run]
        if not since:
            continue
        log = _git(repo, "log", "--format=%h %s", "%s..%s" % (since, ref), "--", *files) or ""
        foreign = [ln for ln in log.splitlines() if ln.strip() and (" line %s:" % run) not in (" " + ln.split(" ", 1)[-1])]
        if foreign:
            out.append({"item": key, "title": r.get("title") or key, "files": files, "commits": foreign[:5]})
        if len(out) >= MAX_DRIFT:
            break
    return out


def drift_text(rows: List[Dict[str, Any]]) -> str:
    if not rows:
        return ""
    lines = ["EARLIER SPEC ITEMS THE CODE HAS MOVED AWAY FROM (check whether this request touches them; if so, say in "
             "the spec whether each still holds, changes, or is replaced):"]
    for r in rows:
        lines.append("- %s %s: files %s; later commits: %s" % (r["item"], r["title"], ", ".join(r["files"][:5]),
                                                               "; ".join(r["commits"][:3])))
    return "\n".join(lines) + "\n"


__all__ = ["persist", "drift", "drift_text", "INDEX"]
