import json
from pathlib import Path

from app.contracts.verify import norm, quote_found, rule_warnings, value_in_quote, verify

D = Path(__file__).parent / "fixtures" / "contracts"


def _answer(file: str) -> tuple[dict, str]:
    a = next(x for x in json.loads((D / "answers.json").read_text(encoding="utf-8")) if x["file"] == file)
    ex = {**a["fields"], "items": a["items"], "clauses": a["clauses"]}
    return ex, (D / file).read_text(encoding="utf-8")


def test_norm_folds_and_strips_markup():
    assert norm("**Điều 3.**  Thanh   TOÁN | x") == "dieu 3. thanh toan x"


def test_date_variants():
    assert value_in_quote("date", "2026-11-15", "hết ngày 15/11/2026")
    assert value_in_quote("date", "2026-01-05", "Hôm nay, ngày 05 tháng 01 năm 2026")
    assert value_in_quote("date", "2026-01-05", "ngày 5 tháng 1 năm 2026")
    assert value_in_quote("date", "2026-01-05", "05-01-2026")
    assert not value_in_quote("date", "2026-01-06", "Hôm nay, ngày 05 tháng 01 năm 2026")
    assert not value_in_quote("date", "2026-01-05", "ngày 15/01/2026")
    assert not value_in_quote("date", "2026-01-01", "11/1/2026")
    assert not value_in_quote("date", "2026-11-01", "đến 21/11/2026")
    assert not value_in_quote("date", "2026-01-05", "05/01/20261")


def test_money_variants():
    assert value_in_quote("int", 245_000_000, "Tổng: 245.000.000 đồng")
    assert value_in_quote("int", 180_000_000, "tổng 180 triệu đồng")
    assert value_in_quote("int", 1_250_000_000, "giá trị 1,25 tỷ đồng")
    assert not value_in_quote("int", 24_500_000, "Tổng: 245.000.000 đồng")
    assert value_in_quote("float", 8.0, "Thuế GTGT 8%")
    assert value_in_quote("int", 30, "trước ít nhất 30 ngày")
    assert not value_in_quote("int", 3, "trước ít nhất 30 ngày")
    assert value_in_quote("int", 320_000, "Màng co PE | 25 micron | cuộn | 500 | 320.000")
    assert value_in_quote("int", 500, "Màng co PE | 25 micron | cuộn | 500 | 320.000")
    assert value_in_quote("int", 1_250_000_000_000, "giá trị 1.250 tỷ đồng")
    assert not value_in_quote("int", 1_250_000_000, "giá trị 1.250 tỷ đồng")
    assert not value_in_quote("int", 1_500_000, "1.500 triệu đồng")
    assert value_in_quote("int", 1_500_000_000, "1.500 triệu đồng")


def test_value_must_appear_in_quote():
    ex, md = _answer("c1.md")
    ex["end_date"] = {"value": "2026-12-30", "quote": ex["end_date"]["quote"]}      # right sentence, wrong date
    ex["total_value"] = {"value": 245_000_000, "quote": "Tổng giá trị theo bảng trên"}  # invented quote
    fields, _, _ = verify(ex, md)
    assert fields["end_date"]["verified"] is False
    assert fields["total_value"]["verified"] is False
    assert fields["start_date"]["verified"] is True
    assert fields["supplier_tax_id"]["verified"] is True


def test_answer_key_verifies_cleanly():
    for a in json.loads((D / "answers.json").read_text(encoding="utf-8")):
        f = a["file"]
        ex, md = _answer(f)
        fields, items, warnings = verify(ex, md)
        bad = [k for k, v in fields.items() if v["value"] is not None and not v["verified"]]
        assert bad == [], (f, bad)
        assert all(i["verified"] for i in items), f


def test_rules():
    ex, md = _answer("c1.md")
    fields, items, _ = verify(ex, md)
    assert rule_warnings(fields, items) == []
    fields["end_date"]["value"] = "2025-01-01"
    fields["total_value"]["value"] = 999
    fields["supplier_tax_id"]["value"] = "12345"
    fields["auto_renew"]["value"] = True
    fields["notice_days"]["value"] = None
    codes = {w["code"] for w in rule_warnings(fields, items)}
    assert codes == {"dates_order", "total_mismatch", "tax_id_format", "notice_missing"}
    ex6, md6 = _answer("c6.md")
    f6, i6, _ = verify(ex6, md6)
    assert "vat_unknown" in {w["code"] for w in rule_warnings(f6, i6)}


def test_quote_found_survives_split_pdf_text():
    md = norm("Hà Nội, ngày 02 tháng 07 năm 202 5\nKính g ử i: Quý đại lý")
    assert quote_found("Hà Nội, ngày 02 tháng 07 năm 2025", md)
    assert not quote_found("Hà Nội, ngày 03 tháng 07 năm 2025", md)
