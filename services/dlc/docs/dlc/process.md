# Processes as data (spec-driven runs)

A gated run (Enhancement and Bug Fix by default) follows a **process definition**: a JSON document that says which
steps the run has, which agents write which documents, which checks run on them, and where a person decides.
DLC's engine holds no step, role, prompt, gate or rule of its own; it keeps only the mechanisms (worktrees, locked
tests, the QAS slot, budgets, merge, delivery) and runs whatever definition applies.

The built-in definition `gated-change` is the flow in [flows.md](flows.md) (Spec Agent, spec gate, implement plan
and test plan in parallel, plan gate, build / deploy / test rounds, final review).

## Who does what in an AI-SDLC process

A process is an organisation's own process, trimmed to what AI agents can do (analysis and implementation; meeting
customers, signing and staffing stay outside). AI agents do the work of every step. People:

1. **supply what the agents need** before they start (the process's *needs*); without it an agent guesses
2. **decide at gates**: as few as possible, and only at the start (spec, plans) and at the end (review)
3. **handle a stop**: the role named by the step (`incident`), else the process owner
4. **teach the system**: every decision a person takes is a precedent of the project; the next similar case may be
   auto-approved

Clarification happens up front: the design phase (spec and plan gates) settles every question and the plan carries
its assumptions and decision rules, so execution never stops to ask; agents record the choices they took that the
plan left open, and the final review shows them.

What agents learn belongs to the **project**, not to the process: the same process in two projects learns different
things, and changing or retiring a process loses none of it. Lessons that hold for many projects belong in the
shared lessons store.

## The process registry (Admin > AI-SDLC processes)

An organisation's processes live in the engine's registry and are edited from Admin. Each process has:

- **versions**: a published version never changes; publishing a draft makes the next version (with who, when,
  why and what changed)
- **status**: `draft` -> `active` -> `deprecated` (no new runs; running ones finish) -> `retired` (read only);
  nothing is deleted. A deprecated or retired process may name its successor (`replaced_by`)
- **impact**: runs in progress per version and the projects bound to it, shown before a change

A run freezes the version it started on and keeps it to the end. An admin may move a run that waits at a gate to
another version when every step it already went through is unchanged there (Impact > move to another version).

A **project binds** to a process per flow: `<id>` (the latest active version when each run starts) or `<id>@<n>`
(pinned). A run of a project bound to a deprecated or retired process is refused, naming the successor.

| API (admin role) | What it does |
|---|---|
| `GET /api/admin/processes` | the registry |
| `POST /api/admin/processes` | save a draft (the body is a definition; a new id creates the process) |
| `GET /api/admin/processes/{id}` | versions, history, draft, impact |
| `POST /api/admin/processes/{id}:publish` | `{"reason"}` the draft becomes the next version |
| `POST /api/admin/processes/{id}:status` | `{"status", "reason", "replaced_by"}` |
| `GET /api/admin/processes/{id}/readiness?project=` | the process's needs checked against a project now |
| `POST /api/admin/projects/{project}/processes` | `{"flow", "process"}` bind (empty process = unbind) |
| `POST /api/admin/runs/{run}:adopt-process` | `{"process": "<id>@<n>"}` |

The sample *sdd-contracts* shipped with DLC (a contract app, its onboarding documents, a process with needs, approvers,
auto-approve and routes, two requests) shows a complete setup.

## Where a definition comes from

First found wins, per id:

| Source | Where | Use it for |
|---|---|---|
| the run | `process` in `POST /api/runs`: an id, `<id>@<n>`, or a whole definition | one run that needs something different |
| the registry | active processes (latest version, or the version a project is pinned to) | an organisation's processes |
| the project | `.dlc/process/<id>.json` and `.dlc/prompts/<name>.md` on the project's `main` branch | a project's own process, versioned with its code |
| the engine | `LINE_PROCESS_DIR`: `<dir>/<id>.json`, `<dir>/prompts/<name>.md` | every project on this engine |
| built in | the seed shipped with DLC | the defaults |

A run picks the first definition whose `applies.flows` lists its flow (and `applies.levels` its level, when given),
unless it names one. The definition and every prompt it uses are **frozen on the run** when it starts: a change to a
definition applies to the next run, never half-way through one.

`GET /api/catalog` lists the definitions the engine sees (`definitions`), with their steps, gates, roles and checks;
a definition that cannot run is listed with its error.

## Change one thing, keep the rest

A definition may extend another and give only what changes. Objects merge key by key; `steps` merge by `id`
(`{"id": "plan", "remove": true}` drops a step); other lists are replaced. A project file with the same id as the
built-in one extends the built-in one:

```json
{
  "id": "gated-change",
  "extends": "gated-change",
  "steps": [
    {"id": "plan", "gate": {"decisions": ["approve", "revise", "reject"]}},
    {"id": "spec", "checks": [{"check": "sections", "artifact": "spec", "severity": "block",
                                "sections": ["Summary", "Spec", "Questions", "Rollback"]}]}
  ]
}
```

A project that wants New System runs gated adds its flow:
`{"id": "gated-change", "extends": "gated-change", "applies": {"flows": ["enhancement", "bug-fix", "new-system"]}}`.

## What a definition holds

- **artifacts**: the documents agents write. Per artifact: `title`, `head` (the heading it starts at), `items` (a
  pattern for the ids it defines, e.g. `F1`), `refs` (a pattern for the ids it refers to), `cases` (other ids later
  steps look for, e.g. test case ids), `fields` (values other prompts use, e.g. the spec's domains as
  `{spec_domains}`).
- **steps**, of three kinds:
  - `draft`: `agents` (each: `artifact`, `role`, `prompt`, optional `max_turns` / `usd`), `checks`, and a `gate`.
    The agents of a step run in parallel on a read-only checkout of `main`.
  - `build`: the build agent implements the approved work in up to `gate_rounds` rounds (suite in the worktree, then
    a clean QAS export). `brief` and `round` name its prompts; `persist` puts the approved documents into the change
    (see below).
  - `review`: findings and the step's checks on the change, then the final gate. A decision listed in
    `gate.deliver` delivers.
- **gate**: `name`, `step` (shown), `title`, `decisions`, `pass` (decisions that let the run go on), `revise`
  (decisions that send documents back), `targets` (which documents a send-back redoes, e.g.
  `{"impl": ["impl"], "both": ["impl", "tests"]}`), `default_target`, `show` (documents shown: artifact names and
  `@checks`, `@drift`, `@rounds`, `@findings`), labels for the person (`decision_labels`, `target_labels`,
  `note_label`, `note_placeholder`). The web app draws the gate from this data.
- **prompts**: templates with `{name}` placeholders: `{request}`, `{flow}`, `{run}`, `{wt}`, `{look}`,
  `{tests_in_repo}`, `{additions}` (a person's notes and files for this document), `{drift}`, every artifact by name
  and its fields as `{<artifact>_<field>}`. An unknown name renders empty; `{{` and `}}` are literal braces.
- `retries`: how many times a document goes back to its agent when a check blocks it (default 1).

## Checks

The engine knows how to check; the definition says what must hold.

| Check | Parameters | Finds |
|---|---|---|
| `sections` | `artifact`, `sections` | headings the document lacks |
| `coverage` | `from`, `to` | items `from` defines that a `to` document never refers to (e.g. an F-item no plan covers) |
| `in_diff` | `artifact`, `pattern_from`, `paths` | ids the document defines that the change never mentions (e.g. a test case with no test) |
| `judge` | `artifact`, optional `rules` | breaks of the project's own rules, judged by a separate agent that sees only the rules and the document |

Each finding is `block` or `warn`. A `block` sends the document back to its agent with the findings (`retries`
times); whatever is left, and every `warn`, is shown at the gate under **Checks** and recorded on the run.

### The project's rules (constitution)

`judge` reads the rules from `judge.rules` of the definition: `files` (paths in the project's repository, default
`.dlc/constitution.md`) and / or `store.query` (what the knowledge store answers for that query). With no rules it does
not run and costs nothing. The rules are the project's data: DLC ships none.

## The living spec

The build step's `persist` puts the approved documents into the change, so they are reviewed, merged and versioned
with the code they describe:

- `.dlc/changes/<run>/<artifact>.md`: every artifact in `persist.artifacts`, as approved
- `.dlc/index.json`: per item (`<run>:<id>`) its title, the documents that refer to it and the files the change
  touched for it (a line of a `persist.links_from` document that names the item and a changed file links them)

When a later run starts, DLC compares the index with `main`: an item whose files were changed by a commit that is
not its own run's is **drift**. The Spec Agent gets the list in `{drift}` and the spec gate shows it, so the new spec
says whether each earlier item still holds, changes or is replaced.

## The change queue: many runs, one repository

People may start many Enhancement and Bug Fix runs on one project at the same time. Their design steps (spec,
implement plan, test plan) go on in parallel: nothing in the repository changes there. A run **joins the queue
when its drafts are approved** (first approved, first served), not when it starts: a run still in design is in
nobody's way, nobody waits for it and nothing is ignored. From the queue's serial step on (the build by default),
implement, test, merge, QAS and delivery go **one run of the project at a time, in queue order**, so no two runs
ever change the repository together and no merge conflict between runs has to be solved.

What the agents see: the Spec Agent, the Domain Agents and the QC Agent get the changes that joined the queue
before their run (each with its request and its approved spec, plan and test plan) and design for the system as
it will be after them: they reuse what an earlier change adds instead of building it twice, and test what an
earlier change moves where it will be. The queue is also written to the project's knowledge store, so
`step_context` finds it.

**Drafts written again when the queue moves.** Every draft remembers the queue it was written on (its
fingerprint: the runs that had joined and what they had pushed). When another run joins the queue, or one leaves it
unfinished, every run of the project that waits at a draft gate is woken; the agents of each draft whose queue
moved write it again (they get the queue as it is now, what changed and their earlier draft, and keep what still
holds and every point a person settled), the gate closes while they work and opens again for the same round, with
a note "written again on top of the change queue" naming the runs it took in. A run that finished (merged) does not
move the queue: its change is in main. A person's decision already taken is never redone.

The process decides how it queues, in its definition (Admin > AI-SDLC processes):

```json
"queue": {"enabled": true, "serial_from": "build", "hold_until": "end", "refresh_drafts": true}
```

- `enabled`: runs of the process share their project and take a place in its queue (false: a run owns the project
  alone, a second one is refused);
- `serial_from`: the first step (its id, or a step kind) that waits its turn; it and every later step run one run
  of the project at a time;
- `hold_until`: `end` holds the place until the run ends, final review included; `merged` lets it go once the build
  is merged into main, so the next run builds while this one waits for its final review;
- `refresh_drafts`: write waiting drafts again when the queue moves (above).

Slot states: `reserved` (in design, not in the queue yet), `planned` (approved, waits its turn), `implementing`
(its turn: building, testing, merging, delivering), then `done`, `dropped` (the run stopped or is run again) or
`ignored` (only slots of an engine before 0.7). The run's step shows **queued** while it waits its turn, and
**awaiting** (orange) while a gate waits for a person.

## Gates: what a person reads and decides

Every draft document starts with **At a glance** (what the agent understood, what it will do, what it will NOT do)
and the gate shows that first, the full documents one click away. The points the agent decided alone (the spec's
proposed and open questions, the plan's numbered assumptions; the artifact's `glance` and `asks` in the definition)
are listed under **Decisions for you**: each is agreed or changed, an open one needs the person's words, and the
gate passes only when every point has an answer. The answers go with the decision (`answers` in the API) into the
note the next agents read. The Spec Agent never narrows the request on its own: a part of a named reference it
would leave out is written under "Will not do" and as an open question.

A gate whose definition says `"chat": true` (the seed: spec and plan) is a **chat with the step's agents**: the
summary is their first message, the person asks or asks for changes, the agent answers from its documents, the
request and the code and changes its documents in place (same round), and the decision is taken inside the chat
(`POST /api/runs/{id}/gates/{gate}/chat`, engine `line.gatechat`).

## The decision ledger: every choice a person makes is kept

Every decision at a gate (engine `line.decisions`) is written when it is taken, in three places:

- **disk**, in the run's pack folder `history/`: `decisions.jsonl` (one entry per decision: gate, round, decision,
  who, when, the note, the files, each point the agents decided alone with the person's answer, agreed or changed with
  their words, the gate chat of that round, and the signal), `history.md` (the same for people) and
  `<gate>-r<round>-<artifact>.md` (each document exactly as the person saw it when deciding: the spec's history of
  what was sent back and what was approved). The build step copies `history.md` into the change as
  `.dlc/changes/<run>/decisions.md`, next to the approved documents. The final review comes after the merge: once it
  is decided, the history with the final decision goes onto `main` as one commit (`line <run>: decisions at the
  gates`) before the Deliver step pushes. While another run of the repository builds on `main` (a `line/<run>/solo`
  branch exists), that commit would make its merge fail, so it waits: the next run's change brings every earlier
  history that is behind up to date. The run detail says which happened (`gated.history_commit`).
- **the project's knowledge store**: one row per person's decision (kind `gate-decision`, id
  `gd_<run>_<gate>_r<round>`) with the same content, written at the decision (on a thread: the click never waits for
  the store) and again at run end (same ids, so a store that was down then gets them). The answer of
  `POST /api/runs/{id}/gates/{gate}` says where it was recorded (`recorded: {disk, store}`).
- **the retro** (below and [learning.md](learning.md)). A run cancelled while it waits at a gate still gets it: the
  cancel writes its decisions to the store and runs the retro on them, even before the run was sized.

The run page shows the history (**Decisions at the gates**): each decision with its signal, the points with the
person's answers, the note, the chat, and each document as the person saw it (`GET /api/runs/{id}/decisions`,
`?doc=<path>` for a document).

Each decision carries a **signal** for the agents whose work it decided on (the agents of the draft step; the build
agent for the final review): `positive` = approved as the agents proposed, every point agreed; `mixed` = approved
only after the person changed points or had the agents correct their documents in the chat; `negative` = sent back,
or held at the final review. An automatic decision is kept on disk but is never a signal and never a precedent.

## Needs: what people supply before the agents start

```json
"needs": [{"id": "legal-rules", "what": "Legal rules for contract fields", "kind": "business",
           "owner": "legal-expert", "scope": "project", "where": {"repo": "docs/business/legal-rules.md"},
           "required": "block"}]
```

A process and each step list their needs. `where` says how DLC sees that a need is there: `repo` (a non-empty
path on the project's main branch), `pack` (a file of the request), `store.query` (the project's knowledge store
answers it with at least `min_chars`), or nothing (only what a person supplies). `scope` `project` is prepared
once and reused (the project's onboarding pack); `run` comes with each request.

Needs are checked when a run **starts**, never in the middle. A missing `block` need holds the run at the **needs**
gate, which names the owner roles; the owner supplies it there (a note or files) and the run goes on. A missing
`warn` need is told to every agent, which marks what it had to assume. Admin > Readiness checks a project before
any run.

## Gates: approvers, auto-approve, routes back

```json
"gate": {"approvers": ["dlc-user"],
         "decisions": ["approve", "revise", "back-to-spec"], "revise": ["revise", "back-to-spec"],
         "routes": {"back-to-spec": {"back_to": "spec"}},
         "auto": {"kind": "spec-signoff", "min_precedents": 1, "criteria": "Simple: only adds a field ..."}}
```

- `approvers`: the roles (sign-in roles) that may decide; with sign-in off anyone may
- `routes`: a send-back decision that returns the work to an earlier draft step; every gate from there on passes
  again and the agents of that step get the person's note (not across the build step)
- `auto`: before parking, an agent checks whether the case is simple by `criteria` (the business's own words) and
  whether people of **this project** approved at least `min_precedents` cases of this `kind` in other runs; both ->
  the run goes on with a logged automatic decision. A gate a person sent work back to in this run is never
  auto-approved, and an automatic decision is never a precedent

## Who supervises, who handles a stop, targets

- process: `owner` (accountable role), `purpose`, `input`, `output`, `kpi`
- step: `supervisor`, `incident` (the role a stop at this step goes to; the run's attention panel names it, else the
  owner), `target.kpi`

Targets are `max_<counter>` (or `max_minutes`): counters per step are `agent_usd` (`max_usd`), `agent_calls`,
`drafts`, `human_decisions`, `auto_decisions`, `revisions`, `rounds`, `decisions_outside_plan`, `mid_run_stops`, and
`work_ms` + `wait_ms` for `max_minutes`. The final gate shows **Actual against target** per step and for the
process; the result goes to the retro.

## Defaults of the built-in definition

- checks: the spec's and both plans' sections, F-item coverage by both plans, test case ids in the change's test
  files: all `warn`; `judge` on the spec and the implement plan when the project has rules
- `persist`: spec, implement plan and test plan into `.dlc`, items from the spec, links from the implement plan
