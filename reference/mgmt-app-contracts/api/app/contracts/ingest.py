import logging

from app.contracts import extract as extract_mod   # module attribute, so tests can replace extract_contract
from app.companies import enrich
from app.contracts import link, store
from app.contracts.chunk import chunk_contract
from app.contracts.verify import verify, warnings_for
from app.ingest.embed import embed_texts
from app.ingest.parse import to_markdown
from app.models import Document
from app.query.similar import link_similar
from app.store import graph
from app.store import opensearch as os_store

log = logging.getLogger(__name__)


def run_contract_ingest(doc: Document, raw: bytes, filename: str | None = None) -> None:
    from app.ingest import pipeline   # RAW_CACHE lives there; imported late to avoid a cycle
    try:
        os_store.set_status(doc.id, "parsing")
        md = to_markdown(raw, filename or doc.source_id)
        parts = chunk_contract(md)
        os_store.set_status(doc.id, "embedding")
        vectors = embed_texts([p["text"] for p in parts])
        chunks = [{
            "id": f"{doc.id}:{i}", "doc_id": doc.id, "chunk_index": i, "text": p["text"], "embedding": v,
            "source_type": doc.source_type, "title": doc.title, "uri": doc.uri, "entities": [],
            "domain": "contract", "contract_id": doc.id, "clause_no": p["clause_no"], "heading": p["heading"],
        } for i, (p, v) in enumerate(zip(parts, vectors))]
        os_store.delete_chunks(doc.id)
        os_store.index_chunks(chunks)
        graph.upsert_document(doc, [{"id": c["id"], "index": c["chunk_index"], "entities": [], "relations": []}
                                    for c in chunks])
        own = store.get(doc.id) or {}
        family = {r["id"] for r in store.list_all() if r.get("parent_id") == doc.id}
        if own.get("parent_id"):
            family.add(own["parent_id"])
        link_similar(chunks, related=family)
        os_store.set_status(doc.id, "done", chunk_count=len(chunks))
        pipeline.RAW_CACHE.pop(doc.id, None)
    except Exception as e:  # noqa: BLE001 - status must be recorded whatever failed
        log.exception("contract ingest failed for %s", doc.id)
        os_store.set_status(doc.id, "failed", error=f"{type(e).__name__}: {e}"[:2000])
        rec = store.get(doc.id)
        if rec:
            rec.update(status="extract_failed", error=f"{type(e).__name__}: {e}"[:2000])
            store.save(rec)
        return
    rec = store.get(doc.id)
    if rec:
        rec["source_md"] = md
        rec["clauses"] = [{"chunk_id": c["id"], "number": c["clause_no"], "heading": c["heading"], "topic": "general"}
                          for c in chunks]
        store.save(rec)
        try:
            link.auto_link(doc.id, vectors)
        except Exception:  # noqa: BLE001 - a wrong guess is fixable on the page; a failed one must not stop extraction
            log.warning("auto-link failed for %s", doc.id, exc_info=True)
        run_extraction(doc.id, pdf=raw if (filename or doc.source_id).lower().endswith(".pdf") else None)


def merge_fields(old: dict, new: dict) -> dict:
    """New extraction wins except where a person already typed a value."""
    return {k: (old[k] if old.get(k, {}).get("edited") else v) for k, v in new.items()}


def run_extraction(contract_id: str, pdf: bytes | None = None) -> None:
    rec = store.get(contract_id)
    if not rec:
        return
    from app import usage
    with usage.actor(rec.get("org_id"), rec.get("created_by")), usage.feature("contracts.read_file"):
        _run_extraction(rec, contract_id, pdf)


def _run_extraction(rec: dict, contract_id: str, pdf: bytes | None) -> None:
    try:
        parent = store.get(rec["parent_id"]) if rec.get("parent_id") else None
        ex = extract_mod.extract_contract(rec["source_md"], parent=parent, pdf=pdf).model_dump(mode="json")
        if rec["kind"] == "contract":
            ex["effective_date"] = {"value": None, "quote": ""}   # an addendum-only field
        fields, items, _ = verify(ex, rec["source_md"])
        rec["draft"] = ex
        rec["fields"] = merge_fields(rec["fields"], fields)
        if not any(i.get("edited") for i in rec["items"]):
            rec["items"] = items
        topics = {c["number"]: c["topic"] for c in ex.get("clauses") or []}
        for c in rec["clauses"]:
            c["topic"] = topics.get(c["number"], c.get("topic") or "general")
        enrich.enrich(rec)
        rec["warnings"] = warnings_for(rec)
        rec.update(status="needs_review" if rec["status"] in ("extracting", "extract_failed") else rec["status"],
                   error=None)
    except Exception as e:  # noqa: BLE001
        log.exception("contract extraction failed for %s", contract_id)
        rec.update(status="extract_failed", error=f"{type(e).__name__}: {e}"[:2000])
    store.save(rec)
