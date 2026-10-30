# Setup: from an empty host to a running engine

Do the steps in order; each ends with a check. You install the **delivered `dlc` package**; nothing is
built on your side. Paths below are examples; pick your own.

## 1. What you receive and what the host needs

You receive one of:

- `dlc-<version>-win64.zip`: the Windows application (`dlc/dlc.exe` plus its runtime folder), or
- a container image `dlc:<version>` (Linux), started with `serve --resume` by default.

| Need | Why | Notes |
|---|---|---|
| OS: Windows 10/11/Server (zip) or any container host (image) | runs the `dlc` application | the zip needs no separate Python for the engine itself |
| Git 2.x on PATH | target repo, one worktree per unit, merge queue | included in the image |
| Python 3.10+ on PATH | **only** to run the tests of Python targets (and `dlc selfcheck`, whose sample is a Python app) | set `LINE_PYTHON` if it is not on PATH as `python` / `python3` / `py`; included in the image |
| Claude Code CLI (`claude`) on PATH | model access in `LINE_LLM=cli` (needed for builders) | version used in tests: 2.1.283 |
| Node.js 18+ and npm 9+ | **only** for Node targets (SAP CAP, UI5 TypeScript, React; see [stacks.md](stacks.md)) | npm registry or a warm npm cache |
| Disk | `DLC_HOME` holds the store, worktrees, merge worktree, QAS folders, packs and new targets | a few hundred MB per run for small targets |
| Network | model provider; RAG system if used | outbound HTTPS |
| A service account | runs the engine and owns the model login | do not use a personal profile |

Not needed: a database server, a RAG system (optional, see step 5), Node.js unless a target is a Node project.

**Install (Windows zip):** unzip to e.g. `C:\Programs\dlc` and add that folder to PATH (or call `dlc.exe` by
its full path). **Install (image):** `docker run -d -p 127.0.0.1:8796:8796 -v dlc-data:/data dlc:<version>`
(publish the port only on an interface your backend reaches; see step 6).

Check:
```
dlc version
git --version
claude --version     # only for LINE_LLM=cli
```

## 2. Offline self-check (no cost, no network)

```
dlc selfcheck        # dry runs of a sample project and a sample migration with the fake model: PASS
```

It uses the samples bundled in the application, a fresh git repository and a fresh store in a temporary
folder; nothing is written to `DLC_HOME`.

## 3. Model access

`LINE_LLM` selects the model port:

| Value | What it does | Use |
|---|---|---|
| `fake` (default) | answers from bundled fixtures of the sample packs | self-check, dry runs |
| `cli` | `claude -p` subprocess per call; builders run agentically in their worktree | **real runs** |
| `api` | Messages API over HTTPS, key from `ANTHROPIC_API_KEY` (env only) | non-agentic roles only; builders refuse it |

For `cli`:

```
# as the service account; a dedicated profile keeps the engine away from personal settings
set CLAUDE_CONFIG_DIR=<service profile dir>      # PowerShell: $env:CLAUDE_CONFIG_DIR = '...'
claude login
```

The engine starts every model call with a scrubbed environment and these limits: `--permission-mode acceptEdits`, `--allowedTools "Read Edit Write Bash(python -m unittest*)"` (Node targets: the stack's npm / jest / cds commands, see [stacks.md](stacks.md)),
`--max-turns`, `--max-budget-usd`, `--setting-sources project --strict-mcp-config`. Non-agentic
calls get `--max-turns 1` and no tools.

If you start the engine from inside another Claude Code session, remove that session's
`CLAUDECODE*` / `CLAUDE_CODE_*` variables first so the child CLI does not think it is nested.

## 4. Configuration

Precedence (later wins):

1. built-in defaults (`llm=fake`, `rag=off`)
2. the local RAG wire config (optional JSON, see step 5)
3. `LINE_*` environment variables (the tables below)

An unknown key or bad value fails fast with `CONFIG_INVALID`.

### 4.1 Core settings

| Env var | Default | Meaning |
|---|---|---|
| `LINE_LLM` | `fake` (line.json) | `fake` \| `cli` \| `api` |
| `LINE_MODEL` | `claude-opus-5-5` | main model for every role |
| `LINE_MODEL_ALT` | `claude-fable-5-1` | model of the "switch model" rung of the retry ladder |
| `LINE_MAX_USD_CALL` | `1.5` | cap per model call (checked before the call) |
| `LINE_MAX_USD_RUN` | `5.0` | cap per run (budget tree run -> F-item -> unit) |
| `LINE_PRICING` | bundled price table | JSON price table for the cost estimates (override to change prices) |
| `LINE_BUILDER_MAX_TURNS` | `40` | agentic turns per builder attempt |
| `DLC_HOME` | `~/dlc` | data folder; `LINE_DB` and `LINE_WORKROOT` default into it |
| `LINE_DB` | `DLC_HOME/line.db` | SQLite store |
| `LINE_WORKROOT` | `DLC_HOME/work` | worktrees, merge worktree, QAS folders, fresh targets |
| `LINE_HOST` / `LINE_PORT` | `127.0.0.1` / `8796` | HTTP API bind address |
| `LINE_CORS_ORIGINS` | none | comma-separated browser origins allowed to call the API directly (prefer calling from your backend) |
| `LINE_PYTHON` | `python` / `python3` / `py` on PATH | interpreter used to run Python targets' tests |
| `LINE_MAX_PARALLEL_UNITS` | `3` | builder threads per run |
| `LINE_RETRY_N` | `3` | failed attempts allowed per ladder rung |
| `LINE_UNIT_MAX_FILES` | `8` | planner limit: files a unit may claim |
| `LINE_REREAD_MAX` | `2` | targeted re-read rounds when readers disagree |
| `LINE_FIXER_GENERATIONS` | `2` | fixer units per red F-item before escalation |
| `LINE_QAS_REPEATS` | `3` | QAS runs per test (flaky detection) |
| `LINE_DEPLOY_WINDOWS` | `[]` | `[]` = deploy when the merge queue drains; else `"HH:MM-HH:MM"` list |
| `LINE_LEASE_TTL_S` / `LINE_HEARTBEAT_S` / `LINE_WATCHDOG_S` | `300` / `60` / `15` | lease timing |
| `LINE_CANCEL_JOIN_S` | `30` | how long cancel waits for builder threads |
| `LINE_AUTO_RESUME` | `false` | resume every non-final run when the server starts |
| `LINE_BUDGET_WARN_RATIO` | `0.8` | `budget.warn` event threshold |
| `LINE_SMOKE_CMD` | per stack: Python unittest, Node `npm test` | smoke command run in the new QAS color before the switch |
| `LINE_PROFILE` | none | `agents` = nobody answers questions: `LINE_HUMAN_MODE=decide`, `LINE_MAX_ACTIVE_AGENTS=10`, `LINE_AUTO_RESUME=1` (each still overridable) |
| `LINE_MAX_ACTIVE_AGENTS` | `0` (no cap) | model calls in flight across every run of the server |
| `LINE_AUTH_ISSUER` | none (API open) | OIDC realm URL; when set every route except health, OpenAPI and auth config needs a bearer token ([api.md](api.md)) |
| `LINE_AUTH_AUDIENCE` / `LINE_AUTH_ROLE_USER` / `LINE_AUTH_ROLE_ADMIN` | `dlc-api` / `dlc-user` / `dlc-admin` | token audience and roles |
| `LINE_AUTH_BOARD_CLIENT` | `dlc-fe` | public OIDC client (Authorization Code + PKCE) the built-in board signs in with |
| `LINE_AUTH_JWKS_TTL_S` / `LINE_AUTH_LEEWAY_S` | `600` / `60` | realm key cache, clock skew |
| `LINE_PUBLIC_HOST` | this host's IP | host name or IP in the URL of a started app |
| `LINE_APP_PORTS` | `18000-18099` | ports for started apps (`a-b` or `a,b,c`) |
| `LINE_APP_START_TIMEOUT_S` | `60` | wait this long for a started app to answer |
| `LINE_STACK` | `auto` | target stack: `auto` (detect per repo) \| `python-unittest` \| `node-cap` \| `node-ui5-ts` \| `react` ([stacks.md](stacks.md)) |
| `LINE_LANES` | `auto` (on with a real model) | change sizer + lanes `trivial` / `small` / `full`; `0` = every run `full` ([pipeline.md](pipeline.md) 3.1) |
| `LINE_SIZER_MAX_TURNS` / `LINE_SIZER_MAX_USD` | `12` / `0.3` | the change sizer's limits |
| `LINE_ROLE_MODELS` | readers, re-read, feature graph, planner, spec analyst on `claude-sonnet-5-5`; sizer on `claude-haiku-5-5` | `role=model,...` or JSON; other roles use `LINE_MODEL` ([agents.md](agents.md)) |
| `LINE_LLM_CACHE` / `LINE_LLM_CACHE_DAYS` | `auto` / `30` | an identical reading prompt is answered from the store, not paid again |
| `LINE_AGENT_CMD_TIMEOUT_S` | `300` | longest single shell command of an agent; `0` = the CLI's own default |
| `LINE_SUPERVISOR` | `auto` (on with a real model) | a supervising agent settles failed runs before a person ([pipeline.md](pipeline.md) 4.1); `0` = people decide every failure |
| `LINE_SUPERVISE_MAX_RETRIES` / `LINE_SUPERVISE_MAX_USD` | `2` / `3.0` | supervised re-runs of one request, and what they may spend together |
| `LINE_TESTS_HERE` / `LINE_TESTS_HERE_MAX_USD` | `auto` / `1.5` | acceptance tests run on a QAS-like copy before the lock, one agent fix round when they break for the machine ([pipeline.md](pipeline.md)); `0` = off |
| `LINE_CODEGRAPH` | `auto` (on when Graphify is installed) | code graph of each run's target for the agents; `0` = off |
| `LINE_GRAPHIFY` | set by `install-graphify` | the graphify executable |
| `LINE_CODEGRAPH_DIR` / `LINE_CODEGRAPH_TIMEOUT_S` | `<work root>/codegraph` / `300` | where the indexes live (never inside a repository); longest scan |

**Sign-in server.** Use the realm's **https** URL for `LINE_AUTH_ISSUER` (a Keycloak sign-in page served over
plain http fails in browsers: its cookies are `Secure`). The engine fetches the realm's signing keys over https
with the operating system's trust store; with a self-signed certificate either add it to the host's trusted
roots or point `SSL_CERT_FILE` at the certificate (PEM) in the engine's environment.

**Agents only, nobody answers questions.** Set `LINE_HUMAN_MODE=decide`: the model takes every open decision
and logs it, so runs never wait for a person (a frontend can still override per run).

### 4.2 Feature switches (all off by default)

| Env var | Feature | See |
|---|---|---|
| `LINE_FGRAPH` | feature graph: dependency-ordered build, asks when something used is produced by nothing | pipeline.md |
| `LINE_UPLUS` | gap checklist, assumption register, contradiction check, one round of human questions | pipeline.md |
| `LINE_HUMAN_MODE` | `ask` (park and wait for a person) \| `decide` (the model decides, every decision is logged) | pipeline.md |
| `LINE_REVIEW` / `LINE_DRIFT` / `LINE_JUDGE` | clean-context reviewer, drift ladder, strong-model judge | agents.md |
| `LINE_LEARN` | lessons distilled from failures, offline judged, canaried | agents.md |
| `LINE_AGENTS` | agent versions per role (shadow / canary / active), SLO, rollback | agents.md |
| `LINE_OBS` | standard fields per call, cost per F-item, outcome metrics | api.md |
| `LINE_RECONCILE` | periodic drift repair between store, git, QAS and RAG | pipeline.md |
| `LINE_RAG_LEASES` / `LINE_RAG_RECORDS` | RAG system as lease authority / record mirror | rag-requirements.md |
| `LINE_SEAL` | seal ledger, per-file claims, async scoring, merge only finalised seals, speculative starts, final seal; sub-settings `LINE_SEAL_DEPTH` (2), `LINE_SEAL_GOVERNOR_FAIL` (0.2), `LINE_SEAL_L2_PATHS` ([]) | seal-and-scan.md |
| `LINE_SCAN_CACHE` | feature migration: content-addressed model answers + as-of freshness of the blast radius; `1` = per migration, a path = shared | seal-and-scan.md |

Each switch has sub-settings (`LINE_UPLUS_*`, `LINE_HUMAN_*`, `LINE_REVIEW_*`, `LINE_JUDGE_*`,
`LINE_LEARN_*`, `LINE_AGENTS_*`, `LINE_SLO_*`, `LINE_RECONCILE_*`); ask your vendor contact for the full
list of a feature you enable.

Recommended production profile for the three standard flows:

```
LINE_LLM=cli
LINE_DB=<data dir>/line.db
LINE_WORKROOT=<data dir>/work
LINE_MAX_USD_RUN=6
LINE_FGRAPH=1
LINE_HUMAN_MODE=ask          # or decide, if nobody answers questions
LINE_AUTO_RESUME=1
LINE_RAG=off                 # or http, see step 5
```

## 5. RAG system (optional)

Skip this step to run fully local (`LINE_RAG=off`). To connect one, the RAG system must meet
[rag-requirements.md](rag-requirements.md). Then:

**5.1 Wire config file (no secrets).** Path: `LINE_RAG_LOCAL`, default
`~/.line/rag.local.json` (`%USERPROFILE%\.line\rag.local.json` on Windows).

```json
{
  "rag_url": "https://<rag-host>",
  "rag_ns": "sdlc_line",
  "rag_timeout_s": 15,
  "project": "<project id in the RAG system>"
}
```

Only `rag_*` keys and generic wire keys are read from this file (`project`, `pack_id`,
`keyspace`, `token_path`, `capabilities_path`, `capability_map`, `header_*`, `redaction_packs`,
`idempotency_hours`). Secrets in it are ignored.

**5.2 Secrets (environment only).** `LINE_RAG_CLIENT_ID`, `LINE_RAG_CLIENT_SECRET`: the
client-credentials pair the RAG system issued for the namespace. Set them on the service, never in
a file.

**5.3 Turn it on.** `LINE_RAG=http`. `rag_url` (file) or `LINE_RAG_URL` (env) is required; there is no default and the config load fails with `CONFIG_INVALID` without it. Optional: `LINE_RAG_LEASES=1`, `LINE_RAG_RECORDS=1`.

**5.4 Apply the engine's manifest once** (record types, event kinds, metric series, keyspace).
The server does **not** do this on start. It is idempotent; re-run it after upgrading the engine:

```
dlc rag-manifest apply
```

**5.5 Check:** start the server (step 6) with `LINE_RAG=http` and run one small run; the board shows
`rag.degraded` / `rag.restored` events if the connection drops, and the RAG system receives the run's events.

## 6. Run the server

```
dlc serve --resume
```

Check: `GET http://127.0.0.1:8796/api/health` returns `"ok": true, "driver": true`; `GET /api/openapi.json`
returns the API description. The board is at `http://127.0.0.1:8796/`.

Run it as a service under the service account (Windows: Task Scheduler or NSSM; Linux: the container or
systemd) with the environment from step 4, restart on failure. `LINE_AUTO_RESUME=1` (or `--resume`) makes a
restart pick up every unfinished run; nothing finished is redone.

**The API has no authentication in this release.** Make it reachable only from your own backend or a private
network: keep `LINE_HOST=127.0.0.1` when the caller runs on the same host; otherwise bind to a private
interface and firewall the port to the caller's address, or put an authenticating reverse proxy in front.
Never expose it to the internet.

## 7. End-to-end check (real model, about 1-2 USD)

Create a small spec pack (a folder with `spec.md`, see [flows.md](flows.md)) and run:

```
set LINE_LLM=cli
dlc run <pack folder>          # fresh target repo under LINE_WORKROOT
```

Expected: exit code 0, state `green`, units merged, QAS green. Exit 1 means escalated:
read `dlc status <run>` and the board.

## 8. Upgrade and housekeeping

- Stop the server, replace the application folder (or pull the new image), run `dlc selfcheck`, start the
  server (with `--resume`). Data in `DLC_HOME` is kept.
- If a RAG system is used, re-apply the manifest (5.4).
- `LINE_RECONCILE=1` removes orphan worktrees and branches and repairs drift periodically; without
  it, worktrees of escalated runs stay on disk as evidence until you delete them.
