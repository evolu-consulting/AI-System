"""Revisions/changelog API (additive) — supersede-with-history for corrected facts.

Model: every fact about a `subject` is stored as a normal knowledge vector chunk with
revision metadata. A correction never overwrites — it appends a new chunk marked
current and flips the prior current chunk(s) to superseded (kept + back-linked). So:
  * a vague semantic query still surfaces the OLD value (it is never deleted), labelled
    rev_current="0" so the caller can show it as "(superseded)";
  * GET the ordered change history for a subject via /knowledge/history.

Reuses app.vector_store (v5 substrate). Nothing existing is modified.
"""
from __future__ import annotations

import hashlib
import logging

from fastapi import HTTPException, Request

from app import vector_store

logger = logging.getLogger(__name__)


def _rev_collection(project):
    """Revisions live in the project's own knowledge collection (per-project history)."""
    return vector_store.scope_collection("knowledge", project)


def _rev_id(subject: str, text: str, ts: str) -> str:
    h = hashlib.sha1(f"{subject}\x1f{text}\x1f{ts}".encode("utf-8")).hexdigest()[:12]
    return f"rev_{subject}_{h}"


def _current_where(subject: str) -> dict:
    return {"$and": [{"revsubject": {"$eq": subject}}, {"rev_current": {"$eq": "1"}}]}


def attach(app) -> None:
    TAG = ["Revisions · changelog"]

    def _encode(request: Request, text: str):
        model = request.app.state.model
        return model.encode(text, normalize_embeddings=True).tolist()

    @app.post("/knowledge/revise", tags=TAG,
              summary="Append a corrected fact and supersede (keep+link) the prior one — history preserved")
    async def revise(body: dict, request: Request):
        subject = (body.get("subject") or "").strip()
        text = (body.get("text") or "").strip()
        if not subject or not text:
            raise HTTPException(400, "subject and text required")
        scope = body.get("scope", "knowledge")
        ts = body.get("ts", "")
        author = body.get("author", "user")
        coll = _rev_collection(body.get("project"))

        new_id = _rev_id(subject, text, ts or text)
        # flip prior current revisions -> superseded (re-embed same text, keep the chunk)
        prior = vector_store.get_vt(where=_current_where(subject), collection=coll)
        superseded = []
        for rec in prior:
            if rec["core_id"] == new_id:
                continue
            meta = dict(rec.get("metadata") or {})
            # keep knowledge_type=quick so the superseded value stays retrievable via
            # /vector/query (that path filters to quick-knowledge entries only).
            meta.update({"rev_current": "0", "superseded_by": new_id, "knowledge_type": "quick"})
            vector_store.upsert_vt(rec["core_id"], _encode(request, rec["source_text"]),
                                   source_text=rec["source_text"], metadata=meta, collection=coll)
            superseded.append(rec["core_id"])

        vector_store.upsert_vt(new_id, _encode(request, text), source_text=text, metadata={
            "scope": scope, "knowledge_type": "quick", "rev": "1", "revsubject": subject,
            "rev_ts": ts, "author": author, "rev_current": "1", "superseded_by": "",
        }, collection=coll)
        chain = vector_store.get_vt(where={"revsubject": {"$eq": subject}}, collection=coll)
        return {"subject": subject, "revision_id": new_id,
                "superseded": superseded, "chain_len": len(chain)}

    @app.post("/knowledge/history", tags=TAG,
              summary="Return the full revision chain for a subject (current + superseded), newest first")
    async def history(body: dict, request: Request):
        subject = (body.get("subject") or "").strip()
        if not subject:
            raise HTTPException(400, "subject required")
        recs = vector_store.get_vt(where={"revsubject": {"$eq": subject}}, collection=_rev_collection(body.get("project")))
        revs = [{
            "revision_id": r["core_id"],
            "text": r["source_text"],
            "ts": (r.get("metadata") or {}).get("rev_ts", ""),
            "current": (r.get("metadata") or {}).get("rev_current") == "1",
            "superseded_by": (r.get("metadata") or {}).get("superseded_by", ""),
            "author": (r.get("metadata") or {}).get("author", ""),
        } for r in recs]
        revs.sort(key=lambda x: (x["current"], x["ts"]), reverse=True)  # current first, then newest ts
        current = next((r["text"] for r in revs if r["current"]), "")
        return {"subject": subject, "count": len(revs), "current": current, "revisions": revs}

    logger.info("Revisions/changelog routes attached (/knowledge/revise, /knowledge/history)")
