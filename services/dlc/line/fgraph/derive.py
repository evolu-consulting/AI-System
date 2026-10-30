"""Multi-hop dependency derivation, gaps and build order (slice A3). Code only, no model.

derive(graph) -> graph (same object, edges / order / gaps filled):
  1. produces + consumes -> depends_on: a feature that consumes X depends on every feature that produces X
     (derived edge, via [X]). A feature never depends on itself.
  2. parents inherit: a parent feature depends on whatever its children depend on outside the parent's own
     subtree (via [child], basis "inherit") - shown on the tree and in rollups, never used for the build order.
  3. gaps: X is consumed, nothing produces it and X is not external -> gap "unproduced". This is the case
     where an agent would otherwise invent the data or the contract. Two producers of one X -> gap
     "multi_producer" (who owns its shape?).
  4. order: features in dependency order (Kahn), ties by tier then id, so tier-1 / skeleton first.
  5. depth (hops): for every feature, the longest dependency chain under it (critical path length).

gap_questions(graph, run) -> human question drafts (understand_plus.human format, kind "dependency")
  for the unproduced gaps: who provides X? external / add a feature that creates it / not needed.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Set

from .model import FEdge, FeatureGraph, depends_adj, find_cycle


def _subtree(g: FeatureGraph, root: str) -> Set[str]:
    seen, todo = set(), [root]
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        seen.add(n)
        todo += [e.dst for e in g.out(n, "parent_of")]
    return seen


def derive(g: FeatureGraph) -> FeatureGraph:
    g.edges = [e for e in g.edges if not e.derived]           # idempotent: recompute from stated edges
    nodes = {n.id: n for n in g.nodes}
    producers: Dict[str, List[str]] = {}
    consumers: Dict[str, List[str]] = {}
    for e in g.edges:
        if e.kind == "produces":
            producers.setdefault(e.dst, []).append(e.src)
        elif e.kind == "consumes":
            consumers.setdefault(e.dst, []).append(e.src)
    have = {(e.src, e.dst) for e in g.edges if e.kind == "depends_on"}
    gaps: List[Dict[str, Any]] = []
    for x, users in sorted(consumers.items()):
        makers = sorted(set(producers.get(x, [])))
        if not makers:
            if not (nodes.get(x) and nodes[x].external):
                gaps.append({"kind": "unproduced", "node": x, "name": nodes[x].name if x in nodes else x,
                             "node_kind": nodes[x].kind if x in nodes else "", "consumers": sorted(set(users))})
            continue
        if len(makers) > 1:
            gaps.append({"kind": "multi_producer", "node": x, "name": nodes[x].name if x in nodes else x,
                         "node_kind": nodes[x].kind if x in nodes else "", "producers": makers})
        for u in sorted(set(users)):
            for m in makers:
                if m != u and (u, m) not in have:
                    have.add((u, m))
                    g.edges.append(FEdge(src=u, dst=m, kind="depends_on", derived=True, via=[x], basis="data"))
    # parents inherit their children's outside dependencies (bottom-up, deepest tier first)
    for p in sorted(g.by_kind("feature"), key=lambda n: -int(n.tier or 0)):
        inside = _subtree(g, p.id)
        for child in inside - {p.id}:
            for e in [e for e in g.edges if e.src == child and e.kind == "depends_on" and e.basis != "inherit"]:
                if e.dst not in inside and (p.id, e.dst) not in have:
                    have.add((p.id, e.dst))
                    g.edges.append(FEdge(src=p.id, dst=e.dst, kind="depends_on", derived=True, via=[child],
                                        basis="inherit"))
    g.gaps = gaps
    adj = depends_adj(g)
    g.order = [] if find_cycle(adj) else topo(adj, {n.id: n for n in g.by_kind("feature")})
    return g


def topo(adj: Mapping[str, List[str]], feats: Mapping[str, Any]) -> List[str]:
    """Dependencies first (Kahn); among ready features, lower tier first, then id."""
    need = {k: set(v) & set(adj) for k, v in adj.items()}
    order: List[str] = []
    while need:
        ready = sorted((k for k, v in need.items() if not v),
                       key=lambda k: (int(getattr(feats.get(k), "tier", 0) or 0), k))
        if not ready:
            break
        nxt = ready[0]
        order.append(nxt)
        del need[nxt]
        for v in need.values():
            v.discard(nxt)
    return order


def depth(g: FeatureGraph) -> Dict[str, int]:
    """Longest dependency chain below each feature (0 = needs nothing)."""
    adj = depends_adj(g)
    memo: Dict[str, int] = {}

    def d(n: str, path: frozenset) -> int:
        if n in memo:
            return memo[n]
        if n in path:
            return 0
        v = 1 + max((d(m, path | {n}) for m in adj.get(n, []) if m in adj), default=-1)
        memo[n] = v
        return v
    return {n: d(n, frozenset()) for n in adj}


def must_precede(g: FeatureGraph) -> Dict[str, Set[str]]:
    """feature -> every feature it transitively depends on (the multi-hop closure)."""
    adj = depends_adj(g)
    out: Dict[str, Set[str]] = {}

    def walk(n: str) -> Set[str]:
        if n in out:
            return out[n]
        out[n] = set()
        acc: Set[str] = set()
        for m in adj.get(n, []):
            acc |= {m} | walk(m)
        out[n] = acc
        return acc
    for n in adj:
        walk(n)
    return out


def needs_text(g: FeatureGraph, f_items: List[str], units: List[Mapping[str, Any]] = ()) -> str:
    """For a builder: what the unit's F-items use, who provides each (an F-item, the merged units that built
    it and their files) or that it comes from outside. Empty when the graph names nothing for them."""
    nodes = {n.id: n for n in g.nodes}
    feats = [n for n in g.by_kind("feature") if n.f_item in f_items]
    producers: Dict[str, List[str]] = {}
    for e in g.edges:
        if e.kind == "produces":
            producers.setdefault(e.dst, []).append(e.src)
    lines: List[str] = []
    for f in feats:
        for e in g.out(f.id, "consumes"):
            x = nodes.get(e.dst)
            if x is None:
                continue
            if x.external:
                lines.append("- %s uses %s '%s': given from outside, read it as input, do not build or invent it"
                             % (f.f_item, x.kind, x.name))
                continue
            makers = [nodes[p] for p in producers.get(x.id, []) if p in nodes and p != f.id]
            if not makers:
                continue
            who = []
            for m in makers:
                built = [u for u in units if m.f_item and m.f_item in (u.get("f_items") or [])
                         and u.get("state") == "merged"]
                files = sorted({c for u in built for c in u.get("claims") or []})
                who.append("%s%s" % (m.f_item or m.name, (" (already built in %s)" % ", ".join(files)) if files else ""))
            lines.append("- %s uses %s '%s' made by %s: use that exact shape, do not redefine it (spec: \"%s\")"
                         % (f.f_item, x.kind, x.name, "; ".join(who), (x.quote or e.quote)[:160]))
    return "\n".join(lines)


def gap_questions(g: FeatureGraph, run: str = "") -> List[Dict[str, Any]]:
    """Human question drafts for the unproduced gaps (one per missing producer)."""
    nodes = {n.id: n for n in g.nodes}
    drafts = []
    for gap in g.gaps:
        if gap["kind"] != "unproduced":
            continue
        x = nodes.get(gap["node"])
        users = gap["consumers"]
        f_items = sorted({nodes[u].f_item for u in users if u in nodes and nodes[u].f_item})
        ev = []
        for e in g.edges:
            if e.kind == "consumes" and e.dst == gap["node"] and e.span_id and e.quote:
                ev.append({"span_id": e.span_id, "quote": e.quote})
        if not ev and x is not None and x.span_id and x.quote:
            ev.append({"span_id": x.span_id, "quote": x.quote})
        if not ev:
            continue                                  # no evidence -> no valid question (I07); the gap stays
        name = gap["name"]
        who = ", ".join(nodes[u].name if u in nodes else u for u in users)
        drafts.append({
            "kind": "dependency",
            "decision": "Nothing in the spec creates %s '%s', which %s use(s). Where does it come from?"
                        % (gap["node_kind"] or "data", name, who),
            "options": [
                {"id": "external", "text": "'%s' comes from outside the system (user input or an existing system)" % name,
                 "impact": "no feature builds it; the consumers read it as given and their tests supply it"},
                {"id": "add_feature", "text": "Add a feature that creates '%s' before %s" % (name, who),
                 "impact": "the spec gets an addendum with a new F-item that is built first"},
                {"id": "not_needed", "text": "%s do(es) not need '%s'" % (who, name),
                 "impact": "the consumes relation is dropped from the graph"},
            ],
            "recommended": "external",
            "evidence": ev[:3],
            "f_items": f_items,
            "refs": [{"entity": "fgraph_gap", "id": "%s:%s" % (run, gap["node"])}] if run else [],
            "fingerprint": "fgraph-gap:%s:%s" % (g.pack_version[:12], gap["node"]),
        })
    return drafts


__all__ = ["derive", "topo", "depth", "must_precede", "gap_questions", "needs_text"]
