# 2026-09-30 - HANA: metadata filters run in the database

## Why

Every similar search carries a `where` (knowledge_type, scope, often project or topic). The HANA
backend answered it by reading the META of EVERY row in the collection into Python, matching there,
then ranking the survivors in `ID IN (...)` batches. The cost grew with the collection, and it is
most of the 2.5 s measured for `/vector/query` on prod on 2026-09-29.

## What changed

`app/vector_hana.py`:

- `sql_filter(where)` translates the part of a Chroma `where` every matching row must satisfy -
  top-level or `$and` string `$eq`/`$in` - into `JSON_VALUE(META, '$.key')` clauses. It never
  drops a row the Python matcher would keep; `exact` says whether anything was left out.
- `query()`: an exact filter goes straight into the ranking statement, so one query filters and
  ranks and no META leaves the database. Otherwise the SQL part narrows the candidates and
  `matches_where` decides the rest, as before.
- `get()` and `_select()` apply the same narrowing.
- If HANA ever refuses `JSON_VALUE`, the store logs it once and goes back to matching in Python.

## Not done, and why (corrected the same day after measuring)

The first version of this entry said an HNSW index needs a fixed-dimension column. Measured on the
br10 HANA Cloud (build 4.00.000.00.1787043349) that is wrong: `CREATE HNSW VECTOR INDEX ... ON
KH_VEC_ROWS(EMB) SIMILARITY FUNCTION COSINE_SIMILARITY` succeeds on the dimension-less column. But
EXPLAIN PLAN of KH's ranking query shows `TOP K SORT` (an exact scan) with or without the COLL
filter, so the optimizer does not use the index for this statement shape. Ranking stays exact;
fine to tens of thousands of rows per collection. Upgrade path: find the statement form or hint
that makes HANA pick the index, then create it at bootstrap.

## Checks

`tests/test_store_backends.py` gains `test_sql_filter` (7 checks); 47/47.
