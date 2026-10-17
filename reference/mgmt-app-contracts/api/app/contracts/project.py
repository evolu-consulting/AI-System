"""The only writer of contract nodes in Neo4j. Everything here is rebuilt from the record."""
import re
from datetime import date, timedelta

from app.contracts import categories, store
from app.contracts.fields import CONFIRMED
from app.ingest.resolve import match_form
from app.store import graph

_CONTRACT_PROPS = ("number", "title", "type", "signed_date", "start_date", "end_date", "auto_renew", "notice_days",
                   "total_value", "vat_rate", "vat_included", "payment_terms", "effective_date")


def party_key(name: str | None, tax_id: str | None, org_id: str | None = None) -> str:
    """Scoped by organisation: two companies with the same supplier must not share its node."""
    digits = re.sub(r"\D", "", tax_id or "")
    key = f"tax:{digits}" if digits else f"name:{match_form(name or '')}"
    return f"{org_id}|{key}" if org_id else key


def product_key(code: str | None, name: str, spec: str | None, org_id: str | None = None) -> str:
    key = f"code:{match_form(code)}" if code else f"name:{match_form(name)}|{match_form(spec or '')}"
    return f"{org_id}|{key}" if org_id else key


def _resolved(merged: dict[str, str], key: str) -> str:
    return merged.get(key, key)


def item_keys(rec: dict) -> set[str]:
    """Product keys of the record's lines as their text gives them, before any merge."""
    return {product_key(it.get("code"), it["name"], it.get("spec"), rec.get("org_id"))
            for it in rec.get("items") or [] if it.get("name")}


def _parent_products(rec: dict):
    """For an addendum: a line named like exactly one of the parent's products, without a code and with no spec or a
    different one, is that product. Addenda name products shortly ("phí bản quyền phần mềm quản lý kho"), and the new
    price must supersede the old one, not become a second product."""
    parent = store.get(rec["parent_id"]) if rec.get("kind") == "addendum" and rec.get("parent_id") else None
    by_name: dict[str, set[str]] = {}
    for it in (parent or {}).get("items") or []:
        if it.get("name"):
            by_name.setdefault(match_form(it["name"]), set()).add(
                product_key(it.get("code"), it["name"], it.get("spec"), parent.get("org_id")))

    def of(it: dict) -> str | None:
        if it.get("code") or not it.get("name"):
            return None
        keys = by_name.get(match_form(it["name"])) or set()
        return next(iter(keys)) if len(keys) == 1 else None
    return of


def compute_deadline(fields: dict) -> str | None:
    end = (fields.get("end_date") or {}).get("value")
    if not end:
        return None
    notice = (fields.get("notice_days") or {}).get("value") or 0
    return (date.fromisoformat(end) - timedelta(days=int(notice))).isoformat()


def _val(rec: dict, name: str):
    return rec["fields"][name]["value"]


def delete_projection(contract_id: str) -> None:
    graph._run("""MATCH (c:Contract {id:$id}) OPTIONAL MATCH (c)-[:HAS_LINE]->(l:PriceLine)
                  DETACH DELETE c, l""", id=contract_id)
    graph._run("MATCH (ch:Chunk {doc_id:$id}) REMOVE ch:Clause REMOVE ch.number, ch.heading, ch.topic", id=contract_id)


def project_contract(contract_id: str) -> None:
    rec = store.get(contract_id)
    delete_projection(contract_id)
    if not rec or rec["status"] not in CONFIRMED:
        return
    props = {k: _val(rec, k) for k in _CONTRACT_PROPS}
    org = rec.get("org_id")
    props.update(kind=rec["kind"], status=rec["status"], action_deadline=rec.get("action_deadline"),
                 direction=rec.get("direction"),
                 owner_email=rec.get("owner_email"), title=props["title"] or rec["title"], org_id=org)
    parties = rec.get("parties") or {}

    def party(side: str) -> dict:
        p, name, tax = parties.get(side) or {}, _val(rec, f"{side}_name"), _val(rec, f"{side}_tax_id")
        name = p.get("registry_name") or name          # the registry's spelling, when it knows the company
        # a name merged into a company keys as that company
        return {"key": p.get("company_id") or party_key(name, tax, org), "name": name, "tax_id": p.get("tax_id") or tax,
                "match": match_form(name or ""), "active": p.get("active"), "official": bool(p.get("registry_name"))}
    supplier, buyer = party("supplier"), party("buyer")
    graph._run("""
        CREATE (c:Contract {id:$id}) SET c += $props
        WITH c
        FOREACH (p IN CASE WHEN $supplier.name IS NULL AND $supplier.tax_id IS NULL THEN [] ELSE [$supplier] END |
            MERGE (s:Party {key:p.key})
            ON CREATE SET s.name = p.name, s.tax_id = p.tax_id, s.match = p.match, s.needs_merge = p.tax_id IS NULL
            SET s.active = p.active, s.name = CASE WHEN p.official THEN p.name ELSE s.name END,
                s.match = CASE WHEN p.official THEN p.match ELSE s.match END
            MERGE (c)-[:SUPPLIER]->(s))
        FOREACH (p IN CASE WHEN $buyer.name IS NULL AND $buyer.tax_id IS NULL THEN [] ELSE [$buyer] END |
            MERGE (b:Party {key:p.key})
            ON CREATE SET b.name = p.name, b.tax_id = p.tax_id, b.match = p.match, b.needs_merge = p.tax_id IS NULL
            SET b.active = p.active, b.name = CASE WHEN p.official THEN p.name ELSE b.name END,
                b.match = CASE WHEN p.official THEN p.match ELSE b.match END
            MERGE (c)-[:BUYER]->(b))
        """, id=contract_id, props=props, supplier=supplier, buyer=buyer)
    merged = categories.alias_map(org)          # products a person merged into another
    of_parent = _parent_products(rec)
    lines = [{"id": f"{contract_id}:line:{i}", "product": _resolved(merged, of_parent(it) or product_key(
                  it.get("code"), it["name"], it.get("spec"), org)),
              "match": match_form(f"{it['name']} {it.get('code') or ''} {it.get('spec') or ''}"),
              "code": it.get("code"), "name": it["name"], "spec": it.get("spec"), "unit": it.get("unit"),
              "props": {k: it.get(k) for k in ("unit_price", "unit", "qty", "moq", "vat_rate", "valid_from", "valid_to")}}
             for i, it in enumerate(rec["items"]) if it.get("name")]
    graph._run("""
        MATCH (c:Contract {id:$id}) UNWIND $lines AS ln
        CREATE (l:PriceLine {id:ln.id}) SET l += ln.props
        MERGE (p:Product {key:ln.product}) ON CREATE SET p.code = ln.code, p.name = ln.name, p.spec = ln.spec,
                                                          p.unit = ln.unit, p.match = ln.match
        CREATE (c)-[:HAS_LINE]->(l)-[:FOR]->(p)
        """, id=contract_id, lines=lines)
    graph._run("""
        MATCH (c:Contract {id:$id}) UNWIND $clauses AS cl
        MATCH (ch:Chunk {id:cl.chunk_id})
        SET ch:Clause, ch.number = cl.number, ch.heading = cl.heading, ch.topic = cl.topic
        MERGE (c)-[:HAS_CLAUSE]->(ch)
        """, id=contract_id, clauses=rec["clauses"])
    if rec["kind"] == "addendum" and rec.get("parent_id"):
        _link_addendum(rec)
    else:
        for child in store.list_all():
            if child.get("parent_id") == contract_id and child["status"] in CONFIRMED:
                project_contract(child["id"])


def _link_addendum(rec: dict) -> None:
    eff = _val(rec, "effective_date")
    graph._run("""MATCH (a:Contract {id:$a}), (p:Contract {id:$p})
                  MERGE (a)-[r:AMENDS]->(p) SET r.effective_date = $eff""", a=rec["id"], p=rec["parent_id"], eff=eff)
    if not eff:
        return
    before = (date.fromisoformat(eff) - timedelta(days=1)).isoformat()
    graph._run("""
        MATCH (a:Contract {id:$a})-[:HAS_LINE]->(new:PriceLine)-[:FOR]->(prod:Product)
              <-[:FOR]-(old:PriceLine)<-[:HAS_LINE]-(:Contract {id:$p})
        MERGE (new)-[s:SUPERSEDES]->(old) SET s.effective_date = $eff
        SET old.valid_to = CASE WHEN old.valid_to IS NULL OR old.valid_to > $before THEN $before ELSE old.valid_to END
        SET new.valid_from = coalesce(new.valid_from, $eff)
        """, a=rec["id"], p=rec["parent_id"], eff=eff, before=before)
