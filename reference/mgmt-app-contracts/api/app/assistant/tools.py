"""What the assistant can look up and propose, beyond the contract tools (app/contracts/tools.py, reused as is).

Each tool returns (items, cards). Items are facts with every number already computed, so the answer only has to say
them; cards are actions a person confirms with one click. Nothing here writes: the assistant proposes, people decide."""
from collections.abc import Callable
from datetime import date

from pydantic import BaseModel, Field

from app import access, orgs
from app.assistant import search_all
from app.assistant.cards import card, link, money, post
from app.cks import overview as cks
from app.cks import lots as lots_
from app.cks import store as cks_store
from app.companies import store as cstore
from app.contracts import products
from app.contracts import tools as contract_tools
from app.ingest.resolve import search_form
from app.ledger import obligations, types as t
from app.prices import compare as prices
from app.scoring import service as scoring
from app.scoring.labels import LABEL
from app.store import docs
from app.store import opensearch as os_store

Result = tuple[list[dict], list[dict]]


def _item(title: str, text: str, uri: str) -> dict:
    return {"doc_id": uri, "title": title, "uri": uri, "text": text}


def _vnd(n: int | None) -> str:
    return "—" if n is None else f"{n:,}".replace(",", ".") + " đ"


def _vi(iso: str | None) -> str:
    return "—" if not iso else "/".join(reversed(iso[:10].split("-")))


def _match(name: str, rows: list[dict], key: str = "name") -> list[dict]:
    words = search_form(name or "").split()
    return [r for r in rows if all(w in search_form(r.get(key) or "") for w in words)]


def find_partners(ctx: orgs.Ctx, name: str, today: date) -> list[dict]:
    """Partners this person sees whose name matches, as Đối tác lists them: the directory plus parties of their
    contracts that have no entry yet (an MST the tax office did not find). Each is {id, name}; acting on one through
    its route gives it an entry."""
    view = access.view(ctx)
    rows = {c["id"]: {"id": c["id"], "name": c.get("name") or c.get("short_name") or ""}
            for c in cstore.list_org(ctx.org_id) if view.company(c["id"]) and not c.get("own")}
    for p in scoring.partners(ctx.org_id, today, view=view):
        rows.setdefault(p["company_id"], {"id": p["company_id"], "name": p["name"]})
    return _match(name, list(rows.values()))


def _mst(cid: str) -> str | None:
    return cid.split("|tax:", 1)[1] if "|tax:" in cid else None


def one_partner(ctx: orgs.Ctx, name: str, today: date) -> dict:
    """The one partner a person means, for a change. An MST in the words picks exactly ("Hưng Phát 0999000014"); the
    exact name beats a longer one that contains it; among namesakes the one we deal with (contracts, ledger) beats a
    directory entry an old quote made. Still several: 409 listing each with its MST, so the person can say which."""
    import re
    from fastapi import HTTPException
    digits = re.findall(r"\b\d{10}(?:\d{3})?\b", name or "")
    words = re.sub(r"\b\d{10}(?:\d{3})?\b", " ", name or "").strip()
    found = find_partners(ctx, words or name, today)
    if digits:
        found = [c for c in found if _mst(c["id"]) in digits] or [c for c in find_partners(ctx, "", today)
                                                                 if _mst(c["id"]) in digits]
    if not found:
        raise HTTPException(404, f"Không tìm thấy đối tác '{name}'")
    exact = [c for c in found if search_form(c["name"]) == search_form(words)]
    found = exact or found
    if len(found) > 1:
        dealt = {p["company_id"] for p in scoring.partners(ctx.org_id, today, view=access.view(ctx))}
        found = [c for c in found if c["id"] in dealt] or found
    if len(found) > 1:
        raise HTTPException(409, "Có nhiều đối tác khớp: " + "; ".join(
            f"{c['name']} (MST {_mst(c['id']) or 'chưa có'})" for c in found[:6])
            + " — hỏi lại là ai; gọi lại kèm MST trong tên để chọn đúng")
    return found[0]


# ---- partners / reputation ----

class PartnerScore(BaseModel):
    """Reputation of partners (customers or suppliers): score, band and the facts behind each criterion.
    Use for "is X a good customer/supplier", "who is reliable", "should we renew with X"."""
    name: str | None = Field(None, description="partner name fragment; empty for every partner")
    role: str | None = Field(None, description="customer or supplier")


def partner_score(a: PartnerScore, ctx: orgs.Ctx, today: date) -> Result:
    rows = scoring.partners(ctx.org_id, today, a.role if a.role in t.ROLES else None, view=access.view(ctx))
    rows = _match(a.name, rows) if a.name else rows
    items = []
    for p in rows[:8]:
        band = {"good": "Tốt", "fair": "Khá", "watch": "Chú ý"}.get(p["band"] or "", "chưa đủ dữ liệu")
        parts = [f"{v.get('label') or LABEL.get(k, k)}: {v['value']}/100 ({v['detail']})" for k, v in p["breakdown"].items()
                 if v.get("value") is not None and v.get("detail")]
        role = "khách hàng" if p["role"] == "customer" else "nhà cung cấp"
        items.append(_item(p["name"], f"{p['name']} ({role}): {p['score'] if p['score'] is not None else '–'} điểm, "
                           f"mức {band}. Lý do chính: {p['reason']}. Chi tiết: {'; '.join(parts) or 'chưa có'}."
                           + (f" Chỉnh tay {p['adjust']:+d} điểm." if p["adjust"] else ""), f"app://partners/{p['company_id']}"))
    return items, []


class ScoreChange(BaseModel):
    """Why a partner's score changed after the scoring settings were last saved."""
    name: str


def score_change(a: ScoreChange, ctx: orgs.Ctx, today: date) -> Result:
    now = {p["company_id"]: p for p in _match(a.name, scoring.partners(ctx.org_id, today, view=access.view(ctx)))}
    items = []
    for cid, p in list(now.items())[:3]:
        snaps = docs.find(os_store.SCORE_SNAPSHOTS, ctx.org_id, sort="-config_version", company_id=cid, role=p["role"])
        hist = scoring.history(ctx.org_id, p["role"])
        before = snaps[1]["score"] if len(snaps) > 1 else None
        items.append(_item(p["name"], f"{p['name']}: điểm hiện tại {p['score']}, trước lần đổi cách tính gần nhất "
                           f"{before if before is not None else 'chưa có'}. Lần đổi gần nhất: "
                           f"{hist[0]['summary'] if hist else 'chưa đổi lần nào'}. Tiêu chí hiện tại: "
                           + "; ".join(f"{v.get('label') or LABEL.get(k, k)} {v['value']} ({v['detail']})" for k, v in p["breakdown"].items()
                                       if v.get("value") is not None), f"app://partners/{cid}"))
    return items, []


class RecordEvent(BaseModel):
    """Propose recording something about a partner: complaint, delivery (on time or late), appointment kept or
    missed, or a manual score adjustment (-10..+10, owner only, reason required). Returns a card to confirm."""
    name: str
    role: str = Field(description="customer or supplier")
    type: str = Field(description="complaint | delivered | appointment_kept | appointment_missed | manual_adjust")
    note: str | None = None
    days_late: int | None = None
    delta: int | None = None


def record_event(a: RecordEvent, ctx: orgs.Ctx, today: date) -> Result:
    from fastapi import HTTPException
    try:
        found = [one_partner(ctx, a.name, today)]
    except HTTPException as e:
        if e.status_code == 409:
            return [_item("Ghi sự kiện", e.detail, "app://partners")], []
        found = []
    if not found or a.type not in t.MANUAL_TYPES or a.role not in t.ROLES:
        return [_item("Ghi sự kiện", f"Không tìm thấy đối tác '{a.name}' hoặc loại sự kiện không hợp lệ.", "app://partners")], []
    c = found[0]
    words = {"complaint": "Ghi khiếu nại", "delivered": "Ghi lần giao hàng", "appointment_kept": "Ghi giữ hẹn",
             "appointment_missed": "Ghi lỡ hẹn", "manual_adjust": f"Chỉnh điểm {a.delta or 0:+d}"}[a.type]
    body = {"company_id": c["id"], "role": a.role, "type": a.type, "note": a.note, "days_late": a.days_late, "delta": a.delta}
    return ([_item(c["name"], f"Đề xuất: {words} cho {c['name']}. Người dùng cần bấm xác nhận.", f"app://partners/{c['id']}")],
            [card(f"ev:{c['id']}:{a.type}", "record_event", "info", words, c["name"], body=a.note,
                  actions=[post("Xác nhận", "/partner-events", body, primary=True)])])


# ---- prices ----

class PriceCompare(BaseModel):
    """Suppliers of one product side by side: unit price, where it comes from, reputation, gap to the cheapest,
    yearly difference at the contract's quantity. Use for "which supplier should we choose/renew"."""
    product: str = Field(description="product name fragment")


def price_compare(a: PriceCompare, ctx: orgs.Ctx, today: date) -> Result:
    ids = ctx.visible_ids()
    view = access.view(ctx)
    prods = _match(a.product, prices.product_list(ctx.org_id, ids, today, view), "label")
    if not prods:
        return [_item("So sánh giá", f"Không có mặt hàng nào khớp '{a.product}'.", "app://prices")], []
    p = prods[0]
    sc = {x["company_id"]: x for x in scoring.partners(ctx.org_id, today, "supplier", view=view)}
    cmp = prices.compare(ctx.org_id, ids, p["key"], today, sc, view)
    rows = cmp["rows"]
    cheapest = min((r["price"] for r in rows), default=None)
    lines = []
    qty = next((ln["qty"] for ln in products.lines(ids, today.isoformat(), product=p["key"])
                if ln["role"] == "supplier" and ln["current"] and ln["qty"]), None)
    for r in rows:
        gap = (r["price"] - cheapest) if cheapest is not None else 0
        src = {"contract": "hợp đồng hiện tại", "quote": f"báo giá {_vi(r['source']['date'])}",
               "website": f"website NCC {_vi(r['source']['date'])}"}[r["source"]["type"]]
        partner = sc.get(r["supplier_company_id"] or "")
        late = (partner or {}).get("breakdown", {}).get("delivery_on_time", {})
        lines.append(f"{r['supplier']}: {_vnd(r['price'])}/{r['unit'] or 'đv'} ({src})"
                     + (f", đắt hơn rẻ nhất {_vnd(gap)} ({100 * gap / cheapest:.1f}%)" if gap and cheapest else ", rẻ nhất")
                     + (f", khoảng {_vnd(gap * int(qty))}/năm theo số lượng HĐ" if gap and qty else "")
                     + (f", uy tín {r['score']} ({late.get('detail') or ''})" if r["score"] is not None else ", chưa có lịch sử")
                     + (" — nhà cung cấp mới" if r["is_new"] else ""))
    m = cmp["market"]
    lines.append(f"Giá thị trường: {_vnd(m['min'])} – {_vnd(m['max'])}" if m["status"] == "ok" else "Giá thị trường: chưa có")
    return ([_item(p["label"], f"{p['label']}. " + " | ".join(lines), f"app://prices/{p['key']}")],
            [card(f"cmp:{p['key']}", "link", "info", "So sánh giá", p["label"], actions=[link("Mở bảng so sánh", f"/prices?product={p['key']}")])])


# ---- CKS ----

class CksPrices(BaseModel):
    """Digital-signature packages we buy and sell: buying price, selling price, margin per signature, how many sold
    in 12 months, and public prices of other sellers (official CA pages and resellers, with links). Use for "which
    package should we buy/sell", "are we above the market", "which CA is cheapest", margins on signatures."""
    filter: str = Field("all", description="all | 1y | multi | token | remote")
    ca: str | None = Field(None, description="CA name fragment, e.g. Viettel, VNPT, FPT")


def cks_prices(a: CksPrices, ctx: orgs.Ctx, today: date) -> Result:
    from app.prices import cks as cks_prices_
    got = cks_prices_.packages(ctx.org_id, today, access.view(ctx), a.filter)
    rows = [r for r in got["rows"] if not a.ca or search_form(a.ca) in search_form(r["ca"])]
    items = []
    s = got["stats"]
    items.append(_item("Chữ ký số 12 tháng", f"12 tháng qua: bán {s['sold_12m']} chữ ký, doanh thu {_vnd(s['revenue'])}, lãi gộp "
                       f"{_vnd(s['gross_profit'])}, biên lãi trung bình {s['margin_pct'] if s['margin_pct'] is not None else '—'}%.",
                       "app://prices?tab=cks"))
    for r in rows:
        m = r["market"]
        market_txt = (f"giá người bán khác {_vnd(m['min'])} – {_vnd(m['max'])} ({m['n']} nguồn: "
                      + ", ".join(f"{x['seller']} {'chính hãng' if x['tier'] == 'official' else 'đại lý'} {_vnd(x['price'])}"
                                  for x in m["sources"][:4]) + ")") if m else "chưa có giá thị trường"
        flags = {"cheapest_buy": "giá mua thấp nhất cùng thời hạn", "above_market": "đang bán cao hơn thị trường"}
        items.append(_item(r["label"], f"{r['label']} ({r['device_label']}): mua {_vnd(r['buy'])}, bán {_vnd(r['sell'])}, "
                           f"lãi {_vnd(r['margin'])}/chữ ký ({r['margin_pct'] if r['margin_pct'] is not None else '—'}%), "
                           f"đã bán {r['sold']}; {market_txt}"
                           + ("".join(f"; {flags[f]}" for f in r["flags"])) + ".", "app://prices?tab=cks"))
    for lot in cks_store.lots(ctx.org_id):
        v = lots_.view(ctx.org_id, lot)
        if access.view(ctx).lot(lot) and (not a.ca or search_form(a.ca) in search_form(lot["ca"])):
            items.append(_item(f"Lô {lot['label']}", f"Lô {lot['label']} {lot['ca']}: còn {v['in_stock']} chữ ký trong kho.",
                               f"app://cks?lot={lot['id']}"))
    return items, []

class CksStatus(BaseModel):
    """Digital signatures (chữ ký số) of customers: expiry, groups, renewals to propose, customers buying elsewhere."""
    customer: str | None = Field(None, description="customer name fragment; empty for all")
    within_days: int = 30


def cks_status(a: CksStatus, ctx: orgs.Ctx, today: date) -> Result:
    rows = cks.customers(ctx.org_id, today, view=access.view(ctx))
    rows = _match(a.customer, rows) if a.customer else [r for r in rows if r["days_left"] <= a.within_days]
    items, cards = [], []
    for r in rows[:10]:
        state = "ĐÃ HẾT HẠN" if r["days_left"] < 0 else f"còn {r['days_left']} ngày"
        holders = ", ".join(f"{c['label']} ({c['ca']}, hết hạn {_vi(c['valid_to'])}, {c['signed_count']} văn bản)" for c in r["certs"])
        items.append(_item(r["name"], f"{r['name']}: {r['cert_count']} chữ ký, hết hạn sớm nhất {_vi(r['earliest'])} ({state})"
                           + (f", tổng giá bán nhóm {_vnd(r['sale_price'])}" if r["sale_price"] else "")
                           + (", khách tự mua nơi khác (cơ hội bán gia hạn)" if r["elsewhere"] else "") + f". {holders}.",
                           f"app://cks/{r['company_id']}"))
        for s in r["sales"]:
            if not s["renewal"] and s["valid_to"] and (date.fromisoformat(s["valid_to"]) - today).days <= a.within_days:
                cards.append(card(f"cks-renew:{s['contract_id']}", "cks_renew", "soon", "Gia hạn", f"{r['name']}, {s['count']} chữ ký · {money(s['total'])}",
                                  actions=[post("Gia hạn cả nhóm", f"/cks/groups/{s['contract_id']}/renew", primary=True)]))
        if r["elsewhere"]:
            cards.append(card(f"cks-chance:{r['company_id']}", "cks_chance", "info", "Cơ hội", f"{r['name']} tự mua ở {r['ca']}",
                              actions=[link("Tạo hợp đồng bán", f"/cks?sell_to={r['company_id']}")]))
    return items or [_item("Chữ ký số", "Không có chữ ký nào khớp.", "app://cks")], cards


class LotStock(BaseModel):
    """Lots of signatures bought from a CA: sold, to how many customers, left in stock, gross margin."""
    label: str | None = Field(None, description="lot label like 2026-03, or CA name; empty for all")


def lot_stock(a: LotStock, ctx: orgs.Ctx, today: date) -> Result:
    view = access.view(ctx)
    views = [lots_.view(ctx.org_id, lot) for lot in cks_store.lots(ctx.org_id) if view.lot(lot)]
    if a.label:
        views = [v for v in views if search_form(a.label) in search_form(f"{v['label']} {v['ca']}")]
    return [_item(f"Lô {v['label']}", f"Lô {v['label']} ({v['ca']}, {v['qty']} chữ ký, giá vốn {_vnd(v['unit_cost'])}/chữ ký): "
                  f"đã bán {v['sold']} cho {v['customers']} khách, còn {v['in_stock']} trong kho"
                  + (f", lãi gộp {_vnd(v['margin'])}" if v["margin"] is not None else ""), f"app://cks?lot={v['id']}")
            for v in views], []


class SignedUsage(BaseModel):
    """What each signature of a customer signed: counts and shares of invoices, tax returns and contracts."""
    customer: str


def signed_usage(a: SignedUsage, ctx: orgs.Ctx, today: date) -> Result:
    every = cks.customers(ctx.org_id, today, view=access.view(ctx))
    rows = _match(a.customer, every) or [r for r in every if r["company_id"] == a.customer]
    if not rows:
        return [_item("Văn bản đã ký", f"Không tìm thấy khách '{a.customer}'.", "app://cks")], []
    r = rows[0]
    by: dict[str, dict[str, int]] = {}
    for d in docs.find(os_store.SIGNED_DOCS, ctx.org_id, company_id=r["company_id"]):
        by.setdefault(d["certificate_id"] or "", {}).setdefault(d["kind"], 0)
        by[d["certificate_id"] or ""][d["kind"]] += 1
    kinds = {"invoice": "hóa đơn", "tax_return": "tờ khai", "contract": "hợp đồng", "other": "khác"}
    parts = []
    for c in r["certs"]:
        k = by.get(c["id"], {})
        n = sum(k.values())
        share = ", ".join(f"{kinds[x]} {v} ({100 * v // n}%)" for x, v in sorted(k.items(), key=lambda kv: -kv[1])) if n else "chưa có văn bản"
        parts.append(f"{c['label']}: {n} văn bản — {share}")
    total = sum(sum(v.values()) for v in by.values())
    return [_item(r["name"], f"Dựa trên {total} văn bản có trong app của {r['name']}. " + " | ".join(parts)
                  + f". Cả nhóm hết hạn {_vi(r['earliest'])}.", f"app://cks/{r['company_id']}")], []


# ---- money ----

class ObligationsDue(BaseModel):
    """Instalments to pay suppliers or collect from customers that are late or due within N days."""
    within_days: int = 7


def obligations_due(a: ObligationsDue, ctx: orgs.Ctx, today: date) -> Result:
    from datetime import timedelta
    seen = set(ctx.visible_ids())
    limit = (today + timedelta(days=a.within_days)).isoformat()
    rows = [o for o in obligations.list_org(ctx.org_id, status="open") if o["contract_id"] in seen and o["due_date"] <= limit]
    names = {c["id"]: c.get("name") for c in cstore.list_org(ctx.org_id)}
    items = [_item("Thanh toán", ("Phải trả " if o["direction"] == t.PAY else "Phải thu ") + f"{names.get(o['company_id']) or 'đối tác'} "
                   f"{_vnd(o['amount'])}, hạn {_vi(o['due_date'])}"
                   + (f" (trễ {(today - date.fromisoformat(o['due_date'])).days} ngày)" if o["due_date"] < today.isoformat() else ""),
                   f"app://contracts/{o['contract_id']}") for o in rows]
    return items or [_item("Thanh toán", f"Không có khoản nào tới hạn trong {a.within_days} ngày.", "app://contracts")], []


# ---- organisation ----

class InviteMember(BaseModel):
    """Propose inviting a colleague (owner only): email, role editor|viewer. Returns a card to confirm."""
    email: str
    role: str = "editor"


def invite_member(a: InviteMember, ctx: orgs.Ctx, today: date) -> Result:
    if ctx.role != "owner":
        return [_item("Thành viên", "Chỉ chủ sở hữu tổ chức mời được thành viên.", "app://members")], []
    role = a.role if a.role in ("editor", "viewer") else "editor"
    return ([_item("Thành viên", f"Đề xuất mời {a.email} với vai trò {role}. Cần bấm xác nhận.", "app://members")],
            [card(f"invite:{a.email}", "invite", "info", "Mời thành viên", f"{a.email} · {role}",
                  actions=[post("Gửi lời mời", "/org/members", {"email": a.email, "role": role}, primary=True)])])


# ---- the person's own past questions ----

class ChatHistory(BaseModel):
    """What THIS person asked the assistant before, and what it answered ("hôm qua tôi đã hỏi gì?", "tuần trước tôi hỏi
    về Bếp Việt thế nào?"). Only their own chats in this organisation. Returns the questions numbered in time order;
    call again with the same dates and `item` for one question's full answer ("câu thứ 2 em trả lời sao?")."""
    date_from: date = Field(description="first day, YYYY-MM-DD (Vietnam time); hôm qua = today - 1")
    date_to: date | None = Field(None, description="last day, YYYY-MM-DD; default = date_from")
    query: str | None = Field(None, description="only questions about this (words from the question or the answer)")
    item: int | None = Field(None, description="the number of one question in the list: its full answer")


def _asked_turns(ctx: orgs.Ctx, start: date, end: date) -> list[dict]:
    """Each question this person asked between two days (Vietnam time), with its answer, oldest first."""
    from datetime import datetime, timedelta, timezone
    vn = timezone(timedelta(hours=7))
    lo = datetime.combine(start, datetime.min.time(), vn)
    hi = datetime.combine(end + timedelta(days=1), datetime.min.time(), vn)
    r = os_store.client().search(index=os_store.CHATS, body={
        "size": 300, "query": {"bool": {"filter": [
            {"term": {"org_id.keyword": ctx.org_id}}, {"term": {"user_email.keyword": ctx.email}},
            {"range": {"created_at": {"lt": hi.isoformat()}}}],
            "should": [{"range": {"updated_at": {"gte": lo.isoformat()}}}, {"range": {"created_at": {"gte": lo.isoformat()}}}],
            "minimum_should_match": 1}}})
    turns = []
    for h in r["hits"]["hits"]:
        chat, msgs = h["_source"], h["_source"].get("messages") or []
        users = [i for i, m in enumerate(msgs) if m.get("role") == "user"]
        for n, i in enumerate(users):
            # older turns carry no time of their own: the first is when the chat began, the rest when it last moved
            at = msgs[i].get("at") or (chat["created_at"] if n == 0 else chat.get("updated_at") or chat["created_at"])
            when = datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(vn)
            if lo <= when < hi:
                reply = msgs[i + 1] if i + 1 < len(msgs) and msgs[i + 1].get("role") == "assistant" else {}
                turns.append({"at": when, "q": msgs[i].get("content") or "", "a": reply.get("content") or "",
                              "chat": chat["id"]})
    return sorted(turns, key=lambda x: x["at"])


def chat_history(a: ChatHistory, ctx: orgs.Ctx, today: date) -> Result:
    end = a.date_to or a.date_from
    turns = _asked_turns(ctx, a.date_from, end)
    if a.query:
        words = search_form(a.query).split()
        turns = [x for x in turns if all(w in search_form(x["q"] + " " + x["a"]) for w in words)]
    span = _vi(a.date_from.isoformat()) + ("" if end == a.date_from else f" – {_vi(end.isoformat())}")
    if not turns:
        return [_item("Lịch sử hỏi", f"Không có câu hỏi nào {span}" + (f" về «{a.query}»" if a.query else "") + ".",
                      "app://assistant")], []
    if a.item:
        if not 1 <= a.item <= len(turns):
            return [_item("Lịch sử hỏi", f"Chỉ có {len(turns)} câu hỏi {span}.", "app://assistant")], []
        x = turns[a.item - 1]
        return [_item("Lịch sử hỏi", f"Câu {a.item} ({x['at']:%H:%M %d/%m/%Y}): {x['q']}\nTrả lời lúc đó: {x['a'][:3000]}",
                      f"app://assistant/{x['chat']}")], []
    lines = [f"{n}. {x['at']:%H:%M %d/%m}: {x['q'][:200]} → {' '.join(x['a'].split())[:160] or '(không có trả lời)'}"
             for n, x in enumerate(turns[:60], 1)]
    more = f"\n(còn {len(turns) - 60} câu nữa; thu hẹp ngày hoặc từ khoá)" if len(turns) > 60 else ""
    return [_item("Lịch sử hỏi", f"{len(turns)} câu hỏi {span}" + (f" về «{a.query}»" if a.query else "")
                  + ":\n" + "\n".join(lines) + more, "app://assistant")], []


TOOLS: dict[str, tuple[type[BaseModel], Callable[[BaseModel, orgs.Ctx, date], Result]]] = {
    "chat_history": (ChatHistory, chat_history),
    "partner_score": (PartnerScore, partner_score), "score_change": (ScoreChange, score_change),
    "record_event": (RecordEvent, record_event), "price_compare": (PriceCompare, price_compare),
    "cks_status": (CksStatus, cks_status), "lot_stock": (LotStock, lot_stock), "cks_prices": (CksPrices, cks_prices), "signed_usage": (SignedUsage, signed_usage),
    "obligations_due": (ObligationsDue, obligations_due), "invite_member": (InviteMember, invite_member),
}


TOOLS["search_all"] = (search_all.SearchAll, search_all.search_all)
from app.assistant import activity_log  # noqa: E402 - it reuses _item/_vi from here

TOOLS["my_activity"] = (activity_log.MyActivity, activity_log.my_activity)


def specs() -> list[dict]:
    """Every tool in the Messages API shape: ours plus the contract tools."""
    out = [{"name": n, "description": (m.__doc__ or "").strip(), "input_schema": m.model_json_schema()} for n, (m, _) in TOOLS.items()]
    out += [{"name": n, "description": (m.__doc__ or "").strip(), "input_schema": m.model_json_schema()}
            for n, (m, _) in contract_tools.TOOLS.items()]
    return out


def run(name: str, args: dict, ctx: orgs.Ctx, today: date) -> Result:
    import json
    if name in TOOLS:
        model, fn = TOOLS[name]
        return fn(model.model_validate(args), ctx, today)
    if name in contract_tools.TOOLS:
        return contract_tools.run_tool(name, json.dumps(args), ctx.visible_ids(), today.isoformat()), []
    return [], []
