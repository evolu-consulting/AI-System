import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  API_ERRORS,
  COMPANY_KEY_RE,
  DISPLAY_NAME_MAX,
  EMAIL_MAX,
  EmailSchema,
  ERROR_CODES,
  ErrorResponseSchema,
  IsoDateTime,
  LastAdminDetailsSchema,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  ListQueryBase,
  LOCALES,
  listResponseSchema,
  NAME_MAX,
  NewPasswordSchema,
  PASSWORD_MAX_LEN,
  PASSWORD_MIN_LEN,
  ROLES,
  TEMP_PASSWORD_LEN,
  TempLockedDetailsSchema,
  TempPasswordSchema,
  TenantKeySchema,
  USERNAME_RE,
  UsernameSchema,
  ValidationErrorDetailsSchema,
} from "./index";

describe("ADM-FR-01 · hằng và regex export", () => {
  test("giá trị hằng đúng spec §3", () => {
    expect([PASSWORD_MIN_LEN, PASSWORD_MAX_LEN, DISPLAY_NAME_MAX, NAME_MAX, EMAIL_MAX]).toEqual([
      10, 128, 64, 128, 254,
    ]);
    expect([LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, TEMP_PASSWORD_LEN]).toEqual([50, 200, 16]);
    expect(ROLES).toEqual(["platform_admin", "tenant_admin", "member"]);
    expect(LOCALES).toEqual(["vi", "en"]);
  });

  test("COMPANY_KEY_RE / USERNAME_RE", () => {
    expect(COMPANY_KEY_RE.source).toBe("^[a-z0-9-]{2,32}$");
    expect(USERNAME_RE.source).toBe("^[a-z0-9._-]{2,32}$");
    for (const ok of ["ac", "acme-1", "a".repeat(32)]) expect(COMPANY_KEY_RE.test(ok)).toBe(true);
    for (const bad of ["a", "a_b", "Acme", "a".repeat(33)])
      expect(COMPANY_KEY_RE.test(bad)).toBe(false);
    for (const ok of ["an", "cuong.le", "a_b-c"]) expect(USERNAME_RE.test(ok)).toBe(true);
    for (const bad of ["a", "na m", "na@m", "a".repeat(33)])
      expect(USERNAME_RE.test(bad)).toBe(false);
  });
});

describe("ADM-FR-63 · kiểu định danh", () => {
  test("TenantKey / Username trim + lowercase rồi kiểm regex", () => {
    expect(TenantKeySchema.parse("  ACME ")).toBe("acme");
    expect(UsernameSchema.parse("NamNguyen")).toBe("namnguyen");
    expect(TenantKeySchema.safeParse("a_b").success).toBe(false);
    expect(UsernameSchema.safeParse("na m").success).toBe(false);
  });

  test("Email trim + lowercase, ≤ 254", () => {
    expect(EmailSchema.parse(" LAN@ACME.test ")).toBe("lan@acme.test");
    expect(EmailSchema.safeParse("not-an-email").success).toBe(false);
    expect(EmailSchema.safeParse(`${"a".repeat(64)}@${"b".repeat(186)}.com`).success).toBe(false);
  });

  test("NewPassword 10–128, không trim", () => {
    expect(NewPasswordSchema.safeParse("a".repeat(9)).success).toBe(false);
    expect(NewPasswordSchema.parse(" ".repeat(10))).toBe(" ".repeat(10));
    expect(NewPasswordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  test("TempPassword đúng 16 ký tự [A-Za-z0-9]", () => {
    expect(TempPasswordSchema.safeParse("Ab3dEf6hIj9lMn0p").success).toBe(true);
    expect(TempPasswordSchema.safeParse("Ab3dEf6hIj9lMn0").success).toBe(false);
    expect(TempPasswordSchema.safeParse("Ab3dEf6hIj9lMn0-").success).toBe(false);
  });

  test("IsoDateTime chỉ nhận UTC", () => {
    expect(IsoDateTime.safeParse("2026-10-01T08:00:00.000Z").success).toBe(true);
    expect(IsoDateTime.safeParse("2026-10-01T08:00:00+07:00").success).toBe(false);
  });
});

describe("ADM-FR-04 · ListQueryBase", () => {
  test("mặc định limit 50, offset 0; q rỗng bỏ; coerce chuỗi query", () => {
    expect(ListQueryBase.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(ListQueryBase.parse({ q: "   ", limit: "7", offset: "3" })).toEqual({
      limit: 7,
      offset: 3,
    });
    expect(ListQueryBase.parse({ q: " an " }).q).toBe("an");
  });

  test.each([
    ["limit 0", { limit: "0" }],
    ["limit 201", { limit: "201" }],
    ["limit không nguyên", { limit: "1.5" }],
    ["offset âm", { offset: "-1" }],
    ["offset 100001", { offset: "100001" }],
    ["q 101 ký tự", { q: "a".repeat(101) }],
    ["trường lạ", { sort: "x" }],
  ])("từ chối: %s", (_n, input) => {
    expect(ListQueryBase.safeParse(input).success).toBe(false);
  });

  test("listResponseSchema có items/total/counts, strict", () => {
    const s = listResponseSchema(z.string());
    const ok = { items: ["a"], total: 1, counts: { all: 1, active: 1, locked: 0 } };
    expect(s.parse(ok)).toEqual(ok);
    expect(s.safeParse({ items: [], total: 0 }).success).toBe(false);
    expect(s.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe("ADM-FR-01 · API_ERRORS", () => {
  test("đủ 23 mã, đúng HTTP theo spec §3", () => {
    expect(API_ERRORS).toEqual({
      VALIDATION_ERROR: 400,
      TENANT_REQUIRED: 400,
      ROLE_NOT_ALLOWED: 400,
      EMAIL_REQUIRED: 400,
      PASSWORD_UNCHANGED: 400,
      INVALID_CURRENT_PASSWORD: 400,
      UNAUTHORIZED: 401,
      INVALID_CREDENTIALS: 401,
      INVALID_REFRESH_TOKEN: 401,
      REFRESH_SUPERSEDED: 401,
      INVALID_CHANGE_TOKEN: 401,
      FORBIDDEN: 403,
      ACCOUNT_LOCKED: 403,
      SELF_ACTION_FORBIDDEN: 403,
      NOT_FOUND: 404,
      VERSION_CONFLICT: 409,
      KEY_TAKEN: 409,
      USERNAME_TAKEN: 409,
      EMAIL_TAKEN: 409,
      LAST_ADMIN: 409,
      PLATFORM_TENANT_LOCKED: 409,
      TEMP_LOCKED: 423,
      INTERNAL_ERROR: 500,
    });
    expect(ERROR_CODES).toHaveLength(23);
  });

  test("mọi mã hợp lệ theo ErrorResponseSchema M0", () => {
    for (const code of ERROR_CODES) {
      expect(ErrorResponseSchema.safeParse({ error: { code, message: "m" } }).success).toBe(true);
    }
  });
});

describe("ADM-FR-01 · details của lỗi", () => {
  test("ValidationErrorDetails", () => {
    const d = {
      issues: [{ path: ["first_admin", "email"], code: "invalid_format", message: "x" }],
    };
    expect(ValidationErrorDetailsSchema.parse(d)).toEqual(d);
    const json = { issues: [{ path: [], code: "invalid_json", message: "Malformed JSON" }] };
    expect(ValidationErrorDetailsSchema.safeParse(json).success).toBe(true);
    expect(ValidationErrorDetailsSchema.safeParse({ issues: [{ path: [true] }] }).success).toBe(
      false,
    );
  });

  test("LastAdmin / TempLocked", () => {
    expect(LastAdminDetailsSchema.safeParse({ scope: "tenant" }).success).toBe(true);
    expect(LastAdminDetailsSchema.safeParse({ scope: "global" }).success).toBe(false);
    expect(TempLockedDetailsSchema.safeParse({ until: "2026-10-01T08:15:00.000Z" }).success).toBe(
      true,
    );
    expect(TempLockedDetailsSchema.safeParse({ until: "08:15" }).success).toBe(false);
  });
});
