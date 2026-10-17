"""More of the app's features for the CLI assistant, so a person can do by chat what the pages do: files dropped in
the chat (a contract, signed invoices), CKS stock and sales, renewals, payment schedules, categories, reminders.

Same rules as actions.py: each calls the page's own route function with the person's Ctx (their rights), a change
quotes the person's words (`user_asked`), and what is hard to undo (revoke a signature, delete) is only a card."""
from datetime import date, timedelta

from fastapi import BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from app import access, orgs
from app.assistant.cards import card, link, post
from app.assistant.tools import Result, _item, _match, _vi, _vnd
from app.cks import overview as cks
from app.cks import store as cks_store
from app.prices.cks import ca_key

ASKED = Field(description="the exact words of the person's message that ask for this change, copied verbatim")


def _run_background(tasks: BackgroundTasks) -> None:
    """Background work a route queued (reading a contract): run off this request, as FastAPI would after a response."""
    import contextvars
    import threading
    for t in tasks.tasks:
        # a Thread does not carry the caller's context: copy it, so the work still knows whose it is (app/usage.py)
        run = contextvars.copy_context().run
        threading.Thread(target=run, args=(t.func, *t.args), kwargs=t.kwargs, daemon=True).start()


# ---- files dropped in the chat ----

CONTRACT_FIELDS = ("number", "title", "supplier_name", "supplier_tax_id", "buyer_name", "buyer_tax_id",
                   "supplier_representative", "buyer_representative", "start_date", "end_date", "notice_days", "total_value",
                   "payment_terms")
FIELDS_DOC = ("fields: what you read yourself, any of number, title, supplier_name, supplier_tax_id, buyer_name, buyer_tax_id, "
              "supplier_representative / buyer_representative (who signs for each side: 'Nguyễn Văn A – Giám đốc'), "
              "start_date, end_date (YYYY-MM-DD), notice_days, total_value (đồng), payment_terms")


def _review_card(rec_id: str, title: str, fields: dict) -> dict:
    """The panel opens the contract's review page with these values in its fields; the person presses Lưu/Xác nhận."""
    vals = {k: v for k, v in (fields or {}).items() if k in CONTRACT_FIELDS and v not in (None, "")}
    return {"type": "ui", "form": "contract_review", "title": title, "path": f"/contracts/{rec_id}", "open": None,
            "submit": "Xác nhận", "values": vals}


class ImportContract(BaseModel):
    """Add a contract or addendum (phụ lục) file the person attached (PDF, Word, photo) to Hợp đồng and open its
    review page. The app reads the file in the background; ALSO pass what you read in it yourself as `fields`: the
    page shows them filled, so even when the app's reading misses something the person only checks and presses Xác
    nhận. For an addendum pass `amends`: once confirmed, its changes (prices, dates, payment) apply to that contract."""
    file_id: str
    fields: dict = Field(default_factory=dict, description=FIELDS_DOC)
    amends: str | None = Field(None, description="addendum only: number, title or partner of the contract it amends")
    user_asked: str = ASKED


def import_contract(a: ImportContract, ctx: orgs.Ctx, today: date) -> Result:
    from app.assistant import files
    from app.routes import contracts as r
    meta, raw = files.load(ctx, a.file_id)
    parent = _contract(ctx, a.amends) if a.amends else None
    tasks = BackgroundTasks()
    rec = r.upload_bytes(raw, meta["name"], ctx, tasks, parent["id"] if parent else None)
    _run_background(tasks)
    if parent:
        pname = parent["fields"]["number"]["value"] or parent["fields"]["title"]["value"] or parent.get("title")
        return ([_item(meta["name"], f"Đã đưa phụ lục {meta['name']} vào Hợp đồng, gắn với hợp đồng {pname}, và mở trang "
                       "kiểm tra; người dùng kiểm tra rồi bấm Xác nhận thì thay đổi của phụ lục áp vào hợp đồng gốc. "
                       "Chưa xác nhận gì.", f"app://contracts/{rec['id']}")],
                [_review_card(rec["id"], f"Phụ lục {meta['name']}", a.fields)])
    return ([_item(meta["name"], f"Đã đưa {meta['name']} vào Hợp đồng và mở trang kiểm tra"
                   + (" với các thông tin bạn đọc được điền sẵn" if a.fields else "") + "; app đọc xong (khoảng 1 phút) thì "
                   "người dùng kiểm tra rồi bấm Xác nhận. Chưa xác nhận gì.", f"app://contracts/{rec['id']}")],
            [_review_card(rec["id"], f"Hợp đồng {meta['name']}", a.fields)])


class FixContract(BaseModel):
    """Correct a contract's fields when reading went wrong or the person says a value is wrong ("sửa giá trị…",
    "ngày hết hạn sai"): opens its page with the corrected values filled for the person to check and press Lưu /
    Xác nhận. With save=true (only if the person says to save it directly) the values are saved at once."""
    contract: str = Field(description="contract number, title, partner name or id")
    fields: dict = Field(description=FIELDS_DOC)
    save: bool = False
    user_asked: str = ASKED


def fix_contract(a: FixContract, ctx: orgs.Ctx, today: date) -> Result:
    rec = _contract(ctx, a.contract)
    vals = {k: v for k, v in a.fields.items() if k in CONTRACT_FIELDS and v not in (None, "")}
    if not vals:
        raise HTTPException(422, "Không có trường nào để sửa")
    name = rec["fields"]["title"]["value"] or rec["fields"]["number"]["value"] or rec.get("title") or "hợp đồng này"
    if not a.save:
        return ([_item(name, f"Đã mở hợp đồng «{name}» với các giá trị sửa điền sẵn ({', '.join(vals)}); người dùng kiểm tra "
                       "rồi bấm Lưu (hoặc Xác nhận). Chưa lưu gì.", f"app://contracts/{rec['id']}")],
                [_review_card(rec["id"], f"Sửa hợp đồng «{name}»", vals)])
    from app.routes import contracts as r
    tasks = BackgroundTasks()
    from app.cks.importer import _int
    for k in ("notice_days", "total_value"):
        if k in vals:                  # a number stays a number (92500000.0 is not 925000000); text is read as Vietnamese
            vals[k] = _int(vals[k])
    r.update(rec["id"], r.Patch(fields=vals), tasks, ctx)
    _run_background(tasks)
    return [_item(name, f"Đã lưu sửa hợp đồng «{name}»: " + ", ".join(f"{k}={v}" for k, v in vals.items()) + ".",
                  f"app://contracts/{rec['id']}")], []


class ImportSignedDocs(BaseModel):
    """Count documents a customer signed with their digital signatures: attached signed invoices / tax returns (XML)
    or signed PDFs. Each signature found is matched to the customer's CKS (shows on their page)."""
    file_ids: list[str]
    user_asked: str = ASKED


def import_signed_docs(a: ImportSignedDocs, ctx: orgs.Ctx, today: date) -> Result:
    from app.assistant import files
    from app.signed import parse, store
    if not ctx.can_write():
        raise HTTPException(403, "Người xem không được tải văn bản")
    total = {"added": 0, "skipped": 0, "unmatched": 0, "unreadable": 0}
    for fid in a.file_ids[:50]:
        meta, raw = files.load(ctx, fid)
        if not meta["name"].lower().endswith((".xml", ".pdf")):
            total["unreadable"] += 1
            continue
        for k, v in store.add(ctx.org_id, parse.parse(raw, meta["name"]), meta["name"], ctx.email).items():
            total[k] += v
    return [_item("Văn bản đã ký", f"Đã đọc {len(a.file_ids)} file: thêm {total['added']} văn bản đã ký, {total['skipped']} đã có từ "
                  f"trước, {total['unmatched']} không khớp chữ ký nào trong app, {total['unreadable']} không đọc được.", "app://cks")], []


# ---- CKS ----

def _one(rows: list[dict], name: str, label, what: str) -> dict:
    """The single row a change is about: an exact match wins over ones that merely contain the words; several left →
    409 listing them, so the assistant asks which instead of acting on whichever came first."""
    from app.ingest.resolve import search_form
    exact = [r for r in rows if search_form(label(r)) == search_form(name)]
    rows = exact or rows
    if len(rows) > 1:
        raise HTTPException(409, f"Có {len(rows)} {what} khớp '{name}': " + "; ".join(label(r) for r in rows[:6])
                            + " — hỏi lại người dùng là cái nào, rồi gọi lại với đúng tên/số đó")
    return rows[0]


def _customer(ctx: orgs.Ctx, name: str, today: date) -> dict:
    rows = _match(name, cks.customers(ctx.org_id, today, view=access.view(ctx)))
    if not rows:
        raise HTTPException(404, f"Không tìm thấy khách chữ ký số '{name}'")
    return _one(rows, name, lambda r: r["name"], "khách chữ ký số")


class CreateCksLot(BaseModel):
    """Record a lot of digital signatures bought from a CA (nhập lô): CA, how many, unit cost, term, device."""
    ca: str
    qty: int = Field(gt=0)
    unit_cost: int = Field(ge=0, description="đồng per signature")
    years: int = 1
    device: str = Field("token", description="token | remote")
    bought_at: date | None = None
    user_asked: str = ASKED


def create_cks_lot(a: CreateCksLot, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import cks as r
    v = r.create_lot(r.NewLot(ca=a.ca, supplier_name=a.ca, qty=a.qty, unit_cost=a.unit_cost, years=a.years, device=a.device,
                              bought_at=a.bought_at or today), ctx)
    return [_item(f"Lô {v['label']}", f"Đã nhập lô {v['label']}: {a.qty} chữ ký {a.ca} {a.years} năm ({a.device}), giá vốn "
                  f"{_vnd(a.unit_cost)}/chữ ký.", f"app://cks?lot={v['id']}")], []


class Holder(BaseModel):
    name: str
    title: str | None = None
    device: str = "token"
    serial: str | None = None


class SellCks(BaseModel):
    """Sell digital signatures to a customer from a lot in stock (creates the sale contract and the certificates)."""
    customer: str = Field(description="customer company name")
    tax_id: str | None = None
    ca: str
    years: int = 1
    device: str = "token"
    price_each: int = Field(ge=0)
    holders: list[Holder] = Field(min_length=1, description="who holds each signature")
    signed_at: date | None = None
    user_asked: str = ASKED


def _known_customer(ctx: orgs.Ctx, name: str, tax_id: str | None, today: date) -> tuple[str, str | None]:
    """(name, MST) to file a signature under: the partner already in the app when the words name one ("Bếp Việt" →
    "Công ty TNHH Bếp Việt", its MST), so a sale typed in chat never makes a second "Bếp Việt"; a new one as given.
    Several partners fit → 409, ask which."""
    if tax_id:
        return name, tax_id
    from app.assistant.tools import _mst, one_partner
    try:
        c = one_partner(ctx, name, today)
    except HTTPException as e:
        if e.status_code == 404:
            return name, None
        raise
    return c["name"], _mst(c["id"])


def _years_later(d: date, years: int) -> date:
    """Same day N years on (29/02 → 28/02): a CA's term, not 365 days a year."""
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, day=28)


def sell_cks(a: SellCks, ctx: orgs.Ctx, today: date) -> Result:
    from app.cks import lots
    from app.routes import cks as r
    view = access.view(ctx)
    stock = [lots.view(ctx.org_id, lot) for lot in cks_store.lots(ctx.org_id)
             if view.lot(lot) and ca_key(lot["ca"]) == ca_key(a.ca) and lot["years"] == a.years and (lot.get("device") or "token") == a.device]
    stock = [s for s in stock if s["in_stock"] >= len(a.holders)]
    if not stock:
        raise HTTPException(409, f"Không còn lô {a.ca} {a.years} năm ({a.device}) đủ {len(a.holders)} chữ ký trong kho")
    lot = min(stock, key=lambda s: s.get("bought_at") or "")               # oldest stock first
    signed = a.signed_at or today
    name, tax = _known_customer(ctx, a.customer, a.tax_id, today)
    got = r.sell(r.NewSale(company_name=name, company_tax_id=tax, lot_id=lot["id"], price_each=a.price_each,
                           signed_at=signed, valid_to=_years_later(signed, a.years),
                           holders=[r.Holder(**h.model_dump()) for h in a.holders]), ctx)
    return ([_item(a.customer, f"Đã tạo hợp đồng bán {got['number']}: {len(a.holders)} chữ ký {a.ca} × {_vnd(a.price_each)} cho "
                   f"{a.customer}, lấy từ lô {lot['label']}.", f"app://contracts/{got['contract_id']}")],
            [card(f"sale:{got['contract_id']}", "link", "info", "Đã bán", a.customer, actions=[link("Mở hợp đồng", f"/contracts/{got['contract_id']}")])])


class AddCustomerCertificate(BaseModel):
    """Track a customer's signature bought ELSEWHERE (to offer its renewal later)."""
    customer: str
    ca: str
    valid_to: date
    serial: str | None = None
    holder_name: str = "Chữ ký công ty"
    tax_id: str | None = Field(None, description="the customer's MST when the person gives it")
    user_asked: str = ASKED


def add_customer_certificate(a: AddCustomerCertificate, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import cks as r
    name, tax = _known_customer(ctx, a.customer, a.tax_id, today)
    r.add_certificate(r.NewCert(company_name=name, company_tax_id=tax, ca=a.ca, serial=a.serial, valid_to=a.valid_to,
                                holder_name=a.holder_name), ctx)
    return [_item(a.customer, f"Đã ghi chữ ký {a.holder_name} ({a.ca}) của {a.customer}, hết hạn {_vi(a.valid_to.isoformat())}; "
                  "app sẽ nhắc chào gia hạn.", "app://cks")], []


class CompleteRenewal(BaseModel):
    """Finish a renewal in progress with the new serials ("Nhập serial mới"): {holder label or name: new serial}."""
    customer: str
    serials: dict[str, str] = {}
    valid_to: date | None = None
    user_asked: str = ASKED


def complete_renewal(a: CompleteRenewal, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import cks as r
    row = _customer(ctx, a.customer, today)
    open_ = [s for s in row["sales"] if (s.get("renewal") or {}).get("status") == "open"]
    if not open_:
        raise HTTPException(404, f"{row['name']} không có lần gia hạn nào đang mở")
    sale = open_[0]
    certs = [c for c in row["certs"] if c.get("sale_contract_id") == sale["contract_id"]]
    serials = {}
    for key, serial in a.serials.items():            # the person names holders their way: match label or name
        # one holder per key and one key per holder: two "Giám đốc" must be told apart, never both land on the first
        hits = [c for c in certs if c["id"] not in serials and
                (key == c["id"] or _match(key, [{"name": f"{c['label']} {c.get('holder_name') or ''}"}]))]
        if len(hits) > 1:
            raise HTTPException(409, f"'{key}' khớp {len(hits)} chữ ký: " + "; ".join(
                f"{c['label']} {c.get('holder_name') or ''}".strip() for c in hits) + " — hỏi lại serial nào của ai")
        if hits:
            serials[hits[0]["id"]] = serial
    r.complete(sale["renewal"]["id"], r.Complete(serials=serials, valid_to=a.valid_to), ctx)
    return [_item(row["name"], f"Đã hoàn tất gia hạn nhóm {len(certs)} chữ ký của {row['name']}"
                  + (f", ghi {len(serials)} serial mới" if serials else "") + ".", f"app://cks/{row['company_id']}")], []


class RenewalLost(BaseModel):
    """The customer renewed elsewhere / will not renew: close the renewal in progress as lost, with the reason."""
    customer: str
    reason: str
    user_asked: str = ASKED


def renewal_lost(a: RenewalLost, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import cks as r
    row = _customer(ctx, a.customer, today)
    open_ = [s for s in row["sales"] if (s.get("renewal") or {}).get("status") == "open"]
    if not open_:
        raise HTTPException(404, f"{row['name']} không có lần gia hạn nào đang mở")
    r.mark_lost(open_[0]["renewal"]["id"], r.Lost(reason=a.reason), ctx)
    return [_item(row["name"], f"Đã ghi {row['name']} không gia hạn: {a.reason}.", f"app://cks/{row['company_id']}")], []


class RevokeCertificate(BaseModel):
    """Propose revoking (thu hồi) a customer's signature: returns a card the person confirms."""
    customer: str
    holder: str = Field(description="holder label or name")


def revoke_certificate(a: RevokeCertificate, ctx: orgs.Ctx, today: date) -> Result:
    row = _customer(ctx, a.customer, today)
    c = next((c for c in row["certs"] if _match(a.holder, [{"name": f"{c['label']} {c.get('holder_name') or ''}"}])), None)
    if not c:
        raise HTTPException(404, f"Không thấy chữ ký '{a.holder}' của {row['name']}")
    return ([_item(row["name"], f"Đề xuất thu hồi chữ ký {c['label']} của {row['name']}. Cần bấm xác nhận.", f"app://cks/{row['company_id']}")],
            [card(f"revoke:{c['id']}", "revoke", "late", "Thu hồi chữ ký", f"{c['label']} · {row['name']}",
                  actions=[{"label": "Xác nhận thu hồi", "method": "DELETE", "path": f"/cks/certificates/{c['id']}", "body": {}, "primary": True}])])


# ---- contracts, payments, categories ----

def _contract(ctx: orgs.Ctx, name: str, status: tuple[str, ...] | None = None) -> dict:
    from app.contracts import store
    from app.ingest.resolve import search_form
    q = search_form(name)
    recs = [r for r in ctx.visible(store.list_org(ctx.org_id)) if r["kind"] == "contract"]
    hits = [r for r in recs if r["id"] == name or q in search_form(" ".join(str(r["fields"][k]["value"] or "") for k in
                                                                            ("number", "title", "supplier_name", "buyer_name")))]
    if not hits:
        raise HTTPException(404, f"Không tìm thấy hợp đồng '{name}'")
    if status:
        hits = [r for r in hits if r["status"] in status] or hits
    by_number = [r for r in hits if search_form(r["fields"]["number"]["value"] or "") == q or r["id"] == name]
    cands = by_number or hits
    if len(cands) == 1:
        return cands[0]

    def label(r: dict) -> str:
        f = r["fields"]
        return (f"{f['number']['value'] or f['title']['value'] or r['id']} ({f['supplier_name']['value'] or '—'} → "
                f"{f['buyer_name']['value'] or '—'}, {r['status']})")
    return _one(cands, name, label, "hợp đồng")       # several: ask which, never the latest-ending by chance


class SetPaymentSchedule(BaseModel):
    """Set (replace) the payment instalments of a contract: dates and amounts. Settled instalments are kept."""
    contract: str = Field(description="contract number, title or partner name")
    rows: list[dict] = Field(description='[{"due_date": "YYYY-MM-DD", "amount": 92500000}]')
    user_asked: str = ASKED


def set_payment_schedule(a: SetPaymentSchedule, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import obligations as r
    rec = _contract(ctx, a.contract)
    got = r.put_schedule(rec["id"], r.Schedule(rows=[r.Instalment(**x) for x in a.rows]), ctx)
    f = rec["fields"]
    return [_item(f["title"]["value"] or f["number"]["value"], f"Đã đặt lịch {len(a.rows)} đợt cho HĐ {f['number']['value']}: "
                  + "; ".join(f"{_vi(o['due_date'])} {_vnd(o['amount'])}" for o in got if o["status"] != "done") + ".",
                  f"app://contracts/{rec['id']}")], []


class ConfirmContract(BaseModel):
    """Save a contract that waits for review ("Chờ xác nhận") as it was read: confirm it, reminders and schedule on."""
    contract: str = Field(description="contract number, title, partner name or id")
    user_asked: str = ASKED


def confirm_contract(a: ConfirmContract, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import assistant as r
    rec = _contract(ctx, a.contract, status=("needs_review",))     # "lưu hợp đồng X": the one waiting, not a confirmed one
    if rec["status"] != "needs_review":
        return [_item(rec["fields"]["title"]["value"] or rec["id"], "Hợp đồng này đã được xác nhận từ trước, không có gì để lưu.",
                      f"app://contracts/{rec['id']}")], []
    got = r.save_draft(rec["id"], ctx)
    return [_item(rec["fields"]["title"]["value"] or rec["id"], f"Đã lưu hợp đồng (trạng thái: {got['status']}).",
                  f"app://contracts/{rec['id']}")], []


class CreateCategory(BaseModel):
    """Add a product category (Loại) for the contract list chips."""
    name: str
    user_asked: str = ASKED


def create_category(a: CreateCategory, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import categories as r
    c = r.create(r.Name(name=a.name), ctx)
    return [_item("Loại hàng", f"Đã thêm loại '{c['name']}'.", "app://contracts")], []


class ListReminders(BaseModel):
    """The person's own reminders (Hẹn nhắc) still open, with ids."""


def list_reminders(a: ListReminders, ctx: orgs.Ctx, today: date) -> Result:
    from app.ledger import followups
    rows = followups.mine(ctx.org_id, ctx.email)
    return [_item("Hẹn nhắc", f"id={f['id']}: {f['title']} lúc {f['at'][11:16]} {_vi(f['at'][:10])}"
                  + (" (đã đến giờ)" if f["status"] == "sent" else ""), "app://contracts") for f in rows] or \
        [_item("Hẹn nhắc", "Không có hẹn nhắc nào đang mở.", "app://contracts")], []


class ReminderDone(BaseModel):
    """Mark one of the person's reminders done, or move it (at = YYYY-MM-DDTHH:MM)."""
    reminder_id: str
    at: str | None = Field(None, description="move to this time instead of closing it")
    user_asked: str = ASKED


def reminder_done(a: ReminderDone, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import followups as r
    f = r.snooze(a.reminder_id, r.Snooze(at=a.at), ctx) if a.at else r.done(a.reminder_id, ctx)
    return [_item("Hẹn nhắc", f"Đã {'dời' if a.at else 'xong'}: {f['title']}" + (f" → {f['at'][11:16]} {_vi(f['at'][:10])}" if a.at else ""),
                  "app://contracts")], []


# ---- open a page's form and fill it, for the person to check and press the button themselves ----

FORMS = {   # form id → (what it is, its submit button, who may use it: "write" or "any")
    "contract_new": ("Thêm hợp đồng (nhập tay)", "Lưu hợp đồng", "write"),
    "quote": ("Thêm báo giá", "Lưu báo giá", "write"),
    "cks_lot": ("Nhập lô mua chữ ký số", "Nhập lô", "write"),
    "cks_sale": ("Hợp đồng bán chữ ký số", "Tạo hợp đồng bán", "write"),
    "renewal_complete": ("Hoàn tất gia hạn (serial mới)", "Hoàn tất", "write"),
    "feedback": ("Góp ý về app", "Gửi góp ý", "any"),
}


class OpenForm(BaseModel):
    """Open a page's form with its fields already filled, for the person to check and press its button themselves
    (nothing is saved by this tool). Prefer it whenever the person asks to ADD/CREATE something that has a form:
    form = contract_new {direction: purchase|sale, number, title, partner_name, partner_tax_id, partner_signer, our_signer
    ("Nguyễn Văn A – Giám đốc"), start_date, end_date (YYYY-MM-DD), notice_days, total_value, payment_terms,
    items: [{name, unit, qty, unit_price}]} ·
    quote {product (name), supplier, tax, price, date, url} · cks_lot {ca, label, qty, cost, years, date, device:
    token|remote} · cks_sale {customer, tax, ca, years, device, price, signed, valid, holders: [{name, serial,
    device}]} · renewal_complete {customer, serials: {holder name: new serial}, valid} · feedback {kind: đề xuất|lỗi|
    khen|khác, purpose: one line, description} (a popup over the current page; to send it at once use send_feedback)."""
    form: str
    values: dict = {}


def open_form(a: OpenForm, ctx: orgs.Ctx, today: date) -> Result:
    from app.cks import lots
    from app.prices import compare as prices
    if a.form not in FORMS:
        raise HTTPException(422, f"Không có form '{a.form}'")
    label, submit, who = FORMS[a.form]
    if who == "write" and not ctx.can_write():
        raise HTTPException(403, "Người xem không được tạo mới")
    v = {k: x for k, x in a.values.items() if x not in (None, "")}
    ui: dict = {"form": a.form, "title": label, "submit": submit, "open": None, "values": {}, "path": ""}
    if a.form == "contract_new":
        ui["path"] = "/contracts/new"
        ui["values"] = v
    elif a.form == "quote":
        prods = _match(str(v.pop("product", "")), prices.product_list(ctx.org_id, ctx.visible_ids(), today, access.view(ctx)), "label")
        if not prods:
            raise HTTPException(404, "Không có mặt hàng này trong So sánh giá")
        ui.update(path=f"/prices?product={prods[0]['key']}", open="+ Thêm báo giá", values=v)
    elif a.form == "cks_lot":
        ui.update(path="/cks", open="+ Nhập lô mua", values=v)
    elif a.form == "cks_sale":
        view = access.view(ctx)
        want = (ca_key(str(v.pop("ca", ""))), int(v.pop("years", 1) or 1), v.pop("device", "token"))
        stock = [lots.view(ctx.org_id, lot) for lot in cks_store.lots(ctx.org_id) if view.lot(lot)]
        hit = [s for s in stock if s["in_stock"] > 0 and (ca_key(s["ca"]), s["years"], s.get("device") or "token") == want] or \
              [s for s in stock if s["in_stock"] > 0 and ca_key(s["ca"]) == want[0]]
        holders = v.pop("holders", []) or []
        out = {"company": v.pop("customer", ""), **v}
        if hit:
            out["lot"] = min(hit, key=lambda s: s.get("bought_at") or "")["id"]
        for i, h in enumerate(holders):
            out[f"h{i}"], out[f"s{i}"], out[f"d{i}"] = h.get("name", ""), h.get("serial", ""), h.get("device", "token")
        ui.update(path="/cks", open="+ Hợp đồng bán chữ ký", values=out)
    elif a.form == "renewal_complete":
        row = _customer(ctx, str(v.get("customer", "")), today)
        open_ = [s for s in row["sales"] if (s.get("renewal") or {}).get("status") == "open"]
        if not open_:
            raise HTTPException(409, f"{row['name']} chưa mở gia hạn: bấm Gia hạn cả nhóm (hoặc nhờ trợ lý) trước")
        certs = [c for c in row["certs"] if c.get("sale_contract_id") == open_[0]["contract_id"]]
        out = {"valid": v["valid"]} if v.get("valid") else {}
        for key, serial in (v.get("serials") or {}).items():
            hit = next((c for c in certs if _match(key, [{"name": f"{c['label']} {c.get('holder_name') or ''}"}])), None)
            if hit:
                out[hit["id"]] = serial
        ui.update(path=f"/cks/{row['company_id']}", open="Nhập serial mới", values=out)
    else:
        ui.update(path="", values=v)        # the Góp ý popup opens over the page the person is on
    shown =", ".join(f"{k}={x}" for k, x in ui["values"].items() if not isinstance(x, (list, dict)))
    return [_item(label, f"Đã mở «{label}» và điền sẵn ({shown}). Người dùng kiểm tra, sửa nếu cần rồi tự bấm «{submit}»; "
                  "chưa có gì được lưu.", f"app://{ui['path'].lstrip('/')}")], [{"type": "ui", **ui}]


class ReadContract(BaseModel):
    """Read the full text of one contract's original file (as the app extracted it): exact wording of a clause,
    "hợp đồng X ghi gì về…", or to check a value the app may have read wrong. For a question across many contracts
    use search_clauses first."""
    contract: str = Field(description="contract number, title, partner name or id")


def read_contract(a: ReadContract, ctx: orgs.Ctx, today: date) -> Result:
    rec = _contract(ctx, a.contract)
    name = rec["fields"]["title"]["value"] or rec["fields"]["number"]["value"] or rec.get("title") or "hợp đồng"
    text = rec.get("source_md") or ""
    if not text:
        return [_item(name, f"Hợp đồng «{name}» không có file gốc (nhập tay) nên không có toàn văn để đọc.",
                      f"app://contracts/{rec['id']}")], []
    f = rec.get("file") or {}
    return [_item(name, f"Toàn văn hợp đồng «{name}» (file {f.get('name', '?')}, mở tại /api/contracts/{rec['id']}/file):\n"
                  + text[:15000] + ("\n… (còn tiếp)" if len(text) > 15000 else ""), f"app://contracts/{rec['id']}")], []


# ---- many signatures at once, from a spreadsheet ----

class ImportCks(BaseModel):
    """Import a customer list of digital signatures from an Excel/CSV file the person attached ("nhập danh sách chữ ký
    số", "nhập hàng loạt khách CKS"). You only say which column is which: `mapping` field → the sheet's column header
    exactly as in the file, from: customer (required), tax_id, holder_name, holder_title, serial, ca, device, years,
    signed_at, valid_to (required, or signed_at + years), price, source (ours = mình bán | elsewhere = khách mua nơi khác),
    paid, contract_number. `defaults` field → value for what the sheet lacks (e.g. {"ca": "Viettel-CA"} or
    {"source": "elsewhere"} when the person says so). The server reads every row and returns a preview with a button;
    NOTHING is saved until the person presses it. Tell them the counts and the rows that cannot be imported."""
    file_id: str
    mapping: dict[str, str]
    defaults: dict = Field(default_factory=dict)


def import_cks(a: ImportCks, ctx: orgs.Ctx, today: date) -> Result:
    from app.routes import cks as r
    p = r.import_sheet(r.ImportCks(file_id=a.file_id, mapping=a.mapping, defaults=a.defaults), ctx)
    head = (f"Xem trước: {p['signatures']} chữ ký của {p['customers']} khách — {p['sold']} chữ ký mình bán "
            f"(thành {p['sales']} hợp đồng bán), {p['elsewhere']} chữ ký khách mua nơi khác (theo dõi để chào gia hạn).")
    errs = f" {p['error_count']} dòng không nhập được: " + "; ".join(p["errors"][:8]) if p["error_count"] else ""
    text = head + errs + " Ví dụ: " + "; ".join(p["sample"]) + ". Chưa ghi gì: người dùng bấm nút trên thẻ để nhập."
    cards = []
    if p["signatures"]:
        cards.append(card(f"import:{a.file_id}", "import", "info", "Nhập danh sách chữ ký số",
                          f"{p['signatures']} chữ ký · {p['customers']} khách", body=head + errs,
                          actions=[post(f"Nhập {p['signatures']} chữ ký", "/cks/import",
                                        {"file_id": a.file_id, "mapping": a.mapping, "defaults": a.defaults, "confirm": True},
                                        primary=True)]))
    return [_item("Nhập chữ ký số", text, "app://cks")], cards


# ---- filter a table on the page, as the person would with its "Lọc" chips ----

TABLES = {   # table → (its page, its name, the fields it filters on: field → what values look like)
    "contracts": ("/contracts", "Hợp đồng", {
        "direction": "Mua / bán: Mua vào (mình mua) | Bán ra (mình bán) | Chưa rõ",
        "category": "Loại hàng (tên loại, vd Bao bì)", "seller": "Bên bán (tên công ty)", "buyer": "Bên mua (tên công ty)",
        "owner": "Phụ trách (tên người)", "signer": "Người ký (tên người)",
        "status": "Trạng thái: Chờ xác nhận | Sắp đáo hạn (hết hạn trong 60 ngày hoặc đã tới hạn báo trước) | Đã hết hạn | "
                  "Đang hiệu lực | Đã xử lý (đã gia hạn / không gia hạn / đã thanh toán) | Đọc lỗi",
        "value": "Giá trị hợp đồng (đ): dùng min / max"}),
    "partners": ("/partners", "Đối tác", {
        "role": "Vai trò: Khách hàng | Nhà cung cấp", "band": "Mức điểm: Tốt | Khá | Chú ý | Chưa có điểm"}),
}
RANGE_FIELDS = {"value"}
# the model may answer with the app's internal words; the page filters on the labels it shows
ALIASES = {
    "status": {"expiring": "Sắp đáo hạn", "sắp hết hạn": "Sắp đáo hạn", "expired": "Đã hết hạn", "hết hạn": "Đã hết hạn",
               "active": "Đang hiệu lực", "còn hiệu lực": "Đang hiệu lực", "hiệu lực": "Đang hiệu lực",
               "needs_review": "Chờ xác nhận", "chưa xác nhận": "Chờ xác nhận"},
    "band": {"good": "Tốt", "fair": "Khá", "watch": "Chú ý", "none": "Chưa có điểm"},
    "direction": {"purchase": "Mua vào", "mua": "Mua vào", "hợp đồng mua": "Mua vào", "sale": "Bán ra", "bán": "Bán ra",
                  "hợp đồng bán": "Bán ra"},
    "role": {"customer": "Khách hàng", "khách": "Khách hàng", "supplier": "Nhà cung cấp", "ncc": "Nhà cung cấp"},
}


def _label(field: str, value: str) -> str:
    return ALIASES.get(field, {}).get(value.strip().lower(), value)


class FilterCond(BaseModel):
    field: str
    values: list[str] = Field(default_factory=list, description="any of these (names as people say them; matched loosely)")
    min: int | None = None
    max: int | None = None


class FilterTable(BaseModel):
    """Show a table filtered, on its page (going there if the person is elsewhere): the same "Lọc" chips a person
    would set, which they can then change or remove. Use when they ask to SEE / LIST / FILTER rows by conditions
    ("lọc hợp đồng của Nhựa Đông Á", "hợp đồng trên 200 triệu", "đối tác mức Chú ý"); answer in a line or two as well.
    Tables and fields: contracts {category, seller, buyer, owner, signer, status, value(min/max)} · partners {role, band}.
    Values are the labels the page shows, in Vietnamese (status: "Sắp đáo hạn", not "expiring").
    `q`: free-text search on top (contract number, product…). An empty `filters` and no `q` clears the table's filters."""
    table: str = Field(description="contracts | partners")
    filters: list[FilterCond] = Field(default_factory=list)
    q: str | None = None


def filter_table(a: FilterTable, ctx: orgs.Ctx, today: date) -> Result:
    if a.table not in TABLES:
        raise HTTPException(422, f"Không có bảng '{a.table}' (chỉ: {', '.join(TABLES)})")
    path, title, fields = TABLES[a.table]
    conds, said = {}, []
    for f in a.filters:
        if f.field not in fields:
            raise HTTPException(422, f"Bảng {title} không lọc theo '{f.field}' (lọc được: {', '.join(fields)})")
        label = fields[f.field].split(":")[0].split(" (")[0]
        if f.field in RANGE_FIELDS:
            if f.min is None and f.max is None:
                continue
            conds[f.field] = {"min": f.min, "max": f.max}
            said.append(f"{label} {'từ ' + _vnd(f.min) if f.min is not None else ''}"
                        f"{' ' if f.min is not None and f.max is not None else ''}{'đến ' + _vnd(f.max) if f.max is not None else ''}")
        elif f.values:
            values = [_label(f.field, v) for v in f.values]
            conds[f.field] = {"in": values}
            said.append(f"{label}: {', '.join(values)}")
    if a.q:
        said.append(f"tìm «{a.q}»")
    card = {"type": "filter", "table": a.table, "path": path, "title": title, "conds": conds, "q": a.q, "summary": said}
    text = (f"Đã lọc bảng {title} trên trang: " + "; ".join(said) if said else f"Đã bỏ mọi bộ lọc của bảng {title}") + \
        ". Người dùng thấy ngay các chip lọc và sửa/bỏ được; số dòng còn lại hiện trên trang."
    return [_item(title, text, f"app://{path.lstrip('/')}")], [card]


ACTIONS = {
    "filter_table": (FilterTable, filter_table), "import_cks": (ImportCks, import_cks),
    "import_contract": (ImportContract, import_contract), "import_signed_docs": (ImportSignedDocs, import_signed_docs),
    "create_cks_lot": (CreateCksLot, create_cks_lot), "sell_cks": (SellCks, sell_cks),
    "add_customer_certificate": (AddCustomerCertificate, add_customer_certificate),
    "complete_renewal": (CompleteRenewal, complete_renewal), "renewal_lost": (RenewalLost, renewal_lost),
    "revoke_certificate": (RevokeCertificate, revoke_certificate), "set_payment_schedule": (SetPaymentSchedule, set_payment_schedule),
    "confirm_contract": (ConfirmContract, confirm_contract), "create_category": (CreateCategory, create_category),
    "list_reminders": (ListReminders, list_reminders), "reminder_done": (ReminderDone, reminder_done),
    "open_form": (OpenForm, open_form), "fix_contract": (FixContract, fix_contract),
    "read_contract": (ReadContract, read_contract),
}
STEPS = {"filter_table": "Lọc bảng", "import_cks": "Đọc danh sách chữ ký số", "import_contract": "Đưa hợp đồng vào app", "import_signed_docs": "Đọc văn bản đã ký", "create_cks_lot": "Nhập lô chữ ký",
         "sell_cks": "Tạo hợp đồng bán chữ ký", "add_customer_certificate": "Ghi chữ ký khách mua nơi khác",
         "complete_renewal": "Hoàn tất gia hạn", "renewal_lost": "Ghi không gia hạn", "revoke_certificate": "Soạn thẻ thu hồi",
         "set_payment_schedule": "Đặt lịch thanh toán", "confirm_contract": "Lưu hợp đồng", "create_category": "Thêm loại hàng",
         "list_reminders": "Xem hẹn nhắc", "reminder_done": "Cập nhật hẹn nhắc", "open_form": "Mở form và điền sẵn",
         "fix_contract": "Sửa thông tin hợp đồng", "read_contract": "Đọc toàn văn hợp đồng"}
