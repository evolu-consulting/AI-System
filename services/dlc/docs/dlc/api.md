# Engine API and CLI

Server: `dlc serve [--resume] [-v]`, default `http://127.0.0.1:8796` (`LINE_HOST`, `LINE_PORT`). JSON in and
out, UTF-8.

**Sign-in (optional).** With `LINE_AUTH_ISSUER` set to an OIDC realm URL (Keycloak:
`http://<host>:<port>/realms/<realm>`), every route except `GET /api/health`, `GET /api/openapi.json` and
`GET /api/auth/config` needs `Authorization: Bearer <access token>` from that realm. The token is checked
against the realm's signing keys (RS256), its issuer, expiry (60 s clock skew allowed) and audience (`aud` or
`azp` must contain `LINE_AUTH_AUDIENCE`, default `dlc-api`), and it must carry the role `LINE_AUTH_ROLE_USER`
(default `dlc-user`, realm role or client role of the audience client). Cancelling a run and stopping a started
app need `LINE_AUTH_ROLE_ADMIN` (default `dlc-admin`, which also counts as the user role). Answers: 401
`{"code": "UNAUTHENTICATED"}` with a `WWW-Authenticate: Bearer` header, 403 `{"code": "FORBIDDEN"}`, 503
`AUTH_UNAVAILABLE` when the realm keys cannot be read. The caller's user name is kept on the runs it starts
(`actor`) and in pause / resume / cancel records. Without `LINE_AUTH_ISSUER` the API is open: reach it only
from a trusted backend or private network.

Machine-readable contract: `GET /api/openapi.json` (OpenAPI 3), generated from the same route table the server
routes by. Any `/api` path not in it answers 404. CORS: only origins listed in `LINE_CORS_ORIGINS`
(comma separated, default none) receive `Access-Control-Allow-*` headers; prefer calling the engine from your
backend.

Errors: `{"code", "message", "detail"}` with HTTP 404 (`NOT_FOUND`), 409 (`STATE_CONFLICT`,
`ILLEGAL_TRANSITION`, `CANCELLED`), 400 (`SCHEMA_INVALID` and other codes), 501 (no pipeline
driver), 500 (`INTERNAL`).

## 1. HTTP routes

### Health

`GET /api/health` -> `{"ok": true, "service": "sdlc-line", "version", "host", "port", "last_seq",
"time_ms", "driver": true}`. `driver: false` means the server cannot start runs (POST -> 501).

### Create a spec pack

`POST /api/packs {"kind": "new" | "enhance", "name", "spec": "<markdown>"}` or
`{"kind": "bug", "name"?, "title", "repro", "expected", "actual", "context"?}` -> `201 {"pack", "kind", "name",
"chars"}`. The pack is written under `DLC_HOME/packs` on the engine host; pass `pack` to `POST /api/runs`.
Spec text up to 2,000,000 characters. 400 `SCHEMA_INVALID` when a required field is missing.

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

### Sign-in settings and the caller

| Route | Answer |
|---|---|
| `GET /api/auth/config` (open) | `{"enabled": false}` or `{"enabled": true, "issuer", "client_id", "audience", "role_user", "role_admin"}`: what a browser needs for an Authorization Code + PKCE sign-in (`client_id` = `LINE_AUTH_BOARD_CLIENT`, default `dlc-fe`) |
| `GET /api/me` | `{"enabled", "actor", "roles": [...], "admin"}` for the bearer token |

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

### Pause and resume

`POST /api/runs/{id}:pause` `{"reason"?}` -> `{"run", "state", "paused": true, "stopping"}`: at any time; no
new work is dispatched and running model calls are stopped at once. The run keeps its state (it is not
final), `paused` shows on the run summary and an auto resume at server start leaves it alone.
`POST /api/runs/{id}:resume` -> `{"run", "state", "resuming": true}` continues from where it stopped (also
after a restart). Both answer 409 for a final run. Events `run.paused` / `run.resumed`.

### Stage nodes, worklog, reports (for a progress view)

| Route | Answer |
|---|---|
| `GET /api/runs/{id}/nodes` | `{"run", "state", "paused", "nodes": [{id, title, stage, state, roles, started_ms, ended_ms, counts: {events, llm_calls, usd, units?, merged?}}]}` in order: `understand`, `tests`, `plan`, `build`, `review`, `merge`, `qas`, `result`. Node state: `pending`, `running`, `paused`, `done`, `failed`, `skipped` |
| `GET /api/runs/{id}/nodes/{node}/worklog[?limit=N]` | `{"run", "node", "entries": [{ts, role, agent, kind, title, text, cost_usd?}]}` oldest first; `kind` is `llm_call`, `decision`, `event`, `output` or `error` |
| `GET /api/runs/{id}/reports` | `{"run", "reports": [{id, kind, title, node, created_ms, mime, size, url}]}`: the spec pack's own text files (`kind: spec`) and generated reports (`implement`, `test`, `qas`, `questions`, `findings`, `seal`) when there is something to report |
| `GET /api/runs/{id}/reports/{rid}` | `{"report": {...}, "content": "<text>"}`; only ids from the listing resolve |

### The deployed app (Start / Open)

When a run is green its app can be started on the engine host for people to open:

| Route | Answer |
|---|---|
| `GET /api/runs/{id}/app` | `{"run", "state": "none"\|"stopped"\|"starting"\|"running"\|"failed", "url", "port", "pid", "dir", "how", "log_tail"}` |
| `POST /api/runs/{id}/app:start` | starts it (or returns it when it already runs) and waits until it answers; `url` is `http://<LINE_PUBLIC_HOST or this host's IP>:<port>` |
| `POST /api/runs/{id}/app:stop` | stops it (admin role when sign-in is on) |

The app runs from the color QAS deployed last, else the run's target repository. How it starts: a
`dlc.app.json` file in the app (`{"start": [argv], "cwd"?, "port_env"?: "PORT", "health_path"?: "/",
"open_path"?: "/"}`; `{port}` in an argument is replaced), else a `package.json` start script, else an
Python entry file named app, main or server in the app folder, else an `index.html` served as static files. The port comes from
`LINE_APP_PORTS` (default `18000-18099`) and is passed in `PORT`; the app should listen on `0.0.0.0`. Open the
port range in the host firewall so other machines reach the app. When the spec describes a web UI or an HTTP
service, the agents build the app that way and write `dlc.app.json` themselves.

Settings that must not live in the app's repository (an admin password, an API key) go in
`DLC_HOME/secrets/apps/<project>.env` (on Windows `C:\DLC\data\dlc\secrets\apps\<project>.env`), one `KEY=VALUE`
per line; `#` comments and quoted values are allowed. Every start of a run of that project passes them to the app;
`PORT` and `HOST` stay set by DLC. The app log names the keys, never the values. Stop and start the app after
changing the file.

### Change queue

| Route | Answer |
|---|---|
| `GET /api/projects/{id}/queue` | `{"project", "wait_minutes", "active": [slot], "recent": [slot]}`; a slot is `{"id", "seq", "run", "flow", "state", "summary", "docs", "created_ms", "planned_ms", "started_ms", "ended_ms", "end", "ignored_by", "waited_min", "order", "policy"}`, state `reserved` (in design) / `planned` (approved, waits its turn) / `implementing` / `done` / `dropped` / `ignored`; `order` is the place in the queue (order of approval), null while in design |
| `POST /api/runs/{id}/gates/{gate}` | a person's decision at the open gate: `{"decision", "note"?, "target"?, "who"?, "files"?: [{name, data}], "answers"?: [{artifact, id, ok, text?}]}`; `answers` settle the gate's points to confirm (`asks` of the attention view's gate); an open point needs `text`; the answer's `recorded: {disk, store}` says where the decision ledger kept it (process.md, the decision ledger) |
| `POST /api/runs/{id}/gates/{gate}/chat` | `{"message", "who"?}` -> 202 `{"gate", "messages"}`: talk with the step's agents at a gate whose definition says `chat: true`; the agent answers on a thread (message `state` thinking -> done / failed, `edited`: the documents it changed); read the conversation in the attention view's `gate.messages` |
| `GET /api/runs/{id}/decisions` | every decision taken at the run's gates (decision ledger, process.md): `{"run", "entries", "markdown", "signal"}`; each entry has its signal (positive / mixed / negative / auto), the points with the person's answers, the note, the chat and `documents` {artifact: path}; `?doc=<path>` returns that document as the person saw it when deciding (`{"run", "path", "text"}`) |
| `GET /api/admin/change-queue` | `{"wait_minutes", "projects": [queue]}` (admin role) |
| `POST /api/admin/change-queue` | `{"wait_minutes": n}` (0-10080): how long a run ready to build waits for an earlier run that is still being analysed (admin role) |

Enhancement and Bug Fix runs of one project run at the same time and queue their builds (process.md, "The change
queue"); `POST /api/runs` answers 409 only for a New System or another non-queued flow next to a live run.

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

## 2. The `dlc` command

Configuration from env as in [setup.md](setup.md#4-configuration).

| Command | Does | Exit |
|---|---|---|
| `dlc version` | print the version | 0 |
| `dlc serve [--resume] [-v]` | HTTP API + board; `--resume` = resume every non-final run at start | |
| `dlc run <pack> [--target <repo>]` | admit and drive one run in this process (blocks) | 0 green, 1 escalated |
| `dlc resume <run>` | drive a stopped non-final run from its persisted state | 0 green, 1 escalated, 2 unknown / final run or run lease still held |
| `dlc status [run]` | list runs, or one run with units and escalations | 0 |
| `dlc board [run]` | board JSON | 0 |
| `dlc cancel <run> [--reason R] [--url U]` | ask a running server to cancel a run | 0 |
| `dlc migrate --v1 R\|DIR --v2 R [--v1-repos F] [--v2-repos F] [--v1-ref] [--v1-base] [--v2-ref] [--notes F.md] [--mode ask\|decide] [--scope W ...] [--no-build]` | feature migration in this process (blocks) | 0 green or analysed, 3 parked on conflicts, 1 escalated |
| `dlc migrate-answer <migration> <conflict> v2\|v1 [--who N]` | decide one conflict; continues when none is open | 0 |
| `dlc selfcheck` | offline self-test: dry runs of a sample project and a sample migration with the fake model (no network, no cost) | 0 pass |
| `dlc rag-manifest apply` | apply the engine's manifest to the configured RAG system | 0 |
| `dlc import-flows --url U --dir D` | load workflow documents into a workflow tool | 0 |
| `dlc flow <new\|enhance\|bug\|wait\|migrate\|migwait\|migresume>` | caller helper for workflow shell steps (env inputs, one JSON line out), see [flows.md](flows.md#5-reference-caller-optional) | 0 done, 2 bad input, 3 parked, 4 escalated, 5 time limit |

## 3. Integrating an orchestrator or UI

Any caller works the same way; nothing in the engine knows which caller it is:

1. Put the pack on the engine host (shared folder, upload step, or generate it there).
2. `POST /api/runs`.
3. Poll `GET /api/runs/{id}` (15-30 s). Optionally stream `GET /api/runs/{id}/events?after_seq=`.
4. If `GET /api/runs/{id}/questions` says `parked: true`, show the open questions to a person and
   send `POST /api/runs/{id}/answers`.
5. Stop on `green` (success) or `escalated` (failure; show `escalations`).

A reference caller for all flows is `dlc flow ...` ([flows.md](flows.md#5-reference-caller-optional)). For a
frontend, follow [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md).
