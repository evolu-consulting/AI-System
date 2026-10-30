# 2026-09-24 - every database setting from the environment, and one switch for all stores

fen asked for the HANA fork of 2026-09-23 to be more dynamic: the database settings should
be configurable through environment variables. Most `HANA_*` values and the three backend
switches already were; what was not is listed below, and all of it now is. A variable
left unset keeps the value that was hardcoded before, so an install that changes nothing
behaves exactly as it did.

## What changed

- **`KH_DB_BACKEND` (new): one switch for all three stores.** `hana` moves the graph, KH's
  own tables and the vectors onto HANA; `local` is Kùzu + SQLite + Chroma without the HANA
  probe. It is a preset table in `app/config.py` (`_DB_PRESETS`), so another preset is a
  new row. A store's own variable (`GRAPH_BACKEND`, `KH_STORE_BACKEND`,
  `KH_VECTOR_BACKEND`) still wins when set, so the BTP manifest and every existing `.env`
  keep their meaning. An unknown preset stops startup and names the valid ones.
- **Settings that were hardcoded, now variables** (default = the old value):

  | Variable | Default | Was |
  |---|---|---|
  | `KH_SQLITE_TIMEOUT` | `10` | `sqldb.connect` lock wait, seconds |
  | `KH_SQLITE_WAL` | `true` | WAL pragma, always on |
  | `HANA_POOL_TIMEOUT` | `30` | stores pool wait, seconds |
  | `HANA_GRAPH_POOL_TIMEOUT` | `10` | graph pool wait, seconds |
  | `HANA_MAX_OVERFLOW` | `0` | set in `.env` but never read |
  | `HANA_POOL_RECYCLE` | `0` (off) | set in `.env` but never read |
  | `HANA_CONNECT_TIMEOUT_MS` | `0` (driver default) | not configurable |
  | `KH_GRAPH_TABLE_PREFIX` | `KH_` | graph tables; project graphs become `<prefix>P_<project>_...` |
  | `KH_HANA_VEC_COLLECTIONS_TABLE` | `KH_VEC_COLLECTIONS` | vector engine |
  | `KH_HANA_VEC_ROWS_TABLE` | `KH_VEC_ROWS` | vector engine |
  | `KH_DOCS_TABLE` | `kh_docs` | document store |

  Table names are spliced into SQL, so each is refused at startup unless it is a bare SQL
  identifier. Changing one on a live install points KH at an empty table; migrate first.
  The new numeric and flag settings treat a blank value (`KEY=` in `.env`) as "use the
  default" instead of failing to parse.
- **`HANA_SSL_VALIDATE` goes through `config`.** `hana_conn.py` used to read it with its own
  `os.getenv`, and the graph pool ignored it entirely.
- **One pool implementation.** The graph adapter's copy of the pool is gone; it now keeps
  its own instance of `hana_conn._Pool` (`set_schema=False`, because `bootstrap()` creates
  the schema) and builds connections from the same `hana_conn.connect_kwargs()`. The graph
  pool therefore gains the liveness check, overflow, recycle and certificate settings the
  stores pool has. The pool also gained a `connection()` context manager, which
  `hana_conn.connection()` now delegates to.

## Evidence

- `tests/test_db_config.py` (new, 39 checks): the preset and override order, defaults equal
  the old hardcoded values, every variable followed, identifier refusal (quote, space,
  leading digit, dash), graph prefix reaching project tables, SQLite WAL on and off,
  `connect_kwargs`, and the pool's overflow, timeout, recycle and SET SCHEMA behaviour
  against a fake driver. Each environment case runs in a fresh interpreter.
- Whole suite before and after: the same 7 files pass; `test_hotlog.py` fails the same way
  in both runs (`IndexError` in "recency is answerable with NO project named"), already
  failing before this change.
- Booted the fork with `KH_DB_BACKEND=local` on port 9207 against temp data: `/health` ok in
  19 s, the log shows Kùzu opened directly with no HANA probe, Chroma and a temp SQLite
  `hooks.db`; `/policy/actions` answered from that `hooks.db`.

## Not verified

- No live HANA was reachable from this machine, so the HANA side of the pool and the
  renamed tables were exercised only against the fake driver. `KH_TEST_HANA=1` with a
  service key runs the live part of `test_store_backends.py`.
