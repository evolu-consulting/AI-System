"""Scheduler (block 10): which READY units to dispatch next.

promote(run, store): PENDING units whose effective deps (declared deps + all contract units)
are all MERGED become READY (UNIT_STATE emitted, detail.ready_ms stamped).

next_ready(run, store, cfg, limit=None) -> [Unit], ordered by
  1. on the critical path first
  2. more units unlocked (transitive dependents) first
  3. waited longer (smaller detail.ready_ms) first
  4. unit id
capped at limit, default cfg.max_parallel_units minus units currently LEASED.
"""

from __future__ import annotations

from typing import Any, List, Optional

from .. import codes
from ..config import Config
from ..contracts import E_GRAPH, E_UNIT, Unit, UnitState, from_dict
from . import graph as G
from ._common import cfg_or_default, clock_ms, env, save_unit


def _units(run: str, store: Any) -> List[Unit]:
    return [from_dict(Unit, r) for r in store.query(E_UNIT, run=run)]


def mark_ready_ms(store: Any, unit: Unit) -> Unit:
    detail = dict(unit.detail)
    detail["ready_ms"] = clock_ms(store)
    return save_unit(store, unit, detail=detail)


def promote(run: str, store: Any, cfg: Optional[Config] = None) -> List[str]:
    """PENDING -> READY for units whose dependencies are merged. Returns promoted ids."""
    cfg = cfg_or_default(cfg)
    units = _units(run, store)
    state = {u.id: u.state for u in units}
    deps = G.effective_deps(units)
    out = []
    for u in units:
        if u.state != UnitState.PENDING.value:
            continue
        if all(state.get(d) == UnitState.MERGED.value for d in deps[u.id]):
            store.transition(E_UNIT, u.id, UnitState.READY, UnitState.PENDING)
            mark_ready_ms(store, u)
            store.emit(codes.UNIT_STATE, env(run, cfg, unit=u.id),
                       {"from": UnitState.PENDING.value, "to": UnitState.READY.value})
            out.append(u.id)
    return out


def next_ready(run: str, store: Any, cfg: Optional[Config] = None, limit: Optional[int] = None) -> List[Unit]:
    cfg = cfg_or_default(cfg)
    promote(run, store, cfg)
    units = _units(run, store)
    g = store.get(E_GRAPH, run)
    crit = set(g.get("critical_path") or []) if g else set()
    if not crit and units:
        try:
            crit = set(G.critical_path(units))
        except ValueError:
            crit = set()
    desc = G.descendants(units)
    now = clock_ms(store)
    ready = [u for u in units if u.state == UnitState.READY.value]
    ready.sort(key=lambda u: (u.id not in crit, -len(desc.get(u.id, ())),
                              int(u.detail.get("ready_ms", now)), G._id_key(u.id)))
    if limit is None:
        busy = sum(1 for u in units if u.state == UnitState.LEASED.value)
        limit = max(cfg.max_parallel_units - busy, 0)
    return ready[:limit]
