# 2026-10-04 - Lazy policy loading, a hard action rule, and policy-authoring guards

## Why

Hook text grew by appending. On KH BTP prod the session-start text reached 11,058 chars, past Claude
Code's 10,000-char hook limit: Claude Code then saves the output to a file and shows the model a
~2 KB preview, so the kernel never reached the model (KH AUTO "did not exist"). On the local KH the
personalization render was 42.6 KB and the per-prompt guard 12.3 KB. Every task rule was loaded into
every session whether the task came up or not.

## What changed

### Hooks and policy data (no code; applied to local 9000, dev kh-sso, prod knowledge-hub)

| Where | Change |
|---|---|
| SessionStart kernel | Config only: how to call KH, project resolution, a HARD action-detection rule, language, address, store model, work mode (DEFAULT / KH AUTO). Prod 8,411 -> 3,951 chars. |
| Hard action rule | Split each message into intents; every intent gets a label; never 'none' ('talk with user' for greetings, thanks, small talk and unclear messages); load a plan once per conversation with `/policy/plan` and reuse it; a policy says HOW to work, never WHAT is true about a project. |
| Policy table, prod/dev | 8 every-project actions moved out of the kernel: talk with user, read worklog, store worklog, search knowledge, save knowledge, troubleshoot problem, send message, manage project members. Deleted 6 `zz-e2e-action-*` test rows that every user saw in the menu. Hooks `kh-access-model` and `read-log` removed (now actions). |
| Policy table, local | 20 actions added, incl. fen-only ones (artifact, git, deploy, QC fix flow, Buzz/Teams voice, browser, dump data, background jobs, research). Personalization 44 -> 3 rows. Per-prompt guard 12,284 -> 315 chars; Stop 6,010 -> 352 (points to `store worklog`). Local has no `/turn/context`, so its menu is static in the kernel. |
| All three | Action `create or update policy` (8 steps): classify (config / action / project fact / finding), update the existing row instead of appending, scope, format, ground in what worked, budgets, test 3 positive + 2 negative prompts, record. |

### Code (`app/policy_actions/lint.py`, new; not yet deployed)

| Where | Change |
|---|---|
| `app/config.py` | `POLICY_DESC_MAX` 400, `POLICY_RULE_MAX` 1,200, `POLICY_PLAN_MAX` 6,000, `POLICY_OVERLAP` 0.6, `POLICY_UNUSED_DAYS` 30, `HOOK_MAX` per hook type (SessionStart 9,000, UserPromptSubmit 1,500, PreToolUse 2,000, Stop 1,500), `MENU_PLACEHOLDER` `{menu}`. |
| `POST /policy/action/set`, `/policy/rule/set`, `/hooks/set` | 422 `POLICY-LINT` over budget unless `allow_oversize` + `reason`; a legacy row already over budget may be edited if the edit does not grow it; overlapping when-lines return warnings. |
| `GET /policy/plan` | Counts fetches in the new table `policy_usage`. |
| `GET /policy/lint` (maintainer) | Oversize descriptions, rules, plans and hook types; overlapping actions; actions nobody fetched for 30 days. |
| `GET /hooks/raw`, `/hooks/get` | `{menu}` in a rule renders the every-project action menu, so adding an action no longer needs a hand edit of the hook. |
| `tests/test_policy_lint.py` (new) | Budgets, override, legacy edits, overlap, fetch counter, `{menu}`, hook budget, report. All pass; `test_policy_actions` 55/55 and `test_auth` still pass. |

## Measured

Long-session bench (new `kh_bench/scripts/longbench.py`): one 10-turn conversation, 6 graded turns
(max 6), real KH data, 2 runs per set-up; old set-ups replayed from the rollout backups
(`kh_bench/scripts/oldhooks.py`).

| mean of 2 runs | cost USD | input tokens | score / 6 |
|---|---|---|---|
| local old -> new | 0.896 -> 0.715 (-20%) | 2.23M -> 1.83M (-18%) | 4.42 -> 4.70 |
| prod old -> new | 0.857 -> 0.835 (-3%) | 1.74M -> 1.88M (+8%) | 4.70 -> 5.50 |

On the single-question bench (compare3) the design shows no gain: one extra policy fetch per question
(prod X2 65k -> 138k tokens) against per-turn hook savings that need several turns to pay off. Two runs
of one set-up differ by up to 0.35 USD and 1 point; the no-KH baseline moved 0.6 with nothing changed.

Simulated trial before the rollout (fresh profile, mock KH from a JSON file, 22 actions incl. 6 real
plans): routing 52/52 on 26 cases from fen's worklogs; single-turn cost -74%; a 10-turn session -35%
once the per-prompt line says "reuse a plan already fetched".

## Found and fixed while measuring

- Local `search knowledge` sent the model to `/orchestrator/resolve` + `/hybrid`; both answered empty
  for "Hugh Le" and the model concluded KH had nothing. Now: query each project directly, knowledge AND
  log; an empty shortcut is not evidence of absence.
- The model answered "how do I deploy ticketing" from the generic `deploy` policy instead of the
  project's own records. The kernel now says a policy is HOW, never WHAT; `deploy`, `git operation`
  and `fix qc ticket` start with "read the project's records first".
- `claude -p --resume`: `total_cost_usd` and `modelUsage` are cumulative over the session; per-turn
  values are differences.

## Open

- Deploy the lint code to dev, then prod (blocked on a cf passcode); rebuild the local exe for it.
- Server text of `/turn/context` still says "pick a label or none"; the kernel overrides it.
- Local `W1` and `X2` remain the weakest graded turns; prod `R1` scores 0-0.2 in every set-up.

Reports: `2026-10-04-lazy-policy-trial.html` (this folder).
