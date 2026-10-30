# Distilling worklogs into knowledge (roadmap item D)

Design approved by fen 2026-10-09. **Slice 1 built 2026-10-09** (`app/distill.py`, checks in
`tests/test_distill.py`); **slice 2 built 2026-10-10** (`distill.served`, keys on `/context/step` and
`/turn/context`); **slice 3 partly built 2026-10-10**: `GET`/`POST /distill/rekey`, `GET /distill/patterns`
(85 checks); `GET /people` and the `distill this week` skill not yet; slice 4 not yet. Decisions it rests on: 2026-09-30
(experiences only, consent, scrub, review), 2026-10-01 (one distiller, fen's Claude CLI on weekends,
`/distill/next` and `/distill/submit`), 2026-10-04 (a how-to-work rule is a policy, never knowledge),
2026-10-09 (keys action + context, kinds, contested items, soft delete, Keycloak as the people
directory, lessons only propose policies).

## What it does

Every weekend fen's Claude CLI takes a batch of unread worklogs per project from KH, writes small
**distilled items** (one fact, one lesson, one procedure each, under 600 characters, with the log ids
it came from) and hands them back. KH checks them in code (schema, leaks, duplicates), parks them as
proposed, fen approves in the same session, and from then on `/context/step` and `/turn/context`
serve them **by key** before anything is searched by meaning. The worklog stays the record; items
point back to it.

What it replaces: today a durable fact reaches knowledge only when a session writes it by hand, and
the shared `lesson-learned` project (367 rows) is found only by similarity to the raw prompt or when
an action's rule says to look there.

## A distilled item

An ordinary vector row in the owning project's knowledge part (`kh_know_<project>`), so every read
path, grant and backend works unchanged. New fields are metadata; metadata values stay scalars
(lists as JSON strings, as entity cards already do).

| Field | Values | Notes |
|---|---|---|
| `kind` | `lesson`, `fact`, `procedure`, `habit`, `pattern`, `policy_proposal` | the six kinds of the roadmap; `pattern` rows are computed in code, never by the model |
| `action` | a policy action label, or `-` | the first key; the labels of `GET /policy/actions` |
| `context` | a tag from the project's context catalog, or an entity id, or `-` | the second key; never free text |
| `entities_json` | entity ids named by the item | third key; equality in SQL on `entity_key` (sorted, joined), contains-checks in Python |
| `title` | <= 120 chars | what the row shows in a pack line |
| text (the row body) | <= 600 chars (`STEP_ITEM_CHARS`) | symptom / cause / fix for a lesson; steps for a procedure; one sentence for a fact |
| `sources_json` | worklog ids (`vector_id`, or `chunk_of` of a chunk hit) | **maintainer-only in every response**; `/context/step` and `/turn/context` strip it for members |
| `evidence_count` | integer | number of distinct source logs; the cheap confidence score |
| `status` | `proposed`, `active`, `contested`, `superseded`, `withdrawn` | see below |
| `superseded_by` | item id | set on supersede |
| `first_seen`, `last_confirmed` | dates | no expiry date; a row is current while it keeps being confirmed |
| `distilled_by`, `distilled_at` | model name, timestamp | for the later worker-vs-human comparison |
| `origin_project` | project id | on shared rows only: where it was distilled from |
| `knowledge_type` | `quick` when `active` or `contested`, else `proposed` / `superseded` / `withdrawn` | `/vector/query` and both context routes AND `knowledge_type == quick`, so this one field hides a row from every model-facing read while `/vector/scroll` still shows it to maintainers |

Id: `dk_<sha12>` of `(project, kind, action, context, entity_key)`. A second item with the same key
but a different meaning gets `dk_<sha12>_<n>` and both become `contested`.

Wording rules the distiller follows and the gate checks:

- positive wording: what to do, not who failed;
- people appear as role aliases (`Dev`, `PO`, `reviewer`), never by name or e-mail; the alias to
  person mapping lives only in the project's entity cards, which are already project-private;
- a project item may name its project and its systems; a shared item may not name a project, a
  customer or a project-only alias;
- a `habit` is about a role in a project (`the PO assigns work through commits and kh-message`), so it
  is project-private by construction;
- a `policy_proposal` carries `target_action`, `target_sub_action` and the proposed rule text. It is
  **not** a rule: fen approves it, KH writes the rule with `POST /policy/rule/set` on the project, and
  the proposal row is superseded with `applied_to`. The policy table stays the single place that says
  how to work.

### Duplicates, contradictions, supersede, delete

| Case | What KH does at submit |
|---|---|
| the distiller sets `updates: <id>` (a neighbour, newer or fuller wording) | that row is rewritten in place: keys and text replaced, `sources_json` merged, `evidence_count` grows, `last_confirmed` = today; sources may be any earlier log of the project |
| the distiller sets `contradicts: <id>` (same subject, opposite claim) | new row `dk_..._<n>`; it and the named row become `contested`; both go to the review queue; a pack line shows the flag so the model treats neither as settled |
| no relation stated, cosine >= `KH_DISTILL_SAME` (0.95) with a live row of the same kind | treated as the same item reworded: merged as above |
| no relation stated, anything else | a separate item `dk_..._<n>`, `proposed`: one key holds many items |

Why the distiller states the relation (first prod run, 2026-10-09): cosine alone cannot tell an update or
a contradiction from a sibling. With bge-small a reword scores 0.97, an opposite claim 0.89, two unrelated
lessons under one key 0.60-0.65, but a dev-deploy and a prod-release procedure also scored above 0.80 and
were wrongly contested. The distiller already sees the live items as `neighbours`, so it decides.
| a contest or approval was wrong | `POST /distill/reopen {project, ids}` puts the items back to `proposed` |
| fen marks one of two contested rows right | the other becomes `superseded` with `superseded_by` |
| a newer item replaces an older one | soft delete: `status = superseded`, `knowledge_type = superseded`; the row stays readable through `/vector/scroll` for maintainers |
| a person withdraws consent | hard delete only of personal data: their entity cards of type person in the consented projects, and their log ids stripped from `sources_json`; items stay (they are alias-only); `/auth/help` says exactly this |

`POST /vector/delete` (exact ids, `project.write`) already exists for the hard case. Supersede is a
metadata rewrite, so it needs no store change.

## Scope: project or shared

| Goes to | What |
|---|---|
| the project's knowledge | members and their roles, habits, project-only procedures (its deploy steps), facts about its systems, policy proposals for its actions |
| `lesson-learned` (shared) | lessons, facts and procedures that hold in every project, after fen approves **and** the generalisation check passes (no project, customer or project-only alias in the text) |

Promotion is a second write: the project row stays, a shared row is created with `origin_project`
and the same sources (still maintainer-only). The 367 existing shared lessons keep their ids and get
`kind = lesson`, `action` and `context` filled in the first weekend run (`mode = rekey`, below); the
text is not changed, so no review is needed.

## Where people come from

No `kh-users` project. Keycloak already holds every user's names and e-mails (one person, several
accounts). `GET /people?name=<text>` reads the realm through the Admin API with KH's service
credentials and returns `{name, emails[], org}` per match; `org` is a Keycloak user attribute. Every
signed-in member may call it (no tenant isolation: members of one project span gmail, simplemdg.com
and laidon.com). The rule for `manage kh project or access` says: look the person up first; several
matches, ask the owner which one. The kernel does not grow.

## The weekend run

Every distil route is maintainer-only (the run reads every consented project's logs).

### `GET /distill/next?project=<id>&limit=20`

Returns the next batch for one project:

- `logs`: unread worklogs past the project's cursor that carry **signal**, oldest first, each cut to
  2,000 chars, with its id and `why` (`word:<w>`, `new-topic`, `follows-signal`, `sample`). Signal is
  decided in code: a signal word (folded, whole words), a topic new to the project, a `follows vec_x`
  link to a log that had signal, or the random sample `KH_DISTILL_SAMPLE_PCT` (10%) that keeps a
  missing word visible. Rows without signal are passed over (`passed_without_signal`), which keeps
  the run within fen's quota; at most `KH_DISTILL_SCAN_MAX` (400) rows are examined per call;
- `neighbours`: the project's live items, one line each, newest first, up to 6,000 chars (so the
  model merges into what exists instead of rewriting it);
- `catalog`: kinds, the project's policy action labels and its context tags, so keys come from a
  closed list;
- `people`: the project's entity cards of type person (name, aliases, role), so the model can replace
  names by role aliases;
- `rules`: the writing rules in one paragraph; `batch_id`; `remaining_after`; `done` when nothing is
  left past the cursor.

**Signal words are dynamic** (fen 2026-10-09). They live in the table `distill_signal` (word, kind,
source, reason, hits), seeded once from `KH_DISTILL_SIGNAL_SEED` (decision / failure / newcomer /
procedure / correction words, English and unaccented Vietnamese). The distiller adds a word it finds
with `signal_words` on submit; it is checked (3 to 40 chars, not already there, not personal or host
data) and fires from the next batch on. `hits` counts how often each word fired, for tuning.
`GET /distill/signals` lists them; `POST /distill/signals {add, remove}` edits them by hand. The
seed leaves out `them` (Vietnamese `thêm`): logs are English, where it is an ordinary pronoun.

**Contexts are dynamic too**: the table `distill_context` (project, tag, description, source). The
distiller adds a tag under `contexts` on submit, in the same call as the items that use it.

Only projects with the consent flag are served (fen's own on, every other project off until its
owner agrees). The flag belongs in Keycloak (a column on `KH_AUTH_PROJECT`, carried in the `kh`
claim as `distill: [pid, ...]`); until the Keycloak repo has it, `KH_DISTILL_PROJECTS` lists them.

The cursor is a row of the table `distill_cursor` (`last_ts`, the ids at that ts, the recent signal
log ids for `follows`, the topics seen), in KH's relational store (SQLite locally, HANA on BTP,
where a container has no disk that survives a restart). A served batch is kept in `distill_batch`
until submitted; the cursor advances only then, so a run cut mid-way loses nothing and the backfill
of old logs is the same loop from the first log. `GET /distill/cursor?project=` shows where it
stands; `POST /distill/cursor/reset` starts a project over. `mode = rekey` (slice 3) will serve rows
of the project's knowledge that lack `action`/`context` instead of logs.

### `POST /distill/submit`

Body: `{project, batch_id, items: [...], contexts: [...], signal_words: [...], distilled_by}`. An
empty item list is valid: it still moves the cursor. A batch is submitted once (409 after). KH, in
code:

1. schema: kinds, lengths, action from the menu, context from the catalog or an entity id, sources
   among the logs of this batch, `target_action` + `target_sub_action` on a policy proposal;
2. **leak gate, by scope** (fen 2026-10-09, the Pacific/Gina case: the board, the channel and the
   deploy target ARE the value of a project item). One hit rejects the item, not the batch, with the
   matched string.

   | Refused | in an item of fen's own project (`KH_DISTILL_OWN_PROJECTS`) | in someone else's project | on share to `lesson-learned` |
   |---|---|---|---|
   | e-mail, secret, key, JWT (`KH_DISTILL_LEAK_PATTERNS`) | yes | yes | yes |
   | person names and aliases (entity cards) | yes: the person goes in `entities` | yes | yes |
   | org names | no | yes | yes |
   | host, IP (`KH_DISTILL_SHARE_LEAK_PATTERNS`) | no | yes | yes |
   | project ids and aliases | no | no | yes |

   Realm user names join the gate with `GET /people` (slice 3);
3. dedupe and contradiction as in the table above;
4. write the item with `status = proposed`, `knowledge_type = proposed`; add the batch's repeat logs
   to their items as evidence (below); advance the cursor.

**Repeats are counted in code.** Thousands of near-identical logs ("QC asked for a root cause
again") must make one item with a large `evidence_count`, not thousands of model reads. At
`/distill/next`, a signal log at least `KH_DISTILL_CONFIRM` (0.85) close to a live item, with no
signal word the item's text lacks, is held back (`confirmed_in_code` per item id) and added to that
item's evidence on submit. A log with a word the item does not have (a new board, a rollback) still
goes to the distiller; a log that opens a new topic always does. The threshold is tuned on the first
run: a whole worklog against a 600-character item may score lower than two items do.

Returns one line per item: `accepted` (id), `merged` (into id), `contested` (ids), `rejected`
(reason). Pattern rows (`project A fails more than B`) are not submitted; `GET /distill/patterns`
computes them from log counts per topic and author role and writes them as `pattern` items itself.

### Review

- `GET /distill/pending?project=` lists proposed and contested rows, one line each, newest first;
- `POST /distill/approve {ids, share: [ids]}` sets `active` (and creates the shared row for the ids
  in `share` after the generalisation check); a `policy_proposal` id triggers `POST /policy/rule/set`
  on the project and supersedes the proposal;
- `POST /distill/reject {ids, reason}` sets `withdrawn` and keeps the reason in metadata.

fen reviews in the same CLI session, reading one line per item; no page is built for this.

### The command

A kh-helper skill `distill this week` (a prompt file served by `/auth/help`, like the other rules): for
each consented project loop `next` -> write items -> `submit` until `next` returns no logs, then show
`pending` and wait for fen's approve/reject; stop when the Claude quota warning appears and say where
the watermark stands. Later the same loop runs as a server worker with its own model (item E); only
the caller changes.

## How items are read

`POST /context/step` and `GET /turn/context` take three optional parameters: `action`, `context`,
`entities`. The model already knows its action label and the entities the step names; the context tag
comes from the catalog served with the step.

Pack order in `/context/step` becomes:

1. entity cards named in the step (unchanged);
2. **items by key**: `where {action, context}` on the project's knowledge and on `lesson-learned`,
   `status in (active, contested)`, no score floor, newest `last_confirmed` first, tier `distilled`.
   A `SELECT`, not a search, the same reason the policy table works;
3. items by `action` alone when 2 returned nothing;
4. knowledge by meaning, then the worklog only when nothing is close enough (unchanged).

Contested rows are packed with `[contested]` in the line so the model does not settle on one.
`sources_json` is dropped from every line unless the caller is a maintainer. `/turn/context` does the
same with the prompt's action guess and adds the lines to the block.

No Kuzu in this build. The 2026-09-30 precedence (graph, then similarity, then log) is met by the
key filter; the graph tier is added only if the bench shows a multi-hop need (an item reached through
an entity's relation), and then as edges item -> entity and item -> context rebuilt from metadata, so
the vector row stays the only thing written.

## Access rules

| Route | Kind |
|---|---|
| `GET /distill/next`, `POST /distill/submit`, `GET /distill/pending`, `POST /distill/approve`, `POST /distill/reject`, `GET` and `POST /distill/signals`, `GET /distill/cursor`, `POST /distill/cursor/reset`, `GET /distill/patterns` (slice 3) | maintainer |
| `GET /people` | authenticated |
| items themselves | the project's `project.read`; shared rows through `lesson-learned`'s readonly default |

## What is measured

The bench of items A to C, run on dev against prod before the rollout, plus:

- the roadmap target: at least 80% of the "who / what / which one fails" questions answered from
  distilled items alone, under 1,000 tokens;
- 4 to 5 same-action-different-context questions (company GitLab from outside needs the VPN, GitHub
  does not), which only the key path can separate;
- the leak gate: a seeded set of names, e-mails, hosts and secrets planted in test logs; zero may
  survive;
- a user turn is not slower: `/context/step` p95 with the key filter against today's.

## Build plan

Claude Code build time at the measured speed, +30%; fen's time separately.

| Slice | Build | fen |
|---|---|---|
| 1. item schema, `next` / `submit` / `pending` / `approve` / `reject`, dynamic signal words and contexts, cursor, leak gate, dedupe, tests: **built 2026-10-09** | 1 day | approve this document |
| 2. `action` / `context` / `entities` on `/context/step` and `/turn/context`, key tier, source stripping, tests: **built 2026-10-10** | 0.5 day | - |
| 3. `distill this week` skill, `rekey` of the 367 lessons, `GET /people`, `GET /distill/patterns`, bench questions: **rekey and patterns built 2026-10-10**; `GET /people` needs the Keycloak `/kh` extension (other repo); the skill waits for the deploy | 0.5 day | - |
| 4. dev deploy, first weekend run on fen's projects (backfill, about one day of quota), bench, prod | 0.5 day | review a sample of items, 1 to 2 hours; the weekend run itself |

Total: 2.5 days of build, matching the roadmap's 2 to 4 days, then the first run on the weekend of
2026-10-11.

## Five lenses

| Lens | Trade-off |
|---|---|
| Security | alias-only text, leak gate in code before any write, sources maintainer-only, routes maintainer-only, consent flag per project; `GET /people` exposes every member's e-mails to every member, accepted for the in-house realm, to be scoped when an external tenant joins |
| Licensing | nothing new: Chroma (Apache-2.0), hdbcli (SAP, already in use), Keycloak (Apache-2.0); the embedder is unchanged |
| Performance | the weekend run is offline and bounded by signal filtering and the 20-log batch; the step adds one filtered read (JSON_VALUE on HANA, native `where` on Chroma). Ceiling: the Python-side `where` on HANA scans the project's knowledge part; fine to about 10k rows per project, after that `action`/`context` become indexed columns |
| Scalability | a new kind, key or context tag is a catalog value, not code; the worker of item E reuses the same three routes; the graph tier bolts on from metadata; existing reads keep working because items are ordinary knowledge rows |
| Maintainability | one vector store; four small tables (cursor, open batches, signal words, contexts) through `app/sqldb.py`; the hide mechanic is the existing `knowledge_type`; the review is three small routes; checks in `tests/test_distill.py` in the repo's plain-script style |

## Decided by fen, 2026-10-09

- The signal word list above, tuned after the first run with the 10% sample and the `hits` counts;
  the list is dynamic (the distiller adds words).
- The leak gate by scope and the repeats counted in code (the Pacific/Gina case).
- The consent flag is `KH_DISTILL_PROJECTS` in KH for now (Keycloak later), and
the first run covers fen's own projects only (knowledge-hub, simplemdg-ticketing, simplemdg-2.0, solace-buzz,
personal, and pacific, added 2026-10-09 for the QC case); those same ids go in `KH_DISTILL_OWN_PROJECTS`.
Other owners are asked afterwards.
