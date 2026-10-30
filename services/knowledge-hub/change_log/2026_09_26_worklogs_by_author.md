# 2026-09-26 - Worklogs by author, for maintainers

fen asked: as a maintainer, how do I tell which of many people's worklogs are Hugh's, e.g. "what
did Hugh do on Friday?". The server already stamped `metadata.author` from the token on every write,
but `/log/recent` only shows the caller's own window and the 3,957 rows copied from the old prod
store carried no author at all.

## What changed

- **`GET /log/by` (new, maintainer).** `author` (required), `since`, `until`, `project`, `limit`.
  Reads every worklog lane (each project's own log plus the hot window) for that author, keeps
  `since <= ts < until`, dedupes rows found in both places, sorts newest first. Bounds accept an
  offset, so a local day is one call.
- **`POST /log/backfill-author` (new, maintainer).** `{author, projects, apply}`. Stamps `author`
  on the named projects' worklogs that have none; rows that already carry one are never touched.
  Dry run by default; projects must be named. Worklogs only, because `author` on a knowledge-layer
  row means user/agent (app/layers.py).
- **`vector_store.fill_missing_field_vt` (new).** Metadata-only update, batched 500 per call, same
  shape as `backfill_topic_vt`.
- **`auth_rules.json`:** both routes `maintainer`.
- **Tests:** `tests/test_log_by_author.py`, 29 checks. Suite otherwise unchanged; the two
  `test_hotlog.py` failures predate this change.

## Ceiling

Both routes filter in Python over every worklog row (the HANA adapter filters metadata in Python
anyway). Fine for tens of thousands of rows. Upgrade path when that hurts: push `author` and `ts`
into HANA columns and filter in SQL.
