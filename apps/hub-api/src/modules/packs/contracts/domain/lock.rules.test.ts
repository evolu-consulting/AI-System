// CR-097 K1 · HD-FR-100 (khoá cứng sau xác nhận) · HD-FR-104 (owner mở lại có lý do): luật thuần — viết TRƯỚC code.
import { describe, expect, test } from "bun:test";
import { CONTRACT_FIELD_KEYS } from "./fields.rules";
import { LOCK_EDITABLE_FIELDS, lockVerdict, reopenVerdict } from "./lock.rules";

describe("HD-FR-100 · lockVerdict", () => {
  test("HĐ chưa khoá ⇒ mọi trường ok (luật duyệt cũ quyết tiếp)", () => {
    expect(lockVerdict({ locked: false, changed: ["total_value", "buyer_tax_id"] })).toBe("ok");
  });
  test("HĐ đã khoá ⇒ trường pháp lý / tiền / bên / ngày ⇒ locked (cho mọi người, kể cả owner)", () => {
    for (const k of [
      "total_value",
      "vat_rate",
      "buyer_name",
      "supplier_tax_id",
      "signed_date",
      "end_date",
      "payment_terms",
      "number",
      "title",
    ])
      expect({ k, v: lockVerdict({ locked: true, changed: [k] }) }).toEqual({ k, v: "locked" });
  });
  test("HĐ đã khoá ⇒ notice_days cũng bị khoá (lock-strict)", () => {
    expect(lockVerdict({ locked: true, changed: ["notice_days"] })).toBe("locked");
  });
  test("lẫn trường vận hành + pháp lý ⇒ locked (không ghi một phần)", () => {
    expect(lockVerdict({ locked: true, changed: ["notice_days", "total_value"] })).toBe("locked");
  });
  test("không đổi gì ⇒ ok", () => {
    expect(lockVerdict({ locked: true, changed: [] })).toBe("ok");
  });
  test("lock-strict: danh sách trường sửa được khi khoá rỗng", () => {
    expect(LOCK_EDITABLE_FIELDS.size).toBe(0);
  });
  test("danh sách trường sửa được khi khoá chỉ gồm khoá hợp lệ và KHÔNG có trường tiền/bên/ngày", () => {
    for (const k of LOCK_EDITABLE_FIELDS)
      expect((CONTRACT_FIELD_KEYS as readonly string[]).includes(k)).toBe(true);
    const legal = ["total_value", "vat_rate", "vat_included", "buyer_name", "buyer_tax_id"];
    const legalDates = [
      "supplier_name",
      "supplier_tax_id",
      "signed_date",
      "start_date",
      "end_date",
    ];
    for (const k of [...legal, ...legalDates]) expect(LOCK_EDITABLE_FIELDS.has(k)).toBe(false);
  });
});

describe("HD-FR-104 · reopenVerdict", () => {
  test("HĐ đã khoá + lý do ⇒ ok", () => {
    expect(reopenVerdict({ locked: true })).toBe("ok");
  });
  test("HĐ chưa khoá ⇒ not_locked (409)", () => {
    expect(reopenVerdict({ locked: false })).toBe("not_locked");
  });
});
