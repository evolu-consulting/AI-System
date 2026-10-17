"""Products across confirmed contracts: who sells each one to us, whom we sell it to, at what price and since when.

Read from the contract graph, so addenda that changed a price are already applied (SUPERSEDES)."""
from app.companies import store as cstore
from app.store import graph

LIVE = {"active", "expiring", "renewed"}


def lines(contract_ids: list[str], today: str, product: str | None = None, party: str | None = None) -> list[dict]:
    """Every price line of these contracts, each with the other party and whether it is the price in force today."""
    rows = graph._run("""
        MATCH (c:Contract)-[:HAS_LINE]->(l:PriceLine)-[:FOR]->(p:Product)
        WHERE c.id IN $ids AND ($product IS NULL OR p.key = $product)
        OPTIONAL MATCH (c)-[:AMENDS]->(par:Contract)
        OPTIONAL MATCH (c)-[:SUPPLIER]->(s:Party)
        OPTIONAL MATCH (par)-[:SUPPLIER]->(ps:Party)
        OPTIONAL MATCH (c)-[:BUYER]->(b:Party)
        OPTIONAL MATCH (par)-[:BUYER]->(pb:Party)
        // an addendum's parties are its contract's: it rarely restates their MST, so its own Party is a bare name
        WITH p, l, c, par, CASE WHEN par IS NULL THEN s ELSE coalesce(ps, s) END AS sup,
             CASE WHEN par IS NULL THEN b ELSE coalesce(pb, b) END AS buy
        WHERE $party IS NULL OR sup.key = $party OR buy.key = $party
        RETURN p.key AS product, p.name AS name, p.code AS code, p.spec AS spec,
               l.unit_price AS price, l.unit AS unit, l.qty AS qty, l.valid_from AS valid_from, l.valid_to AS valid_to,
               EXISTS { (l)<-[:SUPERSEDES]-(:PriceLine) } AS superseded,
               c.id AS contract_id, coalesce(c.number, c.title) AS number, c.kind AS kind, c.status AS status,
               l.id AS line_id, c.end_date AS end_date,
               coalesce(c.direction, par.direction) AS direction,
               sup.key AS supplier_key, sup.name AS supplier, buy.key AS buyer_key, buy.name AS buyer
        """, ids=contract_ids, product=product, party=party)
    out, known = [], {}
    for r in map(dict, rows):
        sale = r["direction"] == "sale"         # unknown direction reads as a purchase, as the system always has
        key, name = (r["buyer_key"], r["buyer"]) if sale else (r["supplier_key"], r["supplier"])
        if key and key not in known:
            known[key] = cstore.get(key) is not None
        current = (not r["superseded"] and r["status"] in LIVE and (r["valid_from"] or "") <= today
                   and (not r["valid_to"] or r["valid_to"] >= today))
        out.append({**{k: r[k] for k in ("product", "name", "code", "spec", "price", "unit", "qty", "valid_from",
                                         "valid_to", "superseded", "contract_id", "number", "kind", "status",
                                         "direction", "end_date")},
                    "line": int(r["line_id"].rsplit(":", 1)[1]),
                    "role": "customer" if sale else "supplier", "current": current,
                    "party": {"key": key, "name": name, "company_id": key if key and known[key] else None}})
    return out


def _cheapest(rows: list[dict]) -> dict | None:
    priced = [r for r in rows if r["current"] and r["price"] is not None]
    return min(priced, key=lambda r: r["price"], default=None)


def summary(rows: list[dict]) -> list[dict]:
    """One row per product: how many suppliers and customers, and the lowest price in force each way."""
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r["product"], []).append(r)
    out = []
    for key, rs in by.items():
        buy = [r for r in rs if r["role"] == "supplier"]
        sell = [r for r in rs if r["role"] == "customer"]
        cb, cs = _cheapest(buy), _cheapest(sell)
        first = rs[0]
        out.append({"key": key, "name": first["name"], "code": first["code"], "spec": first["spec"],
                    "unit": next((r["unit"] for r in rs if r["unit"]), None),
                    "suppliers": len({r["party"]["key"] or r["party"]["name"] for r in buy}),
                    "customers": len({r["party"]["key"] or r["party"]["name"] for r in sell}),
                    "buy_price": cb and {"price": cb["price"], "unit": cb["unit"], "party": cb["party"]["name"]},
                    "sell_price": cs and {"price": cs["price"], "unit": cs["unit"], "party": cs["party"]["name"]},
                    "lines": len(rs)})
    return sorted(out, key=lambda p: (p["name"] or "").lower())
