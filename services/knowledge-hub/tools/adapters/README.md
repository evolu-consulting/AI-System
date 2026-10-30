# Code-graph tool adapters (plug-in / plug-out)

KH is **tool-agnostic**. It exposes ONE bulk-import endpoint with a **fixed contract**
and never parses a tool's native output. Each code-graph tool has its own adapter here
that reads the tool's output, converts it to the KH contract, and posts it. Adding a new
tool = a new adapter in this folder; **KH does not change**.

## KH contract (`POST /codegraph/import`)

```json
{
  "source_id": "<canonical project id, no tool prefix>",
  "tool": "graphify|gitnexus|...",           // metadata only — KH never branches on it
  "topic": "codegraph",
  "exclude_code_types": ["basicblock"],       // optional; KH default drops basicblock
  "dry_run": false,
  "nodes": [
    {"id","label","code_type","attr_type","source_file","source_location"}
  ],
  "edges": [
    {"source","target","relation","confidence","source_file","source_location"}
  ]
}
```

KH then: namespaces every id `<source_id>__<id>`, embeds SUMMARY (T2) nodes into
`kh_src_<source_id>`, and bulk-inserts all nodes/edges into `kuzu_data/<source_id>/`.

`POST /codegraph/federated` reads a **KH-contract file** (`{nodes,edges}` json an adapter
wrote with `--out`) for query-without-import — the DEFER-IMPORT default.

## Adapters

| Adapter | Tool input | Notes |
|---|---|---|
| `graphify_to_kh.py` | graphify `graph.json` (node_link) | direct convert |
| `gitnexus_to_kh.py` | node_link dump from `gitnexus_reader.ps1` (dumps `.gitnexus`) | dump first, then convert |
| `_nodelink.py` | — | shared node_link→contract converter used by both |

## Add a new tool

1. Write `<tool>_to_kh.py` here that reads the tool's output and emits contract
   `nodes[]/edges[]`.
2. POST to `/codegraph/import` (or `--out` a contract file for federated).
3. Nothing in KH changes.
