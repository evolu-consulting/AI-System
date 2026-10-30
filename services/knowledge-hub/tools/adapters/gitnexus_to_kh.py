"""gitnexus adapter (TOOL-SIDE, plug-in/plug-out).

gitnexus stores its graph in a LadybugDB index under <repo>/.gitnexus/ — not a portable
file. gitnexus_reader.ps1 dumps it (via cypher) to a node_link json; this adapter converts
that dump to the FIXED KH contract and imports it. KH contains NO gitnexus-specific logic.

Pipeline:
  gitnexus analyze <repo>            # produces <repo>/.gitnexus/
  gitnexus_reader.ps1 -Repo <repo>  # dumps .gitnexus -> node_link json (this file's input)
  python gitnexus_to_kh.py <dump.json> --source-id <project>

Usage:
  python gitnexus_to_kh.py <nodelink_dump.json> --source-id <project>
                           [--kh http://localhost:9000] [--exclude basicblock] [--dry-run] [--out c.json]
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
    ap = argparse.ArgumentParser(description="gitnexus node_link dump -> KH contract import")
    ap.add_argument("nodelink_json", help="node_link json dumped from .gitnexus by gitnexus_reader.ps1")
    ap.add_argument("--source-id", required=True, help="canonical project id (no tool prefix)")
    ap.add_argument("--kh", default="http://localhost:9000")
    ap.add_argument("--topic", default="codegraph")
    ap.add_argument("--exclude", nargs="*", default=None,
                    help="node code_types to drop. Default KH drops basicblock (gitnexus emits ~286k).")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", help="write the KH-contract json here instead of importing")
    args = ap.parse_args()

    nodes, edges = node_link_to_contract(load_node_link(args.nodelink_json))
    print(f"gitnexus -> contract: nodes={len(nodes)} edges={len(edges)}", file=sys.stderr)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"nodes": nodes, "edges": edges}, fh, ensure_ascii=False)
        print(f"wrote KH-contract file: {args.out}", file=sys.stderr)
        return 0

    body = {
        "source_id": args.source_id, "tool": "gitnexus",
        "nodes": nodes, "edges": edges, "topic": args.topic,
        "dry_run": args.dry_run,
    }
    if args.exclude is not None:
        body["exclude_code_types"] = args.exclude
    req = urllib.request.Request(
        f"{args.kh}/codegraph/import",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=1200) as resp:
        print(resp.read().decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
