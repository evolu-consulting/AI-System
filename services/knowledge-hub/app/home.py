"""The maintainer page /home beyond sync: Knowledge and Lesson learn tabs (fen 2026-10-13).

KNOWLEDGE. Every project with the parts (scopes) it holds and their row counts, like the project cards of
RITA's home. A part opens its rows newest first, a page at a time; a row or a whole part can be deleted,
and so can a project's graph (to free disk). The people of a project and their levels are read and changed
at the identity service with the maintainer's own token (sync._identity), as everywhere else in KH.

LESSON LEARN. A project's lessons are the distilled items of kind 'lesson' in its knowledge part
(app/distill.py); a lesson added here is such an item, active at once. Proposed items wait for approval.
The learn-back process that distils worklogs and findings into lessons is app/learnback.py.

Every route here is for maintainers only (app/auth_rules.json).
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import HTTPException, Request

from . import config

logger = logging.getLogger(__name__)

PARTS = ("knowledge", "log", "findings", "entity", "chunk", "policy", "src")
GRAPH = "graph"
SORT_LIMIT = 20000          # a part bigger than this is paged in store order (sorting it would load it all)
PAGE_MAX = 500


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _graph_info(pid: str) -> Dict[str, Any]:
    from .graph_db import project_graph
    if project_graph._on_hana():
        return {"exists": True, "bytes": None, "where": "hana"}
    path = os.path.join(config.KUZU_PROJECTS_PATH, pid)
    if not os.path.isdir(path):
        return {"exists": False, "bytes": 0, "where": "kuzu"}
    size = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                size += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return {"exists": True, "bytes": size, "where": "kuzu"}


def projects() -> List[Dict[str, Any]]:
    """Every project (personal ones too: a maintainer may need to clean one) with its parts' counts."""
    from . import project_access, sync
    from .personal import is_personal
    from .projects import list_projects
    out = []
    for pid, e in sorted(list_projects().items()):
        counts = {p: sync.part_count(p, pid) for p in PARTS}
        counts["log"] += sync.part_count("hotlog", pid)
        out.append({"id": pid, "role": e.get("role", "project"), "descriptor": e.get("descriptor", ""),
                    "aliases": e.get("aliases") or [], "personal": is_personal(pid),
                    "visibility": project_access.visibility_of(pid), "counts": counts, "graph": _graph_info(pid)})
    return out


def _colls(project: str, part: str):
    """(collection, where) pairs holding one part; 'log' is the project's log plus its hot-window rows."""
    from . import sync
    pairs = []
    c = sync.part_collection(part, project)
    if c is not None:
        pairs.append((c, None))
    if part == "log":
        h = sync.part_collection("hotlog", project)
        if h is not None:
            pairs.append((h, sync._hot_where(project)))
    return pairs


def _row(i: str, doc: str, meta: dict, part: str) -> Dict[str, Any]:
    from .sync import row_time
    keep = {k: meta.get(k) for k in ("kind", "topic", "subject", "status", "author", "title", "scope", "category",
                                     "action", "context") if meta.get(k) not in (None, "")}
    return {"id": i, "time": row_time(meta), "text": (doc or "")[:600], "length": len(doc or ""), "meta": keep,
            "part": part}


def items(project: str, part: str, offset: int = 0, limit: int = 10) -> Dict[str, Any]:
    if part not in PARTS:
        raise HTTPException(422, "part must be one of %s" % list(PARTS))
    limit = max(1, min(int(limit), PAGE_MAX)) if limit else 0          # 0: every row left (Show all)
    offset = max(0, int(offset))
    pairs = _colls(project, part)
    total = 0
    for c, where in pairs:
        total += len(c.get(where=where, include=[]).get("ids") or []) if where else int(c.count() or 0)
    if total > SORT_LIMIT:
        # Too big to sort in memory: page in store order (the page says so).
        c, where = pairs[0]
        got = c.get(include=["metadatas", "documents"], limit=limit or PAGE_MAX, offset=offset)
        rows = [_row(i, d, m or {}, part) for i, d, m in zip(got["ids"], got.get("documents") or [],
                                                              got.get("metadatas") or [])]
        return {"project": project, "part": part, "total": total, "offset": offset, "rows": rows, "sorted": False}
    rows = []
    for c, where in pairs:
        kw: Dict[str, Any] = {"include": ["metadatas", "documents"]}
        if where:
            kw["where"] = where
        got = c.get(**kw)
        for n, i in enumerate(got.get("ids") or []):
            docs, metas = got.get("documents") or [], got.get("metadatas") or []
            rows.append(_row(i, docs[n] if n < len(docs) else "", (metas[n] if n < len(metas) else None) or {}, part))
    rows.sort(key=lambda r: r["time"] or "", reverse=True)
    return {"project": project, "part": part, "total": len(rows), "offset": offset,
            "rows": rows[offset:offset + limit] if limit else rows[offset:], "sorted": True}


def delete_rows(project: str, part: str, ids: List[str]) -> Dict[str, Any]:
    from . import chunks
    if part not in PARTS or not ids:
        raise HTTPException(422, "part and ids are required")
    gone = 0
    for c, _where in _colls(project, part):
        found = c.get(ids=list(ids), include=[]).get("ids") or []
        if found:
            c.delete(ids=found)
            gone += len(found)
    if part != "chunk":
        chunks.delete_for(list(ids))
    logger.info("home - %s deleted %d row(s) of %s/%s", _caller(), gone, project, part)
    return {"project": project, "part": part, "deleted": gone}


def delete_part(project: str, part: str, confirm: str) -> Dict[str, Any]:
    """Drop a whole part of a project, or its graph. confirm must repeat the project id."""
    from . import sync
    from . import vector_store as vs
    if confirm != project:
        raise HTTPException(400, "type the project id to confirm")
    if part == GRAPH:
        from .graph_db import project_graph
        from .projects import ORCHESTRATOR_ID
        if project == ORCHESTRATOR_ID:
            raise HTTPException(403, "the orchestrator's graph is shared and cannot be dropped here")
        dropped = project_graph.drop_project_graph(project)
        logger.warning("home - %s dropped the graph of %s (%s)", _caller(), project, dropped)
        return {"project": project, "part": part, "dropped": dropped}
    if part not in PARTS:
        raise HTTPException(422, "part must be one of %s or graph" % list(PARTS))
    removed = 0
    c = sync.part_collection(part, project)
    if c is not None:
        removed += int(c.count() or 0)
        vs.drop_collection(c.name)
    if part == "log":
        h = sync.part_collection("hotlog", project)
        if h is not None:
            ids = h.get(where=sync._hot_where(project), include=[]).get("ids") or []
            if ids:
                h.delete(ids=ids)
                removed += len(ids)
    logger.warning("home - %s dropped %s/%s (%d rows)", _caller(), project, part, removed)
    return {"project": project, "part": part, "removed": removed}


# ── people ───────────────────────────────────────────────────────────────────

def _caller() -> str:
    from . import auth
    p = auth.current()
    return p.email if p is not None else "local"


def _id_answer(st: int, out: Any, ok=(200, 201, 204)) -> Any:
    if st in ok:
        return out if out is not None else {"ok": True}
    err = out.get("error") or out.get("detail") if isinstance(out, dict) else out
    raise HTTPException(st if st in (400, 403, 404, 409) else 502, err or "identity service answered %s" % st)


def members(project: str) -> Dict[str, Any]:
    from . import sync
    st, out = sync._identity("GET", "projects/%s/members" % quote(project, safe=""))
    if st == 0:
        return {"project": project, "members": [], "note": (out or {}).get("error")}
    rows = _id_answer(st, out)
    return {"project": project, "members": rows if isinstance(rows, list) else rows.get("members", []), "note": ""}


def set_member(project: str, email: str, level: str) -> Any:
    from . import sync
    return _id_answer(*sync._identity("PUT", "projects/%s/members/%s" % (quote(project, safe=""), quote(email, safe="")),
                                      {"level": level}))


def remove_member(project: str, email: str) -> Any:
    from . import sync
    return _id_answer(*sync._identity("DELETE", "projects/%s/members/%s" % (quote(project, safe=""),
                                                                        quote(email, safe=""))))


# ── lessons ──────────────────────────────────────────────────────────────────

def lessons(project: str) -> Dict[str, Any]:
    """Lessons of one project: distilled items of kind lesson (any status but withdrawn), plus older
    rows written by hand with kind lesson (the shared lesson-learned project holds those)."""
    from . import distill
    from . import vector_store as vs
    if vs.part_collection_name("knowledge", project) not in vs.existing_collection_names():
        return {"project": project, "lessons": []}
    hits = vs.scroll_vt({"kind": {"$eq": "lesson"}}, 100000, 0, collection=distill._coll(project))["hits"]
    out = []
    for h in hits:
        m = h.get("metadata") or {}
        if m.get("status") == "withdrawn":
            continue
        text = h.get("source_text") or ""
        out.append({"id": h.get("vector_id"), "title": m.get("title") or text.split("\n", 1)[0][:120],
                    "text": text[:1500], "status": m.get("status") or "active",
                    "category": m.get("category") or m.get("context") or "",
                    "time": m.get("last_confirmed") or m.get("ts") or m.get("first_seen") or "",
                    "by": m.get("distilled_by") or m.get("author") or ""})
    out.sort(key=lambda r: r["time"] or "", reverse=True)
    return {"project": project, "lessons": out}


def add_lesson(project: str, title: str, text: str, encode) -> Dict[str, Any]:
    from . import distill
    from . import vector_store as vs
    from .projects import get_project
    title, text = (title or "").strip(), (text or "").strip()
    if not get_project(project):
        raise HTTPException(404, "no project %s" % project)
    if not title or not text:
        raise HTTPException(400, "title and text are required")
    now = _now()
    vid = distill.ID_PREFIX + uuid.uuid4().hex[:12]
    body = f"{title}: {text}"
    meta = {"scope": "knowledge", "project": project, "topic": distill.TOPIC, "kind": "lesson", "status": "active",
            "knowledge_type": "quick", "title": title[:config.DISTILL_TITLE_CHARS], "action": "", "context": "",
            "entities_json": "[]", "sources_json": "[]", "evidence_count": 1, "first_seen": now,
            "last_confirmed": now, "distilled_by": "manual:" + _caller(), "distilled_at": now, "ts": now}
    vs.upsert_vt(vid, encode(body), body, meta, collection=vs.get_or_create(vs.part_collection_name("knowledge",
                                                                                                    project)))
    return {"id": vid, "project": project, "status": "active"}


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    import asyncio
    TAG = ["Home"]

    def encoder(request: Request):
        model = request.app.state.model
        return lambda t: model.encode(t, normalize_embeddings=True).tolist()

    @app.get("/home/projects", tags=TAG, summary="Every project with its parts and row counts (maintainers)")
    async def home_projects():
        return {"projects": await asyncio.to_thread(projects)}

    @app.get("/home/items", tags=TAG, summary="Rows of one part of a project, newest first")
    async def home_items(project: str, part: str, offset: int = 0, limit: int = 10):
        return await asyncio.to_thread(items, project, part, offset, limit)

    @app.post("/home/items/delete", tags=TAG, summary="Delete rows of one part of a project")
    async def home_items_delete(body: dict):
        return await asyncio.to_thread(delete_rows, str(body.get("project") or ""), str(body.get("part") or ""),
                                       [str(i) for i in body.get("ids") or []])

    @app.post("/home/parts/delete", tags=TAG, summary="Drop a whole part (or the graph) of a project")
    async def home_part_delete(body: dict):
        return await asyncio.to_thread(delete_part, str(body.get("project") or ""), str(body.get("part") or ""),
                                       str(body.get("confirm") or ""))

    @app.get("/home/members", tags=TAG, summary="People of a project and their levels")
    async def home_members(project: str):
        return await asyncio.to_thread(members, project)

    @app.put("/home/members", tags=TAG, summary="Add a person to a project or change their level")
    async def home_member_set(body: dict):
        return await asyncio.to_thread(set_member, str(body.get("project") or ""), str(body.get("email") or ""),
                                       str(body.get("level") or "readonly"))

    @app.post("/home/members/remove", tags=TAG, summary="Take a person off a project")
    async def home_member_remove(body: dict):
        return await asyncio.to_thread(remove_member, str(body.get("project") or ""), str(body.get("email") or ""))

    @app.get("/home/lessons", tags=TAG, summary="Lessons of one project")
    async def home_lessons(project: str):
        return await asyncio.to_thread(lessons, project)

    @app.post("/home/lessons", tags=TAG, summary="Add a lesson to a project (active at once)")
    async def home_lesson_add(body: dict, request: Request):
        return await asyncio.to_thread(add_lesson, str(body.get("project") or ""), str(body.get("title") or ""),
                                       str(body.get("text") or ""), encoder(request))

    @app.post("/home/lessons/decide", tags=TAG, summary="Approve or reject proposed lessons")
    async def home_lesson_decide(body: dict, request: Request):
        from . import distill
        project, ids = str(body.get("project") or ""), [str(i) for i in body.get("ids") or []]
        if body.get("decision") == "approve":
            return {"results": await asyncio.to_thread(distill.approve, project, ids, [], encoder(request))}
        return {"results": await asyncio.to_thread(distill.reject, project, ids, str(body.get("reason") or ""),
                                                   encoder(request))}

    @app.post("/home/personal/ensure", tags=TAG, summary="Create the personal project of each e-mail (backfill)")
    async def home_personal_ensure(body: dict, request: Request):
        from . import personal
        enc = encoder(request)
        done = []
        for email in [str(e).strip().lower() for e in body.get("emails") or [] if str(e).strip()]:
            await asyncio.to_thread(personal.touch, email, enc)
            done.append(personal.personal_id(email))
        return {"personal_projects": done}

    logger.info("Home routes attached (/home/projects, items, parts, members, lessons)")


__all__ = ["projects", "items", "delete_rows", "delete_part", "members", "lessons", "add_lesson", "attach"]
