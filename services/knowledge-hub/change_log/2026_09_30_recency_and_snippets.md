# 2026-09-30 - Recency sorted on the server, snippets, and a working resolve

## Why

The scale review of 2026-09-30 (C:/RWTemp/kh-scale-review-2026-09-30.html) measured the reads
the hooks prescribe. Two of them grow with the data: "the latest entry" meant scrolling a whole
project log and sorting it in the model (227 KB for knowledge-hub, about 1.65 MB for
ticketing-system), and the Stop check read 50 rows (141 KB) and could still miss the newest,
because scroll is not ordered by ts. Log rows run to 13 KB and every read returned them whole.

## What changed

| Where | Change |
|---|---|
| `GET /log/recent` | With `project`: the whole project log (window + spilled), newest first on the server. New `topic`, `max_chars`. Without a project: unchanged. |
| `POST /vector/scroll` | New `order` (newest/oldest), `since`, `ids`, `max_chars`. All opt-in. |
| `POST /vector/query` | New `max_chars`. |
| hits | `truncated` and `text_len` mark a clipped row. |
| `app/vector_store.py` | `get_ids_vt()` fetches exact rows inside a lane's filter. |
| `POST /orchestrator/resolve` | No longer lets a similarity-matched policy switch the project (routing policy is the exact table since 2026-08-21); `semantic_policy: true` restores the old block. An unreadable collection is skipped instead of failing the request. |
| `tests/test_hotlog.py` | Its age cap is now relative to its fixed dates, so it stops failing as the calendar moves. |

## Root cause of the local 500 on /orchestrator/resolve

Chroma raises `Error creating hnsw segment reader: Nothing found on disk` when a collection's rows
were all deleted: `count()` still answers, the vector index is gone. `app/policy.py` queried such a
pool without a guard. The same message shows on `kh_hotlog` after a slot spills every row.

## Checks

- New `tests/test_recency_snippets.py` 17/17, `tests/test_resolve.py` 4/4.
- Whole suite green, including `test_hotlog` (14/14), which had been failing since about 2026-09-12.
