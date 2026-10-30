# KH SDLC

## Default frontend for the DLC engine (2026-10-12)

This app is also the **default frontend of the DLC engine**: Home starts the DLC flows and follows them;
the older project / plan / admin pages stay under *Classic tools*. INTERNAL notes (build and run from
source); customers receive the built package `dist/dlc-fe-<version>-win64.zip`.

- **Server (`sdlc.py`)** serves the built web app and a BFF: `/api/fe/config` (public), `/api/fe/me`,
  `/api/fe/flows` (GET; PUT for admins), and `/api/dlc/*` proxied to `<SDLC_ENGINE_URL>/api/*` with the
  caller's `Authorization` header forwarded. Standard library only (`fe_auth.py` checks RS256 Keycloak
  tokens against the realm JWKS; `fe_bff.py` holds settings, flow seed and proxy).
- **Sign-in**: with `SDLC_AUTH_ISSUER` set, the page runs OIDC Authorization Code + PKCE against Keycloak
  (public client `SDLC_AUTH_CLIENT`, default `dlc-fe`; redirect URI = the page origin + `/`), refreshes the
  token a minute before expiry, and the server rejects `/api/dlc` and classic `/api` calls without a valid
  token. Roles: `dlc-admin` -> admin, `dlc-viewer` -> viewer, else member. Plain-http origins work (a JS
  SHA-256 covers PKCE where `crypto.subtle` is missing). Unset issuer = no sign-in (dev).
- **Flows**: `python sdlc.py seed-flows [--force]` (idempotent; also runs at every start) writes
  `flows.json` in the data dir with New System, Enhancement, Bug Fix (+ Feature Migration, hidden unless
  `SDLC_ENABLE_MIGRATION=1`). Labels and descriptions are editable (PUT `/api/fe/flows/<id>`).
- **UI**: large markdown editor with preview and `.md` drag-and-drop / picker (files are concatenated into
  the spec), progress-only runs (runs are started for decide mode), Stop / Resume on Home, node strip per
  run and a flow canvas; a node click opens its session (worklog by agent + reports viewer); completed runs
  get Start app / Open app. Style: design 30 (light frosted blue glass).
- **Settings** (env, or a JSON file named by `SDLC_CONFIG`; env wins): `SDLC_ENGINE_URL`, `SDLC_AUTH_ISSUER`,
  `SDLC_AUTH_CLIENT`, `SDLC_AUTH_AUDIENCE`, `SDLC_PUBLIC_URL`, `SDLC_HOST` (0.0.0.0 allowed with sign-in on),
  `SDLC_PORT` (8795), `SDLC_DATA_DIR` (database + flows.json), `SDLC_ENABLE_MIGRATION`, `SDLC_ENGINE_TIMEOUT_S`.
- **Build the package**: `pwsh -File packaging_fe/build_fe.ps1` -> `dist/dlc-fe/dlc-fe.exe` + zip with
  `run-fe.cmd` and `fe.config.example.json`; the build fails if any `.py` source is in it.
- **Checks**: `python -m unittest discover -s tests` (incl. `test_fe_bff.py`: token checks, proxy, flows,
  sign-in on the real handler); `node --experimental-strip-types web/scripts/sha256-check.mjs`;
  `node web/scripts/smoke.mjs http://127.0.0.1:8795 [--pack <pack on engine host>] [--token <bearer>]`
  (end to end through the proxy: packs, runs, nodes, worklog, reports, pause/resume, app).

---

A KnowledgeHub tool that runs the Software Development Life Cycle with **groups of Claude CLI agents**.
Each group handles one SDLC step; a workflow chains groups in order; each feature or bug fix is one
workflow run. Agents use a memory server (KH API, address from `SDLC_MEMORY_URL`) as memory, every group
message is mirrored into its messages, and every finished step pushes its summary to the dashboard and the
worklog. With `SDLC_MEMORY_URL` unset the app runs without memory (all memory calls are no-ops).

## Run it

```
cd <repo>/Slaves/SDLC
start-sdlc.vbs                 # hidden, logs in logs\sdlc.log
# or: python sdlc.py serve      # console, http://127.0.0.1:8795
```

Open http://127.0.0.1:8795. First start creates `sdlc.db` and seeds the default agents, groups and
workflows (re-seeding never overwrites what the admin edited). Rebuild the page after UI changes:
`cd web && pnpm install && pnpm build`.

Config (environment, no defaults that point at another system):

| Variable | Meaning |
|---|---|
| `SDLC_MEMORY_URL` | memory server base URL (older name `SDLC_KH_URL`); unset = memory off |
| `SDLC_TOOLS_DIR` | tools folder with an `INDEX.md` (older name `SDLC_KH_TOOLS`); unset = no tools offered |
| `SDLC_TURN_TIMEOUT` | seconds per agent turn (1200) |
| `SDLC_E2E_FOLDER` | e2e only: scratch folder for the test project (required by `e2e/`) |

## One flow, two views

A workflow is ONE flow that combines the developer's view with the project manager's (the
29 gaps found against the PM App business, 2026-10-06):

| Workflow | Steps (PM lane in *italics*) | Rework arrows |
|---|---|---|
| New System | *Scope Sign-off* > *Setup & Plan* > Spec (approval) > Design > Implementation > Code Review > Testing > *UAT Acceptance* > *Release & Close* | Review, Testing, UAT > Implementation |
| New Feature | same without Design | same |
| Bug Fix | *Bug Intake & Triage* > Code Reading > Bug Fix > Code Review > Testing > *Release & Close* | Review, Testing > Bug Fix |

Around every step the PM governance (`gov.py`) runs:

- **Scope**: the intake's STEP_DONE carries scope items S1.. with acceptance; Testing must trace every
  item to a passing test or the work goes back.
- **Approvals**: a group with *approval* parks the run until a lead Approves or Rejects (Reject can
  send the work back along the rework arrow). A forced summary always needs approval.
- **Quality gates**: groups with *verify tests* make the server run the project's test command itself;
  a failure is a fail verdict whatever the agent claimed (and files an issue if it claimed a pass).
  A fail verdict re-does the steps from the rework target, at most `maxRework` times, then fails.
- **Registers (RAIDEC + defects + lessons)**: decisions, risks, actions, issues, defects and lessons in
  STEP_DONE become register items (risk category from probability x impact, a person owns it, a
  mitigation is mandatory; decisions stay *proposed* until approved). Lessons go into every new run's prompt.
- **Change requests**: raised from the chat; the agents assess impact; a lead approves in Governance,
  which adds a scope item and can re-run from an earlier step.
- **Frozen process**: a run copies the workflow version, groups and agents at start; admin edits only
  change new runs. Workflows are versioned; deletes are soft; every API change is in the audit trail.
- **Waiting never blocks**: a step waiting for a person parks its run and the project's next runnable
  run (priority, dependencies) goes on. The reminder ladder (settings, default 60/240/1440 min) nudges
  the run owner, tells the project owner, then escalates.
- **Health**: R/A/G per run and project from failures, waiting time, due time (estimate + 50%),
  earned vs burn against the budget, open escalations and category-1 risks. Budgets pause runs.
- **Reports**: Feature Report, weekly/monthly Status Report (internal or client), Portfolio page,
  notifications bell (and a KH message to the person's e-mail), daily digest.
- **Users**: no users = open mode (everyone admin). `python sdlc.py user NAME --role admin` (or
  Admin > Users) switches to token sign-in with roles viewer < member < lead < admin.

### Plan, sign-offs, environments (from the PM Works deck and the Centrica schedule)

- **Plan** (`#/plan/<project>`, `plan.py`): the PM's WBS schedule. Phases, tasks, milestones on working
  days minus the project's blackout ranges; FS / SS / FF dependencies with lag; roll-ups; baseline vs
  current (slip); expected % vs % complete; health blue / green / yellow / red; critical path; client,
  Laidon and agent tasks (agent tasks follow a run by themselves); invoice milestones; a Gantt column.
  "Phase from template" adds the SimpleMDG implementation phase (Preparation .. Hypercare) with one
  sub-task per stream; a second phase can skip Preparation and start after the first. Client tasks
  past due remind the project's client contact; completed invoice milestones remind the owner.
- **Titled sign-offs**: a step lists the titles that must ALL sign (Blueprint: business lead; SIT, UAT,
  Hypercare: business lead + PMO; Go/No-Go: business lead + PMO + project manager). Users carry titles
  (Admin > Users); a title nobody holds may be signed by any lead. Change requests are signed in the
  order of `crApprovers` (steering committee, then client) and then re-run from the blueprint step.
- **Re-opening signed-off work** (rerun or change) files an issue and moves the due time by the
  re-done estimate.
- **Environments**: a step with an environment records the build as promoted (DEV, QAS, PRD) when it
  closes; the project card shows what runs where.
- **Full Delivery workflow**: Scope Sign-off (SOW areas A1..) > Setup & Plan > Blueprint (feature list
  F1.., business lead signs) > Design > Implementation (DEV) > Code Review > Testing > SIT (QAS) > UAT >
  Cutover & Go/No-Go > Go Live (PRD) > Hypercare > Release & Close.
- **SoX evidence**: `/api/audit.csv` exports every change and sign-off.

## What is where

| Screen | URL | What it does |
|---|---|---|
| Projects | `#/` | One card per project: health, counts, open register items, spend vs budget, Feature/Status report, Governance, settings, **New**. Runs show PM/DEV lanes, attempts, priority, owner, due; leads can pause, resume, cancel. |
| New Project | button on Projects | Name, folder, template or duplicate of a project, process, owner, budget, test command, priority, due. |
| Step chat | `#/runs/<id>/steps/<n>` | Left: health, steps, scope trace, the run's registers, attachments. Right: the conversation; Approve/Reject, Continue, Retry, Re-run from here; the server's test run; attach files, raise a change request, pull a Jira issue. |
| Governance | `#/governance/<project>/<kind>` | The registers: approve decisions, decide changes (with re-run), edit owners/mitigations, start a bug fix from a defect, lessons across projects. |
| Portfolio | `#/portfolio` | Every project, worst health first. |
| Admin | `#/admin/...` | Agents, steps (lane, role, approval, verify tests, estimate), processes (next and rework arrows, versions), templates, users, settings, audit trail. |
| Feature Report | `/api/projects/<id>/report` | Every run and step with verdicts, server test runs, scope trace, registers, cost. |
| Status Report | `/api/projects/<id>/status?days=7&audience=client` | The PM's one-pager drafted from the data. |

## How a step runs (engine.py)

- One worker thread per project runs that project's runs one after another (they share one code folder).
- A step is a group conversation **mediated by the server**: agents take turns in group order; the first agent leads and is the only one that can close the step with `STEP_DONE` + a JSON summary.
- Each turn is one `claude -p --output-format stream-json --verbose` call (prompt on stdin, `--resume` of that agent's session in this step, `--add-dir <project folder>`, cwd = the group's workspace). The prompt says **KH AUTO**, carries the group goal, the summaries of earlier steps (output of step N = input of step N+1), recent KH worklog of the project, the allowed KH tools and the KH protocol.
- Human-gated steps never close on their opening turn; they wait for the user. Ungated steps run `max_rounds` rounds, then the lead gets a final wrap-up turn; if it still does not close, the summary is forced from its last reply (shown as "summary forced").
- On finish: summary to SQLite (dashboard), KH worklog (`project=sdlc-<slug>`, `subject=topic=<feature slug>`, text keyed `project= feature= task=`), and for automatic steps a KH knowledge row.

**Why the server relays messages instead of agents calling kh-message themselves:** on local KH every
Claude session is the same identity (default login), so a sender never receives its own broadcast and
an inbox read consumes for everyone. The server owns the transcript and mirrors each line into
kh-message with the agent name in the content.

**KH hooks:** agents default to `--setting-sources project` (fast, no interactive kernel questions) with
the KH protocol written into the prompt. Remove that argument on an agent to run it with your Claude
profile's full KH hooks.

## Token and cost tracking

- Agent turns call `claude -p --output-format stream-json --verbose`. `llm.UsageMeter` reads each
  assistant event's usage while the turn runs. The CLI repeats an event's usage once per content
  block, so the meter counts each message id once. It prices the running total from `pricing.json`.
- Every CLI call is one `llm_call` row, including retries, which also cost tokens. The row is
  rewritten (never added to) on each event. The final `result` event replaces the estimate with
  the CLI's own `modelUsage` and `total_cost_usd` and sets `final=1`.
- `GET /api/usage?projects=a,b` returns totals per project and per run. Home fetches it for the
  projects on screen every 30 s. The total shows on each project card ("Spent") and on each run
  row. Hover a figure for the breakdown: input, output, cache write, cache read.
- Tokens = input + output + cache write + cache read. Money is USD at each model's list price.
  To add a model or change a price, edit `pricing.json`; no code change is needed.
- Runs from before 2026-10-06 show 0 because their usage was never recorded.
- Tests: `python -m unittest discover -s tests` (tests/test_flow.py drives the whole PM + dev flow with scripted agents).

## Files

`sdlc.py` routes, roles, audit, static, CLI · `db.py` store, frozen processes, rework insertion · `schema.sql` · `engine.py` workers, turn loop, step gates · `gov.py` PM governance (registers, scope, verification, health, ladder, users, sign-offs, notifications) · `plan.py` WBS schedule ·
`prompts.py` prompt text · `llm.py` provider catalogue, CLI call (trimmed from RITA/llm.py) and usage meter ·
`pricing.json` model prices · `tests/` unit tests ·
`kh.py` KH client (best effort, never blocks a run) · `toolbox.py` KH tools catalogue (from RITA) ·
`report.py` Feature Report · `seed.py` defaults · `web/` React + Tailwind + @xyflow/react (only
`web/src/canvas` imports xyflow) · `e2e/` the three scenarios.

## End-to-end test

`python e2e/run_e2e.py s1|s2|s3|all` against a running server, on the folder in `SDLC_E2E_FOLDER`:
s1 New System (CLI todo app), s2 New Feature (priority + list filters), s3 Bug Fix (an injected
inverted `--status` filter, ticket BUG-1). Each answers step 1 as the user, waits for the run to
finish, then runs the project's tests independently.
