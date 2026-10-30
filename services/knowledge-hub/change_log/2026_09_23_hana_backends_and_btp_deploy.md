# 2026-09-23 - every store on HANA, and a cloud copy on SAP BTP

fen asked for a blank KH on the Ticketing System subaccount (8 GB), built from his own
machine, carrying the policy and knowledge of the local :9000 install but none of its
projects. Cloud Foundry gives a container no disk that survives a restart, and fen chose
to put every store into a HANA schema in one go rather than seed from files first.

## What changed

- **`app/sqldb.py` (new).** One connection surface for KH's own tables. On SQLite it opens
  exactly the connection the stores used to open themselves (same timeout, row factory,
  WAL), so the local install behaves as before. On HANA it is a pooled connection with the
  same surface. It also absorbs the three dialect gaps: idempotent `create_table` /
  `create_index` (HANA has no `IF NOT EXISTS`), and `upsert` (HANA does update-then-insert,
  which also covers `hook_rules`, whose unique key is not its primary key).
- **`hooks/store.py`, `policy_actions/store.py`, `projects_store.py`** now open their
  connection through `sqldb` and carry a HANA DDL beside their SQLite DDL. Their queries
  are unchanged. The pre-`project` migration of the policy tables is SQLite-only; a HANA
  table is born with the column.
- **`app/vector_hana.py` (new).** A HANA Cloud vector engine behind the Chroma collection
  calls KH makes, so the ~15 call sites across vector_store, policy, routing, feedback,
  hotlog and main.py did not change. `vector_store.py` swaps the client when
  `KH_VECTOR_BACKEND=hana`. The filter ceiling and its upgrade path are written in the
  module docstring and in `docs/cloud-deployment.md`.
- **`app/hana_conn.py` (new).** A pooled HANA connection shared by the two modules above.
  A cold connect costs about 1.5 s, so connections are reused.
- **`app/config.py`.** `KH_STORE_BACKEND`, `KH_VECTOR_BACKEND`, `KH_API_KEY`; HANA
  credentials fall back to the `VCAP_SERVICES` binding when no `HANA_*` variable is set;
  `PORT` is honoured after `KH_PORT`.
- **`main.py`.** An API key gate, active only when `KH_API_KEY` is set; `/health` stays
  open for the platform probe.
- **`deploy/btp/`** `manifest.yml` + `push.ps1`: org guard, `kh-hana` service (plan
  `schema`), staging with CPU-only torch and the bundled model, key set with `cf set-env`.
- **`tools/migrate_to_hana.py`.** Copies the selection tables from a snapshot, carrying
  embeddings.
- **`tests/test_store_backends.py`.** 32 offline checks, plus 19 more against a live HANA.

## Evidence

- Existing suite, before and after: identical. 6 of 7 pass; `test_hotlog` was already
  failing (`IndexError`) before this change.
- `tests/test_store_backends.py` against the `kh-hana` schema: 51 checks, 0 failed.
- Migration: hook_rules 5/5, policy_actions 5/5, policy_rules 58/58,
  kh_know_orchestrator 119/119 (of 145; the 19 C4 project-registry rows and 7 worklogs
  left out on purpose), kh_policy_orchestrator 19/19, knowledge_hub_vectors 4/4. Every row
  verified present on the target.

## Known limits

- Florence-2 is not shipped, so `/vision/locate-ui` does not work in the cloud copy.

## Second pass, same day: nothing left on the container disk

fen asked for every remaining local store to move to HANA as well.

- **`app/docstore.py` (new).** The feedback counter, the project descriptor and the
  orchestrator manifest were JSON files. They now go through `read_json` / `write_json`
  / `exists` / `delete_tree`: the same files locally, the `kh_docs` table on HANA.
  Callers changed in `feedback.py`, `orchestrator.py` and `projects.py`.
- **Per-project graphs on HANA.** `HanaAdapter` takes a table prefix. The orchestrator
  keeps the global `KH_` tables; every other project gets
  `KH_P_<ID>_<hash>_` tables and its own graph workspace, the same physical isolation the
  per-project Kùzu directories give. `project_graph.get_project_graph` picks HANA when
  `GRAPH_BACKEND=hana`, and `drop_project_graph` drops the project's tables. All
  adapters share one connection pool.
- **HANA adapter brought to parity with Kùzu.** It gained `traverse_logic` (a SQL port,
  behind `/orchestrator/graph_traverse`), set-based `upsert_*_bulk` (executemany), edge
  evidence columns (`ATTRIBUTES`, `SOURCE_TEXT`, `CONFIDENCE`, added in place to an
  existing table), MERGE on edges so a re-ingest refreshes evidence, and `close` / `drop`.
- **Bug fixed on the way:** NCLOB columns come back from hdbcli as LOB handles, and the
  adapter printed them with `str()`. A node's `source_text` and `attributes` would have
  come back as the handle text instead of the content.

Evidence: the existing suite is unchanged (6 of 7, `test_hotlog` failing as before);
`tests/test_store_backends.py` passes 70/70 against the `kh-hana` schema, including a
per-project graph round trip (bulk write, fetch, traverse, evidence refresh,
`min_confidence`, delete, drop) and the document store. The in-place ALTER on the live
`KH_GRAPH_EDGES` (which has a graph workspace attached) succeeded, and the workspace
stayed valid.
