import { describe, expect, test } from "bun:test";
import { NewPasswordSchema } from "@ai/contracts";
import {
  forcedPasswordSchema,
  loginSchema,
  normalizeBackupCode,
  selfPasswordSchema,
} from "./schemas";

const FIXTURES = [
  "",
  "a",
  "123456789",
  "1234567890",
  "x".repeat(128),
  "x".repeat(129),
  " ".repeat(10),
];

describe("ADM-FR-06 · schema form khớp contract", () => {
  test("mật khẩu mới: FE hợp lệ ⇔ NewPasswordSchema hợp lệ", () => {
    for (const pw of FIXTURES) {
      const fe = forcedPasswordSchema.safeParse({ new_password: pw, confirm: pw }).success;
      expect(fe).toBe(NewPasswordSchema.safeParse(pw).success);
    }
  });

  test("thông điệp lỗi là key i18n", () => {
    const r = forcedPasswordSchema.safeParse({ new_password: "short", confirm: "short" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("password.error.min");
    const m = forcedPasswordSchema.safeParse({ new_password: "1234567890", confirm: "x" });
    expect(m.error?.issues[0]).toMatchObject({
      path: ["confirm"],
      message: "password.error.mismatch",
    });
  });

  test("tự đổi: mật khẩu mới trùng hiện tại bị chặn, thiếu hiện tại bị chặn", () => {
    const same = selfPasswordSchema.safeParse({
      current_password: "Abcdefghij1",
      new_password: "Abcdefghij1",
      confirm: "Abcdefghij1",
    });
    expect(same.error?.issues[0]?.message).toBe("password.error.same");
    const none = selfPasswordSchema.safeParse({
      current_password: "",
      new_password: "Abcdefghij1",
      confirm: "Abcdefghij1",
    });
    expect(none.error?.issues[0]?.message).toBe("password.error.required.current");
  });

  test("đăng nhập: bắt buộc từng ô, không kiểm độ dài mật khẩu", () => {
    const r = loginSchema.safeParse({ tenant_key: " ", username: "", password: "" });
    expect(r.error?.issues.map((i) => i.message).sort()).toEqual([
      "auth.error.required.password",
      "auth.error.required.tenant",
      "auth.error.required.username",
    ]);
    expect(loginSchema.safeParse({ tenant_key: "a", username: "b", password: "x" }).success).toBe(
      true,
    );
  });
});

describe("ADM-FR-08 · mã dự phòng ở bước đăng nhập", () => {
  test("chuẩn hoá: HOA, không gạch, khoảng trắng đều nhận", () => {
    expect(normalizeBackupCode("abcd-efgh")).toBe("abcd-efgh");
    expect(normalizeBackupCode(" ABCD EFGH ")).toBe("abcdefgh");
    expect(normalizeBackupCode("ABCD-EFGH")).toBe("abcd-efgh");
  });
  test("sai dạng → null (ký tự ngoài bảng chữ, sai độ dài)", () => {
    for (const bad of ["", "abcd-efg", "abc1-efgh", "abcd--efgh", "oooo-iiii"]) {
      expect(normalizeBackupCode(bad)).toBeNull();
    }
  });
});
