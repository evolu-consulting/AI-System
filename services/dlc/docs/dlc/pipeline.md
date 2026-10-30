# Pipeline: states, stages, gates, recovery

One run = one spec pack applied to one target git repository. One run driver moves the run state and
emits run-level `escalated`.

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

| # | Stage | Gate (code on failure) | Event on success |
|---|---|---|---|
| 0 | *(Graphify installed)* code graph of the target's `main` (local AST scan, no model; index kept outside the repository); then the change sizer picks the run's lane (see 3.1) | never stops the run: no graph or no answer = agents read the code, lane `full` | run detail `code_graph`, `sizing` |
| 1 | Ingest and freeze the spec pack: normalise text, split into spans `<path>#L<a>-<b>`, version = sha256 | `SPEC_MISSING_FILE` | `spec.frozen` |
| 2 | Reader A (document order) and reader B (reverse order, sceptical) digest the spec independently; every claim needs a literal quote. Lanes `small` / `trivial`: reader A alone | claims without a literal quote are dropped (`QUOTE_UNMATCHED`) | |
| 3 | Reconcile A and B field by field (code only); re-read only diverged spans, at most `reread_max` rounds | `READ_DIVERGED` | `reconcile.diverged`, `digest.done` |
| 3a | *(LINE_UPLUS)* 7-slot gap checklist per F-item, assumption register, contradiction check against the system rule graph, one batched round of questions | park or `NO_PROGRESS` after 3 re-freezes | `gaps.checked`, `conflicts.checked`, `human.question` |
| 3b | *(LINE_FGRAPH)* feature graph: nodes, produces/consumes edges with quotes, dependency order; anything consumed that nothing produces becomes a question | `FGRAPH_INVALID` | `fgraph.checked` |
| 4 | Acceptance tests per F-item, from the spec only (no code seen); trace tag per criterion; each test must be **red on an empty implementation**, then runs on a **copy like the QAS one** (`git archive` of `main`, the packages of `package.json`, no `.git`): a test that breaks for the machine (a tool, converter or git it needs) rather than for the missing change gets one fix round by the test author as an agent in that copy (`LINE_TESTS_HERE`, on with a real model); locked by sha256 and committed on `main` | `TEST_UNTRACED`, `TEST_GREEN_ON_EMPTY`, `TEST_BROKEN_HERE` | `tests.approved` |
| 5 | Planner splits the digest into units (<= `unit_max_files` files claimed, no cycles, contracts first, feature order when the graph is on) | `GRAPH_CYCLE`, `UNIT_TOO_BIG`, `FEATURE_ORDER` | `graph.valid` |
| 6 | Builders: one unit each, own git worktree and branch, fenced lease with heartbeat, up to `max_parallel_units` in parallel | `BLOCKED`, `LLM_ERROR`, `BUDGET_EXCEEDED` | `unit.dispatched`, `unit.submitted` |
| 7 | Verifier: the server runs the unit's tests itself in a clean env and checks the diff | `NO_PROGRESS`, `TEST_TAMPER`, `CLAIM_VIOLATION`, `SECRET_FOUND`, `BUILD_FAIL`, `TEST_FAIL` | `unit.state -> verified` |
| 7a | *(LINE_DRIFT / LINE_REVIEW / LINE_JUDGE)* drift signals, clean-context review, judge | `DRIFT_STOP`, `DRIFT_REDIRECT`, `REVIEW_BLOCK` | `drift.signal`, `review.done`, `judge.decision` |
| 8 | Merge queue: rebase on `main`, run every merged unit's acceptance tests plus this unit's, fast-forward `main` | `MERGE_CONFLICT` (unit back to ready) | `unit.merged` |
| 9 | Deploy `main` to the idle QAS color (blue/green), smoke, switch pointer | `SMOKE_FAIL` | `deploy.done` |
| 10 | QAS runner: every acceptance test `qas_repeats` times plus a regression pass over every other test in the tree | `QAS_RED`, `FLAKY` (quarantined + reported) | `qas.result` |
| 11 | Red F-item -> fixer unit with the failure evidence, back to building, at most `fixer_generations` | `QAS_RED` after the cap | `run.green` when all green |

An empty change is accepted only when the server's own run of the unit's tests is already green
(work merged earlier satisfied it): `already_satisfied`, nothing to merge.

### 3.1 Lanes: how much reading a change needs

Current design: the sizer gives every run a level 1-4 from two sizes (requirement, app); levels 1-2 take the
`solo` lane (one agent, the same gates and QAS), levels 3-4 the lead (`LINE_SOLO_LEAD=1`) or the team lanes below.
See [learning.md](learning.md) 2. The team lanes:

A restyle or a one-line fix does not need the analysis a new system needs. Before the spec analyst, a small
agent (`change_sizer`, cheap model, read-only: the repository, the code graph and the project's lessons,
findings and worklog) sizes the request and picks a lane:

| Lane | Spec analyst | Readers | Feature graph | Acceptance tests, planner, verifier, merge queue, QAS |
|---|---|---|---|---|
| `full` | yes | A + B | when `LINE_FGRAPH=1` | always |
| `small` | yes | A only | only with more than 3 F-items | always |
| `trivial` | only when the spec links a ticket or page | A only | only with more than 3 F-items | always |

The independent checks never depend on the lane. The engine decides around the agent: New System runs, a
repository with no delivered code, `LINE_LANES=0` or a doubtful answer (none, unparseable, risk high, more files
than `LINE_UNIT_MAX_FILES`) mean `full`; a lane given when the run is started (`POST /api/runs` field `lane`)
wins without a model call. The run detail `sizing` holds the lane, who chose it and why.

Two more savings apply to every lane: the reading roles (readers, re-read, feature graph, planner, spec
analyst, sizer) run on cheaper models than the roles that write tests and code (`LINE_ROLE_MODELS`), and an
identical reading prompt (a retried or resumed run of the same pack) is answered from the store instead of
being paid again (`LINE_LLM_CACHE`, entries kept `LINE_LLM_CACHE_DAYS`).

### 3.2 Agent shell commands

One shell command of an agent may run at most `LINE_AGENT_CMD_TIMEOUT_S` (default 300 s). Commands that never
exit (dev servers, watchers: `npm run dev`, `vite`, `nodemon`, `cds watch`, `--watch` ...) are refused in the
foreground and allowed in the background; every process an agent call started is ended with the call.

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

A builder that ends `BLOCKED` never moves to `model_alt` (a pricier model reads the same obstacle). When its
reason says a locked acceptance test is wrong or the machine stops it (a tool missing or failing), the unit
escalates at the first `BLOCKED` with `BLOCKED_OUTSIDE_CLAIMS` and `blocked_kind` `test` or `host`; when the
fix lies in another unit's files it gets one more attempt (that work may land meanwhile) and escalates on the
second. Node apps of a unit's worktree get their `node_modules` installed by the engine before the builder starts.

### 4.1 When a person is needed

The run page shows what to do, in plain words (`GET /api/runs/{id}/attention`): what happened, why, where (step
and unit) and the agent's own reason. The project's **Needs attention** badge opens it.

| Situation | Actions | The badge goes when |
|---|---|---|
| a run hook holds the run | ask the hook again, or pass it | the run goes on |
| stopped | resume | the run goes on |
| waiting for answers | answer the questions in the panel (an option, or your own words) | the last answer is sent |
| failed | **Explain in plain words** (one cheap model call); **Run again** with an optional hint added to the request (`POST /api/runs/{id}:retry`); **Mark resolved** with a note (`POST /api/runs/{id}:resolve`, the note becomes a finding for later runs) | resolved, or a new run of the project starts |

**Supervisor first** (`LINE_SUPERVISOR`, on with a real model). When a run fails, a supervising agent decides before
anyone is asked: small technical decisions (the readers disagree, a locked test is wrong, the same failure came back,
the app did not start on QAS, a merge conflict) are settled by running the request again with its hint, at most
`LINE_SUPERVISE_MAX_RETRIES` (2) times and `LINE_SUPERVISE_MAX_USD` ($3) per request. A person decides production,
delivery, credentials or secrets, money beyond the budget, data deletion, scope changes, an admin's approval or stop
gate, a revoked token, a problem of the machine itself, and anything the supervisor could not settle. Each decision
is kept on the run and shown on its panel ("Supervisor ran it again" with the hint given, or "left it to you" with the
reason). When a locked acceptance test of an **earlier** run fails because this request deliberately changes what it
asserted (a restyle that kept a bug, then the bug fix), the supervisor may retire that test before the new run: it is
skipped with the reason in one commit on `main` (`line supervisor: retire <test> ...`), listed on the panel, and can
be reverted. A run's own tests are never retired. A supervised retry **keeps the failed run's own locked tests** (restored from its tests commit) F-item by F-item; only the F-items the supervisor names (`rewrite_tests`) are written again, with the old file and the hint shown to the test author. A retry a person starts writes every test again. While it is on, open questions are answered by the model and logged (`human_mode decide`) unless a run
asks for `ask`.

**Run board and agent messages.** Every step leaves one card with its latest status in the run's knowledge
project (entity `run <id> step <step>`, replaced on each update; the card `run <id>` links them and the run it
retries): what the request was understood as, the locked tests and the files they use, the plan's units and claims,
what failed and why. Every agent call of the run (except the two independent readers) ends its prompt with that
board and the board of the attempt it retries, so the next steps continue from what was settled instead of redoing
it. The files a unit's locked tests name join that unit's claims. Agents talk only through the project's message
stack, never person to person: one message to `all` of the project, tagged with the roles it is for (`@planner
@builder ...`), `kind`, and `task_id` = the run. The engine is their only reader and gives each role the messages
tagged for it once; a person can write to a run's agents the same way. The run page shows the board and the
messages (`GET /api/runs/{id}/board`).

The node pages and the live activity list read as sentences; each entry keeps the engine's own record under
*Technical details*.

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

- **Resume** (`dlc resume <run>`, the answers route, or server start with
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
REVIEW_BLOCK DRIFT_STOP DRIFT_REDIRECT FGRAPH_INVALID FEATURE_ORDER TEST_BROKEN_HERE`; seal (LINE_SEAL): `SEAL_REJECTED
SEAL_TAINTED SEAL_SIGNOFF`.

System codes: `ENVELOPE_INVALID UNKNOWN_KIND ILLEGAL_TRANSITION STATE_CONFLICT NOT_FOUND
VERSION_CONFLICT PRECONDITION_REQUIRED SCHEMA_INVALID LLM_ERROR CONFIG_INVALID BLOCKED CANCELLED`.


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
