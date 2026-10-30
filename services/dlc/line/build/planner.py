"""Planner (block 10): a strong model splits the reconciled digest into feature units; code checks.

plan(digest, tests, repo, llm, store, run=...) -> Graph
  1. repo map (file tree, capped) + F-items + acceptance tests go into prompts/planner.md
  2. llm.complete("planner", ..., PLAN_SCHEMA, key="plan") proposes units
     {id, title, f_items, claims, deps, tests, size, contract}
  3. graph.violations() checks it; on violations the planner is asked again once with the
     exact list (key="plan-retry"); wrong twice -> LineError(<first code>, detail=violations)
  4. valid -> waves, critical path, unit.wave filled; Graph and units stored
     (units start PENDING), GRAPH_VALID emitted.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .. import codes
from ..codes import LineError
from ..config import Config
from ..contracts import (
    E_GRAPH, E_UNIT, AccTest, Digest, FItem, Graph, Size, Unit, UnitState, from_dict, to_dict,
)
from . import graph as G
from ._common import cfg_or_default, env, load_prompt

PLAN_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["units"],
    "properties": {
        "units": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "claims", "deps", "f_items", "tests", "size"],
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "f_items": {"type": "array", "items": {"type": "string"}},
                    "claims": {"type": "array", "items": {"type": "string"}},
                    "deps": {"type": "array", "items": {"type": "string"}},
                    "tests": {"type": "array", "items": {"type": "string"}},
                    "size": {"type": "string", "enum": ["S", "M", "L"]},
                    "contract": {"type": "boolean"},
                },
            },
        },
    },
}

REPO_MAP_MAX = 400
_SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", ".pytest_cache"}


def repo_map(repo: str, limit: int = REPO_MAP_MAX) -> List[str]:
    """Repo-relative file paths (forward slashes), sorted, capped at limit."""
    out: List[str] = []
    if not repo or not os.path.isdir(repo):
        return out
    for root, dirs, files in os.walk(repo):
        dirs[:] = sorted(d for d in dirs if d not in _SKIP_DIRS)
        for f in sorted(files):
            out.append(os.path.relpath(os.path.join(root, f), repo).replace("\\", "/"))
            if len(out) >= limit:
                return out
    return out


def _digest(d: Any) -> Digest:
    return d if isinstance(d, Digest) else from_dict(Digest, d)


def _tests(ts: Iterable[Any]) -> List[AccTest]:
    return [t if isinstance(t, AccTest) else from_dict(AccTest, t) for t in ts]


def _fitems_text(items: Sequence[FItem]) -> str:
    lines = []
    for f in items:
        lines.append("- %s %s (size %s)" % (f.id, f.title, f.size))
        for c in f.criteria:
            lines.append("    - %s: %s" % (c.id, c.text))
    return "\n".join(lines) or "(none)"


def _tests_text(ts: Sequence[AccTest]) -> str:
    return "\n".join("- %s  F-item %s  criterion %s  file %s" % (t.id, t.f_item, t.criterion, t.path)
                     for t in ts) or "(none)"


def parse_units(data: Any, run: str) -> List[Unit]:
    """The planner's JSON -> Units (PENDING). Raises SCHEMA_INVALID on a malformed answer."""
    rows = data.get("units") if isinstance(data, Mapping) else None
    if not isinstance(rows, list):
        raise LineError(codes.SCHEMA_INVALID, "planner answer has no units list", {"role": "planner"})
    units = []
    for r in rows:
        if not isinstance(r, Mapping) or not isinstance(r.get("id"), str) or not r.get("id"):
            raise LineError(codes.SCHEMA_INVALID, "planner unit without id", {"role": "planner", "row": r})
        units.append(Unit(
            id=r["id"], run=run, title=str(r.get("title", "")), state=UnitState.PENDING.value,
            claims=[str(x).replace("\\", "/") for x in r.get("claims") or []],
            deps=[str(x) for x in r.get("deps") or []],
            f_items=[str(x) for x in r.get("f_items") or []],
            tests=[str(x) for x in r.get("tests") or []],
            size=str(r.get("size") or Size.M.value), contract=bool(r.get("contract", False)),
        ))
    return units


def feature_deps(fgraph: Any) -> Dict[str, List[str]]:
    """F-item -> F-items it needs (multi-hop), from a line.fgraph FeatureGraph; {} without one."""
    if fgraph is None:
        return {}
    from ..fgraph.derive import must_precede
    fi = {n.id: n.f_item for n in fgraph.nodes if n.kind == "feature" and n.f_item}
    out: Dict[str, List[str]] = {}
    for nid, before in must_precede(fgraph).items():
        if nid in fi:
            out[fi[nid]] = sorted({fi[b] for b in before if b in fi and fi[b] != fi[nid]})
    return out


def _order_text(fgraph: Any, deps: Mapping[str, Sequence[str]]) -> str:
    fi = {n.id: n.f_item for n in fgraph.nodes if n.kind == "feature" and n.f_item}
    order = [fi[n] for n in fgraph.order if n in fi]
    lines = ["Build order of the F-items (dependencies first): " + " -> ".join(order)]
    for f in order:
        if deps.get(f):
            lines.append("- %s needs %s: every unit of %s must (transitively) depend on the units of %s"
                         % (f, ", ".join(deps[f]), f, ", ".join(deps[f])))
    ext = [n.name for n in fgraph.nodes if n.kind in ("data", "contract") and n.external]
    if ext:
        lines.append("Given from outside (do not build, read as input): " + ", ".join(ext))
    return "\n".join(lines)


def plan(digest: Any, tests: Iterable[Any], repo: str, llm: Any, store: Any, *, run: str,
         cfg: Optional[Config] = None, context: str = "", fgraph: Any = None) -> Graph:
    """Ask the planner for a unit graph, validate it (one corrective retry), store it. With a feature graph
    the planner is given the dependency order and its graph must respect it (FEATURE_ORDER)."""
    cfg = cfg_or_default(cfg)
    dg = _digest(digest)
    ts = _tests(tests)
    f_ids = [f.id for f in dg.f_items]
    fdeps = feature_deps(fgraph)
    if fgraph is not None:
        context = (_order_text(fgraph, fdeps) + "\n\n" + (context or "")).strip()
    vars_ = dict(
        run=run, max_files=cfg.unit_max_files,
        f_items=_fitems_text(dg.f_items),
        rules="\n".join("- " + r.text for r in dg.rules) or "(none)",
        tests=_tests_text(ts),
        repo_map="\n".join(repo_map(repo)) or "(empty repository)",
        context=context or "(none)", violations="(none)",
    )
    last: List[Dict[str, str]] = []
    for key in ("plan", "plan-retry"):
        if last:
            vars_["violations"] = "\n".join("- %s %s: %s" % (x["code"], x["unit"], x["message"]) for x in last)
        prompt = load_prompt("planner", **vars_)
        res = llm.complete("planner", prompt, PLAN_SCHEMA, key=key, run=run)
        units = parse_units(res.data, run)
        last = G.violations(units, f_items=f_ids, tests=ts, max_files=cfg.unit_max_files, feature_deps=fdeps)
        if not last:
            g = G.finish(Graph(run=run, units=units))
            for u in g.units:
                store.put(E_UNIT, u.id, to_dict(u), run=run)
            store.put(E_GRAPH, run, to_dict(g), run=run)
            store.emit(codes.GRAPH_VALID, env(run, cfg, model=res.model, spec_hash=dg.pack_version),
                       {"units": [u.id for u in g.units], "waves": g.waves, "critical_path": g.critical_path,
                        "attempts": 1 if key == "plan" else 2})
            return g
    raise LineError(last[0]["code"], "planner graph invalid twice: %d violation(s)" % len(last),
                    {"violations": last})
