"""Policy-first routing + project switch (B6, report §04).

The decision of whether to ANSWER or ROUTE no longer depends on whether fen named a
project, and never falls back to guessing a project by cosine (the dropped v6.3 Tier-3).
Instead every intent goes through ONE mechanism, like an agent orchestrator deciding to
act itself or dispatch to a specialist:

  1. POLICY first — is there a policy matching this intent? (app/policy.py, absolute
     in fen's personal scope). If yes: obey it. Done. A policy may itself say route or act.
  2. No policy → RESOLVE in the orchestrator's knowledge. Shortcuts and facts live here
     as entries tagged by `kind`:
        kind=route-shortcut  → carries a binding (project_id + collection + graph path);
                               the caller SWITCHES: session_source=P, later calls scope to P.
        kind=fact            → answer straight from the orchestrator.
     Miss → answer generally from the orchestrator common set. Never guess a project.

"Switch" is just returning the binding: once resolve yields session_source=P, the caller
passes source_id=P to /orchestrator/ask|hybrid|graph_traverse and P's policy/findings.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from . import vector_store as vs
from . import policy as kh_policy
from .projects import assert_canonical_id, bundle_of, get_project, ORCHESTRATOR_ID

logger = logging.getLogger(__name__)

# One physically-separate collection holds the orchestrator's resolvable entries
# (route-shortcuts + facts), so resolution ranks against routing entries only.
_RESOLVE_COLLECTION = "kh_orch_resolve"


def _coll():
    return vs.get_or_create(_RESOLVE_COLLECTION)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def binding_for(project_id: str) -> dict:
    """The physical binding a caller needs after switching to a project."""
    b = bundle_of(assert_canonical_id(project_id))
    return {
        "project_id": b.id,
        "vector": b.vector_collection,
        "knowledge": b.knowledge_collection,
        "graph": b.graph_dir,
        "policy": b.policy_collection,
        "findings": b.findings_collection,
        "log": b.log_collection,
    }


# ---------------------------------------------------------------------------
# Registration of resolvable entries
# ---------------------------------------------------------------------------

def add_shortcut(project_id: str, text: str, embedding: list[float],
                 shortcut_id: str | None = None) -> dict:
    """Register a route-shortcut: matching this text routes to `project_id`."""
    pid = assert_canonical_id(project_id)
    sid = shortcut_id or f"shortcut__{pid}"
    meta = {"kind": "route-shortcut", "project_id": pid, "source_text": text,
            "binding": ",".join(f"{k}={v}" for k, v in binding_for(pid).items()),
            "updated_at": _now()}
    _coll().upsert(ids=[sid], embeddings=[embedding], metadatas=[meta], documents=[text])
    logger.info("routing add_shortcut — %s -> %s", sid, pid)
    return meta


def add_fact(text: str, embedding: list[float], subject: str = "",
             fact_id: str | None = None) -> dict:
    """Register a fact the orchestrator can answer directly (no routing)."""
    fid = fact_id or f"fact__{subject or 'x'}__{abs(hash(text)) % 10_000_000}"
    meta = {"kind": "fact", "subject": subject, "source_text": text, "updated_at": _now()}
    _coll().upsert(ids=[fid], embeddings=[embedding], metadatas=[meta], documents=[text])
    return meta


# ---------------------------------------------------------------------------
# Resolve — policy first, then orchestrator knowledge
# ---------------------------------------------------------------------------

def _resolve_knowledge(embedding: list[float], k: int, threshold: float) -> list[dict]:
    coll = _coll()
    total = coll.count() or 0
    if total == 0:
        return []
    try:
        r = coll.query(query_embeddings=[embedding], n_results=min(k, total),
                       include=["distances", "metadatas", "documents"])
    except Exception as exc:
        logger.warning("resolve — orchestrator knowledge unreadable, answering with no candidates: %s", exc)
        return []
    out = []
    for hid, dist, meta, doc in zip(r["ids"][0], r["distances"][0], r["metadatas"][0], r["documents"][0]):
        score = round(1.0 - dist, 6)
        if score < threshold:
            continue
        m = dict(meta or {})
        m["score"] = score
        m["text"] = doc or m.get("source_text", "")
        out.append(m)
    return out


def _project_metadata(project_id: str) -> dict:
    """The metadata KH hands back so Claude can re-query the SAME endpoint scoped to a
    project: on the next call Claude attaches this and KH routes straight to the project."""
    if not project_id or project_id == ORCHESTRATOR_ID:
        return {"project": ORCHESTRATOR_ID}
    return {"project": project_id, "binding": binding_for(project_id)}


def resolve(intent_embedding: list[float], *, session_source: str | None,
            policy_result: dict, k: int = 5, threshold: float = 0.45,
            route_threshold: float = 0.55) -> dict:
    """Return the routing DECISION for an intent, ALWAYS carrying the applicable policy.

    Policy model (fen): orchestrator policy is GLOBAL — it applies to every project. So
    every response carries `policy.global` (orchestrator/common matches) which Claude must
    apply now. When KH detects a project it also returns `metadata` (the project id +
    binding); Claude re-queries the SAME endpoint with that metadata and KH routes straight
    to the project, at which point the PROJECT's own policy (`policy.project`) also applies
    — so a fully-scoped call ends up under TWO policy sets: global + project.

    A route-shortcut must clear the stricter `route_threshold` before we switch projects;
    a weak shortcut is ignored and we answer from the orchestrator (never guess a project).
    """
    fired = (policy_result or {}).get("fired", []) or []
    winner = (policy_result or {}).get("winner")
    # split the two tiers so the caller sees exactly which policies apply from where
    policy_block = {
        "global": [p for p in fired if p.get("scope") == "common"],   # orchestrator, all projects
        "project": [p for p in fired if p.get("scope") == "project"], # only when scoped to a project
        "winner": winner,
    }

    # 1) a policy that explicitly names a project/action is absolute — obey it, but still
    #    return the split policy block so the global tier travels with the decision.
    if winner and winner.get("project"):
        return {"decision": "policy", "policy": policy_block,
                "switch_to": winner["project"],
                "binding": binding_for(winner["project"]) if winner["project"] != ORCHESTRATOR_ID else None,
                "metadata": _project_metadata(winner["project"])}

    # 2) resolve in orchestrator knowledge — first decisive hit wins.
    hits = _resolve_knowledge(intent_embedding, k, threshold)
    for h in hits:
        kind = h.get("kind")
        if kind == "fact":
            return {"decision": "answer", "answer": h.get("text", ""),
                    "policy": policy_block, "matched": h, "candidates": hits}
        if kind == "route-shortcut" and h.get("project_id") \
                and float(h.get("score", 0.0)) >= route_threshold:
            pid = h["project_id"]
            return {"decision": "route", "switch_to": pid,
                    "binding": binding_for(pid), "metadata": _project_metadata(pid),
                    "policy": policy_block, "matched": h, "candidates": hits}

    # 3) miss → answer from orchestrator common; NEVER guess a project. Global policy still applies.
    return {"decision": "answer_common", "policy": policy_block, "candidates": hits}


def _visible_decision(decision: dict, allowed: set[str] | None) -> dict:
    """Strip every trace of projects the caller cannot read (D6). Unchanged when allowed is None."""
    if allowed is None:
        return decision
    allowed = allowed | {ORCHESTRATOR_ID}
    candidates = [h for h in decision.get("candidates") or []
                  if not h.get("project_id") or h["project_id"] in allowed]
    if decision.get("switch_to") and decision["switch_to"] not in allowed:
        return {"decision": "answer_common", "policy": decision.get("policy"),
                "candidates": candidates, "intent": decision.get("intent")}
    if "candidates" in decision:
        decision = {**decision, "candidates": candidates}
    return decision


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def attach(app) -> None:
    TAG = ["Orchestrator"]

    @app.post("/orchestrator/shortcut", tags=TAG, summary="Register a route-shortcut (intent → project) in the resolve collection")
    async def shortcut_add(body: dict, request: Request):
        project = (body.get("project_id") or body.get("project") or "").strip()
        text = (body.get("text") or "").strip()
        if not project or not text:
            raise HTTPException(400, "project_id and text required")
        try:
            model = request.app.state.model
            emb = await asyncio.to_thread(model.encode, text, normalize_embeddings=True)
            return add_shortcut(project, text, emb.tolist(), body.get("shortcut_id"))
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.post("/orchestrator/fact", tags=TAG, summary="Register a fact the orchestrator can answer directly")
    async def fact_add(body: dict, request: Request):
        text = (body.get("text") or "").strip()
        if not text:
            raise HTTPException(400, "text required")
        model = request.app.state.model
        emb = await asyncio.to_thread(model.encode, text, normalize_embeddings=True)
        return add_fact(text, emb.tolist(), body.get("subject", ""), body.get("fact_id"))

    @app.post("/orchestrator/resolve", tags=TAG,
              summary="Policy-first resolve: decide route vs answer (no cosine project-guess) — B6")
    async def resolve_route(body: dict, request: Request):
        intent = (body.get("query") or body.get("intent") or "").strip()
        if not intent:
            raise HTTPException(400, "query/intent required")
        session_source = body.get("session_source")
        from . import auth
        if session_source and not auth.may(session_source, "project.read"):
            raise HTTPException(403, "missing permission project.read on this project")
        k = int(body.get("k", 5))
        threshold = float(body.get("threshold", 0.45))
        route_threshold = float(body.get("route_threshold", 0.55))
        model = request.app.state.model
        emb = (await asyncio.to_thread(model.encode, intent, normalize_embeddings=True)).tolist()
        # Policy for ROUTING comes from the exact table (/policy/actions, /policy/plan); the
        # semantic policy match was retired for routing on 2026-08-21 because its false fires
        # overlap its true hits (0.826 on a work-log request). It stays reachable here only on
        # request, so an old caller that relied on the policy block can still ask for it.
        pol = kh_policy.match_policies(emb, session_source) if body.get("semantic_policy") else {}
        decision = resolve(emb, session_source=session_source, policy_result=pol,
                           k=k, threshold=threshold, route_threshold=route_threshold)
        decision["intent"] = intent
        return _visible_decision(decision, auth.visible_projects())

    @app.get("/orchestrator/switch/{project_id}", tags=TAG, summary="Get the physical binding to switch a session to a project")
    async def switch(project_id: str):
        if not get_project(project_id):
            raise HTTPException(404, f"no project '{project_id}'")
        try:
            return {"session_source": assert_canonical_id(project_id), "binding": binding_for(project_id)}
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    logger.info("Routing (policy-first) routes attached (/orchestrator/resolve|shortcut|fact|switch)")
