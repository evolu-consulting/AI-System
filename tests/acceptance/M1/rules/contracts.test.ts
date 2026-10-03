// ADM-FR-01, ADM-FR-04, ADM-FR-60 · hằng, bảng mã lỗi và schema contract M1 (spec §3). Chỉ cần @ai/contracts.
import { describe, expect, it } from "bun:test";
import {
  API_ERRORS,
  ChangePasswordRequestSchema,
  COMPANY_KEY_RE,
  DISPLAY_NAME_MAX,
  EMAIL_MAX,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  LOCALES,
  LoginRequestSchema,
  LoginResponseSchema,
  PASSWORD_MAX_LEN,
  PASSWORD_MIN_LEN,
  ROLES,
  TEMP_PASSWORD_LEN,
  TenantCreateRequestSchema,
  TenantListQuerySchema,
  TenantUpdateRequestSchema,
  USERNAME_RE,
  UserListQuerySchema,
  UserUpdateRequestSchema,
} from "@ai/contracts";

const ok = (r: { success: boolean }) => r.success;

describe("ADM-FR-01 · bảng mã lỗi", () => {
  it("ADM-FR-01 · spec §3 · API_ERRORS chứa đúng 23 mã M1 với status không đổi; tập cũ giữ nguyên sau M4 (toMatchObject)", () => {
    expect(API_ERRORS).toMatchObject({
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
    // M4 (Q2a, test-plan §5 K5): không đếm — tổng 48 mã kiểm ở M4/rules/contracts-cd.test.ts (D-K04).
  });
});

describe("ADM-FR-60 · hằng số và regex", () => {
  it("ADM-FR-60 · M1-R15 · COMPANY_KEY_RE và USERNAME_RE", () => {
    expect(COMPANY_KEY_RE.test("acme")).toBe(true);
    expect(COMPANY_KEY_RE.test("a-1")).toBe(true);
    for (const bad of ["a", "A", "a_b", "a".repeat(33), "a b"]) {
      expect(COMPANY_KEY_RE.test(bad)).toBe(false);
    }
    expect(USERNAME_RE.test("an.nguyen_1-x")).toBe(true);
    for (const bad of ["a", "An", "a@b", "a b", "a".repeat(33)]) {
      expect(USERNAME_RE.test(bad)).toBe(false);
    }
  });

  it("ADM-FR-60 · spec §3 · hằng độ dài, danh sách phân trang, enum", () => {
    expect(PASSWORD_MIN_LEN).toBe(10);
    expect(PASSWORD_MAX_LEN).toBe(128);
    expect(DISPLAY_NAME_MAX).toBe(64);
    expect(EMAIL_MAX).toBe(254);
    expect(LIST_LIMIT_DEFAULT).toBe(50);
    expect(LIST_LIMIT_MAX).toBe(200);
    expect(TEMP_PASSWORD_LEN).toBe(16);
    expect([...ROLES]).toEqual(["platform_admin", "tenant_admin", "member"]);
    expect([...LOCALES]).toEqual(["vi", "en"]);
  });
});

describe("ADM-FR-01 · schema auth", () => {
  it("ADM-FR-01 · M1-R01 · LoginRequestSchema: trim + lowercase tenant_key/username; mật khẩu 1–128; trường lạ → lỗi", () => {
    const r = LoginRequestSchema.parse({ tenant_key: " ACME ", username: " AN ", password: "x" });
    expect(r).toEqual({ tenant_key: "acme", username: "an", password: "x" });
    const base = { tenant_key: "acme", username: "an" };
    expect(ok(LoginRequestSchema.safeParse({ ...base, password: "" }))).toBe(false);
    expect(ok(LoginRequestSchema.safeParse({ ...base, password: "p".repeat(128) }))).toBe(true);
    expect(ok(LoginRequestSchema.safeParse({ ...base, password: "p".repeat(129) }))).toBe(false);
    expect(ok(LoginRequestSchema.safeParse({ ...base, password: "x", extra: 1 }))).toBe(false);
    expect(ok(LoginRequestSchema.safeParse({ username: "an", password: "x" }))).toBe(false);
  });

  it("ADM-FR-06 · M1-R06 · ChangePasswordRequestSchema: đúng một trong hai dạng", () => {
    const np = "N".repeat(10);
    expect(ok(ChangePasswordRequestSchema.safeParse({ change_token: "t", new_password: np }))).toBe(
      true,
    );
    expect(
      ok(ChangePasswordRequestSchema.safeParse({ current_password: "c", new_password: np })),
    ).toBe(true);
    const both = { change_token: "t", current_password: "c", new_password: np };
    expect(ok(ChangePasswordRequestSchema.safeParse(both))).toBe(false);
    expect(ok(ChangePasswordRequestSchema.safeParse({ new_password: np }))).toBe(false);
    const short = { change_token: "t", new_password: "N".repeat(9) };
    expect(ok(ChangePasswordRequestSchema.safeParse(short))).toBe(false);
  });

  it("ADM-FR-01 · spec §3 · LoginResponseSchema phân biệt theo status", () => {
    const me = {
      id: "01900000-0000-7000-8000-000000000013",
      tenant: { id: "01900000-0000-7000-8000-000000000001", key: "acme", name: "Acme" },
      username: "an",
      display_name: "An",
      email: null,
      role: "member",
      locale: "vi",
      must_change_password: false,
    };
    const grant = {
      status: "authenticated",
      access_token: "a.b.c",
      token_type: "Bearer",
      expires_in: 900,
      user: me,
    };
    expect(ok(LoginResponseSchema.safeParse(grant))).toBe(true);
    const need = { status: "password_change_required", change_token: "a.b.c", expires_in: 300 };
    expect(ok(LoginResponseSchema.safeParse(need))).toBe(true);
    expect(ok(LoginResponseSchema.safeParse({ ...need, access_token: "x" }))).toBe(false);
    expect(ok(LoginResponseSchema.safeParse({ ...grant, expires_in: 600 }))).toBe(false);
    expect(ok(LoginResponseSchema.safeParse({ status: "other" }))).toBe(false);
  });
});

describe("ADM-FR-60 · schema tenants", () => {
  const admin = { username: "lumbergh", display_name: "Bill", email: "bill@initech.test" };
  const valid = { key: "initech", name: "Initech", first_admin: admin };

  it("ADM-FR-60 · M1-R15 · TenantCreateRequestSchema: key đúng regex, mặc định max_concurrent_sub null, locale vi", () => {
    const r = TenantCreateRequestSchema.parse({ ...valid, key: " Initech " });
    expect(r.key).toBe("initech");
    expect(r.max_concurrent_sub).toBeNull();
    expect(r.first_admin.locale).toBe("vi");
    for (const key of ["a", "a_b", "a".repeat(33)]) {
      expect(ok(TenantCreateRequestSchema.safeParse({ ...valid, key }))).toBe(false);
    }
  });

  it("ADM-FR-60 · M1-R18 · TenantCreateRequestSchema: max_concurrent_sub 1–10000 hoặc null; first_admin.email bắt buộc", () => {
    for (const bad of [0, 10001, 1.5, -1]) {
      const r = TenantCreateRequestSchema.safeParse({ ...valid, max_concurrent_sub: bad });
      expect(ok(r)).toBe(false);
    }
    for (const good of [null, 1, 10000]) {
      const r = TenantCreateRequestSchema.safeParse({ ...valid, max_concurrent_sub: good });
      expect(ok(r)).toBe(true);
    }
    const noEmail = { ...valid, first_admin: { username: "lumbergh", display_name: "Bill" } };
    expect(ok(TenantCreateRequestSchema.safeParse(noEmail))).toBe(false);
    const badEmail = { ...valid, first_admin: { ...admin, email: "khong-phai-email" } };
    expect(ok(TenantCreateRequestSchema.safeParse(badEmail))).toBe(false);
  });

  it("ADM-FR-60 · M1-R15 · TenantUpdateRequestSchema từ chối `key` (bất biến); cần version", () => {
    expect(ok(TenantUpdateRequestSchema.safeParse({ version: 1, name: "X" }))).toBe(true);
    expect(ok(TenantUpdateRequestSchema.safeParse({ version: 1, key: "new" }))).toBe(false);
    expect(ok(TenantUpdateRequestSchema.safeParse({ name: "X" }))).toBe(false);
    expect(ok(TenantUpdateRequestSchema.safeParse({ version: 0, name: "X" }))).toBe(false);
  });
});

describe("ADM-FR-04 · schema users và list query", () => {
  it("ADM-FR-04 · M1-R15 · UserUpdateRequestSchema từ chối `username` (bất biến)", () => {
    expect(ok(UserUpdateRequestSchema.safeParse({ version: 1, display_name: "X" }))).toBe(true);
    expect(ok(UserUpdateRequestSchema.safeParse({ version: 1, username: "moi" }))).toBe(false);
  });

  it("ADM-FR-04 · M1-R19 · list query: mặc định limit 50/offset 0, q rỗng bị bỏ", () => {
    for (const schema of [TenantListQuerySchema, UserListQuerySchema]) {
      const r = schema.parse({});
      expect(r.limit).toBe(50);
      expect(r.offset).toBe(0);
      expect(schema.parse({ q: "   " }).q).toBeUndefined();
      expect(schema.parse({ q: " acm " }).q).toBe("acm");
    }
  });

  it("ADM-FR-04 · M1-R19 · list query: limit 0/201 và offset âm/100001 bị từ chối; trường lạ → lỗi", () => {
    for (const schema of [TenantListQuerySchema, UserListQuerySchema]) {
      for (const bad of [
        { limit: "0" },
        { limit: "201" },
        { offset: "-1" },
        { offset: "100001" },
      ]) {
        expect(ok(schema.safeParse(bad))).toBe(false);
      }
      expect(ok(schema.safeParse({ limit: "200", offset: "100000" }))).toBe(true);
      expect(ok(schema.safeParse({ foo: "1" }))).toBe(false);
    }
    expect(ok(UserListQuerySchema.safeParse({ login: "sometimes" }))).toBe(false);
    expect(ok(UserListQuerySchema.safeParse({ login: "never" }))).toBe(true);
  });
});
