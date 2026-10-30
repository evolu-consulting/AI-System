"""HANA Cloud vector engine behind the slice of the ChromaDB API that KH uses.

WHY AN API-COMPATIBLE ADAPTER. Every vector caller in KH - vector_store, policy,
routing, feedback, hotlog, the /vector routes in main.py - works on Chroma collection
handles (``coll.get / query / upsert / update / delete / count``). Swapping the client
object in app/vector_store.py for :class:`HanaVectorClient` moves all of them onto HANA
without touching a single call site, which is the whole reason for this shape.

STORAGE. Two tables in HANA_SCHEMA:

    KH_VEC_COLLECTIONS (NAME PK, META, CREATED_AT)             one row per collection
    KH_VEC_ROWS        (COLL, ID, SEQ, EMB, DOC, META)          PK (COLL, ID)

EMB is a REAL_VECTOR (no fixed dimension, so a model swap does not need a DDL change);
META is the Chroma metadata as JSON text; SEQ keeps insertion order so paging by
offset is stable, the way Chroma's own ``get`` pages.

SIMILARITY runs in HANA with COSINE_SIMILARITY; the distance returned is 1 - similarity,
which is what Chroma's cosine space returns, so every caller's ``1.0 - distance`` keeps
producing the same score.

THE CEILING, stated rather than hidden: metadata filters (``where``) and document
filters (``where_document``) are evaluated in Python over the collection's metadata,
and the similarity search is then restricted to the ids that passed. That is exact and
simple, and it is fast at KH's scale (hundreds to low tens of thousands of rows per
collection). THE UPGRADE PATH when a collection outgrows it: translate ``where`` into
``JSON_VALUE(META, '$.field')`` predicates so HANA filters before it ranks.
"""
from __future__ import annotations

import json
import re
import logging
import time
from typing import Any, Iterable

from app import config, hana_conn

_logger = logging.getLogger(__name__)

# Table names come from config (KH_HANA_VEC_COLLECTIONS_TABLE / KH_HANA_VEC_ROWS_TABLE).
_COLLS = config.HANA_VEC_COLLECTIONS_TABLE
_ROWS = config.HANA_VEC_ROWS_TABLE
_IN_CHUNK = 500          # ids per IN (...) list
_DEFAULT_GET_INCLUDE = ("metadatas", "documents")
_DEFAULT_QUERY_INCLUDE = ("metadatas", "documents", "distances")


# --------------------------------------------------------------------------- helpers

def _vec_literal(vector: Iterable[float]) -> str:
    return "[" + ",".join(format(float(x), ".9g") for x in vector) + "]"


def _parse_vec(text) -> list[float] | None:
    text = hana_conn.lob_to_str(text)
    if text is None:
        return None
    return [float(x) for x in json.loads(text)]


def _load_meta(raw) -> dict:
    raw = hana_conn.lob_to_str(raw)
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _chunks(seq: list, n: int = _IN_CHUNK):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


_MISSING = object()


def _compare(value, op: str, arg) -> bool:
    if value is _MISSING:
        return False
    if op == "$eq":
        return value == arg
    if op == "$ne":
        return value != arg
    if op == "$in":
        return value in (arg or [])
    if op == "$nin":
        return value not in (arg or [])
    try:
        if op == "$gt":
            return value > arg
        if op == "$gte":
            return value >= arg
        if op == "$lt":
            return value < arg
        if op == "$lte":
            return value <= arg
    except TypeError:
        return False
    raise ValueError(f"unsupported where operator {op!r}")


def matches_where(meta: dict, where: dict | None) -> bool:
    """Chroma ``where`` semantics over one row's metadata. A missing field never matches."""
    if not where:
        return True
    for key, cond in where.items():
        if key == "$and":
            if not all(matches_where(meta, c) for c in cond):
                return False
        elif key == "$or":
            if not any(matches_where(meta, c) for c in cond):
                return False
        else:
            value = meta.get(key, _MISSING)
            if isinstance(cond, dict):
                if not all(_compare(value, op, arg) for op, arg in cond.items()):
                    return False
            elif not _compare(value, "$eq", cond):
                return False
    return True


_SAFE_KEY = re.compile(r"^[A-Za-z0-9_]{1,64}$")
# Flipped off the first time HANA refuses a JSON_VALUE filter, so a store that cannot run it
# keeps working the old way (every row's META read and matched in Python) instead of failing.
_json_filter_ok = True


def sql_filter(where: dict | None) -> tuple[str, list, bool]:
    """The part of a Chroma ``where`` that HANA can evaluate itself, as SQL.

    Returns (" AND ..." clause, params, exact). Only terms every matching row MUST satisfy are
    translated - top-level or ``$and`` string ``$eq``/``$in`` - so the clause never drops a row
    the Python matcher would keep. ``exact`` is True when nothing was left out; then the SQL alone
    decides and no row needs a second look. A missing field reads NULL and never matches, the same
    as Chroma. Anything else (``$or``, ``$ne``, numbers, ranges) stays with ``matches_where``.
    """
    if not where or not _json_filter_ok:
        return "", [], not where
    parts: list[str] = []
    params: list = []
    exact = True

    def term(key: str, cond) -> bool:
        if not _SAFE_KEY.match(key):
            return False
        path = f"JSON_VALUE(META, '$.{key}')"
        if isinstance(cond, str):
            parts.append(f"{path} = ?"); params.append(cond); return True
        if isinstance(cond, dict) and len(cond) == 1:
            op, arg = next(iter(cond.items()))
            if op == "$eq" and isinstance(arg, str):
                parts.append(f"{path} = ?"); params.append(arg); return True
            if op == "$in" and arg and all(isinstance(a, str) for a in arg) and len(arg) <= _IN_CHUNK:
                parts.append(f"{path} IN ({','.join('?' for _ in arg)})"); params.extend(arg); return True
        return False

    def walk(w: dict) -> None:
        nonlocal exact
        for key, cond in w.items():
            if key == "$and" and isinstance(cond, list):
                for c in cond:
                    walk(c)
            elif key.startswith("$") or not term(key, cond):
                exact = False

    walk(where)
    return ("".join(f" AND {p}" for p in parts), params, exact)


def _json_filter_failed(exc: Exception) -> None:
    global _json_filter_ok
    _json_filter_ok = False
    _logger.warning("HANA vector store: JSON_VALUE filters refused, matching in Python from now on: %s", exc)


def matches_document(doc: str | None, where_document: dict | None) -> bool:
    """Chroma ``where_document`` semantics: case-sensitive substring tests."""
    if not where_document:
        return True
    text = doc or ""
    for op, arg in where_document.items():
        if op == "$contains":
            if arg not in text:
                return False
        elif op == "$not_contains":
            if arg in text:
                return False
        elif op == "$and":
            if not all(matches_document(text, c) for c in arg):
                return False
        elif op == "$or":
            if not any(matches_document(text, c) for c in arg):
                return False
        else:
            raise ValueError(f"unsupported where_document operator {op!r}")
    return True


# --------------------------------------------------------------------------- schema

def bootstrap() -> None:
    """Create the two tables if absent. Idempotent."""
    with hana_conn.connection() as conn:
        cur = conn.cursor()
        try:
            if not hana_conn.table_exists(cur, _COLLS):
                cur.execute(f"""
                    CREATE COLUMN TABLE {_COLLS} (
                        NAME       NVARCHAR(256) PRIMARY KEY,
                        META       NCLOB,
                        CREATED_AT NVARCHAR(32)
                    )""")
                _logger.info("HANA vector store: created %s", _COLLS)
            if not hana_conn.table_exists(cur, _ROWS):
                cur.execute(f"""
                    CREATE COLUMN TABLE {_ROWS} (
                        COLL NVARCHAR(256) NOT NULL,
                        ID   NVARCHAR(512) NOT NULL,
                        SEQ  BIGINT GENERATED BY DEFAULT AS IDENTITY,
                        EMB  REAL_VECTOR,
                        DOC  NCLOB,
                        META NCLOB,
                        PRIMARY KEY (COLL, ID)
                    )""")
                _logger.info("HANA vector store: created %s", _ROWS)
        finally:
            cur.close()


# --------------------------------------------------------------------------- collection

class HanaCollection:
    """One named collection. Mirrors the Chroma Collection methods KH calls."""

    def __init__(self, name: str, metadata: dict | None = None):
        self.name = name
        self.metadata = metadata or {}

    def __repr__(self) -> str:
        return f"HanaCollection(name={self.name!r})"

    # ── reads ──────────────────────────────────────────────────────────────
    def count(self) -> int:
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(f"SELECT COUNT(*) FROM {_ROWS} WHERE COLL = ?", [self.name])
                return int(cur.fetchone()[0])
            finally:
                cur.close()

    def _select(self, cur, ids: list[str] | None, want_meta: bool, want_doc: bool,
                want_emb: bool, limit: int | None = None, offset: int = 0,
                where: dict | None = None) -> list[dict]:
        cols = ["ID"]
        if want_meta:
            cols.append("META")
        if want_doc:
            cols.append("DOC")
        if want_emb:
            cols.append("TO_NVARCHAR(EMB)")
        clause, clause_params, _ = sql_filter(where)
        base = f"SELECT {', '.join(cols)} FROM {_ROWS} WHERE COLL = ?{clause}"
        out: list[dict] = []

        def _read(rows):
            for r in rows:
                i = 1
                item = {"id": r[0]}
                if want_meta:
                    item["meta"] = _load_meta(r[i]); i += 1
                if want_doc:
                    item["doc"] = hana_conn.lob_to_str(r[i]); i += 1
                if want_emb:
                    item["emb"] = _parse_vec(r[i]); i += 1
                out.append(item)

        if ids is not None:
            order = {cid: n for n, cid in enumerate(ids)}
            for part in _chunks(list(dict.fromkeys(ids))):
                cur.execute(base + f" AND ID IN ({','.join('?' for _ in part)})",
                            [self.name, *clause_params, *part])
                _read(cur.fetchall())
            out.sort(key=lambda x: order.get(x["id"], 0))
            return out
        sql = base + " ORDER BY SEQ"
        params: list[Any] = [self.name, *clause_params]
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params += [int(limit), int(offset or 0)]
        elif offset:
            sql += " LIMIT 2147483647 OFFSET ?"
            params += [int(offset)]
        cur.execute(sql, params)
        _read(cur.fetchall())
        return out

    def get(self, ids: list[str] | None = None, where: dict | None = None,
            limit: int | None = None, offset: int | None = None,
            where_document: dict | None = None, include: list[str] | None = None) -> dict:
        include = list(_DEFAULT_GET_INCLUDE if include is None else include)
        filtered = bool(where or where_document)
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                def select():
                    return self._select(
                        cur, ids,
                        want_meta="metadatas" in include or bool(where),
                        want_doc="documents" in include or bool(where_document),
                        want_emb="embeddings" in include,
                        limit=None if filtered else limit,
                        offset=0 if filtered else (offset or 0),
                        where=where,
                    )
                try:
                    rows = select()
                except Exception as exc:
                    if not (where and _json_filter_ok):
                        raise
                    _json_filter_failed(exc)
                    rows = select()
            finally:
                cur.close()
        if filtered:
            rows = [r for r in rows
                    if matches_where(r.get("meta", {}), where)
                    and matches_document(r.get("doc"), where_document)]
            start = int(offset or 0)
            rows = rows[start:start + limit] if limit is not None else rows[start:]
        return {
            "ids": [r["id"] for r in rows],
            "metadatas": [r.get("meta", {}) for r in rows] if "metadatas" in include else None,
            "documents": [r.get("doc") for r in rows] if "documents" in include else None,
            "embeddings": [r.get("emb") for r in rows] if "embeddings" in include else None,
            "include": include,
        }

    def field_values(self, field: str, where: dict | None = None) -> list[tuple[str, Any]]:
        """(id, metadata[field]) of every row matching ``where``, without reading DOC or META.

        A recency read sorts a whole partition by one field and keeps a page of it; reading every
        row's text to do that cost about 5 s on the ticketing log (2026-10-03). When HANA can
        evaluate the filter whole, only the ids and that one value leave the database; otherwise
        it falls back to reading META and matching in Python, like ``get``.
        """
        if not _SAFE_KEY.match(field):
            raise ValueError(f"unsupported metadata field {field!r}")
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                clause, params, exact = sql_filter(where)
                if exact and _json_filter_ok:
                    try:
                        cur.execute(f"SELECT ID, JSON_VALUE(META, '$.{field}') FROM {_ROWS} "
                                    f"WHERE COLL = ?{clause} ORDER BY SEQ", [self.name, *params])
                        return [(r[0], r[1]) for r in cur.fetchall()]
                    except Exception as exc:
                        _json_filter_failed(exc)
                rows = self._select(cur, None, want_meta=True, want_doc=False, want_emb=False, where=where)
            finally:
                cur.close()
        return [(r["id"], r["meta"].get(field)) for r in rows if matches_where(r["meta"], where)]

    def query(self, query_embeddings: list[list[float]], n_results: int = 10,
              where: dict | None = None, where_document: dict | None = None,
              include: list[str] | None = None) -> dict:
        include = list(_DEFAULT_QUERY_INCLUDE if include is None else include)
        n = max(1, int(n_results))
        out = {"ids": [], "distances": [], "metadatas": [], "documents": [], "embeddings": []}
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            def run():
                # A filter HANA can evaluate whole is put straight into the ranking query: one
                # statement filters and ranks, and no row's META leaves the database. Otherwise the
                # SQL part narrows the candidates and Python decides the rest, as before.
                candidates: list[str] | None = None
                filt: tuple[str, list] = ("", [])
                if where or where_document:
                    clause, params, exact = sql_filter(where)
                    if exact and not where_document:
                        filt = (clause, params)
                    else:
                        rows = self._select(cur, None, want_meta=True,
                                            want_doc=bool(where_document), want_emb=False, where=where)
                        candidates = [r["id"] for r in rows
                                      if matches_where(r["meta"], where)
                                      and matches_document(r.get("doc"), where_document)]
                result = {"ids": [], "distances": [], "metadatas": [], "documents": [], "embeddings": []}
                for qv in query_embeddings:
                    hits = self._rank(cur, qv, n, candidates, include, filt)
                    result["ids"].append([h[0] for h in hits])
                    result["distances"].append([h[1] for h in hits])
                    result["metadatas"].append([h[2] for h in hits])
                    result["documents"].append([h[3] for h in hits])
                    result["embeddings"].append([h[4] for h in hits])
                return result
            try:
                try:
                    out = run()
                except Exception as exc:
                    if not (where and _json_filter_ok):
                        raise
                    _json_filter_failed(exc)
                    out = run()
            finally:
                cur.close()
        for key in ("metadatas", "documents", "embeddings", "distances"):
            if key not in include:
                out[key] = None
        return out

    def _rank(self, cur, qv, n: int, candidates: list[str] | None, include: list[str],
              filt: tuple[str, list] = ("", [])):
        vec = _vec_literal(qv)
        extra = ", META, DOC" + (", TO_NVARCHAR(EMB)" if "embeddings" in include else "")
        base = (f"SELECT TOP {n} ID, COSINE_SIMILARITY(EMB, TO_REAL_VECTOR(?)) AS SIM{extra} "
                f"FROM {_ROWS} WHERE COLL = ? AND EMB IS NOT NULL{filt[0]}")
        found: list[tuple] = []
        if candidates is None:
            cur.execute(base + " ORDER BY SIM DESC", [vec, self.name, *filt[1]])
            found = cur.fetchall()
        else:
            for part in _chunks(candidates):
                cur.execute(base + f" AND ID IN ({','.join('?' for _ in part)}) ORDER BY SIM DESC",
                            [vec, self.name, *part])
                found.extend(cur.fetchall())
            found.sort(key=lambda r: -float(r[1]))
            found = found[:n]
        hits = []
        for r in found:
            emb = _parse_vec(r[4]) if "embeddings" in include else None
            hits.append((r[0], round(1.0 - float(r[1]), 9), _load_meta(r[2]),
                         hana_conn.lob_to_str(r[3]), emb))
        return hits

    # ── writes ─────────────────────────────────────────────────────────────
    def _existing(self, cur, ids: list[str]) -> set[str]:
        have: set[str] = set()
        for part in _chunks(list(dict.fromkeys(ids))):
            cur.execute(f"SELECT ID FROM {_ROWS} WHERE COLL = ? AND ID IN "
                        f"({','.join('?' for _ in part)})", [self.name, *part])
            have.update(r[0] for r in cur.fetchall())
        return have

    def upsert(self, ids: list[str], embeddings: list[list[float]] | None = None,
               metadatas: list[dict] | None = None, documents: list[str] | None = None) -> None:
        self._write(ids, embeddings, metadatas, documents, insert_missing=True)

    def add(self, ids: list[str], embeddings: list[list[float]] | None = None,
            metadatas: list[dict] | None = None, documents: list[str] | None = None) -> None:
        self._write(ids, embeddings, metadatas, documents, insert_missing=True)

    def update(self, ids: list[str], embeddings: list[list[float]] | None = None,
               metadatas: list[dict] | None = None, documents: list[str] | None = None) -> None:
        self._write(ids, embeddings, metadatas, documents, insert_missing=False)

    def _write(self, ids, embeddings, metadatas, documents, insert_missing: bool) -> None:
        ids = [str(i) for i in (ids or [])]
        if not ids:
            return
        for name, seq in (("embeddings", embeddings), ("metadatas", metadatas),
                          ("documents", documents)):
            if seq is not None and len(seq) != len(ids):
                raise ValueError(f"{name} has {len(seq)} items for {len(ids)} ids")
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                have = self._existing(cur, ids)
                inserts, updates = [], []
                for n, cid in enumerate(ids):
                    emb = _vec_literal(embeddings[n]) if embeddings is not None else None
                    meta = (json.dumps(metadatas[n] or {}, ensure_ascii=False)
                            if metadatas is not None else None)
                    doc = documents[n] if documents is not None else None
                    if cid in have:
                        updates.append((cid, emb, meta, doc))
                    elif insert_missing:
                        if emb is None:
                            raise ValueError(f"cannot insert {cid!r} without an embedding")
                        inserts.append((self.name, cid, emb, doc, meta or "{}"))
                if inserts:
                    cur.executemany(
                        f"INSERT INTO {_ROWS} (COLL, ID, EMB, DOC, META) "
                        f"VALUES (?, ?, TO_REAL_VECTOR(?), ?, ?)", inserts)
                for cid, emb, meta, doc in updates:
                    sets, params = [], []
                    if emb is not None:
                        sets.append("EMB = TO_REAL_VECTOR(?)"); params.append(emb)
                    if meta is not None:
                        sets.append("META = ?"); params.append(meta)
                    if doc is not None:
                        sets.append("DOC = ?"); params.append(doc)
                    if sets:
                        cur.execute(f"UPDATE {_ROWS} SET {', '.join(sets)} "
                                    f"WHERE COLL = ? AND ID = ?", [*params, self.name, cid])
            finally:
                cur.close()

    def delete(self, ids: list[str] | None = None, where: dict | None = None,
               where_document: dict | None = None) -> None:
        if ids is None and not (where or where_document):
            return
        if where or where_document:
            ids = self.get(ids=ids, where=where, where_document=where_document,
                           include=[])["ids"]
        ids = [str(i) for i in (ids or [])]
        if not ids:
            return
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                for part in _chunks(ids):
                    cur.execute(f"DELETE FROM {_ROWS} WHERE COLL = ? AND ID IN "
                                f"({','.join('?' for _ in part)})", [self.name, *part])
            finally:
                cur.close()


# --------------------------------------------------------------------------- client

class HanaVectorClient:
    """Stands in for ``chromadb.PersistentClient`` in app/vector_store.py."""

    def __init__(self):
        bootstrap()

    def get_or_create_collection(self, name: str, metadata: dict | None = None,
                                 **_ignored) -> HanaCollection:
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(f"SELECT META FROM {_COLLS} WHERE NAME = ?", [name])
                row = cur.fetchone()
                if row is not None:
                    return HanaCollection(name, _load_meta(row[0]))
                cur.execute(f"INSERT INTO {_COLLS} (NAME, META, CREATED_AT) VALUES (?, ?, ?)",
                            [name, json.dumps(metadata or {}),
                             time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())])
            finally:
                cur.close()
        return HanaCollection(name, metadata)

    def get_collection(self, name: str, **_ignored) -> HanaCollection:
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(f"SELECT META FROM {_COLLS} WHERE NAME = ?", [name])
                row = cur.fetchone()
            finally:
                cur.close()
        if row is None:
            raise ValueError(f"Collection {name} does not exist.")
        return HanaCollection(name, _load_meta(row[0]))

    def list_collections(self) -> list[HanaCollection]:
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(f"SELECT NAME, META FROM {_COLLS} ORDER BY NAME")
                rows = cur.fetchall()
            finally:
                cur.close()
        return [HanaCollection(r[0], _load_meta(r[1])) for r in rows]

    def delete_collection(self, name: str) -> None:
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(f"DELETE FROM {_COLLS} WHERE NAME = ?", [name])
                gone = cur.rowcount
                cur.execute(f"DELETE FROM {_ROWS} WHERE COLL = ?", [name])
            finally:
                cur.close()
        if not gone:
            raise ValueError(f"Collection {name} does not exist.")
