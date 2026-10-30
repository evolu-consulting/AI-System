"""Feature graph extractor (slice A2): a strong model reads the frozen pack + the reconciled F-items and
states the graph; code checks it (model.check) and asks once more with the exact violations.

extract(pv, digest, llm, run=..., store=...) -> FeatureGraph   (stated nodes / edges only; derive() is A3)
  role "fgraph", keys "fgraph" then "fgraph-retry"; wrong twice -> LineError(FGRAPH_INVALID, violations).
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from .. import codes
from ..codes import LineError
from ..understand._common import load_prompt
from ..understand.readers import render_spans
from .model import FEdge, FeatureGraph, FNode, check

ROLE = "fgraph"
_NODE = {"type": "object", "required": ["id", "kind", "name", "span_id", "quote"],
         "properties": {"id": {"type": "string"}, "kind": {"type": "string"}, "name": {"type": "string"},
                        "tier": {"type": "integer"}, "f_item": {"type": "string"}, "external": {"type": "boolean"},
                        "span_id": {"type": "string"}, "quote": {"type": "string"}}}
_EDGE = {"type": "object", "required": ["src", "dst", "kind", "span_id", "quote"],
         "properties": {k: {"type": "string"} for k in ("src", "dst", "kind", "span_id", "quote")}}
SCHEMA: Dict[str, Any] = {"type": "object", "required": ["nodes", "edges"],
                          "properties": {"nodes": {"type": "array", "items": _NODE},
                                         "edges": {"type": "array", "items": _EDGE}}}


def _fitems_text(digest: Any) -> str:
    out = []
    for f in getattr(digest, "f_items", []) or []:
        out.append("- %s %s (spans: %s)" % (f.id, f.title, ", ".join(f.span_ids)))
    return "\n".join(out) or "(none)"


def parse(data: Any, pack_version: str) -> FeatureGraph:
    if not isinstance(data, Mapping) or not isinstance(data.get("nodes"), list):
        raise LineError(codes.SCHEMA_INVALID, "feature graph answer has no nodes list", {"role": ROLE})
    nodes = []
    for n in data["nodes"]:
        if not isinstance(n, Mapping) or not n.get("id"):
            continue
        nodes.append(FNode(id=str(n["id"]), kind=str(n.get("kind", "")), name=str(n.get("name", "")),
                           tier=int(n.get("tier") or 0) if str(n.get("tier") or "0").lstrip("-").isdigit() else 0,
                           f_item=str(n.get("f_item") or ""), external=bool(n.get("external", False)),
                           span_id=str(n.get("span_id") or ""), quote=str(n.get("quote") or "")))
    edges = [FEdge(src=str(e.get("src", "")), dst=str(e.get("dst", "")), kind=str(e.get("kind", "")),
                   span_id=str(e.get("span_id") or ""), quote=str(e.get("quote") or ""))
             for e in data.get("edges") or [] if isinstance(e, Mapping)]
    return FeatureGraph(pack_version=pack_version, nodes=nodes, edges=edges)


def extract(pv: Any, digest: Any, llm: Any, *, run: str = "", model: Optional[str] = None,
            context: str = "") -> FeatureGraph:
    spans = list(getattr(pv, "spans", []) or [])
    by_id = {sp.id: sp for sp in spans}
    f_items = getattr(digest, "f_items", []) or []
    base = [load_prompt(ROLE), "## Feature items (every one must be a feature node)\n" + _fitems_text(digest)]
    if context:
        base.append("## Project knowledge (read only)\n" + context)
    base.append("## Spec spans (%d)\n%s" % (len(spans), render_spans(spans)))
    last: List[Dict[str, str]] = []
    for key in ("fgraph", "fgraph-retry"):
        parts = list(base)
        if last:
            parts.insert(1, "## Your previous graph was refused; fix exactly these\n" + "\n".join(
                "- %s %s: %s" % (v["code"], v["ref"], v["message"]) for v in last[:40]))
        res = llm.complete(ROLE, "\n\n".join(parts), SCHEMA, key=key, model=model, run=run)
        g = parse(res.data, getattr(pv, "version", ""))
        last = check(g, f_items, by_id)
        if not last:
            return g
    raise LineError(codes.FGRAPH_INVALID, "feature graph invalid twice: %d violation(s)" % len(last),
                    {"violations": last[:50]})


__all__ = ["ROLE", "SCHEMA", "extract", "parse"]
