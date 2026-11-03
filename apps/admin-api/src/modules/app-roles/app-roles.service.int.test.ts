// CR-112 S1 · ADM-FR-80, ADM-FR-81, ADM-FR-82 · ADM-BR-15/16 · vai theo app trên DB thật (role admin_api, DB mẫu "full" có gói
// `pkdemo`): bật gói tạo vai mặc định, biên dịch chỉ đụng mã gói trên Group của vai, trần công ty ⇒ effective, chặn chéo
// tenant (404), đối tác không vào vai, backfill idempotent, biên dịch 50 vai = số câu SQL cố định.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, type Tx, withScope } from "@ai/db";
import { cloneMigratedTestDb, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { isAppError } from "../../lib/errors";
import { enablePack, listPacks } from "../packs/packs.service";
import { compileRoles } from "./app-roles.compile";
import { addRoleMembers, removeRoleMember } from "./app-roles.members";
import { type Call, createRole, deleteRole, listRoles, updateRole } from "./app-roles.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-000000c112${String(n).padStart(2, "0")}`;
const [PT, PA, TA, TB, AA, BA, LAN, EXT, ORG, U50] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
  id,
) as string[];
const PK = "pkdemo";
let owner: postgres.Sql;
let db: ReturnType<typeof createDb>;

const platform = (): Call => ({
  ctx: { db },
  actor: {
    userId: PA as string,
    tenantId: PT as string,
    role: "platform_admin",
  },
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
const grantsOf = async (groupId: string) =>
  (
    await owner<{ k: string }[]>`select f.key as k from admin.feature_grants fg
      join admin.features f on f.id = fg.feature_id where fg.group_id = ${groupId} order by 1`
  ).map((r) => r.k);
const cfg = async () =>
  (await owner<{ v: number }[]>`select config_version as v from admin.config_meta`)[0]?.v ?? -1;

beforeAll(async () => {
  await cloneMigratedTestDb(OWNER, { key: "full", migrate: migrateFullTest });
  owner = postgres(OWNER as string, { max: 2, onnotice: () => {} });
  db = createDb(API as string, { max: 4 });
  await owner`insert into admin.tenants (id, key, name) values
    (${PT as string}, 'plat', 'P'), (${TA as string}, 'acme', 'A'), (${TB as string}, 'beta', 'B')`;
  await owner`insert into admin.external_orgs (id, tenant_id, name) values (${ORG as string}, ${TA as string}, 'Đối tác')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind, external_org_id)
    values (${PA as string}, ${PT as string}, 'root', 'h', 'Root', 'platform_admin', 'r@x.test', 'internal', null),
      (${AA as string}, ${TA as string}, 'aa', 'h', 'AA', 'tenant_admin', 'aa@x.test', 'internal', null),
      (${BA as string}, ${TB as string}, 'ba', 'h', 'BA', 'tenant_admin', 'ba@x.test', 'internal', null),
      (${LAN as string}, ${TA as string}, 'lan', 'h', 'Lan', 'member', 'lan@x.test', 'internal', null),
      (${EXT as string}, ${TA as string}, 'doitac', 'h', 'ĐT', 'member', 'dt@x.test', 'external', ${ORG as string})`;
  await enablePack(platform(), TA as string, PK);
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
});

describe("CR-112 · ADM-FR-81 · vai mặc định + trần công ty", () => {
  test("ADM-FR-81 · bật gói tạo 3 vai mặc định (viewer=read, editor=write, owner=admin) gắn đúng Group vai", async () => {
    const rows = await owner<{ key: string; level: string; is_default: boolean; gk: string }[]>`
      select r.key, r.level, r.is_default, g.key as gk from admin.app_roles r join admin.groups g on g.id = r.group_id
      where r.tenant_id = ${TA as string} and r.pack = ${PK} order by r.key`;
    expect([...rows]).toEqual([
      { key: "editor", level: "write", is_default: true, gk: "pkdemo-editor" },
      { key: "owner", level: "admin", is_default: true, gk: "pkdemo-owner" },
      { key: "viewer", level: "read", is_default: true, gk: "pkdemo-viewer" },
    ]);
    await enablePack(platform(), TA as string, PK); // lặp: không nhân đôi
    const [n] = await owner<
      { n: number }[]
    >`select count(*)::int as n from admin.app_roles where tenant_id = ${TA as string}`;
    expect(n?.n).toBe(3);
  });

  test("ADM-BR-12 · vai vượt trần công ty (entitlement mức cao nhất) ⇒ effective=false", async () => {
    await owner`update admin.feature_entitlements set revoked_at = now() where tenant_id = ${TA as string}
      and feature_id = (select id from admin.features where key = 'pkdemo-admin')`;
    try {
      const { items } = await listRoles(platform(), { tenant_id: TA as string, pack: PK });
      const by = Object.fromEntries(items.map((r) => [r.key, r]));
      expect(by.owner?.ceiling).toBe("write");
      expect([by.viewer?.effective, by.editor?.effective, by.owner?.effective]).toEqual([
        true,
        true,
        false,
      ]);
      expect(by.viewer?.member_count).toBe(0);
    } finally {
      await owner`update admin.feature_entitlements set revoked_at = null where tenant_id = ${TA as string}`;
    }
  });
});

describe("CR-112 · ADM-FR-80/81 · vai tuỳ biến + biên dịch", () => {
  test("ADM-BR-15 · đổi mức chỉ thêm/gỡ mã gói trên Group của vai; grant ngoài gói và Group phòng ban không bị đụng", async () => {
    const c = platform();
    const r = await createRole(c, TA, { pack: PK, name: { vi: "Kế toán" }, level: "write" });
    expect(r.is_default).toBe(false);
    expect(await grantsOf(r.group_id)).toEqual(["pkdemo-read", "pkdemo-write"]);
    // Grant lạ trên Group của vai (mã gói thừa + feature ngoài gói) và Group phòng ban có grant gói.
    await owner`insert into admin.features (key, name) values ('ext-x', '{"vi":"X"}'::jsonb) on conflict do nothing`;
    await owner`insert into admin.feature_entitlements (feature_id, tenant_id)
      select id, ${TA as string} from admin.features where key = 'ext-x' on conflict do nothing`;
    const [dept] = await owner<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${TA as string}, 'pb-ke-toan', '{"vi":"PB"}'::jsonb) returning id`;
    await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id)
      select ${TA as string}, f.id, g from admin.features f,
        (values (${r.group_id}::uuid, 'pkdemo-admin'), (${r.group_id}::uuid, 'ext-x'), (${dept?.id as string}::uuid, 'pkdemo-admin')) v(g, k)
      where f.key = v.k`;
    const v0 = await cfg();
    const a0 = (
      await owner<
        { n: number }[]
      >`select count(*)::int as n from admin.audit_log where entity = 'grant'`
    )[0]?.n;
    const up = await updateRole(c, r.id, { version: r.version, level: "read" });
    expect(up.level).toBe("read");
    expect(up.version).toBe(r.version + 1);
    expect(await grantsOf(r.group_id)).toEqual(["ext-x", "pkdemo-read"]);
    expect(await grantsOf(dept?.id as string)).toEqual(["pkdemo-admin"]);
    expect(await cfg()).toBeGreaterThan(v0);
    const a1 = (
      await owner<
        { n: number }[]
      >`select count(*)::int as n from admin.audit_log where entity = 'grant'`
    )[0]?.n;
    expect((a1 ?? 0) - (a0 ?? 0)).toBe(2); // gỡ pkdemo-write + pkdemo-admin
    const up2 = await updateRole(c, r.id, {
      version: up.version,
      level: "admin",
      name: { vi: "KT trưởng" },
    });
    expect(await grantsOf(r.group_id)).toEqual([
      "ext-x",
      "pkdemo-admin",
      "pkdemo-read",
      "pkdemo-write",
    ]);
    const [g] = await owner<
      { name: { vi: string } }[]
    >`select name from admin.groups where id = ${r.group_id}`;
    expect(g?.name.vi).toBe("KT trưởng");
    const stale = await caught(updateRole(c, r.id, { version: up.version, name: { vi: "x" } }));
    expect(isAppError(stale, "VERSION_CONFLICT")).toBe(true);
    await deleteRole(c, r.id);
    const [left] = await owner<
      { n: number }[]
    >`select count(*)::int as n from admin.groups where id = ${up2.group_id}`;
    expect(left?.n).toBe(0);
  });

  test("ADM-FR-80 · vai mặc định: không xoá, không đổi mức (409); app chưa cài ⇒ 422; xoá vai còn người ⇒ 409 + số người", async () => {
    const c = platform();
    const { items } = await listRoles(c, { tenant_id: TA as string, pack: PK });
    const viewer = items.find((r) => r.key === "viewer") as (typeof items)[number];
    const st = (e: unknown) => [(e as { code?: string })?.code, (e as { status?: number })?.status];
    expect(st(await caught(deleteRole(c, viewer.id)))).toEqual(["DEFAULT_ROLE_PROTECTED", 409]);
    const lv = caught(updateRole(c, viewer.id, { version: viewer.version, level: "admin" }));
    expect(st(await lv)).toEqual(["DEFAULT_ROLE_PROTECTED", 409]);
    const bad = caught(createRole(c, TA, { pack: "chuacai", name: { vi: "x" }, level: "read" }));
    expect(st(await bad)).toEqual(["PACK_NOT_ROLEABLE", 422]);
    const r = await createRole(c, TA, { pack: PK, name: { vi: "Có người" }, level: "read" });
    await addRoleMembers(c, r.id, { user_ids: [LAN as string] });
    const busy = await caught(deleteRole(c, r.id));
    expect(st(busy)).toEqual(["ROLE_HAS_MEMBERS", 409]);
    expect((busy as { details?: unknown }).details).toEqual({ member_count: 1 });
    await removeRoleMember(c, r.id, LAN as string);
    await deleteRole(c, r.id);
  });
});

describe("CR-112 · ADM-FR-77/82 · phân quyền + thành viên", () => {
  test("ADM-FR-77 · tenant_admin công ty khác ⇒ 404 cho mọi thao tác trên vai/tenant của A", async () => {
    const b = tadmin(TB as string, BA as string);
    const { items } = await listRoles(platform(), { tenant_id: TA as string, pack: PK });
    const rid = items[0]?.id as string;
    const errs = await Promise.all([
      caught(listRoles(b, { tenant_id: TA as string })),
      caught(createRole(b, TA, { pack: PK, name: { vi: "x" }, level: "read" })),
      caught(updateRole(b, rid, { version: 1, name: { vi: "x" } })),
      caught(deleteRole(b, rid)),
      caught(addRoleMembers(b, rid, { user_ids: [LAN as string] })),
      caught(removeRoleMember(b, rid, LAN as string)),
    ]);
    expect(errs.map((e) => isAppError(e, "NOT_FOUND"))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect((await listRoles(b, {})).items).toEqual([]); // B chưa bật gói: không thấy vai của A
  });

  test("ADM-BR-16 · đối tác không vào vai (422 cả lô); user nội bộ vào ⇒ member_count; gỡ idempotent", async () => {
    const a = tadmin(TA as string, AA as string);
    const { items } = await listRoles(a, { pack: PK });
    const editor = items.find((r) => r.key === "editor");
    const rid = editor?.id as string;
    const e = await caught(addRoleMembers(a, rid, { user_ids: [LAN as string, EXT as string] }));
    expect((e as { code?: string })?.code).toBe("EXTERNAL_USER_NOT_ALLOWED");
    const res = await addRoleMembers(a, rid, { user_ids: [LAN as string, U50 as string] });
    expect(res).toEqual({ added: [LAN as string], already: [], not_found: [U50 as string] });
    const after = (await listRoles(a, { pack: PK })).items.find((r) => r.id === rid);
    expect(after?.member_count).toBe(1);
    const packs = await listPacks(platform(), TA as string); // ADM-FR-78 AC3: GET packs đếm vai/người
    const pk = packs.items.find((p) => p.key === PK);
    expect([pk?.role_count, pk?.member_count]).toEqual([3, 1]);
    await removeRoleMember(a, rid, LAN as string);
    await removeRoleMember(a, rid, LAN as string);
    expect((await listRoles(a, { pack: PK })).items.find((r) => r.id === rid)?.member_count).toBe(
      0,
    );
  });
});

describe("CR-112 · ADM-FR-83 · backfill + hiệu năng biên dịch", () => {
  test("ADM-FR-83 · backfill tạo vai mặc định từ Group vai có sẵn, gọi lại = 0, không lấy Group phòng ban", async () => {
    await owner`delete from admin.app_roles where tenant_id = ${TA as string} and is_default`;
    const [x] = await owner<{ n: number }[]>`select admin.app_roles_backfill() as n`;
    const [y] = await owner<{ n: number }[]>`select admin.app_roles_backfill() as n`;
    expect([x?.n, y?.n]).toEqual([3, 0]);
    const [pb] = await owner<{ n: number }[]>`select count(*)::int as n from admin.app_roles r
      join admin.groups g on g.id = r.group_id where g.key = 'pb-ke-toan'`;
    expect(pb?.n).toBe(0);
  });

  test("Luật 4c · biên dịch 50 vai = cùng số câu SQL như 2 vai (tập hợp)", async () => {
    // 50 vai tuỳ biến dựng thẳng bằng owner (một câu), rồi đếm câu `execute` của compileRoles.
    await owner`with g as (
        insert into admin.groups (tenant_id, key, name)
        select ${TB as string}, 'pkdemo-p' || i, '{"vi":"P"}'::jsonb from generate_series(1, 50) i returning id, key)
      insert into admin.app_roles (tenant_id, pack, key, name, level, group_id)
      select ${TB as string}, 'pkdemo', substr(g.key, 8), '{"vi":"P"}'::jsonb,
        (array['read','write','admin'])[1 + (row_number() over (order by g.key))::int % 3], g.id from g`;
    const count = async (limit: number) => {
      let n = 0;
      await withScope(db, { kind: "platform" }, async (tx) => {
        const ids = (
          await owner<
            { id: string }[]
          >`select id from admin.app_roles where tenant_id = ${TB as string}
            order by key limit ${limit}`
        ).map((r) => r.id);
        const spy = new Proxy(tx, {
          get(t, p, r) {
            if (p === "execute")
              return (q: unknown) => {
                n++;
                return (t.execute as (q: unknown) => unknown)(q);
              };
            return Reflect.get(t, p, r);
          },
        }) as Tx;
        const out = await compileRoles(spy, {
          tenantId: TB as string,
          roleIds: ids,
          actorId: PA as string,
        });
        if (limit === 50) expect(out.added.length).toBeGreaterThanOrEqual(48);
      });
      return n;
    };
    const small = await count(2);
    const big = await count(50);
    expect(big).toBe(small);
    expect(big).toBeLessThanOrEqual(3);
  });
});
