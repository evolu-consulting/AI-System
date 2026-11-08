// CR-125 · S1 · C1 · bật app cho công ty (đường wizard onboard) ⇒ quản trị công ty vào vai Chủ gói ngay, người thường thì không,
// công ty khác không bị đụng, lặp lại không nhân đôi. DB thật (role admin_api, DB mẫu "full" có gói `pkdemo`).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@ai/db";
import { cloneMigratedTestDb, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { enablePack, type PacksCall } from "./packs.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-000000c125${String(n).padStart(2, "0")}`;
const [PT, PA, TA, TB, ADMIN_A, MEMBER_A, ADMIN_B, OFF_A, LOCK_A] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
  id,
) as string[];
const PK = "pkdemo";
let owner: postgres.Sql;
let db: ReturnType<typeof createDb>;

const platform = (): PacksCall => ({
  ctx: { db },
  actor: { userId: PA as string },
  scope: { kind: "platform" },
});

/** Người (username) đang ở Group `<PK>-<vai>` của tenant. */
const membersOf = async (tenantId: string, role: string) =>
  (
    await owner<{ u: string }[]>`select u.username as u from admin.group_members m
      join admin.groups g on g.id = m.group_id join admin.users u on u.id = m.user_id
      where m.tenant_id = ${tenantId} and g.key = ${`${PK}-${role}`} order by 1`
  ).map((r) => r.u);

beforeAll(async () => {
  await cloneMigratedTestDb(OWNER, { key: "full", migrate: migrateFullTest });
  owner = postgres(OWNER as string, { max: 2, onnotice: () => {} });
  db = createDb(API as string, { max: 4 });
  await owner`insert into admin.tenants (id, key, name) values
    (${PT as string}, 'plat', 'P'), (${TA as string}, 'acme', 'A'), (${TB as string}, 'beta', 'B')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind, external_org_id)
    values (${PA as string}, ${PT as string}, 'root', 'h', 'Root', 'platform_admin', 'r@x.test', 'internal', null),
      (${ADMIN_A as string}, ${TA as string}, 'admin-a', 'h', 'Admin A', 'tenant_admin', 'aa@x.test', 'internal', null),
      (${MEMBER_A as string}, ${TA as string}, 'lan', 'h', 'Lan', 'member', 'lan@x.test', 'internal', null),
      (${ADMIN_B as string}, ${TB as string}, 'admin-b', 'h', 'Admin B', 'tenant_admin', 'ab@x.test', 'internal', null)`;
  // quản trị đã vô hiệu hoá / bị công ty khoá: KHÔNG được làm Chủ gói
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind, active, deactivated_at)
    values (${OFF_A as string}, ${TA as string}, 'admin-off', 'h', 'Off', 'tenant_admin', 'off@x.test', 'internal', false, now())`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind, locked_by_tenant)
    values (${LOCK_A as string}, ${TA as string}, 'admin-lock', 'h', 'Lock', 'tenant_admin', 'lock@x.test', 'internal', true)`;
});

/** Dòng nhật ký "thành viên Group" của Group Chủ gói: danh sách `added` theo thứ tự ghi. */
const addedAudit = async (tenantId: string) =>
  (
    await owner<{ added: string[] }[]>`select a.summary->'added' as added from admin.audit_log a
      join admin.groups g on g.id = a.entity_id
      where a.tenant_id = ${tenantId} and g.key = ${`${PK}-owner`} and a.summary ? 'added' order by a.seq`
  ).map((r) => r.added);
afterAll(async () => {
  await db?.close();
  await owner?.end();
});

describe("CR-125 · S1 · quản trị công ty đầu tiên dùng được app đã gán", () => {
  test("C1 · bật app bằng đường wizard ⇒ quản trị công ty vào vai Chủ gói (đủ quyền gói); người thường và công ty khác thì không; lặp lại không nhân đôi", async () => {
    await enablePack(platform(), TA as string, PK, "read", { grantTenantAdmins: true });
    expect(await membersOf(TA as string, "owner")).toEqual(["admin-a"]);
    expect(await membersOf(TA as string, "editor")).toEqual([]);
    expect(await membersOf(TA as string, "viewer")).toEqual([]);
    // người thường không có vai nào của gói
    const [lan] = await owner<{ n: number }[]>`select count(*)::int as n from admin.group_members
      where user_id = ${MEMBER_A as string}`;
    expect(lan?.n).toBe(0);
    // quyền thật: Group Chủ gói giữ đủ 3 mã gói (trần công ty mới quyết định mức dùng được)
    const feats = await owner<{ k: string }[]>`select f.key as k from admin.group_members m
      join admin.feature_grants fg on fg.group_id = m.group_id
      join admin.features f on f.id = fg.feature_id
      where m.user_id = ${ADMIN_A as string} order by 1`;
    expect(feats.map((f) => f.k)).toEqual(["pkdemo-admin", "pkdemo-read", "pkdemo-write"]);
    // công ty khác chưa bật gói ⇒ không có gì
    expect(await membersOf(TB as string, "owner")).toEqual([]);
    // lặp lại ⇒ không nhân đôi
    await enablePack(platform(), TA as string, PK, "write", { grantTenantAdmins: true });
    expect(await membersOf(TA as string, "owner")).toEqual(["admin-a"]); // admin-off/admin-lock không vào
    expect(await addedAudit(TA as string)).toEqual([["admin-a"]]); // vết ai được làm Chủ gói (chỉ lần đầu)
  });

  test("C1 · gói đã bật từ trước, quản trị bị gỡ khỏi Chủ gói ⇒ bật lại vẫn thêm VÀ ghi nhật ký", async () => {
    await owner`delete from admin.group_members where tenant_id = ${TA as string}`;
    await enablePack(platform(), TA as string, PK, undefined, { grantTenantAdmins: true });
    expect(await membersOf(TA as string, "owner")).toEqual(["admin-a"]);
    expect(await addedAudit(TA as string)).toEqual([["admin-a"], ["admin-a"]]);
  });

  test("C1 · công ty B bật app ⇒ chỉ quản trị của B vào vai, không đụng quản trị của A", async () => {
    await enablePack(platform(), TB as string, PK, undefined, { grantTenantAdmins: true });
    expect(await membersOf(TB as string, "owner")).toEqual(["admin-b"]);
    expect(await membersOf(TA as string, "owner")).toEqual(["admin-a"]);
  });

  test("không bật tuỳ chọn (importer/CLI) ⇒ hành vi cũ, không tự thêm ai", async () => {
    await owner`delete from admin.group_members where tenant_id = ${TB as string}`;
    await enablePack(platform(), TB as string, PK);
    expect(await membersOf(TB as string, "owner")).toEqual([]);
  });
});
