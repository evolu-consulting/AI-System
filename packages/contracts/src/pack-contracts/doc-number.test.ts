// CR-135 Q3 · số chứng từ giữ nguyên văn: chuẩn hoá nhẹ + schema server (manual + PATCH).
import { describe, expect, test } from "bun:test";
import { PatchFieldsRequestSchema } from "./detail";
import { DocNumberSchema, isValidDocNumber, normalizeDocNumber } from "./doc-number";
import { ManualContractRequestSchema } from "./extract";

describe("normalizeDocNumber", () => {
  test("giữ nguyên văn: «/», dấu, hoa/thường, khoảng trắng giữa; chỉ cắt 2 đầu", () => {
    expect(normalizeDocNumber("  HĐ/2026/001 ")).toBe("HĐ/2026/001");
    expect(normalizeDocNumber("hđ số 01/Đà Nẵng")).toBe("hđ số 01/Đà Nẵng");
  });
  test("đang gõ: không cắt khoảng trắng", () => {
    expect(normalizeDocNumber("ab ", true)).toBe("ab ");
  });
  test("NFC: chữ có dấu dạng tổ hợp ⇒ dựng sẵn", () => {
    expect(normalizeDocNumber("Hệ")).toBe("Hệ");
  });
});

describe("isValidDocNumber", () => {
  test("«/», dấu, khoảng trắng giữa hợp lệ", () => {
    for (const ok of ["HĐ/2026/001", "01 / ĐN", "AB#1", "2026-11-XYZ", ""])
      expect(isValidDocNumber(ok)).toBe(true);
  });
  test("tối đa 50 ký tự", () => {
    expect(isValidDocNumber("A".repeat(50))).toBe(true);
    expect(isValidDocNumber("A".repeat(51))).toBe(false);
  });
  test("cấm ký tự điều khiển/xuống dòng", () => {
    for (const bad of ["A\nB", "A\tB", "A\u0000B", "A B"])
      expect(isValidDocNumber(bad)).toBe(false);
  });
});

describe("schema", () => {
  test("DocNumberSchema: nguyên văn + trim + NFC", () => {
    expect(DocNumberSchema.parse("  HĐ/2026/001 ")).toBe("HĐ/2026/001");
    expect(DocNumberSchema.parse("Hệ")).toBe("Hệ".replace("H", "H"));
    for (const bad of ["A\nB", "A".repeat(51), "   "])
      expect(DocNumberSchema.safeParse(bad).success).toBe(false);
  });
  test("tạo tay: «/» nhận; xuống dòng ⇒ lỗi path number", () => {
    const base = { deal: "sell", title: "T", partner_name: "P" };
    expect(ManualContractRequestSchema.safeParse({ ...base, number: "HĐ/1" }).success).toBe(true);
    const r = ManualContractRequestSchema.safeParse({ ...base, number: "A\nB" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["number"]);
  });
  test("PATCH: chỉ kiểm khi có khoá number", () => {
    const v = { version: 1 };
    expect(
      PatchFieldsRequestSchema.safeParse({ ...v, fields: { number: "HĐ/2026/001" } }).success,
    ).toBe(true);
    const r = PatchFieldsRequestSchema.safeParse({ ...v, fields: { number: "A\nB" } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["fields", "number"]);
  });
});
