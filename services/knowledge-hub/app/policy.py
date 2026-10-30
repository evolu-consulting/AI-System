"""Policy subsystem (B5, SA-2) — policy in its OWN physical vector collection.

Why this exists: v6.3 stored policy in the shared knowledge collection and pulled it
with a top-k cosine query (k=8). Among tens of thousands of knowledge vectors, the
governing policy sometimes fell OUTSIDE top-k and was silently missed — fatal, because
fen holds policy as ABSOLUTE. The fix is NOT "stuff every policy into context" (token
waste); it is a physically SEPARATE, small policy collection so intent-similarity ranks
each policy only against other policies. Relevant policy can no longer be crowded out,
and only the matching policy is injected.

Two tiers (fen):
  - per-project policy   → collection kh_policy_<project>   (project-specific)
  - orchestrator common  → collection kh_policy_orchestrator (cross-project, e.g. "no artifact")

Relationship to hooks.db: they run in PARALLEL, by design.
  - hooks.db = DETERMINISTIC kernel/hook rules fetched by EXACT hook-type key (never a
    vector miss) — the always-on contract (kernel, consult, code-scan gate).
  - this collection = SEMANTIC per-project/common policy matched by intent similarity.
A hook may point at a policy here; this module never bypasses hooks.db.

Retrieval returns an AUDIT: every policy that matched, their scores, and which one WINS
under precedence (per-project over common; higher explicit priority first).
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from . import config
from . import vector_store as vs
from .projects import assert_canonical_id, ORCHESTRATOR_ID, bundle_of

logger = logging.getLogger(__name__)

# Policy matching uses a STRICTER bar than ordinary retrieval. A policy is absolute:
# a false fire hijacks the turn (routing short-circuits to "obey policy"). bge-small has
# a HIGH similarity floor — measured live, unrelated intents score ~0.45-0.54 against a
# policy while a genuine match scores ~0.77. So the bar sits ABOVE that floor at 0.6:
# incidental matches are rejected, real ones (0.7+) still fire with margin.
POLICY_MATCH_THRESHOLD = 0.6


def _policy_collection_name(project_id: str) -> str:
    """kh_policy_<project>; orchestrator's is the common tier."""
    return bundle_of(assert_canonical_id(project_id)).policy_collection


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _embed_text(intent: str, tags: list[str]) -> str:
    """What we embed for a policy: its intent + tags (English at the edge)."""
    return " ".join([intent] + [t for t in (tags or []) if t]).strip()


# ---------------------------------------------------------------------------
# CRUD (write paths take a precomputed embedding — caller embeds via the model)
# ---------------------------------------------------------------------------

def add_policy(project_id: str, *, intent: str, body: str, embedding: list[float],
               priority: int = 0, tags: list[str] | None = None,
               policy_id: str | None = None) -> dict:
    """Upsert one policy into a project's (or the orchestrator's) policy collection."""
    pid = assert_canonical_id(project_id)
    scope = "common" if pid == ORCHESTRATOR_ID else "project"
    pol_id = policy_id or f"pol_{pid}_{uuid.uuid4().hex[:10]}"
    meta = {
        "policy_id": pol_id, "project": pid, "scope": scope,
        "intent": intent, "body": body, "priority": int(priority),
        "tags": ",".join(tags or []), "updated_at": _now(),
        "source_text": body,
    }
    coll = vs.get_or_create(_policy_collection_name(pid))
    coll.upsert(ids=[pol_id], embeddings=[embedding], metadatas=[meta], documents=[body])
    logger.info("policy add — %s (project=%s scope=%s priority=%d)", pol_id, pid, scope, priority)
    return meta


def get_policy(project_id: str, policy_id: str) -> dict | None:
    coll = vs.get_or_create(_policy_collection_name(project_id))
    r = coll.get(ids=[policy_id], include=["metadatas"])
    metas = r.get("metadatas") or []
    return metas[0] if metas else None


def list_policies(project_id: str) -> list[dict]:
    coll = vs.get_or_create(_policy_collection_name(project_id))
    r = coll.get(include=["metadatas"])
    return list(r.get("metadatas") or [])


def delete_policy(project_id: str, policy_id: str) -> bool:
    coll = vs.get_or_create(_policy_collection_name(project_id))
    try:
        coll.delete(ids=[policy_id])
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Match — intent similarity across the project tier + the common tier
# ---------------------------------------------------------------------------

def _query_coll(name: str, embedding: list[float], k: int, threshold: float) -> list[dict]:
    coll = vs.get_or_create(name)
    total = coll.count() or 0
    if total == 0:
        return []
    try:
        r = coll.query(query_embeddings=[embedding], n_results=min(k, total),
                       include=["distances", "metadatas", "documents"])
    except Exception as exc:
        # Chroma raises "Nothing found on disk" for a collection whose rows were all deleted
        # (its vector index is gone while count() still reads the metadata). One unreadable
        # policy pool must not fail the whole request: skip it, like the retriever's lanes do.
        logger.warning("policy match — collection %s unreadable, skipped: %s", name, exc)
        return []
    out = []
    for pid_, dist, meta, doc in zip(r["ids"][0], r["distances"][0], r["metadatas"][0], r["documents"][0]):
        score = round(1.0 - dist, 6)
        if score < threshold:
            continue
        m = dict(meta or {})
        m["score"] = score
        m["body"] = m.get("body") or doc or ""
        out.append(m)
    return out


def match_policies(intent_embedding: list[float], project_id: str | None = None,
                   k: int = 10, threshold: float | None = None) -> dict:
    """Return policies matching this intent, with precedence + a full audit.

    Pools are small (policy-only collections), so a relevant policy is never pushed
    out of top-k by unrelated knowledge — the core SA-2 guarantee. Precedence:
    per-project beats common; within a tier, higher priority then higher score.
    """
    thr = POLICY_MATCH_THRESHOLD if threshold is None else threshold
    matched: list[dict] = []

    if project_id:
        try:
            pid = assert_canonical_id(project_id)
            if pid != ORCHESTRATOR_ID:
                matched += _query_coll(_policy_collection_name(pid), intent_embedding, k, thr)
        except ValueError:
            pass
    # common tier always considered
    matched += _query_coll(_policy_collection_name(ORCHESTRATOR_ID), intent_embedding, k, thr)

    # Ranking is RELEVANCE-primary: a policy that barely matches must not win just
    # because it is per-project. Precedence (per-project over common) and explicit
    # priority are small BOOSTS on top of the similarity score, so they decide only
    # among policies that are genuinely comparable in relevance.
    def _effective(m: dict) -> float:
        score = float(m.get("score", 0.0))
        scope_boost = 0.03 if m.get("scope") == "project" else 0.0
        prio_boost = min(int(m.get("priority", 0)), 20) * 0.005
        return score + scope_boost + prio_boost

    for m in matched:
        m["effective"] = round(_effective(m), 6)
    matched.sort(key=lambda m: m["effective"], reverse=True)
    return {
        "winner": matched[0] if matched else None,
        "fired": matched,                     # audit: everything that matched + scores
        "count": len(matched),
        "threshold": thr,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def attach(app) -> None:
    TAG = ["Policy"]

    @app.post("/policy/add", tags=TAG, summary="Create/update a policy in its own collection (per-project or orchestrator common)")
    async def policy_add(body: dict, request: Request):
        project = (body.get("project") or ORCHESTRATOR_ID).strip()
        intent = (body.get("intent") or "").strip()
        text = (body.get("body") or "").strip()
        if not intent or not text:
            raise HTTPException(400, "intent and body required")
        tags = body.get("tags") or []
        try:
            model = request.app.state.model
            emb = await asyncio.to_thread(model.encode, _embed_text(intent, tags), normalize_embeddings=True)
            return add_policy(project, intent=intent, body=text, embedding=emb.tolist(),
                              priority=int(body.get("priority", 0)), tags=tags,
                              policy_id=body.get("policy_id"))
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/policy/list", tags=TAG, summary="List policies for a project (or orchestrator common)")
    async def policy_list(project: str = ORCHESTRATOR_ID):
        try:
            return {"project": project, "policies": list_policies(project)}
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.post("/policy/match", tags=TAG, summary="Match policies by intent similarity — precedence + audit (SA-2)")
    async def policy_match(body: dict, request: Request):
        intent = (body.get("intent") or body.get("query") or "").strip()
        if not intent:
            raise HTTPException(400, "intent required")
        project = body.get("project")
        model = request.app.state.model
        emb = await asyncio.to_thread(model.encode, intent, normalize_embeddings=True)
        return match_policies(emb.tolist(), project,
                              k=int(body.get("k", 10)), threshold=body.get("threshold"))

    @app.delete("/policy", tags=TAG, summary="Delete a policy by id")
    async def policy_delete(body: dict):
        project = (body.get("project") or ORCHESTRATOR_ID).strip()
        pol_id = (body.get("policy_id") or "").strip()
        if not pol_id:
            raise HTTPException(400, "policy_id required")
        return {"deleted": delete_policy(project, pol_id), "policy_id": pol_id}

    logger.info("Policy routes attached (/policy/add|list|match, DELETE /policy)")
