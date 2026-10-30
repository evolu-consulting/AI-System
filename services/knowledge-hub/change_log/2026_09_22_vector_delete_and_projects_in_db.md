# 2026-09-22 — a delete route, and the project registry moved into the database

Two changes fen asked for in one sitting, both of them about the same thing: KH could
write but not unwrite, and the one table every turn depends on was a file.

## `POST /vector/delete`

The finding `kh-no-vector-delete-or-update` (2026-08-27) recorded that a stored row could
never be removed or corrected — only superseded by a second row saying the first was
wrong, after which **both** load forever and the reader has to work out which one wins
from the prose. That is worst in `scope=personalization`, which the SessionStart hook
injects into every session: every bad preference permanently consumed context and
competed with its own correction. fen deferred the fix that day. This is the fix.

The store layer had `delete_vt` all along. What was missing was a door to it.

- **By exact id, never by filter.** A wrong `where` empties a partition in one call that
  nothing can undo; a wrong id removes one row somebody already had to look up. Callers
  find ids with `/vector/query` or `/vector/scroll` first. Max 100 per call.
- **`dry_run: true` locates without touching**, and is the sane first call — the reply
  says which collection holds each id.
- **Which collections are searched.** With `scope` (and optionally `project`) it is the
  same lanes a read of that scope would cover. **Without `scope` it sweeps every
  collection**, because an id does not say where it lives, and the rows most in need of
  removal are exactly the ones that landed somewhere unexpected: pass `scope` only inside
  `metadata` on `/vector/add` and the row is written to the DEFAULT scope's collection
  while its metadata claims another, so every scoped read misses it and no caller can name
  its home. Four worklogs were lost that way earlier the same day. Sweeping is safe
  because the match is by exact id — a collection that does not hold it is untouched.
  `vector_store.every_collection()` is that lane, and it is deliberately not a read lane.
- **Absent ids are not an error.** They come back under `not_found`, so a caller can tell
  "already gone" from "gone now", and deleting twice is a no-op.

## The project registry is a table, not `projects_manifest.json`

fen: *"tôi muốn thông tin project được lưu trong db của KH chứ không phải là file"*.

He is right about the shape. This is the registry step 1 of every turn resolves against,
and a JSON blob rewritten whole has no way to change one project without restating all of
them — so a crash mid-write took the entire registry with it. The old code even had a
`starting empty` fallback for that case, which would have left every project's data
orphaned while the server looked healthy. One row per project cannot lose its neighbours.

- New `app/projects_store.py`, a sqlite store in **hooks.db** (`config.HOOKS_DB_PATH`) —
  next to `hook_rules` and the policy action table, the same choice `policy_actions` made
  and for the same reason: Chroma's sqlite file belongs to a third-party library.
- **The shape is unchanged.** `load_all` returns exactly the dict that used to sit under
  the manifest's `projects` key and `save_all` takes it back, so `_load`/`_save` in
  `app/projects.py` are now two-line wrappers and **every caller above them is
  untouched** — get-or-create, the C4 registry sync, `delete_project`, `/projects`,
  `feedback`, `codegraph`. That seam is the whole reason this was a small change.
- **Whole-set save semantics are kept on purpose**: `delete_project` removes a project by
  popping it from the dict and saving, so a save that only upserted would leave a deleted
  project registered and its data orphaned but still routed to.
- **The legacy file is imported once and then retired**, renamed to
  `projects_manifest.json.migrated-<utc>` rather than deleted — it is the only copy of a
  registry that took weeks to accumulate, and a rename is reversible. The import runs
  only when the table is EMPTY, so it can never resurrect a project somebody deleted.
- `GET /projects` now reports `store: {db, table, projects}`, which is the question
  somebody asks immediately after being told the registry is no longer a file.

Blast radius checked before writing: `projects_manifest.json` appears in exactly one place
in the codebase (`app/projects.py:53`), and every other module reaches the registry through
`list_projects()` / `get_or_create_project()`. The per-project `bundle.json` descriptor is
untouched — a project directory still explains itself without the central registry.

## Tests

`tests/test_vector_delete.py`, 31 checks, all passing: delete removes the id and not its
neighbour, twice is a no-op, an unknown id is reported rather than invented, `dry_run`
looks without touching, a scoped delete cannot reach an orphan while the sweep can, a
project round-trips through the table, re-creating merges aliases and keeps `created_at`,
a project popped from the dict leaves the table, a non-empty table is not overwritten by
the legacy file, an empty one imports it, and the file is retired rather than deleted.

`test_layers`, `test_policy_actions`, `test_project_match_weak`, `test_project_registry`
and `test_turn_mutated` all still pass. **`test_hotlog` fails two checks — and it failed
those same two on the pristine tree before any of this**, verified by stashing the change
and re-running: the per-slot cap check and the no-project recency check. Pre-existing, not
caused here, and worth its own look.
