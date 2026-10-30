# 2026-10-02 - Turn context: the pre-work reads in one call made by the hook (roadmap item B)

## What a user gets from updating to kh-helper 1.9.0

- **Answers start sooner and cost less.** The assistant no longer spends its first turns looking up
  the project, the rules, the findings and the people you named: the helper hands them over before
  the assistant reads your message. 26% fewer turns, 13% fewer input tokens, 25% less time.
- **Simple questions get much cheaper.** "Who is X" went from 79k to 26k tokens, with no KH lookup.
- **Nothing is lost.** Accuracy held (4.90 -> 5.40 of 6, inside the spread), the sign-in is kept,
  and an older helper keeps working without the speed-up.
- **Updating takes a minute:** ask your assistant to "update the Knowledge Hub helper" (it follows
  `/auth/help`, section "ALREADY CONNECTED? UPDATE ONLY"), then close and reopen the app.

## Why

The tier 2 bench baseline of 2026-10-02 (36 real `claude -p` runs, dev = prod) showed the cost of a
question sits in model turns, about 10-15k input tokens each, not in the hook text (2-3k tokens on a
79k floor). Before any work the model made 2-4 KH calls of its own - project_match, policy/actions,
findings/list, entities/match - one turn each, every prompt.

## What changed

| Where | Change |
|---|---|
| `app/turn.py` (new) | `GET /turn/context?text=` returns project, action menu (first sentence of each description), findings, entity cards, lessons from project `knowledge` above a floor, and a rendered block that says not to repeat those calls. Filtered by what the caller may read; a failing part is left out. |
| `app/config.py` | `TURN_*` bounds, env `KH_TURN_*`. |
| `app/auth_rules.json` | `GET /turn/context` - authenticated. |
| `main.py` | attaches `app.turn`. |
| `tools/kh-helper` 1.9.0 | `UserPromptSubmit` reads the prompt from the hook's stdin, calls `/turn/context` and appends the block; adds nothing on a missing prompt, an error or a KH without the route. |
| hook rule `prompt-guard` (dev only, `/hooks/set`) | Use the block, do not repeat its calls; the old calls stay as the fallback when no block is there. |
| `docs/turn-context.md` (new) | The route, its bounds, access and failure behaviour. |

## Measured on dev kh-sso against prod (tier 2 core, 6 tasks x 3 runs per side)

| | prod (baseline) | dev (B) | change |
|---|---|---|---|
| accuracy (of 6) | 4.90 | 5.40 | +0.5, inside the spread |
| input tokens | 751,112 | 652,196 | -13.2% |
| turns | 35 | 26 | -26% |
| KH calls | 27 | 18 | -33% |
| pre-work calls (project_match, policy/actions, findings/list, entities/match) | 30 | 5 | -83% |
| cost | $0.450 | $0.386 | -14% |
| wall time | 379 s | 286 s | -25% |

Reports in this folder: [2026-10-02-turn-context-bench.html](2026-10-02-turn-context-bench.html) (B, PASS) and
[2026-10-02-bench-baseline.html](2026-10-02-bench-baseline.html) (baseline, dev = prod). Raw runs stay with the bench tool,
`C:/Programs/ClaudeKH/tools/kh_bench/results/tier2-20261002-133304.json`. W1 ("who is Vincent Cao") is answered from the block alone:
0 KH calls, 26k input tokens instead of 79k.

## Caveats

- Dev keeps its own policy table, which holds only leftover e2e actions, so dev never called
  `/policy/plan`; prod did 3 times. The action part of the saving is not proven until both sides
  have the same policy.
- The lesson floor 0.6 lets weak hits in (a Workbeats how-to at 0.70 for a ship-a-fix question).
- 5 pre-work calls remain on dev (2 project_match, 3 entities/match): the model sometimes checks again.

## Rollout

- 2026-10-02 07:35Z deployed to prod `knowledge-hub`; prod serves `kh_helper-1.9.0`; prod e2e 73/73.
- Prod hook rule `prompt-guard` (id 4) set to the B text; the old six rules are kept in the bench folder (`results/prod_hooks_before_B.json`).
- Update notice posted to every project's message stack (12 projects, receiver all; not orchestrator, not personal projects). A member of several projects gets one copy per project.

## Checks

- New `tests/test_turn_context.py` 27 checks, ALL PASS.
- Whole suite before and after: the same 23 files pass, plus the new one.
