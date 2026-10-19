import { describe, expect, test } from "bun:test";
import { TenantCreateRequestSchema, TenantKeySchema, UsernameSchema } from "@ai/contracts";
import { slotsToValue, tenantCreateSchema, tenantInfoSchema } from "./schemas";

const TZ = "Asia/Ho_Chi_Minh";
const body0 = {
  key: "initech",
  name: "Initech",
  first_admin: { username: "lumbergh", display_name: "Bill", email: "bill@initech.test" },
};
const valid = {
  key: "initech",
  name: "Initech",
  slots: "",
  timezone: TZ,
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
      timezone: v.timezone,
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
      expect(
        tenantInfoSchema.safeParse({ name: "x", slots, timezone: TZ, processRuns: "5" }).success,
      ).toBe(ok);
    }
  });

  test("ADM-FR-72 · múi giờ: IANA hợp lệ ⇔ contract; rỗng/alias ⇒ khoá i18n", () => {
    for (const timezone of [
      TZ,
      "UTC",
      "Europe/Berlin",
      "Asia/Saigon",
      "europe/berlin",
      "",
      "Mars/Base",
    ]) {
      const fe = tenantInfoSchema.safeParse({
        name: "x",
        slots: "",
        timezone,
        processRuns: "5",
      }).success;
      expect(fe).toBe(TenantCreateRequestSchema.safeParse({ ...body0, timezone }).success);
    }
    const msg = (timezone: string) =>
      tenantInfoSchema.safeParse({ name: "x", slots: "", timezone, processRuns: "5" }).error
        ?.issues[0]?.message;
    expect(msg("")).toBe("tenants.error.timezoneRequired");
    expect(msg("Mars/Base")).toBe("tenants.error.timezoneUnsupported");
  });
});

describe("N2-FR-04 · trần run quy trình (form) khớp contract 1…1000", () => {
  test("số nguyên 1…1000 hợp lệ; ngoài khoảng / không phải số ⇒ khoá i18n", () => {
    const parse = (processRuns: string) =>
      tenantInfoSchema.safeParse({ name: "x", slots: "", timezone: TZ, processRuns });
    for (const [v, ok] of [
      ["1", true],
      ["200", true],
      ["1000", true],
      ["0", false],
      ["1001", false],
      ["2.5", false],
      ["", false],
    ] as const)
      expect({ v, ok: parse(v).success }).toEqual({ v, ok });
    expect(parse("0").error?.issues[0]?.message).toBe("tenants.error.processRunsRange");
  });
});
