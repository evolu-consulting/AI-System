"""Feature graph model and checks (slice A1).

A feature graph says WHAT the spec builds and what each part NEEDS, so the line can build in dependency
order and never let an agent invent a contract or a piece of data that nothing provides.

  nodes   feature (tier 1..4: business, module, feature, sub-task - the feature tree's tiers),
          data (an entity / record the system keeps), contract (an interface, API, file format, schema),
          rule (a business rule that constrains features)
  edges   parent_of      feature -> feature   the tree (tier n -> tier n+1)
          depends_on     feature -> feature   stated in the spec ("after", "requires", "uses F1")
          produces       feature -> data | contract
          consumes       feature -> data | contract
          constrained_by feature -> rule

Every stated node and edge carries the span id and a LITERAL quote of the spec (the readers' rule), so
a relation is evidence, not a guess. A data / contract node may be ``external``: the spec says it comes
from outside (user input, an existing system), so no feature has to produce it.

check(graph, f_items, spans) -> violations [{code, ref, message}] (code only, no model):
  FG_UNKNOWN_NODE   an edge names a node that is not in the graph
  FG_EDGE_KIND      an edge joins kinds it cannot (e.g. produces -> feature)
  FG_QUOTE          a stated node / edge has no span, an unknown span, or a quote not in that span
  FG_FITEM_MISSING  an F-item of the digest has no feature node
  FG_TIER           a parent_of edge does not go one tier down, or a feature has two parents
  FG_CYCLE          depends_on (stated + derived) or parent_of contains a cycle
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

NODE_KINDS = ("feature", "data", "contract", "rule")
EDGE_KINDS = {
    "parent_of": ({"feature"}, {"feature"}),
    "depends_on": ({"feature"}, {"feature"}),
    "produces": ({"feature"}, {"data", "contract"}),
    "consumes": ({"feature"}, {"data", "contract"}),
    "constrained_by": ({"feature"}, {"rule"}),
}


@dataclass
class FNode:
    id: str
    kind: str                     # NODE_KINDS
    name: str
    tier: int = 0                 # features 1..4, others 0
    f_item: str = ""              # the digest F-item this feature node is ("" for a grouping node)
    external: bool = False        # data / contract supplied from outside the system
    span_id: str = ""
    quote: str = ""


@dataclass
class FEdge:
    src: str
    dst: str
    kind: str                     # EDGE_KINDS
    span_id: str = ""
    quote: str = ""
    derived: bool = False         # computed (slice A3), not stated
    via: List[str] = field(default_factory=list)
    basis: str = ""               # derived: "data" (consumes/produces) or "inherit" (parent from child; display only)


@dataclass
class FeatureGraph:
    pack_version: str
    nodes: List[FNode] = field(default_factory=list)
    edges: List[FEdge] = field(default_factory=list)
    order: List[str] = field(default_factory=list)          # feature ids, dependencies first
    gaps: List[Dict[str, Any]] = field(default_factory=list)

    def node(self, nid: str) -> Optional[FNode]:
        return next((n for n in self.nodes if n.id == nid), None)

    def by_kind(self, kind: str) -> List[FNode]:
        return [n for n in self.nodes if n.kind == kind]

    def out(self, nid: str, kind: Optional[str] = None) -> List[FEdge]:
        return [e for e in self.edges if e.src == nid and (kind is None or e.kind == kind)]


def from_dict(d: Mapping[str, Any]) -> FeatureGraph:
    return FeatureGraph(
        pack_version=str(d.get("pack_version", "")),
        nodes=[FNode(**{k: v for k, v in n.items() if k in FNode.__dataclass_fields__}) for n in d.get("nodes") or []],
        edges=[FEdge(**{k: v for k, v in e.items() if k in FEdge.__dataclass_fields__}) for e in d.get("edges") or []],
        order=list(d.get("order") or []), gaps=list(d.get("gaps") or []))


def to_dict(g: FeatureGraph) -> Dict[str, Any]:
    from dataclasses import asdict
    return asdict(g)


def _v(code: str, ref: str, message: str) -> Dict[str, str]:
    return {"code": code, "ref": ref, "message": message}


def _span_text(spans: Mapping[str, Any], sid: str) -> Optional[str]:
    sp = spans.get(sid)
    if sp is None:
        return None
    return sp.text if hasattr(sp, "text") else str(sp.get("text", "")) if isinstance(sp, Mapping) else str(sp)


def _quote_issue(spans: Mapping[str, Any], sid: str, quote: str) -> str:
    if not sid:
        return "no span"
    text = _span_text(spans, sid)
    if text is None:
        return "unknown span %s" % sid
    if not quote:
        return "empty quote"
    if quote not in text:
        return "quote not in span %s" % sid
    return ""


def find_cycle(adj: Mapping[str, Sequence[str]]) -> List[str]:
    """One cycle as ids (first == last), or [] for a DAG."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = {k: WHITE for k in adj}
    stack: List[str] = []

    def visit(n: str) -> List[str]:
        color[n] = GREY
        stack.append(n)
        for d in adj.get(n, ()):
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

    for k in sorted(adj):
        if color[k] == WHITE:
            c = visit(k)
            if c:
                return c
    return []


def depends_adj(g: FeatureGraph, inherited: bool = False) -> Dict[str, List[str]]:
    """feature -> features it depends on (stated + derived from data). Edges a parent inherits from its
    children are left out unless asked for: a module-level loop between two modules whose features do not
    loop is a design smell to show, not a reason the features cannot be built."""
    adj: Dict[str, List[str]] = {n.id: [] for n in g.by_kind("feature")}
    for e in g.edges:
        if e.basis == "inherit" and not inherited:
            continue
        if e.kind == "depends_on" and e.src in adj and e.dst not in adj[e.src]:
            adj[e.src].append(e.dst)
    return adj


def check(g: FeatureGraph, f_items: Iterable[Any] = (), spans: Optional[Mapping[str, Any]] = None
          ) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    ids = {}
    for n in g.nodes:
        if n.id in ids:
            out.append(_v("FG_UNKNOWN_NODE", n.id, "duplicate node id"))
        ids[n.id] = n
        if n.kind not in NODE_KINDS:
            out.append(_v("FG_EDGE_KIND", n.id, "unknown node kind %r" % n.kind))
        if n.kind == "feature" and not 1 <= int(n.tier or 0) <= 4:
            out.append(_v("FG_TIER", n.id, "a feature has tier 1..4, not %r" % n.tier))
        if spans is not None and (n.span_id or n.quote):
            why = _quote_issue(spans, n.span_id, n.quote)
            if why:
                out.append(_v("FG_QUOTE", n.id, why))
    parents: Dict[str, List[str]] = {}
    for e in g.edges:
        ref = "%s-%s->%s" % (e.src, e.kind, e.dst)
        if e.src not in ids or e.dst not in ids:
            out.append(_v("FG_UNKNOWN_NODE", ref, "edge names a node that is not in the graph"))
            continue
        if e.kind not in EDGE_KINDS:
            out.append(_v("FG_EDGE_KIND", ref, "unknown edge kind %r" % e.kind))
            continue
        srcs, dsts = EDGE_KINDS[e.kind]
        if ids[e.src].kind not in srcs or ids[e.dst].kind not in dsts:
            out.append(_v("FG_EDGE_KIND", ref, "%s cannot join %s -> %s" % (e.kind, ids[e.src].kind, ids[e.dst].kind)))
            continue
        if not e.derived and spans is not None:
            why = _quote_issue(spans, e.span_id, e.quote)
            if why:
                out.append(_v("FG_QUOTE", ref, why))
        if e.kind == "parent_of":
            parents.setdefault(e.dst, []).append(e.src)
            if int(ids[e.dst].tier or 0) != int(ids[e.src].tier or 0) + 1:
                out.append(_v("FG_TIER", ref, "parent_of must go exactly one tier down (%s -> %s)"
                              % (ids[e.src].tier, ids[e.dst].tier)))
    for child, ps in parents.items():
        if len(ps) > 1:
            out.append(_v("FG_TIER", child, "a feature has one parent, not %s" % sorted(ps)))
    covered = {n.f_item for n in g.by_kind("feature") if n.f_item}
    for f in f_items:
        fid = f.id if hasattr(f, "id") else str(f.get("id") if isinstance(f, Mapping) else f)
        if fid not in covered:
            out.append(_v("FG_FITEM_MISSING", fid, "F-item %s has no feature node" % fid))
    for name, adj in (("depends_on", depends_adj(g)),
                      ("parent_of", {n.id: [e.dst for e in g.out(n.id, "parent_of")] for n in g.by_kind("feature")})):
        cyc = find_cycle(adj)
        if cyc:
            out.append(_v("FG_CYCLE", " -> ".join(cyc), "%s cycle" % name))
    return out


__all__ = ["NODE_KINDS", "EDGE_KINDS", "FNode", "FEdge", "FeatureGraph", "from_dict", "to_dict", "check",
           "find_cycle", "depends_adj"]
