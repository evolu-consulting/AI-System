# 2026-08-29 — The hot log window, and a true total for `/vector/scroll`

Two changes, both asked for by fen on 2026-08-29. They ship together because the second
is a prerequisite for trusting the first: a window you cannot count is a window you
cannot verify.

## 1. `/vector/scroll` reports a real total (bug fix)

`matched` was the number of rows the route had FETCHED, not the number matching the
filter. The route asked each collection for `limit` rows and then reported the size of
the merged result, so `matched` was capped by `limit` and grew as `limit` grew.
Measured against the live install before the fix, on a partition holding 104 rows:

| limit | matched reported |
|------:|-----------------:|
| 5     | 5                |
| 50    | 50               |
| 500   | 104              |

The damage is silent. A caller reading with a modest limit sees `matched == limit`,
concludes it has the whole partition, and stops — which is exactly what the standing
worklog-read instruction told readers to do ("paginate if matched > limit", a condition
that could never be true). `scroll_vt` had the correct number all along; the route
discarded it.

`offset` was broken in the same place and for the same reason: the route fetched
`limit` rows starting at 0 and then sliced `[offset : offset+limit]`, so any offset at
or beyond `limit` returned an empty page while rows still existed.

Fixed in `main.py::vector_scroll`: sum the per-collection totals that `scroll_vt`
already computes, and fetch `offset + limit` rows per lane so the post-merge slice is
valid. `count` keeps its meaning (rows in this page). **Callers should page until
`count < limit`.**

## 2. The hot log window (feature)

**The problem.** Logs are physically isolated per project (`kh_log_<id>`). That makes
"what happened with X lately?" unanswerable until the project has been resolved, and a
cross-project answer means scanning every partition. fen had to prefix every question
with the project name.

**The shape.** Every worklog is now written to ONE shared partition, `kh_hotlog`,
tagged with the project that owns it. A recency question with no project named reads
that partition alone.

**The window is slots, not rows.** One slot per project, capacity
`HOTLOG_SLOTS` (default: `MAX_OPEN_PROJECT_GRAPHS`, currently 6). A slot holds ALL of
that project's recent entries, so several days of work stay answerable. The slot count
deliberately matches the graph LRU cap: a project hot in the graph cache is hot in the
log window, and both evict least-recently-used, so the two windows track each other.

**Nothing is ever lost.** Evicting a slot SPILLS it into `kh_log_<project>` — copy the
row with its existing embedding, then delete from the window. Copy-then-delete is the
deliberate order: a crash in between leaves a duplicate that the next pass overwrites
by id, where the reverse order would lose the row.

**Reads fan in.** Every read of `scope=log` covers both the project's own collection
and the window, with the window lane narrowed to the named project. A caller cannot
tell whether a row is still hot or already spilled — which is what let this land
without changing a single existing read.

Three bounds, all env-tunable, applied in order: age (`HOTLOG_MAX_AGE_DAYS`, 14),
per-slot depth (`HOTLOG_MAX_PER_SLOT`, 50), then slot count (`HOTLOG_SLOTS`).

**New routes.** `GET /log/recent` (newest-first, no project needed, every row reports
its owner) and `GET /log/window` (what the window holds, slot by slot — the window is
silent by design, so it needs a way to be verified rather than trusted).

**The off switch drains.** `KH_HOTLOG=0` stops new writes entering the window AND
spills whatever is still in it, so the flag leaves the store exactly as if the window
had never run. Reads deliberately ignore the flag; gating them on it was caught in
testing hiding every row still sitting in the window.

## Files

- `app/config.py` — `HOTLOG_*` settings.
- `app/hotlog.py` — new: the window policy (slots, bounds, spill).
- `app/vector_store.py` — `hotlog_collection()`, `move_rows()`, public `own_project()`.
- `app/retriever.py` — semantic search covers the window lane.
- `main.py` — write routing, `_read_lanes()`, the `matched`/`offset` fix, the two routes.
- `tests/test_hotlog.py` — new: 14 checks, throwaway store, stubbed embedder.

## Verification

`tests/test_hotlog.py` 14/14. Existing suites unchanged and green:
`test_layers` 16/16, `test_policy_actions` 55/55, `test_project_registry` 27/27.
Also exercised end-to-end against a throwaway server on :9200 (15/15), including the
disabled-flag drain path.
