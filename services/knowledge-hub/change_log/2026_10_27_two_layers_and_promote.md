# Two layers of rules: a personal tier that wins, and a nightly promote job (2026-10-27)

## Why

Kernel rule (10) (set 2026-10-27) splits the agents' rules into two layers: the common layer (kernel and the
'every project' policy tier, maintainers only) and each person's personal layer, which wins on any overlap. A
member's feedback ("from now on...") goes to their personal layer, or, about one project, to that project's
knowledge. Three gaps kept that from working:

1. The policy table had no personal tier: `/policy/plan` read the project, then 'every project'.
2. `/personalization/render` loaded the top 40 rows by similarity to a fixed seed, so a person with more rows
   lost some of their own rules silently, and its header did not say the personal layer wins.
3. Nothing ever read the personal layer to lift a rule many people share into the common layer.

## How

- `app/policy_actions/store._scope`: reads the caller's personal project first, then the project, then 'every
  project'; the first row for an (action, sub_action) wins. A person writes their own step with
  `POST /policy/rule/set {"project": "<their personal project>"}` (auth already lets only them write it); another
  person never reads it. Signed out, nothing changes.
- `/personalization/render`: every active row of the caller's own store, oldest first. Over 16,000 characters,
  the rows are ranked by the seed and cut there. A request with `seed=` keeps the old top-k behaviour. The header
  says this is the personal layer and wins, except kernel rule (0), a 403 and never typing a secret.
- `app/promote.py` (off unless `KH_PROMOTE=on`), maintainers and the worker only:
  - `GET /promote/next`: every person's personalization rows and every project's `kind: feedback` knowledge rows,
    with the owner as an alias (`person-<sha256[:8]>` / `project:<id>`), the common tier with its step text, the
    kernel text and the proposals already made.
  - `POST /promote/submit`: a proposal targets one step of a common action, cites rows of at least
    `KH_PROMOTE_MIN_PEOPLE` (default 2) distinct owners, passes the distil leak gate, and is stored as a proposed
    `policy_proposal` with `tier: common` in the orchestrator's distilled items (merged with a near-identical
    one). `dry_run` writes nothing.
  - `/distill/approve` on such an item writes the 'every project' tier, keeping the step's seq. The worker never
    approves one. The kernel is never changed by a proposal.
- kh-worker job `promote` (`KH_WORKER_JOBS=distil,promote`, `KH_WORKER_PROMOTE_AT`, default 02:00): one
  `/promote/next`, one model call (prompt `prompts/promote.md`), one submit, one repair of refused items;
  dry mode forces `dry_run`. It runs once a night for the placeholder project `common`.

## Learn back on prod runs it (second deploy, same day)

Prod had learn back off: `KH_LEARNBACK_LLM` was never set, there is no Claude CLI on CF, and push.ps1 did not
stage `worker/kh_worker`. Now:

- `kh_worker/llm.py` `AnthropicLLM` also takes `CLAUDE_CODE_OAUTH_TOKEN` (a `claude setup-token`) when there is
  no `ANTHROPIC_API_KEY`: Bearer `auth_token` with the `oauth-2025-04-20` beta, and the system prompt opens with
  Claude Code's identity line (`OAUTH_IDENTITY`); without it the API answers 429 `rate_limit_error` "Error"
  (checked live 2026-10-27).
- `deploy/btp/push.ps1` stages `worker/kh_worker` and adds the `anthropic` pin of `worker/requirements.txt`.
- `app/learnback.py`: a run or schedule whose projects include `common` runs the promote job after the distil
  of the real projects; the model calls KH in-process (`promote.serve_next` / `promote.submit`).

## Rollout

1. Deploy KH with `KH_PROMOTE=on`, `KH_LEARNBACK_LLM=anthropic` and `CLAUDE_CODE_OAUTH_TOKEN` (cf set-env).
2. On /home > Lesson learn (or `POST /home/learnback/schedules`), a daily 02:00 schedule with the distil
   projects plus `common`. A sidecar host would instead set `KH_WORKER_JOBS=distil,promote`.
3. Review on `/distill/pending?project=orchestrator`; approve or reject with `/distill/approve|reject`.

## Tests

`tests/test_promote.py` (29 checks), `tests/test_policy_actions.py` (personal tier), `tests/test_personal.py`
(render loads every row), `worker/tests/test_promote_job.py` (7).
