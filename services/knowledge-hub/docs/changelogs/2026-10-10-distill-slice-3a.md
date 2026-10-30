# 2026-10-10 Distil, slice 3 part 1 (roadmap item D): rekey and patterns

## Rekey: keys for knowledge written before distilling

The shared `lesson-learned` rows (about 367 lessons and guides) were reachable only by meaning. Slice 2
serves items by key; rekey gives the old rows keys without touching their text.

- `GET /distill/rekey?project=&limit=`: knowledge rows with no `action` yet, by id, each cut to
  `DISTILL_LOG_CHARS`, plus the catalog (actions, contexts) and the rules. Distilled items and chunk
  sidecars are left out.
- `POST /distill/rekey {project, keys: [{id, action, context, entities} | {id, skip: true}], contexts}`:
  checks the action against the menu and the context against the catalog (or an `ent__` id), then a
  metadata-only update (`coll.update`, no re-embedding): `action`, `context`, `entities_json`,
  `entity_key`, `status = active`, `first_seen`, `last_confirmed`, `rekeyed_by`, `rekeyed_at`.
  Text, `kind` and `topic` stay, because other reads filter on them (kh-tools `tool-guide`, lesson
  pointers). `skip` sets `-`/`-` without a status: not offered again, not served.
- Both routes are maintainer-only. They read knowledge, not logs, so they need no distil consent.
- `distill.served` now reads by `status` instead of `topic = distilled`, so a rekeyed row is served by
  key like a distilled item. A row longer than `STEP_ITEM_CHARS` (a guide) is cut in the line, which
  says to read the row by id. A line without a title no longer prints an empty one.

## Patterns: counted in code

- `GET /distill/patterns?project=&days=90`: per consented project (all of them when none is named),
  the logs in the window, how many hold a signal word of kind `failure`, the rate, and the five
  topics with the most failure logs, sorted by rate. Maintainer-only; consent required.
- Read-only. Writing them as `pattern` items waits for the first run's numbers.

## Not in this part

- `GET /people`: needs the Keycloak `/kh` extension (another repo) to list realm users; KH has no
  admin credentials of its own.
- The `distill this week` skill: written after the deploy, since it calls these routes.

Checks: `tests/test_distill.py` 85/85 (12 new: rekey access, offer, key/skip/refuse, text kept,
not offered twice, served by key from `lesson-learned`, long row cut, patterns access, consent,
counts). `test_context_step`, `test_turn_context`, `test_auth`, `test_project_access`,
`test_policy_actions` and `test_vector_delete` pass.

## Deployed 2026-10-10

On prod `knowledge-hub` at 04:18Z (droplet `93acdfdf`, previous `f406d191` kept for rollback), after a smoke test 13/13 on a prod slice in the Docker dev containers (Chroma, and HANA Express for the relational tables). Live checks: `/health` ok; `/context/step` with `action: -`, `context: m360-deploy` packs 5 distilled items (`answered_by: action+context`); without keys the pack is unchanged apart from the new `contexts` list; `/distill/patterns` answers for 12 projects. No hook sends the keys yet: the step-wise rule changes only after the tier 2 bench.
