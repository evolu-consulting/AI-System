"""Tagged kernel (fen 2026-10-29): a tag vocabulary, kernel rules per tier, and one merged render.

    GET  /kernel/tags[?facet=]              the vocabulary (active tags)
    GET  /kernel/tags/suggest?text=          tags for a text, best first (POST with {text} for long ones)
    POST /kernel/tags/propose {tag, facet, description, aliases}   a new tag, status proposed
    POST /kernel/tags/approve {tag[, status]}                      maintainers
    GET  /kernel/rules?tier=                 one tier's rules (common, a project, your personal project)
    POST /kernel/rules/check {tier, title, content, tags, overrides?, distinct_from?, reason?, guard?}   dry run
    POST /kernel/rules/add   same body       writes, under the contract of app/kernel/rules.py
    POST /kernel/rules/delete {id}
    GET  /kernel/resolved[?project=]         who won each slot, for people checking the merge
    GET  /kernel/render[?project=&part=&max_chars=&legacy=]   text/plain, the merged kernel for a hook
    POST /kernel/seed                        maintainers: load the seed vocabulary and common rules

Additive: /hooks/raw?hook_type=SessionStart keeps serving the one-row kernel until a helper switches.
"""
from __future__ import annotations

import asyncio
import logging
import os

from fastapi import HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from app.kernel import rules as R
from app.kernel import tags as T
from app.policy_actions import lint

logger = logging.getLogger(__name__)

RULES_SEED = os.path.join(os.path.dirname(T.SEED), "kernel_rules.seed.json")
PART_MAX = int(os.getenv("KH_KERNEL_PART_MAX", "9000"))      # Claude Code caps one hook's output at 10k chars


def _who():
    from app import auth
    return auth.current()


def _by() -> str:
    p = _who()
    return p.email if p is not None else "local"


def _personal_tier(requested: str | None) -> str | None:
    """The caller's own personal tier; with sign-in off (local trial) the one named, if any."""
    from app import personal
    p = _who()
    if p is None or p.is_maintainer:
        return requested if requested and personal.is_personal(requested) else (
            p.personal_project if p is not None else None)
    return p.personal_project


def _may(tier: str, write: bool) -> bool:
    from app import personal
    p = _who()
    if p is None:
        return True
    if tier == R.COMMON:
        return p.is_maintainer or not write
    if personal.is_personal(tier):
        return tier == p.personal_project or p.is_maintainer
    return p.can(tier, "project.write" if write else "project.read")


def _session_project() -> str | None:
    """The project the calling session (X-KH-Actor) is bound to, if any."""
    from app import auth, session_project
    p = _who()
    if p is None or not p.personal_project:
        return None
    try:
        bound = session_project.get(p.personal_project, auth.current_actor())
    except Exception:  # noqa: BLE001 - a guard lookup must never fail on the binding table
        return None
    return bound["project"] if bound else None


def guards_for(tool: str, project: str | None = None) -> list[dict]:
    """The caller's kernel guards for one tool: common < project < personal, resolved like the render."""
    project = project or _session_project()
    project = project if project and _may(project, write=False) else None
    return R.guards(tool, project, _personal_tier(None))


def _refused(e: R.RuleRefused) -> JSONResponse:
    return JSONResponse(status_code=e.status, content=e.body())


def attach(app) -> None:
    TAG = ["Kernel · tagged"]
    try:
        T.init()
        R.init()
    except Exception:  # noqa: BLE001 - a table KH cannot create must not keep the whole app from starting
        logger.exception("tagged kernel tables could not be created; /kernel routes will fail until fixed")

    @app.get("/kernel/tags", tags=TAG, summary="The kernel tag vocabulary (active tags, by facet)")
    def kernel_tags(facet: str | None = Query(None), status: str = Query("active")):
        rows = [r for r in T.all_tags((status,)) if not facet or r["facet"] == facet]
        return {"count": len(rows), "facets": sorted({r["facet"] for r in rows}), "tags": rows}

    @app.get("/kernel/tags/suggest", tags=TAG, summary="Tags for a text, best first")
    def kernel_tags_suggest(text: str = Query(..., min_length=2, max_length=4000), limit: int = Query(15, le=50)):
        return {"tags": T.suggest(text, limit=limit)}

    @app.post("/kernel/tags/suggest", tags=TAG, summary="Tags for a long text, best first")
    def kernel_tags_suggest_post(body: dict):
        return {"tags": T.suggest(str(body.get("text") or ""), limit=int(body.get("limit") or 15))}

    @app.post("/kernel/tags/propose", tags=TAG, summary="Propose a new tag (live after a maintainer approves)")
    def kernel_tags_propose(body: dict):
        try:
            return T.propose(body.get("tag", ""), body.get("facet", ""), body.get("description", ""),
                             body.get("aliases") or [], _by())
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.post("/kernel/tags/approve", tags=TAG, summary="Approve, propose again or retire a tag (maintainers)")
    def kernel_tags_approve(body: dict):
        try:
            n = T.set_status(str(body.get("tag") or ""), str(body.get("status") or "active"))
        except ValueError as e:
            raise HTTPException(422, str(e))
        if not n:
            raise HTTPException(404, "no such tag")
        return {"tag": body.get("tag"), "status": body.get("status") or "active"}

    @app.get("/kernel/rules", tags=TAG, summary="One tier's kernel rules")
    def kernel_rules(tier: str = Query(R.COMMON), all: bool = Query(False)):   # noqa: A002
        tier = _personal_tier(tier) if tier == "personal" else tier
        if not tier or not _may(tier, write=False):
            raise HTTPException(403, "you may not read that tier")
        rows = R.rules(tier, enabled_only=not all)
        return {"tier": tier, "count": len(rows), "rules": rows}

    def _tier_of(body: dict) -> dict:
        tier = (body.get("tier") or "").strip()
        if tier == "personal":
            tier = _personal_tier(None) or ""
            if not tier:
                raise HTTPException(400, "sign-in is off: name the personal tier, e.g. personal-jane-doe-example-com")
        if tier and not _may(tier, write=True):
            raise HTTPException(403, f"you may not write kernel rules of tier {tier!r}")
        return {**body, "tier": tier}

    @app.post("/kernel/rules/check", tags=TAG, summary="Dry run of /kernel/rules/add: the row, or why it is refused")
    def kernel_rules_check(body: dict):
        try:
            return {"ok": True, "would_store": R.check(_tier_of(body), _by())}
        except R.RuleRefused as e:
            return _refused(e)

    @app.post("/kernel/rules/add", tags=TAG, summary="Add or replace a kernel rule (tags required, see the contract)")
    def kernel_rules_add(body: dict):
        try:
            return R.add(_tier_of(body), _by())
        except R.RuleRefused as e:
            return _refused(e)

    @app.post("/kernel/rules/delete", tags=TAG, summary="Delete a kernel rule by id")
    def kernel_rules_delete(body: dict):
        row = R.get(str(body.get("id") or ""))
        if row is None:
            raise HTTPException(404, "no such rule")
        if not _may(row["tier"], write=True):
            raise HTTPException(403, "you may not delete that rule")
        return {"deleted": R.delete(row["id"])}

    def _project(project: str | None) -> str | None:
        return project if project and _may(project, write=False) else None

    @app.get("/kernel/resolved", tags=TAG, summary="Per slot, which tier's rule won")
    def kernel_resolved(project: str | None = Query(None), personal: str | None = Query(None)):
        out = R.resolve(_project(project), _personal_tier(personal))
        return {"count": len(out), "slots": [{k: v for k, v in e.items() if k != "order"} for e in out]}

    @app.get("/kernel/render", response_class=PlainTextResponse, tags=TAG,
             summary="The merged kernel (common + project + personal, resolved by tags) as text/plain")
    async def kernel_render(request: Request, project: str | None = Query(None),
                            personal: str | None = Query(None), part: int = Query(0, ge=0),
                            max_chars: int = Query(PART_MAX, ge=500, le=200000), legacy: bool = Query(True)):
        from app import personalization
        legacy_rows = (await asyncio.to_thread(personalization.own_rows) or []) if legacy else []
        if R.rules(R.COMMON):
            blocks = await asyncio.to_thread(R.render, _project(project), _personal_tier(personal), legacy_rows)
        else:
            # Not seeded yet: the one-row kernel and the personalization, as the two old hooks served them.
            from app.hooks import store as hook_store
            from app.policy_actions import lint
            blocks = [b for b in (lint.render(hook_store.get_text("SessionStart")),) if b]
            if legacy_rows:
                blocks.append(personalization._HEADER + "\n" + "\n".join("- " + t for t in legacy_rows))
        chunks = R.parts(blocks, max_chars) if part else ["\n\n".join(blocks)]
        text = chunks[part - 1] if part and part <= len(chunks) else ("" if part else chunks[0])
        return PlainTextResponse(text, headers={"X-KH-Kernel-Parts": str(len(R.parts(blocks, max_chars)))})

    @app.get("/kernel/pretool", response_class=PlainTextResponse, tags=TAG,
             summary="The write check for helpers that have the task tools (falls back to the PreToolUse hook)")
    def kernel_pretool():
        # A helper older than the task tools keeps reading hook_type=PreToolUse, which still teaches kh_call;
        # only a helper that has kh_save/kh_log reads this, so neither kind is told about tools it lacks.
        from app.hooks import store as hook_store
        return lint.render(hook_store.get_text("PreToolUseTools") or hook_store.get_text("PreToolUse"))

    @app.post("/kernel/seed", tags=TAG, summary="Load the seed vocabulary and common kernel rules (maintainers)")
    def kernel_seed():
        import json
        from app.hooks import store as hook_store
        # Hook texts that teach what the helper's task tools now do (the PreToolUse write check) change with it.
        with open(RULES_SEED, encoding="utf-8") as f:
            hooks = json.load(f).get("hooks") or []
        hook_store.init()
        for h in hooks:
            hook_store.set_rule(h["hook_type"], h["content"], name=h["name"], position=int(h.get("position", 0)))
        return {"tags": T.seed(by=_by()), "rules": R.seed(RULES_SEED, by=_by()),
                "hooks": [f"{h['hook_type']}/{h['name']}" for h in hooks]}

    logger.info("Tagged kernel routes attached (/kernel/tags|rules|render|resolved)")
