# 2026-10-20 - sync from a HANA KH into a local (Chroma) KH no longer fails on object metadata

| Change | What it does | Where |
|---|---|---|
| Store-safe metadata | A giving KH on HANA keeps any JSON in metadata; Chroma takes only scalars, None and non-empty lists of one scalar type. Any other value (a list of objects such as `variants`, a dict, a mixed or empty list) is written as its JSON text instead of failing the whole page. | `sync.store_meta`, `sync.write_rows` |
| Tests | Scalars and one-type lists kept; objects, mixed and empty lists become JSON text; Chroma takes the stored metadata. | `tests/test_sync.py` |

Seen on 2026-10-19: the prod to local pull stopped at 24.7% on `lesson-learned` knowledge (`Expected metadata list value for key 'variants' ...`). With the fix the full pull of 25 projects (22,775 rows) finished with no error.
