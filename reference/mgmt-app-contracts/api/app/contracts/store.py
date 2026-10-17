import copy
from datetime import datetime, timezone

from app.contracts.fields import FIELD_KINDS
from app.models import Document
from app.store import opensearch as os_store
from app.store import request_cache


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_record(doc: Document, kind: str, parent_id: str | None, owner_email: str | None, created_by: str,
               org_id: str | None = None) -> dict:
    return {
        "org_id": org_id,
        "id": doc.id, "doc_id": doc.id, "title": doc.title, "kind": kind, "parent_id": parent_id,
        "status": "extracting", "error": None,
        "owner_email": owner_email.strip().lower() if owner_email else None,
        "created_by": created_by, "created_at": now(), "updated_at": now(),
        "confirmed_at": None, "confirmed_by": None,
        "draft": None, "source_md": "",
        "fields": {k: {"value": None, "quote": "", "verified": False, "edited": False} for k in FIELD_KINDS},
        "items": [], "clauses": [], "warnings": [], "history": [],
        "action_deadline": None, "handled": None,
    }


def _fill(rec: dict) -> dict:
    """A field added after a contract was read (buyer_representative…) reads as empty, never as missing."""
    fields = rec.setdefault("fields", {})
    for k in FIELD_KINDS:
        fields.setdefault(k, {"value": None, "quote": "", "verified": False, "edited": False})
    return rec


def get(contract_id: str) -> dict | None:
    r = os_store.client().get(index=os_store.CONTRACTS, id=contract_id, ignore=[404])
    return _fill(r["_source"]) if r.get("found") else None


def save(rec: dict) -> dict:
    rec["updated_at"] = now()
    os_store.client().index(index=os_store.CONTRACTS, id=rec["id"], body=rec, refresh=True)
    request_cache.drop()
    return rec


def list_all() -> list[dict]:
    # ponytail: whole index into Python; fine under ten thousand contracts, use OpenSearch filters past that
    def read():
        r = os_store.client().search(index=os_store.CONTRACTS, body={"query": {"match_all": {}}, "size": 10000})
        return [_fill(h["_source"]) for h in r["hits"]["hits"]]
    return copy.deepcopy(request_cache.get("contracts", read))      # callers may edit what they get


def list_org(org_id: str) -> list[dict]:
    """One organisation's contracts, filtered in OpenSearch: a request never reads other organisations' records."""
    # ponytail: one page of 10 000 per organisation; search_after once an organisation holds more
    def read():
        r = os_store.client().search(index=os_store.CONTRACTS, body={"query": {"term": {"org_id": org_id}}, "size": 10000})
        return [_fill(h["_source"]) for h in r["hits"]["hits"]]
    return copy.deepcopy(request_cache.get(f"contracts:{org_id}", read))


def delete(contract_id: str) -> None:
    os_store.client().delete(index=os_store.CONTRACTS, id=contract_id, ignore=[404], refresh=True)
    request_cache.drop()
