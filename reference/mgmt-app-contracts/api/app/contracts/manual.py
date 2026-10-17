"""A contract typed in rather than read from a file: a CKS sale, a purchased lot, a deal agreed by phone, demo data.
It goes through the same enrichment, deadline and graph projection as an uploaded one, so prices and reminders work."""
import uuid

from app.companies import enrich, registry
from app.companies import store as cstore
from app.contracts import project, remind, store
from app.contracts.clock import today_vn
from app.contracts.fields import FIELD_KINDS, ITEM_KINDS
from app.contracts.verify import warnings_for

ORIGINS = ("manual", "cks", "seed")


def _field(value) -> dict:
    return {"value": value, "quote": "", "verified": True, "edited": True}


def _item(it: dict) -> dict:
    out = {k: it.get(k) for k in ITEM_KINDS}
    out.update(name=str(it["name"]).strip(), quote="", verified=True, edited=True)
    return out


def _offline_party(org_id: str, fields: dict, name_f: str, tax_f: str) -> dict:
    """The party joins the directory as written, without asking the registry (made-up or not yet registered MSTs)."""
    name, raw = fields[name_f]["value"], fields[tax_f]["value"]
    tax = registry.normalize_tax_id(str(raw)) if raw else None
    if not (name or tax):
        return {"tax_id": None, "company_id": None, "lookup": "no_tax"}
    cid = cstore.company_id(org_id, tax, None if tax else name)
    if not cstore.get(cid):
        cstore.save(cstore.new(org_id, tax, name, "contract"))
    return {"tax_id": tax, "company_id": cid, "lookup": "skipped" if tax else "no_tax", "registry_name": None,
            "registry_address": None, "status": None, "active": None, "name_match": None}


def create(org_id: str, by: str, fields: dict, items: list[dict] | None = None, owner_email: str | None = None,
           origin: str = "manual", direction: str | None = None, confirm: bool = True, lookup: bool = True,
           contract_id: str | None = None, extra: dict | None = None) -> dict:
    """`direction` forces sale/purchase when the organisation has not marked its own entity yet.
    `lookup=False` skips the tax registry (seed data with made-up tax ids)."""
    unknown = set(fields) - set(FIELD_KINDS)
    if unknown:
        raise ValueError(f"unknown fields {sorted(unknown)}")
    if origin not in ORIGINS:
        raise ValueError("origin")
    cid = contract_id or uuid.uuid4().hex
    rec = {
        "org_id": org_id, "id": cid, "doc_id": cid, "title": fields.get("title") or fields.get("number") or "Hợp đồng",
        "kind": "contract", "parent_id": None, "status": "needs_review", "error": None,
        "owner_email": (owner_email or by).strip().lower(), "created_by": by, "created_at": store.now(),
        "updated_at": store.now(), "confirmed_at": None, "confirmed_by": None, "draft": None, "source_md": "",
        "fields": {k: _field(fields.get(k)) if fields.get(k) is not None else
                   {"value": None, "quote": "", "verified": False, "edited": False} for k in FIELD_KINDS},
        "items": [_item(i) for i in items or []], "clauses": [], "warnings": [], "history": [],
        "action_deadline": None, "handled": None, "origin": origin, **(extra or {}),
    }
    if lookup:
        enrich.enrich(rec, timeout=registry.FAST, max_wait=registry.MAX_WAIT)
    else:
        rec["parties"] = {side: _offline_party(org_id, rec["fields"], name_f, tax_f)
                          for side, (name_f, tax_f) in enrich.SIDES.items()}
    if direction:
        rec["direction"] = direction
    else:
        enrich.set_direction(rec)
    rec["warnings"] = warnings_for(rec)
    if confirm:
        rec["action_deadline"] = project.compute_deadline(rec["fields"])
        rec.update(confirmed_at=store.now(), confirmed_by=by)
        rec["status"] = remind.status_for({**rec, "status": "active"}, today_vn())
    store.save(rec)
    if confirm:
        project.project_contract(cid)
    return store.get(cid)
