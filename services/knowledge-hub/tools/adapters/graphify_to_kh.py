"""graphify adapter (TOOL-SIDE, plug-in/plug-out).

Reads a graphify graph.json, converts it to the FIXED KH contract, and either POSTs
it to /codegraph/import or writes a KH-contract file for federated query. KH contains
NO graphify-specific logic — all of it lives here.

Usage:
  python graphify_to_kh.py <graph.json> --source-id <project> [--kh http://localhost:9000]
                           [--exclude basicblock] [--dry-run] [--out contract.json]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _nodelink import load_node_link, node_link_to_contract  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="graphify graph.json -> KH contract import")
    ap.add_argument("graph_json")
    ap.add_argument("--source-id", required=True, help="canonical project id (no tool prefix)")
    ap.add_argument("--kh", default="http://localhost:9000")
    ap.add_argument("--topic", default="codegraph")
    ap.add_argument("--exclude", nargs="*", default=None,
                    help="node code_types to drop (default KH: basicblock). Pass nothing to keep KH default.")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", help="write the KH-contract json here instead of importing")
    args = ap.parse_args()

    path = args.graph_json
    if os.path.isdir(path):
        path = os.path.join(path, "graph.json")
    nodes, edges = node_link_to_contract(load_node_link(path))
    print(f"graphify -> contract: nodes={len(nodes)} edges={len(edges)}", file=sys.stderr)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"nodes": nodes, "edges": edges}, fh, ensure_ascii=False)
        print(f"wrote KH-contract file: {args.out}", file=sys.stderr)
        return 0

    body = {
        "source_id": args.source_id, "tool": "graphify",
        "nodes": nodes, "edges": edges, "topic": args.topic,
        "dry_run": args.dry_run,
    }
    if args.exclude is not None:
        body["exclude_code_types"] = args.exclude
    req = urllib.request.Request(
        f"{args.kh}/codegraph/import",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=600) as resp:
        print(resp.read().decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
