> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `api.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# Engine API and CLI

Server: `python -m line.cli serve [--resume] [-v]` (or `python -m line.server`), stdlib HTTP,
default `http://127.0.0.1:8796`. JSON in and out, UTF-8. **No authentication**: bind to
localhost or put an authenticating proxy in front.

Errors: `{"code", "message", "detail"}` with HTTP 404 (`NOT_FOUND`), 409 (`STATE_CONFLICT`,
`ILLEGAL_TRANSITION`, `CANCELLED`), 400 (`SCHEMA_INVALID` and other codes), 501 (no pipeline
driver), 500 (`INTERNAL`).

## 1. HTTP routes

### Health

`GET /api/health` -> `{"ok": true, "service": "sdlc-line", "version", "host", "port", "last_seq",
"time_ms", "driver": true}`. `driver: false` means the server cannot start runs (POST -> 501).

### Start a run

`POST /api/runs`

```json
{"pack": "/abs/path/to/pack", "target": "/abs/path/to/repo"}
```

- `pack` required: a spec pack directory **on the engine host** ([flows.md](flows.md#11-spec-pack-a-directory-on-the-engine-host)).
- `target` optional: git repo with `main` checked out and clean; omitted = a fresh repo under
  `LINE_WORKROOT`.
- Answer `202 {"run": "R...", "state": "admitted"}`. The run is driven on a server thread.
  Pack and target are checked when the run starts driving: a bad pack or a dirty target shows up as
  an escalated run, not as a 400.

### Read runs

| Route | Answer |
|---|---|
| `GET /api/runs` | `{"runs": [{id, state, pack_path, spec_hash, created_ms, updated_ms, budget_usd, units, unit_states, detail}]}` newest first |
| `GET /api/runs/{id}` | `{"run", "units", "gates", "budget": {limit, spent, ...}, "merge", "deploy", "qas", "tests", "escalations"}` |
| `GET /api/runs/{id}/events?after_seq=N&limit=M` | `{"run", "events": [...], "last_seq"}`; `limit` 1-5000 (default 500); page with `after_seq` |
| `GET /api/board[?run=id]` | board projection: runs, F-item lanes, units, gates, deploy, qas, escalations, budget, recent events, human questions |
| `GET /api/metrics[?run=&limit=]` | outcome metrics: first-pass yield, escalation rate, rework, flaky rate, lead time, cost per F-item |
| `GET /` or `/board` | board web page (polls the JSON above) |

Terminal states: `green`, `escalated` (detail in `escalations`, code in
`run.detail.escalation.code`).

### Human questions

`GET /api/runs/{id}/questions` -> `{"run", "parked": bool, "park", "questions": [{qid, state,
kind, decision, options, recommended, f_items, due_ms, answer, addendum, ...}]}` (open first).

`POST /api/runs/{id}/answers`

```json
{"who": "jane", "answers": [{"qid": "Q1", "option": "accept", "text": "optional note"}]}
```

or one answer: `{"qid", "option", "text"?, "who"}`. Answer: `{"results", "remaining",
"addendum": "v1.1" | null, "version", "resume": bool, "resumed"?}`. When the last open question is
answered the server resumes the run itself. 400 bad option or missing `who`, 409 already answered.

### Seals (LINE_SEAL=1)

`GET /api/runs/{id}/seals` -> `{"run", "seals": [{id, unit, attempt, ledger_state, rt_state, total, level,
docked, reasons, spec_on, tainted_by, signed_by, refused_by, final?}]}`. `GET /api/board` carries the same rows
as `seals` (absent when the run has none); the board's run view shows them as a Seals table.

`POST /api/runs/{id}/seals/{subject}:sign` `{"who": "jane", "option": "sign" | "refuse"}` (subject
`<run>:<unit>#<n>`, URL-encoded) -> `{"seal", "resumed"?}`: the sign-off of an L2 seal; the server resumes
the run. 400 missing `who` / bad option, 409 when the subject is not waiting for a sign-off.

### Cancel

`POST /api/runs/{id}:cancel` `{"reason": "..."}` -> `{"run", "state", "cancelling": true}` for a
live run (it escalates with `CANCELLED` after the builder threads stop), or the run is escalated
at once when no driver is running it. 409 when the run is already final.

### Feature migration (flow 4)

| Route | Body / answer |
|---|---|
| `POST /api/migrations` | `{"v1", "v2", "v1_ref"?, "v1_base"?, "v2_ref"?, "notes"?, "mode"?: "ask"\|"decide", "scope"?, "build"?, "v1_repos"?, "v2_repos"?}` (v1 / v2: a repository or a folder of repositories, scanned per repository; see feature-migration.md 2.3) -> 202 `{"migration", "state": "admitted"}`; driven on a thread. 400 missing v1/v2 or bad mode, 404 a path or ref not found, 409 v2 not on a clean `main` |
| `GET /api/migrations` | `{"migrations": [{"id", "state", "code", "mode", "v1", "v2", "run", "counts", "open_conflicts", "report"}]}` |
| `GET /api/migrations/{id}` | `{"migration", "features" (parity matrix rows), "conflicts", "questions" (open ones, with options v2 / v1), "run"?}` |
| `POST /api/migrations/{id}/answers` | `{"answers": [{"conflict": "C1", "choice": "v2"\|"v1"}], "who"}` -> `{"results", "remaining", "resume", "resumed"?}`; the migration continues when nothing is open. 409 when it is not waiting for decisions. Open decisions take one of their own option ids as `choice` |
| `GET /api/migrations/{id}/details` | `{"repos": {"v1", "v2"}, "blast", "effort", "decisions", "evidence": {feature id: {behaviour, repo, quotes}}, "baseline", "verify", "runs", "timeline"}`: what the board's migration view draws besides the matrix. Only fixed artefact names of the migration's own folder are read |
| `GET /api/migrations/{id}/report` | `{"migration", "report": report.md text, "ready"}` (`ready: false` until the migration ends) |
| `POST /api/migrations/{id}:resume` | `{"max_usd"?, "max_usd_repo"?, "rescan"?}` -> `{"migration", "state", "resuming"}`. A migration stopped on `MIGRATION_BUDGET` goes back to the stage it stopped in once the cap is raised (409 if not raised enough); `rescan: true` goes back to the repository scan (cached scans kept); a non-final one is driven on |

`POST /api/migrations` also takes `max_usd` and `max_usd_repo` (budget, see feature-migration.md 4.1). Every
migration summary carries `budget`: `{limit, limit_repo, spent, build_spent, build_limit, total, remaining,
warn, repos: {"<side>.<repo>": usd}}`, plus `message` and `detail` (for `MIGRATION_BUDGET`: `scope`, `repos`?,
`resume_state`).

States: `admitted`, `inventoried`, `matched`, `parked`, `decided`, `building`, `verifying`, then `green`,
`analysed` or `escalated`. The build itself is an ordinary run (`run` field), visible on the board and in
`/api/runs`. Events `migration.*` carry the migration id as envelope `run`.

## 2. CLI

All from `Slaves/SDLC`; configuration from env as in [setup.md](setup.md#4-configuration).

| Command | Does | Exit |
|---|---|---|
| `python -m line.cli run <pack> [--target <repo>]` | admit and drive one run in this process (blocks) | 0 green, 1 escalated |
| `python -m line.cli resume <run>` | drive a stopped non-final run from its persisted state | 0 green, 1 escalated, 2 unknown / final run or run lease still held |
| `python -m line.cli status [run]` | list runs, or one run with units and escalations | 0 |
| `python -m line.cli board [run]` | board JSON | 0 |
| `python -m line.cli serve [--resume] [-v]` | HTTP server; `--resume` = resume every non-final run at start | |
| `python -m line.cli migrate --v1 R\|DIR --v2 R [--v1-repos F] [--v2-repos F] [--v1-ref] [--v1-base] [--v2-ref] [--notes F.md] [--mode ask\|decide] [--scope W ...] [--no-build]` | feature migration in this process (blocks) | 0 green or analysed, 3 parked on conflicts, 1 escalated |
| `python -m line.cli migrate-answer <migration> <conflict> v2\|v1 [--who N]` | decide one conflict; continues when none is open | 0 |
| `python -m line.e2e.run_line_e2e [variant ...] [-v]` | dry end-to-end with the fake model | 0 pass |
| `python -m line.chaos [--all-on]` | fault scenarios + invariants | 0 pass |

## 3. Integrating an orchestrator or UI

Any caller works the same way; nothing in the engine knows which caller it is:

1. Put the pack on the engine host (shared folder, upload step, or generate it there).
2. `POST /api/runs`.
3. Poll `GET /api/runs/{id}` (15-30 s). Optionally stream `GET /api/runs/{id}/events?after_seq=`.
4. If `GET /api/runs/{id}/questions` says `parked: true`, show the open questions to a person and
   send `POST /api/runs/{id}/answers`.
5. Stop on `green` (success) or `escalated` (failure; show `escalations`).

A reference shell caller for the three standard flows is `line/tools/dlc_flow.ps1`
([flows.md](flows.md#5-reference-caller-optional)).
