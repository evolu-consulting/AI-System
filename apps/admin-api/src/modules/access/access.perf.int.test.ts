// ADM-NFR-03 · ngân sách p95 spec M3 §6 (20 lần, in-process, gọi service trực tiếp). Dữ liệu: 500 tenant × 20 user,
// 200 group/tenant, 200 feature, 100 grant/feature (tenant đo), 50 command. Dựng bằng owner SQL (generate_series).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { commandAccess } from "../commands/commands.access";
import { batchGrants } from "../grants/grants.batch";
import { grantMatrix } from "../grants/grants.matrix";
import { listGroups } from "../groups/groups.service";
import { effectiveAccess } from "./access.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 4 });
const T0 = "01900000-0000-7000-8000-000000000000";
let admin = "";
let member = "";
let cmd = "";
let groupIds: string[] = [];
let featureIds: string[] = [];

async function seed(): Promise<void> {
  await owner`insert into admin.tenants (id, key, name)
    select case when i = 0 then ${T0}::uuid else gen_random_uuid() end, 't' || i, 'T ' || i
    from generate_series(0, 499) i`;
  await owner`insert into admin.users (tenant_id, username, password_hash, display_name, role, email)
    select t.id, 'u' || i, 'x', 'U ' || i, case when i = 0 then 'tenant_admin' else 'member' end, 'u' || i || '@x.test'
    from admin.tenants t, generate_series(0, 19) i`;
  await owner`insert into admin.groups (tenant_id, key, name)
    select t.id, 'g' || i, jsonb_build_object('vi', 'G ' || i) from admin.tenants t, generate_series(1, 199) i`;
  await owner`insert into admin.features (key, name) select 'f' || i, jsonb_build_object('vi', 'F ' || i)
    from generate_series(1, 199) i`;
  await owner`insert into admin.features (key, name) values ('core', '{"vi":"Core"}')`;
  await owner`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t.id from admin.features f, admin.tenants t where f.key <> 'core' and t.key in ('t0', 't1', 't2')`;
  await owner`insert into admin.secrets (name, ciphertext, iv, last4) values ('KEY', ${Buffer.alloc(40)}, ${Buffer.alloc(12)}, 'abcd')`;
  await owner`insert into admin.workflows (key, name, description, app_type, base_url, secret_id)
    select 'wf', 'W', ${"d".repeat(20)}, 'workflow', 'https://x.test', id from admin.secrets`;
  await owner`insert into admin.commands (name, description, workflow_id, output)
    select 'cmd' || i, '{"vi":"C"}', w.id, '{"field":"x","render":"text"}' from admin.workflows w, generate_series(1, 50) i`;
  await owner`insert into admin.feature_commands (feature_id, command_id)
    select f.id, c.id from admin.commands c join admin.features f
      on f.key = 'core' or f.key = 'f' || ((substr(c.name, 4)::int * 4) % 199 + 1)`;
}

async function grantsAndMembers(): Promise<void> {
  await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id)
    select ${T0}, f.id, g.id from admin.features f
    join lateral (select id from admin.groups where tenant_id = ${T0} and key <> 'beta-testers'
      order by key limit 100) g on true where f.key <> 'core'`;
  await owner`insert into admin.group_members (tenant_id, group_id, user_id)
    select ${T0}, g.id, u.id from admin.users u join admin.groups g on g.tenant_id = u.tenant_id
    where u.tenant_id = ${T0} and g.key in ('g1', 'g2', 'g3', 'beta-testers')`;
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await seed();
  await grantsAndMembers();
  await owner`analyze`;
  admin = (await owner`select id from admin.users where tenant_id = ${T0} and username = 'u0'`)[0]
    ?.id;
  member = (await owner`select id from admin.users where tenant_id = ${T0} and username = 'u5'`)[0]
    ?.id;
  cmd = (await owner`select id from admin.commands where name = 'cmd1'`)[0]?.id;
  groupIds = (
    await owner`select id from admin.groups where tenant_id = ${T0} order by key desc limit 100`
  ).map((r) => r.id);
  featureIds = (
    await owner`select id from admin.features where key <> 'core' order by key limit 2`
  ).map((r) => r.id);
}, 120_000);
afterAll(async () => {
  await owner.end();
  await db.close();
});

const call = () => ({
  ctx: { db },
  actor: { userId: admin, tenantId: T0, role: "tenant_admin" as const },
  scope: { kind: "tenant" as const, tenantId: T0 },
});
const platform = () => ({
  ...call(),
  actor: { ...call().actor, tenantKey: "t0", sid: null, role: "platform_admin" as const },
  scope: { kind: "platform" as const },
});

async function p95(fn: () => Promise<unknown>): Promise<number> {
  await fn();
  const ts: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await fn();
    ts.push(performance.now() - t);
  }
  const p = ts.sort((a, b) => a - b)[18] ?? 0;
  return p;
}

describe("ADM-NFR-03 · ngân sách p95 spec M3 §6", () => {
  test("GET /admin/groups < 100 ms", async () => {
    expect(await p95(() => listGroups(call(), { limit: 50, offset: 0 }))).toBeLessThan(100);
  });

  test("effective-access < 150 ms", async () => {
    expect(await p95(() => effectiveAccess(call(), member, {}))).toBeLessThan(150);
  });

  test("ma trận 200 × 200 < 150 ms", async () => {
    expect(await p95(() => grantMatrix(call(), { limit: 200, offset: 0 }))).toBeLessThan(150);
  });

  test("batch 200 thao tác < 300 ms", async () => {
    const pairs = groupIds.flatMap((g) => featureIds.map((f) => ({ feature_id: f, group_id: g })));
    let flip = false;
    const run = () => {
      flip = !flip;
      return batchGrants(
        call(),
        undefined,
        flip ? { add: pairs, remove: [] } : { add: [], remove: pairs },
      );
    };
    expect(await p95(run)).toBeLessThan(300);
  });

  test("commands/:id/access (kèm group) < 150 ms", async () => {
    expect(await p95(() => commandAccess(platform(), cmd, { limit: 50, offset: 0 }))).toBeLessThan(
      150,
    );
  });
});
