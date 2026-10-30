# 2026-10-10 Distil, slice 2 (roadmap item D): distilled items served by key

Slice 1 stored distilled items but served them only by meaning, mixed with every other knowledge row.
Slice 2 adds the key path of `docs/distill-design.md` ("How items are read").

- `distill.served(project, action, context, entities, limit)`: live items (`active`, `contested`) by
  key, a SELECT with no score floor. Order: action + context, then action alone when that found
  nothing; a context alone reads by context. The context is normalised the way submit stores it
  (folded tag, or an `ent__` id as given). Items naming one of `entities` come first, then the newest
  `last_confirmed`.
- `POST /context/step` takes optional `action`, `context`, `entities`. When the step names an action
  or a context, the project's and `lesson-learned`'s items under that key are packed as tier
  `distilled`, right after the entity cards and before anything by meaning. The pack echoes `keys`
  with `answered_by` (which lane answered with which key) and lists the project's context tags in
  `contexts` (at most `KH_STEP_CONTEXT_LIMIT`, 40), so the caller can name one on its next step.
  At most `KH_STEP_KEY_LIMIT` (6) items per lane.
- `GET /turn/context` takes the same three as query parameters and adds a `DISTILLED ITEMS` block.
  The kh-helper hook does not send them, so its block is unchanged. The read runs in a thread
  (`asyncio.to_thread`), the lesson of the 2026-10-09 incident.
- Sources: a line carries the worklog ids only for a maintainer; members never see them.

Not changed: what is stored, the distil routes, the rules. Nothing tells the model yet to pass
`action`/`context` to `/context/step`; that is the step-wise hook rule, changed after the slice 4 bench.

Checks: `tests/test_distill.py` 73/73 (14 new: key order, fallback, context alone, entity order,
proposed items hidden, sources maintainer-only, catalog, turn block); `tests/test_context_step.py` and
`tests/test_turn_context.py` unchanged and passing.

Deployed 2026-10-10 (see slice 3a). Next: slice 3 (`distill this week` skill, `rekey` of the shared lessons, `GET /people`,
`GET /distill/patterns`), then slice 4 (dev, bench, prod).
