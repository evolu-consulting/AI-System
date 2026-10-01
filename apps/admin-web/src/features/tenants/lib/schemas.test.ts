import { describe, expect, test } from "bun:test";
import { TenantCreateRequestSchema, TenantKeySchema, UsernameSchema } from "@ai/contracts";
import { slotsToValue, tenantCreateSchema, tenantInfoSchema } from "./schemas";

const valid = {
  key: "initech",
  name: "Initech",
  slots: "",
  username: "lumbergh",
  display_name: "Bill",
  email: "bill@initech.test",
  locale: "vi" as const,
};

describe("ADM-FR-60 · schema form tenant khớp contract", () => {
  test("mã công ty và tên đăng nhập: FE hợp lệ ⇔ contract hợp lệ", () => {
    for (const key of ["a", "ab", "acme-1", "ACME", " acme ", "a_b", "đông", "x".repeat(33)]) {
      const fe = tenantCreateSchema.safeParse({ ...valid, key }).success;
      expect(fe).toBe(TenantKeySchema.safeParse(key).success);
    }
    for (const username of ["a", "an.b", "an_b-1", "AN", "a b", "x".repeat(33)]) {
      const fe = tenantCreateSchema.safeParse({ ...valid, username }).success;
      expect(fe).toBe(UsernameSchema.safeParse(username).success);
    }
  });

  test("dữ liệu hợp lệ của FE được contract nhận", () => {
    const v = tenantCreateSchema.parse(valid);
    const body = {
      key: v.key,
      name: v.name,
      max_concurrent_sub: slotsToValue(v.slots),
      first_admin: {
        username: v.username,
        display_name: v.display_name,
        email: v.email,
        locale: v.locale,
      },
    };
    expect(TenantCreateRequestSchema.safeParse(body).success).toBe(true);
  });

  test("email bắt buộc và đúng định dạng; tên bắt buộc", () => {
    const msg = (over: object) =>
      tenantCreateSchema.safeParse({ ...valid, ...over }).error?.issues[0]?.message;
    expect(msg({ email: "" })).toBe("users.error.emailRequired");
    expect(msg({ email: "khong-phai-email" })).toBe("users.error.emailFormat");
    expect(msg({ name: "  " })).toBe("tenants.error.nameRequired");
    expect(msg({ key: "A B" })).toBe("tenants.error.keyFormat");
  });

  test("slot: trống = null; số nguyên 1…10000", () => {
    expect(slotsToValue("")).toBeNull();
    expect(slotsToValue(" 5 ")).toBe(5);
    for (const [slots, ok] of [
      ["", true],
      ["1", true],
      ["10000", true],
      ["0", false],
      ["10001", false],
      ["1.5", false],
      ["-2", false],
      ["abc", false],
    ] as const) {
      expect(tenantInfoSchema.safeParse({ name: "x", slots }).success).toBe(ok);
    }
  });
});
