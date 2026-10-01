// ADM-FR-60, ADM-FR-61 · tenants.service trên DB thật qua role admin_api (plan M1 §8, §10 G13).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { createTenant, setTenantLocked, updateTenant } from "./tenants.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const ctx = { db: createDb(API, { max: 2 }) };
const PLATFORM = { kind: "platform" } as const;
const input = (key: string, username = "boss") => ({
  key,
  name: key,
  max_concurrent_sub: null,
  first_admin: { username, display_name: "Boss", email: `boss@${key}.test`, locale: "vi" as const },
});
const count = async () =>
  (
    await owner`select (select count(*)::int from admin.tenants) as t, (select count(*)::int from admin.users) as u`
  )[0];
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (isAppError(e) ? e.code : `raw:${(e as { cause?: { code?: string } }).cause?.code}`),
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
});
beforeEach(async () => {
  await owner`truncate admin.refresh_tokens, admin.users, admin.tenants cascade`;
});
afterAll(async () => {
  await ctx.db.close();
  await owner.end();
});

describe("ADM-FR-60 · createTenant", () => {
  test("ADM-FR-60 · lỗi giữa chừng khi tạo first admin (CHECK username) → không còn hàng tenants", async () => {
    expect(await code(createTenant(ctx, PLATFORM, input("acme", "BAD NAME")))).toBe("raw:23514");
    expect(await count()).toEqual({ t: 0, u: 0 });
  });

  test("ADM-FR-60 · key trùng → KEY_TAKEN, transaction vẫn sạch", async () => {
    expect(await code(createTenant(ctx, PLATFORM, input("acme")))).toBe("ok");
    expect(await code(createTenant(ctx, PLATFORM, input("acme")))).toBe("KEY_TAKEN");
    expect(await count()).toEqual({ t: 1, u: 1 });
  });

  test("ADM-BR-09 · scope tenant khác không tạo được tenant (RLS WITH CHECK)", async () => {
    const scope = { kind: "tenant", tenantId: "01900000-0000-7000-8000-00000000e001" } as const;
    expect(await code(createTenant(ctx, scope, input("acme")))).toBe("raw:42501");
  });
});

describe("ADM-FR-61 · lock/unlock, ADM-FR-60 · version", () => {
  test("ADM-FR-61 · lock 2 lần chỉ tăng version một lần; unlock gỡ locked_by_tenant", async () => {
    const r = await createTenant(ctx, PLATFORM, input("acme"));
    const a = await setTenantLocked(ctx, PLATFORM, r.tenant.id, true);
    const b = await setTenantLocked(ctx, PLATFORM, r.tenant.id, true);
    expect([a.version, b.version, b.status]).toEqual([2, 2, "locked"]);
    const [u] = await owner`select locked_by_tenant, version from admin.users`;
    expect(u).toEqual({ locked_by_tenant: true, version: 2 });
    const c = await setTenantLocked(ctx, PLATFORM, r.tenant.id, false);
    expect([c.version, c.status]).toEqual([3, "active"]);
    const [u2] = await owner`select locked_by_tenant from admin.users`;
    expect(u2?.locked_by_tenant).toBe(false);
  });

  test("ADM-FR-60 · PATCH trùng giá trị → không tăng version; lệch version → VERSION_CONFLICT", async () => {
    const r = await createTenant(ctx, PLATFORM, input("acme"));
    const same = await updateTenant(ctx, PLATFORM, r.tenant.id, { version: 1, name: "acme" });
    expect(same.version).toBe(1);
    expect(await code(updateTenant(ctx, PLATFORM, r.tenant.id, { version: 9, name: "x" }))).toBe(
      "VERSION_CONFLICT",
    );
  });
});
