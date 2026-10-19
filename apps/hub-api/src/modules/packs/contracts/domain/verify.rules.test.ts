// HD-FR-22 · HD-FR-23 · port `R/api/tests/test_contract_verify.py` (fixture `answers.json`/`c*.md` không có trong reference ⇒
// dựng HĐ mẫu C1 tương đương ngay trong test) + định dạng MST + Cục Thuế + gộp giữ `edited`.
import { describe, expect, it } from "bun:test";
import { applyExtraction, type RawExtraction } from "./extraction.rules";
import { fillFields } from "./fields.rules";
import { isActiveStatus, partyCheck, partyForm, sameName } from "./party.rules";
import {
  norm,
  numbersIn,
  prepareSource,
  quoteFound,
  valueInQuote,
  verifyFields,
} from "./verify.rules";
import { groupVi, normalizeTaxId, ruleWarnings } from "./warnings.rules";

const C1 = [
  "**HỢP ĐỒNG MUA BÁN** số 01/2026/HĐMB-PN",
  "Hôm nay, ngày 05 tháng 01 năm 2026, tại Hà Nội",
  "Bên bán: Công ty TNHH Bao Bì Phương Nam — MST: 0312345678",
  "Bên mua: Công ty Cổ phần Thực phẩm An Khang — MST: 0109876543",
  "Điều 2. Thời hạn: từ ngày 01/01/2026 đến hết ngày 31/12/2026.",
  "| Thùng carton 5 lớp | thùng | 1000 | 245.000 |",
  "Tổng giá trị: 245.000.000 đồng, chưa bao gồm VAT 8%. Báo trước ít nhất 30 ngày.",
].join("\n");
const raw = (): RawExtraction => ({
  fields: {
    number: { value: "01/2026/HĐMB-PN", quote: "số 01/2026/HĐMB-PN" },
    signed_date: { value: "2026-01-05", quote: "Hôm nay, ngày 05 tháng 01 năm 2026" },
    supplier_tax_id: { value: "0312345678", quote: "MST: 0312345678" },
    start_date: { value: "2026-01-01", quote: "từ ngày 01/01/2026" },
    end_date: { value: "2026-12-31", quote: "đến hết ngày 31/12/2026" },
    total_value: { value: 245_000_000, quote: "Tổng giá trị: 245.000.000 đồng" },
    vat_rate: { value: 8, quote: "VAT 8%" },
    vat_included: { value: false, quote: "chưa bao gồm VAT 8%" },
    notice_days: { value: 30, quote: "Báo trước ít nhất 30 ngày" },
  },
  items: [
    {
      code: null,
      name: "Thùng carton 5 lớp",
      spec: null,
      unit: "thùng",
      qty: 1000,
      unit_price: 245_000,
      vat_rate: null,
      moq: null,
      lead_time_days: null,
      valid_from: null,
      valid_to: null,
      quote: "| Thùng carton 5 lớp | thùng | 1000 | 245.000 |",
    },
  ],
  clauses: [{ number: "2", topic: "general" }],
});

describe("HD-FR-22 · norm / quote", () => {
  it("test_norm_folds_and_strips_markup", () => {
    expect(norm("**Điều 3.**  Thanh   TOÁN | x")).toBe("dieu 3. thanh toan x");
  });
  it("test_quote_found_survives_split_pdf_text", () => {
    const md = prepareSource("Hà Nội, ngày 02 tháng 07 năm 202 5\nKính g ử i: Quý đại lý");
    expect(quoteFound("Hà Nội, ngày 02 tháng 07 năm 2025", md)).toBe(true);
    expect(quoteFound("Hà Nội, ngày 03 tháng 07 năm 2025", md)).toBe(false);
    expect(quoteFound("", md)).toBe(false);
  });
});

describe("HD-FR-22 · ngày và số trong quote", () => {
  it("test_date_variants", () => {
    expect(valueInQuote("date", "2026-11-15", "hết ngày 15/11/2026")).toBe(true);
    expect(valueInQuote("date", "2026-01-05", "Hôm nay, ngày 05 tháng 01 năm 2026")).toBe(true);
    expect(valueInQuote("date", "2026-01-05", "ngày 5 tháng 1 năm 2026")).toBe(true);
    expect(valueInQuote("date", "2026-01-05", "05-01-2026")).toBe(true);
    expect(valueInQuote("date", "2026-01-06", "Hôm nay, ngày 05 tháng 01 năm 2026")).toBe(false);
    expect(valueInQuote("date", "2026-01-05", "ngày 15/01/2026")).toBe(false);
    expect(valueInQuote("date", "2026-01-01", "11/1/2026")).toBe(false);
    expect(valueInQuote("date", "2026-11-01", "đến 21/11/2026")).toBe(false);
    expect(valueInQuote("date", "2026-01-05", "05/01/20261")).toBe(false);
    expect(valueInQuote("date", "không-phải-ngày", "05/01/2026")).toBe(false);
  });
  it("test_money_variants (số tiền tiếng Việt)", () => {
    expect(valueInQuote("int", 245_000_000, "Tổng: 245.000.000 đồng")).toBe(true);
    expect(valueInQuote("int", 180_000_000, "tổng 180 triệu đồng")).toBe(true);
    expect(valueInQuote("int", 1_250_000_000, "giá trị 1,25 tỷ đồng")).toBe(true);
    expect(valueInQuote("int", 1_500_000_000, "giá trị 1,5 tỷ đồng")).toBe(true);
    expect(valueInQuote("int", 24_500_000, "Tổng: 245.000.000 đồng")).toBe(false);
    expect(valueInQuote("float", 8.0, "Thuế GTGT 8%")).toBe(true);
    expect(valueInQuote("int", 30, "trước ít nhất 30 ngày")).toBe(true);
    expect(valueInQuote("int", 3, "trước ít nhất 30 ngày")).toBe(false);
    expect(valueInQuote("int", 320_000, "Màng co PE | 25 micron | cuộn | 500 | 320.000")).toBe(
      true,
    );
    expect(valueInQuote("int", 500, "Màng co PE | 25 micron | cuộn | 500 | 320.000")).toBe(true);
    expect(valueInQuote("int", 1_250_000_000_000, "giá trị 1.250 tỷ đồng")).toBe(true);
    expect(valueInQuote("int", 1_250_000_000, "giá trị 1.250 tỷ đồng")).toBe(false);
    expect(valueInQuote("int", 1_500_000, "1.500 triệu đồng")).toBe(false);
    expect(valueInQuote("int", 1_500_000_000, "1.500 triệu đồng")).toBe(true);
    expect(valueInQuote("int", 50_000, "50 nghìn đồng")).toBe(true);
  });
  it("numbersIn: không gộp số cách nhau bằng khoảng trắng", () => {
    expect(numbersIn(norm("500 320.000"))).toEqual([500, 320_000]);
  });
  it("kiểu chữ/enum/bool ⇒ luôn khớp (chỉ cần quote có trong văn bản)", () => {
    expect(valueInQuote("text", "x", "y")).toBe(true);
    expect(valueInQuote("bool", true, "")).toBe(true);
  });
});

describe("HD-FR-22 · verify cả bản trích", () => {
  it("test_answer_key_verifies_cleanly: mọi trường có giá trị đều verified, mọi dòng hàng verified", () => {
    const out = applyExtraction({
      raw: raw(),
      source: C1,
      kind: "contract",
      oldFields: {},
      hasItems: false,
    });
    const bad = Object.entries(out.fields).filter(([, f]) => f.value !== null && !f.verified);
    expect(bad.map(([k]) => k)).toEqual([]);
    expect(out.items?.every((i) => i.verified)).toBe(true);
  });
  it("test_value_must_appear_in_quote: đúng câu sai ngày, quote bịa ⇒ false; trường khác vẫn true", () => {
    const r = raw();
    r.fields.end_date = { value: "2026-12-30", quote: "đến hết ngày 31/12/2026" };
    r.fields.total_value = { value: 245_000_000, quote: "Tổng giá trị theo bảng trên" };
    const f = verifyFields(r.fields, prepareSource(C1));
    expect([f.end_date.verified, f.total_value.verified]).toEqual([false, false]);
    expect([f.start_date.verified, f.supplier_tax_id.verified]).toEqual([true, true]);
  });
});

describe("HD-BR-01 · gộp bản trích", () => {
  it("HD-BR-01 · gộp: trường `edited` cũ thắng; `effective_date` của HĐ (không phải phụ lục) luôn rỗng", () => {
    const old = fillFields({ total_value: { value: 1, quote: "", verified: true, edited: true } });
    const r = raw();
    r.fields.effective_date = { value: "2026-02-01", quote: "x" };
    const out = applyExtraction({
      raw: r,
      source: C1,
      kind: "contract",
      oldFields: old,
      hasItems: false,
    });
    expect(out.fields.total_value).toEqual({ value: 1, quote: "", verified: true, edited: true });
    expect(out.fields.effective_date.value).toBeNull();
    const app = applyExtraction({
      raw: r,
      source: C1,
      kind: "appendix",
      oldFields: {},
      hasItems: true,
    });
    expect(app.fields.effective_date.value).toBe("2026-02-01");
    expect(app.items).toBeNull();
  });
  it("không có văn bản (PDF/ảnh) ⇒ mọi trường verified=false", () => {
    const out = applyExtraction({
      raw: raw(),
      source: null,
      kind: "contract",
      oldFields: {},
      hasItems: false,
    });
    expect(Object.values(out.fields).some((f) => f.verified)).toBe(false);
  });
});

describe("HD-FR-23 · cảnh báo luật", () => {
  const verified = () =>
    applyExtraction({ raw: raw(), source: C1, kind: "contract", oldFields: {}, hasItems: false });
  it("test_rules: bản sạch ⇒ []; ngày ngược, tổng lệch, MST sai, tự gia hạn thiếu báo trước ⇒ đủ 4 mã", () => {
    const o = verified();
    const items = o.items ?? [];
    expect(ruleWarnings(o.fields, items)).toEqual([]);
    o.fields.end_date.value = "2025-01-01";
    o.fields.total_value.value = 999;
    o.fields.supplier_tax_id.value = "12345";
    o.fields.auto_renew.value = true;
    o.fields.notice_days.value = null;
    const codes = new Set(ruleWarnings(o.fields, items).map((w) => w.code));
    expect(codes).toEqual(
      new Set(["dates_order", "total_mismatch", "tax_id_format", "notice_missing"]),
    );
  });
  it("vat_unknown khi có giá trị mà chưa rõ VAT; tổng gồm VAT tính đúng (lệch ≤ 1 % không cảnh báo)", () => {
    const o = verified();
    o.fields.vat_included.value = null;
    expect(ruleWarnings(o.fields, o.items ?? []).map((w) => w.code)).toEqual(["vat_unknown"]);
    const p = verified();
    p.fields.vat_included.value = true;
    expect(ruleWarnings(p.fields, p.items ?? []).map((w) => w.code)).toEqual(["total_mismatch"]);
    p.fields.total_value.value = 264_600_000; // 245.000.000 × 1,08
    expect(ruleWarnings(p.fields, p.items ?? [])).toEqual([]);
  });
  it("total_mismatch: câu chữ nhóm nghìn bằng dấu chấm", () => {
    const o = verified();
    o.fields.total_value.value = 100;
    expect(ruleWarnings(o.fields, o.items ?? [])[0]?.message).toBe(
      "Tổng các dòng hàng (245.000.000) lệch hơn 1% so với giá trị hợp đồng.",
    );
    expect(groupVi(1234567.6)).toBe("1.234.568");
  });
  it("chiều mua/bán chưa rõ ⇒ direction_unknown; nội bộ ⇒ direction_internal", () => {
    const o = verified();
    expect(ruleWarnings(o.fields, [], "none_own").map((w) => w.code)).toEqual([
      "direction_unknown",
    ]);
    expect(ruleWarnings(o.fields, [], "both_own").map((w) => w.code)).toEqual([
      "direction_internal",
    ]);
  });
});

describe("HD-FR-25 · MST + Cục Thuế", () => {
  it("normalizeTaxId: 10 / 10-3 / 12 số; sai ⇒ null", () => {
    expect(normalizeTaxId("0312.345.678")).toBe("0312345678");
    expect(normalizeTaxId("0312345678-001")).toBe("0312345678-001");
    expect(normalizeTaxId("0312345678001")).toBe("0312345678-001");
    expect(normalizeTaxId("001203004567")).toBe("001203004567");
    expect(normalizeTaxId("12345")).toBeNull();
    expect(normalizeTaxId("03123-45678")).toBeNull();
    expect(normalizeTaxId("03123456AB")).toBeNull();
    expect(normalizeTaxId(null)).toBeNull();
  });
  it("isActiveStatus + so tên bỏ loại hình doanh nghiệp", () => {
    expect(isActiveStatus("Đang hoạt động (đã được cấp GCN ĐKT)")).toBe(true);
    expect(isActiveStatus("Ngừng hoạt động và đã đóng MST")).toBe(false);
    expect(isActiveStatus(null)).toBeNull();
  });
});

describe("Trung 3 · same_name khớp mgmt-app", () => {
  it("Trung 3 · party_form / same_name khớp enrich.py + link.py (ca đối chiếu mgmt-app)", () => {
    // link.py:90 docstring: "Cty TNHH ABC" == "CÔNG TY TNHH ABC"
    expect(partyForm("Cty TNHH ABC")).toBe(partyForm("CÔNG TY TNHH ABC"));
    expect(partyForm("CÔNG TY TNHH BAO BÌ PHƯƠNG NAM")).toBe("baobiphuongnam");
    expect(partyForm("Công ty CP Đông Á")).toBe("cpdonga"); // "cp" không thuộc _LEGAL (chỉ "co phan"/"ctcp")
    expect(
      sameName("Công ty TNHH Bao Bì Phương Nam", ["CÔNG TY TNHH MỘT THÀNH VIÊN BAO BÌ PHƯƠNG NAM"]),
    ).toBe(true);
    expect(sameName("Công ty TNHH Bao Bì Phương Nam", ["CÔNG TY CỔ PHẦN XYZ"])).toBe(false);
    // min(len) ≥ 4 mới so chứa: tên ngắn "A" không "khớp" mọi tên có chữ a
    expect(sameName("Công ty A", ["CÔNG TY TNHH ABA"])).toBe(false);
    expect(sameName("Công ty ABCD", ["CÔNG TY TNHH ABCD VIỆT NAM"])).toBe(true);
    expect(sameName("Công ty ABC", ["CÔNG TY TNHH ABCX"])).toBe(false);
    // so cả tên viết tắt và tên quốc tế
    expect(
      sameName("PHUONG NAM PACKAGING", [
        "CÔNG TY TNHH BAO BÌ PHƯƠNG NAM",
        null,
        "PHUONG NAM PACKAGING CO., LTD",
      ]),
    ).toBe(true);
    expect(sameName("PNP", ["CÔNG TY TNHH BAO BÌ PHƯƠNG NAM", "PNP", null])).toBe(true);
    expect(sameName(null, ["X"])).toBe(false);
    expect(sameName("X", [null, undefined, ""])).toBe(false);
  });
  it("partyCheck + cảnh báo: không tồn tại / ngừng / tên khác / không nêu MST", () => {
    const f = fillFields({
      supplier_name: { value: "Công ty A" },
      buyer_name: { value: "Công ty B" },
    });
    const parties = {
      supplier: partyCheck("Công ty A", "0312345678", {
        result: "found",
        name: "CÔNG TY C",
        status: "Ngừng hoạt động",
      }),
      buyer: partyCheck("Công ty B", null, null),
    };
    const codes = ruleWarnings(f, [], null, parties).map((w) => w.code);
    expect(codes).toEqual(["company_inactive", "name_mismatch", "tax_missing"]);
    const nf = partyCheck("A", "0312345678", { result: "not_found" });
    expect(ruleWarnings(f, [], null, { supplier: nf }).map((w) => w.code)).toEqual([
      "tax_not_found",
    ]);
    expect(partyCheck("A", "123", null).lookup).toBe("invalid");
  });
});
