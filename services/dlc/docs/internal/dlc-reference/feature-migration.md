> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `feature-migration.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# Flow 4: Feature Migration (v1 -> v2 feature parity)

A rewrite (v2) has the same business features as the old product (v1) but different code, structure and
technology. A customer on v1, often with features custom-built for them, wants to move to v2. Porting the code
does not work: the two code bases share nothing. What has to move is **behaviour**: every feature the
customer uses on v1 must exist and work on v2, and nothing v2 already does may break.

This flow does that as a feature-level migration, not a code-level one. It is the fourth standard flow next
to New System, Enhancement and Bug Fix (see [flows.md](flows.md)).

## 1. Inputs

| Field | Required | Meaning |
|---|---|---|
| `v1` | yes | the v1 code, read only: a git repository, **or a folder of git repositories** (an *estate*, section 2.3) |
| `v1_repos` | no | repository list file for an estate (JSON or one `path [ref]` per line); overrides detection |
| `v1_ref` | no | commit / branch / tag of v1 to read (default: its working tree). Estate: used in every repository that has it, the others are read at HEAD |
| `v1_base` | no | ref of the **vanilla** v1 the customer started from. A v1 feature with no trace in `v1_base` is flagged **custom** (built for this customer). Estate: a repository without that ref counts as entirely custom |
| `v2` | yes | the v2 git repository = the **target**; branch `main` checked out, clean. A folder of repositories is accepted for **analysis** (ends `analysed`, code `TARGET_ESTATE`) |
| `v2_repos` | no | repository list file for a v2 estate |
| `v2_ref` | no | expected commit of v2 `main` (refused when HEAD differs) |
| `notes` | no | a `.md` file of customer notes (what they use, what they changed, what must not change) |
| `mode` | no | `ask` (default): conflicts wait for a person before any change. `decide`: v2 wins every conflict, with backup and log |
| `scope` | no | list of words / path prefixes; only matching features are migrated (everything is still inventoried) |
| `build` | no | `true` (default). `false` stops after the analysis and the report |
| `max_usd` | no | budget of the migration's own model calls (default `LINE_MIGRATE_MAX_USD`, 50). See section 4.1 |
| `max_usd_repo` | no | budget of one repository's scan (default `LINE_MIGRATE_MAX_USD_REPO`, 3) |

## 2. Stages

```
admitted -> inventoried -> matched -> [parked] -> decided -> building -> verifying -> green
                                                  \-> analysed (build=false, the stack cannot be built,
                                                               or v2 is several repositories)
any stage -> escalated {code}
```

| # | Step | What happens | Artefact |
|---|---|---|---|
| 0 | **Extract** | Per-stack **extractors** (section 2.1) read each tree with code, no model: modules (normalised names), services, entities and views, screens (by basename), handlers, the source identifier set, names that appear only in strings, names that appear only in config / generator catalogues, test fixtures (excluded). A deterministic surface comparison applies the method rules (section 2.2). | `facts-v1.json`, `facts-v2.json`, `surface.json` |
| 1 | **Inventory** | One model reads each tree (code, tests, schema, UI, config, jobs, interfaces, roles) in chunks and lists its features. It gets the extractor facts as a checklist and groups features into business **areas**; a master-data object with its tables is one `data` feature, a check on a shared path (approval or e-signature gate, required-field guard) is a `guard`. Every feature carries literal evidence quotes `{path, quote}`, the identifiers that implement it, the entities / interfaces it touches, its tests and examples of its behaviour. Code checks every quote against the file; a feature with no verified quote is **unproven** and listed, never migrated. | `inventory-v1.json`, `inventory-v2.json` |
| 2 | **Match** | A model pairs v1 features with v2 features by **behaviour**, not by name, with both sides' handlers / hooks / actions from the extractors in front of it: `same`, `conflict` (both have it, behaviour differs: another rule, validation, status flow, a gate on one side only) or no partner. It also lists **open decisions** the code cannot settle (which target API, whether a legacy module is in scope), each with options and a recommendation. | `match.json` |
| 3 | **Confirmation pass** | Raw differences between two scans overstate gaps (renamed things, moved paths, generated or config-only names). Every one-sided feature is re-checked. First by rule, no model: a **rename** (same rename key, e.g. `IntegrationProcessService` = `IntegrationService`) pairs it; a name the other tree has **only in a config / generator catalogue** is *absent, planned not built*; a name the other tree has **only inside strings** (a destination, a label) is *absent*. Otherwise its identifiers are searched in the other tree (source files only, never `.json` config, never test fixtures). A hit sends the feature and the hits to a second model call that decides *present (as feature X)* or *absent*. Only confirmed gaps stay one-sided. | `confirm.json` |
| 4 | **Parity matrix** | Each row: class (`v1_only`, `v2_only`, `both_same`, `both_conflict`), `custom` flag (absent from `v1_base`), confidence, evidence on both sides, action. | `matrix.json`, `matrix.md` |
| 5 | **Conflicts** | Open decisions from step 2 are asked first, like conflicts (`decide` mode takes the recommended option and logs it). Every `both_conflict` row becomes a conflict record with both behaviours and their quotes. Default choice: **v2** (the new version is the better base). `ask`: the migration **parks** before any change and lists the conflicts for a person to choose (`v2` or `v1`). `decide`: v2 is chosen, the v1 behaviour is written to a backup file and every decision goes to the decision log. | `conflicts.json`, `decisions.jsonl`, `backup/` |
| 6 | **Blast radius** | For each change (ported v1 feature, conflict decided for v1): the v2 features that share an entity or interface with it, plus the v2 modules that import the files it touches (import graph, Python), are **at risk**. The protected set is every `v2_only` and `both_same` feature; its tests are the regression guard. **Gates**: protected v2 rules / guards on an action or entity a change also uses; the migrated feature must pass through them, and they are written into its spec. **Merges**: a ported data object whose entities already exist in v2 is merged into live data (high blast radius). Each change gets a level high / medium / low. | `blast.json` |
| 6b | **Effort hints** | Per area and per change: features to port / protect, conflicts, entities (tables), services, screens, handlers, v2 tests guarding, high-blast changes. Counts, not hours: a plan converts them with its own rates. | `effort.json` |
| 7 | **Baseline** | The full v2 test suite runs before anything changes; every test and its result is recorded. | `baseline.json` |
| 8 | **Spec and build** | The changes become a spec pack (`spec.md`): one F-item per ported feature (behaviour and examples taken from the v1 evidence, which act as characterization criteria), plus one F-item per conflict decided for v1. Ordered by dependency (shared entities first). The standard pipeline then runs it as an **enhancement** of the v2 target: acceptance tests from the spec, units, review, merge queue, QAS. | `pack/spec.md`, child run id |
| 9 | **Verify** | The full v2 suite runs again. A test that passed in the baseline and fails now is a **parity regression** (`PARITY_REGRESSION`), unless a recorded decision superseded the behaviour it checks. | `verify.json` |
| 10 | **Report** | Matrix, decisions (who, when, backup), at-risk features and their test results, what was built, what was only analysed, how to roll back (v2 `main` before the run = `base_sha` of the child run). | `report.md` |

All artefacts live in `<LINE_WORKROOT>/migrations/<id>/`.

### 2.1 Extractors (one per stack)

The inventory needs facts it can trust on a real product, and they differ per stack. An extractor is a
small class in `line/migrate/extract.py`:

```
name: str
detect(tree) -> bool                    # does this stack appear in the tree?
extract(tree, facts) -> None            # fills the shared facts dict
```

Every extractor whose `detect` is true runs; their facts merge. Registered today:

| Extractor | Reads | Facts |
|---|---|---|
| `generic` | every text file | modules (top-level folders, normalised), source identifier set (comments and strings removed), names only inside strings, names only in `.json` / `.yaml` (catalogue), Python handlers, test fixtures |
| `cap-cds-ui5` | `.cds`, `.csn`, `.js` / `.ts`, `*.view.xml`, `*.fragment.xml`, React views | services, entities and views, actions / functions, CAP `before` / `on` / `after` hooks (event + target), UI5 controllers, screens by basename |

A new stack (ABAP, Java, .NET ...) is one more class in `EXTRACTORS`. Standard library only; regular
expressions, not full parsers: good enough for names, not for semantics (the model reads the code for that).

### 2.2 Comparison method rules (encoded and tested)

1. **Normalise module names across generations** before comparing: `acme_srv_config_admin`, `srv-config-admin`
   and `Srv.Config.Admin` are the same module (a product prefix before a layer word is dropped).
2. **Compare screens by basename**, never by path: a rewrite moves views into new folders.
3. **Proof of existence is the other tree's source identifier set** (`.cds`, `.csn`, `.ts`, `.js`, `.py` ...),
   **never `.json` / `.yaml`**: a generator catalogue can name an object type that was never built.
4. **A name only in a catalogue is "planned, not built"**: reported as a gap, with that note.
5. **A name only inside strings is not a feature** (a destination name, a label).
6. **Test fixtures and mocks are not product features** (`fixtures/`, `mocks/`, `testdata/` are excluded).
7. **Detect renames** by a rename key that drops generic words (`Service`, `Process`, `Srv`, `Handler` ...).
8. **Confirm before calling anything missing**: raw scan differences overstate gaps (see the reference case).
9. **Group into business areas**: a list of entity names is not an answer.
10. **Compare behaviour, not surface**: the conflict class needs handlers, validations and status flows.

### 2.3 Estates: many repositories, scanned per repository, merged into one result

Old products are often many repositories (one per layer and object: `<product>_db_<object>`,
`<product>_srv_<object>`, UI apps). The flow never reads such an estate in one pass.

1. **Detect.** `v1` (or `v2`) that is a git repository is one tree, exactly as before. A folder that is not a
   repository is searched for git repositories up to 3 levels deep (a repository is not searched further
   down; `node_modules`, `vendor`, build output and dot folders are skipped). A repository list file
   (`v1_repos` / `v2_repos`: JSON `{"repos": [{"path", "ref"?, "name"?}]}` or one `path [ref]` per line)
   replaces detection. Per repository: name (path relative to the folder), path, ref (list file, else
   `v1_ref` when the repository has it, else HEAD), commit, stack. Artefact `repos-v1.json` / `repos-v2.json`.
2. **Scan per repository.** Each repository gets its own extractors and its own inventory calls (fixture /
   cache key `<side>.<repo>`); a big repository is further split by top-level folder, so one model call never
   covers more than one repository. Repositories run in parallel (`LINE_MIGRATE_PARALLEL`, default 3). Each
   result is cached in `repos/<side>/<repo>.json`; a resumed migration rescans only repositories whose
   commit changed. A repository that fails is retried once, then reported (`migration.repo` event, report
   table) while the others go on; only when every repository of a side fails does the migration escalate
   (`REPO_SCAN_FAILED`).
3. **Merge into one inventory.** Feature ids become `<side>.<repo>.<id>`, every evidence path
   `<repo>/<path>`, and each feature keeps `repo` / `repos` (provenance). The same business feature split over
   layer repositories is merged: features of different repositories with the same **object key** (the
   repository name without product prefix and layer word: `acme_db_bp`, `acme_srv_bp`, `acme_ui_bp` -> `bp`)
   are merged when they have the same name (rename key) or share an identifier. Same object but only a
   shared entity is ambiguous: one model call per ambiguous group (role `migrate_merge`) decides; no answer
   keeps them apart. Merges are logged in `scan-<side>.json`.
4. **Everything after works on the merged estate unchanged.** Facts are the union of all repositories
   (modules = one per repository), so the **confirmation pass searches every repository of the other side**,
   never one. Matrix, conflicts, blast radius, effort and report run as for one tree; the report adds a table
   *Repositories scanned* (repository, ref, commit, stack, features, status).
5. **Build.** The build stage drives one git repository. A v2 estate gets the full analysis and the spec pack
   and ends `analysed` with `TARGET_ESTATE` (simplest correct behaviour: a cross-repository build needs one
   change set per repository, which the build stage does not do yet).

## 3. Decision rules

| Class | Action | Done when |
|---|---|---|
| `v1_only` | port to v2 (an F-item) | its acceptance tests pass on v2 |
| `v1_only` + `custom` | port, marked custom in the report (the customer signs these off one by one) | same |
| `v2_only` | keep; protected | its tests still pass after the build |
| `both_same` | keep; protected (only check it is alive) | its tests still pass after the build |
| `both_conflict`, choice `v2` | keep v2; v1 behaviour kept in `backup/<cid>-v1.md` | decision logged; v2 tests still pass |
| `both_conflict`, choice `v1` | an F-item changes v2 to the v1 behaviour; the old v2 tests of that behaviour are superseded | new acceptance tests pass; superseded tests listed |
| unproven | not migrated | listed in the report for a person |
| `v1_only`, "planned, not built" in v2 | port (a gap), with the note | as `v1_only` |
| open decision | asked before any change; `decide` mode takes the recommended option | decision logged |
| change through a protected gate | the gate is written into the change's spec | the gate's v2 tests still pass |
| ported data object merged into a live v2 entity | port, marked high blast radius | as `v1_only`, plus every at-risk v2 test still passes |

## 4. HTTP and CLI

```
POST /api/migrations                {"v1", "v2", "v1_ref"?, "v1_base"?, "v2_ref"?, "notes"?, "mode"?, "scope"?, "build"?}
                                     -> {"migration", "state"}   (driven on a thread)
GET  /api/migrations                 {"migrations": [summary]}
GET  /api/migrations/{id}            {"migration", "features", "conflicts", "run"?}
POST /api/migrations/{id}/answers    {"answers": [{"conflict": "C1", "choice": "v2"|"v1"}], "who"}
                                     -> resumes when no conflict is open

python -m line.cli migrate --v1 PATH [--v1-ref R] [--v1-base R] --v2 PATH [--v2-ref R]
                           [--notes FILE.md] [--mode ask|decide] [--scope WORD ...] [--no-build]
python -m line.cli migrate-answer MIGRATION CONFLICT v2|v1 [--who NAME]
```

Model roles (prompts in `line/llm/prompts/`): `migrate_inventory`, `migrate_match`, `migrate_confirm`.
Spec generation, blast radius, baseline, verify and the report are code.

Also: `GET /api/migrations/{id}/details`, `GET /api/migrations/{id}/report`, `POST /api/migrations/{id}:resume`
(see [api.md](api.md)).

### 4.1 Budget

A migration over many repositories costs far more than one build run, so it has **its own budget**, separate
from `LINE_MAX_USD_RUN`:

| Cap | Config / input | Default | What it covers |
|---|---|---|---|
| migration | `LINE_MIGRATE_MAX_USD` / `max_usd` | 50 USD | every model call of the migration itself (inventory, merge, match, confirm) |
| one repository's scan | `LINE_MIGRATE_MAX_USD_REPO` / `max_usd_repo` | 3 USD | the inventory calls of one repository of an estate |
| build run | (derived) | what the migration has left, at most `LINE_MAX_USD_RUN` | the ordinary build run on v2; its own run budget tree |

- A call is refused **before** it is made once the cap is used up (spend is kept on the migration row, so a
  resumed migration in a new process continues from what was really spent).
- `budget.warn` is emitted once at 80 % (`LINE_BUDGET_WARN_RATIO`) for the migration and for each repository.
- At 100 % the migration ends `escalated` with code **`MIGRATION_BUDGET`** and `detail.resume_state` (the stage
  it stopped in) and `detail.scope` (`total`, `repo` with the repositories, or `build`).
- A repository that stops on its budget is **not** left out silently: missing features would read as gaps,
  so the whole migration stops after the scan and says which repositories ran out.
- **Resume**: raise the cap and continue: `POST /api/migrations/{id}:resume {"max_usd"?, "max_usd_repo"?,
  "rescan"?}`, the board's "Raise and resume" button, or `dlc_flow.ps1 -Mode migresume`. It goes back to the
  stage it stopped in; finished repository scans are reused (cache keyed by commit). Refused (409) when the
  cap was not raised enough. A build run that ran out (`BUDGET_EXCEEDED`) resumes at `decided` with a new run.
- Spend per repository is in the report's repository table; the board shows migration and build spend.

### 4.2 Board

The line board (`GET /`) has a **Migrations** tab (`/?migration=<id>` opens one directly): state and stage
timeline, budget bars, the parity matrix grouped by area (class, custom flag, confidence, action, evidence
quotes on expand), the decisions waiting for a person **with answer controls** (sent to `/answers`), the
repositories table, blast radius (changes with level, protected features at risk, gates, merges), effort
hints, the decisions log, the events, a link to the build run, and `report.md`. When the migration stopped on
its budget the tab offers new caps and resumes it.

### 4.3 Long runs and waiting

A migration over an estate can run for hours. `dlc_flow.ps1 -Mode migwait` waits up to `DLC_WAIT_HOURS`
(default 12; `DLC_WAIT_MIN` also works), polling with backoff from 15 s to 5 min, and ends **at once** when the
migration is parked on decisions (exit 3, result `done: true`, `parked: true`, `questions`, `summary`, the
board URL and what to do next). The caller tells a person and stops waiting; after the answers (or a raised
budget) `-Mode migresume` (or the workflow run again with `migration=<id>`) continues and waits again.
`escalated` (4) and the time limit (5) carry no `done`, so a workflow that requires it ends as a failure.

## 5. Reference case: SMDG V1.7 -> SMDG 2.0

A prior manual scan (2026-09-23, refreshed 2026-10-07) of a real migration shaped this flow. It is the case
the rules in section 2.2 come from.

**Stacks.** Both are CAP / CDS backends with UI5 frontends. SMDG V1.7 is 48 separate repositories named
`simplemdg_<layer>_<name>`; SMDG 2.0 is one monorepo with `db-*` / `srv-*` folders and UI5 (TypeScript) plus
React frontends. Hence per-stack extractors (2.1) and module name normalisation (rule 1):
`simplemdg_srv_config_admin` is `srv-config-admin`.

**What the scan learned.**
- A raw set difference **overstated the entity gap by 26%**; the confirmation pass removed the false gaps.
- SMDG 2.0 moved views under new folders (`npiProject/`, `dataConsolidate/`): screens match by basename only.
- A generator catalogue (`object-type.json`) named `PurchasingSource`, which was never built: a `.json` hit
  would have reported it as existing (rule 3), so it is "planned, not built" (rule 4).
- Services under `test/integration/fixtures` are not product features (rule 6).
- `IntegrationProcessService` (V1.7) is `IntegrationService` (2.0): a rename (rule 7).
- `ScoutCalculationService` appears only as a destination string: not a feature (rule 5).

**Result shape.** SMDG 2.0 covers almost all of V1.7: 85 of 85 admin screens, 41 of 46 main screens, and it
adds 17 areas. The real V1.7-only gap is **whole master-data objects**, not screens:
- Purchasing Info Record (9 tables plus its outbound interface), Source List (5 tables), Purchasing Source (4)
- 28 deep Business Partner tables, to be **merged into the existing 2.0 Business Partner entity**
  (high blast radius), 3 supplier tables, 4 product-extension tables
- `MDCustomPrefix`, `MDShippingInstruction`, 5 UI5 screens
- an old 14-app Fiori suite whose scope is undecided (an open decision, asked up front)

Lesson: **the migration question is objects and their data model, not screens.**

**What the scan did not do, and this flow adds.**
- The **conflict class** needs behaviour: action handlers and business rules per action (for example the
  `Action*Handler` classes), not only names (step 2 with handler facts).
- **2.0-only behaviour on shared paths is protected**: 2.0 added an e-signature gate on approve, mass approve,
  e-mail approve and activate, and a required-field guard on all channels. Every migrated V1.7 object or flow
  must pass through them (gates in step 6, written into the spec).
- **Merging tables into a live 2.0 entity** is a high-blast-radius change (merges in step 6).
- The **2.0 regression baseline** (about 12,000 tests) must stay green (steps 7 and 9).
- **Open decisions become human questions up front**: the target S/4 API for objects with no V1.7 binding,
  whether the legacy UI suite is in scope (step 2 decisions, step 5).
- **Effort per object** (tables, services, screens) so a plan can be estimated (step 6b).

**What still blocks a real run of this case** (see section 6): the build stage drives Python + unittest
only, so on these stacks the flow ends `analysed` with the matrix, decisions, blast radius, effort hints and a
spec pack. The 48 V1.7 repositories are no longer a blocker: point `v1` at the folder that holds the
checkouts (or give `v1_repos`); each repository is scanned on its own and the layer repositories of one
object (`simplemdg_db_bp`, `simplemdg_srv_bp`, ...) are merged into one feature set (section 2.3).

## 6. Limits (honest)

- **Analysis works on any code** (it is reading), but quality drops on very large trees: the inventory reads
  chunks of at most `MAX_CHUNK_CHARS` per call, one repository at a time, grouped by top-level folder inside
  a big repository. A monolith with hundreds of modules in ONE repository still benefits from `scope`.
- **The build stage only drives Python targets tested with `unittest`**, like the rest of the engine today.
  Another v2 stack ends in state `analysed` with code `STACK_UNSUPPORTED`; the matrix, conflicts, blast radius
  and the generated spec pack are still produced and can be handed to people or another builder.
- The import-graph part of the blast radius is Python only; for other languages only shared entities,
  interfaces and gates are used.
- Extractors use regular expressions: names, not semantics. A stack with no extractor gets the generic one.
- Estates (section 2.3): the cross-repository merge relies on repository names that carry a layer word and
  an object name; repositories named otherwise are merged only by an identical feature name or a shared
  identifier within the same object key, else kept apart. A v2 estate is analysed, not built (`TARGET_ESTATE`).
- Characterization is by **examples taken from v1 evidence** written into the spec as acceptance criteria.
  Recording golden input/output by running v1 is not done yet.
- Data is not moved. Code parity is not a migration on its own; see section 7.
- Budget is counted from the cost each model call reports; a call in flight is not reserved, so parallel
  repository scans can overshoot a cap by at most one call each (bounded by `LINE_MAX_USD_CALL`).

## 7. Also needed for a real customer migration (proposals)

These are outside what the engine automates today. Plan them next to every run:

1. **Data and schema**: map v1 tables / fields to v2, transform scripts, master data, reconciliation counts
   and checksums after load, and a rehearsal on a copy of production data.
2. **Configuration and customizing**: v1 settings, number ranges, workflows, templates set per customer.
3. **Roles and authorizations**: every v1 role mapped to v2 roles; nobody gains or loses access silently.
4. **Integrations and interfaces**: inbound / outbound APIs, files, queues, partner systems; contract tests
   against the partners.
5. **Scheduled jobs and batch**: what ran on v1, when, with which variant.
6. **Reports, print forms, e-mails**: layouts are features too, and customers notice them first.
7. **Languages and localisation**: texts, formats, time zones.
8. **Non-functional baselines**: response times, volumes, limits measured on v1 before cut-over.
9. **Feature flags per migrated feature** so a feature can be switched back without a redeploy.
10. **Dual run / shadow comparison**: the same inputs on v1 and v2, outputs compared, for the critical flows.
11. **Rollback plan**: v2 `main` before the run (`base_sha`), data backups, the cut-over window.
12. **Audit trail**: every decision and every ported feature traceable to its v1 evidence (the artefacts do this).
13. **Deprecations**: v1 behaviour that is deliberately dropped (conflicts decided for v2) is told to users
    before cut-over, with the backup file as the reference.
14. **Sign-off per feature group** by the customer, custom features first.
