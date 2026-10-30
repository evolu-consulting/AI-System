# Test plan: processes as data (AI-SDLC)

Branch `feat/dlc-generic-sdd`. Design sources (knowledge store, project ai-sdlc): generic SDD design
`vec_d7d87a74d6df`, business intent `vec_9654008c09f6`, lifecycle `vec_d7cddd497f43`, AI is the worker
`vec_7ec8d9a17686`, needs are human work `vec_23790691f385`, knowledge belongs to the project `vec_ec66fce5e3af`,
clarify up front `vec_3bcdafc3684b`, open items awaiting data `vec_1b1fe45a64cd`.

Status: **covered** = existed before this round and has tests; **new** = built in this round and tested;
**later** = not built, with the reason.

## Requirements and their tests

| # | Requirement | Status | Tests |
|---|---|---|---|
| R1 | definitions as data; sources run > registry > target `.dlc/process` > `LINE_PROCESS_DIR` > seed; `extends` (steps by id, `remove`) | covered + new (registry, `id@n`) | `test_process.DefinitionTest.*`, `test_process_happy.test_h4_*` |
| R2 | artifacts: items / refs / cases / fields from patterns in data | covered | `ArtifactsAndChecksTest.test_items_refs_fields` |
| R3 | check mechanisms sections, coverage, in_diff, judge, count; block -> rewrite with feedback | covered + new (`count`) | `ArtifactsAndChecksTest.*`, `LivingSpecFlowTest.test_project_constitution_*` |
| R4 | gates as data: decisions, pass, revise, targets, labels | covered | `test_gates.*`, `test_process_happy.test_h6_*` |
| R5 | living spec: approved artifacts + item index in the target's `.dlc`, drift for later runs | covered | `LivingSpecFlowTest.test_artifacts_and_index_live_in_the_target` |
| R6 | a run freezes its definition; an invalid one stops the run | covered | `test_a_definition_that_cannot_run_stops_the_run`, `test_h4_*` |
| R7 | catalog lists definitions (incl. registry); web gate panel draws decisions / targets / labels from data | covered + new | `test_api_spec.*`, TypeScript build |
| R8 | solo / team lanes as definitions | later: lanes still chosen in code (sizer); next step of the same branch |
| R9 | process registry in the engine store, Admin API and page | new | `test_h1_*`, `test_h4_*`, `test_h5_*`, `test_api_spec.*` |
| R10 | process fields owner, purpose, KPI, input / output | new | `test_h1_*` (report met), `test_h8_*` (owner as handler) |
| R11 | step fields supervisor, incident, target KPI, approvers | new | `test_h6_h7_*`, `test_h8_*` |
| R12 | validation: roles are names, auto needs criteria, routes back only to earlier draft steps, judge is not the writer, needs well formed | new | `DefinitionTest.test_bad_definitions_say_what_is_wrong`, `DefinitionTest.test_business_fields_are_checked` |
| R13 | immutable versions; draft -> active -> deprecated -> retired; never deleted; replaced_by | new | `test_h4_*`, `test_h5_*` |
| R14 | runs record `<id>@<version>` | new | `test_h1_*` (gate view and index), `test_h4_*` |
| R15 | project binding per flow, latest or pinned; refused when deprecated / retired with the successor | new | `test_h4_*`, `test_h5_*` |
| R16 | impact: runs in progress per version, projects bound | new | `test_h4_*` |
| R17 | move a run parked at a gate to another version when passed steps are unchanged | new | `test_h4_*` |
| R18 | living-spec items record the process version | new | `test_h1_*` |
| R19 | send work back: same step (targets) or to an earlier draft step (routes) | covered + new (routes) | `test_gates.test_the_whole_flow_with_revisions`, `test_h6_*` |
| R20 | lanes per business domain | later: needs a fan-out of agents per spec field; the plan step runs fixed agents in parallel today |
| R21 | one implement queue per project | covered by a stricter rule: a project accepts one live run at a time (projects.resolve_run_target) |
| R22 | auto-approve: criteria (data) + precedents of the project from other runs; never self-approval; a gate a person sent back is not auto-approved; auto decisions are not precedents | new | `test_h1_h2_*`, `test_h6_*`, `PrecedentUnitTest` |
| R23 | per-step metrics and actual against target (human touches, auto rate, rounds, cost, time, mid-run stops, decisions outside the plan) | new | `test_h1_h2_*`, `test_h8_*` |
| R24 | needs as data (what, kind, owner, scope, where, required) | new | `test_h1_*`, `test_h3_*` |
| R25 | readiness at the start; missing block need parks for its owner; supply at the needs gate; warn needs told to agents | new | `test_h3_*`, `test_h1_*` (readiness API) |
| R26 | execution never asks people; open choices recorded | covered (DECISIONS: -> findings) + new (counted) | `test_gates.*`, `test_h1_*` |
| R27 | plan carries assumptions and decision rules | new (seed prompt + sections check); good content needs the data in `vec_1b1fe45a64cd` item 1 | `test_h1_*` (sections present in the sample plan) |
| R28 | the spec gate shows settled / proposed / open questions | new (seed prompt table + `count` check of open questions); data: item 2 | `ArtifactsAndChecksTest`, `test_h1_*` |
| R29 | measure design-phase quality (mid-run stops, decisions outside the plan) | new (counters); targets: item 3 | `test_h1_*`, `test_h8_*` |
| R30 | knowledge per project: precedents keyed by project and decision kind, mirrored to the project's store | new | `test_h1_h2_*` (precedent kinds, other runs only) |

## Happy cases on the sample data (`line/samples/sdd-contracts`)

The sample is a contract library (target repository) with its onboarding pack (contract types, legal rules,
planning skills, sample contracts), the project's rules (`.dlc/constitution.md`), the registry process
`contract-change` (owner, KPIs, needs with owner roles, approvers, supervisor / incident per step, auto-approve
criteria for spec and plan, a plan-gate route back to the spec) and two similar requests.

| Case | What it proves | Test |
|---|---|---|
| H1 | admin draft -> publish v1, readiness ready, bind; a run with people at every gate goes green; KPIs met; index records `contract-change@v1`; three precedents | `test_h1_h2_setup_run_with_people_then_auto_approve` |
| H2 | the second request: spec and plan auto-approved from H1's precedents; only the final review needs a person | same test |
| H3 | legal rules missing: the run waits at the needs gate (no agent ran), the legal expert supplies them, the run goes on | `test_h3_missing_need_waits_for_its_owner_at_the_start` |
| H4 | v2 published while a run waits: it keeps v1, impact shows it, it adopts v2; a pinned project keeps v1 | `test_h4_new_version_keeps_running_runs_and_can_be_adopted` |
| H5 | deprecated with a successor refuses new runs naming it; retired is read only; versions and runs stay | `test_h5_deprecate_and_retire_keep_history` |
| H6 | plan gate sends back to the spec; the Spec Agent gets the note; both gates pass again | `test_h6_h7_plan_gate_sends_back_to_spec_and_approvers_hold` |
| H7 | a person without an approver role cannot decide | same test |
| H8 | build rounds run out: the stop names the handler role; the build step misses its target | `test_h8_a_stop_names_who_handles_it` |

## To add (not yet automated)

- the needs gate through HTTP (decide + resume) and the Admin page in a browser
- a real-model run of the sample (the fake team proves the mechanics, not the quality of the agents' documents)
- R8 and R20 when they are built
