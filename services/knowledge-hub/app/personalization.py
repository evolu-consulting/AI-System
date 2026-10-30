"""Personalization render (additive) — return preformatted UTF-8 personalization
text for the SessionStart hook to inject verbatim.

Replaces the inline PowerShell loader that used to live in settings.json. That
loader stripped every non-ASCII char (``-replace '[^ -~]'``) to dodge Windows
PowerShell's OEM-codepage stdout mangling — which also destroyed Vietnamese
diacritics. By rendering the text server-side and letting the hook fetch it with
``curl`` (raw UTF-8 body, no PowerShell string handling), diacritics survive.
"""
from __future__ import annotations

import logging

import asyncio

from fastapi import Query, Request
from fastapi.responses import PlainTextResponse

from app.retriever import query_quick_knowledge

logger = logging.getLogger(__name__)

# Broad seed so the embedding recall pulls the full spread of preference entries.
_SEED = ("fen user preference rule communication style answer format verbosity tone "
         "design philosophy working directory tools scalability estimate")

_HEADER = ("KnowledgeHub PERSONALIZATION auto-loaded from KH scope=personalization "
           "(EDIT these preferences in KH, NOT in settings.json). FOLLOW them this session, "
           "especially any communication-style / verbosity rule (reply short, keyword-driven, "
           "no recap). This is the PERSONAL LAYER (kernel rule 10): on any overlap or conflict it wins over "
           "the kernel and the shared policies, except rule (0), a 403 and never typing a secret. Preferences:")

# Every row of the caller's own store is loaded (fen 2026-10-27: a preference cut by a top-k recall was a
# personal rule silently lost). Past this many characters the rest is ranked by the seed and cut.
_MAX_CHARS = 16000


def attach(app) -> None:
    TAG = ["Personalization"]

    @app.get("/personalization/render", response_class=PlainTextResponse, tags=TAG,
             summary="Preformatted UTF-8 personalization text for the SessionStart hook")
    async def personalization_render(request: Request, k: int = Query(40),
                                     seed: str | None = Query(None)):
        model = request.app.state.model
        from . import auth, personal
        p = auth.current()
        if p is not None and p.ns is None and p.email:
            # Session start: every person has their own personal project, entered in the registry
            # (the orchestrator is the shared registry; their logs and findings go here - fen 2026-10-13).
            await asyncio.to_thread(personal.touch, p.email,
                                    lambda t: model.encode(t, normalize_embeddings=True).tolist())
        lines = None if seed else await asyncio.to_thread(own_rows)
        if lines is None or sum(len(t) + 3 for t in lines) > _MAX_CHARS:
            try:
                hits = await query_quick_knowledge(seed or _SEED, k if lines is None else len(lines), model,
                                                   scope="personalization")
            except Exception as exc:
                logger.warning("personalization render query failed: %s", exc)
                return _HEADER + "\n(personalization query failed: " + str(exc) + ")"
            ranked, used = [], 0
            for h in hits:
                t = " ".join((h.get("source_text") or "").split())
                if t and (lines is None or used + len(t) + 3 <= _MAX_CHARS):
                    ranked.append(t)
                    used += len(t) + 3
            lines = ranked
        lines = ["- " + t for t in lines]
        if not lines:
            return _HEADER + "\n(no personalization entries found)"
        return _HEADER + "\n" + "\n".join(lines)

    @app.get("/personalization/guards", tags=TAG,
             summary="The caller's tool guards: kernel and personalization rules the PreToolUse hook enforces")
    async def personalization_guards(tool: str = Query(..., min_length=1, max_length=120),
                                     project: str | None = Query(None)):
        return {"tool": tool, "guards": await asyncio.to_thread(all_guards, tool, project)}

    logger.info("Personalization routes attached (/personalization/render, /personalization/guards)")


# ── tool guards ──────────────────────────────────────────────────────────────
# A rule the model keeps forgetting (it sits in a long session-start text, or a tool's own instructions say
# the opposite) is enforced where it bites: right before the tool runs. A tagged kernel rule with a guard
# (app/kernel/rules.py) is a guard; so is, until it is tagged, a legacy personalization row with
# metadata guard_tool=<Claude Code tool name>. The KH helper's PreToolUse hook asks KH for the
# guards of the tool about to run and, when one matches, makes the CLI ask the person first
# (guard_decision "ask", the default) or refuses the call ("deny"), quoting the rule.
#   guard_when  optional JSON object {input field: [allowed values]}; the guard applies only when every named
#               field of the tool input has one of those values ("" stands for a missing field).
GUARD_DECISIONS = ("ask", "deny")


def all_guards(tool: str, project: str | None = None) -> list[dict]:
    """Kernel guards (resolved over the tiers) plus the legacy personalization guards still active."""
    from app import kernel
    try:
        tagged = kernel.guards_for(tool, project)
    except Exception as exc:  # noqa: BLE001 - the kernel table missing must not drop the legacy guards
        logger.warning("kernel guards for %s failed: %s", tool, exc)
        tagged = []
    return tagged + guards_for(tool)


def own_rows() -> list[str] | None:
    """Every active row of the caller's own personalization store, oldest first; None with sign-in off."""
    from app import personal, vector_store as vs
    own = personal.own_id()
    if not own:
        return None
    name = vs.part_collection_name("personalization", own)
    if name not in vs.existing_collection_names():
        return []
    got = vs.get_or_create(name).get(include=["metadatas", "documents"])
    rows = []
    for i, _ in enumerate(got.get("ids") or []):
        meta = (got.get("metadatas") or [{}])[i] or {}
        text = " ".join(((got.get("documents") or [""])[i] or "").split())
        if text and str(meta.get("status") or "active") == "active":
            rows.append((str(meta.get("ts") or meta.get("created_at") or ""), text))
    return [t for _, t in sorted(rows, key=lambda r: r[0])]


def guards_for(tool: str) -> list[dict]:
    """The caller's guards for one tool: their personal project's rows, or with sign-in off the common store."""
    import json

    from app import personal, vector_store as vs
    own = personal.own_id()
    if own:
        name = vs.part_collection_name("personalization", own)
        if name not in vs.existing_collection_names():
            return []
        where = {"guard_tool": {"$eq": tool}}
    else:
        from app.projects import ORCHESTRATOR_ID, bundle_of
        name = bundle_of(ORCHESTRATOR_ID, role="manage").knowledge_collection
        if name not in vs.existing_collection_names():
            return []
        where = {"$and": [{"scope": {"$eq": "personalization"}}, {"guard_tool": {"$eq": tool}}]}
    got = vs.get_or_create(name).get(where=where, include=["metadatas", "documents"])
    out = []
    for i, vid in enumerate(got.get("ids") or []):
        meta = (got.get("metadatas") or [{}])[i] or {}
        if str(meta.get("status") or "active") != "active":
            continue
        try:
            when = json.loads(meta.get("guard_when") or "{}")
        except ValueError:
            when = {}
        decision = str(meta.get("guard_decision") or "ask")
        out.append({"id": vid, "text": " ".join(((got.get("documents") or [""])[i] or "").split()),
                    "decision": decision if decision in GUARD_DECISIONS else "ask",
                    "when": when if isinstance(when, dict) else {}})
    return out
