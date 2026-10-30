# SDLC autonomous line

A spec pack goes in; verified code on a dev QAS slot comes out, or a clean escalation.
Dev only: nothing here deploys anywhere but a local QAS directory.

Stages (`pipeline.py` drives them; the run state moves admitted -> understanding -> planning ->
building -> integrating -> qas -> green | escalated):

1. ingest and freeze the spec pack (`spec.frozen`)
2. two independent readers digest it; quotes are checked against spans; the digests are
   reconciled; diverged fields get a targeted re-read (`reconcile.diverged`, `digest.done`)
3. acceptance tests are authored from the spec only, must be red on an empty implementation and
   traced to a span; they are locked and committed on main (`tests.approved`)
4. the planner builds a unit graph (<= 8 files per unit, no cycles, contracts first) (`graph.valid`)
5. builders work one unit each in their own git worktree under a fenced lease, in parallel;
   the verifier runs the tests itself and checks claims, locked tests and secrets (an empty change
   passes only when the server's run of the unit's tests is already green, e.g. work merged earlier
   satisfies them: `already_satisfied`, nothing to merge); a failure
   climbs the retry ladder (retry with evidence -> alternate model -> escalate)
6. the merge queue rebases each verified unit onto main, runs the acceptance tests, fast-forwards
7. deploy main to the idle QAS color (blue/green), smoke, switch; the QAS runner runs every
   acceptance test 3 times: flaky tests are quarantined and reported, a red F-item spawns a
   fixer unit (at most 2 generations) and the run goes back to building

Every step writes events (`codes.EVENT_KINDS`); the board is a projection of the store.
An optional RAG System supplies records, retrieval and metrics and receives the event log;
when it is down the line degrades per capability and replays its outbox later.

## Run it

All commands from `Slaves\SDLC` (Python 3.10, standard library only).

Unit tests (includes fast dry end-to-end runs):

```
python -m unittest discover -s line/tests -t .
```

Dry end-to-end on `samples/todo-pack` with the fake model (no cost, ~10 s per variant):

```
python -m line.e2e.run_line_e2e                      # base flaky qas_red rag_outage all_on conflict_park
python -m line.e2e.run_line_e2e base -v              # one variant, with stage log
python -m line.chaos                                 # 9 fault scenarios + invariants (python -m line.chaos --all-on)
```

Each variant uses a fresh work root under `LINE_WORKROOT` (default: system temp), its own
database and a fresh target git repository. Checks: gapless event seq, zero spend, every test
traced to a span, board green, the live QAS directory passes `python -m unittest` on its own.
`base` also checks the plan's milestones (reader B diverges on the F2 exit code and agrees after
the re-read; U3 attempt 1 fails verify with TEST_FAIL, attempt 2 passes; U2/U3 in parallel; four
merges; QAS 3/3 green). Variants: `LINE_DRY_FLAKY=1` (quarantine report), `LINE_DRY_QAS_RED=F3`
(fixer unit, then green), RAG outage mid-run (`rag.degraded`, still green, outbox drains after
the remote is back). The two `LINE_DRY_*` switches only act with `LINE_LLM=fake`. Every variant also
checks that merged units left no worktree behind.

`all_on` turns every wave 4 flag on (below) and checks: one sensitive gap -> one question, answered by
the dry person (`LINE_DRY_HUMAN=auto`, `dry/human/answers.json`) -> addendum v1.1 re-freezes the pack and
the spec is digested again; the reviewer blocks U2 attempt 1, the judge rules "fix", attempt 2 passes and
the decision is graded right on QAS; drift notes; lessons distilled and judged at run end;
`GET /api/metrics` serves the run. `conflict_park` plants a contradiction in a copy of the spec: the run
parks (non-terminal, nothing escalated), the open questions are answered through
`POST /api/runs/{id}/answers` on a live server, which resumes the run to green.

One run from the command line:

```
set LINE_LLM=fake
python -m line.cli run line/samples/todo-pack            # fresh target repo under LINE_WORKROOT
python -m line.cli run <pack> --target C:\path\to\repo   # repo with branch main checked out, clean
python -m line.cli status [run]
python -m line.cli board [run]                           # board JSON
```

`run` exits 0 when the run is green, 1 when it escalated.

## Wave 4 features (all off by default)

| flag (env) | module | what it does | where it hooks |
|---|---|---|---|
| `reconcile` (`LINE_RECONCILE`, `LINE_RECONCILE_S`, `LINE_RECONCILE_DRY_RUN`) | `reconciler.py` | compares store rows, events, worktrees, branches, QAS pointer, leases, budget and the RAG System and repairs drift; freezes a run it must not guess about (`reconcile.repaired`, `reconcile.frozen`) | periodic thread in `server.py`; one pass before a resumed drive; a frozen run is refused |
| `rag_leases` (`LINE_RAG_LEASES`) | `rag_state.py` | runs admitted with RAG lease authority take their leases from the RAG System (mirrored locally, local clock expiry) | `Pipeline._setup` |
| `rag_records` (`LINE_RAG_RECORDS`) | `rag_state.py` | run / unit / digest / test / graph rows mirrored as RAG records with If-Match (`rag.conflict`) | `Pipeline.admit`, `_setup` |
| `uplus_enabled` (`LINE_UPLUS`, `LINE_UPLUS_*`, `LINE_HUMAN_*`, `LINE_DRY_HUMAN`) | `understand_plus/` | 7-slot gap checklist + assumption register, contradiction graph, ONE batched round of human questions; open questions park the run (`run.parked`, not terminal); answers become addendum vN.k, the pack is re-frozen and digested again (<= 3 rounds); reminders, never a default; the run's rules join the system rule graph when green | after the digest; watchdog tick; before `run.green`; routes below |
| `review_enabled` / `drift_enabled` / `judge_enabled` (`LINE_REVIEW*`, `LINE_DRIFT*`, `LINE_JUDGE*`, `LINE_DECISION_LOG`) | `review/` | clean-context reviewer (block -> back on the ladder, `REVIEW_BLOCK`); drift signals + ladder note -> nudge -> reviewer -> judge -> stop (`DRIFT_STOP`, `DRIFT_REDIRECT`); strong-model judge against the frozen spec with a decision log graded by later QAS outcomes; a wrong ruling's evidence goes to the fixer's prompt | after verify (drift, then review before commit / merge); QAS report (grading, fixer evidence); run end |
| `learn_enabled` (`LINE_LEARN`, `LINE_LEARN_*`) | `learn/` | lessons distilled from the run's failures, judged offline by a different model, canary arms per unit, promote / withdraw by first-pass yield | prompts (`_context`: lessons instead of plain retrieval); run end |
| `agents_enabled` (`LINE_AGENTS`, `LINE_AGENTS_*`, `LINE_SLO_*`) | `agents_dir.py` | agent versions per role (shadow -> canary -> active, pinned per run), SLOs, rollback | every model call is routed (`RoutedLlm`); run end |
| `obs_enabled` (`LINE_OBS`) | `observe.py` | standard fields per model call, cost per F-item, outcome metrics pushed to the RAG System | model port wrapper; run end; `GET /api/metrics` |

Run-end hooks write about a closed run on the system run `_line` (body `run`), so no event of a run
follows its terminal event. A lost run lease (e.g. the clock jumped past the TTL) pauses the run
(`run.paused`, not terminal); `resume` continues it.

Human questions (understand_plus):

```
GET  /api/runs/{id}/questions                   {"run", "parked", "park", "questions"}
POST /api/runs/{id}/answers  {"who": "...", "answers": [{"qid": "Q1", "option": "accept", "text"?: "..."}]}
                             -> {"results", "remaining", "addendum", "version", "resume", "resumed"?}
```

When the last open question is answered the server resumes the run itself. The board shows the open
questions while a run is parked.

Resume after a restart (the process died or was stopped mid-run):

```
python -m line.cli resume <run>          # drive a non-final run from its persisted state
python -m line.cli serve --resume        # or LINE_AUTO_RESUME=1: resume every non-final run at start
```

Nothing finished is redone: the frozen pack, the reconciled digest, the locked tests committed on
main, the graph and merged units are reused; leased units whose lease expired go back to ready,
submitted units are verified again, verified units are queued for merge. One process drives a run
at a time (run lease, renewed every `LINE_HEARTBEAT_S`); a crashed driver's lease runs out after
`LINE_LEASE_TTL_S`, until then `resume` is refused (exit 2).

Real model (costs money; caps are checked before every call):

```
set LINE_LLM=cli
set LINE_MODEL=claude-opus-5-5
set LINE_MAX_USD_RUN=5
set LINE_MAX_USD_CALL=1.5
set LINE_RAG=off
python -m line.cli run line/samples/todo-pack
```

`cli` uses the signed-in Claude CLI (`claude -p`); builders run in their worktree with
`Read Edit Write Bash(python -m unittest*)` only and a scrubbed environment. `api` serves the
non-agentic roles only. Every call is on the `llm_call` ledger of the run.

## Board

```
python -m line.cli serve [--resume]   # or: python -m line.server   -> http://127.0.0.1:8796
```

`GET /` is the board page; JSON: `/api/health`, `/api/runs`, `/api/runs/{id}`,
`/api/runs/{id}/events?after_seq=`, `/api/board[?run=]`, `/api/runs/{id}/questions`, `/api/metrics[?run=&limit=]`;
`POST /api/runs/{id}/answers` answers questions (see Wave 4). `POST /api/runs {"pack": path,
"target"?: repo}` starts a run on a server thread; `POST /api/runs/{id}:cancel` cancels it:
builder / verifier / merge loops stop at their next check, in-flight model calls are killed, the
builder threads are joined (`LINE_CANCEL_JOIN_S`, default 30 s) and then the run escalates with
CANCELLED; a thread that outlives the join can no longer write (no event follows `escalated`).

Any external UI can show the board the same way: poll `GET /api/board` (every few seconds) or open
the `/board` page. No caller is required; the server runs on its own as above.

## Settings

`config.py`: defaults, then `config/line.json` (tracked), then the local RAG wire config, then
`LINE_*` environment variables. The local RAG wire config is a JSON file OUTSIDE the repo:
`LINE_RAG_LOCAL`, default `%USERPROFILE%\.line\rag.local.json`; only `rag_*` keys and generic
wire keys (header names, pack id, redaction packs). `LINE_RAG_CLIENT_ID` /
`LINE_RAG_CLIENT_SECRET` come from the environment only.

Live check against a RAG System (dev only): with the local wire config in place and
`LINE_RAG_CLIENT_ID` / `LINE_RAG_CLIENT_SECRET` set in the same process, `LINE_RAG_LIVE=1 python -m
unittest line.tests.test_rag_resilient` also runs `LiveRagTests` (events read back by id and seq, records
with If-Match, leases, pack freeze + quote, retrieval, metrics). Remote event ids are
`<run>-<seq>-<digest>` (only `[A-Za-z0-9_-]`, <= 64 chars) and event batches carry the key
`ev-<first>-<last>-<digest>`, so two databases that both start at seq 1 never collide. When the RAG
System names the lease holder after the calling identity, every owner of one client shares it: the HTTP
adapter keeps lease owners apart itself (another owner's acquire -> held; a stale owner's renew /
fenced write -> LEASE_LOST), and the epoch alone does not tell two such owners apart.

Main knobs: `LINE_LLM` (fake | cli | api), `LINE_DRY_PACK`, `LINE_MODEL`, `LINE_MODEL_ALT`,
`LINE_MAX_USD_RUN`, `LINE_MAX_USD_CALL`, `LINE_RAG` (off | http), `LINE_WORKROOT`, `LINE_DB`,
`LINE_MAX_PARALLEL_UNITS`, `LINE_RETRY_N` (failed attempts per ladder rung, all failure kinds together),
`LINE_CANCEL_JOIN_S`, `LINE_AUTO_RESUME`, `LINE_DEPLOY_WINDOWS` ([] on dev = deploy when the
merge queue drains), `LINE_QAS_REPEATS`; wave 4 switches: `LINE_RECONCILE`, `LINE_RAG_LEASES`,
`LINE_RAG_RECORDS`, `LINE_UPLUS`, `LINE_REVIEW`, `LINE_DRIFT`, `LINE_JUDGE`, `LINE_LEARN`, `LINE_AGENTS`,
`LINE_OBS` (full list: `config.ENV_MAP`).

Live dev check of everything with a RAG System (dev only; secrets stay in the process):
`python e2e/rag_dev_setup.py setup all_on` runs the `all_on` variant with `LINE_RAG=http`, RAG leases
and the record mirror, and reports what the remote holds for the run.

## Layout

- `contracts.py`, `codes.py`, `config.py` - frozen types, state tables, ports, codes, settings
- `store.py`, `events.py`, `budget.py`, `lease.py`, `watchdog.py`, `statemachine.py` - control plane
- `scope.py` - run-scoped store keys (`<run>:<unit>`) and unit lease names (`unit:<run>:<unit>`)
- `rag/` - RAG System port (http adapter, local adapter, resilient wrapper, manifest)
- `llm/` - model port (fake, cli, api) with caps and ledger; `llm/prompts/`
- `understand/` - ingest, readers, reconcile, test author, test check
- `build/` - planner, graph checks, scheduler, sandbox, builder, verifier
- `ship/` - merge queue, deploy, QAS runner, fixer
- `pipeline.py` - drives (and resumes) a run; `make_driver` for the server; `dry.py` - dry fault injection
- `cancel.py` - cancel token and the store guard of the builder threads
- `server.py`, `board.html`, `cli.py`
- wave 4: `reconciler.py`, `rag_state.py`, `chaos.py`, `understand_plus/`, `review/`, `learn/`, `agents_dir.py`,
  `observe.py`
- `samples/todo-pack/` - sample spec pack and its dry fixtures; `e2e/run_line_e2e.py`
- `tests/` - unit tests; `tests/fakes.py` in-memory fakes of every port

Work layout under `LINE_WORKROOT`: `<run>/_target` (fresh target repo), `<run>/<unit>` (unit
worktrees, branch `line/<run>/<unit>`), `merge/<run>` (integration worktree), `<run>/_qas`
(blue, green, current pointer), `<run>/quarantine.json`.
