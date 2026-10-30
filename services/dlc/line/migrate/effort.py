"""Estimation hook: effort hints per business AREA and per change, from the facts the analysis already has.

hints(rows, by_id, blast) -> {"areas": [{area, port, protect, conflicts, entities, services, screens, handlers,
                                          tests, high_blast}], "changes": [{feature, name, area, entities,
                                          interfaces, screens, examples, level}]}
These are counts, not hours: a plan converts them with its own rates (tables, services and screens weigh
differently per team). A list of entity names is not an answer; areas are what people plan with.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Sequence


def _screens(f: Mapping[str, Any]) -> int:
    return sum(1 for e in f.get("evidence") or [] if str(e.get("path", "")).lower().endswith(
        (".view.xml", ".fragment.xml", ".tsx", ".jsx", ".vue", ".html")))


def hints(rows: Sequence[Mapping[str, Any]], by_id: Mapping[str, Mapping[str, Any]],
          blast: Mapping[str, Any]) -> Dict[str, Any]:
    level = {c["feature"]: c.get("level", "") for c in blast.get("changes") or []}
    areas: Dict[str, Dict[str, Any]] = {}
    changes: List[Dict[str, Any]] = []
    for r in rows:
        a = areas.setdefault(r.get("area") or "Other", {"area": r.get("area") or "Other", "port": 0, "protect": 0,
                                                         "conflicts": 0, "entities": 0, "services": 0, "screens": 0,
                                                         "handlers": 0, "tests": 0, "high_blast": 0})
        if r["class"] == "both_conflict":
            a["conflicts"] += 1
        if r["class"] in ("v2_only", "both_same"):
            a["protect"] += 1
            a["tests"] += len((by_id.get(r["v2"]) or {}).get("tests") or [])
        if r["class"] != "v1_only" or not r.get("in_scope", True):
            continue
        f = by_id.get(r["v1"]) or {}
        a["port"] += 1
        a["entities"] += len(f.get("entities") or [])
        a["services"] += sum(1 for i in f.get("interfaces") or [] if i)
        a["screens"] += _screens(f)
        a["handlers"] += sum(1 for i in f.get("identifiers") or [] if i.lower().endswith("handler"))
        if level.get(r["v1"]) == "high":
            a["high_blast"] += 1
        changes.append({"feature": r["v1"], "name": r["name"], "area": a["area"], "custom": r.get("custom", False),
                        "entities": len(f.get("entities") or []), "interfaces": len(f.get("interfaces") or []),
                        "screens": _screens(f), "examples": len(f.get("examples") or []),
                        "level": level.get(r["v1"], "")})
    return {"areas": sorted(areas.values(), key=lambda x: x["area"]), "changes": changes}


__all__ = ["hints"]
