"""Design gallery: the designs the public Designer site shows, stored in KH's relational store (fen 2026-10-25).

Until now the gallery (Slaves/Designer, https://kh-designer.cfapps.br10.hana.ondemand.com) listed a
hard-coded site/catalog.js, so a new style meant editing that file and redeploying the site. Now each
design is one row here: its catalog fields plus the demo remix (HTML) and the grid thumbnail (WebP) as
raw bytes in BLOB columns, and one row per extra variant in kh_gallery_variant. Adding a style is two
writes: the spec and reference rows in project 'designer' (what an LLM builds from, unchanged) and one
PUT here (what people see). The PUT body carries the files as base64 (JSON has no bytes); they are
decoded once on write and served as stored, with no conversion on read.

Reads are public (the gallery needs no sign-in) and return only what the site shows:
  GET /gallery/designs              the list, without the files; ?thumbs=1 inlines every thumbnail
                                    as a data URI, so the grid is one request, not 45
  GET /gallery/designs/{no}/thumb   the thumbnail, image/webp
  GET /gallery/designs/{no}/demo    the demo page, text/html; ?v=1.. picks a variant
Reads are served from memory: the whole gallery is about 1.2 MB, and from Asia every request to BTP
costs over a second before HANA adds its own time, so the rows are read once, kept CACHE_S seconds and
dropped on every write. A demo is served with a CSP sandbox, so its scripts run in an opaque origin and
cannot read anything of KH's own origin (storage, cookies) even when the page is opened directly in a tab.
Writes need project.write on 'designer' (PUT); removing a design is for maintainers (DELETE).

BLOBs are read on HANA through a plain pooled cursor, not sqldb: sqldb turns every LOB into text, which
would corrupt the WebP bytes. The first version of this table (kh_design_gallery, base64 in NCLOB, live for
one afternoon) is dropped on startup; tools/sync_gallery.py in Slaves/Designer refills the gallery.
"""
from __future__ import annotations

import base64
import json
import logging
import re
import threading
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.responses import JSONResponse, Response

from app import config, sqldb

logger = logging.getLogger(__name__)

DESIGNS = "kh_gallery_design"
VARIANTS = "kh_gallery_variant"
OLD = "kh_design_gallery"
KINDS = ("style", "layer", "motion")
NO = re.compile(r"^\d{2,3}$")
MAX_BYTES = int(config._env("KH_GALLERY_MAX_MB", "8")) * 1024 * 1024
CACHE_S = int(config._env("KH_GALLERY_CACHE_S", "300"))
# What a demo may do in its sandbox: run scripts, open its own pop-ups, show dialogs. No same-origin.
DEMO_CSP = "sandbox allow-scripts allow-popups allow-forms allow-modals"
# The list is public data read cross-origin by the gallery site; no credentials are involved.
PUBLIC = {"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60"}
FIELDS = ["design_no", "name", "kind", "description", "demo_label", "alias", "tags", "spec_id", "ref_id", "added",
          "updated_at", "updated_by"]

_LOCK = threading.Lock()
_cache: dict = {"at": 0.0, "rows": None}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def init() -> None:
    """Create the tables if absent and drop the base64 first version. Safe on every startup."""
    with _LOCK, sqldb.connect() as c:
        if sqldb.is_hana():
            from app import hana_conn
            cur = c.cursor()
            try:
                old = hana_conn.table_exists(cur, OLD)
            finally:
                cur.close()
            if old:
                c.execute(f"DROP TABLE {OLD}")
                logger.info("gallery: dropped %s (base64 first version); refill with tools/sync_gallery.py", OLD)
        else:
            c.execute(f"DROP TABLE IF EXISTS {OLD}")
        sqldb.create_table(
            c, DESIGNS,
            f"""CREATE TABLE IF NOT EXISTS {DESIGNS} (
                design_no TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, description TEXT NOT NULL,
                demo_label TEXT NOT NULL, alias TEXT NOT NULL, tags TEXT NOT NULL, spec_id TEXT NOT NULL,
                ref_id TEXT NOT NULL, added TEXT NOT NULL, demo BLOB NOT NULL, thumb BLOB NOT NULL,
                updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)""",
            f"""CREATE COLUMN TABLE {DESIGNS} (
                design_no NVARCHAR(8) PRIMARY KEY, name NVARCHAR(200) NOT NULL, kind NVARCHAR(16) NOT NULL,
                description NVARCHAR(1000) NOT NULL, demo_label NVARCHAR(300) NOT NULL, alias NVARCHAR(32) NOT NULL,
                tags NVARCHAR(500) NOT NULL, spec_id NVARCHAR(64) NOT NULL, ref_id NVARCHAR(64) NOT NULL,
                added NVARCHAR(16) NOT NULL, demo BLOB NOT NULL, thumb BLOB NOT NULL,
                updated_at NVARCHAR(32) NOT NULL, updated_by NVARCHAR(256) NOT NULL)""")
        sqldb.create_table(
            c, VARIANTS,
            f"""CREATE TABLE IF NOT EXISTS {VARIANTS} (
                design_no TEXT NOT NULL, idx INTEGER NOT NULL, label TEXT NOT NULL, demo BLOB NOT NULL,
                PRIMARY KEY (design_no, idx))""",
            f"""CREATE COLUMN TABLE {VARIANTS} (
                design_no NVARCHAR(8) NOT NULL, idx INTEGER NOT NULL, label NVARCHAR(100) NOT NULL,
                demo BLOB NOT NULL, PRIMARY KEY (design_no, idx))""")


def _decode(value, what: str, required: bool = True) -> bytes:
    """The bytes of a base64 field of the PUT body; b'' when optional and absent."""
    text = re.sub(r"\s+", "", str(value or ""))
    if not text:
        if required:
            raise ValueError(f"{what} is required")
        return b""
    try:
        return base64.b64decode(text, validate=True)
    except ValueError:
        raise ValueError(f"{what} is not valid base64")


def _clean(no: str, body: dict, by: str) -> tuple[dict, list[tuple[str, bytes]]]:
    if not NO.match(no):
        raise ValueError("no must be two or three digits, e.g. '07'")
    name = str(body.get("name") or "").strip()
    kind = str(body.get("kind") or "").strip()
    desc = str(body.get("desc") or "").strip()
    if not name or not desc:
        raise ValueError("name and desc are required")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {list(KINDS)}")
    tags = body.get("tags") or []
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ValueError("tags must be a list of strings")
    variants = []
    for i, v in enumerate(body.get("variants") or []):
        label = str((v or {}).get("label") or "").strip()
        if not label:
            raise ValueError(f"variant {i + 1} needs a label")
        variants.append((label[:100], _decode(v.get("demo_b64"), f"variant {label} demo_b64")))
    row = {
        "design_no": no, "name": name[:200], "kind": kind, "description": desc[:1000],
        "demo_label": str(body.get("demo") or "")[:300], "alias": str(body.get("alias") or "")[:32],
        "tags": json.dumps(tags), "spec_id": str(body.get("spec") or "")[:64], "ref_id": str(body.get("ref") or "")[:64],
        "added": str(body.get("added") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))[:16],
        "demo": _decode(body.get("demo_b64"), "demo_b64"), "thumb": _decode(body.get("thumb_b64"), "thumb_b64"),
        "updated_at": _now(), "updated_by": by[:256],
    }
    if len(row["demo"]) + len(row["thumb"]) + sum(len(d) for _, d in variants) > MAX_BYTES:
        raise ValueError(f"design too large: over {MAX_BYTES // (1024 * 1024)} MB")
    return row, variants


def _bytes(value) -> bytes:
    """A BLOB as bytes: hdbcli hands out a LOB handle, sqlite the bytes themselves."""
    if value is not None and hasattr(value, "read"):
        value = value.read()
    if isinstance(value, str):
        return value.encode("utf-8")
    return bytes(value or b"")


def _select(sql: str) -> list[tuple]:
    """Rows as plain tuples with BLOBs untouched (on HANA, around sqldb's LOB-to-text conversion)."""
    if sqldb.is_hana():
        from app import hana_conn
        with hana_conn.connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute(sql)
                return [tuple(r) for r in cur.fetchall()]
            finally:
                cur.close()
    with sqldb.connect() as c:
        return [tuple(r) for r in c.execute(sql).fetchall()]


def _rows() -> dict[str, dict]:
    """Every design by number with its bytes and variants, read at most once per CACHE_S seconds."""
    rows = _cache["rows"]
    if rows is not None and time.monotonic() - _cache["at"] < CACHE_S:
        return rows
    rows = {}
    for r in _select(f"SELECT {', '.join(FIELDS)}, demo, thumb FROM {DESIGNS}"):
        d = dict(zip(FIELDS, r))
        d["demo"], d["thumb"] = _bytes(r[-2]), _bytes(r[-1])
        d["thumb_data"] = "data:image/webp;base64," + base64.b64encode(d["thumb"]).decode("ascii")
        d["variants"] = []
        rows[d["design_no"]] = d
    for no, idx, label, demo in sorted(_select(f"SELECT design_no, idx, label, demo FROM {VARIANTS}"),
                                       key=lambda v: (v[0], v[1])):
        if no in rows:
            rows[no]["variants"].append({"label": label, "demo": _bytes(demo)})
    _cache.update(rows=rows, at=time.monotonic())
    return rows


def _drop_cache() -> None:
    _cache.update(rows=None, at=0.0)


def put(no: str, body: dict, by: str) -> dict:
    row, variants = _clean(no, body, by)
    with sqldb.connect() as c:
        sqldb.upsert(c, DESIGNS, ["design_no"], row)
        c.execute(f"DELETE FROM {VARIANTS} WHERE design_no=?", [no])
        for i, (label, demo) in enumerate(variants, start=1):
            c.execute(f"INSERT INTO {VARIANTS} (design_no, idx, label, demo) VALUES (?,?,?,?)", [no, i, label, demo])
    _drop_cache()
    return _public({**row, "variants": [{"label": label} for label, _ in variants]})


def _public(r: dict) -> dict:
    """The list entry the site reads: catalog fields, URLs relative to KH's root, and no files."""
    v, no = r["updated_at"], r["design_no"]
    out = {
        "no": no, "name": r["name"], "kind": r["kind"], "desc": r["description"], "demo": r["demo_label"],
        "spec": r["spec_id"], "ref": r["ref_id"], "added": r["added"], "updated_at": v,
        "thumb_url": f"/gallery/designs/{no}/thumb?u={v}", "demo_url": f"/gallery/designs/{no}/demo?u={v}",
    }
    if r["alias"]:
        out["alias"] = r["alias"]
    tags = json.loads(r["tags"] or "[]")
    if tags:
        out["tags"] = tags
    if r["variants"]:
        out["variants"] = [{"label": x["label"], "demo_url": f"/gallery/designs/{no}/demo?v={i + 1}&u={v}"}
                           for i, x in enumerate(r["variants"])]
    return out


def list_designs(thumbs: bool = False) -> list[dict]:
    out = []
    for r in _rows().values():
        d = _public(r)
        if thumbs:
            d["thumb_data"] = r["thumb_data"]
        out.append(d)
    return sorted(out, key=lambda d: int(d["no"]))


def delete(no: str) -> bool:
    with sqldb.connect() as c:
        gone = c.execute(f"DELETE FROM {DESIGNS} WHERE design_no=?", [no]).rowcount > 0
        c.execute(f"DELETE FROM {VARIANTS} WHERE design_no=?", [no])
    _drop_cache()
    return gone


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    from app import auth

    TAG = ["Gallery"]
    init()

    def _by() -> str:
        principal = auth.current()
        return principal.email if principal is not None else "local"

    def _design(no: str) -> dict:
        row = _rows().get(no) if NO.match(no) else None
        if row is None:
            raise HTTPException(404, "no such design")
        return row

    @app.get("/gallery/designs", tags=TAG, summary="The designs the public Designer gallery shows (no sign-in)")
    async def gallery_list(thumbs: int = 0):
        """URLs are relative to KH's root (behind the BTP router the request scheme is http), so the site
        prefixes the KH address it called. ?thumbs=1 adds thumb_data (a data URI) to every entry."""
        designs = list_designs(bool(thumbs))
        return JSONResponse({"count": len(designs), "designs": designs}, headers=PUBLIC)

    @app.get("/gallery/designs/{no}/thumb", tags=TAG, summary="A design's grid thumbnail, WebP (no sign-in)")
    async def gallery_thumb(no: str):
        return Response(_design(no)["thumb"], media_type="image/webp",
                        headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})

    @app.get("/gallery/designs/{no}/demo", tags=TAG, summary="A design's demo page, sandboxed HTML (no sign-in)")
    async def gallery_demo(no: str, v: int = 0):
        row = _design(no)
        if v and not 1 <= v <= len(row["variants"]):
            raise HTTPException(404, "no such variant")
        body = row["variants"][v - 1]["demo"] if v else row["demo"]
        return Response(body, media_type="text/html; charset=utf-8",
                        headers={"Content-Security-Policy": DEMO_CSP, "X-Content-Type-Options": "nosniff",
                                 "Cache-Control": "public, max-age=3600"})

    @app.put("/gallery/designs/{no}", tags=TAG, summary="Add or replace a gallery design (project.write on designer)")
    async def gallery_put(no: str, body: dict) -> dict:
        """Body {name, kind, desc, demo?, alias?, tags?, spec?, ref?, added?, demo_b64, thumb_b64,
        variants?: [{label, demo_b64}]}. Same fields as a site/catalog.js entry; the files travel as base64
        and are stored as bytes."""
        try:
            return put(no, body, _by())
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.delete("/gallery/designs/{no}", tags=TAG, summary="Remove a design from the gallery (maintainers)")
    async def gallery_delete(no: str) -> dict:
        return {"deleted": delete(no), "no": no}
