// CR-112 review-fix · ADM-FR-80/81 · ADM-BR-15: vai tuỳ biến không chiếm khoá vai mặc định, chỉ tạo khi công ty có entitlement gói;
// bật gói không nhận nhầm Group vai mặc định đang thuộc vai tuỳ biến; bật gói tới đúng mức; `app_roles_grant_agents` chỉ tenant
// của phiên (ngoài scope platform).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, withScope } from "@ai/db";
import { cloneMigratedTestDb, migrateFullTest } from "@ai/db/test-db";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { enablePack, listPacks } from "../packs/packs.service";
import { type Call, createRole, listRoles } from "./app-roles.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-000000c1f0${String(n).padStart(2, "0")}`;
const [PT, PA, TA, TC, TD, AA, CA] = [1, 2, 3, 4, 5, 6, 7].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const PK = "pkdemo";
let owner: postgres.Sql;
let db: ReturnType<typeof createDb>;

const platform = (): Call => ({
  ctx: { db },
  actor: { userId: PA, tenantId: PT, role: "platform_admin" },
  scope: { kind: "platform" },
});
const tadmin = (tid: string, uid: string): Call => ({
  ctx: { db },
  actor: { userId: uid, tenantId: tid, role: "tenant_admin" },
  scope: { kind: "tenant", tenantId: tid },
});
const caught = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const st = (e: unknown) => [(e as { code?: string })?.code, (e as { status?: number })?.status];
const entOf = async (tid: string) =>
  (
    await owner<{ k: string }[]>`select f.key as k from admin.feature_entitlements e
      join admin.features f on f.id = e.feature_id
      where e.tenant_id = ${tid} and e.revoked_at is null and f.key like 'pkdemo-%' order by 1`
  ).map((r) => r.k);

beforeAll(async () => {
  await cloneMigratedTestDb(OWNER, { key: "full", migrate: migrateFullTest });
  owner = postgres(OWNER as string, { max: 2, onnotice: () => {} });
  db = createDb(API as string, { max: 4 });
  await owner`insert into admin.tenants (id, key, name) values
    (${PT}, 'plat', 'P'), (${TA}, 'acme', 'A'), (${TC}, 'cee', 'C'), (${TD}, 'dee', 'D')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email)
    values (${PA}, ${PT}, 'root', 'h', 'Root', 'platform_admin', 'r@x.test'),
      (${AA}, ${TA}, 'aa', 'h', 'AA', 'tenant_admin', 'aa@x.test'),
      (${CA}, ${TC}, 'ca', 'h', 'CA', 'tenant_admin', 'ca@x.test')`;
  await enablePack(platform(), TA, PK);
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
});

describe("CR-112 review · vai tuỳ biến và Group vai mặc định", () => {
  test("ADM-FR-80 · gói chưa bật cho công ty ⇒ 422 PACK_NOT_ROLEABLE (tenant_admin không đặt trước Group `<k'>-owner`)", async () => {
    const c = tadmin(TC, CA);
    const e = await caught(
      createRole(c, undefined, { pack: PK, name: { vi: "x" }, level: "read" }),
    );
    expect(st(e)).toEqual(["PACK_NOT_ROLEABLE", 422]);
    const g =
      await owner`select 1 from admin.groups where tenant_id = ${TC} and key like 'pkdemo-%'`;
    expect(g.length).toBe(0);
  });

  test("ADM-FR-80 · khoá viewer/editor/owner dành cho vai mặc định ⇒ 422 ROLE_KEY_RESERVED", async () => {
    const a = tadmin(TA, AA);
    for (const key of ["owner", "editor", "viewer"]) {
      const e = await caught(
        createRole(a, undefined, { pack: PK, name: { vi: "x" }, level: "read", key }),
      );
      expect(st(e)).toEqual(["ROLE_KEY_RESERVED", 422]);
    }
  });

  test("ADM-FR-81 · Group `<k'>-owner` đã thuộc vai tuỳ biến (dữ liệu cũ) ⇒ bật gói 409 ROLE_GROUP_CONFLICT, không ghi gì", async () => {
    const [g] = await owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${TC}, 'pkdemo-owner', '{"vi":"cũ"}'::jsonb) returning id`;
    await owner`insert into admin.app_roles (tenant_id, pack, key, name, level, group_id)
      values (${TC}, 'pkdemo', 'owner', '{"vi":"cũ"}'::jsonb, 'read', ${g?.id as string})`;
    const e = await caught(enablePack(platform(), TC, PK));
    expect(st(e)).toEqual(["ROLE_GROUP_CONFLICT", 409]);
    expect((e as { details?: unknown }).details).toEqual({ keys: ["pkdemo-owner"] });
    expect(await entOf(TC)).toEqual([]);
    const grants =
      await owner`select 1 from admin.feature_grants where group_id = ${g?.id as string}`;
    expect(grants.length).toBe(0);
  });
});

describe("CR-112 review · bật gói tới mức", () => {
  test("ADM-FR-78 · PUT ?level=write ⇒ entitlement read+write (không admin); vai Toàn quyền không hiệu lực", async () => {
    await enablePack(platform(), TD, PK, "write");
    expect(await entOf(TD)).toEqual(["pkdemo-read", "pkdemo-write"]);
    const { items } = await listRoles(platform(), { tenant_id: TD, pack: PK });
    const owner_ = items.find((r) => r.key === "owner");
    expect([owner_?.ceiling, owner_?.effective]).toEqual(["write", false]);
    expect((await listPacks(platform(), TD)).items.find((p) => p.key === PK)?.enabled).toBe(true);
  });
});

describe("CR-112 review · app_roles_grant_agents chỉ tenant của phiên", () => {
  test("ADM-FR-80 · scope tenant gọi cho tenant khác ⇒ 42501; tenant mình / platform ⇒ chạy", async () => {
    const call = (scope: Parameters<typeof withScope>[1], tid: string) =>
      withScope(db, scope, (tx) =>
        tx.execute(sql`select admin.app_roles_grant_agents(${tid}::uuid, null, ${PA}::uuid) as r`),
      );
    const cross = await caught(call({ kind: "tenant", tenantId: TA }, TD));
    const code =
      (cross as { cause?: { code?: string }; code?: string })?.cause?.code ??
      (cross as { code?: string })?.code;
    expect(code).toBe("42501");
    expect(await caught(call({ kind: "tenant", tenantId: TA }, TA))).toBeNull();
    expect(await caught(call({ kind: "platform" }, TD))).toBeNull();
  });
});
