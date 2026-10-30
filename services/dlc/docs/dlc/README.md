# AI DLC engine: integration and operations docs

The AI DLC engine (the `dlc` application; internal name: the *line*) turns a written spec into
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

Nothing besides the delivered `dlc` application (plus git and the model provider) is required to start,
drive, resume or cancel a run. Any caller that can do HTTP (or run the `dlc` command) can drive it.

## Architecture in one picture

```
 caller (dlc CLI | HTTP client | workflow tool | your frontend's backend)
        |  POST /api/runs {pack, target}
        v
 +-------------------- DLC engine (one process: `dlc serve`) --------------+
 | HTTP API + board  ->  run driver (one thread per run)                    |
 |   understand    ingest + freeze the spec pack, two independent readers,  |
 |                 reconcile; gaps, conflicts, human questions (opt-in)     |
 |   feature graph dependency order of features (opt-in)                    |
 |   tests first   acceptance tests: red on empty, traced, locked           |
 |   build         planner -> unit graph -> builders (git worktrees)        |
 |                 -> verifier (the engine re-runs the tests itself)        |
 |   review        reviewer, drift ladder, judge (opt-in)                   |
 |   ship          merge queue -> blue/green QAS deploy -> QAS x3 -> fixers |
 |   learn         learning loop, agent versions, metrics (opt-in)          |
 | control plane:  local store (SQLite, WAL), events, state machine,        |
 |                 leases, watchdog, budget, reconciler                     |
 | ports:          model (fake | cli | api)   RAG (local | http)           |
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
| [setup.md](setup.md) | installing the delivered package on a host: requirements, config, secrets, self-check, service |
| [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md) | connecting your own frontend to the engine (written for a coding agent): journeys, requests, smoke tests |
| [CUSTOMER-HANDOVER.md](CUSTOMER-HANDOVER.md) | handover sheet: addresses, sign-in clients, roles, how the system works for the customer |
| [flows.md](flows.md) | running New System, Enhancement, Bug Fix: inputs, steps, outputs, done criteria |
| [process.md](process.md) | processes as data: definitions, checks, the project's rules, the living spec in `.dlc` |
| [unified-flow.html](unified-flow.html) | seeing every flow as one branching workflow (0.3.3, default config, real model); open it in a browser, hover a step for what it does and an example (Vietnamese) |
| [feature-migration.md](feature-migration.md) | moving a customer from an old version (v1) to a rewrite (v2) feature by feature: flow 4 |
| [pipeline.md](pipeline.md) | understanding states, stages, gates, retry ladder, parking, resume, cancel, events |
| [stacks.md](stacks.md) | target stacks (Python, SAP CAP, UI5 TypeScript, React): detection, runners, adding one |
| [agents.md](agents.md) | understanding each AI role: inputs, outputs, model, prompts, guards, budget |
| [learning.md](learning.md) | how agents learn: knowledge layers and personas, two-size sizing and levels, the calibration retro after every run |
| [rag-requirements.md](rag-requirements.md) | connecting a RAG system: capabilities, data, wire protocol, degraded mode |
| [api.md](api.md) | calling the engine: HTTP API (OpenAPI at `GET /api/openapi.json`) and `dlc` command reference |

The machine-readable contract of the HTTP API is `GET /api/openapi.json` on a running engine; it is generated
from the same table the server routes by, so it always matches the installed version.
