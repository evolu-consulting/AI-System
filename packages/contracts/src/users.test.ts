import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  TempPasswordResponseSchema,
  UserCreateRequestSchema,
  UserCreateResponseSchema,
  UserListQuerySchema,
  UserListResponseSchema,
  UserSchema,
  UserUpdateRequestSchema,
  versionConflictDetailsSchema,
} from "./index";
import { T0, T1, TEMP_PW, TENANT_ID, user } from "./test-fixtures";

describe("ADM-FR-04 · UserSchema", () => {
  test("nhận user hợp lệ; thời gian null được", () => {
    expect(UserSchema.parse(user)).toEqual(user);
    const seen = { ...user, locked_until: T1, last_login_at: T0, email: "an@acme.test" };
    expect(UserSchema.safeParse(seen).success).toBe(true);
  });

  test("ADM-FR-05 · status locked ⇔ !active || locked_by_tenant", () => {
    const byAdmin = { ...user, active: false, status: "locked" };
    const byTenant = { ...user, locked_by_tenant: true, status: "locked" };
    expect(UserSchema.safeParse(byAdmin).success).toBe(true);
    expect(UserSchema.safeParse(byTenant).success).toBe(true);
    expect(UserSchema.safeParse({ ...user, active: false }).success).toBe(false);
    expect(UserSchema.safeParse({ ...user, status: "locked" }).success).toBe(false);
  });

  test("từ chối trường lạ (password_hash) và role lạ", () => {
    expect(UserSchema.safeParse({ ...user, password_hash: "x" }).success).toBe(false);
    expect(UserSchema.safeParse({ ...user, role: "superuser" }).success).toBe(false);
  });
});

describe("ADM-FR-04 · list", () => {
  test("query: tenant_id uuid, role, status, login=never", () => {
    const q = { tenant_id: TENANT_ID, role: "member", status: "active", login: "never" } as const;
    expect(UserListQuerySchema.parse(q)).toEqual({ ...q, limit: 50, offset: 0 });
    expect(UserListQuerySchema.safeParse({ tenant_id: "acme" }).success).toBe(false);
    expect(UserListQuerySchema.safeParse({ login: "recent" }).success).toBe(false);
    expect(UserListQuerySchema.safeParse({ group: "x" }).success).toBe(false);
  });

  test("response {items, total, counts}", () => {
    const list = { items: [user], total: 1, counts: { all: 3, active: 1, locked: 2 } };
    expect(UserListResponseSchema.parse(list)).toEqual(list);
    expect(UserListResponseSchema.safeParse({ items: [user], total: 1 }).success).toBe(false);
  });
});

describe("ADM-FR-63 · UserCreateRequestSchema", () => {
  const base = { username: "nam", display_name: "Nam", role: "member" } as const;
  test("chuẩn hoá username, mặc định locale en, email tuỳ chọn", () => {
    const r = UserCreateRequestSchema.parse({ ...base, username: "NamNguyen" });
    expect(r).toEqual({ ...base, username: "namnguyen", locale: "en" });
    expect(UserCreateRequestSchema.safeParse({ ...base, email: null }).success).toBe(true);
    expect(UserCreateRequestSchema.parse({ ...base, email: "LAN@ACME.test" }).email).toBe(
      "lan@acme.test",
    );
  });

  test.each([
    ["username 33", { ...base, username: "a".repeat(33) }],
    ["username có khoảng trắng", { ...base, username: "na m" }],
    ["username có @", { ...base, username: "na@m" }],
    ["display_name trống", { ...base, display_name: "  " }],
    ["display_name 65", { ...base, display_name: "a".repeat(65) }],
    ["email sai", { ...base, email: "x" }],
    ["role lạ", { ...base, role: "owner" }],
    ["trường lạ", { ...base, active: false }],
  ])("từ chối: %s", (_n, input) => {
    expect(UserCreateRequestSchema.safeParse(input).success).toBe(false);
  });

  test("response {user, temp_password} và TempPasswordResponse", () => {
    expect(UserCreateResponseSchema.safeParse({ user, temp_password: TEMP_PW }).success).toBe(true);
    expect(TempPasswordResponseSchema.safeParse({ temp_password: TEMP_PW }).success).toBe(true);
    expect(TempPasswordResponseSchema.safeParse({ temp_password: "abc" }).success).toBe(false);
  });
});

describe("ADM-FR-04 · UserUpdateRequestSchema + VERSION_CONFLICT", () => {
  test("cần version; từ chối username", () => {
    expect(UserUpdateRequestSchema.safeParse({ version: 1, email: null }).success).toBe(true);
    expect(UserUpdateRequestSchema.safeParse({ version: 1, role: "tenant_admin" }).success).toBe(
      true,
    );
    expect(UserUpdateRequestSchema.safeParse({ display_name: "A" }).success).toBe(false);
    expect(UserUpdateRequestSchema.safeParse({ version: 1, username: "x1" }).success).toBe(false);
  });

  test('versionConflictDetailsSchema("user") và dạng schema tuỳ ý', () => {
    const s = versionConflictDetailsSchema("user");
    expect(s.parse({ current: user, updated_at: T1 }).current).toEqual(user);
    expect(s.safeParse({ current: { ...user, extra: 1 }, updated_at: T1 }).success).toBe(false);
    const g = versionConflictDetailsSchema(z.strictObject({ id: z.string() }));
    expect(g.safeParse({ current: { id: "x" }, updated_at: T1 }).success).toBe(true);
  });
});
