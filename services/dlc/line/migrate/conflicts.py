"""Step 5: conflicts (both versions have the feature, behaviour differs) and their decisions.

Default choice is v2 (the new version is the better base). mode "ask": the conflicts wait for a person
before anything changes. mode "decide": v2 is chosen at once; the v1 behaviour is written to a backup file
and every decision is appended to the decision log, so the two can be compared later.

records(rows, by_id) -> [conflict]
  conflict: {"id": "C<n>", "row", "name", "v1", "v2", "difference", "v1_behaviour", "v2_behaviour",
             "v1_quotes", "v2_quotes", "v1_examples", "choice": ""|"v1"|"v2", "who", "decided_ms", "backup"}
write_backup(dir, conflict, v1_feature) -> path of backup/<cid>-v1.md
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Mapping, Sequence

from ..contracts import now_ms

CHOICES = ("v2", "v1")
DEFAULT_CHOICE = "v2"


def _quotes(f: Mapping[str, Any]) -> List[str]:
    return ["%s: %s" % (e["path"], e["quote"]) for e in f.get("evidence") or [] if e.get("verified")]


def records(rows: Sequence[Mapping[str, Any]], by_id: Mapping[str, Mapping[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in rows:
        if r["class"] != "both_conflict" or not r.get("in_scope", True):
            continue
        f1, f2 = by_id.get(r["v1"]) or {}, by_id.get(r["v2"]) or {}
        out.append({"id": "C%d" % (len(out) + 1), "kind": "conflict", "row": r["id"], "name": r["name"], "v1": r["v1"], "v2": r["v2"],
                    "difference": r.get("difference", ""), "v1_behaviour": f1.get("behaviour", ""),
                    "v2_behaviour": f2.get("behaviour", ""), "v1_quotes": _quotes(f1), "v2_quotes": _quotes(f2),
                    "v1_examples": f1.get("examples", []), "choice": "", "who": "", "decided_ms": 0, "backup": ""})
    return out


def decision_records(decisions: Sequence[Mapping[str, Any]], start: int) -> List[Dict[str, Any]]:
    """Open decisions the analysis found (scope of a legacy suite, which target API ...) asked up front, before
    any change, like conflicts. kind "decision"; choice must be one of its option ids."""
    out = []
    for i, d in enumerate(decisions):
        out.append({"id": "C%d" % (start + i), "kind": "decision", "row": "", "name": d["question"][:80],
                    "question": d["question"], "options": list(d["options"]), "recommended": d["recommended"],
                    "why": d.get("why", ""), "v1": "", "v2": "", "difference": "", "v1_behaviour": "",
                    "v2_behaviour": "", "choice": "", "who": "", "decided_ms": 0, "backup": ""})
    return out


def choices(c: Mapping[str, Any]) -> List[str]:
    return [o["id"] for o in c.get("options") or []] if c.get("kind") == "decision" else list(CHOICES)


def default_choice(c: Mapping[str, Any]) -> str:
    return c.get("recommended") or DEFAULT_CHOICE if c.get("kind") == "decision" else DEFAULT_CHOICE


def question(c: Mapping[str, Any]) -> Dict[str, Any]:
    """What a person is asked (the board / API shows this)."""
    if c.get("kind") == "decision":
        return {"conflict": c["id"], "feature": c["name"], "kind": "decision", "text": c["question"],
                "options": [dict(o, recommended=(o["id"] == c.get("recommended"))) for o in c.get("options") or []],
                "why": c.get("why", ""), "choice": c.get("choice") or ""}
    return {"conflict": c["id"], "feature": c["name"],
            "text": "v1 and v2 behave differently for %r. %s" % (c["name"], c.get("difference") or ""),
            "options": [{"id": "v2", "label": "keep v2: " + (c.get("v2_behaviour") or ""), "recommended": True},
                        {"id": "v1", "label": "change v2 to the v1 behaviour: " + (c.get("v1_behaviour") or "")}],
            "choice": c.get("choice") or ""}


def write_backup(directory: str, c: Mapping[str, Any], v1_feature: Mapping[str, Any]) -> str:
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, "%s-v1.md" % c["id"])
    lines = ["# %s: v1 behaviour kept as backup" % c["id"], "",
             "Feature: %s" % c["name"],
             "Decision: %s (by %s)" % (c.get("choice") or DEFAULT_CHOICE, c.get("who") or "-"),
             "", "## v1 behaviour", "", v1_feature.get("behaviour", ""), "", "## v1 evidence", ""]
    lines += ["- `%s`" % q for q in _quotes(v1_feature)]
    lines += ["", "## v1 examples", ""]
    lines += ["- given %s, when %s, then %s" % (x.get("given"), x.get("when"), x.get("then"))
              for x in v1_feature.get("examples") or []]
    lines += ["", "## v2 behaviour (kept)", "", c.get("v2_behaviour", ""), "", "## Difference", "",
              c.get("difference", ""), ""]
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    return path


def log_decision(path: str, migration: str, c: Mapping[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"ts_ms": now_ms(), "migration": migration, "conflict": c["id"], "feature": c["name"],
                             "choice": c["choice"], "who": c["who"], "backup": c.get("backup", ""),
                             "kind": c.get("kind", "conflict"), "v1": c.get("v1_behaviour", ""),
                             "v2": c.get("v2_behaviour", ""), "question": c.get("question", "")}, ensure_ascii=False) + "\n")


__all__ = ["CHOICES", "DEFAULT_CHOICE", "records", "decision_records", "choices", "default_choice", "question",
           "write_backup", "log_decision"]
