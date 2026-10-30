# Step context and snippets

Roadmap item C (`docs/roadmap-2026-2028.html`). Built 2026-10-03.

Two changes to how KH hands rows to a model:

1. **Snippets show what matched.** `max_chars` used to cut every row to its first `max_chars`
   characters. A row found through one of its chunks (`app/chunks.py`) is now cut to its head plus
   the piece that matched, so the part of a long log that answers the question is the part that
   comes back. `POST /vector/query` also takes a score floor, `min_score`.
2. **`POST /context/step`** answers one step of a piece of work with one bounded pack, in the order
   fen decided on 2026-09-30: entities, then knowledge, and the worklog only when knowledge has
   nothing close enough to answer the step.

## Snippets (`app/retriever.clip_hit`)

| Case | What comes back under `max_chars` |
|---|---|
| Row shorter than `max_chars` | The whole row. |
| Row found by its own vector, or its matching chunk lies inside the first `max_chars` | The first `max_chars` characters, as before. |
| Row found through a chunk past the head | The first `KH_CLIP_HEAD_CHARS` (160) characters, ` [...] `, then the part of the chunk holding most of the query's words, cut so the whole snippet is at most `max_chars`. `piece_at` is where that part starts in the full text. |

Every snippet keeps `truncated: true` and `text_len`; the full row is still
`POST /vector/scroll {"ids": [...]}`. Without `max_chars` nothing changes.

The ceiling: a chunk is 800 characters and a 600-character snippet has room for about 430 of them,
so the part shown is picked by counting the query's words inside the chunk (no second embedding).
The upgrade path is smaller chunks or a sentence-level re-embed of the winning chunk.

## Score floor

`POST /vector/query {"min_score": 0.68, ...}` leaves out hits below the floor. Omitted, every hit
comes back as before. On the bench's 15 retrieval tasks against prod (2026-10-03,
`kh_bench/scripts/floor_experiment.py`), three reads of k=8 per task returned:

| Floor | Rows | Source rows kept (of 20 reached) |
|---|---|---|
| none | 276 | 20 |
| 0.60 | 229 | 19 |
| 0.65 | 179 | 19 |
| **0.68** | **139** | **19** |
| 0.70 | 108 | 18 |
| 0.72 | 88 | 16 |

0.68 halves the rows for one lost source, an entity card at 0.595 that `/context/step` still
reaches by name.

## `POST /context/step`

```json
{"text": "the step about to be taken", "project": "ticketing-system", "budget_chars": 6000, "k": 6}
```

Only `text` is required. The pack is built in this order and stops at the budget:

| Tier | What | Rule |
|---|---|---|
| `entity` | Entity cards whose name or alias appears in the step, then the cards nearest the step by meaning | named: the project's cards, or every readable project's when none is given; by meaning: score at or above `KH_STEP_FLOOR`; at most `KH_STEP_ENTITY_LIMIT` (4) each |
| `log-recent` | The project's worklog, newest first | only for a TIME step: an ISO date (that whole UTC day) or a word of `KH_STEP_TIME_WORDS`; at most `KH_STEP_RECENT_LIMIT` (8) |
| `knowledge` | Knowledge by meaning: the project's, then the shared lessons project (`KH_TURN_LESSON_PROJECT`) | score at or above `KH_STEP_FLOOR` (0.68) |
| `log` | The worklog by meaning, at or above the floor | only when the best knowledge row scores below `KH_STEP_KNOW_ENOUGH` (0.75), and not on a time step; its rows then join the knowledge rows in score order |

Why two thresholds: on the bench (2026-10-03) the ticketing project holds many knowledge rows at
0.70-0.74 for almost any question, while the log rows that answer it score 0.77-0.79. With "log only
when knowledge is empty" those rows blocked the log; with a second, higher threshold they no longer do.

Every row is a snippet of `KH_STEP_ITEM_CHARS` (600). The pack stops at `budget_chars`
(default `KH_STEP_BUDGET_CHARS`, 6,000, about 1.5k tokens); the item that does not fit is cut to
the room left when at least 200 characters remain, and `cut_at_budget` says so.

The answer: `project`, `time_step`, `since`, `tiers` (the tiers that contributed, in order),
`floor`, `budget_chars`, `used_chars`, `cut_at_budget`, `count`, and `items`, each with `tier`,
`id`, `score`, `text` and, when cut, `truncated`, `text_len`, `piece_at`; worklog items carry `ts`.

## Access

Signed-in callers only (`kind: authenticated` in `app/auth_rules.json`). A named project the caller
cannot read is a 403. Without a project, entity cards come from readable projects only, and rows
pass `auth.row_visible` like every other read. The lessons project is read only by callers who may
read it.

## Failure

A tier that raises is logged and left out; the others still answer.

## Speed

All reads of a step run at once (`asyncio.gather`); the log by meaning is read speculatively and
used only when knowledge is not close enough. The recency tier uses `GET /log/recent` with `since`
and `until`, and `/log/recent` itself now sorts on `(id, ts)` alone - `field_values_vt`, which on
HANA selects `JSON_VALUE(META, '$.ts')` without reading DOC or META - and reads the text of the
kept page only. On the ticketing log that took one dated read from 5.8 s to 2.1 s, measured from
the bench machine. One step call on dev, tier 1, 2026-10-03: p50 1.8 s, p95 3.0 s from the bench
machine, of which about 1.2 s is the network to BTP (`/health` answers in 1.25 s).

## The hook rule

On dev only (2026-10-03): the `UserPromptSubmit` rule `step-wise` tells the model to make one
`POST /context/step` call per step instead of separate `/vector/query`, `/entities/match` and
`/log/recent` calls, and the `prompt-guard` rule points its "THE WORK ITSELF" line at it. Set with
`kh_bench/scripts/set_dev_step_rule.py`; the earlier dev rules are kept in
`kh_bench/results/dev_hooks_before_C.json` (`set_dev_step_rule.py restore`). Prod is unchanged.

Checks: `tests/test_context_step.py`; the live HANA part of `tests/test_store_backends.py` for
`field_values`.
