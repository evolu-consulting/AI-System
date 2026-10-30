"""Step 6: blast radius of the changes on v2, and the protected set.

changes = ported v1 features (v1_only rows in scope) + conflicts decided for v1.
A protected feature (v2_only, both_same) is AT RISK when it shares an entity or an interface with a change,
or when one of its files imports (directly or through other modules) a file a change touches. The import
graph is built for Python files only; other languages use entities and interfaces alone.

radius(rows, conflicts, by_id, tree2, facts2=None)
  -> {"changes", "anchors", "affected_files", "protected", "at_risk", "gates", "merges"}

GATES: protected v2 rules / guards / validations (kind rule|guard|validation) on an action or entity a change
also uses. A migrated feature must PASS THROUGH them (e.g. an approval gate on every approve path, a
required-field guard on every channel); they go into the generated spec as constraints.
MERGES: a ported DATA feature (kind data: an object with its tables) whose entities already exist in v2 (as a v2 feature's entity or a v2 data model
entity) is merged into a live entity: high blast radius, each listed.
Each change gets "level": high (merges into a live entity, or 3+ protected features at risk) | medium | low.
"""

from __future__ import annotations

import ast
from typing import Any, Dict, List, Mapping, Sequence, Set

from .tree import Tree


def import_graph(tree: Tree) -> Dict[str, Set[str]]:
    """file -> files it imports (Python, inside the tree)."""
    files = [p for p in tree.files() if p.endswith(".py")]
    mods: Dict[str, str] = {}
    for p in files:
        m = p[:-3].replace("/", ".")
        if m.endswith(".__init__"):
            m = m[:-9]
        mods[m] = p
    out: Dict[str, Set[str]] = {p: set() for p in files}
    for p in files:
        try:
            node = ast.parse(tree.read(p))
        except SyntaxError:
            continue
        pkg_parts = p[:-3].split("/")[:-1]
        for n in ast.walk(node):
            names: List[str] = []
            if isinstance(n, ast.Import):
                names = [a.name for a in n.names]
            elif isinstance(n, ast.ImportFrom):
                base = n.module or ""
                if n.level:
                    parts = pkg_parts[:len(pkg_parts) - (n.level - 1)] if n.level > 1 else list(pkg_parts)
                    base = ".".join([x for x in parts + ([base] if base else []) if x])
                names = [base] + ["%s.%s" % (base, a.name) for a in n.names]
            for nm in names:
                while nm:
                    if nm in mods and mods[nm] != p:
                        out[p].add(mods[nm])
                        break
                    nm = nm.rsplit(".", 1)[0] if "." in nm else ""
    return out


def reverse_closure(graph: Mapping[str, Set[str]], start: Set[str]) -> Set[str]:
    rev: Dict[str, Set[str]] = {}
    for a, bs in graph.items():
        for b in bs:
            rev.setdefault(b, set()).add(a)
    seen, todo = set(start), list(start)
    while todo:
        x = todo.pop()
        for y in rev.get(x, ()):
            if y not in seen:
                seen.add(y)
                todo.append(y)
    return seen


def _files(f: Mapping[str, Any]) -> Set[str]:
    return {e["path"] for e in f.get("evidence") or [] if e.get("verified")}


def _keys(f: Mapping[str, Any]) -> Set[str]:
    return {k.lower() for k in list(f.get("entities") or []) + list(f.get("interfaces") or [])}


GATE_KINDS = ("rule", "guard", "validation")


def radius(rows: Sequence[Mapping[str, Any]], conflicts: Sequence[Mapping[str, Any]],
           by_id: Mapping[str, Mapping[str, Any]], tree2: Tree, facts2: Any = None) -> Dict[str, Any]:
    changes: List[Dict[str, Any]] = []
    for r in rows:
        if r["class"] == "v1_only" and r.get("in_scope", True):
            changes.append({"row": r["id"], "feature": r["v1"], "kind": "port"})
    for c in conflicts:
        if c.get("choice") == "v1" and c.get("kind", "conflict") == "conflict":
            changes.append({"row": c["row"], "feature": c["v1"], "kind": "adopt_v1", "replaces": c["v2"]})
    protected = [r for r in rows if r["class"] in ("v2_only", "both_same") and r.get("v2")]
    keys: Set[str] = set()
    for ch in changes:
        keys |= _keys(by_id.get(ch["feature"]) or {})
    anchors: Set[str] = set()
    for c in conflicts:
        if c.get("choice") == "v1" and c.get("kind", "conflict") == "conflict":
            anchors |= _files(by_id.get(c["v2"]) or {})
    for r in protected:
        f = by_id.get(r["v2"]) or {}
        if _keys(f) & keys:
            anchors |= _files(f)
    graph = import_graph(tree2)
    affected = reverse_closure(graph, {a for a in anchors if a in graph}) | anchors
    at_risk = []
    for r in protected:
        f = by_id.get(r["v2"]) or {}
        why = []
        shared = _keys(f) & keys
        if shared:
            why.append("shares " + ", ".join(sorted(shared)))
        touched = _files(f) & affected
        if touched:
            why.append("in or importing a touched module: " + ", ".join(sorted(touched)))
        if why:
            at_risk.append({"row": r["id"], "feature": r["v2"], "name": r["name"], "reason": "; ".join(why),
                            "tests": list(f.get("tests") or [])})
    gates = []
    for r in protected:
        f = by_id.get(r["v2"]) or {}
        if str(f.get("kind", "")).lower() not in GATE_KINDS:
            continue
        applies = [ch["feature"] for ch in changes if _keys(f) & _keys(by_id.get(ch["feature"]) or {})]
        if applies:
            gates.append({"row": r["id"], "feature": r["v2"], "name": r["name"], "behaviour": f.get("behaviour", ""),
                          "applies_to": applies})
    live = {e.lower() for e in ((facts2 or {}).get("entities") or {})}
    for r in protected:
        live |= {e.lower() for e in (by_id.get(r["v2"]) or {}).get("entities") or []}
    merges = []
    for ch in changes:
        if ch["kind"] != "port" or str((by_id.get(ch["feature"]) or {}).get("kind", "")).lower() != "data":
            continue                        # only a ported data object (tables / entities) merges into v2 data
        hit = sorted({e for e in (by_id.get(ch["feature"]) or {}).get("entities") or [] if e.lower() in live})
        if hit:
            merges.append({"feature": ch["feature"], "entities": hit})
    merged = {m["feature"] for m in merges}
    for ch in changes:
        mine = _keys(by_id.get(ch["feature"]) or {})
        n = sum(1 for a in at_risk if _keys(by_id.get(a["feature"]) or {}) & mine)
        ch["at_risk"] = n
        ch["level"] = "high" if ch["feature"] in merged or n >= 3 else ("medium" if n else "low")
    return {"changes": changes, "anchors": sorted(anchors), "affected_files": sorted(affected),
            "gates": gates, "merges": merges,
            "protected": [{"row": r["id"], "feature": r["v2"], "name": r["name"]} for r in protected],
            "at_risk": at_risk}


__all__ = ["radius", "import_graph", "reverse_closure"]
