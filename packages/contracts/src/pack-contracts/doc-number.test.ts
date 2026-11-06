// CR-122 p12 · số chứng từ: chuẩn hoá + schema server (manual + PATCH).
import { describe, expect, test } from "bun:test";
import { PatchFieldsRequestSchema } from "./detail";
import { DocNumberSchema, isValidDocNumber, normalizeDocNumber } from "./doc-number";
import { ManualContractRequestSchema } from "./extract";

describe("normalizeDocNumber", () => {
  test("/ và khoảng trắng thành -, bỏ dấu, đ→d, HOA", () => {
    expect(normalizeDocNumber("2026/11-xyz")).toBe("2026-11-XYZ");
    expect(normalizeDocNumber(" hđ số 01/Đà Nẵng ")).toBe("HD-SO-01-DA-NANG");
  });
  test("đang gõ: không cắt khoảng trắng cuối", () => {
    expect(normalizeDocNumber("ab ", true)).toBe("AB-");
  });
  test("ký tự lạ giữ nguyên để báo lỗi", () => {
    expect(isValidDocNumber(normalizeDocNumber("AB#1"))).toBe(false);
    expect(isValidDocNumber(normalizeDocNumber("ab/12 đ"))).toBe(true);
  });
  test("tối đa 50 ký tự, rỗng hợp lệ", () => {
    expect(isValidDocNumber("A".repeat(50))).toBe(true);
    expect(isValidDocNumber("A".repeat(51))).toBe(false);
    expect(isValidDocNumber("")).toBe(true);
  });
});

describe("schema", () => {
  test("DocNumberSchema", () => {
    expect(DocNumberSchema.safeParse("2026-11-XYZ").success).toBe(true);
    for (const bad of ["2026/11", "A B", "Đ1", "A".repeat(51)])
      expect(DocNumberSchema.safeParse(bad).success).toBe(false);
  });
  test("tạo tay: sai ⇒ lỗi path number", () => {
    const base = { deal: "sell", title: "T", partner_name: "P" };
    expect(ManualContractRequestSchema.safeParse({ ...base, number: "A-1" }).success).toBe(true);
    const r = ManualContractRequestSchema.safeParse({ ...base, number: "A/1" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["number"]);
  });
  test("PATCH: chỉ kiểm khi có khoá number; khoá khác không bị ảnh hưởng", () => {
    const v = { version: 1 };
    expect(PatchFieldsRequestSchema.safeParse({ ...v, fields: { title: "x/y" } }).success).toBe(
      true,
    );
    expect(PatchFieldsRequestSchema.safeParse({ ...v, fields: { number: "A-1" } }).success).toBe(
      true,
    );
    const r = PatchFieldsRequestSchema.safeParse({ ...v, fields: { number: "A/1" } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["fields", "number"]);
  });
});
