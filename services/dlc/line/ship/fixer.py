"""Fixer (plan block 17): a red F-item on QAS becomes a new Fixer unit, at most
``cfg.fixer_generations`` (2) generations per F-item; past that the F-item is escalated.

The fixer unit:
  id        "FX-<f_item>-g<gen>" (prefixed "<run>:" if that id already belongs to another run)
  state     ready (its origin units are merged, so no deps)
  wave      max wave of the run + 1
  claims    union of the claims of the units that implement the F-item
  tests     the F-item's acceptance tests;  f_items [f_item];  size S;  fixer_gen gen
  detail    {"evidence": {runs, failing, quarantined, tests, qas_dir}, "origin_units": [...]}

Emits unit.state (from "" to ready, body.fixer_gen) for a new unit, or escalated
(code QAS_RED) when the generation cap is hit. Moving the run QAS -> BUILDING or
-> ESCALATED is the pipeline's job.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from .. import codes
from ..config import Config, load_config
from ..contracts import E_ACC_TEST, E_ESCALATION, E_RUN, E_UNIT, Size, Unit, UnitState, to_dict
from ._util import SystemClock, run_env
from .qas_runner import RED, FItemResult, QasReport


@dataclass
class FixerOutcome:
    f_item: str
    unit: Optional[Dict[str, Any]] = None      # the new fixer unit row
    escalated: bool = False
    generation: int = 0
    detail: Dict[str, Any] = field(default_factory=dict)


class Fixer:
    def __init__(self, store: Any, cfg: Optional[Config] = None, clock: Any = None):
        self.store = store
        self.cfg = cfg or load_config()
        self.clock = clock or getattr(store, "clock", None) or SystemClock()

    def handle(self, run: str, report: QasReport) -> List[FixerOutcome]:
        """One outcome per red F-item of the report."""
        return [self.on_red(run, item, qas_dir=report.qas_dir) for item in report.red]

    def on_red(self, run: str, item: Union[FItemResult, Dict[str, Any]], qas_dir: str = "") -> FixerOutcome:
        if isinstance(item, FItemResult):
            item = to_dict(item)
        f_item = str(item["f_item"])
        units = self.store.query(E_UNIT, run=run)
        origin = [u for u in units if f_item in (u.get("f_items") or [])]
        gen = max([int(u.get("fixer_gen", 0) or 0) for u in origin] + [0]) + 1
        evidence = {"runs": item.get("runs", []), "failing": item.get("failing", []),
                    "quarantined": item.get("quarantined", []), "tests": item.get("tests", {}),
                    "qas_dir": qas_dir, "code": codes.QAS_RED}
        reopened = len(((self.store.get(E_RUN, run) or {}).get("detail") or {}).get("attempts") or [])
        cap = int(self.cfg.fixer_generations) * (1 + reopened)    # each attempt of a retried run (line.reopen)
        if gen > cap or not origin:
            reason = ("fixer generation cap %d reached" % cap) if origin else "no unit implements %s" % f_item
            return self._escalate(run, f_item, gen, reason, evidence, [u["id"] for u in origin])

        claims: List[str] = []
        for u in origin:
            for c in u.get("claims") or []:
                if c not in claims:
                    claims.append(c)
        tests = [t["id"] for t in self.store.query(E_ACC_TEST, run=run, f_item=f_item) if t.get("id")]
        if not tests:
            for u in origin:
                tests += [t for t in u.get("tests") or [] if t not in tests]
        uid = "FX-%s-g%d" % (f_item, gen)
        existing = self.store.get(E_UNIT, uid)
        if existing is not None and existing.get("run") != run:
            uid = "%s:%s" % (run, uid)
            existing = self.store.get(E_UNIT, uid)
        if existing is not None:      # already spawned (idempotent replay of the same QAS verdict)
            return FixerOutcome(f_item, existing, False, gen, {"existing": True})
        wave = max([int(u.get("wave", 0) or 0) for u in units] + [0]) + 1
        unit = Unit(
            id=uid, run=run, title="Fix %s (red on QAS, generation %d)" % (f_item, gen),
            state=UnitState.READY.value, wave=wave, claims=claims, deps=[], f_items=[f_item], tests=tests,
            size=Size.S.value, fixer_gen=gen,
            detail={"evidence": evidence, "origin_units": [u["id"] for u in origin], "kind": "fixer"},
        )
        self.store.put(E_UNIT, uid, unit, run=run)
        env = run_env(self.store, self.cfg, run, uid)
        self.store.emit(codes.UNIT_STATE, env, {"from": "", "to": UnitState.READY.value, "fixer_gen": gen,
                                               "f_item": f_item, "code": codes.QAS_RED})
        return FixerOutcome(f_item, self.store.get(E_UNIT, uid), False, gen, {"evidence": evidence})

    def _escalate(self, run: str, f_item: str, gen: int, reason: str, evidence: Dict[str, Any],
                  origin: List[str]) -> FixerOutcome:
        eid = "%s:%s:fixer" % (run, f_item)
        row = {"id": eid, "run": run, "code": codes.QAS_RED, "message": "%s still red on QAS: %s" % (f_item, reason),
               "detail": {"f_item": f_item, "generation": gen - 1, "evidence": evidence, "origin_units": origin},
               "unit": origin[-1] if origin else "", "ts_ms": self.clock.now_ms()}
        self.store.put(E_ESCALATION, eid, row, run=run)
        self.store.emit(codes.ESCALATED, run_env(self.store, self.cfg, run),
                        {"code": codes.QAS_RED, "f_item": f_item, "message": row["message"],
                         "generations": gen - 1})
        return FixerOutcome(f_item, None, True, gen - 1, {"reason": reason, "evidence": evidence})


__all__ = ["Fixer", "FixerOutcome"]
