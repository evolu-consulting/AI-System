"""Versioned document packs (docs/multi-agent-instance-design.md 4.7, slice F10).

A pack is a versioned bundle of source documents (specifications, contracts, manuals) with stable
citations. KH stores, hashes, freezes, cites and re-anchors text; it never judges what the text MEANS.

  POST  /v1/{ns}/packs/{pack}/versions                {project?, title?, base?, parts:[{path, page?, text}],
                                                       remove?:[{path, page?}], freeze?} -> 201 vN.0 + sha256
  PATCH /v1/{ns}/packs/{pack}/versions/{ver}          {parts?, remove?}  edit a DRAFT (If-Match)
  POST  /v1/{ns}/packs/{pack}/versions/{ver}:freeze   freeze a draft (If-Match): immutable, quotes re-anchored
  POST  /v1/{ns}/packs/{pack}/versions/{ver}:reindex  rebuild the vectors of a frozen version
  POST  /v1/{ns}/packs/{pack}/versions/{ver}/addenda  {parts, remove?, freeze?} -> vN.(k+1) over frozen vN.k
  GET   /v1/{ns}/packs/{pack}[?version=vN.k|latest&text=true]
  GET   /v1/{ns}/packs/{pack}/versions                every version of a pack
  GET   /v1/{ns}/packs                                packs of the namespace
  POST  /v1/{ns}/packs/{pack}/quotes                  {version?, path, page?, offset?, length?, text?} cite a span
  GET   /v1/{ns}/packs/{pack}/quotes?version=&path=&origin=
  GET   /v1/{ns}/quotes/{quote_id}[?pack=&version=]   follows the quote map to the latest version
  POST  /v1/{ns}/packs/{pack}/assumptions             {text, quote_id?, version?} -> ASSUMED-n (status open)
  PATCH /v1/{ns}/packs/{pack}/assumptions/{code}      {status?, text?, quote_id?, superseded_by?, note?} (If-Match)
  GET   /v1/{ns}/packs/{pack}/assumptions[?status=]   and  .../assumptions/{code}
  POST  /v1/{ns}/packs/{pack}/questions:lookup        {text, threshold?, store?} -> duplicate_of + score, or stores
  PATCH /v1/{ns}/packs/{pack}/questions/{qid}         {status: open|answered|closed, answer?, quote_id?} (If-Match)
  GET   /v1/{ns}/packs/{pack}/questions[?status=]     and  .../questions/{qid}

VERSIONS. Label ``vN.k``: ``N`` from the gapless counter ``pkv:<ns>:<pack>``, addendum ``k`` from
``pka:<ns>:<pack>:<N>`` (0 = the base). A new major may copy a frozen ``base`` and overlay parts; an addendum
always overlays the frozen ``vN.k`` it names. Parts are normalized (NFC, LF line ends, no trailing blanks)
and stored content-addressed in ``kh_pack_blob``; ``sha256`` of a version is the sha256 of
``[[path, page, part_sha256], ...]`` sorted by path and page. A draft changes only through a conditional
``UPDATE ... WHERE state='draft' AND rev=?``; freezing is ``... WHERE state='draft' AND rev=? AND sha256=?``,
so a frozen version is immutable (409 pack_immutable). Freezes of one pack serialize on the pack head row,
and a version must sort after the latest frozen one (409 version_order). The previous frozen version
becomes ``superseded`` (still immutable, still readable).

QUOTES. ``quote_id = path#page#offset`` (offset in characters of the normalized part text). If that id is
already taken in the version by a span of another length, the id is ``path#page#offset~length``. Freezing
chunks every part with app/chunker.py (sentence boundaries by meaning; fixed windows when no model is
loaded) into ``chunk`` quotes, and, after commit, into vectors in collection ``ns_<ns>_packs`` with the
metadata ``ns, pack_id, version, quote_id`` so retrieval can cite them. In the same freeze transaction every
quote of the previous frozen version whose exact text appears again is RE-ANCHORED: the same path and page
first (nearest offset), then the same path, then any part; ``kh_quote_map`` records old -> new, or old -> NULL
(orphaned). ``GET /quotes/{id}`` follows the map hop by hop to the latest version.

ASSUMPTIONS. ``ASSUMED-n`` with ``n`` from ``kh_counter('asm:<ns>:<pack>')``: codes are never reused.
Status open -> confirmed | refuted | superseded; ``superseded`` is final (409 assumption_final). Moving to
confirmed or refuted needs the confirm policy (role with ``packs:confirm``, or ``confirm_policy``); a text or
quote change of a confirmed / refuted assumption drops it back to open.

DUPLICATE QUESTIONS. A question is normalized and hashed; an exact repeat of an open or answered question
is a duplicate (score 1.0, also race-free through the unique ``(ns, pack_id, text_sha)``). Otherwise the
question is embedded (collection ``ns_<ns>_questions``) and compared with the pack's open and answered
questions: a duplicate needs cosine >= the threshold (design D15: 0.92; manifest
``settings.packs.duplicate_threshold`` or the request may set 0.80-0.99) AND no CONTRAST between the two
texts: different numbers, a different negation, or the two sides of a generic opposite pair (above/below,
min/max, include/exclude, ...). Embeddings alone score such near-misses at 0.98+, and a false duplicate
hides a real question, so precision comes first. The labelled set in tests/caps/test_packs.py tunes it.

POLICY (manifest ``settings.packs``, all optional):
  {"fenced": bool, "require_if_match": bool, "read_roles": [...], "write_roles": [...],
   "confirm_policy": {"roles": [...], "emails": [...]}, "duplicate_threshold": 0.92}
``fenced`` demands X-KH-Lease / X-KH-Epoch on every pack, quote, assumption and question write (checked in
the write transaction); ``questions:lookup`` (a read-role route) checks a lease only when one is sent.
Every write body passes ``redact.scrub`` before validation and outside any transaction.

EVENTS (kh.*): kh.pack_version, kh.pack_frozen, kh.assumption, kh.question_duplicate, plus the shared
kh.write_conflict / kh.stale_epoch / kh.duplicate / kh.redacted.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import threading
import unicodedata
from typing import Any

from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "packs"
VERSION = "1.0.0"
STATUS = "beta"
PARTS_MAX = 2000
PART_CHARS_MAX = 512 * 1024
VERSION_CHARS_MAX = 16 * 1024 * 1024
CHUNK_CHARS_MAX = 1200
QUOTE_CHARS_MAX = 20000
LIST_MAX = 1000
MAP_HOPS_MAX = 1000
TEXT_MAX = 4000
DEFAULT_THRESHOLD = 0.92
THRESHOLD_RANGE = (0.80, 0.99)
LOOKUP_K = 10
LIMITS = {"parts_per_version": PARTS_MAX, "part_chars": PART_CHARS_MAX, "version_chars": VERSION_CHARS_MAX,
          "quote_chars": QUOTE_CHARS_MAX, "duplicate_threshold": DEFAULT_THRESHOLD, "list_limit": LIST_MAX}

PACK_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,63}$")
PATH_RE = re.compile(r"^[^#\x00-\x1f]{1,400}$")
LABEL_RE = re.compile(r"^v([1-9][0-9]{0,5})(?:\.(0|[1-9][0-9]{0,5}))?$")
CODE_RE = re.compile(r"^ASSUMED-[1-9][0-9]{0,8}$")
QID_RE = re.compile(r"^Q-[1-9][0-9]{0,8}$")
PACK_STATES = ("draft", "frozen", "superseded")
ASM_STATES = ("open", "confirmed", "refuted", "superseded")
ASM_CONFIRM = {"confirmed", "refuted"}
Q_STATES = ("open", "answered", "closed")
Q_LIVE = ("open", "answered")
EMBED = config._flag("KH_PACKS_EMBED", "true")

_DDL = {
    "kh_pack_head": ("""CREATE TABLE IF NOT EXISTS kh_pack_head (
                          ns TEXT NOT NULL, pack_id TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', title TEXT,
                          latest_ver INTEGER, latest_add INTEGER, actor_json TEXT NOT NULL,
                          created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, rev INTEGER NOT NULL,
                          PRIMARY KEY (ns, pack_id))""",
                     """CREATE COLUMN TABLE kh_pack_head (
                          ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL, project NVARCHAR(256) NOT NULL,
                          title NVARCHAR(256), latest_ver BIGINT, latest_add BIGINT, actor_json NCLOB NOT NULL,
                          created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL, rev BIGINT NOT NULL,
                          PRIMARY KEY (ns, pack_id))"""),
    "kh_pack": ("""CREATE TABLE IF NOT EXISTS kh_pack (
                     ns TEXT NOT NULL, pack_id TEXT NOT NULL, version INTEGER NOT NULL, addendum INTEGER NOT NULL,
                     label TEXT NOT NULL, sha256 TEXT NOT NULL, state TEXT NOT NULL, base_label TEXT,
                     parts_n INTEGER NOT NULL, chars INTEGER NOT NULL, index_state TEXT NOT NULL,
                     actor_json TEXT NOT NULL, created_ms INTEGER NOT NULL, frozen_ms INTEGER,
                     rev INTEGER NOT NULL, PRIMARY KEY (ns, pack_id, version, addendum))""",
                """CREATE COLUMN TABLE kh_pack (
                     ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL, version BIGINT NOT NULL,
                     addendum BIGINT NOT NULL, label NVARCHAR(32) NOT NULL, sha256 NVARCHAR(64) NOT NULL,
                     state NVARCHAR(16) NOT NULL, base_label NVARCHAR(32), parts_n BIGINT NOT NULL,
                     chars BIGINT NOT NULL, index_state NVARCHAR(16) NOT NULL, actor_json NCLOB NOT NULL,
                     created_ms BIGINT NOT NULL, frozen_ms BIGINT, rev BIGINT NOT NULL,
                     PRIMARY KEY (ns, pack_id, version, addendum))"""),
    "kh_pack_part": ("""CREATE TABLE IF NOT EXISTS kh_pack_part (
                          ns TEXT NOT NULL, pack_id TEXT NOT NULL, version INTEGER NOT NULL,
                          addendum INTEGER NOT NULL, path TEXT NOT NULL, page INTEGER NOT NULL,
                          text_ref TEXT NOT NULL, sha256 TEXT NOT NULL, chars INTEGER NOT NULL,
                          PRIMARY KEY (ns, pack_id, version, addendum, path, page))""",
                     """CREATE COLUMN TABLE kh_pack_part (
                          ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL, version BIGINT NOT NULL,
                          addendum BIGINT NOT NULL, path NVARCHAR(400) NOT NULL, page BIGINT NOT NULL,
                          text_ref NVARCHAR(64) NOT NULL, sha256 NVARCHAR(64) NOT NULL, chars BIGINT NOT NULL,
                          PRIMARY KEY (ns, pack_id, version, addendum, path, page))"""),
    "kh_pack_blob": ("""CREATE TABLE IF NOT EXISTS kh_pack_blob (
                          ns TEXT NOT NULL, sha256 TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (ns, sha256))""",
                     """CREATE COLUMN TABLE kh_pack_blob (
                          ns NVARCHAR(32) NOT NULL, sha256 NVARCHAR(64) NOT NULL, text NCLOB NOT NULL,
                          PRIMARY KEY (ns, sha256))"""),
    "kh_quote": ("""CREATE TABLE IF NOT EXISTS kh_quote (
                      ns TEXT NOT NULL, pack_id TEXT NOT NULL, version TEXT NOT NULL, quote_id TEXT NOT NULL,
                      path TEXT NOT NULL, page INTEGER NOT NULL, q_offset INTEGER NOT NULL, q_length INTEGER NOT NULL,
                      text TEXT NOT NULL, sha256 TEXT NOT NULL, origin TEXT NOT NULL, created_ms INTEGER NOT NULL,
                      PRIMARY KEY (ns, pack_id, version, quote_id))""",
                 """CREATE COLUMN TABLE kh_quote (
                      ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL, version NVARCHAR(32) NOT NULL,
                      quote_id NVARCHAR(512) NOT NULL, path NVARCHAR(400) NOT NULL, page BIGINT NOT NULL,
                      q_offset BIGINT NOT NULL, q_length BIGINT NOT NULL, text NCLOB NOT NULL,
                      sha256 NVARCHAR(64) NOT NULL, origin NVARCHAR(16) NOT NULL, created_ms BIGINT NOT NULL,
                      PRIMARY KEY (ns, pack_id, version, quote_id))"""),
    "kh_quote_map": ("""CREATE TABLE IF NOT EXISTS kh_quote_map (
                          ns TEXT NOT NULL, pack_id TEXT NOT NULL, from_ver TEXT NOT NULL, old_quote_id TEXT NOT NULL,
                          to_ver TEXT NOT NULL, new_quote_id TEXT, PRIMARY KEY (ns, pack_id, from_ver, old_quote_id))""",
                     """CREATE COLUMN TABLE kh_quote_map (
                          ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL, from_ver NVARCHAR(32) NOT NULL,
                          old_quote_id NVARCHAR(512) NOT NULL, to_ver NVARCHAR(32) NOT NULL,
                          new_quote_id NVARCHAR(512), PRIMARY KEY (ns, pack_id, from_ver, old_quote_id))"""),
    "kh_assumption": ("""CREATE TABLE IF NOT EXISTS kh_assumption (
                           ns TEXT NOT NULL, pack_id TEXT NOT NULL, code TEXT NOT NULL, n INTEGER NOT NULL,
                           text TEXT NOT NULL, status TEXT NOT NULL, quote_id TEXT, quote_ver TEXT,
                           superseded_by TEXT, note TEXT, actor_json TEXT NOT NULL, created_ms INTEGER NOT NULL,
                           updated_ms INTEGER NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY (ns, pack_id, code))""",
                      """CREATE COLUMN TABLE kh_assumption (
                           ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL, code NVARCHAR(32) NOT NULL,
                           n BIGINT NOT NULL, text NCLOB NOT NULL, status NVARCHAR(16) NOT NULL,
                           quote_id NVARCHAR(512), quote_ver NVARCHAR(32), superseded_by NVARCHAR(32), note NCLOB,
                           actor_json NCLOB NOT NULL, created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL,
                           rev BIGINT NOT NULL, PRIMARY KEY (ns, pack_id, code))"""),
    "kh_pack_question": ("""CREATE TABLE IF NOT EXISTS kh_pack_question (
                              ns TEXT NOT NULL, pack_id TEXT NOT NULL, question_id TEXT NOT NULL, n INTEGER NOT NULL,
                              text TEXT NOT NULL, text_sha TEXT NOT NULL, status TEXT NOT NULL, answer TEXT,
                              quote_id TEXT, quote_ver TEXT, asked_n INTEGER NOT NULL, indexed INTEGER NOT NULL,
                              actor_json TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
                              rev INTEGER NOT NULL, PRIMARY KEY (ns, pack_id, question_id))""",
                         """CREATE COLUMN TABLE kh_pack_question (
                              ns NVARCHAR(32) NOT NULL, pack_id NVARCHAR(64) NOT NULL,
                              question_id NVARCHAR(32) NOT NULL, n BIGINT NOT NULL, text NCLOB NOT NULL,
                              text_sha NVARCHAR(64) NOT NULL, status NVARCHAR(16) NOT NULL, answer NCLOB,
                              quote_id NVARCHAR(512), quote_ver NVARCHAR(32), asked_n BIGINT NOT NULL,
                              indexed BIGINT NOT NULL, actor_json NCLOB NOT NULL, created_ms BIGINT NOT NULL,
                              updated_ms BIGINT NOT NULL, rev BIGINT NOT NULL,
                              PRIMARY KEY (ns, pack_id, question_id))"""),
}
TABLES = list(_DDL)


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ix_kh_quote_id", "kh_quote", "ns, quote_id")
    sqldb.create_index(c, "ix_kh_assumption_st", "kh_assumption", "ns, pack_id, status")
    sqldb.create_index(c, "ux_kh_pack_question_sha", "kh_pack_question", "ns, pack_id, text_sha", unique=True)


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── policy (manifest settings.packs) ─────────────────────────────────────────

def policy(ctx: Ctx) -> dict:
    cfg = ((ctx.ns_row.get("config") or {}).get("settings") or {}).get("packs") or {}
    return cfg if isinstance(cfg, dict) else {}


def _acl_row(ctx: Ctx) -> dict:
    p = policy(ctx)
    return {"type": "packs", "read_roles": p.get("read_roles") or [], "write_roles": p.get("write_roles") or []}


def can_read(ctx: Ctx) -> None:
    ctx.require("packs", "read", type_row=_acl_row(ctx), op="read")


def can_write(ctx: Ctx) -> None:
    ctx.require("packs", "write", type_row=_acl_row(ctx), op="write")


def can_confirm(ctx: Ctx) -> bool:
    if ctx.is_admin:
        return True
    cp = policy(ctx).get("confirm_policy") or {}
    roles, emails = cp.get("roles"), [str(e).lower() for e in cp.get("emails") or []]
    if roles or emails:
        return ctx.role in (roles or []) or (ctx.caller.principal or "").lower() in emails
    return core.role_allows(ctx.role, "packs", "confirm")


def _expected(ctx: Ctx) -> int | None:
    """The If-Match revision; 428 when settings.packs.require_if_match and none was sent."""
    rev = core.if_match(ctx.request)
    if rev is None and policy(ctx).get("require_if_match"):
        raise CapError("precondition_required", "pack writes of this namespace require If-Match")
    return rev


def _fence(ctx: Ctx, c, required: bool | None = None) -> None:
    core.fence(ctx, c, required=bool(policy(ctx).get("fenced")) if required is None else required)


def threshold_of(ctx: Ctx, requested: Any = None) -> float:
    v = requested if requested is not None else policy(ctx).get("duplicate_threshold", DEFAULT_THRESHOLD)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not THRESHOLD_RANGE[0] <= v <= THRESHOLD_RANGE[1]:
        raise CapError("invalid", f"threshold must be a number in {list(THRESHOLD_RANGE)}")
    return float(v)


def _scrub(ctx: Ctx, where: str, body):
    """Mask secrets / PII before storage (F5 write-path hook), outside any transaction."""
    from app.caps import redact
    return redact.scrub(ctx, where, body)


# ── text, hashes, labels ─────────────────────────────────────────────────────

def normalize(text: str) -> str:
    """The stored form of a part: NFC, LF line ends, no trailing blanks per line or at the end, no NUL."""
    t = unicodedata.normalize("NFC", str(text)).replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    return "\n".join(line.rstrip() for line in t.split("\n")).rstrip()


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def version_sha(parts: dict[tuple[str, int], str]) -> str:
    """sha256 over the normalized parts sorted by path and page: [[path, page, part_sha], ...]."""
    return core.sha256_json([[p, pg, s] for (p, pg), s in sorted(parts.items())])


def label(version: int, addendum: int) -> str:
    return f"v{int(version)}.{int(addendum)}"


def parse_label(v: str) -> tuple[int, int]:
    m = LABEL_RE.match((v or "").strip())
    if not m:
        raise CapError("invalid", f"version must look like vN.k (got {v!r})")
    return int(m.group(1)), int(m.group(2) or 0)


def quote_id(path: str, page: int, offset: int) -> str:
    return f"{path}#{int(page)}#{int(offset)}"


def _check_pack(pack: str) -> None:
    if not PACK_RE.match(pack or ""):
        raise CapError("invalid", "pack id must be 1-64 of [A-Za-z0-9_.-], starting alphanumeric")


def _int(v, name: str, lo: int, hi: int, default: int | None = None) -> int:
    if v is None and default is not None:
        return default
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise CapError("invalid", f"{name} must be an integer in [{lo}, {hi}]")
    return v


def _text(v, name: str, limit: int = TEXT_MAX, required: bool = True) -> str | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise CapError("invalid", f"{name} is required")
        return None
    if not isinstance(v, str):
        raise CapError("invalid", f"{name} must be a string")
    v = v.strip()
    if len(v) > limit:
        raise CapError("too_large", f"{name} is longer than {limit} characters")
    return v


def parse_parts(raw, key: str = "parts") -> dict[tuple[str, int], str]:
    """[{path, page?, text}] -> {(path, page): normalized text}."""
    if raw is None:
        return {}
    if not isinstance(raw, list):
        raise CapError("invalid", f"{key} must be a list")
    if len(raw) > PARTS_MAX:
        raise CapError("too_large", f"at most {PARTS_MAX} parts per version")
    out, errors = {}, []
    for i, p in enumerate(raw):
        if not isinstance(p, dict):
            errors.append({"pointer": f"/{key}/{i}", "message": "a part is an object {path, page?, text}"})
            continue
        path, page, text = p.get("path"), p.get("page", 1), p.get("text")
        if not isinstance(path, str) or not PATH_RE.match(path):
            errors.append({"pointer": f"/{key}/{i}/path", "message": "path: 1-400 characters, no '#' or control"})
            continue
        if isinstance(page, bool) or not isinstance(page, int) or not 0 <= page <= 1_000_000:
            errors.append({"pointer": f"/{key}/{i}/page", "message": "page must be an integer in [0, 1000000]"})
            continue
        if not isinstance(text, str):
            errors.append({"pointer": f"/{key}/{i}/text", "message": "text must be a string"})
            continue
        t = normalize(text)
        if len(t) > PART_CHARS_MAX:
            raise CapError("too_large", f"part {path}#{page} is longer than {PART_CHARS_MAX} characters")
        if (path, page) in out:
            errors.append({"pointer": f"/{key}/{i}", "message": f"part {path}#{page} appears twice"})
            continue
        out[(path, page)] = t
    if errors:
        raise CapError("validation_failed", "the parts are not valid", extra={"errors": errors})
    return out


def parse_removals(raw) -> set[tuple[str, int]]:
    if raw is None:
        return set()
    if not isinstance(raw, list) or len(raw) > PARTS_MAX:
        raise CapError("invalid", f"remove must be a list of up to {PARTS_MAX} {{path, page?}}")
    out = set()
    for r in raw:
        if not isinstance(r, dict) or not isinstance(r.get("path"), str):
            raise CapError("invalid", "remove entries are {path, page?}")
        out.add((r["path"], _int(r.get("page"), "page", 0, 1_000_000, default=1)))
    return out


# ── rows ─────────────────────────────────────────────────────────────────────

def _visible(ctx: Ctx, project: str) -> bool:
    """A pack of a project outside the caller's grant is invisible (404, never 403: no existence leak)."""
    return not project or ctx.caller.projects is None or project in ctx.caller.projects


def _head(c, ctx: Ctx, pack: str, must: bool = True):
    r = c.execute("SELECT * FROM kh_pack_head WHERE ns=? AND pack_id=?", [ctx.ns, pack]).fetchone()
    if r is not None and not _visible(ctx, r["project"]):
        r = None
    if r is None and must:
        raise CapError("not_found", f"no pack {pack}")
    return r


def _ver_row(c, ns: str, pack: str, v: int, k: int):
    return c.execute("SELECT * FROM kh_pack WHERE ns=? AND pack_id=? AND version=? AND addendum=?",
                     [ns, pack, v, k]).fetchone()


def _latest(c, ns: str, pack: str, head=None):
    """The latest frozen version row (None when nothing is frozen yet)."""
    if head is None:
        head = c.execute("SELECT * FROM kh_pack_head WHERE ns=? AND pack_id=?", [ns, pack]).fetchone()
    if head is None or head["latest_ver"] is None:
        return None
    return _ver_row(c, ns, pack, int(head["latest_ver"]), int(head["latest_add"]))


def _resolve(c, ctx: Ctx, pack: str, ver: str | None, head=None):
    """A version row by label, 'latest' (latest frozen) or None (latest frozen, else the newest draft)."""
    if not ver or ver == "latest":
        r = _latest(c, ctx.ns, pack, head)
        if r is None and not ver:
            r = c.execute("SELECT * FROM kh_pack WHERE ns=? AND pack_id=? ORDER BY version DESC, addendum DESC "
                          "LIMIT 1", [ctx.ns, pack]).fetchone()
        if r is None:
            raise CapError("not_found", f"pack {pack} has no {'frozen ' if ver else ''}version")
        return r
    v, k = parse_label(ver)
    r = _ver_row(c, ctx.ns, pack, v, k)
    if r is None:
        raise CapError("not_found", f"pack {pack} has no version {label(v, k)}")
    return r


def _decode_ver(r) -> dict:
    return {"pack_id": r["pack_id"], "version": r["label"], "sha256": r["sha256"], "state": r["state"],
            "base": r["base_label"], "parts_n": int(r["parts_n"]), "chars": int(r["chars"]),
            "index_state": r["index_state"], "rev": int(r["rev"]), "created_ms": int(r["created_ms"]),
            "frozen_ms": r["frozen_ms"], "actor": json.loads(r["actor_json"] or "{}")}


def _parts_of(c, ns: str, pack: str, v: int, k: int) -> dict[tuple[str, int], tuple[str, int]]:
    """{(path, page): (sha256, chars)} of one version."""
    return {(r["path"], int(r["page"])): (r["sha256"], int(r["chars"])) for r in c.execute(
        "SELECT path, page, sha256, chars FROM kh_pack_part WHERE ns=? AND pack_id=? AND version=? AND addendum=?",
        [ns, pack, v, k]).fetchall()}


def _blob(c, ns: str, s: str) -> str:
    r = c.execute("SELECT text FROM kh_pack_blob WHERE ns=? AND sha256=?", [ns, s]).fetchone()
    return r["text"] if r is not None else ""


def _texts(c, ns: str, pack: str, v: int, k: int) -> dict[tuple[str, int], str]:
    return {key: _blob(c, ns, s) for key, (s, _n) in _parts_of(c, ns, pack, v, k).items()}


def _put_blobs(c, ns: str, texts: dict[tuple[str, int], str]) -> dict[tuple[str, int], str]:
    shas = {}
    for key, t in texts.items():
        s = sha(t)
        sqldb.insert_new(c, "kh_pack_blob", {"ns": ns, "sha256": s, "text": t})
        shas[key] = s
    return shas


def _write_parts(c, ns: str, pack: str, v: int, k: int, parts: dict[tuple[str, int], tuple[str, int]]) -> None:
    c.execute("DELETE FROM kh_pack_part WHERE ns=? AND pack_id=? AND version=? AND addendum=?", [ns, pack, v, k])
    for (path, page), (s, n) in sorted(parts.items()):
        c.execute("INSERT INTO kh_pack_part (ns, pack_id, version, addendum, path, page, text_ref, sha256, chars) "
                  "VALUES (?,?,?,?,?,?,?,?,?)", [ns, pack, v, k, path, page, s, s, n])


def _overlay(base: dict, texts: dict[tuple[str, int], str], shas: dict, removals: set) -> dict:
    out = {key: val for key, val in base.items() if key not in removals}
    for key, t in texts.items():
        out[key] = (shas[key], len(t))
    return out


def _check_size(parts: dict) -> int:
    if len(parts) > PARTS_MAX:
        raise CapError("too_large", f"at most {PARTS_MAX} parts per version")
    chars = sum(n for _s, n in parts.values())
    if chars > VERSION_CHARS_MAX:
        raise CapError("too_large", f"a version holds at most {VERSION_CHARS_MAX} characters")
    return chars


# ── versions: create, addenda, draft edit ────────────────────────────────────

def create_version(ctx: Ctx, pack: str, body: dict, base_label: str | None = None) -> tuple[dict, bool]:
    """A new major vN.0 (``base_label`` None) or an addendum vN.(k+1) over frozen ``base_label``.
    Returns (version, freeze_requested)."""
    _check_pack(pack)
    if not isinstance(body, dict):
        raise CapError("invalid", "the body must be a JSON object")
    body = _scrub(ctx, f"packs/{pack}/versions", body)
    texts = parse_parts(body.get("parts"))
    removals = parse_removals(body.get("remove"))
    addendum = base_label is not None
    base_label = base_label or body.get("base")
    if addendum and not texts and not removals:
        raise CapError("invalid", "an addendum adds, replaces or removes at least one part")
    title = _text(body.get("title"), "title", 256, required=False)
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        actor = core.jdump(ctx.actor())
        head = _head(c, ctx, pack, must=addendum)
        if head is None:
            project = ctx.require_project(body.get("project"))
            # The first insert wins; a concurrent creator simply reads the winner's head below.
            sqldb.insert_new(c, "kh_pack_head", {
                "ns": ctx.ns, "pack_id": pack, "project": project, "title": title, "latest_ver": None,
                "latest_add": None, "actor_json": actor, "created_ms": now, "updated_ms": now, "rev": 1})
            head = _head(c, ctx, pack)
        if body.get("project") and body["project"] != head["project"]:
            raise CapError("invalid", f"pack {pack} belongs to project {head['project']}")
        base_parts: dict = {}
        if base_label:
            bv, bk = parse_label(base_label)
            b = _ver_row(c, ctx.ns, pack, bv, bk)
            if b is None:
                raise CapError("not_found", f"pack {pack} has no version {label(bv, bk)}")
            if b["state"] != "frozen":
                raise CapError("version_order", f"{b['label']} is {b['state']}: only the latest frozen version "
                                                f"can be a base", status=409, extra={"state": b["state"]})
            base_parts = _parts_of(c, ctx.ns, pack, bv, bk)
            base_label = b["label"]
        missing = sorted(f"{p}#{pg}" for p, pg in removals if (p, pg) not in base_parts and (p, pg) not in texts)
        if missing:
            raise CapError("invalid", f"cannot remove parts that are not in the base: {missing[:20]}")
        shas = _put_blobs(c, ctx.ns, texts)
        parts = _overlay(base_parts, texts, shas, removals)
        if not parts:
            raise CapError("invalid", "a version needs at least one part")
        chars = _check_size(parts)
        if addendum:
            v = bv
            k = sqldb.counter_add(c, f"pka:{ctx.ns}:{pack}:{v}")
        else:
            v, k = sqldb.counter_add(c, f"pkv:{ctx.ns}:{pack}"), 0
        h = version_sha({key: s for key, (s, _n) in parts.items()})
        c.execute("INSERT INTO kh_pack (ns, pack_id, version, addendum, label, sha256, state, base_label, parts_n, "
                  "chars, index_state, actor_json, created_ms, frozen_ms, rev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  [ctx.ns, pack, v, k, label(v, k), h, "draft", base_label, len(parts), chars, "none", actor, now,
                   None, 1])
        _write_parts(c, ctx.ns, pack, v, k, parts)
        _fence(ctx, c)
        out = _decode_ver(_ver_row(c, ctx.ns, pack, v, k))
    out["project"] = head["project"]
    core.emit(ctx, "kh.pack_version", {"pack_id": pack, "version": out["version"], "sha256": out["sha256"],
                                       "base": base_label, "addendum": addendum, "parts_n": out["parts_n"]})
    return out, bool(body.get("freeze"))


def edit_draft(ctx: Ctx, pack: str, ver: str, body: dict) -> dict:
    """Upsert / remove parts of a DRAFT. Conditional on state='draft' (and the If-Match rev)."""
    _check_pack(pack)
    if not isinstance(body, dict):
        raise CapError("invalid", "the body must be a JSON object")
    body = _scrub(ctx, f"packs/{pack}/versions/{ver}", body)
    texts = parse_parts(body.get("parts"))
    removals = parse_removals(body.get("remove"))
    if not texts and not removals:
        raise CapError("invalid", "send parts and/or remove")
    expected = _expected(ctx)
    v, k = parse_label(ver)
    with sqldb.connect() as c:
        _head(c, ctx, pack)
        cur = _ver_row(c, ctx.ns, pack, v, k)
        if cur is None:
            raise CapError("not_found", f"pack {pack} has no version {label(v, k)}")
        if cur["state"] != "draft":
            raise _immutable(cur)
        base = expected if expected is not None and expected >= 0 else int(cur["rev"])
        have = _parts_of(c, ctx.ns, pack, v, k)
        missing = sorted(f"{p}#{pg}" for p, pg in removals if (p, pg) not in have and (p, pg) not in texts)
        if missing:
            raise CapError("invalid", f"cannot remove parts that are not in the draft: {missing[:20]}")
        shas = _put_blobs(c, ctx.ns, texts)
        parts = _overlay(have, texts, shas, removals)
        if not parts:
            raise CapError("invalid", "a version needs at least one part")
        chars = _check_size(parts)
        h = version_sha({key: s for key, (s, _n) in parts.items()})
        if not sqldb.update(c, "UPDATE kh_pack SET sha256=?, parts_n=?, chars=?, rev=rev+1 WHERE ns=? AND pack_id=? "
                               "AND version=? AND addendum=? AND state='draft' AND rev=?",
                            [h, len(parts), chars, ctx.ns, pack, v, k, base]):
            raise _ver_conflict(ctx, c, pack, v, k, expected)
        _write_parts(c, ctx.ns, pack, v, k, parts)
        _fence(ctx, c)
        return _decode_ver(_ver_row(c, ctx.ns, pack, v, k))


def _immutable(r) -> CapError:
    return CapError("pack_immutable", f"version {r['label']} is {r['state']} and immutable",
                    extra={"current": _decode_ver(r)}, headers={"ETag": core.etag(int(r["rev"]))})


def _ver_conflict(ctx: Ctx, c, pack: str, v: int, k: int, expected: int | None) -> CapError:
    cur = _ver_row(c, ctx.ns, pack, v, k)
    if cur is None:
        return CapError("not_found", f"pack {pack} has no version {label(v, k)}")
    if cur["state"] != "draft":
        return _immutable(cur)
    return CapError("write_conflict", "the version changed since you read it", extra={"current": _decode_ver(cur)},
                    headers={"ETag": core.etag(int(cur["rev"]))},
                    kh_events=[(ctx.ns, "kh.write_conflict", {"table": "kh_pack", "pack_id": pack,
                                                              "version": label(v, k), "expected_rev": expected,
                                                              "current_rev": int(cur["rev"])}, ctx.actor())])


# ── chunking (app/chunker.py) and the encoder ────────────────────────────────

_model_box: list = []
_model_lock = threading.Lock()


def encoder(request: Request | None = None):
    """The embedder: app.state.model when the app loaded one, else loaded once here. None when off."""
    if not EMBED:
        return None
    m = getattr(getattr(getattr(request, "app", None), "state", None), "model", None) if request else None
    if m is not None:
        return m
    if not _model_box:
        with _model_lock:                       # one load per process (a cache, not a correctness rule)
            if not _model_box:
                try:
                    from app.embeddings import get_embedder
                    _model_box.append(get_embedder().load())
                except Exception:  # noqa: BLE001
                    logger.exception("packs - no embedder; semantic chunking and lookup are off")
                    _model_box.append(None)
    return _model_box[0]


def embed(model, texts: list[str]) -> list[list[float]]:
    vecs = model.encode(texts, normalize_embeddings=True, batch_size=64, show_progress_bar=False)
    return [list(map(float, v)) for v in vecs]


def _windows(text: str, size: int = CHUNK_CHARS_MAX) -> list[tuple[int, int]]:
    out, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            cut = text.rfind(" ", start + size // 2, end)
            end = cut if cut > start else end
        out.append((start, end - start))
        start = end
        while start < len(text) and text[start].isspace():
            start += 1
    return out


def _span(text: str, piece: str, cursor: int) -> tuple[int, int] | None:
    """Where ``piece`` (sentences re-joined by the chunker) sits in ``text``, whitespace-tolerant."""
    toks = piece.split()
    if not toks:
        return None
    m = re.compile(r"\s+".join(re.escape(t) for t in toks)).search(text, cursor)
    return (m.start(), m.end() - m.start()) if m else None


def chunk_spans(text: str, model) -> list[tuple[int, int]]:
    """(offset, length) spans covering a part: semantic chunks of app/chunker.py when a model is loaded,
    windows of <= CHUNK_CHARS_MAX otherwise; long chunks are split into windows."""
    if not text.strip():
        return []
    spans: list[tuple[int, int]] = []
    if model is not None:
        try:
            from app.chunker import semantic_chunk
            cursor = 0
            for ch in semantic_chunk(text, model):
                s = _span(text, ch["chunk_text"], cursor)
                if s is None:
                    spans = []
                    break
                spans.append(s)
                cursor = s[0] + s[1]
        except Exception:  # noqa: BLE001 - no sentence tokenizer data, odd text: fall back to windows
            logger.exception("packs - semantic chunking failed; using windows")
            spans = []
    if not spans:
        return _windows(text)
    out = []
    for off, n in spans:
        if n <= CHUNK_CHARS_MAX:
            out.append((off, n))
        else:
            out += [(off + o, m) for o, m in _windows(text[off:off + n])]
    return out


def _chunk_quotes(texts: dict[tuple[str, int], str], model) -> list[dict]:
    out = []
    for (path, page), t in sorted(texts.items()):
        for off, n in chunk_spans(t, model):
            piece = t[off:off + n]
            out.append({"path": path, "page": page, "offset": off, "length": n, "text": piece})
    return out


# ── quotes ───────────────────────────────────────────────────────────────────

def _decode_quote(r) -> dict:
    return {"quote_id": r["quote_id"], "pack_id": r["pack_id"], "version": r["version"], "path": r["path"],
            "page": int(r["page"]), "offset": int(r["q_offset"]), "length": int(r["q_length"]), "text": r["text"],
            "sha256": r["sha256"], "origin": r["origin"]}


def _quote(c, ns: str, pack: str, ver: str, qid: str):
    return c.execute("SELECT * FROM kh_quote WHERE ns=? AND pack_id=? AND version=? AND quote_id=?",
                     [ns, pack, ver, qid]).fetchone()


def _put_quote(c, ns: str, pack: str, ver: str, path: str, page: int, off: int, text: str, origin: str,
               now: int) -> tuple[str, bool]:
    """Store a quote of ``text`` at (path, page, off) in ``ver``. Returns (quote_id, created). The plain id
    ``path#page#offset`` when free or holding the same text, else ``...~length``."""
    base = quote_id(path, page, off)
    for qid in (base, f"{base}~{len(text)}"):
        row = {"ns": ns, "pack_id": pack, "version": ver, "quote_id": qid, "path": path, "page": page,
               "q_offset": off, "q_length": len(text), "text": text, "sha256": sha(text), "origin": origin,
               "created_ms": now}
        if sqldb.insert_new(c, "kh_quote", row):
            return qid, True
        cur = _quote(c, ns, pack, ver, qid)
        if cur is not None and cur["text"] == text:
            return qid, False
    raise CapError("invalid", f"no free quote id for {base}")      # same offset, two other lengths: not reached


def _find(texts: dict[tuple[str, int], str], text: str, path: str, page: int, off: int) -> tuple | None:
    """Where ``text`` appears again: same path and page (nearest offset), then same path, then anywhere."""
    def best(keys):
        hits = []
        for key in keys:
            t = texts[key]
            i = t.find(text)
            while i >= 0:
                hits.append((abs(i - off) if key == (path, page) else 0, key, i))
                i = t.find(text, i + 1)
        return min(hits) if hits else None
    tiers = [[k for k in texts if k == (path, page)],
             sorted(k for k in texts if k[0] == path and k != (path, page)),
             sorted(k for k in texts if k[0] != path)]
    for keys in tiers:
        h = best(keys)
        if h is not None:
            return h[1][0], h[1][1], h[2]
    return None


def reanchor(c, ns: str, pack: str, prev_ver: str, new_ver: str, texts: dict, now: int) -> tuple[int, int]:
    """Map every quote of ``prev_ver`` into ``new_ver`` (exact text), recording the map. (reanchored, orphaned)."""
    moved = orphaned = 0
    for q in c.execute("SELECT * FROM kh_quote WHERE ns=? AND pack_id=? AND version=? ORDER BY quote_id",
                       [ns, pack, prev_ver]).fetchall():
        hit = _find(texts, q["text"], q["path"], int(q["page"]), int(q["q_offset"]))
        new_id = None
        if hit is not None:
            new_id, _ = _put_quote(c, ns, pack, new_ver, hit[0], hit[1], hit[2], q["text"], "anchor", now)
            moved += 1
        else:
            orphaned += 1
        sqldb.insert_new(c, "kh_quote_map", {"ns": ns, "pack_id": pack, "from_ver": prev_ver,
                                             "old_quote_id": q["quote_id"], "to_ver": new_ver,
                                             "new_quote_id": new_id})
    return moved, orphaned


def cite(ctx: Ctx, pack: str, body: dict) -> tuple[int, dict]:
    """Mint a quote of a span of a frozen version: by offset/length, or by its exact text."""
    _check_pack(pack)
    if not isinstance(body, dict):
        raise CapError("invalid", "the body must be a JSON object")
    body = _scrub(ctx, f"packs/{pack}/quotes", body)
    path = body.get("path")
    if not isinstance(path, str) or not PATH_RE.match(path):
        raise CapError("invalid", "path is required (1-400 characters, no '#')")
    page = _int(body.get("page"), "page", 0, 1_000_000, default=1)
    want = body.get("text")
    if want is not None and (not isinstance(want, str) or not want or len(want) > QUOTE_CHARS_MAX):
        raise CapError("invalid", f"text must be 1-{QUOTE_CHARS_MAX} characters")
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        head = _head(c, ctx, pack)
        vr = _resolve(c, ctx, pack, body.get("version") or "latest", head)
        if vr["state"] == "draft":
            raise CapError("version_order", f"{vr['label']} is a draft: quote a frozen version", status=409)
        part = _parts_of(c, ctx.ns, pack, int(vr["version"]), int(vr["addendum"])).get((path, page))
        if part is None:
            raise CapError("not_found", f"{vr['label']} has no part {path}#{page}")
        t = _blob(c, ctx.ns, part[0])
        if body.get("offset") is not None:
            off = _int(body.get("offset"), "offset", 0, len(t))
            if body.get("length") is None and want is None:
                raise CapError("invalid", "with offset, send length or the exact text")
            n = _int(body.get("length"), "length", 1, QUOTE_CHARS_MAX) if body.get("length") is not None \
                else len(normalize(want))
            span = t[off:off + n]
            if len(span) != n or (want is not None and span != normalize(want)):
                raise CapError("validation_failed", "the span does not match the part text",
                               extra={"errors": [{"pointer": "/text", "message": "text differs at that offset"}]})
        elif want is not None:
            norm = normalize(want)
            off = t.find(norm)
            if off < 0:
                raise CapError("not_found", f"the text does not appear in {vr['label']} {path}#{page}")
            n = len(norm)
        else:
            raise CapError("invalid", "send offset and length, or the exact text")
        qid, created = _put_quote(c, ctx.ns, pack, vr["label"], path, page, off, t[off:off + n], "cite", now)
        _fence(ctx, c)
        out = _decode_quote(_quote(c, ctx.ns, pack, vr["label"], qid))
    return (201 if created else 200), out


def follow(ctx: Ctx, qid: str, pack: str | None, ver: str | None) -> dict:
    """A quote and where it lives now: hop the quote map version by version to the latest one."""
    with sqldb.connect() as c:
        if pack:
            _check_pack(pack)
            head = _head(c, ctx, pack)
            packs = [pack]
        else:
            rows = c.execute("SELECT DISTINCT pack_id FROM kh_quote WHERE ns=? AND quote_id=?", [ctx.ns, qid]).fetchall()
            packs = [r["pack_id"] for r in rows if _head(c, ctx, r["pack_id"], must=False) is not None]
            if not packs:
                raise CapError("not_found", f"no quote {qid}")
            if len(packs) > 1:
                raise CapError("invalid", f"quote {qid} exists in several packs: pass ?pack=",
                               extra={"packs": sorted(packs)[:50]})
            pack = packs[0]
            head = _head(c, ctx, pack)
        if ver:
            v, k = parse_label(ver)
            start = _quote(c, ctx.ns, pack, label(v, k), qid)
        else:                                          # the newest version that holds this id
            start = None
            for r in c.execute("SELECT q.* FROM kh_quote q JOIN kh_pack p ON p.ns=q.ns AND p.pack_id=q.pack_id "
                               "AND p.label=q.version WHERE q.ns=? AND q.pack_id=? AND q.quote_id=? "
                               "ORDER BY p.version DESC, p.addendum DESC", [ctx.ns, pack, qid]).fetchall():
                start = r
                break
        if start is None:
            raise CapError("not_found", f"no quote {qid} in pack {pack}{' ' + ver if ver else ''}")
        cur, hops, orphaned_at = start, [], None
        for _ in range(MAP_HOPS_MAX):
            m = c.execute("SELECT * FROM kh_quote_map WHERE ns=? AND pack_id=? AND from_ver=? AND old_quote_id=?",
                          [ctx.ns, pack, cur["version"], cur["quote_id"]]).fetchone()
            if m is None:
                break
            if m["new_quote_id"] is None:
                orphaned_at = m["to_ver"]
                break
            nxt = _quote(c, ctx.ns, pack, m["to_ver"], m["new_quote_id"])
            if nxt is None:
                break
            hops.append({"from": f"{cur['version']}:{cur['quote_id']}", "to": f"{nxt['version']}:{nxt['quote_id']}"})
            cur = nxt
        latest = _latest(c, ctx.ns, pack, head)
    if orphaned_at:
        status = "orphaned"                    # the exact text is gone from a later version
    elif latest is not None and cur["version"] == latest["label"]:
        status = "reanchored" if hops else "current"
    else:
        status = "superseded"                  # a later version exists but was not mapped (not expected)
    return {"requested": _decode_quote(start), "latest": _decode_quote(cur), "status": status, "hops": hops,
            "orphaned_at": orphaned_at, "latest_version": latest["label"] if latest is not None else None}


def list_quotes(ctx: Ctx, pack: str, ver: str | None, path: str | None, origin: str | None, limit: int) -> dict:
    with sqldb.connect() as c:
        head = _head(c, ctx, pack)
        vr = _resolve(c, ctx, pack, ver, head)
        where, params = "ns=? AND pack_id=? AND version=?", [ctx.ns, pack, vr["label"]]
        if path:
            where += " AND path=?"
            params.append(path)
        if origin:
            where += " AND origin=?"
            params.append(origin)
        rows = c.execute(f"SELECT * FROM kh_quote WHERE {where} ORDER BY path, page, q_offset, quote_id LIMIT ?",
                         params + [limit]).fetchall()
    return {"pack_id": pack, "version": vr["label"], "quotes": [_decode_quote(r) for r in rows]}


# ── freeze ───────────────────────────────────────────────────────────────────

def freeze(ctx: Ctx, pack: str, ver: str, model=None) -> dict:
    """draft -> frozen: chunk quotes, supersede the previous frozen version, re-anchor its quotes; then vectors."""
    _check_pack(pack)
    _scrub(ctx, f"packs/{pack}/versions/{ver}:freeze", {})
    expected = _expected(ctx)
    v, k = parse_label(ver)
    with sqldb.connect() as c:
        _head(c, ctx, pack)
        cur = _ver_row(c, ctx.ns, pack, v, k)
        if cur is None:
            raise CapError("not_found", f"pack {pack} has no version {label(v, k)}")
        if cur["state"] != "draft":
            raise _immutable(cur)
        base_rev, base_sha = int(cur["rev"]), cur["sha256"]
        texts = _texts(c, ctx.ns, pack, v, k)
    if expected is not None and 0 <= expected != base_rev:
        with sqldb.connect() as c:
            raise _ver_conflict(ctx, c, pack, v, k, expected)
    if version_sha({key: sha(t) for key, t in texts.items()}) != base_sha:
        raise CapError("write_conflict", "the draft changed while it was read; retry")
    chunks = _chunk_quotes(texts, model)                  # embedding work happens OUTSIDE the transaction
    lab = label(v, k)
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        # The pack head row lock serializes freezes of one pack (on HANA and SQLite alike).
        sqldb.update(c, "UPDATE kh_pack_head SET rev=rev+1, updated_ms=? WHERE ns=? AND pack_id=?",
                     [now, ctx.ns, pack])
        if not sqldb.update(c, "UPDATE kh_pack SET state='frozen', frozen_ms=?, index_state=?, rev=rev+1 "
                               "WHERE ns=? AND pack_id=? AND version=? AND addendum=? AND state='draft' AND rev=? "
                               "AND sha256=?", [now, "pending" if EMBED else "off", ctx.ns, pack, v, k,
                                                expected if expected is not None and expected >= 0 else base_rev,
                                                base_sha]):
            raise _ver_conflict(ctx, c, pack, v, k, expected)
        head = c.execute("SELECT * FROM kh_pack_head WHERE ns=? AND pack_id=?", [ctx.ns, pack]).fetchone()
        prev = _latest(c, ctx.ns, pack, head)
        if prev is not None and (int(prev["version"]), int(prev["addendum"])) >= (v, k):
            raise CapError("version_order", f"{lab} does not come after the latest frozen version {prev['label']}",
                           status=409, extra={"latest": prev["label"]})
        quotes = 0
        for q in chunks:
            _put_quote(c, ctx.ns, pack, lab, q["path"], q["page"], q["offset"], q["text"], "chunk", now)
            quotes += 1
        moved = orphaned = 0
        if prev is not None:
            sqldb.update(c, "UPDATE kh_pack SET state='superseded', rev=rev+1 WHERE ns=? AND pack_id=? AND version=? "
                            "AND addendum=? AND state='frozen'", [ctx.ns, pack, int(prev["version"]),
                                                                   int(prev["addendum"])])
            moved, orphaned = reanchor(c, ctx.ns, pack, prev["label"], lab, texts, now)
        sqldb.update(c, "UPDATE kh_pack_head SET latest_ver=?, latest_add=? WHERE ns=? AND pack_id=?",
                     [v, k, ctx.ns, pack])
        _fence(ctx, c)
        out = _decode_ver(_ver_row(c, ctx.ns, pack, v, k))
        project = head["project"]
    out.update(quotes=quotes, reanchored=moved, orphaned=orphaned, superseded=prev["label"] if prev else None)
    out["index_state"] = index_version(ctx.ns, project, pack, lab, model)
    core.emit(ctx, "kh.pack_frozen", {"pack_id": pack, "version": lab, "sha256": out["sha256"],
                                      "superseded": out["superseded"], "quotes": quotes, "reanchored": moved,
                                      "orphaned": orphaned})
    return out


# ── vectors (written after commit; SQL stays the system of record) ───────────

def packs_collection(ns: str) -> str:
    return f"ns_{ns}_packs"


def questions_collection(ns: str) -> str:
    return f"ns_{ns}_questions"


def index_version(ns: str, project: str, pack: str, ver: str, model) -> str:
    """Upsert the chunk quotes of a frozen version as vectors. Never raises: the state says what happened."""
    if not EMBED:
        return "off"
    state = "failed"
    try:
        if model is None:
            state = "no_model"
        else:
            from app import vector_store as vs
            with sqldb.connect() as c:
                rows = c.execute("SELECT * FROM kh_quote WHERE ns=? AND pack_id=? AND version=? AND origin='chunk' "
                                 "ORDER BY quote_id", [ns, pack, ver]).fetchall()
            coll = vs.get_or_create(packs_collection(ns))
            for i in range(0, len(rows), 256):
                batch = rows[i:i + 256]
                for r, vec in zip(batch, embed(model, [r["text"] for r in batch])):
                    vs.upsert_vt(f"{pack}@{ver}#{r['quote_id']}", vec, r["text"],
                                 {"ns": ns, "pack_id": pack, "version": ver, "quote_id": r["quote_id"],
                                  "project": project, "path": r["path"], "page": int(r["page"])}, coll)
            state = "done"
    except Exception:  # noqa: BLE001
        logger.exception("packs - indexing %s/%s@%s failed", ns, pack, ver)
    with sqldb.connect() as c:
        sqldb.update(c, "UPDATE kh_pack SET index_state=? WHERE ns=? AND pack_id=? AND label=?", [state, ns, pack, ver])
    return state


def reindex(ctx: Ctx, pack: str, ver: str, model) -> dict:
    _scrub(ctx, f"packs/{pack}/versions/{ver}:reindex", {})
    with sqldb.connect() as c:
        head = _head(c, ctx, pack)
        vr = _resolve(c, ctx, pack, ver, head)
        if vr["state"] == "draft":
            raise CapError("version_order", f"{vr['label']} is a draft: only frozen versions are indexed", status=409)
        _fence(ctx, c)
    return {"pack_id": pack, "version": vr["label"],
            "index_state": index_version(ctx.ns, head["project"], pack, vr["label"], model)}


# ── reads ────────────────────────────────────────────────────────────────────

def get_pack(ctx: Ctx, pack: str, ver: str | None, with_text: bool) -> dict:
    _check_pack(pack)
    with sqldb.connect() as c:
        head = _head(c, ctx, pack)
        vr = _resolve(c, ctx, pack, ver, head)
        v, k = int(vr["version"]), int(vr["addendum"])
        parts = []
        for (path, page), (s, n) in sorted(_parts_of(c, ctx.ns, pack, v, k).items()):
            p = {"path": path, "page": page, "sha256": s, "chars": n}
            if with_text:
                p["text"] = _blob(c, ctx.ns, s)
            parts.append(p)
        latest = _latest(c, ctx.ns, pack, head)
    return {**_decode_ver(vr), "project": head["project"], "title": head["title"],
            "latest_version": latest["label"] if latest is not None else None, "parts": parts}


def list_versions(ctx: Ctx, pack: str) -> dict:
    with sqldb.connect() as c:
        head = _head(c, ctx, pack)
        rows = c.execute("SELECT * FROM kh_pack WHERE ns=? AND pack_id=? ORDER BY version, addendum LIMIT ?",
                         [ctx.ns, pack, LIST_MAX]).fetchall()
        latest = _latest(c, ctx.ns, pack, head)
    return {"pack_id": pack, "project": head["project"], "latest_version": latest["label"] if latest is not None
            else None, "versions": [_decode_ver(r) for r in rows]}


def list_packs(ctx: Ctx, project: str | None, limit: int) -> dict:
    where, params = "ns=?", [ctx.ns]
    if project:
        where += " AND project=?"
        params.append(project)
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT * FROM kh_pack_head WHERE {where} ORDER BY pack_id LIMIT ?",
                         params + [limit]).fetchall()
    out = []
    for r in rows:
        if not _visible(ctx, r["project"]):
            continue
        out.append({"pack_id": r["pack_id"], "project": r["project"], "title": r["title"],
                    "latest_version": label(r["latest_ver"], r["latest_add"]) if r["latest_ver"] is not None else None,
                    "updated_ms": int(r["updated_ms"])})
    return {"packs": out}


# ── assumptions ──────────────────────────────────────────────────────────────

def _decode_asm(r) -> dict:
    return {"code": r["code"], "pack_id": r["pack_id"], "text": r["text"], "status": r["status"],
            "quote_id": r["quote_id"], "quote_version": r["quote_ver"], "superseded_by": r["superseded_by"],
            "note": r["note"], "rev": int(r["rev"]), "created_ms": int(r["created_ms"]),
            "updated_ms": int(r["updated_ms"]), "actor": json.loads(r["actor_json"] or "{}")}


def _asm(c, ns: str, pack: str, code: str):
    return c.execute("SELECT * FROM kh_assumption WHERE ns=? AND pack_id=? AND code=?", [ns, pack, code]).fetchone()


def _quote_ref(c, ctx: Ctx, pack: str, qid: str | None, ver: str | None, head) -> tuple[str | None, str | None]:
    """Validate a quote reference of this pack: (quote_id, version label) or (None, None)."""
    if qid is None:
        return None, None
    if not isinstance(qid, str) or not qid or len(qid) > 512:
        raise CapError("invalid", "quote_id must be a quote id of this pack")
    if ver:
        v, k = parse_label(ver)
        lab = label(v, k)
        if _quote(c, ctx.ns, pack, lab, qid) is None:
            raise CapError("not_found", f"no quote {qid} in {pack} {lab}")
        return qid, lab
    r = c.execute("SELECT q.version FROM kh_quote q JOIN kh_pack p ON p.ns=q.ns AND p.pack_id=q.pack_id "
                  "AND p.label=q.version WHERE q.ns=? AND q.pack_id=? AND q.quote_id=? "
                  "ORDER BY p.version DESC, p.addendum DESC LIMIT 1", [ctx.ns, pack, qid]).fetchone()
    if r is None:
        raise CapError("not_found", f"no quote {qid} in pack {pack}")
    return qid, r["version"]


def add_assumption(ctx: Ctx, pack: str, body: dict) -> dict:
    _check_pack(pack)
    if not isinstance(body, dict):
        raise CapError("invalid", "the body must be a JSON object")
    body = _scrub(ctx, f"packs/{pack}/assumptions", body)
    text = _text(body.get("text"), "text")
    status = body.get("status") or "open"
    if status != "open":
        raise CapError("invalid", "a new assumption starts open; confirm or refute it with PATCH")
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        head = _head(c, ctx, pack)
        qid, qver = _quote_ref(c, ctx, pack, body.get("quote_id"), body.get("version"), head)
        n = sqldb.counter_add(c, f"asm:{ctx.ns}:{pack}")
        code = f"ASSUMED-{n}"
        c.execute("INSERT INTO kh_assumption (ns, pack_id, code, n, text, status, quote_id, quote_ver, superseded_by, "
                  "note, actor_json, created_ms, updated_ms, rev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  [ctx.ns, pack, code, n, text, "open", qid, qver, None, _text(body.get("note"), "note",
                                                                                required=False),
                   core.jdump(ctx.actor()), now, now, 1])
        _fence(ctx, c)
        out = _decode_asm(_asm(c, ctx.ns, pack, code))
    core.emit(ctx, "kh.assumption", {"pack_id": pack, "code": code, "status": "open", "old_status": None})
    return out


def patch_assumption(ctx: Ctx, pack: str, code: str, body: dict) -> dict:
    _check_pack(pack)
    if not CODE_RE.match(code or ""):
        raise CapError("invalid", "an assumption code is ASSUMED-<n>")
    if not isinstance(body, dict) or not body:
        raise CapError("invalid", "send status, text, quote_id, superseded_by and/or note")
    unknown = set(body) - {"status", "text", "quote_id", "version", "superseded_by", "note"}
    if unknown:
        raise CapError("invalid", f"unknown fields: {sorted(unknown)}")
    body = _scrub(ctx, f"packs/{pack}/assumptions/{code}", body)
    status = body.get("status")
    if status is not None and status not in ASM_STATES:
        raise CapError("invalid", f"status must be one of {list(ASM_STATES)}")
    content = any(k in body for k in ("text", "quote_id", "note", "superseded_by"))
    if status in ASM_CONFIRM and not can_confirm(ctx):
        raise CapError("forbidden", f"setting {status} needs the packs confirm policy (role {ctx.role})")
    if content or status not in ASM_CONFIRM:
        can_write(ctx)
    expected = _expected(ctx)
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        head = _head(c, ctx, pack)
        cur = _asm(c, ctx.ns, pack, code)
        if cur is None:
            raise CapError("not_found", f"no assumption {code} in pack {pack}")
        if cur["status"] == "superseded":
            raise CapError("assumption_final", f"{code} is superseded and final", status=409,
                           extra={"current": _decode_asm(cur)}, headers={"ETag": core.etag(int(cur["rev"]))})
        sets: dict[str, Any] = {"updated_ms": now, "actor_json": core.jdump(ctx.actor())}
        if "text" in body:
            sets["text"] = _text(body.get("text"), "text")
        if "note" in body:
            sets["note"] = _text(body.get("note"), "note", required=False)
        if "quote_id" in body:
            sets["quote_id"], sets["quote_ver"] = _quote_ref(c, ctx, pack, body.get("quote_id"), body.get("version"),
                                                             head)
        new_status = status or cur["status"]
        if "superseded_by" in body:
            sb = body.get("superseded_by")
            if sb is not None:
                if not isinstance(sb, str) or sb == code or _asm(c, ctx.ns, pack, sb) is None:
                    raise CapError("invalid", "superseded_by must be another assumption code of this pack")
                new_status = status or "superseded"
            sets["superseded_by"] = sb
        changed = any(k in sets and sets[k] != cur[k] for k in ("text", "quote_id"))
        if changed and status is None and cur["status"] in ASM_CONFIRM:
            new_status = "open"                # the content changed: a confirmation does not carry over
        sets["status"] = new_status
        core.cas_update(ctx, c, "kh_assumption", {"ns": ctx.ns, "pack_id": pack, "code": code}, sets,
                        expected if expected is not None else int(cur["rev"]),
                        load_current=lambda: _decode_asm(_asm(c, ctx.ns, pack, code)),
                        extra_where="status<>'superseded'")
        _fence(ctx, c)
        out = _decode_asm(_asm(c, ctx.ns, pack, code))
    if out["status"] != cur["status"]:
        core.emit(ctx, "kh.assumption", {"pack_id": pack, "code": code, "status": out["status"],
                                         "old_status": cur["status"]})
    return out


def list_assumptions(ctx: Ctx, pack: str, status: str | None, limit: int) -> dict:
    if status and status not in ASM_STATES:
        raise CapError("invalid", f"status must be one of {list(ASM_STATES)}")
    with sqldb.connect() as c:
        _head(c, ctx, pack)
        sql, params = "SELECT * FROM kh_assumption WHERE ns=? AND pack_id=?", [ctx.ns, pack]
        if status:
            sql += " AND status=?"
            params.append(status)
        rows = c.execute(sql + " ORDER BY n LIMIT ?", params + [limit]).fetchall()
    return {"pack_id": pack, "assumptions": [_decode_asm(r) for r in rows]}


def get_assumption(ctx: Ctx, pack: str, code: str) -> dict:
    with sqldb.connect() as c:
        _head(c, ctx, pack)
        r = _asm(c, ctx.ns, pack, code)
    if r is None:
        raise CapError("not_found", f"no assumption {code} in pack {pack}")
    return _decode_asm(r)


# ── duplicate questions ──────────────────────────────────────────────────────

_NEG = {"not", "no", "never", "without", "cannot", "neither", "nor", "none"}
_NUMS = {"zero": 0, "one": 1, "once": 1, "single": 1, "two": 2, "twice": 2, "double": 2, "three": 3, "thrice": 3,
         "triple": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
         "twelve": 12, "hundred": 100, "thousand": 1000}
#: Generic opposite pairs (no consumer vocabulary). Two texts that each hold one side are not duplicates.
OPPOSITES = [
    ("above", "below"), ("over", "under"), ("before", "after"), ("min", "max"), ("minimum", "maximum"),
    ("lowest", "highest"), ("smallest", "largest"), ("first", "last"), ("earliest", "latest"),
    ("oldest", "newest"), ("start", "end"), ("begin", "end"), ("open", "close"), ("login", "logout"),
    ("signin", "signout"), ("upload", "download"), ("import", "export"), ("input", "output"),
    ("inbound", "outbound"), ("incoming", "outgoing"), ("send", "receive"), ("read", "write"),
    ("enable", "disable"), ("include", "exclude"), ("allow", "deny"), ("allow", "block"), ("accept", "reject"),
    ("approve", "reject"), ("add", "remove"), ("create", "delete"), ("insert", "delete"), ("increase", "decrease"),
    ("increment", "decrement"), ("higher", "lower"), ("more", "less"), ("more", "fewer"), ("upper", "lower"),
    ("success", "failure"), ("succeed", "fail"), ("pass", "fail"), ("valid", "invalid"), ("true", "false"),
    ("encrypt", "decrypt"), ("encode", "decode"), ("lock", "unlock"), ("show", "hide"), ("public", "private"),
    ("internal", "external"), ("inside", "outside"), ("client", "server"), ("parent", "child"),
    ("buy", "sell"), ("debit", "credit"), ("required", "optional"), ("mandatory", "optional"),
    ("synchronous", "asynchronous"), ("sync", "async"), ("ascending", "descending"), ("left", "right"),
    ("horizontal", "vertical"), ("upgrade", "downgrade"), ("online", "offline"), ("hourly", "daily"),
    ("daily", "weekly"), ("weekly", "monthly"), ("daily", "monthly"), ("monthly", "yearly"), ("monthly", "annual"),
    ("credit", "debit"), ("import", "export"), ("source", "target"), ("source", "destination"), ("win", "lose"),
    ("gain", "loss"), ("profit", "loss"), ("plus", "minus"), ("positive", "negative"), ("expand", "collapse"),
    ("connect", "disconnect"), ("subscribe", "unsubscribe"), ("install", "uninstall"), ("attach", "detach"),
    ("freeze", "unfreeze"), ("archive", "unarchive"), ("block", "unblock"), ("mute", "unmute"),
    ("in", "out"), ("on", "off"), ("up", "down"),
]


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            w = w[: -len(suf)]
            break
    return w[:-1] if len(w) > 3 and w.endswith("e") else w


_OPP = [(_stem(a), _stem(b)) for a, b in OPPOSITES]


def tokens(text: str) -> list[str]:
    t = unicodedata.normalize("NFKC", text or "").lower().replace("n't", " not").replace("’", "'")
    t = re.sub(r"\b(log|sign)[\s\-](in|on|out|off)\b", lambda m: m.group(1) + ("out" if m.group(2) in ("out", "off")
                                                                                 else "in"), t)
    return re.findall(r"[a-z]+|\d+(?:\.\d+)?", t)


def norm_question(text: str) -> str:
    return " ".join(tokens(text))


def contrast(a: str, b: str) -> str | None:
    """Why two near-identical questions still ask different things, or None. Generic and lexical only:
    a different set of numbers, a different negation, or one side of an opposite pair each."""
    ta, tb = tokens(a), tokens(b)

    def nums(ts):
        return {float(t) if t[0].isdigit() else float(_NUMS[t]) for t in ts if t[0].isdigit() or t in _NUMS}
    if nums(ta) != nums(tb):
        return "numbers"
    if (sum(t in _NEG for t in ta) % 2) != (sum(t in _NEG for t in tb) % 2):
        return "negation"
    sa, sb = {_stem(t) for t in ta}, {_stem(t) for t in tb}
    for x, y in _OPP:
        for p, q in ((x, y), (y, x)):
            if p in sa and p not in sb and q in sb and q not in sa:
                return f"opposite:{p}/{q}"
    return None


def is_duplicate(score: float, a: str, b: str, threshold: float = DEFAULT_THRESHOLD) -> bool:
    """THE duplicate rule: cosine >= threshold and no contrast."""
    return score >= threshold and contrast(a, b) is None


def _decode_q(r) -> dict:
    return {"question_id": r["question_id"], "pack_id": r["pack_id"], "text": r["text"], "status": r["status"],
            "answer": r["answer"], "quote_id": r["quote_id"], "quote_version": r["quote_ver"],
            "asked_n": int(r["asked_n"]), "rev": int(r["rev"]), "created_ms": int(r["created_ms"]),
            "updated_ms": int(r["updated_ms"]), "actor": json.loads(r["actor_json"] or "{}")}


def _q(c, ns: str, pack: str, qid: str):
    return c.execute("SELECT * FROM kh_pack_question WHERE ns=? AND pack_id=? AND question_id=?",
                     [ns, pack, qid]).fetchone()


def _bump_asked(ns: str, pack: str, qid: str) -> None:
    with sqldb.connect() as c:
        sqldb.update(c, "UPDATE kh_pack_question SET asked_n=asked_n+1 WHERE ns=? AND pack_id=? AND question_id=?",
                     [ns, pack, qid])


def _dup_answer(ctx: Ctx, pack: str, row, score: float, how: str, threshold: float) -> dict:
    _bump_asked(ctx.ns, pack, row["question_id"])
    core.emit(ctx, "kh.question_duplicate", {"pack_id": pack, "duplicate_of": row["question_id"],
                                             "score": round(score, 4), "match": how, "threshold": threshold})
    return {"duplicate_of": row["question_id"], "score": round(score, 4), "match": how, "threshold": threshold,
            "status": row["status"], "text": row["text"], "answer": row["answer"], "quote_id": row["quote_id"],
            "quote_version": row["quote_ver"]}


def lookup(ctx: Ctx, pack: str, body: dict, model) -> tuple[int, dict]:
    """Duplicate of an open / answered question of the pack (200), or store the new question (201)."""
    _check_pack(pack)
    if not isinstance(body, dict):
        raise CapError("invalid", "the body must be a JSON object")
    body = _scrub(ctx, f"packs/{pack}/questions", body)
    text = _text(body.get("text"), "text", 2000)
    threshold = threshold_of(ctx, body.get("threshold"))
    store = body.get("store", True)
    if not isinstance(store, bool):
        raise CapError("invalid", "store must be true or false")
    key = sha(norm_question(text))
    with sqldb.connect() as c:
        head = _head(c, ctx, pack)
        exact = c.execute("SELECT * FROM kh_pack_question WHERE ns=? AND pack_id=? AND text_sha=?",
                          [ctx.ns, pack, key]).fetchone()
    if exact is not None and exact["status"] in Q_LIVE:
        return 200, _dup_answer(ctx, pack, exact, 1.0, "exact", threshold)
    vec, candidates, semantic = None, [], False
    if model is not None:
        try:
            from app import vector_store as vs
            vec = embed(model, [text])[0]
            coll = vs.get_or_create(questions_collection(ctx.ns))
            hits = vs.query_vt(vec, LOOKUP_K, where={"pack_id": {"$eq": pack}}, collection=coll)
            semantic = True
            ids = [h["metadata"].get("question_id") for h in hits]
            with sqldb.connect() as c:
                rows = {i: _q(c, ctx.ns, pack, i) for i in ids if i}
            for h in hits:
                r = rows.get(h["metadata"].get("question_id"))
                if r is None or r["status"] not in Q_LIVE:
                    continue
                why = contrast(text, r["text"])
                candidates.append({"question_id": r["question_id"], "score": round(float(h["score"]), 4),
                                   "status": r["status"], "contrast": why, "row": r})
        except Exception:  # noqa: BLE001 - the vector layer is an index: degrade to exact matching
            logger.exception("packs - question lookup by meaning failed for %s/%s", ctx.ns, pack)
            semantic = False
    candidates.sort(key=lambda x: -x["score"])
    for cand in candidates:
        if is_duplicate(cand["score"], text, cand["row"]["text"], threshold):
            return 200, _dup_answer(ctx, pack, cand["row"], cand["score"], "semantic", threshold)
    near = [{k: v for k, v in x.items() if k != "row"} for x in candidates[:3]]
    if not store:
        return 200, {"duplicate_of": None, "score": near[0]["score"] if near else None, "threshold": threshold,
                     "semantic": semantic, "candidates": near}
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        if exact is not None:                   # an exact repeat of a CLOSED question reopens that question
            if not sqldb.update(c, "UPDATE kh_pack_question SET status='open', asked_n=asked_n+1, updated_ms=?, "
                                   "rev=rev+1 WHERE ns=? AND pack_id=? AND question_id=? AND status='closed'",
                                [now, ctx.ns, pack, exact["question_id"]]):
                exact = None
            qid, created = (exact["question_id"], False) if exact is not None else (None, True)
        else:
            qid, created = None, True
        if qid is None:
            n = sqldb.counter_add(c, f"pq:{ctx.ns}:{pack}")
            qid = f"Q-{n}"
            row = {"ns": ctx.ns, "pack_id": pack, "question_id": qid, "n": n, "text": text, "text_sha": key,
                   "status": "open", "answer": None, "quote_id": None, "quote_ver": None, "asked_n": 1,
                   "indexed": 0, "actor_json": core.jdump(ctx.actor()), "created_ms": now, "updated_ms": now,
                   "rev": 1}
            if not sqldb.insert_new(c, "kh_pack_question", row):
                created = False                 # the same question was stored concurrently: it is the duplicate
        _fence(ctx, c, required=False)
    if not created and exact is None:
        with sqldb.connect() as c:
            twin = c.execute("SELECT * FROM kh_pack_question WHERE ns=? AND pack_id=? AND text_sha=?",
                             [ctx.ns, pack, key]).fetchone()
        return 200, _dup_answer(ctx, pack, twin, 1.0, "exact", threshold)
    if vec is not None and created:
        try:
            from app import vector_store as vs
            vs.upsert_vt(f"{pack}#{qid}", vec, text, {"ns": ctx.ns, "pack_id": pack, "question_id": qid,
                                                      "project": head["project"]},
                         vs.get_or_create(questions_collection(ctx.ns)))
            with sqldb.connect() as c:
                sqldb.update(c, "UPDATE kh_pack_question SET indexed=1 WHERE ns=? AND pack_id=? AND question_id=?",
                             [ctx.ns, pack, qid])
        except Exception:  # noqa: BLE001
            logger.exception("packs - could not index question %s/%s/%s", ctx.ns, pack, qid)
    with sqldb.connect() as c:
        out = _decode_q(_q(c, ctx.ns, pack, qid))
    return 201, {**out, "duplicate_of": None, "threshold": threshold, "semantic": semantic, "candidates": near}


def patch_question(ctx: Ctx, pack: str, qid: str, body: dict) -> dict:
    _check_pack(pack)
    if not QID_RE.match(qid or ""):
        raise CapError("invalid", "a question id is Q-<n>")
    if not isinstance(body, dict) or not body:
        raise CapError("invalid", "send status, answer and/or quote_id")
    unknown = set(body) - {"status", "answer", "quote_id", "version"}
    if unknown:
        raise CapError("invalid", f"unknown fields: {sorted(unknown)}")
    body = _scrub(ctx, f"packs/{pack}/questions/{qid}", body)
    status = body.get("status")
    if status is not None and status not in Q_STATES:
        raise CapError("invalid", f"status must be one of {list(Q_STATES)}")
    expected = _expected(ctx)
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        head = _head(c, ctx, pack)
        cur = _q(c, ctx.ns, pack, qid)
        if cur is None:
            raise CapError("not_found", f"no question {qid} in pack {pack}")
        sets: dict[str, Any] = {"updated_ms": now, "actor_json": core.jdump(ctx.actor())}
        if "answer" in body:
            sets["answer"] = _text(body.get("answer"), "answer", required=False)
        if "quote_id" in body:
            sets["quote_id"], sets["quote_ver"] = _quote_ref(c, ctx, pack, body.get("quote_id"), body.get("version"),
                                                             head)
        sets["status"] = status or ("answered" if sets.get("answer") and cur["status"] == "open" else cur["status"])
        if sets["status"] == "answered" and not sets.get("answer", cur["answer"]):
            raise CapError("invalid", "an answered question needs an answer")
        core.cas_update(ctx, c, "kh_pack_question", {"ns": ctx.ns, "pack_id": pack, "question_id": qid}, sets,
                        expected if expected is not None else int(cur["rev"]),
                        load_current=lambda: _decode_q(_q(c, ctx.ns, pack, qid)))
        _fence(ctx, c)
        return _decode_q(_q(c, ctx.ns, pack, qid))


def list_questions(ctx: Ctx, pack: str, status: str | None, limit: int) -> dict:
    if status and status not in Q_STATES:
        raise CapError("invalid", f"status must be one of {list(Q_STATES)}")
    with sqldb.connect() as c:
        _head(c, ctx, pack)
        sql, params = "SELECT * FROM kh_pack_question WHERE ns=? AND pack_id=?", [ctx.ns, pack]
        if status:
            sql += " AND status=?"
            params.append(status)
        rows = c.execute(sql + " ORDER BY n LIMIT ?", params + [limit]).fetchall()
    return {"pack_id": pack, "questions": [_decode_q(r) for r in rows]}


def get_question(ctx: Ctx, pack: str, qid: str) -> dict:
    with sqldb.connect() as c:
        _head(c, ctx, pack)
        r = _q(c, ctx.ns, pack, qid)
    if r is None:
        raise CapError("not_found", f"no question {qid} in pack {pack}")
    return _decode_q(r)


# ── lifecycle hook ───────────────────────────────────────────────────────────

def _on_state(c, ns: str, old: str, new: str) -> None:       # noqa: ARG001
    if new != "purged":
        return
    for t in TABLES:
        c.execute(f"DELETE FROM {t} WHERE ns=?", [ns])
    try:
        from app import vector_store as vs
        for name in (packs_collection(ns), questions_collection(ns)):
            vs.drop_collection(name)
    except Exception:  # noqa: BLE001 - the vectors are an index; SQL rows are gone
        logger.exception("packs - could not drop the vector collections of %s", ns)


# ── routes ───────────────────────────────────────────────────────────────────

async def _json(request: Request):
    raw = await request.body()
    try:
        return json.loads(raw or b"{}")
    except ValueError:
        raise CapError("invalid", "body must be JSON")


def _limit(limit: int) -> int:
    return max(1, min(int(limit), LIST_MAX))


def retrieval_provider(ctx: Ctx, req: dict) -> list[dict]:
    """Tier 'packs' of the namespace /context/step (caps/retrieval.py PROVIDERS): chunk quotes of the
    project's frozen versions, closest first, latest frozen version of each pack only."""
    model = encoder()
    q, project = (req.get("query") or "").strip(), req.get("project")
    if model is None or not q or not project:
        return []
    from app import vector_store as vs
    with sqldb.connect() as c:
        latest = {r["pack_id"]: r["label"] for r in c.execute(
            "SELECT pack_id, label FROM kh_pack WHERE ns=? AND state='frozen' ORDER BY pack_id, version, addendum",
            [ctx.ns]).fetchall()}
    if not latest:
        return []
    coll = vs.get_or_create(packs_collection(ctx.ns))
    hits = vs.query_vt(embed(model, [q])[0], max(1, int(req.get("limit") or 5)) * 4, {"project": project}, coll)
    out = []
    for h in hits:
        md = h.get("metadata") or {}
        if latest.get(md.get("pack_id")) != md.get("version"):
            continue
        out.append({"id": f"{md.get('pack_id')}@{md.get('version')}#{md.get('quote_id')}",
                    "text": h.get("source_text") or "", "score": float(h.get("score") or 0)})
    return out


def attach(app) -> None:
    from app.caps import registry
    TAG = ["v1 packs"]
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)
    from app.caps import retrieval as _retrieval
    _retrieval.PROVIDERS["packs"] = retrieval_provider

    def etag_reply(status: int, body: dict) -> Any:
        return core.reply(status, body, {"ETag": core.etag(body["rev"])} if "rev" in body else {})

    async def _model(request: Request):
        return await asyncio.to_thread(encoder, request)

    # Colon routes first, so that ':freeze' never reads as part of a version label.
    @app.post("/v1/{ns}/packs/{pack}/versions/{ver}:freeze", tags=TAG,
              summary="Freeze a draft: immutable, chunk quotes, re-anchor the previous version's quotes")
    @core.idempotent
    async def pack_freeze(request: Request, ns: str, pack: str, ver: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        model = await _model(request)
        return etag_reply(200, await asyncio.to_thread(freeze, ctx, pack, ver, model))

    @app.post("/v1/{ns}/packs/{pack}/versions/{ver}:reindex", tags=TAG, summary="Rebuild a frozen version's vectors")
    @core.idempotent
    async def pack_reindex(request: Request, ns: str, pack: str, ver: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        model = await _model(request)
        return await asyncio.to_thread(reindex, ctx, pack, ver, model)

    @app.post("/v1/{ns}/packs/{pack}/questions:lookup", tags=TAG,
              summary="Duplicate of an open/answered question (cosine >= threshold, no contrast), else store it")
    @core.idempotent
    async def pack_lookup(request: Request, ns: str, pack: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        body = await _json(request)
        model = await _model(request)
        status, out = await asyncio.to_thread(lookup, ctx, pack, body, model)
        return core.reply(status, out, {"ETag": core.etag(out["rev"])} if "rev" in out else {})

    @app.post("/v1/{ns}/packs/{pack}/versions", tags=TAG, summary="Upload parts as a new version vN.0 (draft)")
    @core.idempotent
    async def pack_new_version(request: Request, ns: str, pack: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        body = await _json(request)
        out, then_freeze = await asyncio.to_thread(create_version, ctx, pack, body)
        if then_freeze:
            model = await _model(request)
            out = await asyncio.to_thread(freeze, ctx, pack, out["version"], model)
        return etag_reply(201, out)

    @app.post("/v1/{ns}/packs/{pack}/versions/{ver}/addenda", tags=TAG,
              summary="Addendum vN.(k+1) over the frozen vN.k (parts overlaid)")
    @core.idempotent
    async def pack_addendum(request: Request, ns: str, pack: str, ver: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        body = await _json(request)
        out, then_freeze = await asyncio.to_thread(create_version, ctx, pack, body, ver)
        if then_freeze:
            model = await _model(request)
            out = await asyncio.to_thread(freeze, ctx, pack, out["version"], model)
        return etag_reply(201, out)

    @app.patch("/v1/{ns}/packs/{pack}/versions/{ver}", tags=TAG, summary="Edit the parts of a draft (If-Match)")
    @core.idempotent
    async def pack_edit(request: Request, ns: str, pack: str, ver: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        body = await _json(request)
        return etag_reply(200, await asyncio.to_thread(edit_draft, ctx, pack, ver, body))

    @app.get("/v1/{ns}/packs/{pack}/versions", tags=TAG, summary="Every version of a pack")
    async def pack_versions(ns: str, pack: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(list_versions, ctx, pack)

    @app.post("/v1/{ns}/packs/{pack}/quotes", tags=TAG, summary="Cite a span of a frozen version (quote id)")
    @core.idempotent
    async def pack_cite(request: Request, ns: str, pack: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        body = await _json(request)
        status, out = await asyncio.to_thread(cite, ctx, pack, body)
        return core.reply(status, out)

    @app.get("/v1/{ns}/packs/{pack}/quotes", tags=TAG, summary="Quotes of a version")
    async def pack_quotes(ns: str, pack: str, version: str = "", path: str = "", origin: str = "",
                          limit: int = LIST_MAX, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(list_quotes, ctx, pack, version or None, path or None, origin or None,
                                       _limit(limit))

    @app.get("/v1/{ns}/quotes/{qid:path}", tags=TAG, summary="A quote, followed through the quote map to the latest")
    async def quote_get(ns: str, qid: str, pack: str = "", version: str = "", ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(follow, ctx, qid, pack or None, version or None)

    @app.post("/v1/{ns}/packs/{pack}/assumptions", tags=TAG, summary="Register an assumption (ASSUMED-n, open)")
    @core.idempotent
    async def asm_add(request: Request, ns: str, pack: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        body = await _json(request)
        return etag_reply(201, await asyncio.to_thread(add_assumption, ctx, pack, body))

    @app.patch("/v1/{ns}/packs/{pack}/assumptions/{code}", tags=TAG,
               summary="Change an assumption (If-Match); confirmed/refuted need the confirm policy")
    @core.idempotent
    async def asm_patch(request: Request, ns: str, pack: str, code: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("packs", "read", type_row=_acl_row(ctx), op="read")
        body = await _json(request)
        return etag_reply(200, await asyncio.to_thread(patch_assumption, ctx, pack, code, body))

    @app.get("/v1/{ns}/packs/{pack}/assumptions", tags=TAG, summary="The assumption register of a pack")
    async def asm_list(ns: str, pack: str, status: str = "", limit: int = LIST_MAX, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(list_assumptions, ctx, pack, status or None, _limit(limit))

    @app.get("/v1/{ns}/packs/{pack}/assumptions/{code}", tags=TAG, summary="One assumption")
    async def asm_get(ns: str, pack: str, code: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return etag_reply(200, await asyncio.to_thread(get_assumption, ctx, pack, code))

    @app.patch("/v1/{ns}/packs/{pack}/questions/{qid}", tags=TAG, summary="Answer / close / reopen a question")
    @core.idempotent
    async def q_patch(request: Request, ns: str, pack: str, qid: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        body = await _json(request)
        return etag_reply(200, await asyncio.to_thread(patch_question, ctx, pack, qid, body))

    @app.get("/v1/{ns}/packs/{pack}/questions", tags=TAG, summary="Questions of a pack")
    async def q_list(ns: str, pack: str, status: str = "", limit: int = LIST_MAX, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(list_questions, ctx, pack, status or None, _limit(limit))

    @app.get("/v1/{ns}/packs/{pack}/questions/{qid}", tags=TAG, summary="One question")
    async def q_get(ns: str, pack: str, qid: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return etag_reply(200, await asyncio.to_thread(get_question, ctx, pack, qid))

    @app.get("/v1/{ns}/packs", tags=TAG, summary="Packs of the namespace")
    async def packs_list(ns: str, project: str = "", limit: int = LIST_MAX, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(list_packs, ctx, project or None, _limit(limit))

    @app.get("/v1/{ns}/packs/{pack}", tags=TAG, summary="A pack version (default: latest frozen) and its parts")
    async def pack_get(ns: str, pack: str, version: str = "", text: bool = False, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return etag_reply(200, await asyncio.to_thread(get_pack, ctx, pack, version or None, text))
