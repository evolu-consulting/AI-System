"""Orchestrator layer — hub/satellite routing over physically isolated sources.

Problem it solves: two codebases forked from a common source share identical
entity names with DIFFERENT meanings. Stored flat, a query retrieves the wrong
project's data. This layer gives each source its OWN vector collection and routes a
query to the right source.

v6.4 note (G12 fix): graph isolation is now genuinely PHYSICAL — each project has its
own Kùzu database directory (see app/graph_db/project_graph.py, B3). The legacy
``<source_id>__`` core_id prefix used below is retained for id continuity, but it is
no longer the isolation mechanism (it was only ever LOGICAL). Routing itself is now
policy-first (app/routing.py, B6): the old cosine tier-3 project-guess is dropped
(route() returns '3-defer' instead of guessing).

All endpoints here are additive; nothing changes existing /vector behaviour.
Manifest is a small JSON file (one entry per source) — the legacy router.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import unicodedata

from fastapi import HTTPException, Query, Request

from . import config
from . import docstore
from .graph_db import graph_db
from .graph_db.project_graph import get_project_graph
from . import vector_store as vs

logger = logging.getLogger(__name__)

_MANIFEST_PATH = os.path.join(os.path.dirname(config.CHROMA_PATH), "orch_manifest.json")
_manifest_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Normalisation — strip Vietnamese diacritics so match is script/accent proof
# ---------------------------------------------------------------------------

def normalize(s: str) -> str:
    """lowercase + đ→d + strip combining accents + collapse whitespace."""
    s = (s or "").lower().strip().replace("đ", "d")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.split())


# ---------------------------------------------------------------------------
# Manifest (the hub registry) — load/save
# ---------------------------------------------------------------------------

def _load() -> dict:
    try:
        man = docstore.read_json(_MANIFEST_PATH)
    except Exception:
        logger.exception("orchestrator — manifest load failed; starting empty")
        return {"sources": {}}
    return man if man is not None else {"sources": {}}


def _save(man: dict) -> None:
    docstore.write_json(_MANIFEST_PATH, man)


# ---------------------------------------------------------------------------
# The cascade router — deterministic, 0 LLM/embed on tiers 0–2
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Endpoint registration
# ---------------------------------------------------------------------------

def attach(app) -> None:
    TAG = ["Orchestrator"]

    # v6.3 legacy endpoints REMOVED in v6.4 (superseded): /source/register + /sources
    # + /source/{id} -> use /projects; /orchestrator/route + /orchestrator/ask -> use
    # /orchestrator/resolve then scoped /orchestrator/hybrid|graph_traverse; /orchestrator/
    # ingest -> per-project /codegraph/import + /vector/add.

    @app.get("/orchestrator/project_match", tags=TAG,
             summary="STEP 1 of a turn: which project is this intent about? (literal, no embedder)")
    async def orch_project_match(text: str = Query(..., description="the user's own words")):
        """Resolve an intent to a project by literal term match over the C4 project registry.

        fen's mechanism (2026-08-21): project identity is published into the orchestrator's C4
        tree at project init, and this reads it - id, aliases and keywords, folded and matched on
        word boundaries. No embedding, no threshold: a wrong project would pull the wrong
        project's policy, which is the failure mode the semantic route was retired for.

        best=None means NO project, which is a real answer - the caller then reads policy from
        the 'every project' tier alone. ambiguous=true means two projects matched equally well;
        the caller must ASK rather than pick.
        """
        from . import projects as kh_projects
        hits = kh_projects.match_projects(text)
        best = kh_projects.resolve_project_name(text)
        # WEAK-ONLY is a THIRD outcome, distinct from both 'no match' and 'ambiguous'.
        # Something matched, but only by a keyword too short to route on, so best is
        # None on purpose. The caller must NOT read this as a tie to ask fen about -
        # there is nothing to choose between. It means: treat as no project, and if you
        # know from context which project fen meant, offer to add his phrasing as an
        # ALIAS (POST /projects merges aliases in), which is how the matcher learns.
        weak_only = bool(hits) and all(m.get("weak") for m in hits)
        return {"text": text, "count": len(hits), "best": best,
                "ambiguous": bool(hits) and best is None and not weak_only,
                "weak_only": weak_only,
                "policy_project": best or "every project",
                "matches": hits}

    @app.post("/orchestrator/hybrid", tags=TAG,
              summary="Hybrid retrieval (vector + keyword lanes) for one source — Claude ranks the merged candidates (SA-4)")
    async def orch_hybrid(body: dict, request: Request):
        sid = (body.get("source_id") or "").strip()
        if not sid:
            raise HTTPException(400, "source_id required")
        q = body.get("query", "")
        k = int(body.get("k", 10))
        where = body.get("where")
        model = request.app.state.model
        qemb = await asyncio.to_thread(model.encode, q, normalize_embeddings=True)
        res = await asyncio.to_thread(vs.hybrid_src, sid, q, qemb.tolist(), k, where)
        # KH returns candidates from both lanes; the caller (Claude) does the final rank.
        return {"source_id": sid, "query": q, "judge": "claude", **res}

    @app.post("/orchestrator/graph_read", tags=TAG, summary="Read graph nodes for a source (per-project physical graph)")
    async def orch_graph_read(body: dict):
        sid = (body.get("source_id") or "").strip()
        core_ids = [f"{sid}__{c}" for c in body.get("core_ids", [])]
        try:
            # B3: open the project's OWN graph db — reads can't reach another project.
            g = get_project_graph(sid)
            nodes, edges = g.fetch_graph(core_ids, frozenset(), 1)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except Exception as exc:
            raise HTTPException(500, f"graph read error: {exc}")
        return {"source_id": sid, "nodes": nodes, "edges": edges}

    @app.post("/orchestrator/graph_traverse", tags=TAG,
              summary="Multi-hop LOGIC traversal within ONE source (never crosses source boundary)")
    async def orch_graph_traverse(body: dict):
        """
        Follow content/logic edges hop-by-hop from seed core_ids, staying inside
        the source's own namespace. This is the multi-hop 'trace a logic chain'
        primitive (field → rule → handler → ...) that fetch_graph does NOT do —
        fetch_graph only expands the containment hierarchy then reads 1 hop.

        Body: {
          source_id: str,
          core_ids: [unprefixed core_ids],        # seeds; prefixed with source_id internally
          relations: [labels] | null,             # whitelist; null = all except containment
          max_hops: int = 4,
          direction: 'out' | 'in' | 'both' = 'out',
          min_confidence: float = 0.0
        }
        Cross-source is intentionally impossible here — use a breadcrumb hop
        (switch source_id) to move to another source.
        """
        sid = (body.get("source_id") or "").strip()
        if not sid:
            raise HTTPException(400, "source_id required")
        seeds = [f"{sid}__{c}" for c in body.get("core_ids", [])]
        if not seeds:
            raise HTTPException(400, "core_ids required")
        relations = body.get("relations")
        max_hops = int(body.get("max_hops", 4))
        direction = (body.get("direction") or "out").lower()
        if direction not in ("out", "in", "both"):
            direction = "out"
        try:
            min_conf = float(body.get("min_confidence", 0.0))
        except (TypeError, ValueError):
            min_conf = 0.0
        try:
            # B3: traverse ONLY inside the project's own physical graph.
            g = get_project_graph(sid)
            nodes, edges = await asyncio.to_thread(
                g.traverse_logic,
                seeds, relations, max_hops, direction, f"{sid}__", None, min_conf,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except NotImplementedError:
            raise HTTPException(501, "logic traversal not supported by the active graph backend")
        except Exception as exc:
            raise HTTPException(500, f"graph traverse error: {exc}")
        return {
            "source_id": sid, "seeds": seeds, "direction": direction,
            "max_hops": max_hops, "nodes": nodes, "edges": edges,
        }


    logger.info("Orchestrator routes attached (manifest=%s)", _MANIFEST_PATH)
