// CR-159 · onboarding yaml: sau khi tạo user, quản trị công ty vào nhóm Chủ gói, người thường vào nhóm Nhân viên (mặc định) hoặc
// nhóm khai `pack_role`; chạy lại không đổi/không xoá ai. DB thật (role admin_api; mẫu "full" có gói `pkdemo`).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@ai/db";
import { cloneMigratedTestDb, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { parseSpec } from "./adapters/onboard.schema";
import { onboardTenant } from "./tenant-onboard.run";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const PT = "01900000-0000-7000-8000-000000c15951";
const PA = "01900000-0000-7000-8000-000000c15952";
let owner: postgres.Sql;
let db: ReturnType<typeof createDb>;

const yaml = (extra = "") => `
key: grp-t
name: Cong ty nhom
packs: [pkdemo]
users:
  - { email: boss@grp.test, name: Sếp, title: Giám đốc, role: admin }
  - { email: lan@grp.test, name: Lan, title: Nhân viên, role: member }
  - { email: xem@grp.test, name: Xem, title: Kế toán, role: member, pack_role: viewer }${extra}
root: { key: pb-gd, vi: Ban Giám đốc, head: boss@grp.test }
`;
const spec = (extra?: string) => {
  const p = parseSpec(yaml(extra));
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.spec;
};
const opts = { sharedPassword: "Mat-khau-chung-12345", forceChange: true };
const membersOf = async (role: string) =>
  (
    await owner<{ u: string }[]>`select u.username as u from admin.group_members m
      join admin.groups g on g.id = m.group_id join admin.users u on u.id = m.user_id
      join admin.tenants t on t.id = m.tenant_id and t.key = 'grp-t'
      where g.key = ${`pkdemo-${role}`} order by 1`
  ).map((r) => r.u);
const total = async () =>
  (
    await owner<{ n: number }[]>`select count(*)::int as n from admin.group_members m
      join admin.tenants t on t.id = m.tenant_id and t.key = 'grp-t'
      join admin.groups g on g.id = m.group_id and g.key like 'pkdemo-%'`
  )[0]?.n;

beforeAll(async () => {
  await cloneMigratedTestDb(OWNER as string, { key: "full", migrate: migrateFullTest });
  owner = postgres(OWNER as string, { max: 2, onnotice: () => {} });
  db = createDb(API as string, { max: 6 });
  await owner`insert into admin.tenants (id, key, name) values (${PT}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind)
    values (${PA}, ${PT}, 'root', 'h', 'Root', 'platform_admin', 'r@x.test', 'internal')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
});

describe("CR-159 · onboarding yaml ⇒ nhóm vai của gói", () => {
  test("tenant mới: quản trị vào Chủ gói, người thường vào Nhân viên, pack_role khai thì theo khai; người được giao khác người tạo", async () => {
    await onboardTenant(db, spec(), PA, opts);
    expect(await membersOf("owner")).toEqual(["boss"]);
    expect(await membersOf("editor")).toEqual(["lan"]);
    expect(await membersOf("viewer")).toEqual(["xem"]);
    // người tạo (platform admin) không bị kéo vào nhóm của công ty
    const [r] = await owner<{ n: number }[]>`select count(*)::int as n from admin.group_members
      where user_id = ${PA}`;
    expect(r?.n).toBe(0);
  });

  test("chạy lại: không đổi, không nhân đôi, không xoá ai", async () => {
    const before = await total();
    await onboardTenant(db, spec(), PA, opts);
    expect(await total()).toBe(before);
    expect(await membersOf("owner")).toEqual(["boss"]);
    expect(await membersOf("editor")).toEqual(["lan"]);
  });

  test("thêm người mới vào yaml, chạy lại: chỉ người mới được thêm; người đã gỡ khỏi yaml vẫn ở nhóm", async () => {
    const extra = "\n  - { email: nam@grp.test, name: Nam, title: Nhân viên, role: member }";
    await onboardTenant(db, spec(extra), PA, opts);
    expect(await membersOf("editor")).toEqual(["lan", "nam"]);
    await onboardTenant(db, spec(), PA, opts);
    expect(await membersOf("editor")).toEqual(["lan", "nam"]);
  });

  test("quản trị khai pack_role ⇒ lỗi file khai báo", () => {
    const p = parseSpec(yaml().replace("role: admin }", "role: admin, pack_role: editor }"));
    expect(p.ok).toBe(false);
  });
});
