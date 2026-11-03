// CR-112 S6 · ADM-FR-83 · ADM-BR-17 · ADM-FR-80: backfill vai trên DB thật (DB mẫu "full", gói `pkdemo`, owner như CLI prod):
// dry-run không ghi gì; apply sửa tenant lệch (admin thừa trên viewer, thiếu write trên editor, thiếu hàng vai), Group phòng ban giữ
// nguyên ("quyền ngoài vai"), vai tuỳ biến nhận agent trợ lý như Group mặc định cùng mức, audit mỗi thay đổi; apply lần 2 = 0.
// Kèm: xoá Group của vai qua /admin/groups ⇒ 409 (mặc định / tuỳ biến).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@ai/db";
import { cloneMigratedTestDb, migrateFullTest } from "@ai/db/test-db";
import postgres from "postgres";
import { deleteGroup } from "../groups/groups.service";
import { enablePack } from "../packs/packs.service";
import { type BackfillReport, runRolesBackfill } from "./app-roles.backfill";
import { type Call, createRole } from "./app-roles.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const id = (n: number) => `01900000-0000-7000-8000-000000c6${String(n).padStart(4, "0")}`;
const [PT, PA, TA, TB, PROF, AG] = [1, 2, 3, 4, 5, 6].map(id) as string[];
const PK = "pkdemo";
let owner: postgres.Sql;
let api: ReturnType<typeof createDb>;
let ownerDb: ReturnType<typeof createDb>;

const platform = (): Call => ({
  ctx: { db: api },
  actor: { userId: PA as string, tenantId: PT as string, role: "platform_admin" },
  scope: { kind: "platform" },
});
const grantsOf = async (gk: string, tid = TA as string) =>
  (
    await owner<{ k: string }[]>`select f.key as k from admin.feature_grants fg
      join admin.features f on f.id = fg.feature_id join admin.groups g on g.id = fg.group_id
      where g.tenant_id = ${tid} and g.key = ${gk} order by 1`
  ).map((r) => r.k);
const snapshot = async () =>
  (
    await owner`select
      (select count(*)::int from admin.app_roles) as roles,
      (select coalesce(string_agg(group_id::text || feature_id::text, ',' order by group_id, feature_id), '')
        from admin.feature_grants) as grants,
      (select count(*)::int from admin.audit_log) as audits,
      (select config_version from admin.config_meta where id = 1) as cfg,
      (select count(*)::int from hub.agent_grants) as agents`
  )[0];
const agentGrants = async (gk: string) =>
  (
    await owner<{ n: number }[]>`select count(*)::int as n from hub.agent_grants ag
      join admin.groups g on g.id = ag.subject_id where ag.subject_type = 'group' and g.tenant_id = ${TA as string}
        and g.key = ${gk}`
  )[0]?.n;

beforeAll(async () => {
  await cloneMigratedTestDb(OWNER, { key: "full", migrate: migrateFullTest });
  owner = postgres(OWNER as string, { max: 2, onnotice: () => {} });
  api = createDb(API as string, { max: 4 });
  ownerDb = createDb(OWNER as string, { max: 2 });
  await owner`insert into admin.tenants (id, key, name) values
    (${PT as string}, 'plat', 'P'), (${TA as string}, 'acme', 'A'), (${TB as string}, 'beta', 'B')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, email, kind)
    values (${PA as string}, ${PT as string}, 'root', 'h', 'Root', 'platform_admin', 'r@x.test', 'internal')`;
  // Trợ lý gói pkdemo: Group vai mặc định nhận grant agent khi bật gói.
  await owner`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
    values ('fake-cli', 'subscription', 'fake', 2, true, true) on conflict do nothing`;
  await owner`insert into hub.model_profiles (id, key, steps) values (${PROF as string}, 'fake-s6',
    ${owner.json([{ provider_key: "fake-cli", model: null, on: [] }])})`;
  await owner`insert into hub.agents (id, key, name, description, runtime, profile_id)
    values (${AG as string}, 'pkdemo-s6', ${owner.json({ vi: "s6", en: "s6" })},
      'Trợ lý của gói kiểm thử pkdemo cho backfill.', 'agentic-cli', ${PROF as string})`;
  await owner`insert into packs.pack_agents (pack_key, agent_key) values (${PK}, 'pkdemo-s6')`;
  await enablePack(platform(), TA as string, PK);
  await enablePack(platform(), TB as string, PK);
});
afterAll(async () => {
  await api?.close();
  await ownerDb?.close();
  await owner?.end();
});

/** Dữ liệu cũ lệch chuẩn ở acme: không có hàng vai, viewer thừa admin, editor thiếu write, vai tuỳ biến cũ chưa có agent. */
async function drift(): Promise<void> {
  await owner`delete from admin.app_roles where tenant_id = ${TA as string}`;
  await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id)
    select ${TA as string}, f.id, g.id from admin.features f, admin.groups g
    where f.key = 'pkdemo-admin' and g.tenant_id = ${TA as string} and g.key = 'pkdemo-viewer'`;
  await owner`delete from admin.feature_grants fg using admin.features f, admin.groups g
    where fg.feature_id = f.id and fg.group_id = g.id and f.key = 'pkdemo-write'
      and g.tenant_id = ${TA as string} and g.key = 'pkdemo-editor'`;
  await owner`with g as (insert into admin.groups (tenant_id, key, name) values
      (${TA as string}, 'pb-ke-toan', '{"vi":"PB"}'::jsonb), (${TA as string}, 'pkdemo-ketoan', '{"vi":"KT"}'::jsonb)
      returning id, key)
    insert into admin.feature_grants (tenant_id, feature_id, group_id)
    select ${TA as string}, f.id, g.id from g, admin.features f
    where (g.key = 'pb-ke-toan' and f.key in ('pkdemo-read', 'pkdemo-admin'))`;
}

describe("CR-112 S6 · ADM-FR-83 · backfill vai dry-run/apply", () => {
  test("ADM-FR-83 · dry-run không ghi, apply sửa tenant lệch, giữ Group phòng ban, audit mỗi thay đổi, lần 2 không đổi", async () => {
    await drift();
    // Vai tuỳ biến cũ (dữ liệu trước S6): hàng vai có, grant/agent chưa có — được biên dịch + nhận agent như editor.
    await owner`insert into admin.app_roles (tenant_id, pack, key, name, level, group_id)
      select ${TA as string}, ${PK}, 'ketoan', '{"vi":"KT"}'::jsonb, 'write', id from admin.groups
      where tenant_id = ${TA as string} and key = 'pkdemo-ketoan'`;
    const before = await snapshot();
    const dry = await runRolesBackfill(ownerDb, { apply: false, tenantKey: "acme" });
    expect(await snapshot()).toEqual(before);
    expect(dry.mode).toBe("dry-run");
    const t = dry.tenants[0];
    expect(dry.tenants.map((x) => x.tenant_key)).toEqual(["acme"]);
    expect(t?.roles_created).toBe(3);
    const by = Object.fromEntries((t?.packs[0]?.roles ?? []).map((r) => [r.key, r]));
    expect([by.viewer?.remove, by.editor?.add, by.ketoan?.add]).toEqual([
      ["pkdemo-admin"],
      ["pkdemo-write"],
      ["pkdemo-read", "pkdemo-write"],
    ]);
    expect(by.ketoan?.agents_added).toBe(1);
    expect(t?.outside_roles).toEqual([
      { group_key: "pb-ke-toan", features: ["pkdemo-admin", "pkdemo-read"] },
    ]);

    await expectApplied(dry.totals, before?.cfg as number);
    await expectIdempotent();
  });
});

const auditCount = async () =>
  (await owner<{ n: number }[]>`select count(*)::int as n from admin.audit_log`)[0]?.n ?? 0;

/** Apply = đúng như dry-run báo; viewer/editor/vai tuỳ biến về chuẩn, Group phòng ban nguyên; audit mỗi thay đổi; bump. */
async function expectApplied(dryTotals: BackfillReport["totals"], cfg0: number): Promise<void> {
  const a0 = await auditCount();
  const app = await runRolesBackfill(ownerDb, { apply: true, tenantKey: "acme" });
  expect(app.totals).toEqual(dryTotals);
  expect(app.totals).toEqual({
    roles_created: 3,
    grants_added: 3,
    grants_removed: 1,
    agent_grants_added: 1,
  });
  expect(await grantsOf("pkdemo-viewer")).toEqual(["pkdemo-read"]);
  expect(await grantsOf("pkdemo-editor")).toEqual(["pkdemo-read", "pkdemo-write"]);
  expect(await grantsOf("pkdemo-ketoan")).toEqual(["pkdemo-read", "pkdemo-write"]);
  expect(await grantsOf("pb-ke-toan")).toEqual(["pkdemo-admin", "pkdemo-read"]);
  expect(await agentGrants("pkdemo-ketoan")).toBe(1);
  expect((await auditCount()) - a0).toBe(3 + 3 + 1 + 1); // 3 vai + 3 grant thêm + 1 gỡ + 1 agent
  expect((await snapshot())?.cfg).toBeGreaterThan(cfg0);
}

/** Apply lần 2 (mọi tenant) = 0 thay đổi, DB y nguyên. */
async function expectIdempotent(): Promise<void> {
  const again = await snapshot();
  const second = await runRolesBackfill(ownerDb, { apply: true });
  expect(second.totals).toEqual({
    roles_created: 0,
    grants_added: 0,
    grants_removed: 0,
    agent_grants_added: 0,
  });
  expect(second.tenants.map((x) => x.tenant_key)).toEqual(["acme", "beta", "plat"]);
  expect(await snapshot()).toEqual(again);
}

describe("CR-112 S6 · ADM-FR-80 · Group của vai do vai quản", () => {
  test("ADM-FR-80 · xoá Group vai qua /admin/groups ⇒ 409 DEFAULT_ROLE_PROTECTED / ROLE_GROUP_MANAGED, vai tuỳ biến mới nhận agent", async () => {
    const st = (e: unknown) => [(e as { code?: string })?.code, (e as { status?: number })?.status];
    const [viewer] = await owner<{ id: string }[]>`select id from admin.groups
      where tenant_id = ${TB as string} and key = 'pkdemo-viewer'`;
    const e1 = await deleteGroup(platform(), viewer?.id as string).catch((e: unknown) => e);
    expect(st(e1)).toEqual(["DEFAULT_ROLE_PROTECTED", 409]);
    const r = await createRole(platform(), TB, { pack: PK, name: { vi: "Kho" }, level: "read" });
    const [n] = await owner<{ n: number }[]>`select count(*)::int as n from hub.agent_grants
      where subject_type = 'group' and subject_id = ${r.group_id}`;
    expect(n?.n).toBe(1);
    const e2 = await deleteGroup(platform(), r.group_id).catch((e: unknown) => e);
    expect(st(e2)).toEqual(["ROLE_GROUP_MANAGED", 409]);
    const [left] = await owner<{ n: number }[]>`select count(*)::int as n from admin.groups
      where id in (${viewer?.id as string}, ${r.group_id})`;
    expect(left?.n).toBe(2);
  });
});
