"""Namespace lifecycle: detach side effects, export, import, purge and retention (design 3.6, 6.3, slice F13).

  POST /v1/admin/ns/{ns}:detach | :reattach        (registry.set_state; this module adds the outbox side effect)
  GET  /v1/admin/ns/{ns}:export?include_vault=     streamed zip, namespace admin or KH maintainer, any state but purged
  POST /v1/admin/ns:import?ns=&rebuild=sync|async  body = the zip; restores into a CLEAN namespace id (same or new)
  POST /v1/admin/ns/{ns}:purge {confirm|force}     detached namespaces only; confirm = token of a completed export
  POST /v1/admin/agents:stop | agents:resume        KH maintainer only (phase 4 global stop, see below)

GLOBAL STOP (docs/roadmap-e-to-5-design.md 6.2). ``agents:stop`` suspends every ACTIVE namespace except those in
``STOP_EXEMPT`` (``kh_people``) in ONE transaction, saves the state it left in ``kh_ns.config_json.stopped_from``
and bumps every lease epoch of those namespaces (holders cleared, so a write fenced at an old epoch is 409
stale_epoch). Every agent write then answers 423 ns_suspended on every instance within the state cache bound
(KH_NS_CACHE_S, 5 s). ``agents:resume`` restores, in one transaction, only the namespaces the stop suspended (a
namespace suspended by hand before the stop stays suspended) and bumps their epochs again. Each change writes
``kh.ns_state`` (reason ``agents:stop`` / ``agents:resume``) to the namespace and to ``_kh``. Nothing runs unless
a maintainer calls the route.

DISCOVERY. Nothing here names another module's tables. Every module in ``caps.MODULES`` lists its tables in
``TABLES`` (fallback: the keys of its ``_DDL`` dict); a table takes part when it exists and has an ``ns``
column. Core rows: ``kh_lease`` (by ns) and ``kh_counter`` (names with an ``:<ns>`` segment, written to the
archive as ``{ns}`` so an import can rename the namespace). ``kh_ns`` itself travels as ``manifest.json``.

ARCHIVE. ``manifest.json`` (format, namespace row, module versions and applied migrations, file plan, the
confirmation token), ``tables/<table>.ndjson`` (rows without the ``ns`` column, ordered by primary key, one
canonical JSON object per line), ``_kh/kh_event_week.ndjson`` (weekly rollups of purged events),
``vectors/<suffix>.ndjson`` (collection ``ns_<ns>_<suffix>``: id, text, metadata - never embeddings) and
``checksums.json`` (sha256 and line count per file). Because rows carry no ns, an archive imported under
another id re-exports byte-identical table files: that is the import's acceptance check. Vault tables
(module ``vault``) are written only for ``include_vault=true`` (the route is admin-only) and the read is
recorded as ``kh.vault_read``. The zip is written to the response through a small buffer, one page of rows
at a time: no full copy in memory.

PURGE. The conditional UPDATE ``state detached -> purged`` decides the one purge that runs (a second answers
409). Rows are then deleted per table in batches of 5,000 (each batch its own transaction), the rule graph
databases ``<ns>__*`` (Kuzu directory or HANA prefix tables) and vector collections ``ns_<ns>_*`` are
dropped, the modules' ``ON_STATE`` hooks run with ``new='purged'``, and ``kh.ns_state`` goes to ``_kh``.
While a purge runs ``purge_after_ms`` holds its start; the cron resumes a purge that stopped half way.

RETENTION (cron, under a ``_kh`` lease). Events older than their type's ``retention_days`` (kinds without a
type, such as ``kh.*``: manifest ``retention.events_days``, default KH_EVENTS_RETENTION_DAYS, 180; ``null`` on a
type = keep) are counted into ``kh_event_week(ns, project, kind, week)`` and deleted in the same transaction, 5,000
per batch; a batch whose delete count differs from its selection (a concurrent sweeper) rolls back, so nothing is
counted twice. Detached namespaces are skipped. KH's own operational events (namespace ``KH_EVENTS_NS``,
app/eventing/emit.py, in no kh_ns row) are swept too, with that default. A second cron purges namespaces past their
grace period.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import hashlib
import importlib
import json
import logging
import os
import secrets
import tempfile
import threading
import zipfile
from collections import Counter
from typing import Any, Iterable, Iterator

from fastapi import Request
from fastapi.responses import StreamingResponse

from app import config, sqldb
from app.caps import core, registry
from app.caps.core import CapError
from app.eventing import emit

logger = logging.getLogger(__name__)

NAME = "lifecycle"
VERSION = "1.0.0"
STATUS = "beta"
FORMAT = "kh-ns-export/1"
BATCH = int(config._env("KH_PURGE_BATCH", "5000"))
PAGE = 1000
CHUNK = 256 * 1024
IMPORT_MAX = int(config._env("KH_IMPORT_MAX_BYTES", str(8 * 1024 ** 3)))
EVENTS_DAYS_DEFAULT = registry.EVENTS_DAYS     # KH_EVENTS_RETENTION_DAYS, default 180
RESUME_AFTER_MS = 3600 * 1000
LIMITS = {"purge_batch": BATCH, "export_page_rows": PAGE, "import_max_bytes": IMPORT_MAX,
          "events_retention_days_default": EVENTS_DAYS_DEFAULT}

CORE_TABLES = ["kh_lease"]                 # sqldb core tables keyed by ns
NOT_EXPORTED = {"kh_ns", "kh_ns_export"}   # kh_ns travels as manifest.json; export tokens stay local
ROLLUPS = {"kh_event_week"}                # written under _kh/
SEALED_MODULES = {"vault"}                 # exported only with include_vault=true
NS_TOKEN = "{ns}"
_STRIP_META = {"emb_model", "emb_ver", "emb_dim", "source_text"}

_DDL = {
    "kh_event_week": ("""CREATE TABLE IF NOT EXISTS kh_event_week (
                           ns TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL, week TEXT NOT NULL,
                           n INTEGER NOT NULL, PRIMARY KEY (ns, project, kind, week))""",
                      """CREATE COLUMN TABLE kh_event_week (
                           ns NVARCHAR(32) NOT NULL, project NVARCHAR(256) NOT NULL, kind NVARCHAR(128) NOT NULL,
                           week NVARCHAR(10) NOT NULL, n BIGINT NOT NULL, PRIMARY KEY (ns, project, kind, week))"""),
    "kh_ns_export": ("""CREATE TABLE IF NOT EXISTS kh_ns_export (
                          ns TEXT NOT NULL, export_id TEXT NOT NULL, token_sha TEXT NOT NULL,
                          include_vault INTEGER NOT NULL, state_at_export TEXT NOT NULL, actor TEXT NOT NULL,
                          created_ms INTEGER NOT NULL, completed_ms INTEGER, checksums_json TEXT,
                          PRIMARY KEY (ns, export_id))""",
                     """CREATE COLUMN TABLE kh_ns_export (
                          ns NVARCHAR(32) NOT NULL, export_id NVARCHAR(32) NOT NULL, token_sha NVARCHAR(64) NOT NULL,
                          include_vault TINYINT NOT NULL, state_at_export NVARCHAR(16) NOT NULL,
                          actor NVARCHAR(256) NOT NULL, created_ms BIGINT NOT NULL, completed_ms BIGINT,
                          checksums_json NCLOB, PRIMARY KEY (ns, export_id))"""),
}
TABLES = list(_DDL)


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── table discovery ──────────────────────────────────────────────────────────

def _modules() -> list:
    from app import caps
    out = []
    for path in caps.MODULES:
        try:
            out.append(importlib.import_module(path))
        except Exception:  # noqa: BLE001 - a module being written must not break export of the others
            logger.exception("lifecycle - cannot import %s", path)
    return out


def local_tables() -> set[str]:
    """Tables the modules declare ``LOCAL_TABLES``: derived, instance-local state (e.g. the rule graph projection
    state) that an export leaves out and an import rebuilds; purge still empties them."""
    return {str(t) for mod in _modules() for t in (getattr(mod, "LOCAL_TABLES", None) or [])}


def module_tables(mod) -> list[str]:
    t = getattr(mod, "TABLES", None)
    if t is None:
        ddl = getattr(mod, "_DDL", None)
        t = list(ddl) if isinstance(ddl, dict) else []
    return [str(x) for x in t]


def _columns(c, table: str) -> tuple[list[str], list[str]]:
    """(columns in table order, primary key columns in key order); ([], []) when the table does not exist."""
    if sqldb.is_hana():
        cols = [r[0].lower() for r in c.execute(
            "SELECT COLUMN_NAME FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME=CURRENT_SCHEMA AND TABLE_NAME=? "
            "ORDER BY POSITION", [table.upper()]).fetchall()]
        pk = [r[0].lower() for r in c.execute(
            "SELECT COLUMN_NAME FROM SYS.CONSTRAINTS WHERE SCHEMA_NAME=CURRENT_SCHEMA AND TABLE_NAME=? "
            "AND IS_PRIMARY_KEY='TRUE' ORDER BY POSITION", [table.upper()]).fetchall()]
        return cols, pk
    rows = c.execute(f"PRAGMA table_info({table})").fetchall()
    cols = [r[1] for r in rows]
    pk = [r[1] for r in sorted((r for r in rows if r[5]), key=lambda r: r[5])]
    return cols, pk


def discover(c=None) -> list[dict]:
    """[{table, module, columns, pk}] for every existing table with an ns column (registration order)."""
    if c is None:
        with sqldb.connect() as cc:
            return discover(cc)
    sqldb.ensure_core(c)
    entries = [("core", t) for t in CORE_TABLES]
    for mod in _modules():
        entries += [(getattr(mod, "NAME", mod.__name__), t) for t in module_tables(mod)]
    out, seen = [], set()
    for module, t in entries:
        if t in seen:
            continue
        seen.add(t)
        cols, pk = _columns(c, t)
        if "ns" not in cols:
            continue
        out.append({"table": t, "module": module, "columns": cols, "pk": pk or cols})
    return out


def _all_ns(c) -> set[str]:
    return {r[0] for r in c.execute("SELECT ns FROM kh_ns").fetchall()}


def _counter_names(c, ns: str) -> list[str]:
    """kh_counter names that belong to ``ns``: the second segment is ns ('ev:<ns>', 'pkv:<ns>:<pack>'), or the
    last one is and the second is no other namespace ('principals:active:<ns>')."""
    esc = ns.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    names = [r[0] for r in c.execute("SELECT name FROM kh_counter WHERE name LIKE ? ESCAPE '\\' ORDER BY name",
                                     ["%:" + esc + "%"]).fetchall()]
    others = _all_ns(c) - {ns}
    out = []
    for n in names:
        seg = n.split(":")
        if (len(seg) > 1 and seg[1] == ns) or (len(seg) > 2 and seg[-1] == ns and seg[1] not in others):
            out.append(n)
    return out


def _tokenize(name: str, ns: str) -> str:
    return ":".join(NS_TOKEN if s == ns else s for s in name.split(":"))


def _untokenize(name: str, ns: str) -> str:
    return ":".join(ns if s == NS_TOKEN else s for s in name.split(":"))


def _collections(ns: str) -> list[str]:
    try:
        from app import vector_store as vs
        return sorted(n for n in vs.existing_collection_names() if n.startswith(f"ns_{ns}_"))
    except Exception:  # noqa: BLE001
        logger.exception("lifecycle - cannot list vector collections")
        return []


# ── canonical rows (export and the import check use the same serializer) ─────

def _line(obj: dict) -> bytes:
    return (core.jdump(obj) + "\n").encode("utf-8")


def iter_rows(t: dict, ns: str) -> Iterator[dict]:
    """Rows of ``ns`` in primary-key order without the ns column, read a page at a time (keyset paging)."""
    cols = [x for x in t["columns"] if x != "ns"]
    rest = [k for k in t["pk"] if k != "ns"]
    order = ", ".join(rest) if rest else "ns"
    last = None
    while True:
        where, params = "ns=?", [ns]
        if last is not None:
            ors = []
            for i in range(len(rest)):
                ors.append("(" + " AND ".join([f"{rest[j]}=?" for j in range(i)] + [f"{rest[i]}>?"]) + ")")
                params += [last[j] for j in range(i)] + [last[i]]
            where += " AND (" + " OR ".join(ors) + ")"
        with sqldb.connect() as c:
            rows = c.execute(f"SELECT {', '.join(cols) or 'ns'} FROM {t['table']} WHERE {where} ORDER BY {order} "
                             f"LIMIT {PAGE}", params).fetchall()
        for r in rows:
            yield {k: r[k] for k in cols}
        if len(rows) < PAGE or not rest:
            return
        last = [rows[-1][k] for k in rest]


def iter_counters(ns: str) -> Iterator[dict]:
    with sqldb.connect() as c:
        sqldb.ensure_core(c)
        names = _counter_names(c, ns)
        rows = [(n, sqldb.counter_get(c, n)) for n in names]
    for n, v in rows:
        yield {"name": _tokenize(n, ns), "n": int(v)}


def iter_vectors(ns: str, name: str) -> Iterator[dict]:
    """id, text and metadata of a collection in id order - never the embedding."""
    from app import vector_store as vs
    coll = vs.get_or_create(name)
    ids = sorted(coll.get(include=[]).get("ids") or [])
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        res = coll.get(ids=part, include=["metadatas", "documents"])
        got = {}
        for j, vid in enumerate(res.get("ids") or []):
            meta = dict((res.get("metadatas") or [None] * (j + 1))[j] or {})
            doc = (res.get("documents") or [None] * (j + 1))[j] or meta.get("source_text") or ""
            got[vid] = (doc, meta)
        for vid in part:
            if vid not in got:
                continue
            doc, meta = got[vid]
            meta = {k: (NS_TOKEN if k == "ns" and v == ns else v) for k, v in meta.items() if k not in _STRIP_META}
            yield {"id": vid, "text": doc, "metadata": meta}


def _digest(lines: Iterable[dict]) -> tuple[str, int]:
    h, n = hashlib.sha256(), 0
    for obj in lines:
        h.update(_line(obj))
        n += 1
    return h.hexdigest(), n


# ── export ───────────────────────────────────────────────────────────────────

class _Sink:
    """A write-only file for zipfile: the zip lands here and the generator hands it out chunk by chunk."""

    def __init__(self):
        self.buf = bytearray()

    def write(self, b) -> int:
        self.buf += b
        return len(b)

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        out = bytes(self.buf)
        self.buf.clear()
        return out


def _ns_row(c, ns: str) -> dict:
    r = c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
    if r is None:
        raise CapError("not_found", f"no namespace {ns}")
    return dict(r)


def _migrations(c) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for r in c.execute("SELECT module, version FROM kh_schema_migration ORDER BY module, version").fetchall():
        out.setdefault(r[0], []).append(int(r[1]))
    return out


def plan_export(ns: str, include_vault: bool, request: Request | None) -> dict:
    """Authorize, record the export (its confirmation token) and build the manifest and the file plan."""
    with sqldb.connect() as c:
        raw = _ns_row(c, ns)
        row = registry._decode_ns(raw)
        who = registry._admin_person(request, row["projects"], row) if request is not None else "kh"
        if row["state"] == "purged":
            raise CapError("ns_not_active", f"namespace {ns} was purged")
    if include_vault:                      # recorded before the rows are read, so the archive holds the evidence
        core.emit(ns, "kh.vault_read", {"via": "export", "principal": who}, {"principal": who, "role": "admin"})
    token, export_id = secrets.token_urlsafe(24), secrets.token_hex(8)
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        tables = discover(c)
        mods = {}
        applied = _migrations(c)
        for mod in _modules():
            mods[mod.NAME] = {"version": getattr(mod, "VERSION", None), "migrations": applied.get(mod.NAME, []),
                              "tables": module_tables(mod)}
        sqldb.insert_new(c, "kh_ns_export", {
            "ns": ns, "export_id": export_id, "token_sha": hashlib.sha256(token.encode()).hexdigest(),
            "include_vault": int(bool(include_vault)), "state_at_export": row["state"], "actor": who,
            "created_ms": now, "completed_ms": None, "checksums_json": None})
    files: dict[str, dict] = {}
    plan: list[tuple[str, dict]] = []
    local = local_tables()
    for t in tables:
        if t["table"] in NOT_EXPORTED or t["table"] in local or (t["module"] in SEALED_MODULES and not include_vault):
            continue
        path = ("_kh/" if t["table"] in ROLLUPS else "tables/") + t["table"] + ".ndjson"
        files[path] = {"kind": "rollup" if t["table"] in ROLLUPS else "table", "table": t["table"],
                       "module": t["module"], "columns": [x for x in t["columns"] if x != "ns"],
                       "pk": [x for x in t["pk"] if x != "ns"]}
        plan.append((path, t))
    files["tables/kh_counter.ndjson"] = {"kind": "counters", "table": "kh_counter", "module": "core",
                                         "columns": ["name", "n"], "pk": ["name"]}
    for name in _collections(ns):
        files[f"vectors/{name[len(f'ns_{ns}_'):]}.ndjson"] = {"kind": "vectors", "collection_suffix":
                                                               name[len(f"ns_{ns}_"):]}
    manifest = {
        "format": FORMAT, "export_id": export_id, "ns": ns, "exported_ms": now, "kh_version": config.KH_VERSION,
        "include_vault": bool(include_vault), "state_at_export": row["state"], "confirm_token": token,
        "namespace": {k: raw[k] for k in ("display", "owner_email", "projects_json", "config_json", "manifest_json",
                                          "manifest_sha", "manifest_rev", "created_ms")},
        "modules": mods, "files": files,
        "notes": "rows carry no ns column; '{ns}' in counter names and vector metadata stands for the namespace; "
                 "vectors are text and metadata only and are re-embedded on import"}
    return {"ns": ns, "export_id": export_id, "token": token, "manifest": manifest, "plan": plan}


def export_chunks(p: dict) -> Iterator[bytes]:
    """The zip, a chunk at a time. Marks the export completed (its token valid for :purge) at the end."""
    ns, manifest = p["ns"], p["manifest"]
    sink = _Sink()
    sums: dict[str, dict] = {}
    zf = zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True)

    def put(path: str, objs: Iterable[Any], raw: bool = False) -> Iterator[bytes]:
        h, n = hashlib.sha256(), 0
        with zf.open(path, "w", force_zip64=True) as f:
            for obj in objs:
                b = obj if raw else _line(obj)
                f.write(b)
                h.update(b)
                n += 1
                if len(sink.buf) >= CHUNK:
                    yield sink.take()
        sums[path] = {"sha256": h.hexdigest(), "rows": n if not raw else None}
        if sink.buf:
            yield sink.take()

    yield from put("manifest.json", [json.dumps(manifest, indent=1, sort_keys=True).encode("utf-8")], raw=True)
    for path, t in p["plan"]:
        yield from put(path, iter_rows(t, ns))
    yield from put("tables/kh_counter.ndjson", iter_counters(ns))
    for path, f in manifest["files"].items():
        if f["kind"] == "vectors":
            yield from put(path, iter_vectors(ns, f"ns_{ns}_{f['collection_suffix']}"))
    body = {"algorithm": "sha256", "export_id": p["export_id"], "files": sums}
    zf.writestr("checksums.json", json.dumps(body, indent=1, sort_keys=True))
    zf.close()
    yield sink.take()
    with sqldb.connect() as c:
        c.execute("UPDATE kh_ns_export SET completed_ms=?, checksums_json=? WHERE ns=? AND export_id=?",
                  [sqldb.now_ms(c), core.jdump(sums), ns, p["export_id"]])


# ── purge ────────────────────────────────────────────────────────────────────

def _delete_batched(c_factory, t: dict, ns: str) -> int:
    """Delete every row of ns from one table, BATCH rows per transaction."""
    total = 0
    while True:
        with c_factory() as c:
            if sqldb.is_hana():
                pk = t["pk"]
                keys = [tuple(r[k] for k in pk) for r in c.execute(
                    f"SELECT {', '.join(pk)} FROM {t['table']} WHERE ns=? LIMIT {BATCH}", [ns]).fetchall()]
                n = 0
                for i in range(0, len(keys), 100):
                    part = keys[i:i + 100]
                    cond = " OR ".join("(" + " AND ".join(f"{k}=?" for k in pk) + ")" for _ in part)
                    n += sqldb.update(c, f"DELETE FROM {t['table']} WHERE ns=? AND ({cond})",
                                      [ns] + [v for key in part for v in key])
            else:
                n = sqldb.update(c, f"DELETE FROM {t['table']} WHERE rowid IN "
                                    f"(SELECT rowid FROM {t['table']} WHERE ns=? LIMIT {BATCH})", [ns])
        total += n
        if n == 0:
            return total


def delete_ns_rows(ns: str, keep: Iterable[str] = ("kh_ns",)) -> dict[str, int]:
    """Batch-delete every row of a namespace in every discovered table (and its counters)."""
    out: dict[str, int] = {}
    keep = set(keep)
    for t in discover():
        if t["table"] in keep:
            continue
        n = _delete_batched(sqldb.connect, t, ns)
        if n:
            out[t["table"]] = n
    with sqldb.connect() as c:
        names = _counter_names(c, ns)
        for n in names:
            sqldb.counter_delete(c, n)
    if names:
        out["kh_counter"] = len(names)
    return out


def _graph_ids(ns: str, projects: set[str]) -> list[str]:
    ids = {f"{ns}__{p or '_'}" for p in projects}
    root = getattr(config, "KUZU_PROJECTS_PATH", None)
    if root and os.path.isdir(root):
        ids |= {d for d in os.listdir(root) if d.startswith(f"{ns}__")}
    return sorted(ids)


def drop_derived(ns: str, projects: set[str]) -> dict:
    """Drop the graph databases <ns>__* and the vector collections ns_<ns>_*."""
    graphs, colls = [], []
    try:
        from app.graph_db.project_graph import drop_project_graph
        for gid in _graph_ids(ns, projects):
            try:
                if drop_project_graph(gid):
                    graphs.append(gid)
            except Exception:  # noqa: BLE001 - an id the graph layer does not accept was never created
                logger.debug("lifecycle - graph %s not dropped", gid, exc_info=True)
    except Exception:  # noqa: BLE001
        logger.exception("lifecycle - graph layer unavailable for purge of %s", ns)
    try:
        from app import vector_store as vs
        for name in _collections(ns):
            if vs.drop_collection(name):
                colls.append(name)
    except Exception:  # noqa: BLE001
        logger.exception("lifecycle - vector store unavailable for purge of %s", ns)
    return {"graphs": graphs, "collections": colls}


def _projects_of(ns: str, row: dict) -> set[str]:
    projects = set(json.loads(row.get("projects_json") or "[]"))
    with sqldb.connect() as c:
        for t in ("kh_rule", "kh_rule_proj"):
            cols, _ = _columns(c, t)
            if "project" in cols:
                projects |= {r[0] for r in c.execute(f"SELECT DISTINCT project FROM {t} WHERE ns=?", [ns]).fetchall()}
    return projects


def check_token(c, ns: str, token: str | None) -> dict:
    if not token:
        raise CapError("precondition_required", "purge needs confirm=<token of a completed :export> or force=true")
    r = c.execute("SELECT export_id, created_ms, completed_ms FROM kh_ns_export WHERE ns=? AND token_sha=?",
                  [ns, hashlib.sha256(str(token).encode()).hexdigest()]).fetchone()
    if r is None or r["completed_ms"] is None:
        raise CapError("precondition_required", "the confirmation token does not belong to a completed export of "
                                                f"namespace {ns}")
    return {"export_id": r["export_id"], "created_ms": int(r["created_ms"])}


def purge(ns: str, confirm: str | None = None, force: bool = False, reason: str = "request",
          request: Request | None = None) -> dict:
    """Purge a detached namespace (see the module doc). ``reason`` grace|resume skip the token (cron)."""
    with sqldb.connect() as c:
        r = c.execute("SELECT * FROM kh_ns WHERE ns=?", [ns]).fetchone()
        if r is None:
            raise CapError("not_found", f"no namespace {ns}")
        row = dict(r)
        if request is not None:
            registry._admin_person(request, json.loads(row["projects_json"] or "[]"), registry._decode_ns(r))
        export = None
        if reason == "request" and not force:
            export = check_token(c, ns, confirm)
        now = sqldb.now_ms(c)
        if reason == "resume":
            if row["state"] != "purged" or row["purge_after_ms"] is None:
                return {"ns": ns, "purged": False, "reason": "nothing to resume"}
        elif row["state"] != "detached":
            raise CapError("invalid_transition", f"namespace {ns} is {row['state']}: only a detached namespace "
                                                 "can be purged")
        elif not sqldb.update(c, "UPDATE kh_ns SET state='purged', purge_after_ms=?, rev=rev+1 "
                                 "WHERE ns=? AND state='detached'", [now, ns]):
            raise CapError("invalid_transition", f"namespace {ns} changed state concurrently")
    registry.invalidate(ns)
    projects = _projects_of(ns, row)
    deleted = delete_ns_rows(ns)
    derived = drop_derived(ns, projects)
    with sqldb.connect() as c:
        for fn in registry.ON_STATE:
            fn(c, ns, "detached", "purged")
        c.execute("UPDATE kh_ns SET purge_after_ms=NULL, manifest_json=NULL, manifest_sha=NULL, config_json='{}' "
                  "WHERE ns=? AND state='purged'", [ns])
    registry.invalidate(ns)
    body = {"ns": ns, "from": "detached", "to": "purged", "reason": "force" if force else reason,
            "export_id": (export or {}).get("export_id"), "rows": sum(deleted.values()), "tables": deleted, **derived}
    core.emit(sqldb.KH_NS, "kh.ns_state", body, {"principal": "kh"})
    return {**body, "purged": True}


def purge_due() -> str:
    """Cron: purge detached namespaces past grace, resume purges that stopped half way."""
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        due = [(r[0], "grace") for r in c.execute(
            "SELECT ns FROM kh_ns WHERE state='detached' AND purge_after_ms IS NOT NULL AND purge_after_ms<?",
            [now]).fetchall()]
        due += [(r[0], "resume") for r in c.execute(
            "SELECT ns FROM kh_ns WHERE state='purged' AND purge_after_ms IS NOT NULL AND purge_after_ms<?",
            [now - RESUME_AFTER_MS]).fetchall()]
    done = []
    for ns, why in due:
        try:
            out = purge(ns, reason=why)
            done.append(f"{ns}:{out.get('rows', 0)}")
        except CapError as exc:
            logger.info("lifecycle - purge of %s skipped: %s", ns, exc.detail)
    return ", ".join(done)


# ── import ───────────────────────────────────────────────────────────────────

def _read_json(zf: zipfile.ZipFile, name: str) -> dict:
    try:
        return json.loads(zf.read(name))
    except KeyError:
        raise CapError("invalid", f"the archive has no {name}")
    except ValueError:
        raise CapError("invalid", f"{name} is not JSON")


def _verify_files(zf: zipfile.ZipFile, manifest: dict, sums: dict) -> None:
    names = set(zf.namelist())
    want = set(manifest.get("files") or {}) | {"manifest.json"}
    missing = sorted(want - names)
    if missing or not want <= set(sums):
        raise CapError("invalid", "the archive is incomplete", extra={"missing": missing or sorted(want - set(sums))})
    for name in sorted(want):
        h = hashlib.sha256()
        with zf.open(name) as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != sums[name]["sha256"]:
            raise CapError("invalid", f"checksum mismatch in {name}", extra={"file": name})


def _lines(zf: zipfile.ZipFile, name: str) -> Iterator[dict]:
    with zf.open(name) as f:
        for raw in f:
            if raw.strip():
                yield json.loads(raw)


def _is_clean(c, ns: str, tables: list[dict]) -> list[str]:
    dirty = []
    r = c.execute("SELECT state, purge_after_ms FROM kh_ns WHERE ns=?", [ns]).fetchone()
    if r is not None and not (r["state"] == "purged" and r["purge_after_ms"] is None):
        dirty.append("kh_ns")
    for t in tables:
        if t["table"] != "kh_ns" and c.execute(f"SELECT 1 FROM {t['table']} WHERE ns=? LIMIT 1", [ns]).fetchone():
            dirty.append(t["table"])
    if _counter_names(c, ns):
        dirty.append("kh_counter")
    return dirty


def _check_schema(c, manifest: dict, tables: dict[str, dict]) -> None:
    applied = _migrations(c)
    problems = []
    for mod, info in (manifest.get("modules") or {}).items():
        need = max(info.get("migrations") or [0])
        have = max(applied.get(mod) or [0])
        if need > have and any(f.get("module") == mod for f in manifest["files"].values()):
            problems.append(f"module {mod}: archive at migration {need}, this KH at {have}")
    for path, f in manifest["files"].items():
        if f["kind"] in ("table", "rollup"):
            t = tables.get(f["table"])
            if t is None:
                problems.append(f"{path}: table {f['table']} does not exist here (module off?)")
            elif not set(f["columns"]) <= set(t["columns"]):
                problems.append(f"{path}: columns {sorted(set(f['columns']) - set(t['columns']))} unknown here")
    if problems:
        raise CapError("invalid_transition", "the archive does not fit this KH's schema", extra={"problems": problems})


def _insert_file(zf: zipfile.ZipFile, path: str, f: dict, ns: str) -> int:
    n, batch = 0, []

    def flush():
        with sqldb.connect() as c:
            for row in batch:
                if f["kind"] == "counters":
                    name = _untokenize(row["name"], ns)
                    if not sqldb.insert_new(c, "kh_counter", {"name": name, "n": int(row["n"])}):
                        c.execute("UPDATE kh_counter SET n=? WHERE name=?", [int(row["n"]), name])
                    continue
                cols = ["ns"] + list(row)
                c.execute(f"INSERT INTO {f['table']} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                          [ns] + list(row.values()))
        batch.clear()

    for row in _lines(zf, path):
        batch.append(row)
        n += 1
        if len(batch) >= PAGE:
            flush()
    if batch:
        flush()
    return n


def _reembed(zf: zipfile.ZipFile, path: str, suffix: str, ns: str, model) -> dict:
    from app import vector_store as vs
    if model is None:
        return {"rows": sum(1 for _ in _lines(zf, path)), "reembedded": 0, "reason": "no embedder loaded"}
    coll = vs.get_or_create(f"ns_{ns}_{suffix}")
    n, batch = 0, []

    def flush():
        vecs = model.encode([b["text"] for b in batch], normalize_embeddings=True)
        for b, v in zip(batch, vecs):
            meta = {k: (ns if k == "ns" and val == NS_TOKEN else val) for k, val in (b.get("metadata") or {}).items()}
            vs.upsert_vt(b["id"], [float(x) for x in v], b["text"], meta, coll)
        batch.clear()

    for row in _lines(zf, path):
        batch.append(row)
        n += 1
        if len(batch) >= 64:
            flush()
    if batch:
        flush()
    return {"rows": n, "reembedded": n}


def _mark_projections_stale(ns: str) -> None:
    from app import caps
    rules = caps._loaded.get("rules")
    if rules is None or not getattr(rules, "GRAPH_ENABLED", False):
        return
    with sqldb.connect() as c:
        projects = [r[0] for r in c.execute("SELECT DISTINCT project FROM kh_rule WHERE ns=?", [ns]).fetchall()]
    for p in projects:
        rules._set_proj(ns, p, "stale")


def _rebuild(zf_path: str, manifest: dict, sums: dict, ns: str, model) -> dict:
    """Derived state: re-embed the vector files and rebuild the rule graph projection from SQL."""
    out: dict[str, Any] = {"vectors": {}, "rules": []}
    with zipfile.ZipFile(zf_path) as zf:
        for path, f in manifest["files"].items():
            if f["kind"] != "vectors":
                continue
            try:
                got = _reembed(zf, path, f["collection_suffix"], ns, model)
                if got["reembedded"]:
                    sha, n = _digest(iter_vectors(ns, f"ns_{ns}_{f['collection_suffix']}"))
                    got.update(sha256=sha, match=(sha == sums[path]["sha256"] and n == sums[path]["rows"]))
                out["vectors"][path] = got
            except Exception as exc:  # noqa: BLE001 - vectors are an index; SQL is restored
                logger.exception("lifecycle - re-embedding %s into %s failed", path, ns)
                out["vectors"][path] = {"error": str(exc)[:300]}
    from app import caps
    rules = caps._loaded.get("rules")
    if rules is not None and getattr(rules, "GRAPH_ENABLED", False):
        with sqldb.connect() as c:
            projects = [r[0] for r in c.execute("SELECT DISTINCT project FROM kh_rule WHERE ns=?", [ns]).fetchall()]
        for p in projects:
            try:
                out["rules"].append(rules.reproject(ns, p))
            except Exception as exc:  # noqa: BLE001
                out["rules"].append({"project": p, "error": str(exc)[:300]})
    return out


def import_archive(zf_path: str, target: str | None, request: Request | None, model=None,
                   rebuild: str = "async") -> dict:
    """Restore an export into a clean namespace id (see the module doc). The namespace arrives detached."""
    with zipfile.ZipFile(zf_path) as zf:
        manifest = _read_json(zf, "manifest.json")
        if manifest.get("format") != FORMAT:
            raise CapError("invalid", f"unknown archive format {manifest.get('format')!r}")
        sums = (_read_json(zf, "checksums.json").get("files")) or {}
        _verify_files(zf, manifest, sums)
        src = manifest["ns"]
        ns = target or src
        if not core.NS_RE.match(ns) or ns.startswith("kh") or ns in core.RESERVED_NS:
            raise CapError("invalid", "ns must match [a-z][a-z0-9_]{2,31}; the prefixes kh and _ are reserved")
        nsm = manifest["namespace"]
        projects = json.loads(nsm.get("projects_json") or "[]")
        who = registry._admin_person(request, projects, None) if request is not None else "kh"
        with sqldb.connect() as c:
            tables = {t["table"]: t for t in discover(c)}
            _check_schema(c, manifest, tables)
            dirty = _is_clean(c, ns, list(tables.values()))
            if dirty or _collections(ns):
                raise CapError("duplicate", f"namespace {ns} is not clean", extra={"tables": dirty,
                                                                                 "collections": _collections(ns)})
            now = sqldb.now_ms(c)
            grace = registry.grace_days({"config": json.loads(nsm.get("config_json") or "{}")})
            row = {"ns": ns, "display": nsm.get("display") or ns, "state": "detached",
                   "owner_email": nsm["owner_email"], "projects_json": nsm["projects_json"],
                   "config_json": nsm["config_json"], "manifest_json": nsm.get("manifest_json"),
                   "manifest_sha": nsm.get("manifest_sha"), "manifest_rev": int(nsm.get("manifest_rev") or 0),
                   "created_ms": int(nsm.get("created_ms") or now), "detached_ms": now,
                   "purge_after_ms": now + grace * 86400000, "rev": 1}
            claimed = sqldb.insert_new(c, "kh_ns", row)
            tombstone = False
            if not claimed:
                sets = {k: v for k, v in row.items() if k not in ("ns", "rev")}
                claimed = bool(sqldb.update(
                    c, "UPDATE kh_ns SET " + ", ".join(f"{k}=?" for k in sets) + ", rev=rev+1 "
                       "WHERE ns=? AND state='purged' AND purge_after_ms IS NULL", list(sets.values()) + [ns]))
                tombstone = True
            if not claimed:
                raise CapError("duplicate", f"namespace {ns} was claimed by a concurrent import")
        registry.invalidate(ns)
        counts: dict[str, int] = {}
        try:
            for path, f in sorted(manifest["files"].items()):
                if f["kind"] in ("table", "rollup", "counters"):
                    counts[path] = _insert_file(zf, path, f, ns)
        except Exception as exc:
            logger.exception("lifecycle - import of %s into %s failed; rolling back", src, ns)
            delete_ns_rows(ns)
            with sqldb.connect() as c:
                if tombstone:
                    c.execute("UPDATE kh_ns SET state='purged', purge_after_ms=NULL, manifest_json=NULL, "
                              "manifest_sha=NULL, config_json='{}', rev=rev+1 WHERE ns=?", [ns])
                else:
                    c.execute("DELETE FROM kh_ns WHERE ns=?", [ns])
            registry.invalidate(ns)
            if isinstance(exc, CapError):
                raise
            raise CapError("invalid", f"import failed: {str(exc)[:300]}")
    # acceptance: re-serialize what landed and compare with the archive's checksums
    report: dict[str, dict] = {}
    tables = {t["table"]: t for t in discover()}
    for path, f in sorted(manifest["files"].items()):
        if f["kind"] == "vectors":
            continue
        rows = iter_counters(ns) if f["kind"] == "counters" else iter_rows(tables[f["table"]], ns)
        sha, n = _digest(rows)
        report[path] = {"rows": n, "sha256": sha,
                        "match": sha == sums[path]["sha256"] and n == sums[path]["rows"] == counts.get(path)}
    out = {"ns": ns, "source_ns": src, "export_id": manifest.get("export_id"), "state": "detached",
           "match": all(x["match"] for x in report.values()), "files": report, "imported_by": who}
    core.emit(sqldb.KH_NS, "kh.ns_state", {"ns": ns, "from": "imported", "to": "detached", "source_ns": src,
                                            "export_id": manifest.get("export_id"), "match": out["match"]},
              {"principal": who})
    _mark_projections_stale(ns)            # queries take the SQL path until the rebuild wrote the graph
    if rebuild == "sync":
        out["rebuild"] = _rebuild(zf_path, manifest, sums, ns, model)
    else:
        def bg():
            try:
                logger.info("lifecycle - rebuild of %s: %s", ns, _rebuild(zf_path, manifest, sums, ns, model))
            finally:
                _unlink(zf_path)
        threading.Thread(target=bg, name=f"kh-import-{ns}", daemon=True).start()
        out["rebuild"] = "started"
    return out


def _unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


# ── retention and weekly rollups ─────────────────────────────────────────────

def _week(ts_ms: int) -> str:
    y, w, _ = _dt.datetime.fromtimestamp(max(int(ts_ms), 0) / 1000, tz=_dt.timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


def _rollup_add(c, ns: str, project: str, kind: str, week: str, n: int) -> None:
    sql = "UPDATE kh_event_week SET n=n+? WHERE ns=? AND project=? AND kind=? AND week=?"
    params = [n, ns, project, kind, week]
    if not sqldb.update(c, sql, params):
        if not sqldb.insert_new(c, "kh_event_week", {"ns": ns, "project": project, "kind": kind, "week": week, "n": n}):
            sqldb.update(c, sql, params)


class _Raced(Exception):
    pass


def _roll_batch(ns: str, cutoff: int, kind: str | None, exclude: list[str]) -> int:
    """Roll up and delete one batch of expired events; 0 when none are left. All or nothing per batch."""
    where, params = "ns=? AND ts_ms<?", [ns, cutoff]
    if kind is not None:
        where += " AND kind=?"
        params.append(kind)
    elif exclude:
        where += f" AND kind NOT IN ({', '.join('?' for _ in exclude)})"
        params += exclude
    try:
        with sqldb.connect() as c:
            rows = c.execute(f"SELECT seq, project, kind, ts_ms FROM kh_event WHERE {where} ORDER BY seq "
                             f"LIMIT {BATCH}", params).fetchall()
            if not rows:
                return 0
            seqs = [int(r["seq"]) for r in rows]
            gone = 0
            for i in range(0, len(seqs), 500):
                part = seqs[i:i + 500]
                gone += sqldb.update(c, f"DELETE FROM kh_event WHERE ns=? AND seq IN ({', '.join('?' for _ in part)})",
                                     [ns] + part)
            if gone != len(seqs):
                raise _Raced()            # another sweeper took some: roll back, count nothing twice
            agg = Counter((r["project"] or "", r["kind"], _week(r["ts_ms"])) for r in rows)
            for (project, k, week), n in sorted(agg.items()):
                _rollup_add(c, ns, project, k, week, n)
        return len(seqs)
    except _Raced:
        return -1


def retention_sweep(max_batches: int = 200) -> str:
    """Cron: events past retention -> kh_event_week, then deleted. Skips detached and purged namespaces."""
    with sqldb.connect() as c:
        if "ns" not in _columns(c, "kh_event")[0]:
            return ""
        now = sqldb.now_ms(c)
        nss = [(r["ns"], json.loads(r["config_json"] or "{}")) for r in c.execute(
            "SELECT ns, config_json FROM kh_ns WHERE state IN ('active', 'suspended') ORDER BY ns").fetchall()]
        nss.append((sqldb.KH_NS, {}))
        if emit.namespace() not in {ns for ns, _ in nss}:   # KH's own kh.* events: a namespace kh_ns never lists
            nss.append((emit.namespace(), {}))
        typed = {}
        for ns, _ in nss:
            typed[ns] = {r[0]: r[1] for r in c.execute(
                "SELECT type, retention_days FROM kh_type WHERE ns=? AND kind_of='event'", [ns]).fetchall()}
    done, batches = Counter(), 0
    for ns, conf in nss:
        d = ((conf.get("retention") or {}).get("events_days")) or EVENTS_DAYS_DEFAULT
        plans = [(k, int(days)) for k, days in sorted(typed[ns].items()) if days is not None]
        plans.append((None, int(d)))
        for kind, days in plans:
            cutoff = now - days * 86400000
            while batches < max_batches:
                n = _roll_batch(ns, cutoff, kind, sorted(typed[ns]) if kind is None else [])
                batches += 1
                if n == 0:
                    break
                if n > 0:
                    done[ns] += n
    return ", ".join(f"{ns}:{n}" for ns, n in sorted(done.items()))


CRONS = [("cron.retention", 3600, retention_sweep), ("cron.ns_purge", 3600, purge_due)]


# ── detach side effects (registry.ON_STATE, inside the state-change transaction) ─

def _on_state(c, ns: str, old: str, new: str) -> None:       # noqa: ARG001
    if new != "detached":
        return
    cols, _ = _columns(c, "kh_outbox")
    if "state" in cols:                     # pending deliveries die with the namespace (outbox may do it too)
        extra = ", last_error='detached'" if "last_error" in cols else ""
        c.execute(f"UPDATE kh_outbox SET state='dead'{extra} WHERE ns=? AND state IN ('pending', 'claimed')", [ns])


# ── global stop and resume (phase 4) ─────────────────────────────────────────

STOP_EXEMPT = {"kh_people"}


def _maintainer(request: Request | None) -> str:
    """The KH maintainer calling (auth off: the local user). People, owners and service tokens get 403."""
    if request is None:
        return "kh"
    from app import auth
    p = auth.current()
    if p is None:
        if auth.enabled():
            raise CapError("unauthorized", "sign-in required")
        return config.MSG_LOCAL_USER
    if getattr(p, "ns", None) or not p.is_maintainer:
        raise CapError("forbidden", "only a KH maintainer may stop or resume every agent")
    return p.email


def _switch(c, ns: str, old: str, new: str, cfg: dict) -> bool:
    if not sqldb.update(c, "UPDATE kh_ns SET state=?, config_json=?, rev=rev+1 WHERE ns=? AND state=?",
                        [new, core.jdump(cfg), ns, old]):
        return False
    sqldb.lease_bump_all(c, ns)
    for fn in registry.ON_STATE:
        fn(c, ns, old, new)
    return True


def _announce(changed: list[tuple[str, str, str]], reason: str, who: str) -> None:
    registry.invalidate()
    for ns, old, new in changed:
        body = {"ns": ns, "from": old, "to": new, "reason": reason, "by": who}
        core.emit(ns, "kh.ns_state", body, {"principal": who})
        core.emit(sqldb.KH_NS, "kh.ns_state", body, {"principal": who})


def stop_agents(request: Request | None = None, exempt: Iterable[str] = ()) -> dict:
    """Suspend every active namespace but the exempt ones, in one transaction (see the module doc)."""
    who = _maintainer(request)
    keep = STOP_EXEMPT | set(exempt)
    changed, skipped, fenced = [], [], 0
    with sqldb.connect() as c:
        sqldb.ensure_core(c)
        now = sqldb.now_ms(c)
        rows = c.execute("SELECT ns, state, config_json FROM kh_ns ORDER BY ns").fetchall()
        for r in rows:
            ns, state = r["ns"], r["state"]
            if state != "active" or ns in keep:
                if state == "suspended":
                    skipped.append(ns)
                continue
            cfg = json.loads(r["config_json"] or "{}")
            cfg.update(stopped_from=state, stopped_ms=now, stopped_by=who)
            fenced += c.execute("SELECT COUNT(*) FROM kh_lease WHERE ns=?", [ns]).fetchone()[0]
            if _switch(c, ns, state, "suspended", cfg):
                changed.append((ns, state, "suspended"))
    _announce(changed, "agents:stop", who)
    return {"stopped": [x[0] for x in changed], "already_suspended": skipped, "exempt": sorted(keep),
            "leases_fenced": int(fenced), "by": who, "within_s": registry.CACHE_S}


def resume_agents(request: Request | None = None) -> dict:
    """Restore the states a stop saved in config_json.stopped_from, in one transaction."""
    who = _maintainer(request)
    changed, cleaned = [], []
    with sqldb.connect() as c:
        rows = c.execute("SELECT ns, state, config_json FROM kh_ns ORDER BY ns").fetchall()
        for r in rows:
            cfg = json.loads(r["config_json"] or "{}")
            if "stopped_from" not in cfg:
                continue
            target = cfg.pop("stopped_from")
            cfg.pop("stopped_ms", None)
            cfg.pop("stopped_by", None)
            if r["state"] == "suspended" and target == "active":
                if _switch(c, r["ns"], "suspended", target, cfg):
                    changed.append((r["ns"], "suspended", target))
            else:                          # resumed or detached by hand since the stop: just forget the mark
                sqldb.update(c, "UPDATE kh_ns SET config_json=?, rev=rev+1 WHERE ns=? AND state=?",
                             [core.jdump(cfg), r["ns"], r["state"]])
                cleaned.append(r["ns"])
    _announce(changed, "agents:resume", who)
    return {"resumed": [x[0] for x in changed], "cleaned": cleaned, "by": who}


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    TAG = ["v1 registry"]
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)

    @app.get("/v1/admin/ns/{ns}:export", tags=TAG,
             summary="Stream a zip of the namespace: manifest, NDJSON per table, rollups, vectors as text, checksums")
    async def ns_export(ns: str, request: Request, include_vault: bool = False):
        p = await asyncio.to_thread(plan_export, ns, include_vault, request)
        headers = {"Content-Disposition": f'attachment; filename="{ns}-{p["export_id"]}.zip"',
                   "X-KH-Export-Id": p["export_id"], "X-KH-Export-Token": p["token"]}
        return StreamingResponse(export_chunks(p), media_type="application/zip", headers=headers)

    # GET /v1/admin/ns/{ns} (registry) would capture "acme:export" as its ns: this route goes first.
    route = app.router.routes.pop()
    app.router.routes.insert(0, route)

    @app.post("/v1/admin/ns:import", tags=TAG, status_code=201,
              summary="Restore an export into a clean namespace id (arrives detached; :reattach to serve it)")
    async def ns_import(request: Request, ns: str | None = None, rebuild: str = "async"):
        if rebuild not in ("sync", "async"):
            raise CapError("invalid", "rebuild must be sync or async")
        fd, path = tempfile.mkstemp(prefix="kh_import_", suffix=".zip")
        size = 0
        try:
            with os.fdopen(fd, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > IMPORT_MAX:
                        raise CapError("too_large", f"the archive is larger than {IMPORT_MAX} bytes")
                    f.write(chunk)
            if not zipfile.is_zipfile(path):
                raise CapError("invalid", "the body must be a zip produced by :export")
            model = getattr(request.app.state, "model", None)
            out = await asyncio.to_thread(import_archive, path, ns, request, model, rebuild)
        except BaseException:
            _unlink(path)
            raise
        if rebuild == "sync":
            _unlink(path)
        return core.reply(201, out)

    @app.post("/v1/admin/agents:stop", tags=TAG,
              summary="Global stop (maintainer): suspend every active namespace but kh_people, fence every lease")
    async def agents_stop(request: Request):
        return await asyncio.to_thread(stop_agents, request)

    @app.post("/v1/admin/agents:resume", tags=TAG,
              summary="Undo agents:stop: restore the states saved in config_json.stopped_from")
    async def agents_resume(request: Request):
        return await asyncio.to_thread(resume_agents, request)

    @app.post("/v1/admin/ns/{ns}:purge", tags=TAG,
              summary="Purge a detached namespace now: confirm=<export token> or force=true")
    async def ns_purge(ns: str, request: Request, force: bool = False, confirm: str | None = None):
        raw = await request.body()
        body = {}
        if raw:
            try:
                body = json.loads(raw)
            except ValueError:
                raise CapError("invalid", "body must be JSON")
        token = confirm or (body.get("confirm") if isinstance(body, dict) else None)
        force = force or (isinstance(body, dict) and body.get("force") is True)
        return await asyncio.to_thread(purge, ns, token, force, "request", request)
