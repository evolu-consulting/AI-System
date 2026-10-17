import logging
from collections.abc import Callable
from datetime import date, timedelta

from openai import pydantic_function_tool
from pydantic import BaseModel, Field, ValidationError

from app.contracts import store
from app.contracts.clock import today_vn
from app.contracts.fields import CONFIRMED
from app.ingest.embed import embed_texts
from app.ingest.resolve import match_form, search_form
from app.store import graph
from app.store import opensearch as os_store

log = logging.getLogger(__name__)
Status = str


class FindContracts(BaseModel):
    """Find confirmed contracts by supplier, customer, purchase/sale, product, status, owner, type or due date."""
    supplier: str | None = Field(None, description="supplier (seller) name fragment or tax id (MST)")
    customer: str | None = Field(None, description="customer (buyer) name fragment or tax id (MST)")
    direction: str | None = Field(None, description="purchase (we buy from a supplier) or sale (we sell to a customer)")
    product: str | None = Field(None, description="product name fragment or product code")
    status: list[str] | None = Field(None, description="any of active, expiring, expired, renewed, terminated")
    owner: str | None = Field(None, description="owner email")
    type: str | None = Field(None, description="purchase, service, framework or principle")
    due_within_days: int | None = Field(None, ge=0, le=3650, description="action deadline within this many days from today")
    limit: int = Field(10, ge=1, le=20)


class ContractFacts(BaseModel):
    """All confirmed facts of one contract: parties, dates, value, terms, effective prices, addenda."""
    contract_id: str = Field(description="contract id (from find_contracts) or contract number")


class AmendmentsOf(BaseModel):
    """Addenda of one contract, in effective-date order, with what each changed."""
    contract_id: str = Field(description="contract id (from find_contracts) or contract number")


class PriceHistory(BaseModel):
    """Every price line for a product across suppliers and time, including superseded ones."""
    product: str


class SearchClauses(BaseModel):
    """Search contract clause text (payment, penalty, warranty, termination...)."""
    query: str
    contract_ids: list[str] | None = None
    topic: str | None = Field(None, description="payment, delivery, warranty, penalty, termination, renewal, "
                                                "price, confidentiality, dispute, general")


class Margins(BaseModel):
    """What we sell, where each line is bought, the margin on it, and which sales are at risk because their purchase
    contract is running out or over. Use for profit, margin, gross profit, sourcing, supplier dependence questions."""
    product: str | None = Field(None, description="product name fragment or code")
    customer: str | None = Field(None, description="customer name fragment or tax id")
    supplier: str | None = Field(None, description="supplier the sale is bought from: name fragment or tax id")
    contract_id: str | None = Field(None, description="a sale contract, or a purchase contract to see the sales on it")
    at_risk_only: bool = Field(False, description="only sales whose source purchase is expiring or over")
    order_by: str | None = Field(None, description="price_desc, price_asc, margin_desc, margin_asc, margin_pct_desc, "
                                                   "margin_pct_asc or profit_desc: use it for highest / lowest questions")
    limit: int = Field(12, ge=1, le=30)


def _vnd(n) -> str:
    return "—" if n is None else f"{int(n):,}".replace(",", ".")


def _item(rec: dict, text: str, kind: str = "fact") -> dict:
    return {"doc_id": rec["id"], "title": rec["fields"]["number"]["value"] or rec["title"], "uri": f"contract://{rec['id']}",
            "text": text, "kind": kind, "unconfirmed": rec["status"] not in CONFIRMED}


def _quote(rec: dict, name: str) -> str:
    q = rec["fields"][name]["quote"]
    return f" (“{q}”)" if q else ""


def _days_left(deadline: str | None, today: str | None) -> str:
    """Spelled out so the answer never has to do date arithmetic."""
    if not deadline or not today:
        return ""
    n = (date.fromisoformat(deadline) - date.fromisoformat(today)).days
    return f" (còn {n} ngày)" if n > 0 else " (hôm nay)" if n == 0 else f" (đã quá {-n} ngày)"


def _summary_line(rec: dict, today: str | None = None) -> str:
    f = {k: v["value"] for k, v in rec["fields"].items()}
    kind = {"purchase": "HĐ mua", "sale": "HĐ bán"}.get(rec.get("direction") or "", "chưa rõ mua hay bán")
    return (f"Hợp đồng {f['number']} ({kind}) · NCC/bên bán: {f['supplier_name']} (MST {f['supplier_tax_id'] or '—'}) · "
            f"KH/bên mua: {f.get('buyer_name')} (MST {f.get('buyer_tax_id') or '—'}) · "
            f"trạng thái: {rec['status']} · hiệu lực {f['start_date']} → {f['end_date']}{_quote(rec, 'end_date')} · "
            f"tự động gia hạn: {'?' if f['auto_renew'] is None else 'có' if f['auto_renew'] else 'không'} · "
            f"báo trước: {'—' if f['notice_days'] is None else f['notice_days']} ngày"
            f"{_quote(rec, 'notice_days')} · hạn chót hành động: {rec.get('action_deadline') or '—'}{_days_left(rec.get('action_deadline'), today)} · "
            f"giá trị: {_vnd(f['total_value'])} đ · người phụ trách: {rec.get('owner_email') or '—'}")


def _allowed(ids: list[str], restrict: list[str] | None) -> list[str]:
    return [i for i in ids if restrict is None or i in restrict]


def find_contracts(a: FindContracts, restrict: list[str] | None, today: str) -> list[dict]:
    rows = graph._run("""
        MATCH (c:Contract {kind:'contract'})
        OPTIONAL MATCH (c)-[:SUPPLIER]->(s:Party)
        OPTIONAL MATCH (c)-[:BUYER]->(b:Party)
        OPTIONAL MATCH (c)-[:HAS_LINE]->(:PriceLine)-[:FOR]->(p:Product)
        WITH c, s, b, collect(DISTINCT p) AS products
        WHERE ($supplier IS NULL OR s.tax_id = $supplier_raw OR s.match CONTAINS $supplier)
          AND ($customer IS NULL OR b.tax_id = $customer_raw OR b.match CONTAINS $customer)
          AND ($direction IS NULL OR c.direction = $direction)
          AND ($product IS NULL OR any(p IN products WHERE p.match CONTAINS $product))
          AND ($status IS NULL OR c.status IN $status)
          AND ($owner IS NULL OR c.owner_email = $owner)
          AND ($type IS NULL OR c.type = $type)
          AND ($restrict IS NULL OR c.id IN $restrict)
          AND ($due IS NULL OR (c.action_deadline IS NOT NULL AND c.action_deadline <= $due
                                AND NOT c.status IN ['renewed', 'terminated']))
        RETURN c.id AS id ORDER BY c.action_deadline LIMIT $limit
        """, supplier=match_form(a.supplier) if a.supplier else None, supplier_raw=a.supplier,
        customer=match_form(a.customer) if a.customer else None, customer_raw=a.customer, direction=a.direction,
        product=match_form(a.product) if a.product else None, status=a.status,
        owner=a.owner.lower() if a.owner else None, type=a.type, limit=a.limit, restrict=restrict,
        due=(date.fromisoformat(today) + timedelta(days=a.due_within_days)).isoformat()
        if a.due_within_days is not None else None)
    out = []
    for cid in _allowed([r["id"] for r in rows], restrict):
        rec = store.get(cid)
        if rec:
            out.append(_item(rec, _summary_line(rec, today)))
    return out


def _effective_lines(contract_id: str, today: str) -> list[dict]:
    return [dict(r) for r in graph._run("""
        MATCH (c:Contract {id:$id})-[:HAS_LINE]->(l:PriceLine)-[:FOR]->(p:Product)
        OPTIONAL MATCH (n:PriceLine)-[s:SUPERSEDES]->(l) WHERE s.effective_date <= $today
        WITH l, p, n WHERE n IS NULL
        RETURN p.code AS code, p.name AS name, l.unit AS unit, l.unit_price AS price, l.valid_to AS valid_to
        UNION
        MATCH (:Contract {id:$id})<-[am:AMENDS]-(a:Contract)-[:HAS_LINE]->(l:PriceLine)-[:FOR]->(p:Product)
        WHERE am.effective_date <= $today
        OPTIONAL MATCH (n:PriceLine)-[s:SUPERSEDES]->(l) WHERE s.effective_date <= $today
        WITH l, p, n WHERE n IS NULL
        RETURN p.code AS code, p.name AS name, l.unit AS unit, l.unit_price AS price, l.valid_to AS valid_to
        """, id=contract_id, today=today)]


def _resolve(x: str, restrict: list[str] | None = None) -> str:
    """Internal id as is; otherwise the id of a reachable record whose number matches x."""
    if store.get(x):
        return x
    want = match_form(x)
    return next((r["id"] for r in store.list_all() if (restrict is None or r["id"] in restrict)
                 and match_form(r["fields"]["number"]["value"] or "") == want), x)


def contract_facts(a: ContractFacts, restrict: list[str] | None, today: str) -> list[dict]:
    cid = _resolve(a.contract_id, restrict)
    if not _allowed([cid], restrict):
        return []
    rec = store.get(cid)
    if not rec or rec["status"] not in CONFIRMED:
        return []
    f = {k: v["value"] for k, v in rec["fields"].items()}
    lines = [_summary_line(rec, today),
             f"Bên mua: {f['buyer_name']} · ký ngày {f['signed_date']}",
             f"Thanh toán: {f['payment_terms'] or '—'}{_quote(rec, 'payment_terms')}",
             f"Giao hàng: {f['delivery_terms'] or '—'}", f"Bảo hành: {f['warranty'] or '—'}",
             f"Phạt vi phạm: {f['penalty'] or '—'}{_quote(rec, 'penalty')}",
             f"VAT: {f['vat_rate'] if f['vat_rate'] is not None else '—'}% · "
             f"giá {'đã' if f['vat_included'] else 'chưa' if f['vat_included'] is False else '?'} gồm VAT",
             "Giá hiệu lực:"]
    for ln in _effective_lines(rec["id"], today):
        lines.append(f"  - {ln['code'] or '—'} {ln['name']}: {_vnd(ln['price'])} đ/{ln['unit'] or ''}")
    adds = amendments_of(AmendmentsOf(contract_id=rec["id"]), restrict, today)
    if adds:
        lines.append("Phụ lục: " + "; ".join(i["title"] for i in adds))
    return [_item(rec, "\n".join(lines))]


def amendments_of(a: AmendmentsOf, restrict: list[str] | None, today: str) -> list[dict]:
    cid = _resolve(a.contract_id, restrict)
    if not _allowed([cid], restrict):
        return []
    rows = graph._run("""MATCH (a:Contract)-[am:AMENDS]->(:Contract {id:$id})
                         RETURN a.id AS id ORDER BY am.effective_date""", id=cid)
    out = []
    for r in _allowed([r["id"] for r in rows], restrict):
        rec = store.get(r)
        if not rec:
            continue
        changed = [f"{k}: {v['value']}{_quote(rec, k)}" for k, v in rec["fields"].items()
                   if v["value"] is not None and k not in ("number", "supplier_name", "effective_date")]
        changed += [f"giá {it.get('code') or ''} {it['name']}: {_vnd(it.get('unit_price'))} đ" for it in rec["items"]]
        out.append(_item(rec, f"Phụ lục {rec['fields']['number']['value']} hiệu lực từ "
                              f"{rec['fields']['effective_date']['value']}{_quote(rec, 'effective_date')}: "
                              + "; ".join(changed)))
    return out


def price_history(a: PriceHistory, restrict: list[str] | None, today: str) -> list[dict]:
    rows = graph._run("""
        MATCH (c:Contract)-[:HAS_LINE]->(l:PriceLine)-[:FOR]->(p:Product)
        WHERE p.match CONTAINS $q OR toLower(coalesce(p.code, '')) = $raw
        OPTIONAL MATCH (c)-[:SUPPLIER]->(s:Party)
        OPTIONAL MATCH (c)-[:AMENDS]->(parent:Contract)-[:SUPPLIER]->(ps:Party)
        RETURN c.id AS id, c.number AS number, coalesce(s.name, ps.name) AS supplier, p.name AS product,
               l.unit_price AS price, l.unit AS unit, l.valid_from AS valid_from, l.valid_to AS valid_to
        ORDER BY product, coalesce(valid_from, '')
        """, q=match_form(a.product), raw=a.product.strip().lower())
    out = []
    for r in rows:
        if not _allowed([r["id"]], restrict):
            continue
        rec = store.get(r["id"])
        if rec:
            vf, vt = r["valid_from"], r["valid_to"]
            mark = ("CHƯA HIỆU LỰC" if vf and vf > today else "ĐÃ HẾT HIỆU LỰC" if vt and vt < today
                    else "ĐANG HIỆU LỰC")
            out.append(_item(rec, f"{r['product']} · NCC {r['supplier']} · {_vnd(r['price'])} đ/{r['unit'] or ''} · "
                                  f"hiệu lực {r['valid_from'] or 'từ đầu HĐ'} → {r['valid_to'] or 'hết HĐ'} · HĐ {r['number']} · {mark}"))
    return out


def search_clauses(a: SearchClauses, restrict: list[str] | None, today: str) -> list[dict]:
    ids = a.contract_ids
    if restrict is not None:
        ids = [i for i in (ids or restrict) if i in restrict]
    vec = embed_texts([a.query])[0]
    hits = os_store.hybrid_search(a.query, vec, k=8, domain="contract", contract_ids=ids)
    if not hits and a.contract_ids:   # the planner's own narrowing missed; the request's scope still holds
        hits = os_store.hybrid_search(a.query, vec, k=8, domain="contract", contract_ids=restrict)
    out = []
    cache: dict[str, dict | None] = {}
    for h in hits:
        rec = cache.setdefault(h["doc_id"], store.get(h["doc_id"]))
        if not rec:
            continue
        topic = next((c["topic"] for c in rec["clauses"] if c["chunk_id"] == h["id"]), None)
        label = "" if rec["status"] in CONFIRMED else " [chưa xác nhận]"
        f = {k: v["value"] for k, v in rec["fields"].items()}
        # The assistant only reads the text: which contract a clause is from must be in it.
        src = f"[HĐ {f.get('number') or rec['title']} · {f.get('supplier_name') or '—'} → {f.get('buyer_name') or '—'}]"
        out.append({**_item(rec, f"{src} {h['text']}{label}", kind="clause"), "chunk_id": h["id"], "score": h.get("score", 0),
                    "on_topic": not a.topic or topic in (None, a.topic)})
    # A topic ranks clauses, never hides them: a late-payment penalty often sits in the payment article.
    return sorted(out, key=lambda i: not i.pop("on_topic"))


_RISK = {"source_expiring": "NGUỒN SẮP HẾT HẠN", "source_ended": "NGUỒN ĐÃ HẾT HIỆU LỰC"}


def margins(a: Margins, restrict: list[str] | None, today: str) -> list[dict]:
    from app.contracts import products, sourcing      # products imports the companies store, which imports this
    recs = {r["id"]: r for r in store.list_all() if r["status"] in CONFIRMED and _allowed([r["id"]], restrict)}
    rows = every = sourcing.sales(products.lines(list(recs), today), recs)

    def words(q: str | None, hay: str) -> bool:
        return all(w in search_form(hay) for w in search_form(q or "").split())

    def has(party: dict | None, q: str | None) -> bool:
        return not q or bool(party) and words(q, f"{party.get('name') or ''} {party.get('key') or ''}")
    want = a.contract_id and _resolve(a.contract_id, restrict)
    rows = [r for r in rows if words(a.product, f"{r['name']} {r['code'] or ''}")
            and has(r["customer"], a.customer) and (not a.supplier or has((r["source"] or {}).get("supplier"), a.supplier))
            and (not want or want in (r["contract_id"], (r["source"] or {}).get("contract_id")))
            and (not a.at_risk_only or r["risk"])]
    if not rows and every:     # say so, or the answer falls back on clause text that does not answer it
        asked = "có nguồn mua sắp hoặc đã hết hạn" if a.at_risk_only else "khớp câu hỏi"
        return [_item(recs[every[0]["contract_id"]], f"Trong {len(every)} dòng hàng đang bán theo hợp đồng bán đã xác "
                                                    f"nhận, không có dòng nào {asked}.")]
    key, _, way = (a.order_by or "").rpartition("_")
    if key in ("price", "margin", "margin_pct", "profit"):
        have = [r for r in rows if r[key] is not None]           # lines without that number go last, either way
        rows = sorted(have, key=lambda r: r[key], reverse=way == "desc") + [r for r in rows if r[key] is None]
    out = []
    for r in rows[:a.limit]:
        s, unit = r["source"], r["unit"] or "đv"
        bought = (f"mua từ NCC {s['supplier']['name']} (HĐ {s['number']}, hết hạn {s['end_date'] or '—'}) giá mua "
                  f"{_vnd(s['price'])} đ{' · tự chọn' if s['mode'] == 'chosen' else ''}" if s
                  else "không có hợp đồng mua sản phẩm này (có thể là dịch vụ tự làm)")
        margin = (f" · lãi {_vnd(r['margin'])} đ/{unit} ({r['margin_pct']:.1f}%)".replace(".", ",", 1)
                  if r["margin"] is not None else "")
        profit = f" · lãi theo số lượng HĐ {_vnd(r['profit'])} đ" if r["profit"] is not None else ""
        risk = f" · {_RISK[r['risk']]}" if r["risk"] else ""
        out.append(_item(recs[r["contract_id"]], f"HĐ bán {r['number']} · KH {r['customer']['name'] or 'chưa rõ'} · {r['name']} · "
                                                  f"SL {_vnd(r['qty'])} {unit} · giá bán {_vnd(r['price'])} đ · {bought}"
                                                  f"{margin}{profit}{risk}"))
    if len(rows) > 1:          # the assistant must not add numbers up itself
        total = sum(r["profit"] or 0 for r in rows)
        first = recs[rows[0]["contract_id"]]
        out.append(_item(first, f"Tổng {len(rows)} dòng bán: lãi theo số lượng HĐ cộng lại {_vnd(total)} đ; "
                                f"{sum(1 for r in rows if r['risk'])} dòng có nguồn sắp/đã hết hạn; "
                                f"{sum(1 for r in rows if not r['source'])} dòng không có hợp đồng mua."))
    return out


TOOLS: dict[str, tuple[type[BaseModel], Callable]] = {
    "margins": (Margins, margins),
    "find_contracts": (FindContracts, find_contracts),
    "contract_facts": (ContractFacts, contract_facts),
    "amendments_of": (AmendmentsOf, amendments_of),
    "price_history": (PriceHistory, price_history),
    "search_clauses": (SearchClauses, search_clauses),
}


def run_tool(name: str, args_json: str, restrict: list[str] | None, today: str | None = None) -> list[dict]:
    if name not in TOOLS:
        return []
    model, fn = TOOLS[name]
    try:
        args = model.model_validate_json(args_json or "{}")
    except ValidationError:
        log.info("tool %s rejected arguments %s", name, args_json)
        return []
    return fn(args, restrict, today or today_vn().isoformat())


def openai_specs() -> list[dict]:
    return [pydantic_function_tool(model, name=name, description=(model.__doc__ or "").strip())
            for name, (model, _) in TOOLS.items()]
