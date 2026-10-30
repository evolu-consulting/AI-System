"""Step 8 (first half): the changes become a spec pack the standard pipeline builds as an enhancement of v2.

pack(dir, title, changes, by_id, conflicts, gates) -> {"dir", "items": [{"f", "feature", "kind"}], "spec"}
Gates (protected v2 rules the change shares an action or entity with) become constraint lines of the F-item.

One F-item per change:
  port      a v1-only feature: its behaviour and its v1 examples (characterization criteria) as the contract
  adopt_v1  a conflict decided for v1: v2 changes to the v1 behaviour
Order: a change whose entities another change also uses comes first (shared data before what reads it);
ties keep the matrix order. The spec says, in so many words, that every existing behaviour stays.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Mapping, Sequence


def _order(changes: Sequence[Mapping[str, Any]], by_id: Mapping[str, Mapping[str, Any]]) -> List[Mapping[str, Any]]:
    ents = {c["feature"]: {e.lower() for e in (by_id.get(c["feature"]) or {}).get("entities") or []} for c in changes}

    def shared(c: Mapping[str, Any]) -> int:
        mine = ents[c["feature"]]
        return sum(1 for o in changes if o is not c and mine & ents[o["feature"]])

    idx = {id(c): i for i, c in enumerate(changes)}
    return sorted(changes, key=lambda c: (-shared(c), idx[id(c)]))


def _clean(s: str) -> str:
    return " ".join((s or "").split())


def pack(directory: str, title: str, changes: Sequence[Mapping[str, Any]], by_id: Mapping[str, Mapping[str, Any]],
         conflicts: Sequence[Mapping[str, Any]] = (), gates: Sequence[Mapping[str, Any]] = ()) -> Dict[str, Any]:
    os.makedirs(directory, exist_ok=True)
    by_c = {c["v1"]: c for c in conflicts}
    lines = ["# %s" % title, "",
             "Feature migration: the features below exist in the old version (v1) and must work in this",
             "repository (v2). Change only what they need. Every existing behaviour of this repository stays",
             "as it is, and every existing test must still pass.", ""]
    items = []
    for i, ch in enumerate(_order(changes, by_id), 1):
        f = by_id.get(ch["feature"]) or {}
        fid = "F%d" % i
        name = _clean(f.get("name", ch["feature"]))
        if ch["kind"] == "adopt_v1":
            c = by_c.get(ch["feature"]) or {}
            lines += ["## %s Use the v1 behaviour for %s" % (fid, name), "",
                      "- Today this repository does this: %s" % _clean(c.get("v2_behaviour", "")),
                      "- It must do this instead: %s" % _clean(f.get("behaviour", ""))]
        else:
            lines += ["## %s %s" % (fid, name), "", "- %s" % _clean(f.get("behaviour", ""))]
        for g in gates:
            if ch["feature"] in (g.get("applies_to") or []):
                lines.append("- It must pass through the existing rule '%s' exactly as other features do: %s" % (
                    _clean(g.get("name", "")), _clean(g.get("behaviour", "")).rstrip(".") + "."))
        for x in f.get("examples") or []:
            lines.append("- Given %s, when %s, then %s." % (_clean(x.get("given", "")).rstrip("."),
                                                           _clean(x.get("when", "")).rstrip("."),
                                                           _clean(x.get("then", "")).rstrip(".")))
        lines.append("")
        items.append({"f": fid, "feature": ch["feature"], "kind": ch["kind"], "row": ch.get("row", "")})
    spec = "\n".join(lines).rstrip() + "\n"
    with open(os.path.join(directory, "spec.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(spec)
    with open(os.path.join(directory, "pack.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"id": os.path.basename(os.path.normpath(directory)), "title": title,
                   "template": {"required": ["spec.md"]}, "files": ["spec.md"], "kind": "migration"}, fh, indent=2)
    return {"dir": directory, "items": items, "spec": spec}


__all__ = ["pack"]
