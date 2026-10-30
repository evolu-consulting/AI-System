"""Graph validation, waves and critical path (block 10, pure code).

Rules (each violation is {"code", "unit", "message"}):
  GRAPH_CYCLE      duplicate unit id, unknown dependency, dependency cycle, or a contract
                   unit that depends on a non-contract unit (contracts must come first)
  UNIT_TOO_BIG     more claims than unit_max_files, no claims at all, or size not S/M/L
  TEST_UNTRACED    an F-item a unit implements has no test in the graph, a known F-item has
                   no unit, or a known test has no unit that owns it
  CLAIM_VIOLATION  two units claim overlapping files with no dependency path between them
                   (they could run at the same time and edit the same place)
  FEATURE_ORDER    (with a feature graph) a unit runs before the units of a feature its own feature needs

Contracts first: every non-contract unit implicitly depends on every contract unit
(effective_deps), so contract units fill the first wave(s) and nothing else starts before
they are merged.
"""

from __future__ import annotations

import fnmatch
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set

from .. import codes
from ..contracts import SIZE_WEIGHTS, Graph, Size, Unit, from_dict

DEFAULT_MAX_FILES = 8


def as_unit(u: Any) -> Unit:
    return u if isinstance(u, Unit) else from_dict(Unit, u)


def _units(graph_or_units: Any) -> List[Unit]:
    if isinstance(graph_or_units, Graph):
        return [as_unit(u) for u in graph_or_units.units]
    if isinstance(graph_or_units, Mapping) and "units" in graph_or_units:
        return [as_unit(u) for u in graph_or_units["units"]]
    return [as_unit(u) for u in graph_or_units]


def effective_deps(units: Sequence[Unit]) -> Dict[str, List[str]]:
    """Declared deps plus the implicit edge contract -> every non-contract unit."""
    contracts = sorted(u.id for u in units if u.contract)
    out: Dict[str, List[str]] = {}
    for u in units:
        deps = list(dict.fromkeys(u.deps))
        if not u.contract:
            deps += [c for c in contracts if c not in deps]
        out[u.id] = deps
    return out


def _find_cycle(deps: Mapping[str, Sequence[str]]) -> List[str]:
    """One cycle as a list of ids (first == last), or [] when the graph is a DAG."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = {k: WHITE for k in deps}
    stack: List[str] = []

    def visit(n: str) -> List[str]:
        color[n] = GREY
        stack.append(n)
        for d in deps.get(n, ()):
            if d not in color:
                continue
            if color[d] == GREY:
                return stack[stack.index(d):] + [d]
            if color[d] == WHITE:
                c = visit(d)
                if c:
                    return c
        stack.pop()
        color[n] = BLACK
        return []

    for k in sorted(deps):
        if color[k] == WHITE:
            c = visit(k)
            if c:
                return c
    return []


def waves(graph_or_units: Any) -> List[List[str]]:
    """Unit ids per wave (wave 1 first): wave = 1 + max wave of effective deps. Needs a DAG."""
    units = _units(graph_or_units)
    deps = effective_deps(units)
    if _find_cycle(deps):
        raise ValueError("graph has a cycle")
    level: Dict[str, int] = {}

    def lvl(n: str) -> int:
        if n not in level:
            level[n] = 1 + max([lvl(d) for d in deps[n] if d in deps] or [0])
        return level[n]

    for u in units:
        lvl(u.id)
    out: List[List[str]] = [[] for _ in range(max(level.values() or [0]))]
    for u in units:
        out[level[u.id] - 1].append(u.id)
    return [sorted(w, key=_id_key) for w in out]


def _id_key(s: str) -> Any:
    digits = "".join(ch for ch in s if ch.isdigit())
    return (s.rstrip("0123456789"), int(digits) if digits else 0, s)


def critical_path(graph_or_units: Any) -> List[str]:
    """Longest path through effective deps, weighted by SIZE_WEIGHTS; first unit first."""
    units = _units(graph_or_units)
    deps = effective_deps(units)
    if _find_cycle(deps):
        raise ValueError("graph has a cycle")
    w = {u.id: SIZE_WEIGHTS.get(u.size, SIZE_WEIGHTS["M"]) for u in units}
    best: Dict[str, Any] = {}

    def length(n: str) -> Any:
        if n not in best:
            prev = [(length(d)[0], d) for d in deps[n] if d in deps]
            if prev:
                # heaviest predecessor; ties -> smallest id for determinism
                top = max(p[0] for p in prev)
                d = sorted([p[1] for p in prev if p[0] == top], key=_id_key)[0]
                best[n] = (top + w[n], d)
            else:
                best[n] = (w[n], None)
        return best[n]

    if not units:
        return []
    for u in units:
        length(u.id)
    top = max(best[u.id][0] for u in units)
    end = sorted([u.id for u in units if best[u.id][0] == top], key=_id_key)[0]
    path = []
    cur: Optional[str] = end
    while cur is not None:
        path.append(cur)
        cur = best[cur][1]
    return list(reversed(path))


def descendants(units: Sequence[Unit]) -> Dict[str, Set[str]]:
    """unit id -> ids of all units that (transitively) wait for it."""
    deps = effective_deps(units)
    rev: Dict[str, Set[str]] = {u.id: set() for u in units}
    for n, ds in deps.items():
        for d in ds:
            if d in rev:
                rev[d].add(n)
    out: Dict[str, Set[str]] = {}

    def walk(n: str) -> Set[str]:
        if n not in out:
            out[n] = set()
            acc: Set[str] = set()
            for c in rev[n]:
                acc.add(c)
                acc |= walk(c)
            out[n] = acc
        return out[n]

    for u in units:
        walk(u.id)
    return out


def _norm(p: str) -> str:
    p = p.replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    return p


def claims_overlap(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    if a == b or fnmatch.fnmatchcase(a, b) or fnmatch.fnmatchcase(b, a):
        return True
    # directory globs: "pkg/**" or "pkg/*" overlaps anything under pkg/
    for x, y in ((a, b), (b, a)):
        for suffix in ("/**", "/*"):
            if x.endswith(suffix) and (y + "/").startswith(x[: -len(suffix)] + "/"):
                return True
    return False


def claim_matches(path: str, claim: str) -> bool:
    """Does a changed repo-relative file fall under a claim (file or glob)?"""
    p, c = _norm(path), _norm(claim)
    if p == c or fnmatch.fnmatchcase(p, c):
        return True
    if c.endswith("/**") and p.startswith(c[:-3] + "/"):
        return True
    if c.endswith("/") and p.startswith(c):
        return True
    return False


def violations(graph_or_units: Any, f_items: Optional[Iterable[str]] = None,
               tests: Optional[Iterable[Any]] = None, max_files: int = DEFAULT_MAX_FILES,
               feature_deps: Optional[Mapping[str, Iterable[str]]] = None) -> List[Dict[str, str]]:
    """All rule violations of a proposed graph (see module doc). f_items / tests are the known
    F-item ids and AccTests (or ids); when given, coverage is checked against them too.
    feature_deps (F-item -> F-items it needs, from the feature graph) adds FEATURE_ORDER: a unit that
    implements X must (transitively) wait for every unit that implements a Y that X needs, unless the
    same unit implements X too."""
    units = _units(graph_or_units)
    out: List[Dict[str, str]] = []

    def v(code: str, unit: str, msg: str) -> None:
        out.append({"code": code, "unit": unit, "message": msg})

    ids = [u.id for u in units]
    seen: Set[str] = set()
    for i in ids:
        if i in seen:
            v(codes.GRAPH_CYCLE, i, "duplicate unit id %s" % i)
        seen.add(i)
    byid = {u.id: u for u in units}
    for u in units:
        for d in u.deps:
            if d not in byid:
                v(codes.GRAPH_CYCLE, u.id, "%s depends on unknown unit %s" % (u.id, d))
            elif d == u.id:
                v(codes.GRAPH_CYCLE, u.id, "%s depends on itself" % u.id)
        if u.contract:
            bad = [d for d in u.deps if d in byid and not byid[d].contract]
            if bad:
                v(codes.GRAPH_CYCLE, u.id, "contract unit %s depends on non-contract %s; contracts must come first"
                  % (u.id, ",".join(bad)))
        if len(u.claims) > max_files:
            v(codes.UNIT_TOO_BIG, u.id, "%s claims %d files > %d" % (u.id, len(u.claims), max_files))
        if not u.claims:
            v(codes.UNIT_TOO_BIG, u.id, "%s claims no files" % u.id)
        if u.size not in (Size.S.value, Size.M.value, Size.L.value):
            v(codes.UNIT_TOO_BIG, u.id, "%s size %r not in S/M/L" % (u.id, u.size))
    cyc = _find_cycle(effective_deps(units))
    if cyc:
        v(codes.GRAPH_CYCLE, cyc[0], "dependency cycle " + " -> ".join(cyc))

    # every implemented F-item has >= 1 acceptance test owned by some unit of the graph
    test_rows = [t if isinstance(t, Mapping) else (vars(t) if hasattr(t, "__dict__") else {"id": t})
                 for t in (tests or [])]
    test_f = {str(t.get("id")): str(t.get("f_item", "")) for t in test_rows}
    owned_by_f: Dict[str, int] = {}
    for u in units:
        for t in u.tests:
            if test_f.get(t):                      # known test: count it for its own F-item
                owned_by_f[test_f[t]] = owned_by_f.get(test_f[t], 0) + 1
            elif not test_f:                       # no test list given: count for the unit's F-items
                for f in u.f_items:
                    owned_by_f[f] = owned_by_f.get(f, 0) + 1
    implemented = list(dict.fromkeys(f for u in units for f in u.f_items))
    for f in implemented:
        if not owned_by_f.get(f):
            owner = next(u.id for u in units if f in u.f_items)
            v(codes.TEST_UNTRACED, owner, "F-item %s has no acceptance test in the graph" % f)
    if f_items is not None:
        for f in f_items:
            if f not in implemented:
                v(codes.TEST_UNTRACED, "", "F-item %s has no unit" % f)
    if test_f:
        owned = {t for u in units for t in u.tests}
        for tid in test_f:
            if tid not in owned:
                v(codes.TEST_UNTRACED, "", "test %s has no unit" % tid)
        for u in units:
            for t in u.tests:
                if t not in test_f:
                    v(codes.TEST_UNTRACED, u.id, "%s owns unknown test %s" % (u.id, t))

    # overlapping claims need a dependency path (only checkable on a DAG)
    if not cyc:
        desc = descendants(units)
        for i, a in enumerate(units):
            for b in units[i + 1:]:
                if b.id in desc[a.id] or a.id in desc[b.id]:
                    continue
                hits = sorted({ca for ca in a.claims for cb in b.claims if claims_overlap(ca, cb)})
                if hits:
                    v(codes.CLAIM_VIOLATION, b.id, "%s and %s both claim %s without a dependency"
                      % (a.id, b.id, ",".join(hits)))
        if feature_deps:
            for u in units:
                for x in u.f_items:
                    for y in sorted(set(feature_deps.get(x) or ())):
                        for w in units:
                            if w.id == u.id or y not in w.f_items or x in w.f_items:
                                continue
                            if u.id not in desc[w.id]:
                                v(codes.FEATURE_ORDER, u.id, "%s implements %s, which needs %s, but does not wait "
                                  "for %s (implements %s)" % (u.id, x, y, w.id, y))
    return out


def validate(graph_or_units: Any, f_items: Optional[Iterable[str]] = None, tests: Optional[Iterable[Any]] = None,
             max_files: int = DEFAULT_MAX_FILES) -> List[str]:
    """Codes of all violations, de-duplicated, in first-seen order. [] = valid."""
    return list(dict.fromkeys(x["code"] for x in violations(graph_or_units, f_items, tests, max_files)))


def finish(graph: Graph) -> Graph:
    """Fill waves, critical_path and each unit's wave (graph must be valid)."""
    units = _units(graph)
    ws = waves(units)
    pos = {uid: i + 1 for i, w in enumerate(ws) for uid in w}
    for u in units:
        u.wave = pos[u.id]
    graph.units = units
    graph.waves = ws
    graph.critical_path = critical_path(units)
    return graph
