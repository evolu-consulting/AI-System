"""Demo data shaped like the mock (docs/management-app/mock), so a trial organisation opens on a working app.

    SEED_PASSWORD=… python -m app.seed.demo --owner tien@annam.test --create [--today 2026-10-13] [--force]

Every date is relative to `today`, so the demo shows the same to-dos whichever day it is seeded. Ids are fixed per
organisation: running it twice changes nothing. MSTs are made up (0999…) and the registry is never asked; every record
is real data in the app, so all buttons work on it (pay, renew, compare, score)."""
import argparse
from datetime import date, timedelta

from app import orgs
from app.cks import lots as lots_
from app.cks import sales as cks_sales
from app.cks import store as cks_store
from app.companies import store as cstore
from app.contracts import categories as cat
from app.contracts import manual, project, store
from app.contracts.clock import today_vn
from app.ledger import events
from app.ledger import obligations as ob_
from app.scoring import config as scoring_config
from app.scoring import service as scoring
from app.signed import parse as signed_parse
from app.signed import samples
from app.signed import store as signed_store
from app.store import docs
from app.store import opensearch as os_store

US = ("Công ty An Nam", "0999000001")
ORG_NAME, OWNER_NAME = "Công ty An Nam", "Chị Tiên"
CATEGORIES = [("food", "Thực phẩm"), ("cks", "Chữ ký số"), ("supply", "Vật tư"), ("service", "Dịch vụ")]
TAX = {"Thực phẩm Sạch Bình An": "0999000011", "Nông sản Đà Lạt Xanh": "0999000012", "VPP Hồng Hà": "0999000013",
       "Thực phẩm Hưng Phát": "0999000014", "Viettel-CA": "0999000015", "VNPT-CA": "0999000016", "FPT-CA": "0999000017",
       "MISA eSign": "0999000018", "Bếp Việt": "0999000021", "Kế toán Phương Nam": "0999000022",
       "Xây dựng Hưng Thịnh": "0999000023", "Cơ khí Tân Tiến": "0999000024"}

# (key, title, partner, sale?, end offset days, notice, items [(name, category, unit, qty, price)], value)
CONTRACTS = [
    ("pork", "Cung cấp thịt heo", "Thực phẩm Sạch Bình An", False, 7, 30, [("Thịt heo", "food", "kg", 6_000, 98_000)], 588_000_000),
    ("veg", "Cung cấp rau củ, gia vị & bao bì", "Nông sản Đà Lạt Xanh", False, 169, 30,
     [("Rau củ", "food", "kg", 8_000, 18_000), ("Gia vị", "food", "kg", 600, 85_000), ("Bao bì", "supply", "cái", 20_000, 1_200)],
     219_000_000),
    ("meal", "Suất ăn công nghiệp", "Bếp Việt", True, 79, 30, [("Suất ăn", "food", "suất", 24_000, 35_000)], 840_000_000),
    ("vpp", "Văn phòng phẩm 2026", "VPP Hồng Hà", False, 27, 15, [("Văn phòng phẩm", "supply", "gói", 120, 450_000)], 54_000_000),
    ("acc", "Dịch vụ kế toán thuế 2026", "Kế toán Phương Nam", True, 260, 30, [("Dịch vụ kế toán", "service", "tháng", 12, 7_700_000)],
     92_400_000),
    # an older supplier of pork: no longer in force, but its deliveries still make its reputation
    ("hp", "Cung cấp thịt heo 2025", "Thực phẩm Hưng Phát", False, -40, 30, [("Thịt heo", "food", "kg", 3_000, 96_000)], 288_000_000),
    ("old-meal", "Suất ăn công nghiệp 2024", "Bếp Việt", True, -650, 30, [("Suất ăn", "food", "suất", 20_000, 32_000)], 640_000_000),
    ("old-meal2", "Suất ăn công nghiệp 2025", "Bếp Việt", True, -290, 30, [("Suất ăn", "food", "suất", 22_000, 33_500)], 737_000_000),
]


def cid(org_id: str, key: str) -> str:
    return f"demo-{org_id[:8]}-{key}"


def company(org_id: str, name: str) -> str:
    return cstore.company_id(org_id, TAX[name])


def _categories(org_id: str) -> dict[str, str]:
    doc = cat.get(org_id)
    have = {c["name"]: c["id"] for c in doc["categories"]}
    for key, name in CATEGORIES:
        if name not in have:
            doc["categories"].append({"id": f"{key}-{org_id[:6]}", "name": name})
            have[name] = f"{key}-{org_id[:6]}"
    cat.save(doc)
    return {key: have[name] for key, name in CATEGORIES}


def _own_company(org_id: str) -> None:
    c = cstore.get(cstore.company_id(org_id, US[1])) or cstore.new(org_id, US[1], US[0], "manual")
    c["own"] = True
    cstore.save(c)


def contracts(org_id: str, owner: str, today: date) -> None:
    cats = _categories(org_id)
    doc = cat.get(org_id)
    for key, title, partner, sale, end_in, notice, items, value in CONTRACTS:
        for n, c, *_ in items:
            cat.assign(doc, project.product_key(None, n, None, org_id), cats[c])
        if store.get(cid(org_id, key)):
            continue
        them = (partner, TAX[partner])
        seller, buyer = (US, them) if sale else (them, US)
        end = today + timedelta(days=end_in)
        manual.create(org_id, owner, {
            "number": f"{key.upper()}-{end.year}", "title": title, "supplier_name": seller[0], "supplier_tax_id": seller[1],
            "buyer_name": buyer[0], "buyer_tax_id": buyer[1], "start_date": (end - timedelta(days=365)).isoformat(),
            "end_date": end.isoformat(), "notice_days": notice, "total_value": value},
            items=[{"name": n, "unit": u, "qty": q, "unit_price": p} for n, _, u, q, p in items],
            origin="seed", direction="sale" if sale else "purchase", lookup=False, contract_id=cid(org_id, key))
    cat.save(doc)
    for key, *_ in CONTRACTS:
        project.project_contract(cid(org_id, key))


def schedules(org_id: str, owner: str, today: date) -> None:
    """The to-dos of p01: pay Đà Lạt Xanh 85 tr (3 days late), collect 92,5 tr today; the rest settled on time."""
    plan = {
        "veg": [(-33, 85_000_000, True), (-3, 85_000_000, False), (27, 49_000_000, False)],
        "acc": [(-30, 92_500_000, True), (0, 92_500_000, False), (30, 92_500_000, False)],
        "pork": [(-20, 196_000_000, True), (10, 196_000_000, False)],
        "vpp": [(-60, 27_000_000, True), (20, 27_000_000, False)],
        "meal": [(25, 210_000_000, False)],
    }
    for key, rows in plan.items():
        rec = store.get(cid(org_id, key))
        if not rec or ob_.for_contract(org_id, rec["id"]):
            continue
        for i, (off, amount, done) in enumerate(rows, 1):
            due = today + timedelta(days=off)
            o = ob_.create(rec, due.isoformat(), amount, seq=i, source="seed", obligation_id=f"{rec['id']}-{i}")
            if done:
                ob_.settle(o, due, owner)


def ledger(org_id: str, owner: str, today: date) -> None:
    """A year of history per partner, so each scores like on p02 (Phương Nam Tốt, Bếp Việt Chú ý, Hồng Hà –)."""
    if any(e.get("source") == "seed" for e in events.list_for(org_id, company(org_id, "Kế toán Phương Nam"))):
        return
    rec = lambda name, role, type, ago, **kw: events.record(org_id, company(org_id, name), role, type,  # noqa: E731
                                                            today - timedelta(days=ago), owner, source="seed", **kw)
    # Phương Nam: 11 of 12 instalments on time (3 more on-time ones come from the schedule and the two CKS sales)
    for i in range(9):
        rec("Kế toán Phương Nam", "customer", "received", 50 + 30 * i, days_late=4 if i == 5 else 0)
    rec("Kế toán Phương Nam", "customer", "appointment_kept", 45)
    for i in range(12):                                          # Bếp Việt: paid late, chased, postponed
        rec("Bếp Việt", "customer", "received", 15 + 29 * i, days_late=(8 if i % 2 else 0))
    for i in range(5):
        rec("Bếp Việt", "customer", "reminded", 12 + 60 * i)
    for i in range(3):
        rec("Bếp Việt", "customer", "postponed", 30 + 90 * i)
    rec("Bếp Việt", "customer", "cks_renewed", 300, days_before_expiry=-6, with_us=True)
    for i in range(6):                                           # Hưng Thịnh: pays on time, renews early
        rec("Xây dựng Hưng Thịnh", "customer", "received", 40 + 55 * i, days_late=0)
    rec("Xây dựng Hưng Thịnh", "customer", "cks_renewed", 330, days_before_expiry=12, with_us=True)
    for i in range(98):                                          # Bình An: 95 of 98 deliveries on time
        rec("Thực phẩm Sạch Bình An", "supplier", "delivered", 2 + i * 3, days_late=1 if i in (10, 40, 70) else 0)
    for i in range(40):                                          # Đà Lạt Xanh: 6 of 40 late
        rec("Nông sản Đà Lạt Xanh", "supplier", "delivered", 4 + i * 8, days_late=3 if i % 7 == 3 else 0)
    rec("Nông sản Đà Lạt Xanh", "supplier", "complaint", 50, note="rau dập")
    for i in range(20):                                          # Hưng Phát: 4 of 20 late, one complaint
        rec("Thực phẩm Hưng Phát", "supplier", "delivered", 45 + i * 15, days_late=4 if i % 5 == 0 else 0)
    rec("Thực phẩm Hưng Phát", "supplier", "complaint", 120, note="thịt không đạt nhiệt độ")
    rec("VPP Hồng Hà", "supplier", "delivered", 30, days_late=0)       # not enough to score yet


def cks(org_id: str, owner: str, today: date) -> None:
    """Lots and signatures of p04/p05: Bếp Việt's group expiring in 9 days, Bình An's expired, Tân Tiến bought elsewhere."""
    if cks_store.lots(org_id):
        return
    d = lambda n: today + timedelta(days=n)  # noqa: E731
    lot = lambda ca, qty, cost, ago, label, device="token", years=1: lots_.create(  # noqa: E731
        org_id, owner, ca=ca, supplier_name=ca, supplier_tax_id=TAX[ca], qty=qty, unit_cost=cost, years=years, bought_at=d(-ago),
        label=label, paid=True, device=device, lot_id=f"{cid(org_id, 'lot')}-{label}")
    vnpt, viettel, fpt, misa = (lot("VNPT-CA", 10, 1_150_000, 380, "2025-10"),
                                lot("Viettel-CA", 12, 1_050_000, 210, "2026-03", "remote"),
                                lot("FPT-CA", 8, 1_200_000, 360, "2025-11"), lot("MISA eSign", 4, 1_100_000, 375, "2025-09", "remote"))
    vnpt3 = lot("VNPT-CA", 4, 2_700_000, 200, "2026-04-3y", years=3)
    viettel2 = lot("Viettel-CA", 4, 1_900_000, 150, "2026-05-2y", "remote", years=2)
    sell = lambda who, lt, price, ago, valid, holders, number=None, paid=True: cks_sales.sell(  # noqa: E731
        org_id, owner, company_name=who, company_tax_id=TAX.get(who), lot_id=lt["id"], holders=holders, price_each=price,
        signed_at=d(-ago), valid_to=d(valid), number=number, paid=paid)
    sell("Bếp Việt", vnpt, 1_650_000, 356, 9, [
        {"name": "Chữ ký công ty", "serial": "5401 0B72 33AF 9E10", "keeper": "Trần Thu Hà"},
        {"name": "Lê Văn Tâm", "title": "Giám đốc", "device": "remote", "serial": "5401 0B72 33AF 9E11"},
        {"name": "Trần Thu Hà", "title": "Kế toán trưởng", "device": "remote", "serial": "5401 0B72 33AF 9E12"}],
         number=f"CKS-{d(-356).year}-031")
    sell("Thực phẩm Sạch Bình An", misa, 1_600_000, 371, -6, [{"name": "Chữ ký công ty", "serial": "4D15 0001"},
                                                              {"name": "Kế toán", "serial": "4D15 0002", "device": "remote"}])
    sell("Xây dựng Hưng Thịnh", fpt, 1_800_000, 342, 23, [{"name": "Chữ ký công ty", "serial": f"FP7 00{i}"} if i == 1 else
                                                         {"name": f"Chỉ huy trưởng {i}", "serial": f"FP7 00{i}", "device": "remote"}
                                                         for i in range(1, 4)])
    sell("Xây dựng Hưng Thịnh", fpt, 1_800_000, 300, 65, [{"name": "Kế toán", "serial": "FP7 004"}, {"name": "Giám đốc", "serial": "FP7 005"}])
    sell("Kế toán Phương Nam", viettel, 1_500_000, 30, 336, [{"name": "Chữ ký công ty", "serial": "5404 7A01"}], number=f"CKS-{d(-30).year}-044")
    sell("Nông sản Đà Lạt Xanh", viettel, 1_500_000, 100, 260, [{"name": "Chữ ký công ty", "serial": "5404 7A02"},
                                                                {"name": "Kế toán", "serial": "5404 7A03", "device": "remote"}])
    sell("Xây dựng Hưng Thịnh", vnpt3, 3_900_000, 190, 905, [{"name": "Chữ ký công ty (3 năm)", "serial": "5401 0C10"}])
    sell("Kế toán Phương Nam", viettel2, 2_700_000, 140, 590, [{"name": "Kế toán trưởng (2 năm)", "serial": "5404 7B01",
                                                                 "device": "remote"}])
    cks_sales.add_certificate(org_id, company_name="Cơ khí Tân Tiến", company_tax_id=TAX["Cơ khí Tân Tiến"], ca="FPT-CA",
                              serial="FP9 1234", valid_to=d(15), holder_name="Chữ ký công ty", by=owner)


def signed(org_id: str, owner: str, today: date) -> None:
    """What Bếp Việt's signatures signed (p05): the company one mostly invoices, the director contracts."""
    if docs.find(os_store.SIGNED_DOCS, org_id):
        return
    day = lambda n: (today - timedelta(days=n)).isoformat()  # noqa: E731
    files = []
    co, gd, ktt = "5401 0B72 33AF 9E10", "5401 0B72 33AF 9E11", "5401 0B72 33AF 9E12"
    files += [(f"hd-{1245 - i}.xml", samples.invoice_xml(co, "Bếp Việt", 1245 - i, day(5 + i * 10))) for i in range(32)]
    files += [(f"tk-{i}.xml", samples.tax_xml(co, "Bếp Việt", "Tờ khai thuế GTGT", f"quý {(i % 4) + 1}/{today.year - i // 4}",
                                             day(14 + i * 40))) for i in range(9)]
    files += [(f"Hop dong {i}.pdf", samples.signed_pdf(co, "Bếp Việt", day(30 + i * 60))) for i in range(5)]
    files += [(f"Hop dong giam doc {i}.pdf", samples.signed_pdf(gd, "Lê Văn Tâm", day(20 + i * 45))) for i in range(7)]
    files += [(f"hd-ktt-{i}.xml", samples.invoice_xml(ktt, "Trần Thu Hà", 900 + i, day(8 + i * 20))) for i in range(12)]
    files += [(f"tk-ktt-{i}.xml", samples.tax_xml(ktt, "Trần Thu Hà", "Báo cáo tài chính", f"năm {today.year - i}", day(60 + i * 60)))
              for i in range(6)]
    for name, raw in files:
        signed_store.add(org_id, signed_parse.parse(raw, name), name, owner)


def quotes(org_id: str, owner: str, today: date) -> None:
    pork = project.product_key(None, "Thịt heo", None, org_id)
    if docs.find(os_store.QUOTES, org_id, product=pork):
        return
    from app.prices import compare
    for name, price, ago, source, ai in (("Thực phẩm Hưng Phát", 94_500, 3, "quote", False),
                                         ("Chăn nuôi Đồng Nai Xanh", 92_000, 1, "website", True)):
        docs.save(os_store.QUOTES, {
            "org_id": org_id, "product": pork, "product_name": "Thịt heo", "unit": "kg",
            "supplier_company_id": compare.supplier_company(org_id, name, TAX.get(name)), "supplier_name": name, "price": price,
            "quoted_at": (today - timedelta(days=ago)).isoformat(), "source": source,
            "url": "https://example.vn/bang-gia-thit-heo" if source == "website" else None, "verified": None,
            "page_date": None, "note": None, "ai_suggested": ai, "by": owner})


def scoring_history(org_id: str, owner: str, today: date) -> None:
    """The config was saved once without "Gia hạn chữ ký số", then with it: the history p06 shows."""
    if scoring.history(org_id, "customer"):
        return
    base = scoring_config.default("customer")
    without = {"criteria": [{**c, "enabled": c["key"] != "cks_renewal",
                             "weight": {"payment_on_time": 45, "reminders": 20, "cks_renewal": 20}.get(c["key"], c["weight"])}
                            for c in base["criteria"]], "rules": base["rules"]}
    scoring.save_config(org_id, "customer", without, owner, today - timedelta(days=40))
    scoring.save_config(org_id, "customer", {"criteria": base["criteria"], "rules": base["rules"]}, owner, today)


def account(email: str, password: str, name: str = OWNER_NAME, org_name: str = ORG_NAME) -> str:
    """The trial owner and their organisation (An Nam, chị Tiên), made once; the password comes from the caller."""
    from app import auth
    if not auth.get_user(email):
        auth.create_user(email, name, password, role=None)     # a customer: never the staff role of the internal site
    m = orgs.membership(email)
    return m["org_id"] if m else orgs.create_org(org_name, email)["id"]


def reset(owner_email: str) -> str:
    """A fresh demo after people tried things: the organisation is emptied and made again for the same owner; the
    market prices AI researched (minutes of web search each) move to the new organisation instead of being lost."""
    from app.seed.purge import purge
    m = orgs.membership(owner_email)
    if not m or m["role"] != "owner":
        raise SystemExit(f"{owner_email} không phải chủ tổ chức nào")
    name = (orgs.get_org(m["org_id"]) or {}).get("name") or ORG_NAME
    keep = {ix: docs.find(ix, m["org_id"]) for ix in (os_store.MARKET, os_store.MARKET_SCANS)}
    purge(m["org_id"], keep_logs=True)
    org_id = orgs.create_org(name, owner_email)["id"]
    for ix, rows in keep.items():
        if rows:
            docs.save_many(ix, [{**r, "org_id": org_id} for r in rows])
    # the trial's activity log, chat history and feedback stay readable by the same people
    os_store.client().update_by_query(index=f"{os_store.APP_LOGS},{os_store.CHATS},{os_store.FEEDBACK}", refresh=True,
                                      conflicts="proceed", body={
        # chats map org_id as text (+ .keyword): match either form
        "query": {"bool": {"should": [{"term": {"org_id": m["org_id"]}}, {"term": {"org_id.keyword": m["org_id"]}}]}},
        "script": {"source": "ctx._source.org_id = params.o", "params": {"o": org_id}}})
    return org_id


def run(owner_email: str, today: date | None = None, force: bool = False) -> str:
    m = orgs.membership(owner_email)
    if not m:
        raise SystemExit(f"{owner_email} chưa thuộc tổ chức nào")
    org_id = m["org_id"]
    today = today or today_vn()
    real = [r for r in store.list_org(org_id) if r.get("origin") not in ("seed", "cks")]
    if real and not force:
        raise SystemExit("Tổ chức đã có dữ liệu thật; thêm --force nếu vẫn muốn nạp dữ liệu mẫu")
    _own_company(org_id)
    from app.prices import cks as cks_prices
    cks_prices.load_public_prices()                  # shared public prices: idempotent (fixed ids)
    contracts(org_id, owner_email, today)
    schedules(org_id, owner_email, today)
    ledger(org_id, owner_email, today)
    cks(org_id, owner_email, today)
    signed(org_id, owner_email, today)
    quotes(org_id, owner_email, today)
    scoring_history(org_id, owner_email, today)
    return org_id


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--owner", required=True)
    p.add_argument("--today", type=date.fromisoformat)
    p.add_argument("--force", action="store_true")
    p.add_argument("--create", action="store_true", help="make the owner account and organisation (password: SEED_PASSWORD)")
    p.add_argument("--reset", action="store_true", help="wipe the organisation and seed it again, keeping researched market prices")
    a = p.parse_args()
    email = a.owner.strip().lower()
    if a.reset:
        print("reset", reset(email))
    if a.create:
        import os
        account(email, os.environ["SEED_PASSWORD"])
    print("seeded", run(email, a.today, a.force))
