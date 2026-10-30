# 2026-09-30 - Chunk vectors: the whole of a long row is searchable

## Why

Measured on prod the same day: the embedder, bge-small-en-v1.5, reads at most 512 tokens of a row
and drops the rest. 377 of 437 ticketing worklogs (86 %) are longer (median 949 tokens, max 2,625),
so most of what they say was never embedded. On 12 long rows a passage from the START came back in
the top 5 for 10 of them, a passage from the END for 1. It is also why the before/after benchmark
of the same day found only 7 of 14 meaning questions: all 7 misses were long rows.

## What changed

| Where | Change |
|---|---|
| `app/chunks.py` (new) | Rows longer than `KH_CHUNK_MIN_CHARS` (1,800) get one vector per `KH_CHUNK_CHARS` (1,600) window every `KH_CHUNK_STRIDE` (1,400) characters after the head, in a sidecar collection `kh_chunk_<project>`. Each chunk carries the row's metadata plus `chunk_of`. |
| `POST /vector/add` | Writes (or replaces) the chunks of a long row after storing it. Best effort: a chunk failure is logged, the row stays. |
| `/vector/query` (`app/retriever.py`) | Also searches the sidecars; a chunk hit ranks its ROW, whose text is read back through the query's own lanes, so an invisible or deleted row never comes back through its chunks. |
| `POST /vector/delete` | Removes the chunks of deleted rows. |
| `POST /vector/rechunk` (new, maintainers) | `{scope, project?, dry_run}`: builds chunks for rows stored before. Dry run by default. |
| `app/config.py` | `KH_CHUNK_MIN_CHARS`, `KH_CHUNK_CHARS`, `KH_CHUNK_STRIDE`. |

Rows are never split: scroll, counts, paging, the hot window and spilling see exactly the rows they
saw before. Deleting a project drops its sidecar with its other `kh_*` parts.

## Checks

`tests/test_chunks.py` (17, real embedder): without chunks the tail of a long row barely matches;
with them it is the first hit, returned whole and once; re-add replaces, delete removes, a spilled
worklog is still found, rechunk fixes an old row. Whole suite green.

## Rollout, 2026-09-30

| Step | Result |
|---|---|
| dev `kh-sso` | deployed; `ticketing-bench` rechunked: 412 long rows, 965 chunks, about 1 minute |
| prod `knowledge-hub` | deployed; e2e 72/72 |
| prod rechunk, scope log, per project | 3,814 rows, 1,190 long, 1,764 chunks (largest: ticketing-system 890 in 82 s, simplemdg-ticketing 525 in 68 s) |
| prod rechunk, scope knowledge | 1,076 rows, 223 long, 315 chunks |
| prod rechunk, fen's personal project | 42 rows, 6 long, 10 chunks |

A single rechunk over every project timed out on the caller's side after 120 s; run it per project.
The route is idempotent, so a repeat only replaces chunks.

Measured on prod afterwards, the 20 longest ticketing-system worklogs, a 25-word passage must bring
its row back in the top 5:

| Passage | Before | After |
|---|---|---|
| from the end of the row | 2/20 (top-1 0) | 8/20 (top-1 6) |
| from the start of the row | 12/20 (top-1 10) | 11/20 (top-1 10) |

Next lever if the tail is still too weak: a smaller `KH_CHUNK_CHARS` (e.g. 800), which doubles the chunks.
kh-helper needs no change: it fetches hooks live and calls every route through the generic kh_call.

## Window size tuned, same day: 1,600 -> 800 characters

Measured on dev `ticketing-bench` with `KH_CHUNK_CHARS=800`, `KH_CHUNK_STRIDE=700`, against prod at
1,600/1,400, same 20 longest logs and passages:

| Passage | No chunks | 1,600 chars | 800 chars |
|---|---|---|---|
| from the end, in top 5 | 2/20 | 8/20 | 13/20 |
| from the end, first hit | 0/20 | 6/20 | 10/20 |
| from the start, in top 5 | 12/20 | 11/20 | 12/20 |

Cost: 1,964 chunks instead of 890 for the 437 ticketing logs (2.2x), rechunk 113 s instead of 61 s.
The defaults are now 800/700. Rows already chunked at 1,600 keep working; `POST /vector/rechunk`
rebuilds them at the new size (it replaces a row's chunks).
