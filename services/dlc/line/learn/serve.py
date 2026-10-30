"""Serve lessons into a prompt by key (design §8 e6: keyed per-step retrieval, no model turn).

    sv = serve_lessons(lstore, role="builder", step="build", stack="python", run=run, unit="U3",
                       rag=rag, max_chars=1500, cfg=cfg)
    sv.text          -> block to put under "Related context" / "Lessons" of the prompt ("" when none)
    sv.lesson_ids    -> local lessons served;  sv.arms -> {lesson id: "treat"|"control"}

Local lessons first (LearnStore): active lessons of the key (unless this unit is in the active
lesson's holdback arm) and canary lessons whose arm for (run, unit) is "treat". The arm is
recorded for every matching lesson, served or not, so the outcome comparison sees both arms.
Lessons are ordered by status (active first), then seen count, then newest. Then, when a RagPort
is given and the budget is not used up, RagPort.retrieve(role, step, [stack], remaining chars, query=<the situation
in words, when the caller has one>):
hits that are a local lesson not chosen for this unit (control / holdback / not active) are
dropped, so a canary never leaks into its control arm. A RAG System that is absent or down only
means fewer lessons; serving never raises.

Without a unit (run-level roles: reader, test_author, planner) canary lessons are not served
(arms are per unit) and active lessons are served to all.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from . import setting
from .evalgate import arm
from .lstore import LearnStore

_STATUS_RANK = {"active": 0, "canary": 1}


@dataclass
class Served:
    text: str = ""
    lesson_ids: List[str] = field(default_factory=list)
    arms: Dict[str, str] = field(default_factory=dict)
    rag_hits: int = 0
    chars: int = 0


def matching(lstore: LearnStore, role: str, step: str, stack: str) -> List[Dict[str, Any]]:
    out = []
    for le in lstore.query("lesson"):
        if le.get("status") not in _STATUS_RANK:
            continue
        k = le.get("key") or {}
        if k.get("role") == role and k.get("step") == step and k.get("stack") in ("", None, stack):
            out.append(le)
    out.sort(key=lambda le: (_STATUS_RANK[le["status"]], -int(le.get("seen", 1)), -int(le.get("created_ms", 0))))
    return out


def _line(le: Dict[str, Any]) -> str:
    return "- " + str(le.get("text") or "%s -> %s" % (le.get("symptom", ""), le.get("fix", ""))).strip()


def serve_lessons(lstore: Optional[LearnStore], role: str, step: str, stack: str = "python", *, run: str = "",
                  unit: str = "", rag: Any = None, max_chars: int = 0, cfg: Any = None, query: str = "") -> Served:
    max_chars = int(max_chars or setting(cfg, "learn_serve_max_chars"))
    sv = Served()
    lines: List[str] = []
    used = 0
    excluded: set = set()
    for le in (matching(lstore, role, step, stack) if lstore is not None else []):
        if unit:
            side = arm(lstore, le, run, unit, cfg)
            sv.arms[le["id"]] = side
            if side != "treat":
                excluded.add(le["id"])
                continue
        elif le["status"] != "active":
            excluded.add(le["id"])
            continue
        ln = _line(le)
        if used + len(ln) + 1 > max_chars:
            continue
        lines.append(ln)
        used += len(ln) + 1
        sv.lesson_ids.append(le["id"])
    if rag is not None and used < max_chars:
        try:
            kw = {"query": query} if query else {}
            hits = rag.retrieve(role, step, [stack], max_chars - used, **kw) or []
        except Exception:   # noqa: BLE001 - retrieval is best effort
            hits = []
        local = set(sv.lesson_ids)
        for h in hits:
            src = str(h.get("source", ""))
            sid = src.split("/")[-1].split(":")[-1]
            if sid in excluded or src in excluded or sid in local:
                continue
            if lstore is not None and sid.startswith("L-") and lstore.get("lesson", sid) is not None \
                    and sid not in local:
                continue
            ln = "- [%s] %s" % (src, str(h.get("text", "")).strip())
            if used + len(ln) + 1 > max_chars:
                continue
            lines.append(ln)
            used += len(ln) + 1
            sv.rag_hits += 1
    sv.text = "\n".join(lines)
    sv.chars = len(sv.text)
    return sv


__all__ = ["Served", "serve_lessons", "matching"]
