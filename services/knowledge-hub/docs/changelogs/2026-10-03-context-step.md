# 2026-10-03 - Step context and matched-piece snippets (roadmap item C, part 1)

## Why

The tier 2 bench of 2026-10-02 put the cost of a question in model turns: the expensive questions
took 9-12 turns of separate KH reads (knowledge, log, entities, 8 whole rows each). The piece
experiment of 2026-10-01 found that `max_chars` cut a row to its head even when the row was found
through a chunk at its tail, and that each read returned 17-24 rows whatever it asked.

## What changed

| Where | Change |
|---|---|
| `app/retriever.py` | A chunk hit keeps its text (`piece`). `clip_hit` (moved from `main._clip`) cuts a row found through a chunk past the head to head + ` [...] ` + the part of the piece holding most query words; `piece_at` says where. |
| `app/schemas.py`, `main.py` | `POST /vector/query` takes `min_score`; hits carry `piece_at`. Without `max_chars` / `min_score` nothing changes. |
| `app/step.py` (new) | `POST /context/step`: entity cards (by name, then by meaning), the log by recency for a time step, knowledge (project + shared lessons) at floor 0.68, the log by meaning only when the best knowledge row is below 0.75; one budget (6,000 chars). |
| `app/config.py` | `CLIP_HEAD_CHARS`, `STEP_*` (env `KH_CLIP_HEAD_CHARS`, `KH_STEP_*`). |
| `app/auth_rules.json` | `POST /context/step` - authenticated. |
| `tests/test_context_step.py` (new) | Snippet piece, score floor, the step tiers, budget, access. |
| `docs/context-step.md` (new) | The route, the snippets, the thresholds and why. |

## Measured on dev kh-sso against prod (tier 1, 15 retrieval tasks, prod data copied to dev)

| | 3-5 old reads per task | one `/context/step` call |
|---|---|---|
| bytes | 289,783 | 72,643 (-75%) |
| source rows found | 0.833 | 0.867 |
| must-have points in the text | 0.933 | 0.947 |
| latency per task | 5-12 s summed | p50 2.1 s, p95 6.2 s |

The snippet fix alone left `/vector/query` unchanged on tier 1 (0.833 / 0.933 both sides, bytes
+1.5%). Score floor chosen with `kh_bench/scripts/floor_experiment.py` on prod: 0.68 halves the rows
(276 -> 139) and keeps 19 of the 20 source rows those reads reach.

## Open

- p95 of one step call is 6.2 s against a 2 s target: dated time steps scroll the whole project log,
  project-less steps fan out over every project.
- P2 (ticketing deploy steps) drops to 0.2: a data hole, roadmap item D.
- The step-wise hook rule and the tier 2 measurement are not done yet.

# Part 2 (same day): speed, the hook rule, tier 2

## What changed

| Where | Change |
|---|---|
| `app/vector_store.py`, `app/vector_hana.py` | `field_values_vt` / `HanaCollection.field_values`: (id, one metadata field) of a partition without reading DOC or META (META carries a copy of the text). |
| `main.py` | `/log/recent` sorts on (id, ts) and reads the text of the kept page only; new `until` parameter. |
| `app/step.py` | All reads of a step run concurrently; the recency tier passes `since`/`until`. |
| dev hook rules only | `step-wise` (one `/context/step` call per step) enabled, `prompt-guard` points at it. Prod unchanged. |

Tier 1, one step call: p50 2.1 -> 1.8 s, p95 6.2 -> 3.0 s from the bench machine (about 1.2 s of it
network); R1's dated `/log/recent` 5.8 -> 2.1 s. Recall and coverage unchanged.

## Tier 2 core (6 tasks x 3 runs per side, dev with C + the step rule vs prod with B)

| | prod | dev | change |
|---|---|---|---|
| accuracy (of 6) | 4.70 | 5.20 | +0.5 |
| input tokens (medians) | 1,475,511 | 523,265 | -64.5% |
| turns | 58 | 22 | -62% |
| KH calls | 48 | 13 | -73% |
| cost | $0.75 | $0.32 | -57% |

Report: [2026-10-03-context-step-bench.html](2026-10-03-context-step-bench.html), PASS, `--expect input_tokens:-50%`.

Read it with care:
- 9 of the 36 runs (6 dev, 3 prod) hit "knowledge-hub MCP failed to connect" (30 s timeout) on the
  bench machine and answered without KH. Without them: dev 638k vs prod 1,468k tokens, -57%.
- Most of the saving is one task: prod R1 took 824k tokens and 23 turns today (86-92k on
  2026-10-02). Without R1: dev 522k vs prod 644k, -19%. Against the dev B run of 2026-10-02 (652k)
  the dev total barely moved.
- The real gain of C here is accuracy: M3 reached 1.0 on every run (0.5 on every run before, both
  sides, since the first baseline), at 119k tokens instead of 190k. X2 cost more on dev (119k vs 76k
  without the timeouts).
- Before prod: rerun with the MCP timeouts fixed, 5 runs per side for R1, P2, M3.

# Part 3 (same day): clean rerun of tier 2

The bench now gives Claude Code 120 s for an MCP server to start, reads whether the knowledge-hub MCP
connected in every run and runs again any run where it did not (`MCP_TIMEOUT`, `mcp_ok`, `MCP_RETRIES` in
khbench.py). R1, P2, M3 ran 5 times per side, W1, X2, A2 3 times; all 48 runs connected, none needed a rerun.

| | prod (B) | dev (C + step rule) | change |
|---|---|---|---|
| accuracy (of 6) | 5.40 | 5.40 | equal |
| input tokens (medians) | 860,323 | 633,200 | -26.4% |
| turns | 41 | 25 | -39% |
| KH calls | 32 | 17 | -47% |
| cost | $0.43 | $0.34 | -21% |

Report: [2026-10-03-context-step-bench-rerun.html](2026-10-03-context-step-bench-rerun.html). Gate: every guard
PASS (no leak, accuracy not lower, tokens and cost down), the written target `input_tokens -50%` FAIL.

What this changes in part 2's reading:
- The -64% of part 2 was inflated by the MCP failures and by one slow prod R1 run. The clean figure is -26%.
- M3 is no gain of C: prod also scored 1.0 on all 5 runs this time.
- Where C helps: R1 (dated question) 265k -> 115k, P2 201k -> 82k, W1 81k -> 26k.
- Where C costs more: X2 (one person in two projects) 80k -> 154k, M3 150k -> 170k. Both are questions
  without one project, where the step rule makes the model split the work into more steps.
