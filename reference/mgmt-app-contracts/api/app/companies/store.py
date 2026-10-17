"""The organisation's directory of companies (suppliers, customers, its own legal entities), keyed like graph Parties."""
from datetime import datetime, timedelta, timezone

from app.companies.registry import Lookup
from app.contracts.project import party_key
from app.contracts.store import now
from app.store import opensearch as os_store

REGISTRY_FIELDS = ("name", "international_name", "short_name", "address", "status", "active")
EDITABLE = ("name", "international_name", "short_name", "address")
FRESH = timedelta(days=7)


def company_id(org_id: str | None, tax_id: str | None, name: str | None = None) -> str:
    return party_key(name, tax_id, org_id)


def new(org_id: str | None, tax_id: str | None, name: str | None, created_from: str) -> dict:
    return {"id": company_id(org_id, tax_id, name), "org_id": org_id, "tax_id": tax_id, "name": name,
            "international_name": None, "short_name": None, "address": None, "status": None, "active": None,
            "own": False, "needs_merge": not tax_id, "edited": [], "account_owners": [], "contacts": [],
            "registry": {"result": None, "fetched_at": None, "synced_at": None},
            "created_from": created_from, "created_at": now(), "updated_at": now()}


def get(cid: str) -> dict | None:
    r = os_store.client().get(index=os_store.COMPANIES, id=cid, ignore=[404])
    return r["_source"] if r.get("found") else None


def save(c: dict) -> dict:
    c["updated_at"] = now()
    os_store.client().index(index=os_store.COMPANIES, id=c["id"], body=c, refresh=True)
    return c


def delete(cid: str) -> None:
    os_store.client().delete(index=os_store.COMPANIES, id=cid, refresh=True, ignore=[404])


def list_org(org_id: str, merged: bool = False) -> list[dict]:
    """The organisation's companies; `merged` also returns names already merged into another company."""
    # ponytail: whole organisation in one page; fine under ten thousand companies, paginate past that
    r = os_store.client().search(index=os_store.COMPANIES,
                                 body={"query": {"term": {"org_id": org_id}}, "size": 10000})
    return [h["_source"] for h in r["hits"]["hits"] if merged or not h["_source"].get("merged_into")]


def apply_registry(c: dict, look: Lookup) -> dict:
    """Take what the registry says, except fields a person has corrected."""
    c["registry"] = {**c["registry"], "result": look.result, "fetched_at": now()}
    if look.result == "found":
        for f in REGISTRY_FIELDS:
            if f not in c["edited"]:
                c[f] = look.data[f]
        c["registry"]["synced_at"] = now()
    return c


def fresh(c: dict) -> bool:
    at = (c.get("registry") or {}).get("synced_at")
    return bool(at) and c["registry"]["result"] == "found" and \
        datetime.now(timezone.utc) - datetime.fromisoformat(at) < FRESH


def as_lookup(c: dict) -> Lookup:
    return Lookup("found", {f: c[f] for f in REGISTRY_FIELDS} | {"tax_id": c["tax_id"]})
