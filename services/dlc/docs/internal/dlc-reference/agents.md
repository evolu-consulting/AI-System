> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `agents.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# Agents (AI roles)

Every AI step is a call through the model port (`line/llm/`): either `complete()` (one answer,
strict JSON, no tools) or `agentic()` (a tool-using session confined to one git worktree). Code
checks every answer; no role can mark its own work as done.

## 1. Role table

| Role | Kind | When | Input | Output (checked by code) | Prompt file | Default model |
|---|---|---|---|---|---|---|
| `reader_a` | complete | understanding | spec spans, document order | digest JSON: F-items, criteria, rules, numbers, each with `span_id` + literal quote | `reader_a.md` | `LINE_MODEL` |
| `reader_b` | complete | understanding | spec spans, reverse order, sceptical prompt; never sees A | same schema | `reader_b.md` | `LINE_MODEL` (alt model when the agent directory is on) |
| `reader_reread` | complete | readers disagree | only the diverged spans + the questions | same schema | `reader_reread.md` | `LINE_MODEL` |
| `gaps` | complete | `LINE_UPLUS` | F-item + 7 slots (input, output, errors, limits/empty, units/time/rounding, permissions, persistence) | per slot: covered (with quote) or gap (assumption, category, alternatives) | `gaps.md` | `LINE_MODEL` |
| `conflicts` | complete | `LINE_UPLUS` | digest rules + system rule graph | claims, then a verdict per candidate pair | `conflicts.md` | `LINE_MODEL` |
| `human_decider` | complete | `LINE_HUMAN_MODE=decide` | one question + retrieved context | chosen option + reason | inline in `understand_plus/human.py` | `LINE_HUMAN_DECIDE_MODEL`, else `LINE_JUDGE_MODEL` |
| `fgraph` | complete | `LINE_FGRAPH` | frozen pack + reconciled F-items | nodes, produces/consumes edges with quotes | `fgraph.md` | `LINE_MODEL` |
| `test_author` | complete | understanding | one F-item, its criteria and span text; **never code** | one test file under `tests/acceptance/` with a trace tag per criterion (Python: a `unittest` module; Node: a jest/vitest/mocha file, see [stacks.md](stacks.md)) | `test_author.md` | `LINE_MODEL` |
| `planner` | complete | planning | repo map, F-items, acceptance tests, feature order | units `{id, title, f_items, claims, deps, tests, size, contract}` | `planner.md` | `LINE_MODEL` |
| `builder` | **agentic** | building | unit contract, claims, locked test names, test command, spec text, evidence of the last failure, retrieved context | code changes in its worktree; last line `SUBMIT` or `BLOCKED:<reason>` | `builder.md` | `LINE_MODEL`, `LINE_MODEL_ALT` on ladder rung 1 |
| `fixer` | **agentic** | QAS red | as builder + QAS failure evidence (+ judge evidence) | as builder | `builder.md` | as builder |
| `reviewer` | complete | `LINE_REVIEW` (or drift) | ONLY spec spans, unit contract, diff, server test result | findings with severity + literal spec quote | `reviewer.md` | `LINE_REVIEW_MODEL`, else a model other than the builder's |
| `judge` | complete | `LINE_JUDGE` | frozen spec spans, code-built case, history of graded decisions | continue / redirect / reset / stop, or builder / fix / stop | `judge.md` | `LINE_JUDGE_MODEL` |
| `distiller` | complete | `LINE_LEARN`, run end | failure groups of the run | candidate lessons citing event ids | `distiller.md` | `LINE_LEARN_DISTILLER_MODEL`, else `LINE_MODEL_ALT` |
| `eval_judge` | complete | `LINE_LEARN` | lesson + holdout / eval cases | help / neutral / harm per case | `eval_judge.md` | `LINE_LEARN_JUDGE_MODEL`, else `LINE_MODEL`; never the distiller's |

Prompts live in `line/llm/prompts/<role>.md` (`{name}` placeholders filled by the caller). They
hold no secrets, hostnames or product names. Retrieved RAG context is inserted by the caller at
call time, never stored in the prompt file.

## 2. Guards (enforced in code, not in prompts)

| Guard | Where |
|---|---|
| Quote check: a claim survives only if its quote is a literal substring of the named span | readers, gaps, conflicts, fgraph, reviewer, judge |
| JSON schema + one repair retry, then `SCHEMA_INVALID` | every `complete()` |
| Builder tools limited per target stack: Python `Read Edit Write Bash(python -m unittest*)`; Node `Read Edit Write Bash(npm test*) Bash(npm run test*) Bash(npx jest*) Bash(npx vitest*) Bash(npx mocha*) Bash(npx cds*) Bash(node *)` ([stacks.md](stacks.md)); scrubbed environment (no credentials); cwd = own worktree; `--max-turns`, `--max-budget-usd` | `llm/cli.py`, `line/stacks/` |
| Verifier re-runs tests itself; rejects tampered locked tests, files outside claims, secrets, non-compiling code, empty or repeated diffs | `build/verifier.py` |
| Lease fencing: a builder whose lease was taken over cannot write state | `statemachine.py`, `store.py` |
| Judge answers that would touch tests, loosen a guard or touch credentials are rejected (-> stop) | `review/judge.py` |
| Lessons that name a guard, gate code or threshold, or tell an agent to touch tests, are dropped | `learn/distiller.py` |
| Reviewer never sees the builder's conversation | `review/reviewer.py` |

## 3. Cost control

- `LINE_MAX_USD_CALL` and `LINE_MAX_USD_RUN` are checked **before** every call (estimate from
  `pricing.json`); refused calls raise `BUDGET_EXCEEDED`.
- Budget tree run -> F-item -> unit (S=1, M=2, L=4). See [pipeline.md](pipeline.md#6-budget).
- Every call lands on the `llm_call` ledger: role, key, model, tokens, USD.
- Observed real costs on the sample pack (4 units): 1.6-2.0 USD per green run.

## 4. Agent directory (LINE_AGENTS)

Optional versioning of the roles above (default roles: `reader_a reader_b reader_reread test_author
planner builder fixer distiller eval_judge`). A version = role + model + prompt version + tools +
status:

- `shadow` runs beside the active version, output compared, never used;
- `canary` gets `LINE_AGENTS_CANARY_RATIO` of the units;
- `active` is the incumbent; runs are pinned to the version they started with;
- promotion and rollback are automatic from SLOs (`LINE_SLO_*`: success rate, escalation rate,
  USD per unit, p95 latency).

## 5. Learning loop (LINE_LEARN)

At run end the distiller turns the run's failures into candidate lessons keyed by
(role, step, stack). The eval judge grades them offline (holdout from other runs, optional eval
set `LINE_LEARN_EVAL_PATH`). Approved lessons go to canary arms per unit; promotion or withdrawal
is decided by first-pass yield statistics. Active lessons are served into prompts instead of plain
retrieval. When a RAG system with the `records` capability is connected, published lessons are
stored there as record type `lesson`.

Known limit: without an eval set or holdout cases, the gate rejects every lesson except on a cold
start.

## 6. Models

Model ids are plain strings passed to the provider. Defaults: `LINE_MODEL=claude-opus-5-5`,
`LINE_MODEL_ALT=claude-fable-5-1`, `LINE_JUDGE_MODEL=claude-opus-5-5`. Any model the configured
CLI or API accepts can be used. `LINE_LLM=api` serves non-agentic roles only; builder and fixer
need `cli`.
