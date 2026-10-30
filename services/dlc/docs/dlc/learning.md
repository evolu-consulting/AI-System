# Knowledge and learning: personas, sizing, retro

The engine's agents behave mostly by what the knowledge store (KH, or a RAG system with the same capabilities,
[rag-requirements.md](rag-requirements.md)) tells them. Code keeps the rails (gates, QAS, merge after green,
budgets, never production); the store holds how each role should judge, what each system is, and what earlier runs
taught. This page is the design of that knowledge and of how it improves from real runs.

## 1. Three layers of knowledge

| Layer | Store project | Holds | Written by |
|---|---|---|---|
| Persona | one per agent role, e.g. `agent-sizer`, `agent-retro` | how the role works: its policy rules, its findings (counted), its change history | seed, the retro, a person |
| System project | the run's project (`--rag-project`) | facts of one system: system profile, project rules that override the persona per rule, sizing cases of its runs | the engine (cases), the retro, a person |
| Shared lessons | `lesson-learned` | lessons that hold across roles and systems | distiller + eval judge, a person |

A rule is resolved per name (`sub_action`), nearer wins: the run project's own rule, then the persona's (a persona
with any rules replaces the every-project rules of that action), then every project, then the built-in fallback
(the sizer's rubric).

## 2. Sizing: two sizes, four levels

The change sizer (`change_sizer`, Sonnet) is a triage, not an analysis: it reads the request, the persona and
project rules, the nearest sizing cases (precedents, with their real outcome) and the persona's open findings; it
may grep the repository but does not crawl it. The personas are seeded into a store that lacks them
(a seed never overwrites what the store already holds). It returns (run detail `sizing`):

- **app size** (S/M/L): the system the change lands in. New system: from what the request describes (moderate by
  default). Maintenance: from the system profile in the project. App size drives blast radius: reviewer, retest
  breadth, person checkpoints.
- **requirement size** (S/M/L, XL = several releases or a PoC first): the build effort, counted in surfaces. It
  drives analysis depth and the lane.
- the **level** the two give:

| Level | Lane | When |
|---|---|---|
| 1 | `solo`, one agent, small caps, no reviewer | requirement S, no shared engine, identity or stored data |
| 2 | `solo` + `solo_reviewer` | requirement M, or S touching a shared engine / identity / data, or in an L app |
| 3 | `solo` as `solo_lead` (default; `LINE_SOLO_LEAD=0` brings back the team lanes) | requirement L/XL, every step reversible |
| 4 | as 3 + person checkpoints | irreversible or high-impact steps, or 3+ open product decisions |

A measurable non-functional target (users, latency, throughput, cost) comes back as `measure` and is logged as a
measurement the gates cannot prove (green tests do not prove it); the persona tells the sizer to expect one more
pass. A run that escalates is retried one level up (`attention.retry_payload`).

The lead may hand independent parts to subagents (research, tests of one point, a fresh review, a module with a
fixed interface) and keeps the sequential core and every integration itself; two writers never share a file.
Measured: on app-sized work the lead delegated only reviews and cost the same as solo + reviewer; the team lane was
green 1 time in 4 at 2-4 times the cost.

## 3. The calibration retro (role `retro`)

After **every** finished run, green or escalated (`pipeline._run_end`, after `sizer.record_case`):

1. **Facts, by code**: the sizer's prediction; the real footprint of the merged (or built) commit, `git show
   --numstat` without lockfiles, sized S under 500 changed lines and 12 files, M under 1500 and 30, else L; build
   rounds; reviewer misses; escalation; cost.
2. **One retro call** (Sonnet, about $0.02-0.05) with its own persona rules (`agent-retro`, action `run a retro`),
   its earlier verdicts (after its latest self-change) next to the measured size, its open and fixed self-findings,
   the sizer persona's rules and open findings. It answers right / over / under, the actual size, a case lesson,
   findings about the sizer and findings about itself, each with an optional rule change.
3. **Apply, by code**:
   - the run's sizing case (`sz_<run>`) gets `ACTUAL OUTCOME` and the lesson (what the next precedent shows);
   - findings go to the persona they are about (`kind persona-finding`, counters `seen / confirmed /
     contradicted`, the runs that showed it); an existing finding is confirmed, never repeated;
   - a finding confirmed `PROMOTE_AT` (2) times, with more confirmations than contradictions, applies its rule
     change (rewrite / add / retire) to that persona's policy, logged as `kind persona-change`;
   - protected rules are never changed by the retro: sizer `two axes`, `level`, `report`; retro `facts only`;
   - the verdict is kept (`kind retro-verdict`) for the retro's own review.

**People's decisions are the strongest signal** ([process.md](process.md), the decision ledger). The facts carry
`human_decisions` (every person's decision at this run's gates, with the personas it judged, the points the person
changed with their words, the note and the corrections asked in the gate chat), `human_signal` (counts per persona)
and `earlier_human_decisions` (the same personas' decisions in earlier runs of the project, from the store). A
`positive` decision confirms the way of working that produced it: the retro contradicts an open finding against it
and never changes a rule against it; a practice approved in several runs may become a rule through a confirmed
finding. A `negative` or `mixed` decision is a finding on the persona whose work the person corrected, with the
person's words as evidence; when earlier runs show people rejecting or correcting the same way of working, the retro
confirms the existing finding and rewrites or retires the rule that causes it, through the same two-confirmation rule.

The retro **reviews itself**: every run it audits its own rules (a rule that contradicts another rule or the
measured facts is a self-finding even when not followed) and checks its verdicts against the measured footprint.
It never judges its own output as the agent under review, and a single run never becomes a rule.

Agents still record in-task notes (`record_finding`, `save_lesson` through the agent memory tools): cheap, with the
exact error and context. The retro owns judgement calibration and persona rules; agents' notes become rules only
through counted, outcome-confirmed findings.

Off with `LINE_RETRO=0` or `LINE_AGENT_LEARN=0`. Failed runs also get the agentic root-cause retro
(`agent_memory.retro_after_failure`).

Verified (bench run 9, 2026-10-18): with one fault planted in the sizer persona and one in the retro persona, the
retro found both and rewrote both rules within the 2-confirmation rule; it also found and fixed a real flaw of its
own (judging a run whose footprint was missing).

## 4. One mechanism for every agent

Every model role learns the same way; a new agent needs no code for it:

1. **Persona in the LLM port.** Every `complete` and `agentic` call gets the role's persona text (rules, then open
   findings) in front of its prompt. A role listed in a named persona works by it (the lead works by `agent-solo`
   and `agent-lead`); any other role gets its default persona `agent-<role>` (action `work as <role>`), created in
   the store on first use with no rules, so the retro can give it some. The sizer and the retro build their own
   text. Off with `LINE_PERSONAS=0`; with no store the prompt is unchanged.
2. **Outcomes in one place** (`line.outcomes`). The ledger already lists every call of every role (calls, cost,
   outcome). An agent adds what it measured or claimed with one call,
   `outcomes.record(store, run, role, **facts)`. A claim settled only by a later run (the supervisor's hint, the
   explainer's cause) is recorded on the failed run with `judged_by_retry=True`; the retry run's retro reads it as
   `<role>@<failed run>` next to its own result.
3. **The retro judges every role** from that record: each role with its personas, each persona with its rules and
   open findings. A finding names its persona and is dropped when no agent of the run works by it.
4. **Sharding.** `LINE_RETRO_PERSONAS` (names or globs, comma-separated; empty = all) sets which personas this
   engine instance's retro looks after. With many agents, run several instances and give each its share; the
   personas live in their own store projects, so instances never write the same data.

Named personas today, seeded from the delivery history of two real systems (a small FastAPI + React app and a large
SAP landscape):

| Role | Persona (action) | What it records for the retro |
|---|---|---|
| `solo` | `agent-solo` (build a change) | rounds with gate results, first gate green, questions, decisions, QAS |
| `solo_lead` | `agent-solo` + `agent-lead` (lead a large change) | the same, at levels 3-4 |
| `solo_reviewer` | `agent-reviewer` (review a change) | misses per round, the points, passed last |
| `supervisor` | `agent-supervisor` (settle a failed run) | on the failed run: code, reason, hint, retired tests |
| `explainer` | `agent-explainer` (explain a failed run) | on the failed run: what, why, next |
| `distiller` | `agent-distiller` (distil lessons) | signals, proposed, merged, dropped |
| `eval_judge` | `agent-judge` (judge a lesson) | each decision with its cases |

The retro runs after the learning hooks, so it sees the run's distilled and judged lessons. Protected rules:
reviewer `the request only`, judge `concrete and safe`, on top of the sizer and retro ones.

Verified (2026-10-18, two runs shaped on the real translation work, one retro call each, $0.14): the first run
filed four findings in four personas (build agent, reviewer, supervisor's narrowing hint for a host failure,
explainer blaming the code); the second confirmed the explainer finding, which became an explainer rule, and
contradicted the supervisor one because its retry went green. The reviewer finding was weak (the reviewer does not
see the test runner); it stays open until a second run confirms it.

## 5. Planned

- **Second retro** (when budget allows): same capability, a different model or prompt so blind spots differ; the
  two take turns maintaining the whole cluster including each other; neither promotes its own finding, the other
  must confirm with evidence; a person still approves rules that touch level 4 or safety.
- **Team-lane personas** only if those lanes stay: test author (arbiter rulings), spec analyst (re-levels by the
  next step).
- **Late outcomes for the judge**: an approved lesson that later harms (arm statistics) as a judge finding.
- **Scoreboard** per persona: rolling exact / within-one / over / under and the cost of wrong levels, in the
  frontend.
- **Late outcomes** appended to a case: a QAS failure later, rework within 14 days, a load test, a product owner's
  rejection.
- **Seed history**: each system project's finished features (git, PRs, tickets) as sizing cases for a cold start
  (precedents with real sizes took offline accuracy from about 65% to about 89%).
