import { describe, expect, test } from "bun:test";
import {
  TenantCreateRequestSchema,
  TenantCreateResponseSchema,
  TenantDetailSchema,
  TenantListQuerySchema,
  TenantListResponseSchema,
  TenantSchema,
  TenantUpdateRequestSchema,
  versionConflictDetailsSchema,
} from "./index";
import { T1, TEMP_PW, tenant, user } from "./test-fixtures";

const firstAdmin = { username: "lumbergh", display_name: "Bill", email: "bill@initech.test" };
const create = { key: "initech", name: "Initech", first_admin: firstAdmin };

describe("ADM-FR-60 · TenantSchema / TenantDetailSchema", () => {
  test("nhận tenant hợp lệ; status khớp active", () => {
    expect(TenantSchema.parse(tenant)).toEqual(tenant);
    const locked = { ...tenant, active: false, status: "locked" };
    expect(TenantSchema.safeParse(locked).success).toBe(true);
    expect(TenantSchema.safeParse({ ...tenant, status: "locked" }).success).toBe(false);
    expect(TenantSchema.safeParse({ ...tenant, settings: {} }).success).toBe(false);
  });

  test("TenantDetail có stats", () => {
    const stats = { user_count: 7, tenant_admin_count: 2, locked_user_count: 1 };
    expect(TenantDetailSchema.parse({ ...tenant, stats }).stats).toEqual(stats);
    expect(TenantDetailSchema.safeParse(tenant).success).toBe(false);
  });

  test("list response + query status", () => {
    const list = { items: [tenant], total: 1, counts: { all: 1, active: 1, locked: 0 } };
    expect(TenantListResponseSchema.parse(list)).toEqual(list);
    expect(TenantListQuerySchema.parse({ status: "locked" })).toEqual({
      status: "locked",
      limit: 50,
      offset: 0,
    });
    expect(TenantListQuerySchema.safeParse({ status: "deleted" }).success).toBe(false);
  });
});

describe("ADM-FR-60 · TenantCreateRequestSchema", () => {
  test("mặc định max_concurrent_sub null, locale en; chuẩn hoá key/username/email", () => {
    const r = TenantCreateRequestSchema.parse({
      ...create,
      key: " Initech ",
      first_admin: { ...firstAdmin, username: "Lumbergh", email: "BILL@initech.test" },
    });
    expect(r.key).toBe("initech");
    expect(r.max_concurrent_sub).toBeNull();
    expect(r.first_admin).toEqual({ ...firstAdmin, locale: "en" });
  });

  test.each([
    ["key sai regex", { ...create, key: "a_b" }],
    ["max_concurrent_sub 0", { ...create, max_concurrent_sub: 0 }],
    ["max_concurrent_sub 10001", { ...create, max_concurrent_sub: 10001 }],
    ["max_concurrent_sub không nguyên", { ...create, max_concurrent_sub: 1.5 }],
    ["thiếu email first_admin", { ...create, first_admin: { username: "x1", display_name: "X" } }],
    ["name rỗng", { ...create, name: "  " }],
    ["name 129", { ...create, name: "a".repeat(129) }],
    ["trường lạ", { ...create, active: false }],
  ])("từ chối: %s", (_n, input) => {
    expect(TenantCreateRequestSchema.safeParse(input).success).toBe(false);
  });

  test("max_concurrent_sub null / 10000 hợp lệ", () => {
    expect(
      TenantCreateRequestSchema.safeParse({ ...create, max_concurrent_sub: null }).success,
    ).toBe(true);
    expect(
      TenantCreateRequestSchema.safeParse({ ...create, max_concurrent_sub: 10000 }).success,
    ).toBe(true);
  });

  test("response {tenant, first_admin, temp_password}", () => {
    const res = { tenant, first_admin: user, temp_password: TEMP_PW };
    expect(TenantCreateResponseSchema.parse(res)).toEqual(res);
    expect(TenantCreateResponseSchema.safeParse({ ...res, temp_password: "short" }).success).toBe(
      false,
    );
  });
});

describe("ADM-FR-60 · TenantUpdateRequestSchema + VERSION_CONFLICT", () => {
  test("cần version; từ chối key", () => {
    expect(TenantUpdateRequestSchema.safeParse({ version: 1, name: "A" }).success).toBe(true);
    expect(
      TenantUpdateRequestSchema.safeParse({ version: 1, max_concurrent_sub: null }).success,
    ).toBe(true);
    expect(TenantUpdateRequestSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(TenantUpdateRequestSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(TenantUpdateRequestSchema.safeParse({ version: 1, key: "x1" }).success).toBe(false);
  });

  test('versionConflictDetailsSchema("tenant") strict', () => {
    const s = versionConflictDetailsSchema("tenant");
    expect(s.parse({ current: tenant, updated_at: T1 }).current).toEqual(tenant);
    expect(s.safeParse({ current: tenant }).success).toBe(false);
    expect(s.safeParse({ current: tenant, updated_at: T1, updated_by: "x" }).success).toBe(false);
    expect(s.safeParse({ current: user, updated_at: T1 }).success).toBe(false);
  });
});
