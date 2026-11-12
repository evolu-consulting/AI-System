// CR-127 K4 · BR-39: khoá nội dung theo trạng thái (PROCESSING + DONE) — luật thuần. BR-38/74: "Mở lại" đã gỡ (không còn luật mở lại).
import { describe, expect, test } from "bun:test";
import { CONTRACT_FIELD_KEYS } from "./fields.rules";
import { isContentLocked, LOCK_EDITABLE_FIELDS, lockVerdict } from "./lock.rules";

describe("BR-39 · isContentLocked", () => {
  test("chỉ processing và done bị khoá", () => {
    expect(["draft", "processing", "reject", "done"].map(isContentLocked)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });
});

describe("BR-39 · lockVerdict", () => {
  test("DRAFT / REJECT ⇒ mọi trường ok", () => {
    for (const status of ["draft", "reject"])
      expect(lockVerdict({ status, changed: ["total_value", "buyer_tax_id"] })).toBe("ok");
  });
  test("PROCESSING / DONE ⇒ trường pháp lý / tiền / bên / ngày ⇒ locked (cho mọi người, kể cả người phụ trách)", () => {
    for (const status of ["processing", "done"])
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
        expect({ status, k, v: lockVerdict({ status, changed: [k] }) }).toEqual({
          status,
          k,
          v: "locked",
        });
  });
  test("khoá ⇒ notice_days cũng bị khoá (lock-strict)", () => {
    expect(lockVerdict({ status: "processing", changed: ["notice_days"] })).toBe("locked");
  });
  test("lẫn trường vận hành + pháp lý ⇒ locked (không ghi một phần)", () => {
    expect(lockVerdict({ status: "done", changed: ["notice_days", "total_value"] })).toBe("locked");
  });
  test("không đổi gì ⇒ ok", () => {
    expect(lockVerdict({ status: "processing", changed: [] })).toBe("ok");
  });
  test("lock-strict: danh sách trường sửa được khi khoá rỗng và chỉ gồm khoá hợp lệ", () => {
    expect(LOCK_EDITABLE_FIELDS.size).toBe(0);
    for (const k of LOCK_EDITABLE_FIELDS)
      expect((CONTRACT_FIELD_KEYS as readonly string[]).includes(k)).toBe(true);
  });
});
