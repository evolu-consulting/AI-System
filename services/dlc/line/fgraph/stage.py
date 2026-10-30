"""The feature-graph stage hook (slices A1 + A3 wired to the human-question flow).

on_graph(ctx, pv, digest, graph) -> {"status", "graph", "violations", "gaps", "questions"}
  WHERE: Pipeline, after the digest (and understand_plus) and before the acceptance tests, once the
  extractor (slice A2) has produced `graph`. ctx is the Pipeline (sstore/store, run, llm, cfg, rag).
  1. earlier answers are applied: a gap answered "external" marks its node external, "not_needed" drops
     the consumes edges; "add_feature" comes back as a new F-item through the spec addendum.
  2. check() with the pack's spans; violations -> LineError(FGRAPH_INVALID) (the graph is evidence, a
     broken one must not steer the build).
  3. derive(): multi-hop depends_on, order, gaps; graph stored (entity feature_graph, id = run), every
     gap stored (entity fgraph_gap), fgraph.checked emitted.
  4. unproduced gaps become ONE round of questions (kind "dependency"); then, exactly like understand_plus:
       dry_human=auto  -> answered from fixtures / the recommendation, status "answered"
       human_mode=decide -> the model decides and logs every decision, status "answered"
       otherwise       -> the run parks, status "waiting_human" (drive returns, nothing escalated)
     "answered" means: call on_graph again (the answers are applied in step 1).
  No gaps -> status "ok"; the planner reads graph.order.
"""

from __future__ import annotations

from typing import Any, Dict

from .. import codes
from ..codes import LineError
from ..contracts import E_FGAP, E_FGRAPH
from .derive import derive, gap_questions
from .model import FeatureGraph, check, to_dict


def enabled(cfg: Any) -> bool:
    return bool(getattr(cfg, "fgraph_enabled", False))


def _store(ctx: Any) -> Any:
    return getattr(ctx, "sstore", None) or getattr(ctx, "store")


def apply_answers(g: FeatureGraph, store: Any, run: str) -> Dict[str, str]:
    """Answers recorded on fgraph_gap rows -> graph edits. Returns {node: option} applied."""
    done: Dict[str, str] = {}
    nodes = {n.id: n for n in g.nodes}
    for row in store.query(E_FGAP, run=run):
        ans = row.get("answer") or {}
        opt = ans.get("option") if isinstance(ans, dict) else None
        nid = row.get("node")
        if not opt or nid not in nodes:
            continue
        if opt == "external":
            nodes[nid].external = True
        elif opt == "not_needed":
            g.edges = [e for e in g.edges if not (e.kind == "consumes" and e.dst == nid)]
        done[nid] = opt
    return done


def on_graph(ctx: Any, pv: Any, digest: Any, graph: FeatureGraph) -> Dict[str, Any]:
    from ..understand_plus._common import emit
    from ..understand_plus.human import (ask_round, decide_all, dry_answer_all, dry_mode, human_mode, park,
                                         pending)
    cfg = getattr(ctx, "cfg", None)
    store, run = _store(ctx), ctx.run
    clock = getattr(ctx, "clock", None)
    applied = apply_answers(graph, store, run)
    spans = {sp.id: sp for sp in getattr(pv, "spans", []) or []}
    violations = check(graph, getattr(digest, "f_items", []), spans)
    if violations:
        emit(store, codes.FGRAPH_CHECKED, run, {"nodes": len(graph.nodes), "edges": len(graph.edges),
                                                "violations": violations[:50]}, cfg, pv.version)
        raise LineError(codes.FGRAPH_INVALID, "feature graph invalid: %d violation(s)" % len(violations),
                        {"violations": violations[:50]})
    derive(graph)
    store.put(E_FGRAPH, run, to_dict(graph), run=run)
    for gap in graph.gaps:
        rid = "%s:%s" % (run, gap["node"])
        cur = store.get(E_FGAP, rid) or {}
        store.put(E_FGAP, rid, dict(cur, id=rid, run=run, **gap,
                                    state=cur.get("state", "open") if gap["kind"] == "unproduced" else "info"),
                  run=run)
    emit(store, codes.FGRAPH_CHECKED, run, {
        "nodes": len(graph.nodes), "edges": len([e for e in graph.edges if not e.derived]),
        "derived": len([e for e in graph.edges if e.derived]), "gaps": [g["node"] for g in graph.gaps],
        "violations": [], "order": graph.order, "applied": applied}, cfg, pv.version)
    out: Dict[str, Any] = {"status": "ok", "graph": graph, "violations": [], "gaps": graph.gaps, "questions": []}
    drafts = gap_questions(graph, run)
    if not drafts and not pending(store, run):
        return out
    if drafts:
        r = ask_round(store, run, drafts, cfg=cfg, clock=clock, pack_version=pv.version, base_version=pv.version)
        out["questions"] = r["asked"] + r["held"]
        if r["reused"] and not out["questions"]:
            out["status"] = "answered"                  # every question was answered before: apply and go on
            return out
    open_qs = pending(store, run)
    if not open_qs:
        return out
    park(store, run, f_items=sorted({f for q in open_qs for f in q.get("f_items") or []}),
         questions=[q["qid"] for q in open_qs], scope="run", pack_version=pv.version,
         reason="feature graph: something is used that nothing provides", cfg=cfg, clock=clock)
    if dry_mode(cfg) == "auto":
        dry_answer_all(store, run, cfg=cfg, clock=clock)
        out["status"] = "answered"
    elif human_mode(cfg) == "decide":
        decide_all(store, run, ctx.llm, rag=getattr(ctx, "rag", None), cfg=cfg, clock=clock)
        out["status"] = "answered"
    else:
        out["status"] = "waiting_human"
    return out


__all__ = ["enabled", "apply_answers", "on_graph"]
