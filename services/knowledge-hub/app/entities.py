"""Entity cards - the distilled layer on top of the worklogs (fen 2026-09-22/23, built 2026-09-30).

WHY. Worklogs record one turn each. A durable fact - "Elio is a developer on the NodeJS work,
Floyd reviews it" - is scattered across hundreds of rows and only found when someone points at it,
so a model asking about Elio reads the story of several Tuesdays. An entity card says it once.

WHAT A CARD IS. One row per (project, entity), in the project's own part kh_entity_<project>:
  name, type (person, system, module, tool, org, rule), a one-line role, a one-line purpose,
  aliases, relations [{rel, target}] (develops, reviews, owns, depends_on, uses, reports_to, ...),
  the worklog ids it was learned from, and first/last seen dates.
The id is derived from the project and the folded name, so learning the same entity again UPDATES
its card (lists are merged, role/purpose replaced) instead of adding a near-duplicate - the
repetition problem fen named. The relations make the cards a graph: /entities/{project}/{name}
?depth=N walks them. Cards are ordinary vector rows, so they work on Chroma and on HANA alike, and
/vector/query with scope=entity finds them by meaning.

WHO WRITES THEM. The assistant, at log-write time: the Stop rule asks it, when a turn's log names a
person, system or module with a role or relation, to POST /entities as well. KH holds no LLM, so
extraction is the writer's job; KH makes it idempotent and bounded.

WHO READS THEM. GET /entities/match?text=<the prompt> finds cards whose name or alias appears in
the text, by folded literal match like /orchestrator/project_match, and returns one line per card
(at most `limit`). A model learns who Elio is from ~200 characters instead of a log scroll.
"""
from __future__ import annotations

import json
import logging
import unicodedata
from datetime import datetime, timezone

from fastapi import HTTPException, Query, Request

from app import vector_store as vs

logger = logging.getLogger(__name__)

SCOPE = "entity"
KIND = "entity"
TYPES = ("person", "system", "module", "tool", "org", "rule", "other")
MAX_MATCH = 20
MAX_DEPTH = 2


def fold(text: str) -> str:
    """Lowercase, strip accents, every non-alphanumeric run to one space (as project_match does)."""
    n = unicodedata.normalize("NFD", text or "")
    n = "".join(ch for ch in n if not unicodedata.combining(ch))
    return " ".join("".join(ch if ch.isalnum() else " " for ch in n.lower()).split())


def entity_id(project: str, name: str) -> str:
    return f"ent__{project}__{fold(name).replace(' ', '-')}"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _collection(project: str, create: bool):
    name = vs.part_collection_name(SCOPE, project)
    if not create and name not in vs.existing_collection_names():
        return None
    return vs.get_or_create(name)


def _load(meta: dict, key: str) -> list:
    try:
        value = json.loads(meta.get(key) or "[]")
    except ValueError:
        return []
    return value if isinstance(value, list) else []


def card_of(hit: dict) -> dict:
    """A stored row as a card."""
    m = hit.get("metadata") or {}
    return {"id": hit.get("vector_id") or hit.get("core_id"), "project": m.get("project"),
            "name": m.get("name"), "type": m.get("entity_type"), "role": m.get("role", ""),
            "purpose": m.get("purpose", ""), "aliases": _load(m, "aliases_json"),
            "relations": _load(m, "relations_json"), "source_log_ids": _load(m, "sources_json"),
            "first_seen": m.get("first_seen"), "last_seen": m.get("last_seen")}


def line_of(card: dict) -> str:
    """One line per card: what a prompt gets injected."""
    rel = "; ".join(f"{r.get('rel')} {r.get('target')}" for r in card.get("relations", [])[:6])
    parts = [f"{card['name']} ({card.get('type') or 'entity'}, {card['project']})"]
    if card.get("role"):
        parts.append(f"role: {card['role']}")
    if card.get("purpose"):
        parts.append(f"purpose: {card['purpose']}")
    if rel:
        parts.append(f"relations: {rel}")
    return " - ".join(parts)


def _text_of(card: dict) -> str:
    """The stored text, which is also what gets embedded, so /vector/query finds cards by meaning."""
    aka = f" Also known as: {', '.join(card['aliases'])}." if card.get("aliases") else ""
    return f"ENTITY {line_of(card)}.{aka}"


def _merge_unique(old: list, new: list, key=lambda x: json.dumps(x, sort_keys=True)) -> list:
    seen = {key(x) for x in old}
    out = list(old)
    for x in new or []:
        if key(x) not in seen:
            seen.add(key(x))
            out.append(x)
    return out


def upsert(project: str, body: dict, encode) -> dict:
    """Create or update one card; lists merge, role/purpose/type are replaced when given."""
    name = (body.get("name") or "").strip()
    if not name or not fold(name):
        raise ValueError("name is required")
    etype = (body.get("type") or "other").strip().lower()
    if etype not in TYPES:
        raise ValueError(f"type must be one of {', '.join(TYPES)}")
    relations = []
    for r in body.get("relations") or []:
        if not isinstance(r, dict) or not (r.get("rel") and r.get("target")):
            raise ValueError("each relation needs rel and target")
        relations.append({"rel": str(r["rel"]).strip().lower(), "target": str(r["target"]).strip()})
    cid = entity_id(project, name)
    coll = _collection(project, create=True)
    got = vs.get_ids_vt([cid], collection=coll)
    old = card_of(got[0]) if got else {"aliases": [], "relations": [], "source_log_ids": [],
                                       "first_seen": _now(), "role": "", "purpose": ""}
    card = {
        "id": cid, "project": project, "name": old.get("name") or name, "type": etype,
        "role": (body.get("role") or old.get("role") or "").strip(),
        "purpose": (body.get("purpose") or old.get("purpose") or "").strip(),
        "aliases": _merge_unique(old["aliases"], [a.strip() for a in body.get("aliases") or [] if a.strip()],
                                 key=fold),
        "relations": _merge_unique(old["relations"], relations,
                                   key=lambda r: (r["rel"], fold(r["target"]))),
        "source_log_ids": _merge_unique(old["source_log_ids"], list(body.get("source_log_ids") or []),
                                        key=str)[-50:],
        "first_seen": old.get("first_seen") or _now(), "last_seen": _now(),
    }
    text = _text_of(card)
    meta = {"scope": SCOPE, "knowledge_type": "quick", "kind": KIND, "project": project,
            "name": card["name"], "entity_type": card["type"], "role": card["role"],
            "purpose": card["purpose"], "aliases_json": json.dumps(card["aliases"]),
            "relations_json": json.dumps(card["relations"]), "sources_json": json.dumps(card["source_log_ids"]),
            "first_seen": card["first_seen"], "last_seen": card["last_seen"]}
    vs.upsert_vt(cid, encode(text), text, meta, coll)
    return {**card, "updated": bool(got)}


def cards(projects: list[str]) -> list[dict]:
    """Every card of these projects (metadata reads only; never creates a collection)."""
    out = []
    for pid in projects:
        coll = _collection(pid, create=False)
        if coll is None:
            continue
        out.extend(card_of(h) for h in vs.scroll_vt({"kind": {"$eq": KIND}}, 100000, 0, collection=coll)["hits"])
    return out


def match(text: str, projects: list[str], limit: int = 8) -> list[dict]:
    """Cards whose name or an alias appears in ``text`` as whole folded words, longest first."""
    hay = f" {fold(text)} "
    found = []
    for card in cards(projects):
        terms = [card["name"], *card.get("aliases", [])]
        hit = max((len(fold(t)) for t in terms if fold(t) and f" {fold(t)} " in hay), default=0)
        if hit:
            found.append((hit, card))
    found.sort(key=lambda x: (-x[0], x[1]["name"] or ""))
    return [c for _, c in found[:limit]]


def neighbourhood(project: str, name: str, depth: int) -> dict:
    """A card and the cards its relations reach, up to ``depth`` hops, inside one project."""
    by_name = {fold(c["name"]): c for c in cards([project])}
    for c in list(by_name.values()):
        for a in c.get("aliases", []):
            by_name.setdefault(fold(a), c)
    start = by_name.get(fold(name))
    if start is None:
        return {}
    seen, frontier, linked = {start["id"]}, [start], []
    for _ in range(max(0, min(depth, MAX_DEPTH))):
        nxt = []
        for c in frontier:
            for r in c.get("relations", []):
                t = by_name.get(fold(r["target"]))
                if t and t["id"] not in seen:
                    seen.add(t["id"])
                    linked.append(t)
                    nxt.append(t)
        frontier = nxt
    return {"entity": start, "linked": linked}


def attach(app) -> None:
    from app import auth

    TAG = ["Entities"]

    @app.post("/entities", tags=TAG, summary="Create or update an entity card (idempotent by project + name)")
    async def entities_upsert(body: dict, request: Request) -> dict:
        project = (body.get("project") or "").strip()
        if not project:
            raise HTTPException(400, "project is required")
        model = request.app.state.model
        try:
            return upsert(project, body, lambda t: model.encode(t, normalize_embeddings=True).tolist())
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/entities/match", tags=TAG, summary="Entity cards named in a text - one line each, bounded")
    async def entities_match(text: str, project: str | None = None, limit: int = Query(8, ge=1, le=MAX_MATCH)) -> dict:
        from app.projects import list_projects
        visible = auth.visible_projects("project.read")
        if project:
            if visible is not None and project not in visible:
                raise HTTPException(403, "missing permission project.read on this project")
            scope_ids = [project]
        else:
            scope_ids = [p for p in list_projects() if visible is None or p in visible]
        found = match(text, scope_ids, limit)
        return {"count": len(found), "lines": [line_of(c) for c in found], "cards": found}

    @app.get("/entities/{project}/{name}", tags=TAG, summary="One entity card and the cards its relations reach")
    async def entities_get(project: str, name: str, depth: int = Query(1, ge=0, le=MAX_DEPTH)) -> dict:
        got = neighbourhood(project, name, depth)
        if not got:
            raise HTTPException(404, f"no entity '{name}' in project '{project}'")
        return {**got, "lines": [line_of(got["entity"])] + [line_of(c) for c in got["linked"]]}

    logger.info("Entity routes attached (/entities, /entities/match, /entities/{project}/{name})")
