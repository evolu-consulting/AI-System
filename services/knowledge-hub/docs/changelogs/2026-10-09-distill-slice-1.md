# 2026-10-09 Distil, slice 1 (roadmap item D)

Built the server side of the weekend distil run, `app/distill.py`, attached in `main.py`, rules in
`app/auth_rules.json` (all maintainer-only), config block `KH_DISTILL_*` in `app/config.py`.

- `GET /distill/next`: signal logs past the project's cursor, oldest first, with why each was picked,
  plus neighbours, catalog (kinds, actions, contexts), people and the writing rules.
- `POST /distill/submit`: schema, leak gate (person/org card names, e-mail, host, IP, secret
  patterns), same-key merge or contest, cross-key reword merge (cosine >= 0.9), items written as
  `proposed`; contexts and signal words added in the same call; cursor advanced; one submit per batch.
- `GET /distill/pending`, `POST /distill/approve` (active, contested sibling superseded, policy
  proposal applied as a project rule, `share` copies a general item to `lesson-learned`),
  `POST /distill/reject` (withdrawn).
- Dynamic signal words (fen 2026-10-09): table `distill_signal`, seeded once from
  `KH_DISTILL_SIGNAL_SEED`, extended by the distiller, edited by hand through `/distill/signals`,
  `hits` counted. Seed leaves out `them`. Contexts in `distill_context`.
- Cursor and open batches in tables `distill_cursor` and `distill_batch` (SQLite / HANA), not files:
  a BTP container keeps no disk across restarts. The design doc said a file; it now says tables.
- Consent: `KH_DISTILL_PROJECTS` (fen 2026-10-09); nothing is served for other projects.

Same day, after fen's Pacific/Gina use case:

- Leak gate by scope: e-mails and secrets refused everywhere; person names refused everywhere (they
  go in `entities`); org names, hosts and IPs allowed in private items of `KH_DISTILL_OWN_PROJECTS`,
  refused in other people's projects and on share (`KH_DISTILL_SHARE_LEAK_PATTERNS`).
- Repeats counted in code: a signal log >= `KH_DISTILL_CONFIRM` (0.85) close to a live item with no
  signal word the item lacks is held back from the distiller and added to the item's evidence on
  submit (`confirmed_in_code`). `evidence_count` now counts beyond the 50 stored source ids.
- First run list gains `pacific`.

Checks: `tests/test_distill.py` 49/49. Full suite compared with the baseline taken before the change.

First prod run, same day: the first submit (zeus-adm, 12 items) marked two pairs of unrelated items
`contested` because they shared a key. Fixed: one key holds many items; only a close item with another
claim contests. Thresholds measured with bge-small (reword 0.97, opposite claim 0.89, unrelated
0.60-0.65): `KH_DISTILL_SAME` 0.95 (was 0.9), new `KH_DISTILL_CONTEST` 0.80. New
`POST /distill/reopen` to put wrongly contested or approved items back to `proposed`. Checks 51/51.

Later the same run (m360): a dev-deploy and a prod-release procedure still scored above 0.80 and were
contested, and items that refine an earlier one were refused for citing earlier logs. Changed: the
distiller states the relation (`updates: <id>` or `contradicts: <id>`); cosine only auto-merges a
near-identical copy (>= 0.95); `KH_DISTILL_CONTEST` removed; sources may be any log of the project.
The secret pattern now needs a value of 8+ characters holding a digit ('Token: no-check' and
'password: never' were refused). Checks 56/56; e2e on prod 73/73 (run of 00fa518).
Not in this slice: key tier in `/context/step` and `/turn/context` (slice 2), the `distill this week`
skill, `rekey`, `GET /people`, `GET /distill/patterns` (slice 3), deploy and first run (slice 4).

Later still: a batch whose submit had refused items stays open (`batch_open: true`) so the distiller
can fix and resend them with the same batch_id; the cursor moves only on the first submit. Before this,
9 refused items of the first run were lost with their closed batches. fen approved the first 87 items
and ruled that later runs approve their own items (contested ones wait for a person; sharing to
lesson-learned stays fen's call). Checks 59/59.

Incident, same day: a submit of 12 items ran for ~11 s inside an `async def` route, blocking the event
loop; /health timed out (3 s) and Cloud Foundry restarted prod KH (about one minute of 503/404 for
everyone). Fix: the distil routes are plain `def`, so FastAPI runs them in its thread pool (contextvars
are copied, so the caller identity holds). Checks 59/59.
