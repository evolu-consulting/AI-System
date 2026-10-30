"""Step 4: the parity matrix, plus the custom flag (a v1 feature with no trace in the vanilla v1 base).

rows(inv1, inv2, matched, base=None, scope=()) -> [row]
  row: {"id": "R<n>", "class": v1_only|v2_only|both_same|both_conflict, "name", "v1", "v2", "custom",
        "confidence": high|medium|low, "action": port|protect|decide|keep, "in_scope", "difference", "note"}
markdown(rows, features) -> the matrix as a Markdown table (artefact matrix.md)
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .tree import Tree

CLASSES = ("v1_only", "v2_only", "both_same", "both_conflict")
ACTIONS = {"v1_only": "port", "v2_only": "protect", "both_same": "protect", "both_conflict": "decide"}


def is_custom(f: Mapping[str, Any], base: Optional[Tree]) -> bool:
    """No verified quote of the feature in the base at its path, and none of its identifiers in base source."""
    if base is None:
        return False
    for e in f.get("evidence") or []:
        if e.get("verified") and base.contains(e["path"], e["quote"]):
            return False
    if base.find(list(f.get("identifiers") or [])):
        return False
    return True


def in_scope(f: Mapping[str, Any], scope: Sequence[str]) -> bool:
    if not scope:
        return True
    hay = " ".join([f.get("name", ""), f.get("id", ""), f.get("behaviour", "")]
                   + [e.get("path", "") for e in f.get("evidence") or []]).lower()
    return any(s.lower() in hay for s in scope)


def rows(inv1: Mapping[str, Any], inv2: Mapping[str, Any], matched: Mapping[str, Any], *,
         base: Optional[Tree] = None, scope: Sequence[str] = ()) -> List[Dict[str, Any]]:
    by1 = {f["id"]: f for f in inv1["features"]}
    by2 = {f["id"]: f for f in inv2["features"]}
    out: List[Dict[str, Any]] = []
    done1, done2 = set(), set()

    def add(cls: str, a: Optional[str], b: Optional[str], conf: str, diff: str = "", note: str = "") -> None:
        f = by1.get(a or "") or by2.get(b or "") or {}
        row = {"id": "R%d" % (len(out) + 1), "class": cls, "name": f.get("name", ""), "area": f.get("area") or "Other",
               "kind": f.get("kind", ""), "v1": a or "", "v2": b or "",
               "custom": bool(a) and is_custom(by1[a], base), "confidence": conf, "action": ACTIONS[cls],
               "in_scope": in_scope(by1.get(a or "") or f, scope), "difference": diff, "note": note}
        out.append(row)

    for p in matched.get("pairs") or []:
        cls = "both_conflict" if p["relation"] == "conflict" else "both_same"
        add(cls, p["v1"], p["v2"], "medium" if p.get("confirmed") else "high", p.get("difference", ""),
            "paired by the confirmation pass" if p.get("confirmed") else "")
        done1.add(p["v1"]); done2.add(p["v2"])
    conf_rows = {c["feature"]: c for c in matched.get("confirm") or []}
    for fid in sorted(by1):
        if fid in done1:
            continue
        c = conf_rows.get(fid) or {}
        if c.get("verdict") == "present":
            add("both_same", fid, None, "medium", c.get("difference", ""),
                "present in v2 code but not in the v2 inventory: %s" % (c.get("reason") or ""))
            out[-1]["action"] = "keep"
        else:
            note = c.get("reason", "") if c.get("by") == "rule" and c.get("note") else (
                "identifiers seen in v2 but judged absent: %s" % c.get("reason") if c.get("hits") else "")
            add("v1_only", fid, None, "low" if c.get("hits") else "high", "", note)
            out[-1]["planned_not_built"] = c.get("note") == "planned-not-built"
    for fid in sorted(by2):
        if fid in done2:
            continue
        c = conf_rows.get(fid) or {}
        add("v2_only", None, fid, "medium" if c.get("hits") else "high", "",
            ("v1 has similar identifiers: %s" % c.get("reason")) if c.get("hits") else "")
    return out


def counts(rs: Iterable[Mapping[str, Any]]) -> Dict[str, int]:
    rs = list(rs)
    out = {c: sum(1 for r in rs if r["class"] == c) for c in CLASSES}
    out["custom"] = sum(1 for r in rs if r.get("custom"))
    out["confirmed"] = sum(1 for r in rs if "confirmation pass" in (r.get("note") or "")
                           or "inventory" in (r.get("note") or ""))
    return out


def markdown(rs: Sequence[Mapping[str, Any]], features: Mapping[str, Mapping[str, Any]]) -> str:
    lines = ["| Row | Area | Class | Feature | v1 | v2 | Custom | Confidence | Action | Note |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(rs, key=lambda r: (r.get("area") or "", int(str(r["id"]).lstrip("R") or 0))):
        note = (r.get("difference") or r.get("note") or "").replace("|", "/").replace("\n", " ")
        lines.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s%s | %s |" % (
            r["id"], r.get("area") or "", r["class"], r["name"], r["v1"] or "-", r["v2"] or "-", "yes" if r["custom"] else "",
            r["confidence"], r["action"], "" if r["in_scope"] else " (out of scope)", note[:200]))
    return "\n".join(lines) + "\n"


__all__ = ["CLASSES", "rows", "counts", "markdown", "is_custom", "in_scope"]
