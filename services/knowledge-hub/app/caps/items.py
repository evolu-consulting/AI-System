"""Knowledge-item lifecycle for namespaces (docs/multi-agent-instance-design.md 4.8, slice F7).

  POST  /v1/{ns}/items                     propose an item (distil schema, leak gate, duplicates, contradictions)
  GET   /v1/{ns}/items?keyspace=&key=&status=&kind=&project=&scope=&limit=&offset=
  GET   /v1/{ns}/items:patterns            counts per keyspace, key, kind and status (computed in code)
  POST  /v1/{ns}/items:lint                {text, guard_names?} -> {ok, errors} (dry run, stores nothing)
  POST  /v1/{ns}/items:reindex             {project?, all?} rebuild the vector rows from SQL (admin, orchestrator)
  POST  /v1/{ns}/items:expire              run the TTL sweep for this namespace now (admin, orchestrator)
  GET   /v1/{ns}/items/{id}
  PATCH /v1/{ns}/items/{id}                {status, reason?, superseded_by?}  with If-Match (confirm_policy)
  POST  /v1/{ns}/items/{id}:support        {project, run_id?, event_ids?}  independent support from a project/run

SYSTEM OF RECORD. ``kh_item`` in app/sqldb.py (D5). The vector row in collection ``ns_<ns>_knowledge`` is a search
index written after commit; ``vec_rev`` records which revision it reflects, so ``:reindex`` and the
``items_reindex`` cron rebuild exactly the stale rows from SQL. Legacy people's items (app/distill.py) stay in
the vector store unchanged; the two never mix.

AN ITEM has a ``kind`` (a manifest type with ``kind_of: item``: its JSON Schema validates ``attrs``, its
``write_roles`` narrow who may propose, ``fenced`` / ``require_if_match`` apply, its ``confirm_policy`` decides
who confirms), a ``keyspace`` from the manifest and a ``key`` with one value per dimension (a missing dimension
is ``*`` = any), a ``project``, ``text`` (+ optional ``title``), provenance ``{runs[], event_ids[]}``,
``guard_names``, ``guard_metric`` / ``metric_dir`` (for the F8 rollback) and a TTL.

STATUS. proposed -> active | contested | superseded | withdrawn; active -> contested | superseded | withdrawn |
active (re-confirm: refreshes last_confirmed and the TTL); contested -> active | proposed | superseded |
withdrawn; superseded / withdrawn -> proposed (reopen). The consumer's ``unproven`` is an alias of ``proposed``
(accepted on input and in filters). Every change is a conditional UPDATE on (rev, status).

WHO. Propose: role ``items:propose`` (distiller, admin) and the type ACL. Confirm (-> active) and reopen: the
type's ``confirm_policy`` ``{roles:[...], emails:[...], quorum:1, auto_after_evidence:k?}``; without roles or
emails, a role holding ``items:confirm``. Withdraw: the policy or ``items:withdraw``. Contest: the policy or
any of ``items:write|confirm|withdraw``. Supersede: the policy or ``items:write``. People listed in ``emails``
are resolved as role ``confirmer`` on the namespace (a human confirmer signs in normally). KH adds no gate.

RULES (manifest ``settings.items`` with per-keyspace ``config`` overrides):
  * TTL: ``ttl_days`` (default 90). Confirming sets ``expires_ms = now + ttl``; the ``items_expire`` cron moves an
    active item past it to withdrawn with reason ``expired``. Retrieval never serves an expired item.
  * STAGED SCOPE: an item starts at ``scope=project``; ``cross_after_projects`` (default 3) distinct projects of
    independent support promote it to ``cross`` and write ``kh.item_promoted``. A project counts when at least one
    of its supporting runs is not also cited by another project (a run id seen in two projects is one source).
  * LINT before active (``settings.items.lint`` may add ``verbs`` / ``hedges`` and set ``max_chars``): text <=
    400 chars, the first word an imperative verb or Never / Always, no hedges, every guard name present in the
    guard registry (``guard_type``: a record type; ``guard_field``: an index field, default the record id).
    422 ``lint_failed`` with the list.
  * DUPLICATES: the same key, kind and normalized text (and, with an embedder, cosine >= DISTILL_SAME within the
    key) is the same item: the proposal adds support instead. ``updates: <id>`` rewrites a live item;
    ``contradicts: <id>`` stores the new item as contested and contests the target.
  * LEAK GATE: every write body passes ``redact.scrub`` first (outside any transaction), then the text passes
    app/distill.py's leak gate (422 ``leak_refused``).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import secrets
import threading
from typing import Any, Callable

from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core, registry
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "items"
VERSION = "1.0.0"
STATUS = "beta"
TEXT_MAX = 4000
LINT_MAX_CHARS = 400
TTL_DAYS = 90
CROSS_AFTER = 3
LIST_MAX = 500
PROV_MAX = 500
GUARDS_MAX = 20
SAME_POOL_MAX = 50
LIMITS = {"text_chars": TEXT_MAX, "lint_chars": LINT_MAX_CHARS, "ttl_days_default": TTL_DAYS,
          "cross_after_projects_default": CROSS_AFTER, "list_limit": LIST_MAX}

STATUSES = ("proposed", "active", "contested", "superseded", "withdrawn")
ALIASES = {"unproven": "proposed"}
LIVE = ("proposed", "active", "contested")
SCOPES = ("project", "cross")
TRANSITIONS = {
    "proposed": {"active", "contested", "superseded", "withdrawn"},
    "active": {"active", "contested", "superseded", "withdrawn"},
    "contested": {"active", "proposed", "superseded", "withdrawn"},
    "superseded": {"proposed"},
    "withdrawn": {"proposed"},
}
ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,128}$")
FIELDS = {"kind", "keyspace", "key", "project", "title", "text", "attrs", "guard_names", "guard_metric", "metric_dir",
          "provenance", "updates", "contradicts", "ttl_days", "bound", "triggers"}
#: D20 revised (2026-10-11): ``generic`` items (tool, OS, stack) may go cross-project; ``project`` items
#: (business, systems, people) never leave their project. A row from before the column existed is ``project``.
#: ``people``: a project item about a person's actions; like ``project`` it never leaves, and its TTL is capped at
#: PEOPLE_TTL_DAYS however it is set, so nobody keeps a label after the behaviour stops (design 4.8).
BOUNDS = ("project", "generic", "people")
PEOPLE_TTL_DAYS = 90
TRIGGERS_MAX = 8
TRIGGER_RE = re.compile(r"^[a-z0-9][a-z0-9_.:\-]{0,63}$")
WILD = "*"

#: Imperative verbs a lint-clean item may start with (plus Never / Always); settings.items.lint.verbs adds more.
VERBS = frozenset("""
accept add adjust align allow annotate apply archive ask assert assign attach audit avoid back batch block
bound break bump cache call cancel cap capture check choose cite clean clear clone close collect combine commit
compare compile compress confirm configure consider construct convert copy count create cut debug declare
decouple default defer define delete deploy describe detach detect disable discard document double drain drop
dump edit emit enable encode encrypt end enforce ensure escape estimate evaluate exclude execute expect expire
explain export expose extract fail fall fetch file fill filter finish fix flag flush fold follow force format
freeze gate generate get give grant group guard handle hash hide hold ignore implement import include increase
index inject inspect install invalidate isolate join keep label launch limit link lint list load lock log look
make map mark mask match measure merge migrate minimize mirror mock monitor move name narrow normalize note
notify open order override page parse partition pass patch pause pick pin plan poll prefer prefix prepare
preserve prevent print prioritize probe profile promote prompt protect prove prune publish pull purge push put
query queue raise rate read rebase rebuild recheck record recover redact reduce refactor refresh register
reject release reload remove rename render reorder repeat replace replay report request require rerun reserve
reset resolve restart restore restrict resume retain retry return reuse review revert revoke rollback rotate
round route run sample sanitize save scale scan schedule scope search seed select send separate serialize set
shard ship shorten show shut sign simplify skip sleep slow snapshot sort split squash stage start state stop
store stream strip stub submit subscribe summarize supersede supply suspend swap switch sync tag take tell test
throttle time trace track translate treat trim trigger truncate trust try tune turn type unblock unlock unpin
unset update upgrade upload use validate verify version wait warn watch wrap write yield
""".split())
HEDGES = ("maybe", "might", "probably", "perhaps", "possibly", "i think", "it seems", "seems to", "sort of",
          "kind of", "i guess")

_DDL = {
    "kh_item": ("""CREATE TABLE IF NOT EXISTS kh_item (
                     ns TEXT NOT NULL, item_id TEXT NOT NULL, kind TEXT NOT NULL, keyspace TEXT NOT NULL,
                     key_json TEXT NOT NULL, key_sha TEXT NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL,
                     status TEXT NOT NULL, status_reason TEXT, title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
                     text_sha TEXT NOT NULL, attrs_json TEXT NOT NULL, provenance_json TEXT NOT NULL,
                     evidence_count INTEGER NOT NULL DEFAULT 0, support_projects_json TEXT NOT NULL,
                     guard_names_json TEXT NOT NULL, guard_metric TEXT, metric_dir TEXT, ttl_days INTEGER,
                     expires_ms INTEGER, activated_ms INTEGER, last_confirmed_ms INTEGER, superseded_by TEXT,
                     actor_json TEXT NOT NULL, rev INTEGER NOT NULL, vec_rev INTEGER,
                     created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, PRIMARY KEY (ns, item_id))""",
                """CREATE COLUMN TABLE kh_item (
                     ns NVARCHAR(32) NOT NULL, item_id NVARCHAR(128) NOT NULL, kind NVARCHAR(128) NOT NULL,
                     keyspace NVARCHAR(128) NOT NULL, key_json NCLOB NOT NULL, key_sha NVARCHAR(64) NOT NULL,
                     project NVARCHAR(256) NOT NULL, scope NVARCHAR(16) NOT NULL, status NVARCHAR(16) NOT NULL,
                     status_reason NVARCHAR(1000), title NVARCHAR(512) NOT NULL, text NCLOB NOT NULL,
                     text_sha NVARCHAR(64) NOT NULL, attrs_json NCLOB NOT NULL, provenance_json NCLOB NOT NULL,
                     evidence_count BIGINT NOT NULL, support_projects_json NCLOB NOT NULL,
                     guard_names_json NCLOB NOT NULL, guard_metric NVARCHAR(256), metric_dir NVARCHAR(8),
                     ttl_days BIGINT, expires_ms BIGINT, activated_ms BIGINT, last_confirmed_ms BIGINT,
                     superseded_by NVARCHAR(128), actor_json NCLOB NOT NULL, rev BIGINT NOT NULL, vec_rev BIGINT,
                     created_ms BIGINT NOT NULL, updated_ms BIGINT NOT NULL, PRIMARY KEY (ns, item_id))"""),
    "kh_item_support": ("""CREATE TABLE IF NOT EXISTS kh_item_support (
                             ns TEXT NOT NULL, item_id TEXT NOT NULL, project TEXT NOT NULL, run_id TEXT NOT NULL,
                             obo TEXT, principal TEXT NOT NULL, at_ms INTEGER NOT NULL,
                             PRIMARY KEY (ns, item_id, project, run_id))""",
                        """CREATE COLUMN TABLE kh_item_support (
                             ns NVARCHAR(32) NOT NULL, item_id NVARCHAR(128) NOT NULL, project NVARCHAR(256) NOT NULL,
                             run_id NVARCHAR(128) NOT NULL, obo NVARCHAR(256), principal NVARCHAR(256) NOT NULL,
                             at_ms BIGINT NOT NULL, PRIMARY KEY (ns, item_id, project, run_id))"""),
    "kh_item_confirm": ("""CREATE TABLE IF NOT EXISTS kh_item_confirm (
                             ns TEXT NOT NULL, item_id TEXT NOT NULL, principal TEXT NOT NULL, at_ms INTEGER NOT NULL,
                             PRIMARY KEY (ns, item_id, principal))""",
                        """CREATE COLUMN TABLE kh_item_confirm (
                             ns NVARCHAR(32) NOT NULL, item_id NVARCHAR(128) NOT NULL, principal NVARCHAR(256) NOT NULL,
                             at_ms BIGINT NOT NULL, PRIMARY KEY (ns, item_id, principal))"""),
}
TABLES = list(_DDL)


def _m1(c) -> None:
    for name, (lite, hana) in _DDL.items():
        sqldb.create_table(c, name, lite, hana)
    sqldb.create_index(c, "ix_kh_item_key", "kh_item", "ns, key_sha, status")
    sqldb.create_index(c, "ix_kh_item_text", "kh_item", "ns, key_sha, text_sha")
    sqldb.create_index(c, "ix_kh_item_exp", "kh_item", "ns, status, expires_ms")
    sqldb.create_index(c, "ix_kh_item_proj", "kh_item", "ns, project, status")


def _m2(c) -> None:
    """D20 revised: the item's bound (generic | project; NULL reads as project) and its triggers."""
    sqldb.add_column(c, "kh_item", "bound", "TEXT", "NVARCHAR(16)")
    sqldb.add_column(c, "kh_item", "triggers_json", "TEXT", "NVARCHAR(1000)")


def init(c) -> None:
    sqldb.migrate(c, NAME, [(1, _m1), (2, _m2)])


# ── manifest configuration ───────────────────────────────────────────────────

def settings(ns_row: dict) -> dict:
    s = ((ns_row.get("config") or {}).get("settings") or {}).get("items") or {}
    return s if isinstance(s, dict) else {}


_ks_cache: dict[tuple, dict] = {}


def keyspaces(ns_row: dict) -> dict[str, dict]:
    """{keyspace: {dims, config}} of the namespace (cached per manifest revision)."""
    key = (sqldb.location(), ns_row["ns"], ns_row.get("manifest_rev"))
    got = _ks_cache.get(key)
    if got is None:
        with sqldb.connect() as c:
            got = {r["keyspace"]: {"dims": json.loads(r["dims_json"]), "config": json.loads(r["config_json"] or "{}")}
                   for r in c.execute("SELECT keyspace, dims_json, config_json FROM kh_keyspace WHERE ns=?",
                                      [ns_row["ns"]]).fetchall()}
        if len(_ks_cache) > 1000:
            _ks_cache.clear()
        _ks_cache[key] = got
    return got


def _setting(ns_row: dict, ks_conf: dict, name: str, default: int) -> int:
    for src in (ks_conf or {}, settings(ns_row)):
        v = src.get(name)
        if isinstance(v, int) and not isinstance(v, bool) and v >= 1:
            return v
    return default


def key_sha(keyspace: str, values: list[str]) -> str:
    return hashlib.sha256(core.jdump([keyspace, values]).encode("utf-8")).hexdigest()[:40]


def parse_key(ns_row: dict, keyspace: Any, key: Any) -> dict:
    """Normalize a key of a manifest keyspace. ``key``: {dim: value} or 'dim=value;dim=value' (or JSON text).
    A missing dimension is '*' (any). Returns {keyspace, dims, values, key, key_sha, wild_sha, config}."""
    ks = keyspaces(ns_row)
    if not isinstance(keyspace, str) or keyspace not in ks:
        raise CapError("invalid", f"keyspace must be one of the manifest keyspaces {sorted(ks)}")
    dims = ks[keyspace]["dims"]
    if isinstance(key, str):
        raw = key.strip()
        if raw.startswith("{"):
            try:
                key = json.loads(raw)
            except ValueError:
                raise CapError("invalid", "key is not valid JSON")
        else:
            pairs = [p for p in re.split(r"[;,]", raw) if p.strip()]
            if any("=" not in p for p in pairs):
                raise CapError("invalid", "key must be {dim: value} or 'dim=value;dim=value'")
            key = {p.split("=", 1)[0].strip(): p.split("=", 1)[1].strip() for p in pairs}
    if key is None:
        key = {}
    if not isinstance(key, dict):
        raise CapError("invalid", "key must be an object of dimension values")
    unknown = sorted(set(key) - set(dims))
    if unknown:
        raise CapError("invalid", f"unknown key dimensions {unknown}; keyspace {keyspace} has {dims}")
    values = []
    for d in dims:
        v = key.get(d, WILD)
        if isinstance(v, bool) or not isinstance(v, (str, int, float)):
            raise CapError("invalid", f"key value of {d} must be a string")
        v = str(v).strip()
        if not v or len(v) > 128 or any(ord(ch) < 32 for ch in v):
            raise CapError("invalid", f"key value of {d} must be 1-128 printable characters")
        values.append(v)
    wild = values[:-1] + [WILD]
    return {"keyspace": keyspace, "dims": dims, "values": values, "key": dict(zip(dims, values)),
            "key_sha": key_sha(keyspace, values),
            "wild_sha": key_sha(keyspace, wild) if values[-1] != WILD else None,
            "config": ks[keyspace]["config"]}


def confirm_policy(ns_row: dict, type_row: dict | None) -> dict:
    cp = (type_row or {}).get("confirm_policy") or settings(ns_row).get("confirm_policy") or {}
    return cp if isinstance(cp, dict) else {}


def can_confirm(ctx: Ctx, policy: dict) -> bool:
    if ctx.is_admin:
        return True
    roles = policy.get("roles") or []
    emails = [str(e).lower() for e in policy.get("emails") or []]
    if roles or emails:
        return ctx.role in roles or (ctx.caller.principal or "").lower() in emails
    return core.role_allows(ctx.role, "items", "confirm")


def _confirmer_resolver(request: Request, ns_row: dict):
    """core.CALLER_RESOLVERS entry: a signed-in person listed by e-mail in an item confirm_policy is a confirmer
    of the namespace (design 3.4: a human confirmer uses a normal login). Owners and maintainers fall through."""
    from app import auth
    p = auth.current()
    if p is None or getattr(p, "ns", None) or p.is_maintainer \
            or p.email == (ns_row.get("owner_email") or "").lower():
        return None
    emails = {str(e).lower() for e in (settings(ns_row).get("confirm_policy") or {}).get("emails") or []}
    for t in (ns_row.get("types") or {}).values():
        if t["kind_of"] == "item":
            emails |= {str(e).lower() for e in (t.get("confirm_policy") or {}).get("emails") or []}
    if p.email.lower() not in emails:
        return None
    projects = {x for x in ns_row.get("projects") or [] if p.can(x, "project.read")}
    return core.Caller(principal=p.email, role="confirmer", kind="person", on_behalf_of=p.email, projects=projects)


# ── lint ─────────────────────────────────────────────────────────────────────

def _guards_missing(c, ns_row: dict, names: list[str]) -> list[str]:
    """Lint errors for guard names absent from the guard registry record type."""
    if not names:
        return []
    s = settings(ns_row)
    gtype = s.get("guard_type")
    if not gtype:
        return ["guard_names given but the manifest sets no settings.items.guard_type"]
    t = (ns_row.get("types") or {}).get(gtype)
    if t is None or t["kind_of"] != "record":
        return [f"guard registry type {gtype} is not a record type of this namespace"]
    col = "id"
    if s.get("guard_field"):
        col = (t.get("index_fields") or {}).get(s["guard_field"])
        if not col:
            return [f"guard_field {s['guard_field']} is not an index field of {gtype}"]
    try:
        rows = c.execute(f"SELECT {col} AS g FROM kh_record WHERE ns=? AND type=? AND state<>'retired' AND "
                         f"{col} IN ({','.join('?' for _ in names)})", [ns_row["ns"], gtype, *names]).fetchall()
    except Exception:  # noqa: BLE001 - records capability not installed
        return ["the guard registry (records capability) is not available"]
    found = {r["g"] for r in rows}
    return [f"guard {n} is not in the guard registry {gtype}" for n in names if n not in found]


def lint(c, ns_row: dict, text: str, guard_names: list[str]) -> list[str]:
    """Lint errors of an item text (design 4.8). Empty = clean."""
    conf = settings(ns_row).get("lint") or {}
    max_chars = conf.get("max_chars") if isinstance(conf.get("max_chars"), int) else LINT_MAX_CHARS
    verbs = VERBS | {str(v).lower() for v in conf.get("verbs") or []}
    hedges = HEDGES + tuple(str(h).lower() for h in conf.get("hedges") or [])
    errors = []
    text = (text or "").strip()
    if len(text) > max_chars:
        errors.append(f"text is {len(text)} characters; at most {max_chars}")
    m = re.match(r"[A-Za-z']+", text)
    first = m.group(0).lower() if m else ""
    if first not in verbs and first not in ("never", "always"):
        errors.append(f"the first word '{first or text[:20]}' is not an imperative verb, Never or Always")
    low = " ".join(text.lower().split())
    for h in hedges:
        if re.search(r"(?<![a-z])" + re.escape(h) + r"(?![a-z])", low):
            errors.append(f"hedge '{h}' is not allowed")
    errors += _guards_missing(c, ns_row, guard_names)
    return errors


# ── helpers ──────────────────────────────────────────────────────────────────

def _decode(r) -> dict:
    return {"id": r["item_id"], "kind": r["kind"], "keyspace": r["keyspace"], "key": json.loads(r["key_json"]),
            "key_sha": r["key_sha"], "project": r["project"], "scope": r["scope"], "status": r["status"],
            "status_reason": r["status_reason"], "title": r["title"], "text": r["text"],
            "attrs": json.loads(r["attrs_json"] or "{}"), "provenance": json.loads(r["provenance_json"] or "{}"),
            "evidence_count": int(r["evidence_count"] or 0),
            "support_projects": json.loads(r["support_projects_json"] or "[]"),
            "guard_names": json.loads(r["guard_names_json"] or "[]"), "guard_metric": r["guard_metric"],
            "metric_dir": r["metric_dir"], "ttl_days": r["ttl_days"], "expires_ms": r["expires_ms"],
            "activated_ms": r["activated_ms"], "last_confirmed_ms": r["last_confirmed_ms"],
            "superseded_by": r["superseded_by"], "actor": json.loads(r["actor_json"] or "{}"), "rev": int(r["rev"]),
            "created_ms": int(r["created_ms"]), "updated_ms": int(r["updated_ms"]),
            "bound": _col(r, "bound") or "project", "triggers": json.loads(_col(r, "triggers_json") or "[]")}


def _col(r, name: str):
    """A column added by a later migration (None on a row object that predates it)."""
    try:
        return r[name]
    except (IndexError, KeyError):
        return None


def triggered(item: dict, situation: str | None) -> bool:
    """An item without triggers is served on any step; one with triggers only when the step names one of them."""
    trig = item.get("triggers") or []
    return not trig or (situation is not None and situation in trig)


def _triggers(v: Any, errors: list) -> list[str] | None:
    if v is None:
        return None
    if not isinstance(v, list) or len(v) > TRIGGERS_MAX or \
            not all(isinstance(x, str) and TRIGGER_RE.match(x) for x in v):
        errors.append({"pointer": "/triggers", "message": f"triggers must be a list of at most {TRIGGERS_MAX} "
                                                          "situation names ([a-z0-9_.:-], e.g. crash, tool_call:shell)"})
        return None
    return list(dict.fromkeys(v))


def _load(c, ns: str, item_id: str):
    return c.execute("SELECT * FROM kh_item WHERE ns=? AND item_id=?", [ns, item_id]).fetchone()


def visible(ctx: Ctx, item: dict) -> bool:
    """A project-scoped item outside the caller's grant is invisible (404, never 403). Cross items are shared."""
    return item["scope"] == "cross" or ctx.caller.projects is None or item["project"] in ctx.caller.projects


def _key_json(key: dict) -> str:
    """The key in the keyspace's dimension order (core.jdump would sort it)."""
    return json.dumps(key, ensure_ascii=False, separators=(",", ":"))


def _norm_text(text: str) -> str:
    return " ".join((text or "").lower().split())


def _text_sha(text: str) -> str:
    return hashlib.sha256(_norm_text(text).encode("utf-8")).hexdigest()


def _status(v: Any) -> str:
    v = ALIASES.get(str(v or "").strip().lower(), str(v or "").strip().lower())
    if v not in STATUSES:
        raise CapError("invalid", f"status must be one of {list(STATUSES) + list(ALIASES)}")
    return v


def _str_list(v: Any, name: str, limit: int, errors: list) -> list[str]:
    if v is None:
        return []
    if not isinstance(v, list) or not all(isinstance(x, str) and 0 < len(x) <= 256 for x in v) or len(v) > limit:
        errors.append({"pointer": f"/{name}", "message": f"{name} must be a list of at most {limit} strings"})
        return []
    return list(dict.fromkeys(v))


def _scrub(ctx: Ctx, where: str, body):
    """REDACTION WRITE-PATH HOOK (design 4.11): call OUTSIDE any transaction (scrub writes kh.* events)."""
    try:
        from app.caps import redact
    except ImportError:
        return body
    return redact.scrub(ctx, where, body)


def _leak(text: str) -> str | None:
    """app/distill.py's leak gate (e-mail and secret patterns, plus the kh-default redaction pack)."""
    from app import distill
    return distill._leak(text, frozenset(), strict=False)


def _merge_prov(old: dict, runs: list[str], event_ids: list[str]) -> dict:
    return {"runs": list(dict.fromkeys((old.get("runs") or []) + runs))[-PROV_MAX:],
            "event_ids": list(dict.fromkeys((old.get("event_ids") or []) + event_ids))[-PROV_MAX:]}


def independent_projects(rows: list[tuple[str, str]]) -> list[str]:
    """Projects with independent support: at least one supporting run not cited by another project
    ('' = an unnamed run, always its own)."""
    by_proj: dict[str, set[str]] = {}
    for project, run in rows:
        by_proj.setdefault(project, set()).add(run or "")
    out = []
    for p, runs in by_proj.items():
        others = set().union(*(r for q, r in by_proj.items() if q != p)) if len(by_proj) > 1 else set()
        if any(r == "" or r not in others for r in runs):
            out.append(p)
    return sorted(out)


def _add_support(c, ctx: Ctx, item_id: str, project: str, run_id: str | None, runs: list[str],
                 event_ids: list[str], now: int) -> tuple[bool, dict]:
    """One support row (first insert per (project, run) wins) plus merged provenance and counters.
    Returns (new support, the item after the write)."""
    new = sqldb.insert_new(c, "kh_item_support", {"ns": ctx.ns, "item_id": item_id, "project": project,
                                                  "run_id": run_id or "", "obo": ctx.caller.on_behalf_of,
                                                  "principal": ctx.caller.principal, "at_ms": now})
    for _ in range(5):
        r = _load(c, ctx.ns, item_id)
        if r is None:
            raise CapError("not_found", f"no item {item_id}")
        cur = _decode(r)
        rows = [(x["project"], x["run_id"]) for x in c.execute(
            "SELECT project, run_id FROM kh_item_support WHERE ns=? AND item_id=?", [ctx.ns, item_id]).fetchall()]
        prov = _merge_prov(cur["provenance"], runs + ([run_id] if run_id else []), event_ids)
        sets = {"provenance_json": core.jdump(prov), "evidence_count": len(rows),
                "support_projects_json": core.jdump(sorted({p for p, _ in rows})), "updated_ms": now}
        if sqldb.update(c, "UPDATE kh_item SET " + ", ".join(f"{k}=?" for k in sets) + ", rev=rev+1 "
                           "WHERE ns=? AND item_id=? AND rev=?", [*sets.values(), ctx.ns, item_id, cur["rev"]]):
            return new, _decode(_load(c, ctx.ns, item_id))
    raise CapError("write_conflict", f"item {item_id} kept changing; retry")


def _ttl_ms(ctx_ns_row: dict, item: dict) -> int:
    ks = keyspaces(ctx_ns_row).get(item["keyspace"]) or {}
    days = item.get("ttl_days") or _setting(ctx_ns_row, ks.get("config") or {}, "ttl_days", TTL_DAYS)
    if item.get("bound") == "people":
        days = min(int(days), PEOPLE_TTL_DAYS)
    return int(days) * 86400000


def _after_support(c, ctx: Ctx, t: dict | None, item: dict, now: int) -> dict:
    """Staged scope promotion and auto_after_evidence activation, inside the write transaction.
    Returns {promoted: {...}?, auto_active: bool}."""
    out: dict = {}
    ks = keyspaces(ctx.ns_row).get(item["keyspace"]) or {}
    need = _setting(ctx.ns_row, ks.get("config") or {}, "cross_after_projects", CROSS_AFTER)
    if item["scope"] == "project" and item.get("bound") == "generic":   # D20: project-bound items never leave
        rows = [(x["project"], x["run_id"]) for x in c.execute(
            "SELECT project, run_id FROM kh_item_support WHERE ns=? AND item_id=?", [ctx.ns, item["id"]]).fetchall()]
        ind = independent_projects(rows)
        if len(ind) >= need and sqldb.update(
                c, "UPDATE kh_item SET scope='cross', rev=rev+1, updated_ms=? WHERE ns=? AND item_id=? AND "
                   "scope='project'", [now, ctx.ns, item["id"]]):
            out["promoted"] = {"id": item["id"], "projects": ind, "required": need, "keyspace": item["keyspace"],
                               "key": item["key"]}
    k = confirm_policy(ctx.ns_row, t).get("auto_after_evidence")
    if isinstance(k, int) and not isinstance(k, bool) and k >= 1 and item["status"] == "proposed":
        cur = _decode(_load(c, ctx.ns, item["id"]))
        if cur["evidence_count"] >= k and not lint(c, ctx.ns_row, cur["text"], cur["guard_names"]):
            if sqldb.update(c, "UPDATE kh_item SET status='active', status_reason='auto_after_evidence', "
                               "activated_ms=?, last_confirmed_ms=?, expires_ms=?, rev=rev+1, updated_ms=? "
                               "WHERE ns=? AND item_id=? AND status='proposed'",
                            [now, now, now + _ttl_ms(ctx.ns_row, cur), now, ctx.ns, item["id"]]):
                out["auto_active"] = True
    return out


def _emit_after(ctx: Ctx, effects: list[dict]) -> None:
    for e in effects:
        if e.get("promoted"):
            core.emit(ctx, "kh.item_promoted", e["promoted"])


# ── vectors (a projection rebuilt from SQL) ──────────────────────────────────

_APP: list = []
_coll_lock = threading.Lock()


def collection_name(ns: str) -> str:
    return f"ns_{ns}_knowledge"


def encoder() -> Callable[[str], list[float]] | None:
    model = getattr(getattr(_APP[0], "state", None), "model", None) if _APP else None
    if model is None:
        return None
    return lambda t: model.encode(t, normalize_embeddings=True).tolist()


def _coll(ns: str, create: bool = True):
    from app import vector_store as vs
    name = collection_name(ns)
    if not create and name not in vs.existing_collection_names():
        return None
    with _coll_lock:
        return vs.get_or_create(name)


def index(ns: str, ids: list[str]) -> int:
    """Write the vector rows of these items from SQL; marks vec_rev. Never raises (a stale row is re-done later)."""
    enc = encoder()
    if enc is None or not ids:
        return 0
    from app import vector_store as vs
    done = 0
    try:
        with sqldb.connect() as c:
            rows = [_decode(r) for r in c.execute(
                f"SELECT * FROM kh_item WHERE ns=? AND item_id IN ({','.join('?' for _ in ids)})", [ns, *ids])]
        coll = _coll(ns)
        for it in rows:
            meta = {"ns": ns, "project": it["project"], "scope": it["scope"], "status": it["status"],
                    "kind": it["kind"], "keyspace": it["keyspace"], "key_sha": it["key_sha"]}
            vs.upsert_vt(it["id"], enc(f"{it['title']}. {it['text']}" if it["title"] else it["text"]), it["text"],
                         meta, coll)
            with sqldb.connect() as c:
                sqldb.update(c, "UPDATE kh_item SET vec_rev=? WHERE ns=? AND item_id=? AND rev=?",
                             [it["rev"], ns, it["id"], it["rev"]])
            done += 1
    except Exception:  # noqa: BLE001 - the projection never fails a write
        logger.exception("items - vector index of %s failed", ns)
    return done


def reindex(ns: str, project: str | None = None, all_rows: bool = False) -> dict:
    where, params = ["ns=?"], [ns]
    if project:
        where.append("project=?")
        params.append(project)
    if not all_rows:
        where.append("(vec_rev IS NULL OR vec_rev<>rev)")
    with sqldb.connect() as c:
        ids = [r[0] for r in c.execute(f"SELECT item_id FROM kh_item WHERE {' AND '.join(where)}", params)]
    if encoder() is None:
        return {"ns": ns, "stale": len(ids), "indexed": 0, "reason": "no embedder loaded"}
    n = 0
    for i in range(0, len(ids), 200):
        n += index(ns, ids[i:i + 200])
    return {"ns": ns, "stale": len(ids), "indexed": n}


def search(ns: str, text: str, k: int) -> list[tuple[str, float]]:
    """(item id, cosine) of the closest vector rows with status active. The caller re-checks SQL."""
    enc = encoder()
    if enc is None or not text:
        return []
    from app import vector_store as vs
    coll = _coll(ns, create=False)
    if coll is None:
        return []
    return [(h["core_id"], float(h["score"])) for h in vs.query_vt(enc(text), k, {"status": "active"}, coll)]


def _cron_reindex() -> str:
    if encoder() is None:
        return ""
    with sqldb.connect() as c:
        nss = [r[0] for r in c.execute("SELECT DISTINCT ns FROM kh_item WHERE vec_rev IS NULL OR vec_rev<>rev")]
    return ", ".join(f"{ns}:{reindex(ns)['indexed']}" for ns in nss)


def expire(ns: str | None = None) -> dict:
    """TTL sweep: active items past expires_ms -> withdrawn (reason expired). Conditional UPDATE, any instance."""
    where, params = "status='active' AND expires_ms IS NOT NULL AND expires_ms<?", []
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        sel = f"SELECT ns, item_id FROM kh_item WHERE {where}" + (" AND ns=?" if ns else "")
        rows = [(r[0], r[1]) for r in c.execute(sel, [now, *([ns] if ns else [])]).fetchall()]
        done = []
        for n, i in rows:
            if sqldb.update(c, f"UPDATE kh_item SET status='withdrawn', status_reason='expired', rev=rev+1, "
                               f"updated_ms=? WHERE ns=? AND item_id=? AND {where}", [now, n, i, now]):
                c.execute("DELETE FROM kh_item_confirm WHERE ns=? AND item_id=?", [n, i])
                done.append((n, i))
    for n in {x for x, _ in done}:
        index(n, [i for x, i in done if x == n])
    return {"expired": len(done), "ids": [i for _, i in done][:100]}


def _cron_expire() -> str:
    got = expire()
    return f"expired {got['expired']}" if got["expired"] else ""


CRONS = [("items_expire", 3600, _cron_expire), ("items_reindex", 300, _cron_reindex)]


# ── the write paths ──────────────────────────────────────────────────────────

def propose(ctx: Ctx, body: Any) -> tuple[int, dict]:
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    t = registry.type_of(ctx, str(body.get("kind") or ""), kind_of="item")
    ctx.require("items", "propose", type_row=t, op="write")
    body = _scrub(ctx, f"items/{t['type']}", body)
    errors: list[dict] = []
    for k in body:
        if k not in FIELDS:
            errors.append({"pointer": f"/{k}", "message": "unknown field"})
    project = ctx.require_project(body.get("project"))
    k = parse_key(ctx.ns_row, body.get("keyspace"), body.get("key"))
    text = body.get("text")
    title = body.get("title") or ""
    if not isinstance(text, str) or not text.strip() or len(text) > TEXT_MAX:
        errors.append({"pointer": "/text", "message": f"text is required, at most {TEXT_MAX} characters"})
    if not isinstance(title, str) or len(title) > config.DISTILL_TITLE_CHARS:
        errors.append({"pointer": "/title", "message": f"title is at most {config.DISTILL_TITLE_CHARS} characters"})
    attrs = body.get("attrs") or {}
    if not isinstance(attrs, dict):
        errors.append({"pointer": "/attrs", "message": "attrs must be an object"})
    elif t.get("schema"):
        errors += [{**e, "pointer": "/attrs" + e["pointer"]} for e in registry.validate(ctx.ns, t, attrs)]
    guards = _str_list(body.get("guard_names"), "guard_names", GUARDS_MAX, errors)
    metric = body.get("guard_metric")
    if metric is not None and (not isinstance(metric, str) or not 0 < len(metric) <= 256):
        errors.append({"pointer": "/guard_metric", "message": "guard_metric must be a metric name"})
    mdir = body.get("metric_dir", "up" if metric else None)
    if mdir not in (None, "up", "down"):
        errors.append({"pointer": "/metric_dir", "message": "metric_dir must be up or down"})
    ttl = body.get("ttl_days")
    if ttl is not None and (isinstance(ttl, bool) or not isinstance(ttl, int) or not 1 <= ttl <= 3650):
        errors.append({"pointer": "/ttl_days", "message": "ttl_days must be an integer 1-3650"})
    bound = body.get("bound")
    if bound is not None and bound not in BOUNDS:
        errors.append({"pointer": "/bound", "message": f"bound must be one of {list(BOUNDS)}"})
    triggers = _triggers(body.get("triggers"), errors)
    prov = body.get("provenance") or {}
    if not isinstance(prov, dict):
        errors.append({"pointer": "/provenance", "message": "provenance must be {runs[], event_ids[]}"})
        prov = {}
    runs = _str_list(prov.get("runs"), "provenance/runs", PROV_MAX, errors)
    event_ids = _str_list(prov.get("event_ids"), "provenance/event_ids", PROV_MAX, errors)
    updates, contradicts = body.get("updates"), body.get("contradicts")
    if updates and contradicts:
        errors.append({"pointer": "/updates", "message": "an item either updates or contradicts another, not both"})
    for name, v in (("updates", updates), ("contradicts", contradicts)):
        if v is not None and (not isinstance(v, str) or not ID_RE.match(v)):
            errors.append({"pointer": f"/{name}", "message": f"{name} must be an item id"})
    if errors:
        raise CapError("validation_failed", "the item is not valid", extra={"errors": errors})
    text, title = text.strip(), title.strip()
    leak = _leak(f"{title}\n{text}")
    if leak:
        raise CapError("leak_refused", f"leak gate: '{leak[:40]}'", status=422)
    tsha = _text_sha(text)
    run_id = ctx.run_id
    # near-duplicate by meaning inside the key (outside the transaction: encoding is slow)
    same_by_meaning = None
    enc = encoder() if not (updates or contradicts) else None
    if enc is not None:
        with sqldb.connect() as c:
            pool = [(r["item_id"], r["title"], r["text"]) for r in c.execute(
                "SELECT item_id, title, text FROM kh_item WHERE ns=? AND key_sha=? AND kind=? AND status IN "
                "('proposed','active','contested') AND text_sha<>?", [ctx.ns, k["key_sha"], t["type"], tsha]
            ).fetchall()[:SAME_POOL_MAX]]
        if pool:
            v = enc(f"{title}. {text}" if title else text)
            best = config.DISTILL_SAME
            for iid, ti, tx in pool:
                score = float(sum(a * b for a, b in zip(v, enc(f"{ti}. {tx}" if ti else tx))))
                if score >= best:
                    same_by_meaning, best = iid, score
    lint_errors: list[str] = []
    effects: list[dict] = []
    touched: list[str] = []
    expected = core.require_if_match(ctx.request, t) if updates else None
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        lint_errors = lint(c, ctx.ns_row, text, guards)
        result, status_code = None, 200
        if updates:
            r = _load(c, ctx.ns, updates)
            target = _decode(r) if r else None
            if target is None or not visible(ctx, target) or target["status"] not in LIVE:
                raise CapError("not_found", f"{updates} is not a live item of this namespace")
            if target["kind"] != t["type"]:
                raise CapError("invalid", f"{updates} is a {target['kind']}, not a {t['type']}")
            sets = {"title": title, "text": text, "text_sha": tsha, "attrs_json": core.jdump(attrs),
                    "guard_names_json": core.jdump(guards), "guard_metric": metric, "metric_dir": mdir,
                    "ttl_days": ttl if ttl is not None else target["ttl_days"],
                    "actor_json": core.jdump(ctx.actor()), "updated_ms": now}
            if bound is not None:
                sets["bound"] = bound
            if triggers is not None:
                sets["triggers_json"] = core.jdump(triggers)
            core.cas_update(ctx, c, "kh_item", {"ns": ctx.ns, "item_id": updates}, sets,
                            expected if expected is not None else target["rev"])
            _, item = _add_support(c, ctx, updates, project, run_id, runs, event_ids, now)
            effects.append(_after_support(c, ctx, t, item, now))
            result, item_id = "updated", updates
        else:
            same = same_by_meaning
            if same is None:
                row = c.execute("SELECT item_id FROM kh_item WHERE ns=? AND key_sha=? AND kind=? AND text_sha=? AND "
                                "status IN ('proposed','active','contested')",
                                [ctx.ns, k["key_sha"], t["type"], tsha]).fetchone()
                same = row["item_id"] if row else None
            target = None
            if contradicts:
                r = _load(c, ctx.ns, contradicts)
                target = _decode(r) if r else None
                if target is None or not visible(ctx, target) or target["status"] not in LIVE:
                    raise CapError("not_found", f"{contradicts} is not a live item of this namespace")
                same = None if same == contradicts else same
            item_id = None
            if same is None:
                base = "it_" + hashlib.sha256(core.jdump([ctx.ns, t["type"], k["key_sha"], tsha]).encode()
                                              ).hexdigest()[:24]
                row = {"ns": ctx.ns, "kind": t["type"], "keyspace": k["keyspace"], "key_json": _key_json(k["key"]),
                       "key_sha": k["key_sha"], "project": project, "scope": "project",
                       "status": "contested" if target else "proposed",
                       "status_reason": f"contradicts {contradicts}" if target else None, "title": title,
                       "text": text, "text_sha": tsha, "attrs_json": core.jdump(attrs),
                       "provenance_json": core.jdump({"runs": [], "event_ids": []}), "evidence_count": 0,
                       "support_projects_json": "[]", "guard_names_json": core.jdump(guards),
                       "guard_metric": metric, "metric_dir": mdir, "ttl_days": ttl, "expires_ms": None,
                       "activated_ms": None, "last_confirmed_ms": None, "superseded_by": None,
                       "actor_json": core.jdump(ctx.actor()), "rev": 1, "vec_rev": None, "created_ms": now,
                       "updated_ms": now, "bound": bound or "project", "triggers_json": core.jdump(triggers or [])}
                if sqldb.insert_new(c, "kh_item", {**row, "item_id": base}):
                    item_id = base
                else:
                    cur = _decode(_load(c, ctx.ns, base))
                    if cur["status"] in LIVE and not target:
                        same = base                 # a concurrent proposal of the same item won the insert
                    else:                           # the same text was withdrawn / superseded before: a new item
                        item_id = f"{base}_{secrets.token_hex(3)}"
                        sqldb.insert_new(c, "kh_item", {**row, "item_id": item_id})
            if same is not None:
                _, item = _add_support(c, ctx, same, project, run_id, runs, event_ids, now)
                effects.append(_after_support(c, ctx, t, item, now))
                result, item_id = "merged", same
            else:
                status_code = 201
                _, item = _add_support(c, ctx, item_id, project, run_id, runs, event_ids, now)
                effects.append(_after_support(c, ctx, t, item, now))
                result = "contested" if target else "accepted"
                if target:
                    if target["status"] != "contested":
                        core.cas_update(ctx, c, "kh_item", {"ns": ctx.ns, "item_id": target["id"]},
                                        {"status": "contested", "status_reason": f"contradicted by {item_id}",
                                         "updated_ms": now}, target["rev"])
                    c.execute("DELETE FROM kh_item_confirm WHERE ns=? AND item_id=?", [ctx.ns, target["id"]])
                    touched.append(target["id"])
        core.fence(ctx, c, required=t["fenced"])
        out = _decode(_load(c, ctx.ns, item_id))
    touched.append(item_id)
    _emit_after(ctx, effects)
    index(ctx.ns, touched)
    body_out = {"result": result, "item": out, "lint": lint_errors}
    if contradicts and result == "contested":
        body_out["with"] = [contradicts]
    if any(e.get("promoted") for e in effects):
        body_out["promoted"] = True
    return status_code, body_out


def support(ctx: Ctx, item_id: str, body: Any) -> dict:
    """Independent support for an existing item from a project / run (staged scope, auto activation)."""
    ctx.require("items", "propose")
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    body = _scrub(ctx, "items/support", body)
    project = ctx.require_project(body.get("project"))
    errors: list[dict] = []
    event_ids = _str_list(body.get("event_ids"), "event_ids", PROV_MAX, errors)
    run_id = body.get("run_id") or ctx.run_id
    if run_id is not None and (not isinstance(run_id, str) or not 0 < len(run_id) <= 128):
        errors.append({"pointer": "/run_id", "message": "run_id must be a string"})
    if errors:
        raise CapError("validation_failed", "the support is not valid", extra={"errors": errors})
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        r = _load(c, ctx.ns, item_id)
        cur = _decode(r) if r else None
        if cur is None or not visible(ctx, cur):
            raise CapError("not_found", f"no item {item_id}")
        if cur["status"] not in LIVE:
            raise CapError("invalid_transition", f"item {item_id} is {cur['status']}", status=409)
        t = (ctx.ns_row.get("types") or {}).get(cur["kind"])
        new, item = _add_support(c, ctx, item_id, project, run_id, [], event_ids, now)
        eff = _after_support(c, ctx, t, item, now)
        core.fence(ctx, c, required=bool(t and t["fenced"]))
        out = _decode(_load(c, ctx.ns, item_id))
    _emit_after(ctx, [eff])
    index(ctx.ns, [item_id])
    return {"item": out, "new_support": new, "promoted": bool(eff.get("promoted")),
            "auto_active": bool(eff.get("auto_active"))}


def transition(ctx: Ctx, item_id: str, body: Any) -> tuple[int, dict]:
    """PATCH: a status change under the confirm policy, conditional on (rev, status)."""
    ctx.require("items", "read")
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    body = _scrub(ctx, "items/status", body)
    to = _status(body.get("status"))
    reason = body.get("reason")
    if reason is not None and (not isinstance(reason, str) or len(reason) > 1000):
        raise CapError("invalid", "reason must be a string of at most 1000 characters")
    sup = body.get("superseded_by")
    expected = core.if_match(ctx.request)
    with sqldb.connect() as c:
        r = _load(c, ctx.ns, item_id)
        cur = _decode(r) if r else None
        if cur is None or not visible(ctx, cur):
            raise CapError("not_found", f"no item {item_id}")
        t = (ctx.ns_row.get("types") or {}).get(cur["kind"])
        if expected is None and t and t.get("require_if_match"):
            raise CapError("precondition_required", f"type {cur['kind']} requires If-Match")
        if expected is not None and expected >= 0 and expected != cur["rev"]:
            raise CapError("write_conflict", "the item changed since you read it", extra={"current": cur},
                           headers={"ETag": core.etag(cur["rev"])},
                           kh_events=[(ctx.ns, "kh.write_conflict", {"table": "kh_item", "id": item_id,
                                                                     "expected_rev": expected,
                                                                     "current_rev": cur["rev"]}, ctx.actor())])
        frm = cur["status"]
        if to not in TRANSITIONS[frm]:
            raise CapError("invalid_transition", f"cannot go from {frm} to {to}", status=409,
                           extra={"allowed": sorted(TRANSITIONS[frm])})
        policy = confirm_policy(ctx.ns_row, t)
        confirmer = can_confirm(ctx, policy)
        role = ctx.role
        allowed = {"active": confirmer, "proposed": confirmer,
                   "withdrawn": confirmer or core.role_allows(role, "items", "withdraw"),
                   "contested": confirmer or any(core.role_allows(role, "items", a)
                                                 for a in ("write", "confirm", "withdraw")),
                   "superseded": confirmer or core.role_allows(role, "items", "write")}[to]
        if not allowed:
            raise CapError("forbidden", f"role {role} may not set an item to {to} (confirm_policy of {cur['kind']})")
        now = sqldb.now_ms(c)
        sets: dict[str, Any] = {"status": to, "status_reason": reason, "updated_ms": now,
                                "actor_json": core.jdump(ctx.actor())}
        pending = None
        if to == "active":
            errs = lint(c, ctx.ns_row, cur["text"], cur["guard_names"])
            if errs:
                raise CapError("lint_failed", "the item does not pass lint", status=422, extra={"lint": errs})
            quorum = policy.get("quorum") if isinstance(policy.get("quorum"), int) else 1
            if frm != "active" and quorum > 1:
                sqldb.insert_new(c, "kh_item_confirm", {"ns": ctx.ns, "item_id": item_id,
                                                        "principal": ctx.caller.principal, "at_ms": now})
                n = int(c.execute("SELECT COUNT(*) FROM kh_item_confirm WHERE ns=? AND item_id=?",
                                  [ctx.ns, item_id]).fetchone()[0])
                if n < quorum:
                    pending = {"confirmations": n, "quorum": quorum}
            if pending is None:
                sets.update(last_confirmed_ms=now, expires_ms=now + _ttl_ms(ctx.ns_row, cur),
                            activated_ms=cur["activated_ms"] if frm == "active" else now)
        elif to == "superseded":
            if not isinstance(sup, str) or sup == item_id:
                raise CapError("invalid", "superseded_by must name another item")
            r2 = _load(c, ctx.ns, sup)
            if r2 is None or r2["status"] not in LIVE or not visible(ctx, _decode(r2)):
                raise CapError("not_found", f"{sup} is not a live item of this namespace")
            sets["superseded_by"] = sup
        if to == "proposed":
            sets["superseded_by"] = None
        if pending is None:
            core.cas_update(ctx, c, "kh_item", {"ns": ctx.ns, "item_id": item_id}, sets, cur["rev"],
                            extra_where="status=?", extra_params=[frm])
            c.execute("DELETE FROM kh_item_confirm WHERE ns=? AND item_id=?", [ctx.ns, item_id])
        core.fence(ctx, c, required=bool(t and t["fenced"]))
        out = _decode(_load(c, ctx.ns, item_id))
    if pending is not None:
        return 202, {"item": out, "pending": pending}
    index(ctx.ns, [item_id])
    return 200, {"item": out}


# ── reads ────────────────────────────────────────────────────────────────────

def get_item(ctx: Ctx, item_id: str) -> dict:
    with sqldb.connect() as c:
        r = _load(c, ctx.ns, item_id)
    it = _decode(r) if r else None
    if it is None or not visible(ctx, it):
        raise CapError("not_found", f"no item {item_id}")
    return it


def _visibility_sql(ctx: Ctx) -> tuple[str, list]:
    if ctx.caller.projects is None:
        return "", []
    ps = sorted(ctx.caller.projects)
    if not ps:
        return " AND scope='cross'", []
    return f" AND (scope='cross' OR project IN ({','.join('?' for _ in ps)}))", ps


def list_items(ctx: Ctx, keyspace: str, key: str, status: str, kind: str, project: str, scope: str,
               limit: int, offset: int) -> dict:
    where, params = ["ns=?"], [ctx.ns]
    if keyspace:
        if key:
            k = parse_key(ctx.ns_row, keyspace, key)
            where.append("key_sha=?")
            params.append(k["key_sha"])
        else:
            parse_key(ctx.ns_row, keyspace, {})
            where.append("keyspace=?")
            params.append(keyspace)
    elif key:
        raise CapError("invalid", "key needs keyspace")
    if status:
        sts = [_status(s) for s in status.split(",") if s.strip()]
        where.append(f"status IN ({','.join('?' for _ in sts)})")
        params += sts
    for col, v in (("kind", kind), ("project", project), ("scope", scope)):
        if v:
            where.append(f"{col}=?")
            params.append(v)
    vis, vp = _visibility_sql(ctx)
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT * FROM kh_item WHERE {' AND '.join(where)}{vis} ORDER BY updated_ms DESC, item_id "
                         f"LIMIT ? OFFSET ?", [*params, *vp, limit, offset]).fetchall()
    return {"items": [_decode(r) for r in rows], "limit": limit, "offset": offset}


def patterns(ctx: Ctx, keyspace: str, project: str) -> dict:
    """Counts per (keyspace, key, kind) with a status breakdown, counted in code from SQL rows."""
    where, params = ["ns=?"], [ctx.ns]
    if keyspace:
        where.append("keyspace=?")
        params.append(keyspace)
    if project:
        where.append("project=?")
        params.append(project)
    vis, vp = _visibility_sql(ctx)
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT keyspace, key_sha, key_json, kind, status, scope, evidence_count FROM kh_item "
                         f"WHERE {' AND '.join(where)}{vis}", [*params, *vp]).fetchall()
    groups: dict[tuple, dict] = {}
    for r in rows:
        g = groups.setdefault((r["keyspace"], r["key_sha"], r["kind"]), {
            "keyspace": r["keyspace"], "key": json.loads(r["key_json"]), "kind": r["kind"], "count": 0,
            "by_status": {}, "cross": 0, "evidence": 0})
        g["count"] += 1
        g["by_status"][r["status"]] = g["by_status"].get(r["status"], 0) + 1
        g["cross"] += r["scope"] == "cross"
        g["evidence"] += int(r["evidence_count"] or 0)
    out = sorted(groups.values(), key=lambda g: (-g["count"], g["keyspace"], core.jdump(g["key"]), g["kind"]))
    return {"total": len(rows), "patterns": out}


# ── hooks ────────────────────────────────────────────────────────────────────

def _type_usage(c, ns: str, type_row: dict) -> int:
    if type_row.get("kind_of") != "item":
        return 0
    return int(c.execute("SELECT COUNT(*) FROM kh_item WHERE ns=? AND kind=?", [ns, type_row["type"]]).fetchone()[0])


def _on_state(c, ns: str, old: str, new: str) -> None:       # noqa: ARG001
    if new == "purged":
        for table in ("kh_item", "kh_item_support", "kh_item_confirm"):
            c.execute(f"DELETE FROM {table} WHERE ns=?", [ns])
        try:
            from app import vector_store as vs
            vs.drop_collection(collection_name(ns))
        except Exception:  # noqa: BLE001
            logger.exception("items - could not drop the vector collection of %s", ns)


async def _json(request: Request):
    raw = await request.body()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        raise CapError("invalid", "body must be JSON")


def attach(app) -> None:
    TAG = ["v1 items"]
    _APP[:] = [app]
    if _type_usage not in registry.TYPE_USAGE:
        registry.TYPE_USAGE.append(_type_usage)
    if _on_state not in registry.ON_STATE:
        registry.ON_STATE.append(_on_state)
    if _confirmer_resolver not in core.CALLER_RESOLVERS:
        core.CALLER_RESOLVERS.append(_confirmer_resolver)

    def can_run(ctx: Ctx) -> None:
        if not ctx.is_admin and ctx.role != "orchestrator":
            raise CapError("forbidden", "for the namespace admin or an orchestrator")

    @app.post("/v1/{ns}/items", tags=TAG, summary="Propose a knowledge item (dedupe, contradiction, leak gate)")
    @core.idempotent
    async def items_post(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        body = await _json(request)
        status, out = await asyncio.to_thread(propose, ctx, body)
        return core.reply(status, out, {"ETag": core.etag(out["item"]["rev"])})

    @app.get("/v1/{ns}/items", tags=TAG, summary="Items by keyspace, key, status, kind, project and scope")
    async def items_list(ns: str, keyspace: str = "", key: str = "", status: str = "", kind: str = "",
                         project: str = "", scope: str = "", limit: int = 100, offset: int = 0,
                         ctx: Ctx = Depends(ns_ctx)):
        ctx.require("items", "read")
        return await asyncio.to_thread(list_items, ctx, keyspace, key, status, kind, project, scope,
                                       max(1, min(limit, LIST_MAX)), max(0, offset))

    @app.get("/v1/{ns}/items:patterns", tags=TAG, summary="Counts per key and kind, computed in code")
    async def items_patterns(ns: str, keyspace: str = "", project: str = "", ctx: Ctx = Depends(ns_ctx)):
        ctx.require("items", "read")
        return await asyncio.to_thread(patterns, ctx, keyspace, project)

    @app.post("/v1/{ns}/items:lint", tags=TAG, summary="Lint a text and guard names (stores nothing)")
    async def items_lint(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("items", "read")
        body = await _json(request)
        if not isinstance(body, dict) or not isinstance(body.get("text"), str):
            raise CapError("invalid", "body must be {text, guard_names?}")
        guards = body.get("guard_names") or []
        if not isinstance(guards, list) or not all(isinstance(g, str) for g in guards):
            raise CapError("invalid", "guard_names must be a list of strings")

        def run():
            with sqldb.connect() as c:
                return lint(c, ctx.ns_row, body["text"], guards)
        errs = await asyncio.to_thread(run)
        return {"ok": not errs, "errors": errs}

    @app.post("/v1/{ns}/items:reindex", tags=TAG, summary="Rebuild the item vector rows from SQL")
    async def items_reindex(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        can_run(ctx)
        body = await _json(request)
        body = body if isinstance(body, dict) else {}
        return await asyncio.to_thread(reindex, ns, body.get("project") or None, bool(body.get("all")))

    @app.post("/v1/{ns}/items:expire", tags=TAG, summary="Run the TTL sweep for this namespace now")
    async def items_expire(ns: str, ctx: Ctx = Depends(ns_ctx)):
        can_run(ctx)
        return await asyncio.to_thread(expire, ns)

    @app.get("/v1/{ns}/items/{item_id}", tags=TAG, summary="One item with its ETag")
    async def items_get(ns: str, item_id: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("items", "read")
        it = await asyncio.to_thread(get_item, ctx, item_id)
        return core.reply(200, it, {"ETag": core.etag(it["rev"])})

    @app.patch("/v1/{ns}/items/{item_id}", tags=TAG, summary="Change status (If-Match; confirm_policy)")
    @core.idempotent
    async def items_patch(request: Request, ns: str, item_id: str, ctx: Ctx = Depends(ns_ctx)):
        body = await _json(request)
        status, out = await asyncio.to_thread(transition, ctx, item_id, body)
        return core.reply(status, out, {"ETag": core.etag(out["item"]["rev"])})

    @app.post("/v1/{ns}/items/{item_id}:support", tags=TAG, summary="Add independent support from a project/run")
    @core.idempotent
    async def items_support(request: Request, ns: str, item_id: str, ctx: Ctx = Depends(ns_ctx)):
        body = await _json(request)
        out = await asyncio.to_thread(support, ctx, item_id, body)
        return core.reply(200, out, {"ETag": core.etag(out["item"]["rev"])})
