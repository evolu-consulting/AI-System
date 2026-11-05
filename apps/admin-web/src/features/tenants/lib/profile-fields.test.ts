// CR-121 · kiểm ô hồ sơ công ty khi sửa tại chỗ.
import { describe, expect, test } from "bun:test";
import { validateField } from "./profile-fields";

describe("CR-121 · validateField", () => {
  test("tên công ty: bắt buộc", () => {
    expect(validateField("name", "  ")).toEqual({ ok: false, error: "tenants.error.nameRequired" });
    expect(validateField("name", " Acme ")).toEqual({ ok: true, value: "Acme" });
  });

  test("ô trống = xoá giá trị (null) với trường tuỳ chọn", () => {
    for (const f of [
      "legal_name",
      "tax_code",
      "staff_size",
      "contact_email",
      "contact_phone",
    ] as const)
      expect(validateField(f, " ")).toEqual({ ok: true, value: null });
  });

  test("email, SĐT, MST, quy mô: đúng ⇒ chuẩn hoá; sai ⇒ khoá lỗi dễ hiểu", () => {
    expect(validateField("contact_email", "A@B.vn")).toEqual({ ok: true, value: "a@b.vn" });
    expect(validateField("contact_email", "abc")).toEqual({
      ok: false,
      error: "tenants.company.error.email",
    });
    expect(validateField("contact_phone", "+84 912 345 678").ok).toBe(true);
    expect(validateField("contact_phone", "12").ok).toBe(false);
    expect(validateField("tax_code", "0312345678-001").ok).toBe(true);
    expect(validateField("tax_code", "031234").ok).toBe(false);
    expect(validateField("staff_size", "120")).toEqual({ ok: true, value: 120 });
    expect(validateField("staff_size", "-3").ok).toBe(false);
    expect(validateField("staff_size", "1.5").ok).toBe(false);
  });

  test("độ dài tối đa", () => {
    expect(validateField("contact_name", "x".repeat(129)).ok).toBe(false);
    expect(validateField("address", "x".repeat(512)).ok).toBe(true);
  });
});
