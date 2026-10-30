# 2026-10-05 - Item C to prod, with open threads (roadmap item C closed)

## Why

Item C (`/context/step`, one bounded pack per step) waited on fen's go for prod. Before the go fen
asked what one call per step loses against the old chain of 3-5 separate reads. Gap 1 (worklog
gated behind knowledge) is to be solved by item D; gap 2 (multi-source questions cost more) is a
known weakness; gap 3 (the model may stop after one pack) got three layers, measured here.

## What changed

| Where | Change |
|---|---|
| `app/step.py` | Each pack carries `open_threads`: names and relation targets in the pack without their card, ticket/PR/MR references, rows cut at the budget (ids), worklog rows skipped because knowledge looked close enough, a newer log entry than the packed log rows. `best_score`; request flag `include_log`. |
| `app/config.py` | `STEP_THREAD_LIMIT` (5). |
| `tests/test_context_step.py` | Open-thread checks; all pass. |
| hooks, dev and prod | `step-wise` rule: every claim cites a pack item id; any open thread the answer depends on gets one more step; at most 3 extra steps. Per-prompt text 1,406 / 1,500 chars. |
| `kh_bench/tasks.json` (unversioned tools) | H1-H6: two-hop questions built from prod entity cards (m360 and ticketing-system chains). |

## Measured (tier 2, core 6 + H1-H6, 2 runs per side, prod data copied to dev)

| sum of medians | score / 12 | input tokens | cost USD |
|---|---|---|---|
| prod (lazy kernel, no C) | 10.17 - 10.32 | ~3.56M | ~1.88 |
| dev, C with the 2026-10-03 rule | 11.60 | 1.43M | 0.90 |
| dev, C + open threads + new rule (shipped) | 11.40 | 1.51M | 0.93 |

Open threads showed no score gain: C already answered every two-hop question fully, so the bench did
not provoke an early stop. Cost +6% against C alone, inside the +10% guard; kept as a safety layer.

## Prod rollout and checks

- Deployed branch `kh-btp-hana` (lint `95319b7`, open threads `e74efaa`) to `knowledge-hub`;
  prod hooks `prompt-guard` and `step-wise` copied from dev and read back.
- e2e multi-user: dev 73/73, prod 73/73. `/health` ok. `GET /policy/lint` on prod: every hook type
  within budget, no overlaps; one oversize description (`ship code change`, ticketing-system, 800 chars).
- Live `claude -p` on prod through kh-helper: labels picked correctly; a compound message used
  `/context/step`. A bare greeting was answered without fetching `talk with user` (harmless).

## Open

- The local KH exe (build of 2026-08-29) has none of lint, item C or open threads.
- Multi-source questions (X2) still cost more under C.
- Next roadmap steps: D (weekly distill; needs fen's approval of the piece schema), F (multi-instance).
