> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `README.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# AI DLC engine: integration and operations docs

The AI DLC engine (code name: the *line*, package `Slaves/SDLC/line`) turns a written spec into
verified, merged code on a dev QAS slot, or stops with a clean escalation. It runs the whole
delivery loop with AI agents: understand the spec, write acceptance tests first, plan units, build
units in parallel, verify, merge, deploy to QAS, test, fix.

This doc set is for an engineer or an LLM agent who has to set the engine up from nothing, run the
three standard flows, or plug it into other systems. It describes the engine only. Everything
outside it is a pluggable dependency described by a contract:

| Dependency | Required? | Contract |
|---|---|---|
| Model provider (Claude CLI or Messages API) | yes, for real runs (`fake` exists for dry runs) | [setup.md](setup.md#3-model-access), [agents.md](agents.md) |
| Git | yes | target repo with branch `main`, worktrees per unit |
| RAG system | **optional** (`LINE_RAG=off` runs fully local) | [rag-requirements.md](rag-requirements.md) |
| Orchestrator / UI (workflow tool, chat app, CI job, script) | optional | the engine's HTTP API, [api.md](api.md) |

No component outside `line/` is required to start, drive, resume or cancel a run. Any caller that
can do HTTP (or run the CLI) can drive it.

## Architecture in one picture

```
 caller (CLI | HTTP client | workflow tool | UI)
        |  POST /api/runs {pack, target}
        v
 +-------------------- DLC engine (one process) ---------------------------+
 | server.py  ->  pipeline.py (one driver thread per run)                   |
 |   understand/        ingest + freeze pack, readers A/B, reconcile,        |
 |   understand_plus/   gaps, conflicts, human questions (opt-in)            |
 |   fgraph/            feature graph, dependency order (opt-in)             |
 |   understand/        acceptance tests: red on empty, traced, locked       |
 |   build/             planner -> unit graph -> builders (git worktrees)    |
 |                      -> verifier (server re-runs tests)                   |
 |   review/            reviewer, drift ladder, judge (opt-in)               |
 |   ship/              merge queue -> blue/green QAS deploy -> QAS x3       |
 |                      -> fixer units                                       |
 |   learn/, agents_dir.py, observe.py   learning loop, agent versions,     |
 |                      metrics (opt-in)                                     |
 | control plane: store.py (SQLite, WAL), events.py, statemachine.py,       |
 |   lease.py, watchdog.py, budget.py, reconciler.py                        |
 | ports:  llm/ (fake | cli | api)      rag/ (local | http + resilient)     |
 +--------------------------------------------------------------------------+
        |                                       |
   model provider                        RAG system (optional)
```

Design rules that hold everywhere:

- **The server decides, not the agent.** A builder's "done" counts for nothing; the verifier runs
  the tests itself, checks the diff against the unit's claims, locked tests and secret patterns.
- **Tests before code.** Acceptance tests are written from the spec only, must fail on an empty
  implementation, carry a trace tag to a spec span, and are locked by sha256.
- **Everything is an event.** Every step writes an event with a gapless sequence number into the
  local store; the board and the API are projections of the store.
- **Local first.** The SQLite store is the source of truth. A RAG system, when configured, gets a
  replica of events and records and supplies retrieval; when it is down the engine degrades per
  capability and replays later.
- **Hard money caps.** Every model call is checked against a per-call and a per-run USD cap
  before it is made.

## Current scope and limits (verified in code, 2026-10-11)

- **Target stacks: Python + `unittest`, and Node: SAP CAP, UI5 TypeScript, React** (jest / vitest /
  mocha / `npm test`), detected per target repository or forced with `LINE_STACK`
  ([stacks.md](stacks.md)). Node targets have live tests on a CAP sample but no dry end-to-end
  variant yet; browser UI tests (OPA5, wdi5) are not run.
- **QAS is a local directory** (blue/green folders + pointer). No remote QAS, no PRD, no UAT gate.
- One engine process drives a run at a time (run lease). Several runs can run in one process.
- Customising flows beyond the three standard ones and Feature Migration ([feature-migration.md](feature-migration.md)) is out of scope for this doc set.

## Files

| File | Read it when |
|---|---|
| [setup.md](setup.md) | installing the engine on a host: requirements, config, secrets, checks, service |
| [flows.md](flows.md) | running New System, Enhancement, Bug Fix: inputs, steps, outputs, done criteria |
| [feature-migration.md](feature-migration.md) | moving a customer from an old version (v1) to a rewrite (v2) feature by feature: flow 4 |
| [pipeline.md](pipeline.md) | understanding states, stages, gates, retry ladder, parking, resume, cancel, events |
| [stacks.md](stacks.md) | target stacks (Python, SAP CAP, UI5 TypeScript, React): detection, runners, adding one |
| [agents.md](agents.md) | understanding each AI role: inputs, outputs, model, prompts, guards, budget |
| [rag-requirements.md](rag-requirements.md) | connecting a RAG system: capabilities, data, wire protocol, degraded mode |
| [api.md](api.md) | calling the engine: HTTP API and CLI reference |

Code is the authority; where this doc and the code differ, the code wins. Module docstrings in
`line/` are detailed and kept current.
