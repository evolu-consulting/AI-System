> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `pipeline.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# Pipeline: states, stages, gates, recovery

One run = one spec pack applied to one target git repository. `line/pipeline.py` drives it; it is
the only module that moves the run state and emits run-level `escalated`.

## 1. Run states

```
admitted -> understanding -> planning -> building -> integrating -> qas -> green
     \            \              \           \            |  ^        |
      +------------+--------------+-----------+--> escalated  +-------+ (red F-item: fixer -> building)
```

| State | Terminal | Meaning |
|---|---|---|
| `admitted` | no | run row created, budget opened |
| `understanding` | no | ingest, readers, reconcile, (gaps/conflicts), (feature graph), acceptance tests |
| `planning` | no | unit graph, budget split |
| `building` | no | units leased, built, verified, queued for merge |
| `integrating` | no | merge queue drains |
| `qas` | no | deploy to QAS, QAS runner, fixer units |
| `green` | yes | success: every F-item green on QAS |
| `escalated` | yes | needs a human; carries `{code, message, detail}` |

Two non-terminal stops are **not** states but flags on the run:

- **parked** (`run.parked`): waiting for answers to human questions. Answering the last open
  question resumes it.
- **paused** (`run.paused`): the run lease was lost (e.g. clock jump past the TTL). `resume`
  continues it.

Allowed transitions: `contracts.RUN_TRANSITIONS`. Every change is a CAS on the store row plus a
`run.state {from, to}` event.

## 2. Unit states

```
pending -> ready -> leased -> submitted -> verified -> merged
                     |  \          |           |
                     |   waiting   +-> ready <-+   (retry / merge conflict / lease expiry)
                     +-> failed (ladder exhausted)
```

`pending` = dependencies not merged; `waiting` = builder ended `BLOCKED:<reason>`.

With `LINE_SEAL=1` every attempt is also a seal subject (`<run>:<unit>#<n>`):
`gated -> building -> pending -> sealed | rejected | awaiting_signoff -> sealed`, or `void` (the attempt
failed, was tainted or a sign-off was refused). A verified unit is enqueued for merge only once its seal is
final and its producers are merged; `pending` units may become ready early on producers that are verified
and pending a seal (speculative start, depth-limited). A refused seal sends the unit back to `ready`
(`SEAL_REJECTED`, retry ladder) and every unit built on it back to `ready` (`SEAL_TAINTED`). Details:
[seal-and-scan.md](seal-and-scan.md).
Table: `contracts.UNIT_TRANSITIONS`. Unit events are fenced by the unit lease epoch: a builder whose
lease was taken over can write nothing.

## 3. Stages in detail

| # | Stage | Module | Gate (code on failure) | Event on success |
|---|---|---|---|---|
| 1 | Ingest and freeze the spec pack: normalise text, split into spans `<path>#L<a>-<b>`, version = sha256 | `understand/ingest.py` | `SPEC_MISSING_FILE` | `spec.frozen` |
| 2 | Reader A (document order) and reader B (reverse order, sceptical) digest the spec independently; every claim needs a literal quote | `understand/readers.py` | claims without a literal quote are dropped (`QUOTE_UNMATCHED`) | |
| 3 | Reconcile A and B field by field (code only); re-read only diverged spans, at most `reread_max` rounds | `understand/reconcile.py` | `READ_DIVERGED` | `reconcile.diverged`, `digest.done` |
| 3a | *(LINE_UPLUS)* 7-slot gap checklist per F-item, assumption register, contradiction check against the system rule graph, one batched round of questions | `understand_plus/` | park or `NO_PROGRESS` after 3 re-freezes | `gaps.checked`, `conflicts.checked`, `human.question` |
| 3b | *(LINE_FGRAPH)* feature graph: nodes, produces/consumes edges with quotes, dependency order; anything consumed that nothing produces becomes a question | `fgraph/` | `FGRAPH_INVALID` | `fgraph.checked` |
| 4 | Acceptance tests per F-item, from the spec only (no code seen); trace tag per criterion; each test must be **red on an empty implementation**; locked by sha256 and committed on `main` | `understand/test_author.py`, `test_check.py` | `TEST_UNTRACED`, `TEST_GREEN_ON_EMPTY` | `tests.approved` |
| 5 | Planner splits the digest into units (<= `unit_max_files` files claimed, no cycles, contracts first, feature order when the graph is on) | `build/planner.py`, `graph.py` | `GRAPH_CYCLE`, `UNIT_TOO_BIG`, `FEATURE_ORDER` | `graph.valid` |
| 6 | Builders: one unit each, own git worktree `line/<run>/<unit>`, fenced lease with heartbeat, up to `max_parallel_units` in parallel | `build/builder.py`, `sandbox.py` | `BLOCKED`, `LLM_ERROR`, `BUDGET_EXCEEDED` | `unit.dispatched`, `unit.submitted` |
| 7 | Verifier: the server runs the unit's tests itself in a clean env and checks the diff | `build/verifier.py` | `NO_PROGRESS`, `TEST_TAMPER`, `CLAIM_VIOLATION`, `SECRET_FOUND`, `BUILD_FAIL`, `TEST_FAIL` | `unit.state -> verified` |
| 7a | *(LINE_DRIFT / LINE_REVIEW / LINE_JUDGE)* drift signals, clean-context review, judge | `review/` | `DRIFT_STOP`, `DRIFT_REDIRECT`, `REVIEW_BLOCK` | `drift.signal`, `review.done`, `judge.decision` |
| 8 | Merge queue: rebase on `main`, run every merged unit's acceptance tests plus this unit's, fast-forward `main` | `ship/merge_queue.py` | `MERGE_CONFLICT` (unit back to ready) | `unit.merged` |
| 9 | Deploy `main` to the idle QAS color (blue/green), smoke, switch pointer | `ship/deploy.py` | `SMOKE_FAIL` | `deploy.done` |
| 10 | QAS runner: every acceptance test `qas_repeats` times plus a regression pass over every other `unittest` in the tree | `ship/qas_runner.py` | `QAS_RED`, `FLAKY` (quarantined + reported) | `qas.result` |
| 11 | Red F-item -> fixer unit with the failure evidence, back to building, at most `fixer_generations` | `ship/fixer.py` | `QAS_RED` after the cap | `run.green` when all green |

An empty change is accepted only when the server's own run of the unit's tests is already green
(work merged earlier satisfied it): `already_satisfied`, nothing to merge.

## 4. Retry ladder (one per unit, shared by all failure kinds)

| Rung | Action |
|---|---|
| 0 | retry with the same model; the evidence of the failure goes into the next prompt |
| 1 | switch to `model_alt` |
| 2 | escalate: unit `failed`, escalation record |

A rung allows `retry_n` failures. The same failure fingerprint twice on a rung jumps to the next
rung at once; an escalation caused by repeats carries `NO_PROGRESS`. A lost lease is not a failure
(requeue only). When a unit fails, nothing new is dispatched; once nothing is in flight the run is
escalated with that unit's code.

## 5. Human questions (LINE_UPLUS or LINE_FGRAPH)

- A question is one decision with 2-4 options, a recommended option, the impact of each option and
  quoted evidence. All questions of a run go out as **one round**; at most `human_max_open` (3) are
  open at a time.
- Contradictions are never settled by the engine. Exception (switch off with
  `LINE_UPLUS_SPEC_SUPERSEDE=false`): the new spec explicitly replaces an old rule outside money,
  permission, deletion and external interfaces.
- `LINE_HUMAN_MODE=ask`: the run parks. `GET /api/runs/{id}/questions` lists them;
  `POST /api/runs/{id}/answers` answers. Reminders after `human_remind_workdays`; the engine
  **never picks a default**.
- `LINE_HUMAN_MODE=decide`: a strong model picks an option per question; each decision is written
  as a `human.decided` event and, when a RAG system with a worklog is connected, to the project
  worklog.
- When every question is answered, the answers become an **addendum** (`v1.1`, `v1.2` ...), the pack
  is re-frozen and digested again (at most 3 rounds per drive).

## 6. Budget

Budget tree: run (`LINE_MAX_USD_RUN`) -> F-items (equal split) -> units (weights S=1, M=2, L=4).
Every call reserves its estimate first; at 100 % of a node or an ancestor the call is refused with
`BUDGET_EXCEEDED` before it is made. `budget.warn` at 80 %. Spend is on the `llm_call` ledger and in
`GET /api/runs/{id}` (`budget`).

## 7. Resume, pause, cancel

- **Resume** (`python -m line.cli resume <run>`, the answers route, or server start with
  `LINE_AUTO_RESUME=1`): drive any non-final run from its persisted state. Reused, never redone:
  frozen pack, reconciled digest, locked tests on `main`, graph and units, budget split, merged
  units. Leased units with an expired lease go back to ready, submitted ones are verified again,
  verified ones are queued.
- **One driver per run**: run lease `run:<id>`, renewed every `heartbeat_s`. A crashed driver's lease
  runs out after `lease_ttl_s`; until then `resume` is refused (CLI exit 2).
- **Cancel** (`POST /api/runs/{id}:cancel`): loops stop at their next check, in-flight model
  subprocesses are killed, builder threads are joined (`cancel_join_s`), then the run escalates with
  `CANCELLED`. No event follows the terminal event.

## 8. Events

Every step writes an event into the store; seq is gapless from 1; the kind is from a closed list
(`codes.EVENT_KINDS`). Envelope: run, unit, attempt, epoch, agent_version, model, spec_hash.

| Group | Kinds |
|---|---|
| milestones | `run.admitted spec.frozen digest.done reconcile.diverged tests.approved graph.valid unit.dispatched unit.submitted verify.failed unit.merged deploy.done qas.result run.green escalated` |
| state | `run.state unit.state unit.blocked unit.requeued lease.expired budget.warn run.paused` |
| RAG link | `rag.degraded rag.restored rag.conflict` |
| understanding | `gaps.checked conflicts.checked human.question human.answered human.reminder human.decided spec.addendum run.parked run.unparked fgraph.checked` |
| review | `review.done drift.signal judge.decision decision.graded` |
| learning / agents | `lesson.proposed lesson.judged lesson.canary lesson.promoted lesson.withdrawn agent.registered agent.promoted agent.slo_breach agent.rollback agent.retired` |
| reconciler | `reconcile.repaired reconcile.frozen` |
| seal (LINE_SEAL) | `seal.gated seal.submitted seal.scored seal.sealed seal.tainted seal.voided seal.corrected` |

Run-end hooks write on the system run `_line`, so nothing of a run follows its terminal event.
Read events with `GET /api/runs/{id}/events?after_seq=N`.

## 9. Error codes

Domain (gate) codes: `SPEC_MISSING_FILE QUOTE_UNMATCHED READ_DIVERGED TEST_GREEN_ON_EMPTY
TEST_UNTRACED GRAPH_CYCLE UNIT_TOO_BIG CLAIM_VIOLATION TEST_TAMPER BUILD_FAIL TEST_FAIL NO_PROGRESS
BUDGET_EXCEEDED LEASE_LOST MERGE_CONFLICT SMOKE_FAIL QAS_RED FLAKY SECRET_FOUND RAG_DEGRADED
REVIEW_BLOCK DRIFT_STOP DRIFT_REDIRECT FGRAPH_INVALID FEATURE_ORDER`; seal (LINE_SEAL): `SEAL_REJECTED
SEAL_TAINTED SEAL_SIGNOFF`.

System codes: `ENVELOPE_INVALID UNKNOWN_KIND ILLEGAL_TRANSITION STATE_CONFLICT NOT_FOUND
VERSION_CONFLICT PRECONDITION_REQUIRED SCHEMA_INVALID LLM_ERROR CONFIG_INVALID BLOCKED CANCELLED`.

Source: `line/codes.py`.

## 10. Work layout on disk

Under `LINE_WORKROOT`: `<run>/_target` (fresh target when none was given), `<run>/<unit>` (unit
worktrees), `merge/<run>` (integration worktree), `<run>/_qas` (blue, green, `current` pointer),
`<run>/quarantine.json` (flaky tests).

## 11. Reconciler (LINE_RECONCILE)

Periodic thread in the server plus one pass before every resumed drive. Compares store rows, the
event projection, worktrees, branches, `main`, the QAS pointer, leases, budget and (if connected)
the RAG replica, and repairs drift (requeue stuck units, remove orphan worktrees/branches,
fast-forward `main`). A run it cannot repair safely is **frozen** (`reconcile.frozen`) and refused
until a human looks. `LINE_RECONCILE_DRY_RUN=1` only reports.
