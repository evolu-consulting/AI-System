"""Tie a contract's two parties to the directory and check them against the tax registry.

The contract keeps its own words; the registry only fills an empty address and raises warnings."""
import logging

from app.companies import registry
from app.companies import store as cstore
from app.contracts import store
from app.contracts.link import party_form

log = logging.getLogger(__name__)
SIDES = {"supplier": ("supplier_name", "supplier_tax_id"), "buyer": ("buyer_name", "buyer_tax_id")}
PARTY_FIELDS = {f for pair in SIDES.values() for f in pair}


def _val(fields: dict, name: str):
    return (fields.get(name) or {}).get("value")


def same_name(a: str | None, names: list[str | None]) -> bool:
    mine = party_form(a)
    for n in names:
        theirs = party_form(n)
        if mine and theirs and (mine == theirs or (min(len(mine), len(theirs)) >= 4 and (mine in theirs or theirs in mine))):
            return True
    return False


def _blank(tax_id: str | None, lookup: str) -> dict:
    return {"tax_id": tax_id, "company_id": None, "lookup": lookup, "registry_name": None, "registry_address": None,
            "status": None, "active": None, "name_match": None}


def _side(org_id: str | None, name: str | None, raw_tax, timeout: float, max_wait: float) -> dict:
    tax = registry.normalize_tax_id(str(raw_tax) if raw_tax is not None else None)
    if raw_tax and not tax:
        return _blank(None, "invalid")
    if not tax:
        p = _blank(None, "no_tax")
        if name:
            cid = cstore.company_id(org_id, None, name)
            c = cstore.get(cid) or cstore.save(cstore.new(org_id, None, name, "contract"))
            c = c.get("merged_into") and cstore.get(c["merged_into"]) or c    # a person said who this name is
            if c["tax_id"]:
                return _side(org_id, None, c["tax_id"], timeout, max_wait)
            p["company_id"] = c["id"]
        return p
    c = cstore.get(cstore.company_id(org_id, tax))
    live = not (c and cstore.fresh(c))
    look = registry.lookup(tax, max_wait=max_wait, timeout=timeout) if live else cstore.as_lookup(c)
    if look.result == "unavailable" and c and c["registry"].get("synced_at"):
        look, live = cstore.as_lookup(c), False      # registry busy: an older sync beats nothing
    if look.result == "not_found":                   # a mistyped MST must not become a company
        return {**_blank(tax, "not_found"), "company_id": c["id"] if c else None}
    if c is None:
        c = cstore.new(org_id, tax, name, "contract")
    if live and (look.result == "found" or not c["registry"]["result"]):
        cstore.save(cstore.apply_registry(c, look))
    found = look.result == "found"
    return {"tax_id": tax, "company_id": c["id"], "lookup": look.result,
            "registry_name": c["name"] if found else None, "registry_address": c["address"] if found else None,
            "status": c["status"] if found else None, "active": c["active"] if found else None,
            "name_match": same_name(name, [c["name"], c["short_name"], c["international_name"]])
            if found and name else None}


def enrich(rec: dict, timeout: float = registry.TIMEOUT, max_wait: float = registry.BACKGROUND_WAIT) -> None:
    """Defaults suit a background job; a request passes registry.FAST and registry.MAX_WAIT."""
    fields, org, addendum = rec["fields"], rec.get("org_id"), rec.get("kind") == "addendum"
    parent = store.get(rec["parent_id"]) if addendum and rec.get("parent_id") else None
    parties = {}
    for side, (name_f, tax_f) in SIDES.items():
        name, tax = _val(fields, name_f), _val(fields, tax_f)
        if parent and not tax:              # an addendum rarely restates the MST; its parties are its contract's
            name, tax = name or _val(parent["fields"], name_f), _val(parent["fields"], tax_f)
        if addendum and not tax:            # nothing to check, and a name alone would duplicate the company
            parties[side] = _blank(None, "inherited")
            continue
        try:
            parties[side] = _side(org, name, tax, timeout, max_wait)
        except Exception:  # noqa: BLE001 - the registry or directory failing must not fail the contract
            log.warning("party enrichment failed for %s %s", rec.get("id"), side, exc_info=True)
            parties[side] = _blank(None, "unavailable")
    rec["parties"] = parties
    addr, sup = fields.get("supplier_address"), parties["supplier"]
    # an addendum lists only what it changes, so an address filled in there would read as a change
    if not addendum and addr and addr["value"] is None and not addr.get("edited") and sup["registry_address"]:
        addr.update(value=sup["registry_address"], quote="", verified=False, source="registry")
    set_direction(rec)


def own_ids(org_id: str | None) -> set[str]:
    return {c["id"] for c in cstore.list_org(org_id) if c["own"]} if org_id else set()


def set_direction(rec: dict, own: set[str] | None = None, parent: dict | None = None) -> None:
    """We are always one party: our entity selling makes it a sale, buying a purchase. An addendum follows its contract."""
    if rec.get("kind") == "addendum" and rec.get("parent_id"):
        parent = parent or store.get(rec["parent_id"]) or {}
        rec["direction"], rec["direction_check"] = parent.get("direction"), None
        return
    own = own_ids(rec.get("org_id")) if own is None else own
    ours = {side for side, p in (rec.get("parties") or {}).items() if p.get("company_id") in own}
    rec["direction"] = "sale" if ours == {"supplier"} else "purchase" if ours == {"buyer"} else None
    rec["direction_check"] = None if not own else "both_own" if len(ours) == 2 else "none_own" if not ours else None


def redirect_org(org_id: str) -> list[dict]:
    """Re-derive every contract's direction after the organisation's own entities changed; returns those that moved."""
    own, moved = own_ids(org_id), []
    recs = store.list_org(org_id)
    by_id = {r["id"]: r for r in recs}
    for r in sorted(recs, key=lambda r: r["kind"] != "contract"):      # contracts first, addenda read them
        before = (r.get("direction"), r.get("direction_check"))
        set_direction(r, own, by_id.get(r.get("parent_id")))
        if (r.get("direction"), r.get("direction_check")) != before:
            moved.append(r)
    return moved


def needs_retry(rec: dict) -> bool:
    return any(p.get("lookup") == "unavailable" for p in (rec.get("parties") or {}).values())
