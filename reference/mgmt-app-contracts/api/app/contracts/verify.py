import re
from datetime import date

from app.companies.registry import normalize_tax_id
from app.contracts.fields import FIELD_KINDS, ITEM_KINDS
from app.ingest.resolve import match_form

_MARKUP = re.compile(r"[*_|`#>]")
_SPACE = re.compile(r"\s+")
_DIGIT_GROUP = re.compile(r"(?<=\d)[.,](?=\d{3}(?!\d))")   # never whitespace: "500 320.000" is two numbers
_WORD_MONEY = re.compile(r"(?<![\d.,])(\d+(?:,\d{1,2})?)\s*(ty|trieu|nghin)\b")
_SCALE = {"ty": 1_000_000_000, "trieu": 1_000_000, "nghin": 1_000}


def norm(s: str) -> str:
    return _SPACE.sub(" ", _MARKUP.sub(" ", match_form(s or "").replace("đ", "d"))).strip()   # NFD leaves đ alone


def quote_found(quote: str, md_norm: str) -> bool:
    """PDF text layers often split words ("202 5", "g u i"), so a spacing-only difference still counts as found."""
    q = norm(quote)
    return bool(q) and (q in md_norm or q.replace(" ", "") in md_norm.replace(" ", ""))


def _date_forms(d: date) -> list[str]:
    out = []
    for dd in {f"{d.day:02d}", str(d.day)}:
        for mm in {f"{d.month:02d}", str(d.month)}:
            out += [f"{dd}/{mm}/{d.year}", f"{dd}-{mm}-{d.year}", f"{dd}.{mm}.{d.year}",
                    f"ngay {dd} thang {mm} nam {d.year}"]
    return out


def _numbers(q: str) -> list[float]:
    """Every number the quote states, Vietnamese grouping and word scales understood."""
    q = _DIGIT_GROUP.sub("", q)
    found = [float(x.replace(",", ".")) * _SCALE[unit] for x, unit in _WORD_MONEY.findall(q)]
    rest = _WORD_MONEY.sub(" ", q)
    found += [float(x.replace(",", ".")) for x in re.findall(r"(?<![\d.,])\d+(?:,\d+)?", rest)]
    return found


def value_in_quote(kind: str, value, quote: str) -> bool:
    q = norm(quote)
    if kind == "date":
        d = date.fromisoformat(str(value))
        return any(re.search(rf"(?<!\d){re.escape(f)}(?!\d)", q) for f in _date_forms(d))
    if kind in ("int", "float"):
        return any(abs(n - float(value)) < 0.5 for n in _numbers(q))
    return True


def _check(kind: str, value, quote: str, md_norm: str) -> bool:
    if value is None:
        return False
    return quote_found(quote, md_norm) and value_in_quote(kind, value, quote)


def verify(ex: dict, md: str) -> tuple[dict, list[dict], list[dict]]:
    md_norm = norm(md)
    fields = {}
    for name, kind in FIELD_KINDS.items():
        f = ex.get(name) or {"value": None, "quote": ""}
        fields[name] = {"value": f["value"], "quote": f.get("quote") or "",
                        "verified": _check(kind, f["value"], f.get("quote") or "", md_norm), "edited": False}
    items = []
    for it in ex.get("items") or []:
        row = {k: it.get(k) for k in ITEM_KINDS}
        row["quote"] = it.get("quote") or ""
        ok = quote_found(row["quote"], md_norm) and (
            row["unit_price"] is None or value_in_quote("int", row["unit_price"], row["quote"]))
        items.append({**row, "verified": bool(ok), "edited": False})
    return fields, items, rule_warnings(fields, items)


def _v(fields: dict, name: str):
    return (fields.get(name) or {}).get("value")


def warnings_for(rec: dict) -> list[dict]:
    return rule_warnings(rec["fields"], rec["items"], rec.get("parties"), rec.get("direction_check"))


def rule_warnings(fields: dict, items: list[dict], parties: dict | None = None,
                  direction_check: str | None = None) -> list[dict]:
    w: list[dict] = []
    start, end = _v(fields, "start_date"), _v(fields, "end_date")
    if start and end and end < start:
        w.append({"field": "end_date", "code": "dates_order", "message": "Ngày kết thúc trước ngày bắt đầu."})
    total = _v(fields, "total_value")
    priced = [i for i in items if i.get("qty") is not None and i.get("unit_price") is not None]
    if total and priced and len(priced) == len(items):
        s = sum(i["qty"] * i["unit_price"] for i in priced)
        if _v(fields, "vat_included") and _v(fields, "vat_rate"):
            s *= 1 + _v(fields, "vat_rate") / 100
        if abs(s - total) > 0.01 * total:
            w.append({"field": "total_value", "code": "total_mismatch",
                      "message": f"Tổng các dòng hàng ({round(s):,}) lệch hơn 1% so với giá trị hợp đồng.".replace(",", ".")})
    for name in ("supplier_tax_id", "buyer_tax_id"):
        tax = _v(fields, name)
        if tax and not normalize_tax_id(str(tax)):
            w.append({"field": name, "code": "tax_id_format",
                      "message": "Mã số thuế phải có 10 chữ số, 13 chữ số (chi nhánh) hoặc 12 chữ số (cá nhân)."})
    if _v(fields, "vat_included") is None and (total or items):
        w.append({"field": "vat_included", "code": "vat_unknown", "message": "Chưa xác định giá đã gồm VAT hay chưa."})
    if _v(fields, "auto_renew") and _v(fields, "notice_days") is None:
        w.append({"field": "notice_days", "code": "notice_missing",
                  "message": "Hợp đồng tự động gia hạn nhưng chưa có số ngày báo trước."})
    if direction_check == "none_own":
        w.append({"field": None, "code": "direction_unknown",
                  "message": "Không bên nào là pháp nhân của mình, nên chưa biết đây là HĐ mua hay bán. "
                             "Kiểm tra MST hai bên, hoặc đánh dấu pháp nhân trong mục Đối tác."})
    elif direction_check == "both_own":
        w.append({"field": None, "code": "direction_internal",
                  "message": "Cả hai bên đều là pháp nhân của mình (giao dịch nội bộ)."})
    return w + party_warnings(fields, parties or {})


_SIDE_LABEL = {"supplier": "bên bán", "buyer": "bên mua"}


def party_warnings(fields: dict, parties: dict) -> list[dict]:
    """What the tax registry says about each party; `parties` comes from app.companies.enrich."""
    w = []
    for side, p in parties.items():
        label, tax_f, name_f = _SIDE_LABEL[side], f"{side}_tax_id", f"{side}_name"
        if p.get("lookup") == "not_found":
            w.append({"field": tax_f, "code": "tax_not_found",
                      "message": f"MST {label} {p['tax_id']} không tồn tại theo Cục Thuế. Kiểm tra lại số trong văn bản."})
        elif p.get("lookup") == "no_tax" and _v(fields, name_f):
            w.append({"field": tax_f, "code": "tax_missing", "message": f"Văn bản không nêu MST {label}."})
        if p.get("active") is False:
            w.append({"field": tax_f, "code": "company_inactive",
                      "message": f"{label.capitalize()} đang ở tình trạng: {p.get('status')}."})
        if p.get("name_match") is False:
            w.append({"field": name_f, "code": "name_mismatch",
                      "message": f"Tên {label} khác tên theo Cục Thuế: {p.get('registry_name')}."})
    return w
