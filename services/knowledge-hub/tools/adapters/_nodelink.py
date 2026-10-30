"""Shared converter: a networkx node_link graph.json -> the FIXED KH import contract.

This is TOOL-SIDE code (plug-in/plug-out). KH does NOT contain it — KH only ingests
the contract this produces. graphify writes graph.json natively; gitnexus is dumped to
the same node_link shape by gitnexus_reader.ps1. Both thin CLIs (graphify_to_kh.py,
gitnexus_to_kh.py) call node_link_to_contract() and POST the result to /codegraph/import.

KH contract:
    node = {id, label, code_type, attr_type, source_file, source_location}
    edge = {source, target, relation, confidence, source_file, source_location}
"""
from __future__ import annotations

import json

# KH graph node model has 5 ATTR types; fold richer tool kinds down to the closest
# and keep the original in code_type (nothing lost). Mirrors the old in-KH reader.
_TYPE_TO_ATTR = {
    "function": "Action", "method": "Action", "constructor": "Action",
    "class": "System", "interface": "System", "struct": "System",
    "enum": "System", "trait": "System", "impl": "System",
    "namespace": "System", "route": "System", "tool": "System",
    "file": "Artifact", "folder": "Artifact", "module": "Artifact",
    "const": "Artifact", "property": "Artifact", "codeelement": "Artifact",
}


def _map_type(raw: str | None) -> str:
    return _TYPE_TO_ATTR.get((raw or "").strip().lower(), "Artifact")


def _node_kind(n: dict) -> tuple[str, str]:
    """(code_type, attr_type) for one node_link node — explicit type wins, else infer
    from graphify's _callable/_callable_class flags + file_type."""
    explicit = (n.get("type") or "").strip()
    if explicit:
        return explicit, _map_type(explicit)
    if n.get("_callable_class"):
        return "class", "System"
    if n.get("_callable"):
        return "function", "Action"
    return (str(n.get("file_type") or "file"), "Artifact")


def _map_relation(raw: str | None) -> str:
    return (raw or "RELATED_TO").strip().upper().replace(" ", "_") or "RELATED_TO"


def _confidence(label) -> float:
    if isinstance(label, (int, float)):
        return float(label)
    return 0.6 if (label or "").strip().upper() == "INFERRED" else 1.0


def node_link_to_contract(graph: dict) -> tuple[list[dict], list[dict]]:
    """Convert a node_link dict ({nodes:[...], links|edges:[...]}) to KH contract."""
    raw_nodes = graph.get("nodes", []) if isinstance(graph, dict) else []
    raw_links = graph.get("links", graph.get("edges", [])) if isinstance(graph, dict) else []

    nodes: list[dict] = []
    for n in raw_nodes:
        nid = n.get("id")
        if not nid:
            continue
        code_type, attr_type = _node_kind(n)
        nodes.append({
            "id": str(nid),
            "label": str(n.get("label") or n.get("norm_label") or nid),
            "code_type": code_type,
            "attr_type": attr_type,
            "source_file": str(n.get("source_file") or ""),
            "source_location": str(n.get("source_location") or ""),
        })

    edges: list[dict] = []
    for e in raw_links:
        src, tgt = e.get("source"), e.get("target")
        if not src or not tgt:
            continue
        edges.append({
            "source": str(src),
            "target": str(tgt),
            "relation": _map_relation(e.get("relation")),
            "confidence": _confidence(e.get("confidence")),
            "source_file": str(e.get("source_file") or ""),
            "source_location": str(e.get("source_location") or ""),
        })
    return nodes, edges


def load_node_link(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
