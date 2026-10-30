# Policy action table (v6.5) — deterministic policy routing

Current state of policy routing. Since 2026-08-21 this table is the **only** tier consulted to
decide a deliverable: the semantic tier (`app/policy.py`, `/policy/match`) still exists as an
endpoint and its vector collections are still writable, but it is **retired for routing** and
neither hook calls it any more.

## Why

`/policy/match` embeds the request and returns the nearest policy vector. Measured on
2026-08-21 over 65 probes at the tuned threshold `0.76`:

- 60/65 correct;
- false fires on the degenerate fragments `source code repo project` and `code`;
- misses **every** untranslated Vietnamese request, because the embedder is
  `bge-small-en-v1.5` — English only, and unaccented Vietnamese collapses in it (7 of 11
  ordinary Vietnamese sentences falsely fired a policy before the Vietnamese rows were
  deleted);
- ~2000 ms per call, since it runs the model.

The false-fire band and the true-positive band **overlap** (highest false fire 0.7733, lowest
true positive 0.7701), so no threshold is clean. That is a property of similarity routing, not
a tuning mistake.

## The design (fen, 2026-08-21)

Two tables in KH's own `hooks.db`, beside `hook_rules`:

```sql
CREATE TABLE policy_actions (
  project       TEXT NOT NULL DEFAULT 'every project',  -- scope; sentinel = applies to all
  action        TEXT NOT NULL,      -- the big action group, e.g. 'scan code'
  description   TEXT NOT NULL,      -- the when-to-use line an agent READS to choose
  source_policy TEXT,               -- which live policy family these rules came from
  priority      INTEGER DEFAULT 100,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (project, action)
);
CREATE TABLE policy_rules (
  project    TEXT NOT NULL DEFAULT 'every project',
  action     TEXT NOT NULL,         -- the action group
  sub_action TEXT NOT NULL,         -- the small step inside it, e.g. 'read files'
  seq        INTEGER,               -- order the steps are performed in
  clauses    TEXT,                  -- clauses of the source body this row carries
  content    TEXT NOT NULL,         -- the rule for exactly that pair
  updated_at TEXT,
  PRIMARY KEY (project, action, sub_action)
);
```

One row per **small step** inside each action group, not one row per whole policy. Retrieval is
a `SELECT`, so:

- no threshold to tune and nothing to re-measure when a policy family is added;
- two families cannot bleed — `read files` under `scan code` (fan the tools out per group) and
  `read files` under `review code` (pull the diff with the github cli) are two primary keys;
- language stops mattering: the agent maps meaning to a label, so a Vietnamese request routes
  exactly as well as an English one;
- an agent can fetch only the rule for the step it is on instead of the whole policy body.

`description` is read by a model and never embedded — that is the point. It replaces the many
short `intent` rows the vector tier needed.

## The project column (fen, 2026-08-21)

A policy is scoped like everything else in v6.4. A rule for one codebase carries that project's
id; a rule that belongs to no project in particular, or applies to all of them, carries the
literal sentinel **`every project`**. Reads consult the active project FIRST and fall back to
`every project` **per (action, sub_action)**, so a project can override a single step of a common
action without copying the rest, and may also declare actions of its own that the common menu
does not list.

**The caller never types the sentinel and never filters results.** Pass `?project=<id>` (or
omit it) and the endpoint returns exactly one resolved rule per sub-action. Resolution lives in
the server precisely so no agent has to reason about scope on either side of the call — that is
also why the sentinel is a real value rather than an empty string: in a `NOT NULL` column, blank
would make "applies everywhere" and "someone forgot to set it" indistinguishable, and the silent
failure direction would be a project rule leaking to every project. The injected hook menu prints
`[project: X]` only for project-specific rows, so common rules cost no extra tokens.

A table written before this column exists is migrated in place on startup: SQLite cannot alter a
primary key, so `store.init()` renames, recreates and copies every row in as `every project` —
which is what those rows were, both seeded families being orchestrator-common. The migration is
idempotent and runs on whichever side starts first (server or `policy_table.py build`).

**Why `hooks.db`**: it is KH's own deterministic store and the table's only consumer is the
`UserPromptSubmit` hook, which already reads that file. The other SQLite file in the install,
`chroma_data/chroma.sqlite3`, belongs to the Chroma library — that schema is not ours and its
reset/upgrade path could drop our tables, so it is deliberately not used.

## Endpoints (`app/policy_actions/`)

| Route | Purpose |
|---|---|
| `GET /policy/actions?project=` | the menu: every action, its when-to-use line, its sub-actions |
| `GET /policy/actions/raw?project=` | the same menu as `text/plain`, for direct injection into a hook |
| `GET /policy/actions/projects` | which projects own rules, and how many |
| `GET /orchestrator/project_match?text=` | step 1: which project is this intent about (literal) |
| `GET /projects/registry` | what the orchestrator's C4 tree knows about each project |
| `POST /projects/registry/sync` | make that tree match the manifest (startup does it too) |
| `GET /policy/plan?action=&project=` | every rule of one action, in step order — the deliverable definition |
| `GET /policy/rule?action=&sub_action=&project=` | one rule, per-project row winning over the common one |
| `POST /policy/action/set` | create/update a menu entry |
| `POST /policy/rule/set` | create/update one `(action, sub_action)` rule |
| `POST /policy/rule/delete`, `POST /policy/action/delete` | remove (an action refuses while it still owns rules unless `cascade`) |
| `POST /policy/actions/bulk` | seed or migrate the whole table in one call; `replace: true` clears first |

**Loud failure by design.** An unknown action is `404 UNKNOWN-ACTION` carrying the list of real
labels; a wrong sub-action is `404 NO-RULE` carrying the sub-actions that do exist. Nothing ever
falls back to a nearest neighbour, and **"no action fits" is a valid answer** — the caller
answers `none` and proceeds without a policy rather than forcing a label.

`POST /policy/actions/bulk` rejects the whole payload if it carries a rule for an action that is
neither declared in the payload nor already present, so a half-applied seed cannot leave the
table claiming coverage it does not have.

## Content

Seeded from the two live orchestrator-common policy families, one row per numbered clause, so
nothing is summarised away:

- **`scan code`** ← `policy_code_scan_v3` — choose tool → create project → read files → read
  documents → run scan → author tiers → persist result → import graph → blast radius → verify
- **`review code`** ← `policy_design_coding_review_v1` — read files → check design → check
  security → check licences → check performance → check scalability → check maintainability →
  check coding rules → check ui → check testing → check working style → report findings

22 rules, 33 of 33 source clauses covered. The seed payload lives at
`seeds/policy_action_table.seed.json` — generated, never hand-typed — and the authoring source
plus the coverage checker live in the tools repo at
`C:/Programs/ClaudeKH/tools/policy_action_table/policy_table.py`
(`export-seed`, and `verify`, which re-fetches the live bodies from `/policy/list` and proves
every clause tag is still claimed by a row).

## How a turn gets its policy (fen's mechanism, 2026-08-21)

Two exact lookups, no similarity anywhere in the path.

**Step 1 — which project?** `GET /orchestrator/project_match?text=<the user's own words>`.
It answers `{best, ambiguous, policy_project, matches}` by literal term match over the **project
registry in the orchestrator's C4 tree**. Every project publishes its id, aliases and keywords
there when it is created, so registering a project and being findable by name are the same event:

```
POST /projects            ->  bundle + one C4 L1 record in kh_know_orchestrator
                              id project_registry__<id>, tree_id c4_project_registry, lv 1
```

Matching folds both sides (NFD, accents stripped, non-alphanumerics collapsed) and compares on
**word boundaries**, so `SMDG_V1` / `smdg v1` / `smdg-v1` are one string, Vietnamese diacritics
stop mattering, `code` cannot match `codegraph`, and `the ticketingsystem thing` matches nothing.
Ranking is longest matched term first, then `id` > `alias` > `keyword`. Three honest outcomes:

| outcome | meaning | what the caller does |
|---|---|---|
| a project | that phrase names it | pass it as `project` in step 2 |
| `best: null` | no project named | omit `project` — read the common tier only |
| `ambiguous: true` | two projects tied | **ask**, never pick |

`GET /projects/registry` shows what the tree knows; `POST /projects/registry/sync` makes it match
the manifest, and startup does that automatically (embedding nothing unless names changed).

**Step 2 — which action, and its rules.** Pick a label from `GET /policy/actions` (add
`?project=<id>`: a project may declare actions of its own), then
`GET /policy/plan?action=<label>&project=<what step 1 resolved>`. No project → the
`every project` tier alone. With a project → `(that project OR every project)` resolved **per
sub-action**. The `project` parameter accepts an id, an alias or a keyword, so the user's own
words can be passed straight through; every reply echoes `requested_project` beside the resolved
`project`.

**Step 3 — the rest.** Unknown label → `404 UNKNOWN-ACTION` with the real labels listed. No label
fits → answer `none` and do the work; there is no `/policy/match` fallback. The project resolved
in step 1 is also the scope for the rest of the turn: its knowledge, its log, its findings. When a
phrasing resolves to nothing but context makes the project obvious, use it and offer to add that
phrasing as an alias — `POST /projects` merges aliases in, no code change and no rebuild.

Why literal and not an embedder, for project identification too: a wrong project pulls the wrong
project's policy, which is exactly the failure the semantic route was retired for. The cost is
that a nickname must be added as an alias once; the gain is that it never mis-routes.

## How the hook uses it

`UserPromptSubmit` / `intent-policy-guard` (v3) injects the action menu and the three steps
above; the `SessionStart` kernel's "CONSULT KH, POLICY-FIRST" clause describes the same two
lookups. Both are generated from the table itself (`policy_table.py hook-text`), so the injected
menu cannot drift from the rules, and both previous texts are kept in `policy_hook_backup` in
`hooks.db`.

## Why the vector route was retired for routing (fen, 2026-08-21)

It was kept as a fallback for one day. On a real request that same day — *"store all information
from a tools folder into a KH project as a detailed work log"* — it fired the **code-scan**
policy at `0.826`, which would have redefined a work-log task as a codebase scan with graph and
tiers. The action table answered correctly (no label fits). Since the false-fire and
true-positive bands overlap, no threshold removes that class of error, so the fallback was
removed from both hooks rather than re-tuned. `/policy/match`, `/policy/add` and `/policy/list`
remain live endpoints for other uses.

## Honest caveat

The table's classifier is **the agent picking a label**, not an algorithm. The 65/65 measured in
the prototype comparison is therefore self-graded: it is the real runtime mechanism, so the
comparison is meaningful, but it is not an independent benchmark. `tests/test_policy_actions.py`
asserts only what is objective — two distinct rules per shared sub-action name, loud failure on
unknown labels, `hook_rules` untouched in the shared database, partial seeds refused,
idempotent re-seed, lookup latency.
