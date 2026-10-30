"""Seal score: three factors MULTIPLIED, a mandatory docked section, real evidence, risk levels.

    s = Score(purpose=95, evidence=98, love=97, docked=["-3: no load test"], evidence_items=[...])
    v = judge(s, builder="forge", scorer="assay", level="L1")
    v.sealed, v.total, v.reasons

Rules
  * total = purpose x evidence x love / 10000 (each 0..100). Any zero factor -> total 0; never averaged.
  * sealed only when total >= SEAL_AT (90), every factor > 0, a docked section is present (a list; an
    explicit "nothing docked: <why>" entry counts) and at least one evidence item is real command output.
  * the scorer is never the builder.
  * levels: L0 = automatic (the score decides), L1 = the score decides now, a person reviews later
    (never blocks), L2 = the score decides AND a named person must sign before the seal finalises; only
    that item waits.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence

SEAL_AT = 90.0
LEVELS = ("L0", "L1", "L2")


@dataclass
class Score:
    purpose: float
    evidence: float
    love: float
    docked: Optional[List[str]] = None              # None = section missing (refused), [] = present but empty
    evidence_items: List[Mapping[str, Any]] = field(default_factory=list)

    @property
    def total(self) -> float:
        for f in (self.purpose, self.evidence, self.love):
            if not 0 <= f <= 100:
                raise ValueError("score factors are percentages 0..100")
        return round(self.purpose * self.evidence * self.love / 10000.0, 2)


@dataclass
class SealVerdict:
    sealed: bool
    total: float
    level: str
    needs_signoff: bool
    reasons: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {"sealed": self.sealed, "total": self.total, "level": self.level,
                "needs_signoff": self.needs_signoff, "reasons": list(self.reasons)}


def real_evidence(item: Mapping[str, Any]) -> bool:
    """A command with its captured output and exit code. A note on its own is not evidence."""
    return bool(str(item.get("cmd") or "").strip()) and "exit_code" in item and bool(str(item.get("output") or "").strip())


def level_for(touches_trunk: bool = False, shared_writers: int = 0, units: int = 1, data: bool = False,
              unknown_impact: bool = False) -> str:
    """Risk level from blast-radius facts. UNKNOWN impact is never treated as no impact."""
    if touches_trunk or unknown_impact or units > 3:
        return "L2"
    if data or shared_writers > 0:
        return "L1"
    return "L0"


def judge(score: Score, builder: str, scorer: str, level: str = "L0") -> SealVerdict:
    if level not in LEVELS:
        raise ValueError("level must be one of %s" % (LEVELS,))
    reasons: List[str] = []
    if not scorer or scorer == builder:
        reasons.append("scorer must not be the builder")
    total = score.total
    if min(score.purpose, score.evidence, score.love) <= 0:
        reasons.append("a zero factor makes the whole score 0")
        total = 0.0
    if total < SEAL_AT:
        reasons.append("total %.2f < %.0f" % (total, SEAL_AT))
    if score.docked is None:
        reasons.append("docked section missing")
    if not any(real_evidence(e) for e in score.evidence_items):
        reasons.append("no real command output as evidence")
    sealed = not reasons
    return SealVerdict(sealed, total, level, sealed and level == "L2", reasons)


def docked_text(docked: Sequence[str]) -> str:
    return "\n".join("- " + d for d in docked) if docked else "- nothing docked"
