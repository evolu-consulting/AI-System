> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `setup.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# Setup: from an empty host to a running engine

Do the steps in order; each ends with a check. All commands run from `Slaves/SDLC` (the directory
that contains `line/`). Paths below are examples; pick your own.

## 1. System requirements

| Need | Why | Notes |
|---|---|---|
| OS: Windows 10/11/Server, or Linux | engine is pure Python | macOS untested |
| Python 3.10+ | engine runtime | **standard library only**, no `pip install` for the engine |
| Git 2.x on PATH | target repo, one worktree per unit, merge queue | |
| Claude Code CLI (`claude`) on PATH | model access in `LINE_LLM=cli` (needed for builders) | version used in tests: 2.1.283 |
| Disk | `LINE_WORKROOT` holds worktrees, merge worktree, QAS folders per run | a few hundred MB per run for small targets |
| Network | model provider; RAG system if used | outbound HTTPS |
| PowerShell 7 (`pwsh`) | **only** for the optional helper `line/tools/dlc_flow.ps1` | not needed by the engine |
| Node.js 18+ and npm 9+ (tested: node 22.19, npm 11.8) | **only** for Node targets (SAP CAP, UI5 TypeScript, React; see [stacks.md](stacks.md)) | npm registry or a warm npm cache; the target's own native test deps may need build tools |
| A service account | runs the engine and owns the model login | do not use a personal profile |

Not needed: Docker, a database server, a RAG system (optional, see step 5), Node.js unless a target is
a Node project.

Get the code (monorepo, engine on branch `sdlc-line` until merged into `main`):

```
git clone <repo-url> && cd <repo>/Slaves/SDLC
git checkout sdlc-line
```

Check:
```
python --version     # 3.10 or later
git --version
claude --version     # only for LINE_LLM=cli
```

## 2. Offline self-check (no cost, no network)

```
python -m unittest discover -s line/tests -t .      # must end with OK (live tests are skipped)
python -m line.e2e.run_line_e2e base fgraph         # dry end-to-end with the fake model: PASS
python -m line.chaos                                 # optional: 9 fault scenarios + invariants
```

The dry runs use `line/samples/todo-pack` and its fixtures under `dry/`, a fresh git repo and a
fresh database per variant under `LINE_WORKROOT` (default: system temp). Variants:
`base flaky qas_red rag_outage all_on conflict_park decide_off fgraph` (no name = all).

## 3. Model access

`LINE_LLM` selects the model port:

| Value | What it does | Use |
|---|---|---|
| `fake` (default in tracked config) | answers from fixtures `samples/<pack>/dry/<role>/<key>.json` | tests, dry runs |
| `cli` | `claude -p` subprocess per call; builders run agentically in their worktree | **real runs** |
| `api` | Messages API over HTTPS, key from `ANTHROPIC_API_KEY` (env only) | non-agentic roles only; builders refuse it |

For `cli`:

```
# as the service account; a dedicated profile keeps the engine away from personal settings
set CLAUDE_CONFIG_DIR=<service profile dir>      # PowerShell: $env:CLAUDE_CONFIG_DIR = '...'
claude login
```

The engine starts every model call with a scrubbed environment and these limits (from
`line/llm/cli.py`): `--permission-mode acceptEdits`, `--allowedTools "Read Edit Write Bash(python -m unittest*)"` (Node targets: the stack's npm / jest / cds commands, see [stacks.md](stacks.md)),
`--max-turns`, `--max-budget-usd`, `--setting-sources project --strict-mcp-config`. Non-agentic
calls get `--max-turns 1` and no tools.

If you start the engine from inside another Claude Code session, remove that session's
`CLAUDECODE*` / `CLAUDE_CODE_*` variables first so the child CLI does not think it is nested.

## 4. Configuration

Precedence (later wins), from `line/config.py`:

1. defaults in `config.py`
2. `line/config/line.json` (tracked; dev defaults: `llm=fake`, `rag=off`)
3. the local RAG wire config (optional JSON **outside the repo**, see step 5)
4. `LINE_*` environment variables (full list: `config.ENV_MAP`)

An unknown key or bad value fails fast with `CONFIG_INVALID`.

### 4.1 Core settings

| Env var | Default | Meaning |
|---|---|---|
| `LINE_LLM` | `fake` (line.json) | `fake` \| `cli` \| `api` |
| `LINE_MODEL` | `claude-opus-5-5` | main model for every role |
| `LINE_MODEL_ALT` | `claude-fable-5-1` | model of the "switch model" rung of the retry ladder |
| `LINE_MAX_USD_CALL` | `1.5` | cap per model call (checked before the call) |
| `LINE_MAX_USD_RUN` | `5.0` | cap per run (budget tree run -> F-item -> unit) |
| `LINE_PRICING` | `Slaves/SDLC/pricing.json` | price table for the cost estimates |
| `LINE_BUILDER_MAX_TURNS` | `40` | agentic turns per builder attempt |
| `LINE_DB` | `line/line.db` | SQLite store (put it outside the repo in production) |
| `LINE_WORKROOT` | `<system temp>/sdlc-line` | worktrees, merge worktree, QAS folders, fresh targets |
| `LINE_HOST` / `LINE_PORT` | `127.0.0.1` / `8796` | HTTP API bind address |
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
| `LINE_SMOKE_CMD` | per stack: `python -m unittest`, Node `npm test` | smoke command run in the new QAS color before the switch |
| `LINE_STACK` | `auto` | target stack: `auto` (detect per repo) \| `python-unittest` \| `node-cap` \| `node-ui5-ts` \| `react` ([stacks.md](stacks.md)) |

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
`LINE_LEARN_*`, `LINE_AGENTS_*`, `LINE_SLO_*`, `LINE_RECONCILE_*`); names and defaults are in
`config.py`.

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

**5.1 Wire config file (outside the repo, no secrets).** Path: `LINE_RAG_LOCAL`, default
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
python -c "from line.config import load_config; from line.rag.http_adapter import HttpRagAdapter as H; print(H.from_config(load_config()).apply_manifest())"
```

**5.5 Live check (dev only, writes test data into the namespace):**

```
set LINE_RAG_LIVE=1
python -m unittest line.tests.test_rag_resilient     # LiveRagTests: events, records, leases, packs, quote, retrieval, metrics
```

## 6. Run the server

```
python -m line.cli serve --resume        # or: python -m line.server
```

Check: `GET http://127.0.0.1:8796/api/health` returns `"ok": true, "driver": true`.
The board is at `http://127.0.0.1:8796/board`.

Run it as a service under the service account (Windows: Task Scheduler or NSSM; Linux: systemd)
with the environment from step 4, working directory `Slaves/SDLC`, restart on failure.
`LINE_AUTO_RESUME=1` (or `--resume`) makes a restart pick up every unfinished run; nothing finished
is redone.

The API has **no authentication**. Keep it on `127.0.0.1`, or put an authenticating reverse proxy
in front of it.

## 7. End-to-end check (real model, about 1-2 USD)

```
set LINE_LLM=cli
python -m line.cli run line/samples/todo-pack      # fresh target repo under LINE_WORKROOT
```

Expected: exit code 0, state `green`, 4 units merged, QAS 3/3 green. Exit 1 means escalated:
read `python -m line.cli status <run>` and the board.

## 8. Upgrade and housekeeping

- Stop the server, pull, run step 2, start the server (with `--resume`).
- If a RAG system is used, re-apply the manifest (5.4).
- `LINE_RECONCILE=1` removes orphan worktrees and branches and repairs drift periodically; without
  it, worktrees of escalated runs stay on disk as evidence until you delete them.
