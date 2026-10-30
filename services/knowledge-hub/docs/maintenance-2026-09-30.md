# KH maintenance, 2026-09-30

One day of maintenance on KnowledgeHub (BTP br10: prod `knowledge-hub` on `kh-hana-v2`, dev `kh-sso`
on `kh-sso-hana`). It started from fen's question: does KH keep the context an assistant loads
stable while the data keeps growing, the way it was meant to? This page is the record: what was
measured, what changed, how it was proved, and what is still open.

## The answer, in short

The primitives were right (bounded similarity search, per-project stores, the hot log window,
literal project matching), but the way the hooks told assistants to use them was not: three reads
grew with the data, graph played no part in knowledge or logs, and the embedder silently ignored
most of every long row. All of that is fixed or bounded now, on dev and prod.

| What an assistant does | Before | After |
|---|---|---|
| Latest entry on a subject (196 rows) | 1,639 KB, correct | 1.7 KB, correct |
| Stop check (newest row) | 415 KB, **wrong** | 1.7 KB, correct |
| Everything since a moment (10 rows) | 1,639 KB | 26 KB |
| 14 meaning questions, k=5 | 246 KB, 7/14 | 161 KB, 7/14 |
| Who is X (8 names) | 144 KB | 5.6 KB, 8/8 |
| Tail of a long row (20 rows) | 2/20 found | 8/20 found |

Measured on prod `ticketing-system` (before) against the same 461 rows copied to dev as
`ticketing-bench` (after). Full report with method: `C:/RWTemp/kh-before-after-2026-09-30.html`.

## What was measured first

Scale review (`C:/RWTemp/kh-scale-review-2026-09-30.html`), on the local KH 9000 with 1,843 logs,
638 knowledge rows and 20 projects:

- Similarity search was bounded (`/vector/query` k=5: 15 KB).
- The kernel's recency rule scrolled a whole project log and sorted it in the model: 227 KB for
  knowledge-hub, about 1.65 MB for ticketing-system.
- The Stop check read 50 rows (141 KB) and could miss the newest, because scroll is not ts-ordered.
- Log rows: median 2.4 KB, p90 5.5 KB, max 12.9 KB; every read returned them whole.
- Graph: only four code-scan graphs; knowledge and logs were in none.
- HANA backend: exact `COSINE_SIMILARITY` scan, and every filtered query read the META of every
  row of the collection into Python.
- `/orchestrator/resolve` answered 500 on the local KH.

## What changed

| Commit | Change | Change log |
|---|---|---|
| `b813021` | `/log/recent?project=` shows every author's rows on that project to its readers; personal project per person (`personal-<e-mail slug>`) for personalization | `2026_09_30_log_recent_project_all_authors.md`, `2026_09_30_personal_projects.md` |
| `0f3b3fd` | Recency sorted on the server (`/log/recent` with project reads window + spilled; `/vector/scroll` `order`, `since`, `ids`); snippets (`max_chars`); `/orchestrator/resolve` no longer uses the retired semantic policy match and skips unreadable collections; `test_hotlog` fixed | `2026_09_30_recency_and_snippets.md` |
| `062eed6`, `3c40cb5` | HANA: metadata filters pushed into SQL (`JSON_VALUE`), exact filters ranked in one statement | `2026_09_30_hana_where_pushdown.md` |
| `0f3a53f` | Entity cards: `POST /entities`, `GET /entities/match`, `GET /entities/{project}/{name}` | `2026_09_30_entity_cards.md`, `docs/entities.md` |
| `a6f6cd7`, `93844c7` | Chunk vectors for long rows (sidecar `kh_chunk_<project>`), `POST /vector/rechunk` | `2026_09_30_chunk_vectors.md` |

Hooks (data, not code; set with `/hooks/set` on dev and prod): the kernel reads snippets first and
fetches full text by id, answers recency with `/log/recent`, reads the Stop check with `limit=1`, and
writes and reads entity cards; the read-log rule and the prompt guard follow. Backups of the
previous hook sets are in the session scratchpad (`hooks_prod_before_deploy_20260930.json`,
`hooks_dev_before_20260930.json`). kh-helper needed no change: it fetches hooks live and reaches
every route through the generic `kh_call`.

Data work the same day: m360 synced from the local KH to prod (owner rowan.hoang@simplemdg.com);
fen's 42 local personalization rows moved into `personal-rowan-hoang-simplemdg-com` on prod;
prod rechunked (logs 1,764 chunks for 1,190 long rows, knowledge 315, fen's personal 10).

## What the database and the embedder can do

Probed on the br10 HANA Cloud (build 4.00.000.00.1787043349) with a temporary service key, since deleted:

| Capability | Status |
|---|---|
| Vector type, `COSINE_SIMILARITY`, `L2DISTANCE`, half vectors | works; all KH vectors are 384-dimensional |
| HNSW vector index | can be created, even on the dimension-less `EMB`; the plan for KH's ranking query still shows `TOP K SORT` (exact scan), so it is not used |
| In-database embedding (`VECTOR_EMBEDDING`, `SAP_NEB.20240715`) | enabled but failing: "SSL certificate validation failed" between HANA and the embedding service; needs the instance owner / SAP, not KH |
| Property graph (`CREATE GRAPH WORKSPACE`, openCypher) | works |
| Knowledge graph (`SPARQL_EXECUTE`) | not enabled: "No active TripleStore found" |

Embedder: `bge-small-en-v1.5`, English only (fine, KH stores English and the hooks translate
questions), 384 dimensions, **512-token limit**. 377 of 437 ticketing logs (86 %) are longer (median
949 tokens), which is what chunk vectors fix.

## How it was proved

- Local suite green, with new tests: `test_personal` 20, `test_recency_snippets` 17, `test_resolve` 4,
  `test_entities` 19, `test_chunks` 17 (real embedder), `test_sql_filter` 7; `test_hotlog` passing again.
- Keycloak repo `deploy/btp/e2e_multi_user.py` gained 3.8b (a reader naming a project sees another
  author's worklog, marked) and 3.9b-3.9e (personal projects); 72/72 on dev and on prod after every deploy.
- Benchmarks: `bench.py` (session scratchpad), results in `bench_result.json` and `bench_meaning.json`.

## Still open

- Tail recall is 8/20, not 20/20: a 25-word passage still dilutes in a 1,600-character window. Next
  lever: `KH_CHUNK_CHARS` about 800 (doubles the chunks).
- Entity cards exist, but nothing has backfilled them from the old logs; new ones come from the Stop rule.
- HNSW: find the statement form or hint that makes HANA use the index, then create it at bootstrap.
- In-database embedding: fix the TLS trust on the HANA instance before comparing SAP_NEB with bge-small.
- Response size: metadata makes a 400-character snippet about 1.7 KB; a `fields` projection would cut it.
- The local KH 9000 still runs the old build and the 12 KB-per-prompt local hooks.
- Leftovers: dev `ticketing-bench` (kept for re-runs); prod `personal-kh-test-a-example-invalid`,
  created by e2e 3.9b and never removed; old service keys `kh-sso-local` and `khsso-audit-20260926`
  on `kh-sso-hana`.
