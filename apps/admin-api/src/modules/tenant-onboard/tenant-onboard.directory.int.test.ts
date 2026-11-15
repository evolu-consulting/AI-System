// CR-159 · onboarding bật danh bạ công ty (đúng `setDirectoryListed` của dịch vụ, có audit): đủ hồ sơ ⇒ bật; thiếu tên pháp lý/MST
// hoặc `directory: unlisted` ⇒ không bật; chạy lại không đổi (không audit mới, không tăng version).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@ai/db";
import { cloneMigratedTestDb, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { parseSpec } from "./adapters/onboard.schema";
import { onboardTenant } from "./tenant-onboard.run";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const PT = "01900000-0000-7000-8000-000000c15911";
const PA = "01900000-0000-7000-8000-000000c15912";
let owner: postgres.Sql;
let db: ReturnType<typeof createDb>;

const yaml = (key: string, extra: string) => `
key: ${key}
name: Cong ty ${key}
${extra}
root: { key: pb-gd, vi: Ban Giám đốc }
`;
const spec = (key: string, extra: string) => {
  const p = parseSpec(yaml(key, extra));
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.spec;
};
const FULL = "profile: { legal_name: Cong ty Day Du, tax_id: '0312345678' }";
const state = async (key: string) =>
  (
    await owner<
      { listed: boolean; version: number; audit: number }[]
    >`select t.directory_listed as listed, t.version,
      (select count(*) from admin.audit_log a where a.entity_id = t.id)::int as audit
      from admin.tenants t where t.key = ${key}`
  )[0];

beforeAll(async () => {
  await cloneMigratedTestDb(OWNER as string, { key: "full", migrate: migrateFullTest });
  owner = postgres(OWNER as string, { max: 2, onnotice: () => {} });
  db = createDb(API as string, { max: 4 });
  await owner`insert into admin.tenants (id, key, name) values (${PT}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind)
    values (${PA}, ${PT}, 'root', 'h', 'Root', 'platform_admin', 'r@x.test', 'internal')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
});

describe("CR-159 · onboarding bật danh bạ", () => {
  test("đủ tên pháp lý + MST ⇒ bật danh bạ, chạy lại không đổi (version, audit)", async () => {
    const r = await onboardTenant(db, spec("dir-full", FULL), PA);
    expect(r.directory).toEqual({ state: "listed", changed: true });
    const a = await state("dir-full");
    expect(a?.listed).toBe(true);
    const r2 = await onboardTenant(db, spec("dir-full", FULL), PA);
    expect(r2.directory).toEqual({ state: "listed", changed: false });
    expect(await state("dir-full")).toEqual(a);
  });
  test("thiếu MST hoặc khai `directory: unlisted` ⇒ không bật, không lỗi", async () => {
    const r = await onboardTenant(db, spec("dir-thin", "profile: { legal_name: Chi co ten }"), PA);
    expect(r.directory).toEqual({ state: "skipped", changed: false });
    expect((await state("dir-thin"))?.listed).toBe(false);
    const u = await onboardTenant(db, spec("dir-off", `${FULL}\ndirectory: unlisted`), PA);
    expect(u.directory.state).toBe("skipped");
    expect((await state("dir-off"))?.listed).toBe(false);
  });
  test("audit ghi việc bật danh bạ như đường UI", async () => {
    const rows = await owner<{ n: number }[]>`select count(*)::int as n from admin.audit_log a
      join admin.tenants t on t.id = a.entity_id where t.key = 'dir-full'
        and a.summary::text like '%directory_listed%'`;
    expect(rows[0]?.n).toBe(1);
  });
});
