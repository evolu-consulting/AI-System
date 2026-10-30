# 2026-10-10 Tier 2 bench: step-wise rule that passes action/context - NOT adopted

First bench on the E: machine, against the Docker dev (`kh-dev-hana`: HANA Express for tables, Chroma for
vectors, data copied from prod with `tools/kh_bench/scripts/seed_docker_dev.py`, sign-in on).

## Candidate (dev only)

The `step-wise` UserPromptSubmit rule asks for `"action":"<your label>","context":"<a tag from the last pack's
contexts, if one fits>"` in every `POST /context/step` (607 chars; per-prompt hook 1,425 bytes of 1,500).
Expectation written before the run: the khbench GUARD (accuracy may not drop; input tokens and cost may not
rise more than 10%).

## Tier 1 (dev with prod's hooks, before the candidate)

Equal on both sides: recall 0.619, coverage 0.655, hook bytes identical, permissions ok. So dev matches prod.

## Tier 2, core tasks, 3 runs per side (`reports/tier2-20261010-130157.html`)

| | accuracy / 6 | input tokens | cost | turns | KH calls |
|---|---|---|---|---|---|
| prod (baseline) | 4.90 | 1.29M | $1.15 | 40 | 30 |
| dev (candidate) | 4.70 | 1.72M | $1.50 | 54 | 42 |

Gate FAIL: input tokens +32.9%, cost +31.2%. Accuracy -0.2 is a tie (P2 inside the spread). Every task
cost more turns on dev; A2 went from 4 to 9-12 turns. The model needs a first pack to learn the context
tags before it can name one, so the rule adds steps instead of saving them. Decision: not adopted; dev's
rule restored to prod's. The key tier itself stays on prod (opt-in, no cost when unused).

## The run before it was void

`reports/tier2-20261010-123455.html` scored 1.50/6 on both sides: the bench account had lost its grant when
`ticketing-system` was renamed to `simplemdg-ticketing`, so every ticketing task scored 0. Fixed by granting
`kh-bench@kh-agent.invalid` editable on `simplemdg-ticketing` (its README level).

## Open for tasks.json (maintained on the C: machine)

Prompts still say "Project ticketing-system", and A2's must-have `lists ticketing-system` expects the old id
(A2 scores 0.5 on both sides for that reason). `RENAMES` in khbench.py changes only task metadata.

## Next idea, not built

Serve the key automatically instead of asking the model: `/turn/context` already knows the action menu and
could match the prompt's action and a context tag in code, adding no model turn.

## Correction: the dev side was handicapped in both runs above

The seed created bare projects on dev (no descriptor, aliases or keywords), so `/turn/context` on dev
matched no project for the 'Project ticketing-system' prompts, while prod matched `simplemdg-ticketing` by
alias. Part of the +33% may come from that; the verdict on the action/context rule is therefore not clean.
`seed_docker_dev.py` now copies the whole registry (9f12073); after it, all 6 core prompts match the same
project on both sides.

## Second candidate: distilled items near the prompt in the turn block (6520fca) - NOT adopted

`/turn/context` packed up to 3 of the matched project's distilled items above 0.68 (no model turn, no rule
change). Tier 2 core x3 on the corrected dev (`reports/tier2-20261010-141503.html`):

| | accuracy / 6 | input tokens | cost | turns |
|---|---|---|---|---|
| prod | 5.50 | 1.38M | $1.31 | 42 |
| dev | 4.90 | 1.35M | $1.21 | 40 |

Cheaper (-2.7% tokens, -8% cost) but FAIL on accuracy, all on P2 (0.4/0.4/0.6 vs 1.0/0.8/1.0): the items
packed for P2 scored 0.73-0.74 yet were off topic (a 'who asked you to push' lesson, the spec, the
propose-solution feature), and the answers dropped the deploy dispatch, Cloud Run and the post-deploy
check. With bge-small, unrelated items reach 0.70-0.74; at 0.75 only M3 still gets items (on topic).
The block is now OFF by default (`KH_TURN_DISTILLED_K=0`, floor 0.75 when enabled); nothing changed on prod.

## Still open

- Re-run the action/context rule on the corrected dev for a clean verdict.
- Update tasks.json (ticketing-system -> simplemdg-ticketing in prompts and A2's must-have).

## Clean re-run of the action/context rule (corrected dev, near block off)

`reports/tier2-20261010-144143.html`, core x3, one change only (the step-wise rule):

| | accuracy / 6 | input tokens | cost | turns |
|---|---|---|---|---|
| prod | 4.90 | 1.27M | $1.03 | 38 |
| dev | 4.90 | 1.43M | $1.03 | 40 |

FAIL on input tokens (+12.7%, limit +10%); accuracy and cost equal. So the earlier +33% was mostly the
missing registry, but the rule still buys nothing on these tasks. Not adopted; dev's rule restored to prod's.
Note the noise: prod P2 scored 0.4/0.4/0.4 here and 1.0/0.8/1.0 in the run before.

## Where this leaves item D

The key tier and the rekeyed lessons stay on prod (no cost when unused). Neither way of feeding keyed or
distilled items to the model beat the plain step-wise flow on the core tasks. The core set has no task a
distilled item answers better than the logs (procedures are in long logs the step already finds), so the
next measurement needs tasks written for distilled knowledge (the roadmap's 80% 'who / what / which one
fails' target) before any of this is turned on for users.
