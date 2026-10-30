"""Steps 2 + 3: pair v1 and v2 features by behaviour (role migrate_match), then the CONFIRMATION PASS.

Why a confirmation pass: a raw difference of two scans reports features as missing that exist under another
name, in a moved file, or only in generated/config files. So every one-sided feature is re-checked: its
identifiers are searched in the other tree (source files only, never .json/.yaml config), and a hit sends the
feature plus the hits to role migrate_confirm, which answers present (as which feature) or absent.

match(inv1, inv2, tree1, tree2, llm, run=...) -> {"pairs": [...], "confirm": [...]}
  pair: {"v1", "v2", "relation": "same"|"conflict", "difference", "v1_quote", "v2_quote", "confirmed": bool}
  confirm row: {"feature", "side", "hits": {word: [paths]}, "verdict": "absent"|"present", "partner", "reason"}
Fixture keys: migrate_match "match"; migrate_confirm "<feature id>".
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional

from ..llm.port import load_prompt
from .tree import Tree

ROLE_MATCH = "migrate_match"
ROLE_CONFIRM = "migrate_confirm"
RELATIONS = ("same", "conflict")
MAX_HIT_FILES = 6

MATCH_SCHEMA: Dict[str, Any] = {
    "type": "object", "required": ["pairs"],
    "properties": {"pairs": {"type": "array", "items": {
        "type": "object", "required": ["v1", "v2", "relation"],
        "properties": {"v1": {"type": "string"}, "v2": {"type": "string"}, "relation": {"type": "string"},
                       "difference": {"type": "string"}, "v1_quote": {"type": "string"},
                       "v2_quote": {"type": "string"}}}},
                   "decisions": {"type": "array", "items": {"type": "object"}}}}
CONFIRM_SCHEMA: Dict[str, Any] = {
    "type": "object", "required": ["verdict"],
    "properties": {"verdict": {"type": "string"}, "partner": {"type": "string"}, "relation": {"type": "string"},
                   "difference": {"type": "string"}, "reason": {"type": "string"}}}


def summary(f: Mapping[str, Any]) -> Dict[str, Any]:
    return {"id": f["id"], "name": f["name"], "kind": f.get("kind", ""), "behaviour": f.get("behaviour", ""),
            "identifiers": f.get("identifiers", []), "entities": f.get("entities", []),
            "interfaces": f.get("interfaces", []),
            "quotes": ["%s: %s" % (e["path"], e["quote"]) for e in f.get("evidence", []) if e.get("verified")][:4],
            "examples": f.get("examples", [])[:3]}


def _pairs(data: Any, ids1: set, ids2: set) -> List[Dict[str, Any]]:
    out, used1, used2 = [], set(), set()
    for p in (data or {}).get("pairs") or []:
        if not isinstance(p, Mapping):
            continue
        a, b, rel = str(p.get("v1", "")), str(p.get("v2", "")), str(p.get("relation", "")).lower()
        if a not in ids1 or b not in ids2 or a in used1 or b in used2 or rel not in RELATIONS:
            continue
        used1.add(a)
        used2.add(b)
        out.append({"v1": a, "v2": b, "relation": rel, "difference": str(p.get("difference") or ""),
                    "v1_quote": str(p.get("v1_quote") or ""), "v2_quote": str(p.get("v2_quote") or ""),
                    "confirmed": False})
    return out


def _rule_check(f: Mapping[str, Any], others: List[Dict[str, Any]], ofacts: Mapping[str, Any]) -> Dict[str, Any]:
    """Deterministic rules before any model call (method rules of the confirmation pass):
    - rename: an identifier of the feature has the same rename key as one of the other side's features'
      identifiers (IntegrationProcessService == IntegrationService) -> present, partner = that feature
    - catalogue only: every identifier the other side has is named only in config / generator catalogues
      (.json/.yaml), never declared in source -> absent, 'planned, not built'
    - string only: the identifiers appear in the other side only inside string literals (a destination
      name, a label) -> absent
    Returns {} when no rule decides."""
    from .extract import rename_key
    mine = [w for w in list(f.get("identifiers") or []) if len(w) >= 3]
    if not mine:
        return {}
    keys = {rename_key(w) for w in mine if rename_key(w)}
    for o in others:
        theirs = {rename_key(w): w for w in o.get("identifiers") or []}
        hit = keys & set(theirs)
        if hit:
            k = sorted(hit)[0]
            return {"verdict": "present", "partner": o["id"], "relation": "same",
                    "reason": "renamed: %s == %s" % ([w for w in mine if rename_key(w) == k][0], theirs[k])}
    if not ofacts:
        return {}
    declared = set(ofacts.get("identifiers") or [])
    if any(w in declared for w in mine):
        return {}
    cat = ofacts.get("catalogue") or {}
    named = [w for w in mine if w in cat]
    if named:
        return {"verdict": "absent", "reason": "planned, not built: %s is named only in %s" % (named[0], cat[named[0]]),
                "note": "planned-not-built"}
    strings = set(ofacts.get("strings") or [])
    if any(w in strings for w in mine):
        return {"verdict": "absent", "reason": "only a string in the other tree (a destination or label), not a feature",
                "note": "string-only"}
    return {}


def confirm_one(f: Mapping[str, Any], other: Tree, others: List[Dict[str, Any]], llm: Any, *, run: str = "",
                model: Any = None, ofacts: Any = None) -> Dict[str, Any]:
    words = list(dict.fromkeys(list(f.get("identifiers") or []) + list(f.get("interfaces") or [])))
    hits = other.find(words)
    row: Dict[str, Any] = {"feature": f["id"], "side": f["side"], "hits": hits, "verdict": "absent",
                           "partner": "", "relation": "", "difference": "", "reason": "no identifier found",
                           "note": "", "by": "rule"}
    ruled = _rule_check(f, others, ofacts or {})
    if ruled:
        row.update(ruled)
        return row
    if not hits:
        return row
    row["by"] = "model"
    files = list(dict.fromkeys(p for ps in hits.values() for p in ps))[:MAX_HIT_FILES]
    prompt = "\n\n".join([
        load_prompt(ROLE_CONFIRM),
        "## The feature (from the %s tree)\n%s" % (f["side"], json.dumps(summary(f), indent=1)),
        "## Features already listed for the other tree\n%s" % json.dumps([summary(o) for o in others], indent=1),
        "## Where its identifiers appear in the other tree\n%s" % json.dumps(hits, indent=1),
        "## Those files\n" + other.render(files)])
    res = llm.complete(ROLE_CONFIRM, prompt, CONFIRM_SCHEMA, key=f["id"], model=model, run=run)
    d = res.data or {}
    verdict = str(d.get("verdict", "")).lower()
    row.update({"verdict": "present" if verdict == "present" else "absent",
                "partner": str(d.get("partner") or ""), "relation": str(d.get("relation") or "same").lower(),
                "difference": str(d.get("difference") or ""), "reason": str(d.get("reason") or "")})
    return row


def _decisions(data: Any) -> List[Dict[str, Any]]:
    out = []
    for d in (data or {}).get("decisions") or []:
        if not isinstance(d, Mapping) or not d.get("question"):
            continue
        opts = [{"id": str(o.get("id") or "o%d" % (i + 1)), "label": str(o.get("label") or o.get("id") or "")}
                for i, o in enumerate(d.get("options") or []) if isinstance(o, Mapping)]
        if len(opts) < 2:
            continue
        rec = str(d.get("recommended") or opts[0]["id"])
        out.append({"question": str(d["question"]), "options": opts,
                    "recommended": rec if rec in {o["id"] for o in opts} else opts[0]["id"],
                    "why": str(d.get("why") or "")})
    return out


def match(inv1: Mapping[str, Any], inv2: Mapping[str, Any], tree1: Tree, tree2: Tree, llm: Any, *,
          run: str = "", notes: str = "", model: Any = None, facts1: Any = None, facts2: Any = None
          ) -> Dict[str, Any]:
    f1, f2 = list(inv1["features"]), list(inv2["features"])
    ids1, ids2 = {f["id"] for f in f1}, {f["id"] for f in f2}
    pairs: List[Dict[str, Any]] = []
    decisions: List[Dict[str, Any]] = []
    if f1 and f2:
        parts = [load_prompt(ROLE_MATCH),
                 "## v1 features\n" + json.dumps([summary(f) for f in f1], indent=1),
                 "## v2 features\n" + json.dumps([summary(f) for f in f2], indent=1)]
        for side, fx in (("v1", facts1), ("v2", facts2)):
            if fx and fx.get("handlers"):
                parts.append("## %s behaviour found by code (handlers, hooks, actions)\n%s" % (
                    side, json.dumps(dict(list(fx["handlers"].items())[:200]), indent=1)))
        if notes:
            parts.insert(1, "## Customer notes (context only)\n" + notes)
        res = llm.complete(ROLE_MATCH, "\n\n".join(parts), MATCH_SCHEMA, key="match", model=model, run=run)
        pairs = _pairs(res.data, ids1, ids2)
        decisions = _decisions(res.data)
    confirm: List[Dict[str, Any]] = []
    paired1, paired2 = {p["v1"] for p in pairs}, {p["v2"] for p in pairs}
    for f, other, others, ofacts in ([(f, tree2, f2, facts2) for f in f1 if f["id"] not in paired1]
                                     + [(f, tree1, f1, facts1) for f in f2 if f["id"] not in paired2]):
        row = confirm_one(f, other, others, llm, run=run, model=model, ofacts=ofacts)
        confirm.append(row)
        if row["verdict"] != "present":
            continue
        partner = row["partner"]
        rel = row["relation"] if row["relation"] in RELATIONS else "same"
        if f["side"] == "v1" and partner in ids2 and partner not in paired2 and f["id"] not in paired1:
            pairs.append({"v1": f["id"], "v2": partner, "relation": rel, "difference": row["difference"],
                          "v1_quote": "", "v2_quote": "", "confirmed": True})
            paired1.add(f["id"]); paired2.add(partner)
        elif f["side"] == "v2" and partner in ids1 and partner not in paired1 and f["id"] not in paired2:
            pairs.append({"v1": partner, "v2": f["id"], "relation": rel, "difference": row["difference"],
                          "v1_quote": "", "v2_quote": "", "confirmed": True})
            paired1.add(partner); paired2.add(f["id"])
    return {"pairs": pairs, "confirm": confirm, "decisions": decisions}


__all__ = ["ROLE_MATCH", "ROLE_CONFIRM", "match", "confirm_one", "summary"]
