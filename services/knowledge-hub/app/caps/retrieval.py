"""Keyed per-step retrieval for namespaces (docs/multi-agent-instance-design.md 4.9, slice F7).

  POST /v1/{ns}/context/step  {project, keyspace, key{...}, query?, budget_chars (default 6000, max 20000),
                               tiers?, entities?, limit?}
       -> {pack_text, served:[{tier, id, chars}], serve_id, items, used_chars, cut_at_budget, ...}

TIERS, in this order (the app/step.py order and budget: ``step._Pack`` packs in tier order, cuts the last row
to fit and lists what it left out):

  entity        entity cards named in the query / entities (people lane: only with include_people_lanes)
  key           namespace items with the EXACT key (status active, not expired; this project's first, then cross)
  key-wildcard  items whose last key dimension is ``*`` with the same leading dimensions
  meaning       namespace items by meaning (vector rows of ``ns_<ns>_knowledge``, re-checked in SQL), floor
                config.STEP_FLOOR (``settings.retrieval.floor`` overrides); with include_people_lanes also the
                project's own knowledge by meaning (step._by_meaning), merged in score order
  rules         rules of the named ``entities``, 1 hop (caps/rules.py SQL walk), when the rules capability is on
  packs         quotes from ``PROVIDERS["packs"]`` (registered by caps/packs.py: fn(ctx, req) -> [{id, text, score?}])
  log           the project's worklog by meaning (people lane, opt-in)

SHARING (D20, revised 2026-10-11). The boundary is the project, not people versus agents. A namespace pack holds
people's lanes of the same project (entity cards, knowledge, worklog) unless the manifest sets
``settings.retrieval.include_people_lanes: false``; people's rows take at most ``cross_share`` (default 0.4) of the
budget, the rest are listed as dropped. People's POST /context/step reads the namespace items of the project the
other way round (app/step.py tier ``agents``, behind KH_STEP_NS_ITEMS). Project-scoped items of another project are
never served; cross-scoped ones are. ``situation`` (optional) names the step's situation: an item with triggers is
served only when one of them equals it. ``proposed`` items are served after active ones and marked
``[unverified]`` unless ``settings.retrieval.serve_proposed`` is false.

SERVED LOG. Every response writes ONE ``kh.served`` event (with the run, unit and session headers through the
actor) holding ``serve_id``, the key and every served id; ``item_ids`` lists the namespace items, which the
consumer copies into its own event as lesson ids and which the F8 rollback joins on.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from typing import Any, Callable

from fastapi import Depends, Request

from app import config, sqldb
from app.caps import core, items
from app.caps.core import CapError, Ctx, ns_ctx

logger = logging.getLogger(__name__)

NAME = "retrieval"
VERSION = "1.0.0"
STATUS = "beta"
BUDGET_DEFAULT = 6000
BUDGET_MAX = 20000
BUDGET_MIN = 200
LIMIT_DEFAULT = 10
LIMIT_MAX = 50
QUERY_MAX = 4000
TIERS = ("entity", "key", "key-wildcard", "meaning", "rules", "packs", "log")
NS_ITEM_TIERS = {"key", "key-wildcard", "meaning"}
LIMITS = {"budget_default": BUDGET_DEFAULT, "budget_max": BUDGET_MAX, "per_tier_limit": LIMIT_MAX,
          "tiers": list(TIERS)}

#: Tier providers other capabilities register in their attach: name -> fn(ctx, req) -> [{id, text, score?}].
#: Called in a worker thread; a failing provider costs only its own tier.
PROVIDERS: dict[str, Callable[[Ctx, dict], list[dict]]] = {}


def init(c) -> None:      # noqa: ARG001 - no tables: retrieval reads kh_item (items) and writes kh.served (events)
    return None


def _settings(ns_row: dict) -> dict:
    s = (ns_row.get("config") or {}).get("settings") or {}
    r = s.get("retrieval") or {}
    return {**({"include_people_lanes": s["include_people_lanes"]} if "include_people_lanes" in s else {}),
            **(r if isinstance(r, dict) else {})}


CROSS_SHARE = 0.4


def people_lanes(ns_row: dict) -> bool:
    """D20 revised: on unless the manifest says ``include_people_lanes: false``."""
    return _settings(ns_row).get("include_people_lanes") is not False


def cross_share(settings: dict) -> float:
    v = settings.get("cross_share")
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1 else CROSS_SHARE


def serve_proposed(ns_row: dict) -> bool:
    return _settings(ns_row).get("serve_proposed") is not False


def parse_situation(v: Any) -> str | None:
    if v is None or v == "":
        return None
    from app.caps.items import TRIGGER_RE
    if not isinstance(v, str) or not TRIGGER_RE.match(v):
        raise CapError("invalid", "situation must be one situation name ([a-z0-9_.:-], e.g. crash, tool_call:shell)")
    return v


def parse(ctx: Ctx, body: Any) -> dict:
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    project = ctx.require_project(body.get("project"))
    k = items.parse_key(ctx.ns_row, body.get("keyspace"), body.get("key"))
    query = body.get("query") or ""
    if not isinstance(query, str) or len(query) > QUERY_MAX:
        raise CapError("invalid", f"query must be a string of at most {QUERY_MAX} characters")
    budget = body.get("budget_chars", BUDGET_DEFAULT)
    if isinstance(budget, bool) or not isinstance(budget, int) or not BUDGET_MIN <= budget <= BUDGET_MAX:
        raise CapError("invalid", f"budget_chars must be an integer {BUDGET_MIN}-{BUDGET_MAX}")
    tiers = body.get("tiers") or list(TIERS)
    if not isinstance(tiers, list) or not set(tiers) <= set(TIERS):
        raise CapError("invalid", f"tiers must be a subset of {list(TIERS)}")
    ents = body.get("entities") or []
    if not isinstance(ents, list) or len(ents) > 20 or not all(isinstance(e, str) and 0 < len(e) <= 256 for e in ents):
        raise CapError("invalid", "entities must be a list of at most 20 names")
    limit = body.get("limit", LIMIT_DEFAULT)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= LIMIT_MAX:
        raise CapError("invalid", f"limit must be an integer 1-{LIMIT_MAX}")
    return {"project": project, "key": k, "query": query.strip(), "budget": budget, "tiers": set(tiers),
            "entities": ents, "limit": limit, "situation": parse_situation(body.get("situation"))}


def line_of(it: dict) -> str:
    keys = "/".join(str(v) for v in (it.get("key") or {}).values())
    title = f"{it['title']}: " if it.get("title") else ""
    if it.get("status") == "proposed":
        title = "[unverified] " + title
    text = it.get("text") or ""
    if len(text) > config.STEP_ITEM_CHARS:
        text = text[:config.STEP_ITEM_CHARS].rstrip() + " ...(cut; GET the item by id)"
    return f"{it['id']} {it['kind']} [{keys}] {title}{text}"


_LIVE_SQL = "status='active' AND (expires_ms IS NULL OR expires_ms>?) AND (project=? OR scope='cross')"
# active first, then (serve_proposed) proposed ones of THIS project only, newest first
_KEY_SQL = ("(status='active' AND (expires_ms IS NULL OR expires_ms>?) AND (project=? OR scope='cross') "
            "OR status='proposed' AND ? = 1 AND project=?)")


def _ns_tiers(ctx: Ctx, req: dict) -> dict[str, list[dict]]:
    """The namespace tiers (SQL, the key tier is one indexed SELECT). Runs in a worker thread."""
    out: dict[str, list[dict]] = {}
    k, project, limit = req["key"], req["project"], req["limit"]
    sit = req.get("situation")
    proposed = 1 if serve_proposed(ctx.ns_row) else 0
    hits = items.search(ctx.ns, req["query"], limit * 3) if "meaning" in req["tiers"] and req["query"] else []
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)

        def by_key(sha: str) -> list[dict]:
            rows = c.execute(f"SELECT * FROM kh_item WHERE ns=? AND key_sha=? AND {_KEY_SQL} "
                             "ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, "
                             "CASE WHEN scope='project' THEN 0 ELSE 1 END, last_confirmed_ms DESC, updated_ms DESC, "
                             "item_id LIMIT ?", [ctx.ns, sha, now, project, proposed, project, limit * 3]).fetchall()
            return [it for it in map(items._decode, rows) if items.triggered(it, sit)][:limit]
        if "key" in req["tiers"]:
            out["key"] = by_key(k["key_sha"])
        if "key-wildcard" in req["tiers"] and k["wild_sha"]:
            out["key-wildcard"] = by_key(k["wild_sha"])
        if hits:
            floor = _settings(ctx.ns_row).get("floor")
            if isinstance(floor, (int, float)) and not isinstance(floor, bool):
                floor = float(floor)
            else:                             # S14: the improve read path (the default unless tuned)
                from app.caps import improve
                floor = improve.param("KH_STEP_FLOOR", config.STEP_FLOOR)
            score = {i: s for i, s in hits if s >= floor}
            ids = list(score)
            rows = c.execute(f"SELECT * FROM kh_item WHERE ns=? AND item_id IN ({','.join('?' for _ in ids)}) AND "
                             f"{_LIVE_SQL}", [ctx.ns, *ids, now, project]).fetchall() if ids else []
            got = sorted((it for it in map(items._decode, rows) if items.triggered(it, sit)),
                         key=lambda it: -score[it["id"]])[:limit]
            out["meaning"] = [{**it, "score": round(score[it["id"]], 3)} for it in got]
    out["_failed"] = []
    if "rules" in req["tiers"] and req["entities"]:
        from app import caps
        if caps.is_loaded("rules") and core.role_allows(ctx.role, "rules", "read"):
            try:
                from app.caps import rules
                res = rules.query(ctx, {"project": project, "start_entities": req["entities"], "hops": 1,
                                        "path": "sql"})
                out["rules"] = [{"id": r["rule_id"], "text": f"{r['rule_id']} rule [{r['validity']}] {r['entity']}."
                                                             f"{r['attribute']}: when {r['condition'] or 'always'} "
                                                             f"then {r['effect']}"} for r in res["rules"][:limit]]
            except Exception as exc:  # noqa: BLE001 - a broken tier must not cost the step the others
                logger.warning("ns context step: rules failed: %s", exc)
                out["_failed"].append("rules")
    for name, fn in PROVIDERS.items():
        if name in req["tiers"]:
            try:
                out[name] = list(fn(ctx, req) or [])[:limit]
            except Exception as exc:  # noqa: BLE001
                logger.warning("ns context step: provider %s failed: %s", name, exc)
                out["_failed"].append(name)
    return out


async def build(ctx: Ctx, body: Any) -> dict:
    from app import step

    req = await asyncio.to_thread(parse, ctx, body)
    people = people_lanes(ctx.ns_row)
    model = getattr(ctx.request.app.state, "model", None)
    reads: dict[str, Any] = {"ns": asyncio.to_thread(_ns_tiers, ctx, req)}
    project, q = req["project"], req["query"]
    if people:
        from app import entities as kh_entities
        from app import hotlog
        named_text = " ".join([q] + req["entities"]).strip()
        if "entity" in req["tiers"] and named_text:
            reads["named"] = asyncio.to_thread(kh_entities.match, named_text, [project], config.STEP_ENTITY_LIMIT)
        if q and model is not None:
            if "meaning" in req["tiers"]:
                reads["know"] = step._by_meaning(q, "knowledge", project, config.STEP_K, model)
            if "log" in req["tiers"]:
                reads["log"] = step._by_meaning(q, hotlog.config.HOTLOG_SCOPE, project, config.STEP_K, model)
    got = dict(zip(reads, await asyncio.gather(*reads.values(), return_exceptions=True)))
    failed = []
    for name, value in got.items():
        if isinstance(value, Exception):          # a broken tier must not cost the step the others
            if isinstance(value, CapError) and name == "ns" and value.status in (400, 403, 404, 422):
                raise value
            logger.warning("ns context step: %s failed: %s", name, value)
            failed.append(name)
            got[name] = {} if name == "ns" else []
    ns_t = got["ns"]
    failed += ns_t.get("_failed") or []

    pack = step._Pack(req["budget"])
    ns_ids: list[str] = []
    people_cap = int(req["budget"] * cross_share(_settings(ctx.ns_row)))
    people_used = [0]

    def add(tier: str, item: dict) -> None:
        text = (item.get("text") or "") + "\n"
        if item.get("lane") == "people":
            if people_used[0] + len(text) > people_cap:   # D20: people's rows share the budget, never take it
                pack.dropped.append({"tier": tier, "id": item["id"], "score": item.get("score"),
                                     "reason": "cross_share"})
                return
        before, used = len(pack.items), pack.used
        pack.add(tier, {**item, "text": text})
        if len(pack.items) > before:
            if item.get("lane") == "people":
                people_used[0] += pack.used - used
            if tier in NS_ITEM_TIERS:
                ns_ids.append(item["id"])

    if people:
        from app import entities as kh_entities
        for card in got.get("named") or []:
            add("entity", {"id": card["id"], "lane": "people", "text": kh_entities.line_of(card)})
    for tier in ("key", "key-wildcard"):
        for it in ns_t.get(tier) or []:
            add(tier, {"id": it["id"], "score": None, "scope": it["scope"], "text": line_of(it)})
    rows = [("meaning", {"id": it["id"], "score": it["score"], "scope": it["scope"], "text": line_of(it)})
            for it in ns_t.get("meaning") or []]
    rows += [("meaning", {**step._row_item(h, q), "lane": "people"}) for h in got.get("know") or []]
    for tier, item in sorted(rows, key=lambda x: x[1].get("score") or 0.0, reverse=True):
        add(tier, item)
    for tier in ("rules", "packs"):
        for it in ns_t.get(tier) or []:
            add(tier, {"id": str(it["id"]), "score": it.get("score"), "text": it.get("text") or ""})
    for h in got.get("log") or []:
        add("log", {**step._row_item(h, q), "lane": "people"})

    for it in pack.items:
        it["text"] = it["text"].rstrip("\n")
    served = [{"tier": it["tier"], "id": it["id"], "chars": len(it["text"])} for it in pack.items]
    pack_text = "\n".join(it["text"] for it in pack.items)
    serve_id = f"sv_{int(time.time() * 1000):012x}{secrets.token_hex(6)}"
    k = req["key"]
    event = {"serve_id": serve_id, "project": project, "keyspace": k["keyspace"], "key": k["key"],
             "key_sha": k["key_sha"], "served": served, "item_ids": ns_ids, "budget_chars": req["budget"],
             "used_chars": len(pack_text), "cut_at_budget": pack.full, "situation": req["situation"]}
    await asyncio.to_thread(core.emit, ctx, "kh.served", event)
    out = {"serve_id": serve_id, "project": project, "keyspace": k["keyspace"], "key": k["key"],
           "key_sha": k["key_sha"], "pack_text": pack_text, "served": served, "item_ids": ns_ids,
           "items": pack.items, "tiers": list(dict.fromkeys(it["tier"] for it in pack.items)),
           "budget_chars": req["budget"], "used_chars": len(pack_text), "cut_at_budget": pack.full,
           "dropped": [{"tier": d["tier"], "id": d["id"], **({"reason": d["reason"]} if d.get("reason") else {})}
                       for d in pack.dropped], "people_lanes": people}
    if failed:
        out["failed_tiers"] = failed
    return out


# ── the other direction: namespace items in people's /context/step (D20 revised) ──

PEOPLE_LIMIT = 5


def _situations(text: str, context: str | None) -> set[str]:
    """Situation names a person's step names: its context tag, and every word of the step (folded)."""
    from app import entities as kh_entities
    words = set(kh_entities.fold(text or "").split())
    return words | ({context} if context else set())


def _matches(item: dict, sits: set[str]) -> bool:
    """A trigger matches when the step names it whole, or names its last part (``tool_call:shell`` <- 'shell')."""
    return any(t in sits or t.rsplit(":", 1)[-1] in sits for t in item.get("triggers") or [])


def people_items(project: str, text: str, context: str | None = None, limit: int = PEOPLE_LIMIT) -> list[dict]:
    """Items of every active consumer namespace attached to ``project`` that a person's step about ``text`` should
    see: items whose trigger the step names, then items close by meaning (floor STEP_FLOOR). Active items of the
    project or cross-scoped; proposed ones of the project when the namespace serves them (marked unverified).
    KH's own namespaces (prefix ``kh``) are skipped: people's lessons already reach people another way.
    Returns [{ns, item, score, why}] best first. Runs in a worker thread; the caller has checked project.read."""
    with sqldb.connect() as c:
        rows = c.execute("SELECT ns, projects_json, config_json FROM kh_ns WHERE state='active'").fetchall()
    nss = {}
    for r in rows:
        projects = json.loads(r["projects_json"] or "[]")
        if r["ns"].startswith("kh") or (projects and project not in projects):
            continue
        nss[r["ns"]] = {"ns": r["ns"], "config": json.loads(r["config_json"] or "{}")}
    if not nss:
        return []
    sits = _situations(text, context)
    from app.caps import improve
    floor = improve.param("KH_STEP_FLOOR", config.STEP_FLOOR)
    out: list[dict] = []
    with sqldb.connect() as c:
        now = sqldb.now_ms(c)
        for ns, row in nss.items():
            proposed = 1 if serve_proposed(row) else 0
            live = c.execute(f"SELECT * FROM kh_item WHERE ns=? AND {_KEY_SQL} AND triggers_json IS NOT NULL "
                             "AND triggers_json<>'[]' ORDER BY updated_ms DESC LIMIT 200",
                             [ns, now, project, proposed, project]).fetchall()
            for it in map(items._decode, live):
                if _matches(it, sits):
                    out.append({"ns": ns, "item": it, "score": None, "why": "trigger"})
    for ns, row in nss.items():
        hits = {i: s for i, s in items.search(ns, text, limit * 3) if s >= floor}
        if not hits:
            continue
        with sqldb.connect() as c:
            now = sqldb.now_ms(c)
            got = c.execute(f"SELECT * FROM kh_item WHERE ns=? AND item_id IN ({','.join('?' for _ in hits)}) "
                            f"AND {_LIVE_SQL}", [ns, *hits, now, project]).fetchall()
        for it in map(items._decode, got):
            if not it["triggers"] or _matches(it, sits):
                out.append({"ns": ns, "item": it, "score": round(hits[it["id"]], 3), "why": "meaning"})
    seen, best = set(), []
    for x in sorted(out, key=lambda x: (x["why"] != "trigger", x["item"]["status"] != "active",
                                        -(x["score"] or 0.0))):
        if (x["ns"], x["item"]["id"]) not in seen:
            seen.add((x["ns"], x["item"]["id"]))
            best.append(x)
    return best[:limit]


def note_people_served(project: str, served: list[dict], principal: str | None) -> None:
    """One kh.served per namespace whose items a person's step packed (the F8 rollback joins on it)."""
    by_ns: dict[str, list[str]] = {}
    for x in served:
        by_ns.setdefault(x["ns"], []).append(x["item"]["id"])
    for ns, ids in by_ns.items():
        serve_id = f"sv_{int(time.time() * 1000):012x}{secrets.token_hex(6)}"
        core.emit(ns, "kh.served", {"serve_id": serve_id, "project": project, "lane": "people", "item_ids": ids,
                                    "served": [{"tier": "agents", "id": i} for i in ids]},
                  {"principal": principal or "person", "role": "person"})


WORKLOG_MAX = 4000


def write_worklog(ctx: Ctx, body: Any) -> dict:
    """One worklog line of a namespace agent in the project's own worklog, the lane people read too (D20
    revised: worklogs are shared inside a project). Redacted first; the author is the principal, never chosen by
    the caller; the id is a hash of namespace, project and text, so a replay writes the same row."""
    import hashlib
    from datetime import datetime, timezone

    from app import hotlog
    from app.vector_store import hotlog_collection, own_project, upsert_vt
    if not isinstance(body, dict):
        raise CapError("invalid", "body must be an object")
    body = items._scrub(ctx, "worklog", body)
    project = ctx.require_project(body.get("project"))
    if not project:
        raise CapError("invalid", "project is required")
    text, subject = body.get("text"), body.get("subject") or "agent worklog"
    if not isinstance(text, str) or not text.strip() or len(text) > WORKLOG_MAX:
        raise CapError("invalid", f"text is required, at most {WORKLOG_MAX} characters")
    if not isinstance(subject, str) or not 0 < len(subject) <= 128:
        raise CapError("invalid", "subject must be 1-128 characters")
    enc = items.encoder()
    if enc is None:
        raise CapError("embedder_unavailable", "no embedder loaded")
    text = text.strip()
    vid = "vec_" + hashlib.sha256(f"{ctx.ns}\x1f{project}\x1f{text}".encode("utf-8")).hexdigest()[:12]
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {"knowledge_type": "quick", "scope": hotlog.config.HOTLOG_SCOPE, "project": project, "subject": subject,
            "topic": subject, "ts": ts, "ns": ctx.ns, hotlog.AUTHOR_KEY: f"ns:{ctx.ns}/{ctx.caller.principal}",
            hotlog.OWNER_KEY: own_project(project), "run_id": ctx.run_id or ""}
    upsert_vt(vid, enc(text), text, meta, hotlog_collection())
    return {"id": vid, "project": project, "subject": subject, "ts": ts}


def match_projects(ctx: Ctx, body: Any) -> dict:
    """Which existing KH project a piece of incoming work belongs to (the consumer's intake decides; KH only
    answers). Candidates are the namespace's projects that the caller may use, matched literally as
    /orchestrator/project_match does, each with its descriptor so the deciding agent can read it."""
    if not isinstance(body, dict) or not isinstance(body.get("text"), str) or not 0 < len(body["text"]) <= QUERY_MAX:
        raise CapError("invalid", f"text is required, at most {QUERY_MAX} characters")
    from app import projects as kh_projects
    from app import turn
    allowed = set(ctx.ns_row.get("projects") or [])
    if not allowed:                               # an unscoped namespace: the owner's projects as last seen
        from app.caps import principals
        owned = principals.owner_projects((ctx.ns_row.get("owner_email") or "").lower())
        allowed = set(owned) if owned is not None else set(kh_projects.list_projects())
    if ctx.caller.projects is not None:
        allowed &= set(ctx.caller.projects)
    part = turn.project_part(body["text"], allowed)
    cands = []
    for m in part["matches"]:
        entry = kh_projects.get_project(m["project"]) or {}
        cands.append({**m, "descriptor": (entry.get("descriptor") or "")[:1000],
                      "aliases": (entry.get("aliases") or [])[:20]})
    return {**part, "matches": cands, "candidates_total": len(allowed)}


def attach(app) -> None:
    TAG = ["v1 retrieval"]

    @app.post("/v1/{ns}/worklog", tags=TAG,
              summary="One worklog line of an agent in the project's own worklog (shared with people)")
    @core.idempotent
    async def ns_worklog(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("worklog", "append")
        raw = await request.body()
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            raise CapError("invalid", "body must be JSON")
        return await asyncio.to_thread(write_worklog, ctx, body)

    @app.post("/v1/{ns}/projects:match", tags=TAG,
              summary="Which attached KH project incoming work belongs to (literal match plus descriptors)")
    async def ns_projects_match(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("retrieval", "read")
        raw = await request.body()
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            raise CapError("invalid", "body must be JSON")
        return await asyncio.to_thread(match_projects, ctx, body)

    @app.post("/v1/{ns}/context/step", tags=TAG,
              summary="One keyed context pack for one step, within a character budget; served ids logged")
    async def ns_context_step(request: Request, ns: str, ctx: Ctx = Depends(ns_ctx)):
        ctx.require("retrieval", "read")
        raw = await request.body()
        try:
            import json
            body = json.loads(raw) if raw else {}
        except ValueError:
            raise CapError("invalid", "body must be JSON")
        return await build(ctx, body)
