"""Rule graph (docs/multi-agent-instance-design.md 4.6, slice F9).

A rule is ``(entity, attribute, condition, effect, source quote, validity)`` of the consumer's running
system. KH stores, links, walks and counts rules; it never judges what a rule MEANS.

  PUT  /v1/{ns}/rules/{id}                 create (If-None-Match: *) or update (If-Match), fenced on demand
  GET  /v1/{ns}/rules/{id}                 one rule with its links and ETag
  GET  /v1/{ns}/rules?project=&entity=&attribute=&validity=&run_id=&limit=
  POST /v1/{ns}/rules/{id}:confirm         {validity: verified|contradicted, run_id?}  (confirm policy)
  POST /v1/{ns}/rules:bulk                 {project, rules:[...] <= 5000}  bootstrap, validity unverified,
                                           deduped by content hash; all or nothing unless ?partial=true
  POST /v1/{ns}/rules:query                {project, start_entities[], hops<=3, relations[], validity_in[],
                                           min_confidence, path: auto|sql} -> rules, edges, conflict pairs,
                                           and ``path`` = graph | sql (+ fallback_reason)
  POST /v1/{ns}/rules/scans                {scan_id, project, entities_scanned[]} -> coverage_any / _verified
  GET  /v1/{ns}/rules/scans[/{scan_id}]
  POST /v1/{ns}/rules:gate                 {run_id, project, entities[]} -> {pass, missing[], orphans[]}
  POST /v1/{ns}/rules:reproject            {project} rebuild the graph projection from SQL

SYSTEM OF RECORD. ``kh_rule`` / ``kh_rule_link`` in app/sqldb.py carry every correctness rule: rev with
If-Match (conditional UPDATE), create-only through the primary key, dedupe through a unique content hash
``(ns, rule_hash)`` over (project, entity, attribute, condition, effect), fencing inside the same transaction.
``kh_rule_run`` records which rules a run wrote or confirmed (what ``:gate`` checks).

PROJECTION. After commit a rule is written to ``get_project_graph('<ns>__<project>')`` (Kuzu directory or
HANA table prefix): node ``rule__<id>`` (entity_type 'rule', attributes = the rule's fields), node
``ent__<entity key>`` (entity_type 'entity'), and edges APPLIES_TO (the rule's own entity), AFFECTS and
DEPENDS_ON (its links), each with the rule's confidence. A projection failure never fails a write: the
(ns, project) is marked ``stale`` in ``kh_rule_proj`` and queries use the bounded SQL walk until
``:reproject`` (or the ``rules_reproject`` cron) rebuilt it. Every query answer says which path it used.

POLICY (manifest ``settings.rules``, all optional):
  {"fenced": bool, "require_if_match": bool, "read_roles": [...], "write_roles": [...],
   "confirm_policy": {"roles": [...], "emails": [...]}}
Moving validity to verified or contradicted needs the confirm policy: by default a role holding
``rules:confirm`` (confirmer) or the namespace admin; ``confirm_policy`` replaces that list.

GATE. ``pass`` when every listed entity has a live rule (not retired / superseded) written or confirmed in
``run_id`` AND the run left no orphans. An orphan is a run rule with neither ``quote_id`` nor ``source_text``
(no traceable source), or a DEPENDS_ON link of a run rule to an entity that has no live rule in the project.

CONFLICT CANDIDATES (generic, no semantics): two live rules of the same entity and attribute whose
normalized effects differ while their conditions overlap. Conditions are split into clauses on
``and`` / ``&&`` / ``;`` / ``,``; they overlap when either is unconditional (empty, ``*``, ``always``,
``true``, ``any``), when the clause sets are equal, or when one clause set contains the other; otherwise they are
``possible`` candidates unless a clause of one provably excludes a clause of the other (comparisons on the same
left-hand side with disjoint ranges, ``x is v`` vs ``x is not v``, ``not p`` vs ``p``, ``= a`` vs ``= b``).
Every pair names its ``overlap`` kind, so a consumer can keep only the stronger kinds.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import threading
import unicodedata

from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "rules"
VERSION = "1.0.0"
STATUS = "beta"
BULK_MAX = 5000
MAX_HOPS = 3
QUERY_SEEDS_MAX = 100
QUERY_RULES_MAX = 5000
SCAN_ENTITIES_MAX = 10000
LINKS_MAX = 50
CONFLICTS_MAX = 500
LIMITS = {"bulk_max": BULK_MAX, "max_hops": MAX_HOPS, "start_entities": QUERY_SEEDS_MAX,
          "query_rules": QUERY_RULES_MAX, "scan_entities": SCAN_ENTITIES_MAX, "links_per_rule": LINKS_MAX}

VALIDITY = ("unverified", "verified", "contradicted", "superseded", "retired")
CONFIRM_STATES = {"verified", "contradicted"}
DEAD = ("superseded", "retired")              # not counted by coverage, gate or conflicts
ORIGINS = ("bootstrap", "scan", "write_back")
RELATIONS = ("APPLIES_TO", "AFFECTS", "DEPENDS_ON")
LINK_RELATIONS = ("AFFECTS", "DEPENDS_ON")
ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,128}$")
RESERVED_IDS = {"scans"}
_CHUNK = 400

#: Switch the projection off for this process (KH_RULES_GRAPH=false): every query then uses SQL.
GRAPH_ENABLED = config._flag("KH_RULES_GRAPH", "true")

# ── tables ───────────────────────────────────────────────────────────────────

_DDL = {
    "kh_rule": ("""CREATE TABLE IF NOT EXISTS kh_rule (
                     ns TEXT NOT NULL, rule_id TEXT NOT NULL, project TEXT NOT NULL, entity TEXT NOT NULL,
                     entity_key TEXT NOT NULL, attribute TEXT NOT NULL, attribute_key TEXT NOT NULL,
                     cond TEXT NOT NULL, effect TEXT NOT NULL, quote_id TEXT, source_text TEXT,
                     validity TEXT NOT NULL, confidence REAL NOT NULL, origin TEXT NOT NULL, run_id TEXT,
                     superseded_by TEXT, rule_hash TEXT NOT NULL, provenance_json TEXT NOT NULL,
                     actor_json TEXT NOT NULL, rev INTEGER NOT NULL, created_ms INTEGER NOT NULL,
                     updated_ms INTEGER NOT NULL, PRIMARY KEY (ns, rule_id))""",
                """CREATE COLUMN TABLE kh_rule (
                     ns NVARCHAR(32) NOT NULL, rule_id NVARCHAR(128) NOT NULL, project NVARCHAR(256) NOT NULL,
                     entity NVARCHAR(256) NOT NULL, entity_key NVARCHAR(256) NOT NULL,
                     attribute NVARCHAR(256) NOT NULL, attribute_key NVARCHAR(256) NOT NULL,
                     cond NVARCHAR(4000) NOT NULL, effect NVARCHAR(4000) NOT NULL, quote_id NVARCHAR(128),
                     source_text NCLOB, validity NVARCHAR(16) NOT NULL, confidence DOUBLE NOT NULL,
                     origin NVARCHAR(16) NOT NULL, run_id NVARCHAR(128), superseded_by NVARCHAR(128),
                     rule_hash NVARCHAR(64) NOT NULL, provenance_json NCLOB NOT NULL, actor_json NCLOB NOT NULL,
                     rev BIGINT NOT NULL, created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL,
                     PRIMARY KEY (ns, rule_id))"""),
    "kh_rule_link": ("""CREATE TABLE IF NOT EXISTS kh_rule_link (
                          ns TEXT NOT NULL, rule_id TEXT NOT NULL, project TEXT NOT NULL, relation TEXT NOT NULL,
                          to_entity TEXT NOT NULL, to_key TEXT NOT NULL,
                          PRIMARY KEY (ns, rule_id, relation, to_key))""",
                     """CREATE COLUMN TABLE kh_rule_link (
                          ns NVARCHAR(32) NOT NULL, rule_id NVARCHAR(128) NOT NULL, project NVARCHAR(256) NOT NULL,
                          relation NVARCHAR(32) NOT NULL, to_entity NVARCHAR(256) NOT NULL,
                          to_key NVARCHAR(256) NOT NULL, PRIMARY KEY (ns, rule_id, relation, to_key))"""),
    "kh_rule_run": ("""CREATE TABLE IF NOT EXISTS kh_rule_run (
                         ns TEXT NOT NULL, run_id TEXT NOT NULL, rule_id TEXT NOT NULL, action TEXT NOT NULL,
                         at_ms INTEGER NOT NULL, PRIMARY KEY (ns, run_id, rule_id))""",
                    """CREATE COLUMN TABLE kh_rule_run (
                         ns NVARCHAR(32) NOT NULL, run_id NVARCHAR(128) NOT NULL, rule_id NVARCHAR(128) NOT NULL,
                         action NVARCHAR(16) NOT NULL, at_ms BIGINT NOT NULL, PRIMARY KEY (ns, run_id, rule_id))"""),
    "kh_rule_scan": ("""CREATE TABLE IF NOT EXISTS kh_rule_scan (
                          ns TEXT NOT NULL, scan_id TEXT NOT NULL, project TEXT NOT NULL, run_id TEXT,
                          request_sha TEXT NOT NULL, n_scanned INTEGER NOT NULL, n_any INTEGER NOT NULL,
                          n_verified INTEGER NOT NULL, coverage_any REAL NOT NULL, coverage_verified REAL NOT NULL,
                          result_json TEXT NOT NULL, actor_json TEXT NOT NULL, created_ms INTEGER NOT NULL,
                          PRIMARY KEY (ns, scan_id))""",
                     """CREATE COLUMN TABLE kh_rule_scan (
                          ns NVARCHAR(32) NOT NULL, scan_id NVARCHAR(128) NOT NULL, project NVARCHAR(256) NOT NULL,
                          run_id NVARCHAR(128), request_sha NVARCHAR(64) NOT NULL, n_scanned BIGINT NOT NULL,
                          n_any BIGINT NOT NULL, n_verified BIGINT NOT NULL, coverage_any DOUBLE NOT NULL,
                          coverage_verified DOUBLE NOT NULL, result_json NCLOB NOT NULL, actor_json NCLOB NOT NULL,
                          created_ms BIGINT NOT NULL, PRIMARY KEY (ns, scan_id))"""),
    "kh_rule_proj": ("""CREATE TABLE IF NOT EXISTS kh_rule_proj (
                          ns TEXT NOT NULL, project TEXT NOT NULL, state TEXT NOT NULL, error TEXT,
                          updated_ms INTEGER NOT NULL, PRIMARY KEY (ns, project))""",
                     """CREATE COLUMN TABLE kh_rule_proj (
                          ns NVARCHAR(32) NOT NULL, project NVARCHAR(256) NOT NULL, state NVARCHAR(16) NOT NULL,
                          error NVARCHAR(1000), updated_ms BIGINT NOT NULL, PRIMARY KEY (ns, project))"""),
}
TABLES = list(_DDL)
#: State about this instance's graph projection, not consumer data: not exported (the import rebuilds the
#: projection from SQL and writes it again), still purged with the namespace.
LOCAL_TABLES = ["kh_rule_proj"]


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ux_kh_rule_hash", "kh_rule", "ns, rule_hash", unique=True)
    sqldb.create_index(c, "ix_kh_rule_entity", "kh_rule", "ns, project, entity_key")
    sqldb.create_index(c, "ix_kh_rule_attr", "kh_rule", "ns, project, attribute_key")
    sqldb.create_index(c, "ix_kh_rule_runid", "kh_rule", "ns, run_id")
    sqldb.create_index(c, "ix_kh_rule_link_to", "kh_rule_link", "ns, project, to_key")
    sqldb.create_index(c, "ix_kh_rule_scan_proj", "kh_rule_scan", "ns, project, created_ms")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1)])


# ── normalization ────────────────────────────────────────────────────────────

def fold(text: str) -> str:
    """Entity-card normalization (same as app.entities.fold, kept local to avoid importing the vector store):
    lowercase, accents stripped, every non-alphanumeric run to one space."""
    n = unicodedata.normalize("NFD", text or "")
    n = "".join(ch for ch in n if not unicodedata.combining(ch))
    return " ".join("".join(ch if ch.isalnum() else " " for ch in n.lower()).split())


def squash(text: str) -> str:
    """Condition / effect normalization: lowercase, whitespace collapsed (operators are kept)."""
    return " ".join((text or "").lower().split())


def rule_hash(project: str, entity_key: str, attribute_key: str, cond: str, effect: str) -> str:
    return hashlib.sha256(core.jdump([project, entity_key, attribute_key, squash(cond), squash(effect)])
                          .encode("utf-8")).hexdigest()


_SPLIT = re.compile(r"\s+and\s+|&&|;|,")
_WILDCARD = {"", "*", "always", "true", "any"}


def clauses(cond: str) -> frozenset[str] | None:
    """The clause set of a condition, or None when it is unconditional."""
    s = squash(cond)
    if s in _WILDCARD:
        return None
    return frozenset(x.strip() for x in _SPLIT.split(s) if x.strip())


#: Comparison words -> operators (applied on word boundaries before a clause is parsed).
_WORD_OPS = [(re.compile(r"\b(?:is\s+)?(?:greater|more|higher)\s+than\b|\bexceeds\b|\babove\b|\bover\b"), " > "),
             (re.compile(r"\b(?:is\s+)?(?:less|fewer|lower)\s+than\b|\bbelow\b|\bunder\b"), " < "),
             (re.compile(r"\b(?:is\s+)?at\s+least\b"), " >= "),
             (re.compile(r"\b(?:is\s+)?at\s+most\b"), " <= ")]
_CMP = re.compile(r"^(?P<lhs>.+?)\s*(?P<op><=|>=|!=|==|=|<|>)\s*(?P<rhs>.+)$")
_IS = re.compile(r"^(?P<lhs>.+?)\s+is\s+(?P<neg>not\s+)?(?P<rhs>.+)$")
_NUM = re.compile(r"^(-?\d+(?:\.\d+)?)\s*(.*)$")


def _parse_clause(cl: str):
    """(lhs, op, value) of a comparison clause, ('not', clause) of a negation, or None. Generic: no domain words."""
    s = cl
    for rx, op in _WORD_OPS:
        s = rx.sub(op, s)
    s = " ".join(s.split())
    m = _CMP.match(s)
    if m:
        op = "=" if m["op"] == "==" else m["op"]
        rhs = m["rhs"].strip()
        n = _NUM.match(rhs)
        return (m["lhs"].strip(), op, (float(n[1]), n[2].strip()) if n else (None, rhs))
    m = _IS.match(cl)
    if m:
        return (m["lhs"].strip(), "is_not" if m["neg"] else "is", (None, m["rhs"].strip()))
    if cl.startswith("not "):
        return ("not", cl[4:].strip())
    return None


def _interval(op: str, v: float):
    """(lo, lo_incl, hi, hi_incl) of a comparison; None for != (handled apart)."""
    inf = float("inf")
    return {">": (v, False, inf, False), ">=": (v, True, inf, False), "<": (-inf, False, v, False),
            "<=": (-inf, False, v, True), "=": (v, True, v, True)}.get(op)


def _exclusive(x: str, y: str) -> bool:
    """True when clause x and clause y cannot both hold (proof from the text alone, else False)."""
    px, py = _parse_clause(x), _parse_clause(y)
    if px is None and py is None:
        return False
    if (px and px[0] == "not" and px[1] == y) or (py and py[0] == "not" and py[1] == x):
        return True
    if not px or not py or px[0] == "not" or py[0] == "not" or px[0] != py[0]:
        return False
    (_, ox, (nx, ux)), (_, oy, (ny, uy)) = px, py
    if {ox, oy} <= {"is", "is_not"}:
        return ox != oy and ux == uy                      # x is V  vs  x is not V
    if "is" in (ox, oy) or "is_not" in (ox, oy):
        return False
    if nx is None or ny is None:                          # symbolic right-hand sides: comparable only when equal
        if nx is not None or ny is not None or ux != uy:
            return ox == oy == "=" and ux != uy and nx is None and ny is None
        nx = ny = 0.0
    elif ux != uy:                                        # different units: no proof
        return False
    if "!=" in (ox, oy):
        return {ox, oy} == {"!=", "="} and nx == ny
    ix, iy = _interval(ox, nx), _interval(oy, ny)
    lo, lo_in = max((ix[0], ix[1]), (iy[0], iy[1]), key=lambda t: (t[0], not t[1]))
    hi, hi_in = min((ix[2], ix[3]), (iy[2], iy[3]), key=lambda t: (t[0], t[1]))
    return lo > hi or (lo == hi and not (lo_in and hi_in))


def overlap(a: str, b: str) -> str | None:
    """unconditional | same | subsumes | possible | None.

    ``possible``: the clause sets differ and neither contains the other, but no clause of one rules out a clause of
    the other, so both rules can apply to the same case (the classic interaction: 'total exceeds the credit limit'
    vs 'customer is VIP'). None only when the text proves the conditions disjoint ('x > 5' vs 'x < 5',
    'x is a' vs 'x is not a', 'not p' vs 'p', 'status = a' vs 'status = b')."""
    ca, cb = clauses(a), clauses(b)
    if ca is None or cb is None:
        return "unconditional"
    if ca == cb:
        return "same"
    if ca <= cb or cb <= ca:
        return "subsumes"
    if any(_exclusive(x, y) for x in ca for y in cb):
        return None
    return "possible"


# ── policy from the manifest (settings.rules) ────────────────────────────────

def policy(ctx: Ctx) -> dict:
    cfg = ((ctx.ns_row.get("config") or {}).get("settings") or {}).get("rules") or {}
    return cfg if isinstance(cfg, dict) else {}


def _acl_row(ctx: Ctx) -> dict:
    p = policy(ctx)
    return {"type": "rules", "read_roles": p.get("read_roles") or [], "write_roles": p.get("write_roles") or []}


def can_confirm(ctx: Ctx) -> bool:
    if ctx.is_admin:
        return True
    cp = policy(ctx).get("confirm_policy") or {}
    roles, emails = cp.get("roles"), [str(e).lower() for e in cp.get("emails") or []]
    if roles or emails:
        return ctx.role in (roles or []) or (ctx.caller.principal or "").lower() in emails
    return core.role_allows(ctx.role, "rules", "confirm")


def require_confirm(ctx: Ctx, validity: str) -> None:
    if not can_confirm(ctx):
        raise CapError("forbidden", f"setting validity {validity} needs the rules confirm policy "
                                    f"(role {ctx.role} does not satisfy it)")


# ── body parsing ─────────────────────────────────────────────────────────────

def _str(body: dict, key: str, errors: list, pointer: str, required: bool = False, limit: int = 256) -> str:
    v = body.get(key)
    if v is None or v == "":
        if required:
            errors.append({"pointer": f"{pointer}/{key}", "message": f"{key} is required"})
        return ""
    if not isinstance(v, str) or len(v) > limit:
        errors.append({"pointer": f"{pointer}/{key}", "message": f"{key} must be a string <= {limit}"})
        return ""
    return v


def parse_rule(body, pointer: str = "") -> tuple[dict, list[dict]]:
    """Validate a rule body. Returns (fields, errors); fields hold what the body named."""
    if not isinstance(body, dict):
        return {}, [{"pointer": pointer or "/", "message": "a rule must be an object"}]
    errors: list[dict] = []
    out: dict = {
        "entity": _str(body, "entity", errors, pointer, required=True),
        "attribute": _str(body, "attribute", errors, pointer, required=True),
        "cond": _str(body, "condition", errors, pointer, limit=4000),
        "effect": _str(body, "effect", errors, pointer, required=True, limit=4000),
        "quote_id": _str(body, "quote_id", errors, pointer, limit=128) or None,
        "source_text": _str(body, "source_text", errors, pointer, limit=16000) or None,
        "superseded_by": _str(body, "superseded_by", errors, pointer, limit=128) or None,
        "run_id": _str(body, "run_id", errors, pointer, limit=128) or None,
    }
    if out["entity"] and not fold(out["entity"]):
        errors.append({"pointer": f"{pointer}/entity", "message": "entity has no letters or digits"})
    if out["attribute"] and not fold(out["attribute"]):
        errors.append({"pointer": f"{pointer}/attribute", "message": "attribute has no letters or digits"})
    v = body.get("validity")
    if v is not None and v not in VALIDITY:
        errors.append({"pointer": f"{pointer}/validity", "message": f"validity must be one of {list(VALIDITY)}"})
    out["validity"] = v
    o = body.get("origin")
    if o is not None and o not in ORIGINS:
        errors.append({"pointer": f"{pointer}/origin", "message": f"origin must be one of {list(ORIGINS)}"})
    out["origin"] = o
    conf = body.get("confidence", 1.0)
    if isinstance(conf, bool) or not isinstance(conf, (int, float)) or not 0.0 <= float(conf) <= 1.0:
        errors.append({"pointer": f"{pointer}/confidence", "message": "confidence must be a number in [0, 1]"})
        conf = 1.0
    out["confidence"] = float(conf)
    prov = body.get("provenance", {})
    if not isinstance(prov, dict) or len(core.jdump(prov)) > 16384:
        errors.append({"pointer": f"{pointer}/provenance", "message": "provenance must be an object <= 16 KB"})
        prov = {}
    out["provenance"] = prov
    links = body.get("links") or []
    parsed = []
    if not isinstance(links, list) or len(links) > LINKS_MAX:
        errors.append({"pointer": f"{pointer}/links", "message": f"links must be a list of <= {LINKS_MAX}"})
        links = []
    for i, ln in enumerate(links):
        rel = ln.get("relation") if isinstance(ln, dict) else None
        to = ln.get("to_entity") if isinstance(ln, dict) else None
        if rel not in LINK_RELATIONS or not isinstance(to, str) or not fold(to) or len(to) > 256:
            errors.append({"pointer": f"{pointer}/links/{i}",
                           "message": f"a link needs relation ({'|'.join(LINK_RELATIONS)}) and to_entity"})
            continue
        key = fold(to)
        if not any(p["relation"] == rel and p["to_key"] == key for p in parsed):
            parsed.append({"relation": rel, "to_entity": to, "to_key": key})
    out["links"] = parsed
    if out["superseded_by"] and v != "superseded":
        errors.append({"pointer": f"{pointer}/superseded_by", "message": "superseded_by goes with validity superseded"})
    return out, errors


def _check_id(rule_id: str) -> None:
    if not ID_RE.match(rule_id or "") or rule_id in RESERVED_IDS:
        raise CapError("invalid", "rule id must be 1-128 of [A-Za-z0-9_.-] (not 'scans')")


# ── rows ─────────────────────────────────────────────────────────────────────

def _decode(r, links: list[dict] | None = None) -> dict:
    return {"rule_id": r["rule_id"], "project": r["project"], "entity": r["entity"], "entity_key": r["entity_key"],
            "attribute": r["attribute"], "attribute_key": r["attribute_key"], "condition": r["cond"],
            "effect": r["effect"], "quote_id": r["quote_id"], "source_text": r["source_text"],
            "validity": r["validity"], "confidence": float(r["confidence"]), "origin": r["origin"],
            "run_id": r["run_id"], "superseded_by": r["superseded_by"],
            "provenance": json.loads(r["provenance_json"] or "{}"), "actor": json.loads(r["actor_json"] or "{}"),
            "rev": int(r["rev"]), "created_ms": int(r["created_ms"]), "updated_ms": int(r["updated_ms"]),
            "links": links if links is not None else []}


def _links_of(c, ns: str, ids: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {i: [] for i in ids}
    for part in _chunks(ids):
        for r in c.execute(f"SELECT rule_id, relation, to_entity, to_key FROM kh_rule_link WHERE ns=? AND rule_id IN "
                           f"({','.join('?' for _ in part)}) ORDER BY rule_id, relation, to_key", [ns, *part]).fetchall():
            out.setdefault(r["rule_id"], []).append({"relation": r["relation"], "to_entity": r["to_entity"],
                                                     "to_key": r["to_key"]})
    return out


def _load(c, ns: str, ids: list[str]) -> dict[str, dict]:
    rows = {}
    for part in _chunks(ids):
        for r in c.execute(f"SELECT * FROM kh_rule WHERE ns=? AND rule_id IN ({','.join('?' for _ in part)})",
                           [ns, *part]).fetchall():
            rows[r["rule_id"]] = r
    links = _links_of(c, ns, list(rows))
    return {i: _decode(r, links.get(i, [])) for i, r in rows.items()}


def get_one(c, ns: str, rule_id: str) -> dict | None:
    return _load(c, ns, [rule_id]).get(rule_id)


def _chunks(seq, n: int = _CHUNK):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _note_run(c, ns: str, run_id: str | None, rule_id: str, action: str, now: int) -> None:
    if not run_id:
        return
    if not sqldb.insert_new(c, "kh_rule_run", {"ns": ns, "run_id": run_id, "rule_id": rule_id, "action": action,
                                              "at_ms": now}):
        sqldb.update(c, "UPDATE kh_rule_run SET action=?, at_ms=? WHERE ns=? AND run_id=? AND rule_id=?",
                     [action, now, ns, run_id, rule_id])


def _set_links(c, ns: str, project: str, rule_id: str, links: list[dict]) -> None:
    c.execute("DELETE FROM kh_rule_link WHERE ns=? AND rule_id=?", [ns, rule_id])
    for ln in links:
        sqldb.insert_new(c, "kh_rule_link", {"ns": ns, "rule_id": rule_id, "project": project,
                                             "relation": ln["relation"], "to_entity": ln["to_entity"],
                                             "to_key": ln["to_key"]})


def _duplicate(ctx: Ctx, c, h: str, rule_id: str | None) -> CapError:
    r = c.execute("SELECT rule_id FROM kh_rule WHERE ns=? AND rule_hash=?", [ctx.ns, h]).fetchone()
    other = r["rule_id"] if r else None
    return CapError("duplicate", f"the same rule already exists as {other}", extra={"existing_rule_id": other},
                    kh_events=[(ctx.ns, "kh.duplicate", {"what": "rule", "rule_id": rule_id,
                                                         "existing_rule_id": other}, ctx.actor())])


# ── single write (PUT) ───────────────────────────────────────────────────────

def put_rule(ctx: Ctx, rule_id: str, body: dict) -> tuple[int, dict, int]:
    _check_id(rule_id)
    pol = policy(ctx)
    f, errors = parse_rule(body)
    if errors:
        raise CapError("validation_failed", "the rule is not valid", extra={"errors": errors})
    project = ctx.require_project(body.get("project"))
    expected = core.if_match(ctx.request)
    if expected is None and pol.get("require_if_match") and not core.if_none_match_star(ctx.request):
        raise CapError("precondition_required", "rules of this namespace require If-Match (or If-None-Match: *)")
    run_id = f["run_id"] or ctx.run_id
    ek, ak = fold(f["entity"]), fold(f["attribute"])
    h = rule_hash(project, ek, ak, f["cond"], f["effect"])
    actor = core.jdump(ctx.actor())
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        old = c.execute("SELECT * FROM kh_rule WHERE ns=? AND rule_id=?", [ctx.ns, rule_id]).fetchone()
        if old is not None and core.if_none_match_star(ctx.request):
            raise CapError("duplicate", f"rule {rule_id} exists", headers={"ETag": core.etag(old["rev"])})
        if old is None and expected is not None and expected >= 0:
            raise CapError("not_found", f"no rule {rule_id}")
        validity = f["validity"]
        if validity is None:
            if old is None:
                validity = "unverified"
            elif old["rule_hash"] != h and old["validity"] in CONFIRM_STATES:
                validity = "unverified"            # the content changed: a confirmation does not carry over
            else:
                validity = old["validity"]
        changes_confirmation = validity in CONFIRM_STATES and (
            old is None or old["validity"] != validity or old["rule_hash"] != h)
        if changes_confirmation:
            require_confirm(ctx, validity)
        if old is not None and old["project"] != project:
            raise CapError("invalid", f"rule {rule_id} belongs to project {old['project']}; a rule cannot move")
        row = {"project": project, "entity": f["entity"], "entity_key": ek, "attribute": f["attribute"],
               "attribute_key": ak, "cond": f["cond"], "effect": f["effect"], "quote_id": f["quote_id"],
               "source_text": f["source_text"], "validity": validity, "confidence": f["confidence"],
               "origin": f["origin"] or (old["origin"] if old is not None else "write_back"), "run_id": run_id,
               "superseded_by": f["superseded_by"], "rule_hash": h, "provenance_json": core.jdump(f["provenance"]),
               "actor_json": actor, "updated_ms": now}
        try:
            if old is None:
                if not sqldb.insert_new(c, "kh_rule", {"ns": ctx.ns, "rule_id": rule_id, **row, "rev": 1,
                                                       "created_ms": now}):
                    if c.execute("SELECT 1 FROM kh_rule WHERE ns=? AND rule_id=?", [ctx.ns, rule_id]).fetchone():
                        raise CapError("duplicate", f"rule {rule_id} was created concurrently")
                    raise _duplicate(ctx, c, h, rule_id)
                rev, status = 1, 201
            else:
                rev = core.cas_update(ctx, c, "kh_rule", {"ns": ctx.ns, "rule_id": rule_id}, row, expected,
                                      load_current=lambda: get_one(c, ctx.ns, rule_id))
                status = 200
        except CapError:
            raise
        except Exception as exc:  # noqa: BLE001 - the unique hash index refused an UPDATE
            if sqldb.is_duplicate(exc):
                raise _duplicate(ctx, c, h, rule_id)
            raise
        _set_links(c, ctx.ns, project, rule_id, f["links"])
        _note_run(c, ctx.ns, run_id, rule_id, "confirmed" if changes_confirmation else "written", now)
        core.fence(ctx, c, required=bool(pol.get("fenced")))
        out = get_one(c, ctx.ns, rule_id)
    out["projection"] = project_rules(ctx.ns, project, [out], replace=old is not None)
    return status, out, rev


# ── confirm ──────────────────────────────────────────────────────────────────

def confirm(ctx: Ctx, rule_id: str, body: dict) -> tuple[dict, int]:
    _check_id(rule_id)
    validity = (body or {}).get("validity", "verified")
    if validity not in CONFIRM_STATES:
        raise CapError("invalid", f"validity must be one of {sorted(CONFIRM_STATES)}")
    ctx.require("rules", "read", type_row=_acl_row(ctx), op="read")
    require_confirm(ctx, validity)
    pol = policy(ctx)
    expected = core.if_match(ctx.request)
    if expected is None and pol.get("require_if_match"):
        raise CapError("precondition_required", "rules of this namespace require If-Match")
    run_id = (body or {}).get("run_id") or ctx.run_id
    if run_id is not None and (not isinstance(run_id, str) or len(run_id) > 128):
        raise CapError("invalid", "run_id must be a string <= 128")
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        old = c.execute("SELECT project FROM kh_rule WHERE ns=? AND rule_id=?", [ctx.ns, rule_id]).fetchone()
        if old is None:
            raise CapError("not_found", f"no rule {rule_id}")
        ctx.require_project(old["project"])
        sets = {"validity": validity, "updated_ms": now, "actor_json": core.jdump(ctx.actor())}
        if run_id:
            sets["run_id"] = run_id
        rev = core.cas_update(ctx, c, "kh_rule", {"ns": ctx.ns, "rule_id": rule_id}, sets, expected,
                              load_current=lambda: get_one(c, ctx.ns, rule_id))
        _note_run(c, ctx.ns, run_id, rule_id, "confirmed", now)
        core.fence(ctx, c, required=bool(pol.get("fenced")))
        out = get_one(c, ctx.ns, rule_id)
    out["projection"] = project_rules(ctx.ns, out["project"], [out], replace=True)
    return out, rev


# ── bulk bootstrap ───────────────────────────────────────────────────────────

def bulk(ctx: Ctx, doc: dict, partial: bool) -> tuple[int, dict]:
    items = doc.get("rules") if isinstance(doc, dict) else None
    if not isinstance(items, list):
        raise CapError("invalid", "body must be {project, rules: [...]}")
    if len(items) > BULK_MAX:
        raise CapError("too_large", f"at most {BULK_MAX} rules per call")
    project = ctx.require_project(doc.get("project"))
    pol = policy(ctx)
    run_default = doc.get("run_id") or ctx.run_id
    confirm_ok = can_confirm(ctx)
    prepared, rejected = [], []
    for i, raw in enumerate(items):
        f, errors = parse_rule(raw, f"/rules/{i}")
        rid = raw.get("rule_id") if isinstance(raw, dict) else None
        if rid is not None and (not isinstance(rid, str) or not ID_RE.match(rid) or rid in RESERVED_IDS):
            errors.append({"pointer": f"/rules/{i}/rule_id", "message": "rule_id must be 1-128 of [A-Za-z0-9_.-]"})
        if isinstance(raw, dict) and raw.get("project") not in (None, "", project):
            errors.append({"pointer": f"/rules/{i}/project", "message": "every rule of a bulk call is in its project"})
        validity = f.get("validity") or "unverified"
        if validity in CONFIRM_STATES and not confirm_ok:
            errors.append({"pointer": f"/rules/{i}/validity",
                           "message": f"{validity} needs the rules confirm policy; bootstrap rules are unverified"})
        if errors:
            rejected.append({"index": i, "errors": errors})
            continue
        ek, ak = fold(f["entity"]), fold(f["attribute"])
        h = rule_hash(project, ek, ak, f["cond"], f["effect"])
        row = {"ns": ctx.ns, "rule_id": rid or "r_" + h[:24], "project": project, "entity": f["entity"],
               "entity_key": ek, "attribute": f["attribute"], "attribute_key": ak, "cond": f["cond"],
               "effect": f["effect"], "quote_id": f["quote_id"], "source_text": f["source_text"],
               "validity": validity, "confidence": f["confidence"], "origin": f["origin"] or "bootstrap",
               "run_id": f["run_id"] or run_default, "superseded_by": f["superseded_by"], "rule_hash": h,
               "provenance_json": core.jdump(f["provenance"]), "actor_json": core.jdump(ctx.actor()), "rev": 1}
        prepared.append((i, row, f["links"], None))
    if rejected and not partial:
        return 422, {"error": "validation_failed", "detail": "no rule was stored (send ?partial=true to keep the "
                                                             "valid ones)", "accepted": [], "rejected": rejected}
    accepted, created = [], []
    dup_ids = []
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        by_hash: dict[str, str] = {}                     # content hash -> rule id, within this call
        for i, row, links, _first in prepared:
            row["created_ms"] = row["updated_ms"] = now
            h = row["rule_hash"]
            if h in by_hash:                                 # same content twice in this call
                accepted.append({"index": i, "rule_id": by_hash[h], "duplicate": True})
                dup_ids.append(by_hash[h])
                continue
            if sqldb.insert_new(c, "kh_rule", row):
                _set_links(c, ctx.ns, project, row["rule_id"], links)
                _note_run(c, ctx.ns, row["run_id"], row["rule_id"],
                          "confirmed" if row["validity"] in CONFIRM_STATES else "written", now)
                accepted.append({"index": i, "rule_id": row["rule_id"], "duplicate": False})
                created.append(row["rule_id"])
                by_hash[h] = row["rule_id"]
                continue
            ex = c.execute("SELECT rule_id FROM kh_rule WHERE ns=? AND rule_hash=?", [ctx.ns, h]).fetchone()
            if ex is not None:
                # Re-asserting an existing rule in a run counts as that run writing it (the gate sees it).
                _note_run(c, ctx.ns, row["run_id"], ex["rule_id"], "written", now)
                accepted.append({"index": i, "rule_id": ex["rule_id"], "duplicate": True})
                dup_ids.append(ex["rule_id"])
                by_hash[h] = ex["rule_id"]
                continue
            err = {"index": i, "errors": [{"pointer": f"/rules/{i}/rule_id",
                                           "message": f"rule {row['rule_id']} exists with other content (use PUT)"}]}
            if not partial:
                raise CapError("duplicate", f"rule {row['rule_id']} exists with other content; nothing was stored",
                               extra={"rejected": [err]})
            rejected.append(err)
        core.fence(ctx, c, required=bool(pol.get("fenced")))
        fresh = list(_load(c, ctx.ns, created).values()) if created else []
    if dup_ids:
        core.emit(ctx, "kh.duplicate", {"what": "rule", "rule_ids": dup_ids[:100], "count": len(dup_ids)})
    projection = project_rules(ctx.ns, project, fresh) if fresh else proj_state(ctx.ns, project)
    rejected.sort(key=lambda r: r["index"])
    return 200, {"accepted": accepted, "rejected": rejected, "created": len(created),
                 "duplicates": len(dup_ids), "projection": projection}


# ── graph projection ─────────────────────────────────────────────────────────

_proj_locks: dict[str, threading.Lock] = {}
_proj_locks_guard = threading.Lock()


def graph_id(ns: str, project: str) -> str:
    return f"{ns}__{project or '_'}"


def _graph(ns: str, project: str):
    """The (ns, project) graph adapter. Tests replace this to simulate an unavailable graph."""
    from app.graph_db.project_graph import get_project_graph
    return get_project_graph(graph_id(ns, project))


def _lock_for(gid: str) -> threading.Lock:
    """Serializes THIS instance's writes into one embedded graph (Kuzu has one writer). Not a correctness
    lock: SQL decides every rule; this only keeps local projection writes from tripping over each other."""
    with _proj_locks_guard:
        return _proj_locks.setdefault(gid, threading.Lock())


def rule_node(rule_id: str) -> str:
    return "rule__" + rule_id


def entity_node(entity_key: str) -> str:
    return "ent__" + entity_key.replace(" ", "-")


def _graph_items(rules: list[dict]) -> tuple[list[dict], list[dict]]:
    nodes: dict[str, dict] = {}
    edges: dict[tuple, dict] = {}
    for r in rules:
        attrs = {k: r[k] for k in ("rule_id", "project", "entity", "attribute", "condition", "effect", "quote_id",
                                   "validity", "confidence", "origin", "run_id", "superseded_by", "rev")}
        nodes[rule_node(r["rule_id"])] = {"core_id": rule_node(r["rule_id"]), "type": "rule",
                                          "label": f"{r['entity']}.{r['attribute']}", "attributes": attrs,
                                          "document_id": 0, "source_text": r.get("source_text") or ""}
        targets = [("APPLIES_TO", r["entity"], r["entity_key"])] + [
            (ln["relation"], ln["to_entity"], ln["to_key"]) for ln in r.get("links") or []]
        for rel, name, key in targets:
            nid = entity_node(key)
            nodes.setdefault(nid, {"core_id": nid, "type": "entity", "label": name,
                                   "attributes": {"entity_key": key}, "document_id": 0, "source_text": ""})
            edges[(rule_node(r["rule_id"]), rel, nid)] = {
                "source_core_id": rule_node(r["rule_id"]), "relation": rel, "target_core_id": nid,
                "attributes": {"rule_id": r["rule_id"]}, "source_text": "", "confidence": r["confidence"]}
    return list(nodes.values()), list(edges.values())


def proj_state(ns: str, project: str) -> str:
    if not GRAPH_ENABLED:
        return "off"
    with sqldb.connect() as c:
        r = c.execute("SELECT state FROM kh_rule_proj WHERE ns=? AND project=?", [ns, project]).fetchone()
    return r["state"] if r else "ok"


def _set_proj(ns: str, project: str, state: str, error: str | None = None) -> None:
    with sqldb.connect() as c:
        sqldb.upsert(c, "kh_rule_proj", ["ns", "project"], {"ns": ns, "project": project, "state": state,
                                                            "error": (error or "")[:1000] or None,
                                                            "updated_ms": sqldb.now_ms(c)})


def project_rules(ns: str, project: str, rules: list[dict], replace: bool = False) -> str:
    """Write committed rules into the graph. Never raises: a failure marks the projection stale."""
    if not GRAPH_ENABLED:
        return "off"
    state = proj_state(ns, project)
    if state != "ok":
        return state                     # a stale projection is rebuilt whole by :reproject / the cron
    try:
        g = _graph(ns, project)
        nodes, edges = _graph_items(rules)
        with _lock_for(graph_id(ns, project)):
            if replace:
                g.delete_nodes([rule_node(r["rule_id"]) for r in rules])
            g.upsert_nodes_bulk(nodes)
            g.upsert_edges_bulk(edges)
        return "ok"
    except Exception as exc:  # noqa: BLE001 - any backend failure
        logger.warning("rules - projection of %s/%s failed, marked stale: %s", ns, project, exc)
        try:
            _set_proj(ns, project, "stale", repr(exc))
        except Exception:  # noqa: BLE001
            logger.exception("rules - could not mark the projection stale")
        return "stale"


def reproject(ns: str, project: str) -> dict:
    """Rebuild the (ns, project) projection from SQL: drop the graph, re-insert every rule.

    A write that commits while the rebuild runs could be lost from the graph; the rebuild compares the
    newest updated_ms before and after and leaves the projection stale (SQL path) if anything moved.
    """
    if not GRAPH_ENABLED:
        return {"project": project, "projection": "off", "rules": 0}
    from app.graph_db.project_graph import drop_project_graph
    gid = graph_id(ns, project)
    with sqldb.connect() as c:
        mark = c.execute("SELECT MAX(updated_ms) AS m, COUNT(*) AS n FROM kh_rule WHERE ns=? AND project=?",
                         [ns, project]).fetchone()
        ids = [r["rule_id"] for r in c.execute("SELECT rule_id FROM kh_rule WHERE ns=? AND project=? ORDER BY "
                                               "rule_id", [ns, project]).fetchall()]
    _set_proj(ns, project, "rebuilding")
    n = 0
    try:
        with _lock_for(gid):
            if _graph is _default_graph:
                drop_project_graph(gid)
            else:
                g0 = _graph(ns, project)
                g0.delete_nodes([rule_node(i) for i in ids])
            g = _graph(ns, project)
            for part in _chunks(ids, 1000):
                with sqldb.connect() as c:
                    rules = list(_load(c, ns, part).values())
                nodes, edges = _graph_items(rules)
                g.upsert_nodes_bulk(nodes)
                g.upsert_edges_bulk(edges)
                n += len(rules)
    except Exception as exc:  # noqa: BLE001
        logger.warning("rules - reproject of %s/%s failed: %s", ns, project, exc)
        _set_proj(ns, project, "stale", repr(exc))
        return {"project": project, "projection": "stale", "rules": n, "error": str(exc)[:300]}
    with sqldb.connect() as c:
        after = c.execute("SELECT MAX(updated_ms) AS m, COUNT(*) AS n FROM kh_rule WHERE ns=? AND project=?",
                          [ns, project]).fetchone()
    moved = (after["m"], after["n"]) != (mark["m"], mark["n"])
    _set_proj(ns, project, "stale" if moved else "ok", "rules changed during the rebuild" if moved else None)
    return {"project": project, "projection": "stale" if moved else "ok", "rules": n}


_default_graph = _graph


def _cron_reproject() -> str:
    """Rebuild every stale projection (runs under the _kh lease on one instance)."""
    if not GRAPH_ENABLED:
        return ""
    with sqldb.connect() as c:
        todo = [(r["ns"], r["project"]) for r in c.execute(
            "SELECT ns, project FROM kh_rule_proj WHERE state='stale' ORDER BY updated_ms LIMIT 20").fetchall()]
    done = [f"{ns}/{p}:{reproject(ns, p)['projection']}" for ns, p in todo]
    return ", ".join(done)


CRONS = [("rules_reproject", 300, _cron_reproject)]


# ── query: the graph path and the bounded SQL path ───────────────────────────

def _walk_graph(ns: str, project: str, seeds: list[str], relations: list[str], hops: int,
                min_conf: float) -> tuple[set[str], list[tuple]]:
    g = _graph(ns, project)
    nodes, edges = g.traverse_logic([entity_node(k) for k in seeds], relations=relations, max_hops=hops,
                                    direction="both", min_confidence=min_conf)
    rule_ids = {n["core_id"][len("rule__"):] for n in nodes if n["core_id"].startswith("rule__")}
    out_edges = []
    for e in edges:
        s, t = e["source_core_id"], e["target_core_id"]
        if s.startswith("rule__") and t.startswith("ent__"):
            out_edges.append((s[len("rule__"):], e["relation"], t[len("ent__"):].replace("-", " ")))
    return rule_ids, out_edges


def _walk_sql(c, ns: str, project: str, seeds: list[str], relations: list[str], hops: int,
              min_conf: float) -> tuple[set[str], list[tuple], bool]:
    """BFS over the bipartite entity/rule graph in SQL, bounded by ``hops`` (<= 3) and QUERY_RULES_MAX."""
    seen_ent = set(seeds)
    seen_rule: set[str] = set()
    front_ent, front_rule = set(seeds), set()
    edges: set[tuple] = set()
    truncated = False
    for _ in range(hops):
        if not front_ent and not front_rule:
            break
        new_rule, new_ent = set(), set()
        for part in _chunks(front_ent):
            ph = ",".join("?" for _ in part)
            if "APPLIES_TO" in relations:
                for r in c.execute(f"SELECT rule_id, entity_key FROM kh_rule WHERE ns=? AND project=? AND "
                                   f"confidence>=? AND entity_key IN ({ph})", [ns, project, min_conf, *part]):
                    edges.add((r["rule_id"], "APPLIES_TO", r["entity_key"]))
                    new_rule.add(r["rule_id"])
            links = [x for x in relations if x in LINK_RELATIONS]
            if links:
                for r in c.execute(f"SELECT l.rule_id, l.relation, l.to_key FROM kh_rule_link l JOIN kh_rule k ON "
                                   f"k.ns=l.ns AND k.rule_id=l.rule_id WHERE l.ns=? AND l.project=? AND "
                                   f"k.confidence>=? AND l.relation IN ({','.join('?' for _ in links)}) AND "
                                   f"l.to_key IN ({ph})", [ns, project, min_conf, *links, *part]):
                    edges.add((r["rule_id"], r["relation"], r["to_key"]))
                    new_rule.add(r["rule_id"])
        for part in _chunks(front_rule):
            ph = ",".join("?" for _ in part)
            if "APPLIES_TO" in relations:
                for r in c.execute(f"SELECT rule_id, entity_key FROM kh_rule WHERE ns=? AND confidence>=? AND "
                                   f"rule_id IN ({ph})", [ns, min_conf, *part]):
                    edges.add((r["rule_id"], "APPLIES_TO", r["entity_key"]))
                    new_ent.add(r["entity_key"])
            links = [x for x in relations if x in LINK_RELATIONS]
            if links:
                for r in c.execute(f"SELECT rule_id, relation, to_key FROM kh_rule_link WHERE ns=? AND relation IN "
                                   f"({','.join('?' for _ in links)}) AND rule_id IN ({ph})", [ns, *links, *part]):
                    edges.add((r["rule_id"], r["relation"], r["to_key"]))
                    new_ent.add(r["to_key"])
        front_rule = new_rule - seen_rule
        front_ent = new_ent - seen_ent
        seen_rule |= front_rule
        seen_ent |= front_ent
        if len(seen_rule) > QUERY_RULES_MAX:
            truncated = True
            break
    return seen_rule, sorted(edges), truncated


def _conflicts(rules: list[dict]) -> list[dict]:
    groups: dict[tuple, list[dict]] = {}
    for r in rules:
        if r["validity"] in DEAD:
            continue
        groups.setdefault((r["entity_key"], r["attribute_key"]), []).append(r)
    out = []
    for (ek, ak), rs in sorted(groups.items()):
        rs.sort(key=lambda r: r["rule_id"])
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                a, b = rs[i], rs[j]
                if squash(a["effect"]) == squash(b["effect"]):
                    continue
                kind = overlap(a["condition"], b["condition"])
                if kind is None:
                    continue
                out.append({"a": a["rule_id"], "b": b["rule_id"], "entity": a["entity"], "attribute": a["attribute"],
                            "overlap": kind, "validity": [a["validity"], b["validity"]]})
                if len(out) >= CONFLICTS_MAX:
                    return out
    return out


def query(ctx: Ctx, body: dict) -> dict:
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    project = ctx.require_project(body.get("project"))
    seeds_raw = body.get("start_entities")
    if not isinstance(seeds_raw, list) or not seeds_raw or len(seeds_raw) > QUERY_SEEDS_MAX \
            or not all(isinstance(s, str) and fold(s) for s in seeds_raw):
        raise CapError("invalid", f"start_entities: 1-{QUERY_SEEDS_MAX} entity names")
    seeds = sorted({fold(s) for s in seeds_raw})
    hops = body.get("hops", MAX_HOPS)
    if isinstance(hops, bool) or not isinstance(hops, int) or hops < 1:
        raise CapError("invalid", "hops must be an integer >= 1")
    hops = min(hops, MAX_HOPS)
    relations = body.get("relations") or list(RELATIONS)
    if not isinstance(relations, list) or not set(relations) <= set(RELATIONS):
        raise CapError("invalid", f"relations must be a subset of {list(RELATIONS)}")
    validity_in = body.get("validity_in") or [v for v in VALIDITY if v not in DEAD]
    if not isinstance(validity_in, list) or not set(validity_in) <= set(VALIDITY):
        raise CapError("invalid", f"validity_in must be a subset of {list(VALIDITY)}")
    min_conf = body.get("min_confidence", 0.0)
    if isinstance(min_conf, bool) or not isinstance(min_conf, (int, float)):
        raise CapError("invalid", "min_confidence must be a number")
    mode = body.get("path", "auto")
    if mode not in ("auto", "sql"):
        raise CapError("invalid", "path must be auto or sql")

    path, reason, truncated = "graph", None, False
    rule_ids: set[str] = set()
    edges: list[tuple] = []
    if mode == "sql":
        path, reason = "sql", "requested"
    elif not GRAPH_ENABLED:
        path, reason = "sql", "graph_disabled"
    else:
        state = proj_state(ctx.ns, project)
        if state != "ok":
            path, reason = "sql", f"projection_{state}"
        else:
            try:
                rule_ids, edges = _walk_graph(ctx.ns, project, seeds, relations, hops, float(min_conf))
            except Exception as exc:  # noqa: BLE001 - graph unavailable: SQL answers
                logger.warning("rules - graph query of %s/%s failed, using SQL: %s", ctx.ns, project, exc)
                path, reason = "sql", "graph_unavailable"
    with sqldb.connect() as c:
        if path == "sql":
            rule_ids, edges, truncated = _walk_sql(c, ctx.ns, project, seeds, relations, hops, float(min_conf))
        loaded = _load(c, ctx.ns, sorted(rule_ids))
    # SQL is the system of record: a graph node without a live SQL row (or of another project) is dropped.
    rules = [r for r in loaded.values() if r["project"] == project and r["validity"] in validity_in
             and r["confidence"] >= float(min_conf)]
    rules.sort(key=lambda r: (r["entity_key"], r["attribute_key"], r["rule_id"]))
    if len(rules) > QUERY_RULES_MAX:
        rules, truncated = rules[:QUERY_RULES_MAX], True
    keep = {r["rule_id"] for r in rules}
    by_entity: dict[str, list[str]] = {}
    for r in rules:
        by_entity.setdefault(r["entity_key"], []).append(r["rule_id"])
    edge_list = sorted({(a, rel, b) for a, rel, b in edges if a in keep})
    out = {"project": project, "path": path, "hops": hops, "start_entities": seeds, "rules": rules,
           "edges": [{"rule_id": a, "relation": rel, "entity_key": b} for a, rel, b in edge_list],
           "entities": [{"entity_key": k, "rule_ids": v} for k, v in sorted(by_entity.items())],
           "related": {s: sorted({a for a, _rel, b in edge_list if b == s}) for s in seeds},
           "conflicts": _conflicts(rules), "truncated": truncated}
    if reason:
        out["fallback_reason"] = reason
    return out


# ── scans and the gate ───────────────────────────────────────────────────────

def _covered(c, ns: str, project: str, keys: list[str], run_id: str | None = None) -> tuple[set, set]:
    """(entity keys with >= 1 live rule, entity keys with >= 1 verified rule); with run_id only rules that the
    run wrote or confirmed."""
    any_, ver = set(), set()
    dead = ",".join(f"'{d}'" for d in DEAD)
    for part in _chunks(keys):
        ph = ",".join("?" for _ in part)
        if run_id:
            sql = (f"SELECT k.entity_key, k.validity FROM kh_rule k JOIN kh_rule_run u ON u.ns=k.ns AND "
                   f"u.rule_id=k.rule_id WHERE k.ns=? AND k.project=? AND u.run_id=? AND k.validity NOT IN ({dead}) "
                   f"AND k.entity_key IN ({ph})")
            params = [ns, project, run_id, *part]
        else:
            sql = (f"SELECT entity_key, validity FROM kh_rule WHERE ns=? AND project=? AND validity NOT IN ({dead}) "
                   f"AND entity_key IN ({ph})")
            params = [ns, project, *part]
        for r in c.execute(sql, params).fetchall():
            any_.add(r[0])
            if r[1] == "verified":
                ver.add(r[0])
    return any_, ver


def _entity_list(raw, field: str) -> list[tuple[str, str]]:
    if not isinstance(raw, list) or len(raw) > SCAN_ENTITIES_MAX or not all(isinstance(e, str) and fold(e) for e in raw):
        raise CapError("invalid", f"{field}: a list of <= {SCAN_ENTITIES_MAX} entity names")
    out: dict[str, str] = {}
    for e in raw:
        out.setdefault(fold(e), e)
    return sorted(out.items())


def scan(ctx: Ctx, body: dict) -> tuple[int, dict]:
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    scan_id = body.get("scan_id")
    if not isinstance(scan_id, str) or not ID_RE.match(scan_id):
        raise CapError("invalid", "scan_id must be 1-128 of [A-Za-z0-9_.-]")
    project = ctx.require_project(body.get("project"))
    ents = _entity_list(body.get("entities_scanned"), "entities_scanned")
    run_id = body.get("run_id") or ctx.run_id
    sha = core.sha256_json({"project": project, "entities": [k for k, _ in ents]})
    with sqldb.connect() as c:
        old = c.execute("SELECT * FROM kh_rule_scan WHERE ns=? AND scan_id=?", [ctx.ns, scan_id]).fetchone()
        if old is not None:
            if old["request_sha"] != sha:
                raise CapError("duplicate", f"scan {scan_id} exists with another entity set")
            return 200, {**json.loads(old["result_json"]), "replayed": True}
        keys = [k for k, _ in ents]
        any_, ver = _covered(c, ctx.ns, project, keys)
        n = len(keys)
        res = {"scan_id": scan_id, "project": project, "run_id": run_id, "n_scanned": n, "n_any": len(any_),
               "n_verified": len(ver), "coverage_any": round(len(any_) / n, 6) if n else 0.0,
               "coverage_verified": round(len(ver) / n, 6) if n else 0.0,
               "uncovered": [name for k, name in ents if k not in any_][:1000],
               "unverified_only": [name for k, name in ents if k in any_ and k not in ver][:1000]}
        now = sqldb.now_ms(c)
        res["created_ms"] = now
        if not sqldb.insert_new(c, "kh_rule_scan", {
                "ns": ctx.ns, "scan_id": scan_id, "project": project, "run_id": run_id, "request_sha": sha,
                "n_scanned": n, "n_any": len(any_), "n_verified": len(ver), "coverage_any": res["coverage_any"],
                "coverage_verified": res["coverage_verified"], "result_json": core.jdump(res),
                "actor_json": core.jdump(ctx.actor()), "created_ms": now}):
            raise CapError("duplicate", f"scan {scan_id} was stored concurrently; read it back")
    return 201, res


def gate(ctx: Ctx, body: dict) -> dict:
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    run_id = body.get("run_id") or ctx.run_id
    if not isinstance(run_id, str) or not run_id or len(run_id) > 128:
        raise CapError("invalid", "run_id is required")
    project = ctx.require_project(body.get("project"))
    ents = _entity_list(body.get("entities") or [], "entities")
    dead = ",".join(f"'{d}'" for d in DEAD)
    with sqldb.connect() as c:
        covered, _ = _covered(c, ctx.ns, project, [k for k, _ in ents], run_id)
        run_rules = c.execute(
            f"SELECT k.rule_id, k.quote_id, k.source_text FROM kh_rule k JOIN kh_rule_run u ON u.ns=k.ns AND "
            f"u.rule_id=k.rule_id WHERE k.ns=? AND k.project=? AND u.run_id=? AND k.validity NOT IN ({dead}) "
            f"ORDER BY k.rule_id", [ctx.ns, project, run_id]).fetchall()
        orphans = [{"rule_id": r["rule_id"], "reason": "no_source"} for r in run_rules
                   if not (r["quote_id"] or (r["source_text"] or "").strip())]
        ids = [r["rule_id"] for r in run_rules]
        deps: list[tuple[str, str, str]] = []
        for part in _chunks(ids):
            deps += [(r["rule_id"], r["to_entity"], r["to_key"]) for r in c.execute(
                f"SELECT rule_id, to_entity, to_key FROM kh_rule_link WHERE ns=? AND relation='DEPENDS_ON' AND "
                f"rule_id IN ({','.join('?' for _ in part)})", [ctx.ns, *part]).fetchall()]
        live, _ = _covered(c, ctx.ns, project, sorted({d[2] for d in deps}))
        orphans += [{"rule_id": rid, "reason": "dangling_dependency", "to_entity": name}
                    for rid, name, key in deps if key not in live]
    missing = [name for k, name in ents if k not in covered]
    orphans.sort(key=lambda o: (o["rule_id"], o["reason"], o.get("to_entity") or ""))
    return {"pass": not missing and not orphans, "run_id": run_id, "project": project, "missing": missing,
            "orphans": orphans, "orphan_count": len(orphans), "n_entities": len(ents),
            "n_run_rules": len(run_rules)}


# ── list ─────────────────────────────────────────────────────────────────────

def list_rules(ctx: Ctx, project: str, entity: str, attribute: str, validity: str, run_id: str,
               limit: int) -> list[dict]:
    where, params = ["ns=?"], [ctx.ns]
    if project:
        where.append("project=?")
        params.append(ctx.require_project(project))
    elif ctx.caller.projects is not None:
        allowed = sorted(ctx.caller.projects)
        if not allowed:
            return []
        where.append(f"project IN ({','.join('?' for _ in allowed)})")
        params += allowed
    for col, v in (("entity_key", fold(entity) if entity else ""), ("attribute_key", fold(attribute) if attribute
                                                                     else ""), ("run_id", run_id)):
        if v:
            where.append(f"{col}=?")
            params.append(v)
    if validity:
        vs = [v for v in validity.split(",") if v]
        if not set(vs) <= set(VALIDITY):
            raise CapError("invalid", f"validity must be among {list(VALIDITY)}")
        where.append(f"validity IN ({','.join('?' for _ in vs)})")
        params += vs
    with sqldb.connect() as c:
        ids = [r["rule_id"] for r in c.execute(f"SELECT rule_id FROM kh_rule WHERE {' AND '.join(where)} "
                                               f"ORDER BY rule_id LIMIT ?", params + [int(limit)]).fetchall()]
        got = _load(c, ctx.ns, ids)
    return [got[i] for i in ids if i in got]


# ── routes ───────────────────────────────────────────────────────────────────

def _scrub(ctx: Ctx, where: str, body):
    """Mask secrets / PII before storage (F5 write-path hook), outside any transaction."""
    from app.caps import redact
    return redact.scrub(ctx, where, body)


async def _json(request: Request):
    raw = await request.body()
    try:
        return json.loads(raw or b"{}")
    except ValueError:
        raise CapError("invalid", "body must be JSON")


def attach(app) -> None:
    TAG = ["v1 rules"]

    def can_read(ctx: Ctx) -> None:
        ctx.require("rules", "read", type_row=_acl_row(ctx), op="read")

    def can_write(ctx: Ctx) -> None:
        ctx.require("rules", "write", type_row=_acl_row(ctx), op="write")

    # The literal paths are registered before /rules/{rule_id} so that 'scans' never reads as an id.
    @app.post("/v1/{ns}/rules:bulk", tags=TAG, summary="Bootstrap up to 5,000 rules (unverified, deduped by hash)")
    @core.idempotent
    async def rules_bulk(request: Request, ns: str, partial: bool = False, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        doc = await asyncio.to_thread(_scrub, ctx, "rules:bulk", await _json(request))
        status, out = await asyncio.to_thread(bulk, ctx, doc, partial)
        return core.reply(status, out)

    @app.post("/v1/{ns}/rules:query", tags=TAG, summary="Rules related to entities, <= 3 hops, with conflict pairs")
    async def rules_query(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(query, ctx, await _json(request))

    @app.post("/v1/{ns}/rules:gate", tags=TAG, summary="Completion gate: every entity has a rule of this run")
    async def rules_gate(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        return await asyncio.to_thread(gate, ctx, await _json(request))

    @app.post("/v1/{ns}/rules:reproject", tags=TAG, summary="Rebuild the graph projection from SQL")
    @core.idempotent
    async def rules_reproject(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        if not ctx.is_admin and ctx.role != "orchestrator":
            raise CapError("forbidden", "reproject is for the namespace admin or an orchestrator")
        doc = await _json(request)
        project = ctx.require_project(doc.get("project") if isinstance(doc, dict) else None)
        return await asyncio.to_thread(reproject, ns, project)

    @app.post("/v1/{ns}/rules/scans", tags=TAG, summary="Store a scan and its rule coverage")
    @core.idempotent
    async def rules_scan(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        doc = await asyncio.to_thread(_scrub, ctx, "rules/scans", await _json(request))
        status, out = await asyncio.to_thread(scan, ctx, doc)
        return core.reply(status, out)

    @app.get("/v1/{ns}/rules/scans", tags=TAG, summary="Recent scans of a project")
    async def rules_scans(ns: str, project: str = "", limit: int = 50, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        project = ctx.require_project(project)

        def run():
            with sqldb.connect() as c:
                return [json.loads(r["result_json"]) for r in c.execute(
                    "SELECT result_json FROM kh_rule_scan WHERE ns=? AND project=? ORDER BY created_ms DESC, scan_id "
                    "LIMIT ?", [ns, project, max(1, min(limit, 500))]).fetchall()]
        return {"scans": await asyncio.to_thread(run)}

    @app.get("/v1/{ns}/rules/scans/{scan_id}", tags=TAG, summary="One scan")
    async def rules_scan_get(ns: str, scan_id: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)

        def run():
            with sqldb.connect() as c:
                return c.execute("SELECT project, result_json FROM kh_rule_scan WHERE ns=? AND scan_id=?",
                                 [ns, scan_id]).fetchone()
        r = await asyncio.to_thread(run)
        if r is None:
            raise CapError("not_found", f"no scan {scan_id}")
        ctx.require_project(r["project"])
        return json.loads(r["result_json"])

    @app.get("/v1/{ns}/rules", tags=TAG, summary="List rules by project / entity / attribute / validity / run")
    async def rules_list(ns: str, project: str = "", entity: str = "", attribute: str = "", validity: str = "",
                         run_id: str = "", limit: int = 100, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)
        rows = await asyncio.to_thread(list_rules, ctx, project, entity, attribute, validity, run_id,
                                       max(1, min(limit, 1000)))
        return {"rules": rows}

    @app.post("/v1/{ns}/rules/{rule_id}:confirm", tags=TAG, summary="Set validity verified|contradicted (confirm policy)")
    @core.idempotent
    async def rules_confirm(request: Request, ns: str, rule_id: str, ctx: Ctx = Depends(ns_ctx)):
        out, rev = await asyncio.to_thread(confirm, ctx, rule_id, await _json(request))
        return core.reply(200, out, {"ETag": core.etag(rev)})

    @app.put("/v1/{ns}/rules/{rule_id}", tags=TAG, summary="Create (If-None-Match: *) or update (If-Match) a rule")
    @core.idempotent
    async def rules_put(request: Request, ns: str, rule_id: str, ctx: Ctx = Depends(ns_ctx)):
        can_write(ctx)
        body = await _json(request)
        if not isinstance(body, dict):
            raise CapError("invalid", "body must be an object")
        body = await asyncio.to_thread(_scrub, ctx, "rules", body)
        status, out, rev = await asyncio.to_thread(put_rule, ctx, rule_id, body)
        return core.reply(status, out, {"ETag": core.etag(rev)})

    @app.get("/v1/{ns}/rules/{rule_id}", tags=TAG, summary="One rule with its links")
    async def rules_get(ns: str, rule_id: str, ctx: Ctx = Depends(ns_ctx)):
        can_read(ctx)

        def run():
            with sqldb.connect() as c:
                return get_one(c, ns, rule_id)
        r = await asyncio.to_thread(run)
        if r is None:
            raise CapError("not_found", f"no rule {rule_id}")
        ctx.require_project(r["project"])
        return core.reply(200, r, {"ETag": core.etag(r["rev"])})
