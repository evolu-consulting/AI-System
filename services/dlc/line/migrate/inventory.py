"""Step 1: feature inventory of one tree (role migrate_inventory), with every quote checked by code.

inventory(tree, side, llm, run=..., notes="", max_chars=...) -> {"features": [...], "unproven": [...], "chunks": n}

A feature (dict):
  id          "<side>.<model id>"  (side = v1 | v2)
  name, kind  kind: screen | command | api | job | report | rule | data | integration | role | other
  behaviour   one or two sentences of what it does for the user
  evidence    [{"path", "quote", "verified"}]  literal quotes; code sets verified
  identifiers names in the code that implement it (functions, classes, routes, tables)
  entities    business objects it reads or writes;  interfaces: commands / routes / files / events it exposes
  tests       test files that check it;  examples: [{"given", "when", "then"}] taken from code or tests
A feature with no verified quote is UNPROVEN: kept apart, never migrated.
Fixture keys (fake model): "<side>" for a one-chunk tree, else "<side>.<chunk>"; one repository of an estate
uses "<side>.<repo>" (and "<side>.<repo>.<chunk>").
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping

from ..llm.port import load_prompt
from .tree import Tree

ROLE = "migrate_inventory"
MAX_CHUNK_CHARS = 120000

_STR_LIST = {"type": "array", "items": {"type": "string"}}
_FEATURE = {"type": "object", "required": ["id", "name", "behaviour", "evidence"],
            "properties": {"id": {"type": "string"}, "name": {"type": "string"}, "kind": {"type": "string"},
                           "behaviour": {"type": "string"},
                           "evidence": {"type": "array", "items": {"type": "object", "required": ["path", "quote"],
                                                                   "properties": {"path": {"type": "string"},
                                                                                  "quote": {"type": "string"}}}},
                           "identifiers": _STR_LIST, "entities": _STR_LIST, "interfaces": _STR_LIST,
                           "tests": _STR_LIST, "area": {"type": "string"},
                           "examples": {"type": "array", "items": {"type": "object"}}}}
SCHEMA: Dict[str, Any] = {"type": "object", "required": ["features"],
                          "properties": {"features": {"type": "array", "items": _FEATURE}}}

_ID = re.compile(r"[^A-Za-z0-9_-]+")


def _skip(p: str) -> bool:
    from .extract import is_fixture
    return is_fixture(p)


def _list(v: Any) -> List[str]:
    return [str(x) for x in v if str(x).strip()] if isinstance(v, list) else []


def normalize(raw: Mapping[str, Any], side: str, tree: Tree) -> Dict[str, Any]:
    fid = _ID.sub("-", str(raw.get("id") or raw.get("name") or "F")).strip("-") or "F"
    ev = []
    for e in raw.get("evidence") or []:
        if not isinstance(e, Mapping):
            continue
        path, quote = str(e.get("path") or "").replace("\\", "/"), str(e.get("quote") or "")
        ev.append({"path": path, "quote": quote, "verified": bool(path and quote and tree.contains(path, quote))})
    ex = [{k: str(x.get(k, "")) for k in ("given", "when", "then")}
          for x in raw.get("examples") or [] if isinstance(x, Mapping)]
    return {"id": "%s.%s" % (side, fid), "side": side, "name": str(raw.get("name") or fid),
            "area": str(raw.get("area") or "").strip() or "Other",
            "kind": str(raw.get("kind") or "other"), "behaviour": str(raw.get("behaviour") or ""),
            "evidence": ev, "identifiers": _list(raw.get("identifiers")), "entities": _list(raw.get("entities")),
            "interfaces": _list(raw.get("interfaces")), "tests": _list(raw.get("tests")), "examples": ex}


def facts_text(facts: Mapping[str, Any], limit: int = 120) -> str:
    """What the extractors found, for the model (it must still quote the files for every feature)."""
    if not facts:
        return ""
    out = ["stacks: " + ", ".join(facts.get("stacks") or [])]
    for k in ("modules", "services", "entities", "screens", "handlers"):
        names = list((facts.get(k) or {}).keys())
        if names:
            out.append("%s (%d): %s%s" % (k, len(names), ", ".join(names[:limit]), " ..." if len(names) > limit else ""))
    return "\n".join(out)


def inventory(tree: Tree, side: str, llm: Any, *, run: str = "", notes: str = "",
              max_chars: int = MAX_CHUNK_CHARS, model: Any = None, facts: Any = None, key: str = ""
              ) -> Dict[str, Any]:
    """key: fixture / cache key base (default the side; one repo of an estate: '<side>.<repo>')."""
    chunks = tree.chunks(max_chars)
    base = key or side
    seen: Dict[str, Dict[str, Any]] = {}
    for name, paths in chunks:
        ck = base if len(chunks) == 1 else "%s.%s" % (base, name)
        parts = [load_prompt(ROLE),
                 "## Tree\n%s (%s), part %s: %d file(s)" % (side, tree.label(), name, len(paths))]
        if notes:
            parts.append("## Customer notes (context only; every feature still needs quotes from the files)\n" + notes)
        if facts:
            parts.append("## Found by code in the whole tree (services, entities, screens, handlers)\n"
                         + facts_text(facts))
        parts.append("## Files\n" + tree.render([p for p in paths if not _skip(p)]))
        res = llm.complete(ROLE, "\n\n".join(parts), SCHEMA, key=ck, model=model, run=run)
        for raw in (res.data or {}).get("features") or []:
            if not isinstance(raw, Mapping):
                continue
            f = normalize(raw, side, tree)
            if f["id"] in seen:                     # same feature seen in two chunks: merge evidence
                old = seen[f["id"]]
                for k in ("evidence", "examples"):
                    old[k] += [x for x in f[k] if x not in old[k]]
                for k in ("identifiers", "entities", "interfaces", "tests"):
                    old[k] = sorted(set(old[k]) | set(f[k]))
            else:
                seen[f["id"]] = f
    proven = [f for f in seen.values() if any(e["verified"] for e in f["evidence"])]
    unproven = [f for f in seen.values() if f not in proven]
    return {"side": side, "tree": tree.label(), "features": proven, "unproven": unproven, "chunks": len(chunks)}


__all__ = ["ROLE", "SCHEMA", "MAX_CHUNK_CHARS", "inventory", "normalize"]
