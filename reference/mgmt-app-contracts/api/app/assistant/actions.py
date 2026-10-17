"""What the CLI assistant may DO for the person ("làm giúp"), on top of the read tools and proposals in tools.py.

Every action calls the very route function the page's button calls, with the person's own Ctx, so it can do exactly
what they could do by hand (a viewer is refused, a contract outside their view is "không tìm thấy").

Routine, reversible actions run directly; what is hard to undo (inviting someone, a manual score adjustment,
deleting) stays a card the person clicks. Each write must quote the words of the person's own message that asked for
it (`user_asked`); the endpoint checks the quote against the real question, so text read from a contract or a web
page cannot trigger a change by itself (routes/assistant.py: run_tool)."""
from datetime import date

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app import access, orgs
from app.assistant.tools import Result, _item, _match, _vi, _vnd, find_partners, one_partner
from app.cks import overview as cks
from app.companies import store as cstore
from app.ledger import payments
from app.ledger import types as t
from app.prices import compare as prices

ASKED = Field(description="the exact words of the person's message that ask for this change, copied verbatim")


class ListPayments(BaseModel):
    """Open instalments (or recently settled with filter=done) with their ids, partner, contract, amount and due date.
    Call this first to find the id before settling, postponing or reminding."""
    filter: str = Field("all", description="all | receive | pay | overdue | done")
    partner: str | None = Field(None, description="partner name fragment")


def list_payments(a: ListPayments, ctx: orgs.Ctx, today: date) -> Result:
    from app.contracts import store
    from app.ledger import obligations
    seen = set(ctx.visible_ids())
    recs = [r for r in store.list_org(ctx.org_id) if r["id"] in seen]
    board = payments.board(recs, [o for o in obligations.list_org(ctx.org_id) if o["contract_id"] in seen], today,
                           a.filter if a.filter in payments.FILTERS else "all")
    rows = _match(a.partner, board["rows"], "party") if a.partner else board["rows"]
    s = board["stats"]
    items = [_item("Thanh toán", f"Còn phải thu {_vnd(s['receive_open'])}, phải trả {_vnd(s['pay_open'])}, quá hạn "
                   f"{s['overdue_count']} đợt ({_vnd(s['overdue_amount'])}).", "app://contracts")]
    for r in rows[:15]:
        state = (f"xong {_vi(r['done_at'])}" if r["status"] == t.DONE else
                 f"trễ {r['days_late']} ngày" if r["days_late"] else f"hạn {_vi(r['due_date'])}")
        items.append(_item(r["party"] or "đối tác", f"id={r['id']}: {'Phải thu' if r['direction'] == t.RECEIVE else 'Phải trả'} "
                           f"{r['party']} {_vnd(r['amount'])}, {r['contract_title']} đợt {r['seq']}/{r['of']}, {state}.",
                           f"app://contracts/{r['contract_id']}"))
    return items, []


def _ob_text(ob: dict, what: str) -> list[dict]:
    return [_item("Thanh toán", f"Đã {what}: đợt {ob['seq']} {_vnd(ob.get('amount'))}, hạn {_vi(ob['due_date'])}.",
                  f"app://contracts/{ob['contract_id']}")]


class SettlePayment(BaseModel):
    """Mark an instalment paid (we paid a supplier) or collected (a customer paid us): "Đã trả" / "Đã thu"."""
    obligation_id: str
    at: date | None = Field(None, description="day it was paid; empty for today")
    user_asked: str = ASKED


def settle_payment(a: SettlePayment, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import obligations as r
    ob = r.settle(a.obligation_id, r.Settle(at=a.at), ctx)
    return _ob_text(ob, "ghi " + ("đã thu" if ob["direction"] == t.RECEIVE else "đã trả")), []


class PostponePayment(BaseModel):
    """"Khách hẹn lại": move an instalment to a later date the customer promised, and remind the person then
    (remind_at, default 09:00 that day)."""
    obligation_id: str
    to: date
    remind_at: str | None = Field(None, description="when to remind, YYYY-MM-DDTHH:MM Vietnam time; empty: 09:00 on `to`")
    note: str | None = None
    user_asked: str = ASKED


def postpone_payment(a: PostponePayment, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import obligations as r
    at = a.remind_at or f"{a.to.isoformat()}T09:00"
    ob = r.postpone(a.obligation_id, r.Postpone(to=a.to, note=a.note, remind_at=at), ctx)
    return _ob_text(ob, f"dời hẹn sang {_vi(a.to.isoformat())}, sẽ nhắc lúc {at[11:16]} {_vi(at[:10])}"), []


class SetReminder(BaseModel):
    """"Hẹn nhắc": remind the person at a date and time about an instalment (obligation_id) or a customer/partner
    (partner name), e.g. "nhắc tôi 3 giờ chiều mai gọi Bếp Việt"."""
    at: str = Field(description="YYYY-MM-DDTHH:MM, Vietnam time")
    obligation_id: str | None = None
    partner: str | None = Field(None, description="partner name fragment, when it is not about one instalment")
    note: str | None = None
    user_asked: str = ASKED


def set_reminder(a: SetReminder, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes.followups import remind_me
    if a.obligation_id:
        f = remind_me(ctx, "obligation", a.obligation_id, a.at, note=a.note)
    else:
        if not a.partner:
            raise HTTPException(404, "Không tìm thấy đối tác ''")
        p = one_partner(ctx, a.partner, today)
        name = p["name"]
        title = (a.note if name.lower() in (a.note or "").lower() else f"{a.note}: {name}") if a.note else f"Liên hệ {name}"
        f = remind_me(ctx, "company", p["id"], a.at, title=title)
    return [_item("Hẹn nhắc", f"Đã hẹn nhắc \"{f['title']}\" lúc {f['at'][11:16]} {_vi(f['at'][:10])}.", f["link"])], []


class RemindPayment(BaseModel):
    """Record that we reminded the partner about an instalment ("Đã nhắc"), and optionally when to chase again."""
    obligation_id: str
    next_at: str | None = Field(None, description="remind the person again at YYYY-MM-DDTHH:MM (Vietnam time) if still unpaid")
    user_asked: str = ASKED


def remind_payment(a: RemindPayment, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import obligations as r
    return _ob_text(r.remind(a.obligation_id, r.Remind(next_at=a.next_at), ctx=ctx),
                    "ghi đã nhắc" + (f", sẽ nhắc lại lúc {a.next_at[11:16]} {_vi(a.next_at[:10])}" if a.next_at else "")), []


class RecordPartnerEvent(BaseModel):
    """Record a complaint, a delivery (on time or N days late) or an appointment kept/missed for a partner.
    (A manual score adjustment is not here: propose it with record_event, the person confirms it.)"""
    name: str = Field(description="partner name fragment")
    role: str = Field(description="customer or supplier")
    type: str = Field(description="complaint | delivered | appointment_kept | appointment_missed")
    note: str | None = None
    days_late: int | None = None
    user_asked: str = ASKED


def record_partner_event(a: RecordPartnerEvent, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import partner_events as r
    if a.type == t.MANUAL_ADJUST or a.type not in t.MANUAL_TYPES:
        raise HTTPException(422, "Loại sự kiện không hợp lệ (chỉnh điểm: dùng record_event để người dùng xác nhận)")
    c = one_partner(ctx, a.name, today)
    r.create(r.NewEvent(company_id=c["id"], role=a.role, type=a.type, note=a.note, days_late=a.days_late), ctx)
    words = {"complaint": "khiếu nại", "delivered": "lần giao hàng", "appointment_kept": "giữ hẹn", "appointment_missed": "lỡ hẹn"}
    return [_item(c["name"], f"Đã ghi {words[a.type]} cho {c['name']}" + (f": {a.note}" if a.note else "") + ".",
                  f"app://partners/{c['id']}")], []


class AddQuote(BaseModel):
    """Save a supplier's price quote for a product we buy (it then shows in So sánh giá). A link is checked by the server."""
    product: str = Field(description="product name fragment, e.g. Thịt heo")
    supplier_name: str
    price: int = Field(gt=0, description="unit price in đồng")
    quoted_at: date | None = None
    url: str | None = None
    note: str | None = None
    user_asked: str = ASKED


def add_quote(a: AddQuote, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import prices as r
    prods = _match(a.product, prices.product_list(ctx.org_id, ctx.visible_ids(), today, access.view(ctx)), "label")
    if not prods:
        raise HTTPException(404, f"Không có mặt hàng nào khớp '{a.product}'")
    q = r.add_quote(r.NewQuote(product=prods[0]["key"], supplier_name=a.supplier_name, price=a.price,
                               quoted_at=a.quoted_at or today, url=a.url, note=a.note), ctx)
    check = {True: ", đã thấy đúng con số trên trang", False: ", chưa thấy con số trên trang"}.get(q.get("verified"), "")
    return [_item(q["product_name"], f"Đã lưu báo giá {q['supplier_name']} {_vnd(q['price'])}/{q.get('unit') or 'đv'} "
                  f"cho {q['product_name']}{check}.", f"app://prices?product={q['product']}")], []


class RenewCksGroup(BaseModel):
    """Start renewing a customer's group of digital signatures (the sale expiring first). New serials come later."""
    customer: str = Field(description="customer name fragment")
    years: int = 1
    user_asked: str = ASKED


def renew_cks_group(a: RenewCksGroup, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import cks as r
    from app.assistant.actions_more import _customer
    rows = [_customer(ctx, a.customer, today)]           # one customer, or ask which ("Minh Anh" / "Minh Long")
    sales = sorted((s for row in rows for s in row["sales"] if not s["renewal"] and s["valid_to"]), key=lambda s: s["valid_to"])
    if not sales:
        busy = [s for row in rows for s in row["sales"] if (s.get("renewal") or {}).get("status") == "open"]
        if busy:
            return [_item(rows[0]["name"], f"Nhóm {busy[0]['count']} chữ ký của {rows[0]['name']} ĐANG được gia hạn rồi (chưa nhập "
                          "serial mới). Không cần mở lại: khi có serial mới, bấm Nhập serial mới ở trang khách.",
                          f"app://cks/{rows[0]['company_id']}")], []
        raise HTTPException(404, f"Không có nhóm chữ ký nào của '{a.customer}' để gia hạn")
    s = sales[0]
    r.renew(s["contract_id"], r.Renew(years=a.years), ctx)
    return [_item(rows[0]["name"], f"Đã mở gia hạn nhóm {s['count']} chữ ký của {rows[0]['name']} (hết hạn {_vi(s['valid_to'])}). "
                  "Khi có số serial mới, bấm Hoàn tất gia hạn ở trang khách.", f"app://cks/{rows[0]['company_id']}")], []


class ScanMarketPrice(BaseModel):
    """Ask AI to look up on the internet what other sellers charge for a digital-signature package; it takes a few
    minutes and the prices then show in So sánh giá › Chữ ký số."""
    ca: str = Field(description="CA name, e.g. Viettel-CA, VNPT-CA, FPT-CA, MISA eSign")
    years: int = 1
    device: str = Field("token", description="token | remote")
    user_asked: str = ASKED


def scan_market_price(a: ScanMarketPrice, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import prices as r
    job = r.scan_market(r.Scan(ca=a.ca, years=a.years, device=a.device), ctx)
    return [_item("Dò giá", f"Đã bắt đầu dò giá {a.ca} {a.years} năm ({a.device}); khoảng 3–5 phút có kết quả "
                  f"(trạng thái: {job['state']}).", "app://prices?tab=cks")], []


class MarketCheapest(BaseModel):
    """Cheapest public price of every CA (Viettel, VNPT, FPT, EasyCA…) for one term and device, before VAT, with who
    sells it and the link, next to what we pay ourselves. Use for "đâu rẻ nhất", "nên nhập của ai"."""
    years: int = 1
    device: str = Field("token", description="token | remote")


def market_cheapest(a: MarketCheapest, ctx: orgs.Ctx, today: date) -> Result:
    from app.prices import market_scan as ms
    board = ms.cheapest(ctx.org_id, a.years, a.device, access.view(ctx))
    if not board["rows"]:
        return [_item("Giá thị trường", f"Chưa có giá đã kiểm cho gói {a.years} năm ({a.device}); có thể dò toàn thị trường.",
                      "app://prices?tab=cks")], []
    items = [_item(r["ca_name"], f"{r['ca_name']}: rẻ nhất {_vnd(r['min'])} chưa VAT ({r['cheapest']['seller']}, "
                   f"{'chính hãng' if r['cheapest']['tier'] == 'official' else 'đại lý'}, {r['cheapest']['url']})"
                   + (f"; cấp mới từ {_vnd(r['min_new'])}" if r["min_new"] else "")
                   + (f"; gia hạn từ {_vnd(r['min_renew'])}" if r["min_renew"] else "")
                   + (f"; mình đang nhập {_vnd(r['ours'])}" if r["ours"] else "; mình chưa nhập gói này")
                   + f"; {r['n']} nguồn, ngày {_vi(r['seen'])}.", "app://prices?tab=cks") for r in board["rows"][:12]]
    return items, []


class ScanWholeMarket(BaseModel):
    """Ask AI to survey every CA's public price for one term and device (a few minutes); the cheapest show in
    So sánh giá › Chữ ký số › Giá rẻ nhất thị trường."""
    years: int = 1
    device: str = Field("token", description="token | remote")
    user_asked: str = ASKED


def scan_whole_market(a: ScanWholeMarket, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import prices as r
    job = r.scan_market(r.Scan(scope="market", years=a.years, device=a.device), ctx)
    return [_item("Dò toàn thị trường", f"Đã bắt đầu dò giá mọi nhà cung cấp, gói {a.years} năm ({a.device}); khoảng 5–10 phút "
                  f"có kết quả (trạng thái: {job['state']}).", "app://prices?tab=cks")], []


class PartnerOverview(BaseModel):
    """Everything about one partner company — or a person (a signature holder like "Lê Văn Tâm") or a signature
    serial ("5401 0B72 33AF 9E10"), found through their company: contracts (how many, buying/selling, in force/ended, value, nearest end), digital signatures (who,
    CA, expiry, renewal), open payments, reputation score, price quotes. Use for "X có bao nhiêu hợp đồng / chữ ký",
    "tình hình với X", and before advising how to renew with X."""
    name: str = Field(description="company or person name fragment")


def _party_ids(rec: dict) -> set[str]:
    """Both parties of a contract as partner ids: the directory's when reading the contract found one, else the id the
    MST (or the name) on the contract gives — what Đối tác lists for a party whose MST the tax office did not find."""
    from app.companies import registry
    ids = {((rec.get("parties") or {}).get(s) or {}).get("company_id") for s in ("buyer", "supplier")}
    for s in ("buyer", "supplier"):
        tax = registry.normalize_tax_id(str(rec["fields"].get(f"{s}_tax_id", {}).get("value") or "")) or None
        name = rec["fields"].get(f"{s}_name", {}).get("value")
        if tax or name:
            ids.add(cstore.company_id(rec.get("org_id"), tax, None if tax else name))
    return ids - {None}


def partner_overview(a: PartnerOverview, ctx: orgs.Ctx, today: date) -> Result:
    from app.contracts import store
    from app.ledger import obligations
    from app.scoring import service as scoring
    from app.store import docs
    from app.store import opensearch as os_store
    view = access.view(ctx)
    cks_rows = cks.customers(ctx.org_id, today, view=view)
    who_key = lambda c: [{"name": f"{c.get('holder_name')} {c.get('keeper') or ''} {c.get('serial') or ''}"}]  # noqa: E731 - person or serial
    by_person = [r for r in cks_rows for c in r["certs"] if _match(a.name, who_key(c))]
    # the directory, plus parties of our contracts it has no entry for (an MST the tax office did not find)
    companies = {p["id"]: cstore.get(p["id"]) or p for p in find_partners(ctx, a.name, today)}
    for r in by_person:
        c = cstore.get(r["company_id"])
        if c:
            companies[c["id"]] = c
    if not companies:
        return [_item("Đối tác", f"Không tìm thấy đối tác hay người nào tên '{a.name}' trong phạm vi bạn xem được.", "app://partners")], []
    recs = ctx.visible(store.list_org(ctx.org_id))
    scores = {p["company_id"]: p for p in scoring.partners(ctx.org_id, today, view=view)}
    items = []
    for cid, c in list(companies.items())[:3]:
        name = c.get("name") or cid
        mine = [r for r in recs if r["kind"] == "contract" and cid in _party_ids(r)]
        end = lambda r: r["fields"]["end_date"]["value"] or ""  # noqa: E731
        live = [r for r in mine if end(r) >= today.isoformat()]
        sales = [r for r in mine if r.get("direction") == "sale"]
        lines = [f"{len(mine)} hợp đồng ({len(sales)} bán cho họ, {len(mine) - len(sales)} mua của họ; {len(live)} còn hiệu lực, "
                 f"{len(mine) - len(live)} đã hết hạn), tổng giá trị {_vnd(sum(r['fields']['total_value']['value'] or 0 for r in mine))}"]
        for r in sorted(live, key=end)[:6]:
            f = r["fields"]
            lines.append(f"HĐ {f['number']['value'] or ''} «{f['title']['value'] or ''}» {'bán' if r.get('direction') == 'sale' else 'mua'}, "
                         f"{_vnd(f['total_value']['value'])}, hết hạn {_vi(end(r))}, báo trước {f['notice_days']['value'] or '—'} ngày")
        row = next((x for x in cks_rows if x["company_id"] == cid), None)
        if row:
            lines.append(f"Chữ ký số: {row['cert_count']} chữ ký, hết hạn sớm nhất {_vi(row['earliest'])} (còn {row['days_left']} ngày)"
                         + (", khách tự mua nơi khác" if row["elsewhere"] else "") + ": "
                         + "; ".join(f"{x['label']} ({x['ca']}, hết hạn {_vi(x['valid_to'])}, đã ký {x['signed_count']} văn bản)"
                                     for x in row["certs"]))
            for s in row["sales"]:
                lines.append(f"Nhóm HĐ {s.get('number') or ''}: {s['count']} chữ ký × {_vnd(s.get('price_each'))} = {_vnd(s.get('total'))}"
                             + (", đang gia hạn" if (s.get("renewal") or {}).get("status") == "open" else ""))
        obs = [o for o in obligations.list_org(ctx.org_id, status="open", company_id=cid) if o["contract_id"] in {r["id"] for r in recs}]
        lines.append("Công nợ đang mở với riêng đối tác này: " + ("; ".join(
            f"{'phải thu' if o['direction'] == t.RECEIVE else 'phải trả'} {_vnd(o['amount'])} hạn {_vi(o['due_date'])}" for o in obs[:6])
            if obs else "không có đợt nào"))
        p = scores.get(cid)
        if p:
            band = {"good": "Tốt", "fair": "Khá", "watch": "Chú ý"}.get(p["band"] or "", "chưa đủ dữ liệu")
            lines.append(f"Uy tín: {p['score'] if p['score'] is not None else '–'} điểm, mức {band}; {p['reason']}")
        qs = docs.find(os_store.QUOTES, ctx.org_id, supplier_company_id=cid)
        if qs:
            lines.append("Báo giá: " + "; ".join(f"{q['product_name']} {_vnd(q['price'])}/{q.get('unit') or 'đv'} ngày {_vi(q['quoted_at'])}" for q in qs[:4]))
        who = [x for r in by_person if r["company_id"] == cid for x in r["certs"]
               if _match(a.name, who_key(x))]
        head = f"{name}" + (" (khớp với điều bạn tìm: " + ", ".join(
            f"chữ ký «{x['label']}» serial {x.get('serial') or '—'}" + (f", người giữ token {x['keeper']}" if x.get("keeper") else "")
            for x in who) + " — là chữ ký của công ty này)" if who else "")
        items.append(_item(name, head + ". " + ". ".join(lines) + ".", f"app://partners/{cid}"))
    return items, []


class SendFeedback(BaseModel):
    """Góp ý về app: send the person's feedback, bug report or wish to the app team (anyone may, viewers too). It is
    kept in the app and posted to the team's Trello board."""
    purpose: str = Field("", description="one short line: what the feedback is about / wants (becomes the card title)")
    text: str = Field(description="the full description in the person's words: what happened, where, what they expected")
    topic: str | None = Field(None, description="lỗi | đề xuất | khen | khác")
    page: str | None = Field(None, description="the page the person is on, e.g. contracts or payments")
    file_ids: list[str] = Field(default_factory=list, description="attached screenshots/files to send along")
    user_asked: str = ASKED


def send_feedback(a: SendFeedback, ctx: orgs.Ctx, today: date) -> Result:
    from app.assistant import files
    from app.routes.feedback import store_feedback
    if not a.text.strip() and not a.purpose.strip():
        raise HTTPException(422, "Góp ý trống")
    got = [files.load(ctx, x) for x in a.file_ids[:20]]      # the screenshots go with it, as in the popup
    page = a.page and (a.page if a.page.startswith("/") else f"/{a.page.split()[0]}")
    f = store_feedback(ctx, purpose=a.purpose, description=a.text, kind=a.topic, page=page, source="assistant",
                       files=[(meta["name"], raw) for meta, raw in got])
    return [_item("Góp ý", f"Đã gửi góp ý «{f['purpose'] or a.text[:60]}» ({f['kind']}"
                  + (f", kèm {len(got)} file" if got else "") + f") tới nhóm làm app, mã {f['id'][:8]}. Cảm ơn anh/chị!",
                  "app://feedback")], []


class RatePartner(BaseModel):
    """Rate a partner 0–100 on a criterion the owner added to the scoring ("Tự chấm" in Cách tính điểm uy tín),
    e.g. "chấm Bếp Việt chất lượng hàng 80". The latest rating counts in the score; earlier ones stay in history.
    Words around the score ("chấm Lạc Hồng 70, phần mềm hay treo") are the reason for THIS rating — about the partner and
    what they deliver, not feedback about our app: put them in `note`."""
    name: str = Field(description="partner name fragment; add its MST when two partners share a name ('Hưng Phát 0999000014')")
    role: str = Field(description="customer or supplier")
    criterion: str = Field(description="criterion name fragment, e.g. Chất lượng hàng")
    value: int = Field(ge=0, le=100)
    note: str | None = Field(None, description="why this score, in the person's words (e.g. 'phần mềm hay treo')")
    user_asked: str = ASKED


def rate_partner(a: RatePartner, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import scoring as r
    from app.scoring import service as scoring_service
    if a.role not in t.ROLES:
        raise HTTPException(422, "Vai trò phải là customer hoặc supplier")
    c = one_partner(ctx, a.name, today)
    manual = [x for x in scoring_service.get_config(ctx.org_id, a.role)["criteria"] if x["kind"] == "manual"]
    crits = _match(a.criterion, manual, "label")
    if not crits:
        raise HTTPException(422, f"Không có tiêu chí tự chấm nào khớp '{a.criterion}': quản lý thêm tiêu chí trong "
                                 "Cài đặt › Cách tính điểm uy tín trước")
    r.rate(c["id"], r.Rating(role=a.role, criterion=crits[0]["key"], value=a.value, note=a.note), ctx)
    return [_item(c["name"], f"Đã chấm {c['name']} «{crits[0]['label']}» {a.value}/100"
                  + (f": {a.note}" if a.note else "") + ".", f"app://partners/{c['id']}")], []


ACTIONS = {
    "list_payments": (ListPayments, list_payments), "rate_partner": (RatePartner, rate_partner), "settle_payment": (SettlePayment, settle_payment),
    "postpone_payment": (PostponePayment, postpone_payment), "remind_payment": (RemindPayment, remind_payment),
    "record_partner_event": (RecordPartnerEvent, record_partner_event), "add_quote": (AddQuote, add_quote),
    "renew_cks_group": (RenewCksGroup, renew_cks_group), "scan_market_price": (ScanMarketPrice, scan_market_price),
    "set_reminder": (SetReminder, set_reminder), "market_cheapest": (MarketCheapest, market_cheapest),
    "scan_whole_market": (ScanWholeMarket, scan_whole_market), "partner_overview": (PartnerOverview, partner_overview),
    "send_feedback": (SendFeedback, send_feedback),
}
from app.assistant import actions_more  # noqa: E402 - files, CKS stock and sales, renewals, schedules, reminders

ACTIONS.update(actions_more.ACTIONS)
WRITES = {n for n, (m, _) in ACTIONS.items() if "user_asked" in m.model_fields}
FOR_VIEWERS = {"send_feedback"}          # a write, but not to business data: viewers may give feedback too
