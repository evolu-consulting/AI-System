// ADM-NFR-03 · ngân sách hiệu năng M2 (spec M2 §6, p95 50 lần, in-process, máy dev): 1.000 workflow, 5.000 command × 2
// feature, 5.000 hàng hub.agent_workflows, 200 feature, 500 tenant × 20 user, 100 entitlement/feature.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createDb, runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { parseMasterKey } from "../../lib/secret-crypto";
import { listFeatures } from "../features/features.service";
import { createSecret, replaceSecret } from "../secrets/secrets.service";
import { listWorkflows } from "../workflows/workflows.service";
import { commandAccess } from "./commands.access";
import { type Call, createCommand, listCommands, updateCommand } from "./commands.service";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const TID = "01900000-0000-7000-8000-00000000c901";
const UID = "01900000-0000-7000-8000-00000000c902";
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 4 });
const call: Call = {
  ctx: { db },
  actor: { userId: UID, tenantId: TID, tenantKey: "platform", role: "platform_admin", sid: null },
  scope: { kind: "platform" },
};
const secretCall = {
  ...call,
  ctx: { db, secretKey: parseMasterKey(randomBytes(32).toString("base64")) },
};
/** ≥ 50 lần đo + 5 lần khởi động nóng: p95 ổn định khi máy đang chạy song song test khác (review M2 #2). */
const RUNS = 50;
const WARMUP = 5;
const page = { limit: 50, offset: 0 };
let wfId = "";
let cmdId = "";

async function seed(): Promise<void> {
  await owner`insert into admin.tenants (id, key, name) values (${TID}, 'platform', 'P')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${UID}, ${TID}, 'admin', 'h', 'A', 'platform_admin')`;
  await owner.unsafe(`
    insert into admin.secrets (id, name, ciphertext, iv, last4)
      values (gen_random_uuid(), 'PERF_KEY', '\\x${"00".repeat(32)}', '\\x${"00".repeat(12)}', 'abcd');
    insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, input_schema)
      select gen_random_uuid(), 'wf-' || i, 'Workflow ' || i, 'Mô tả workflow số ' || i || ' cho đo hiệu năng',
        'workflow', 'https://dify.test/v1', (select id from admin.secrets limit 1),
        '[{"name":"text","type":"text","required":true,"description":"Văn bản"}]'::jsonb
      from generate_series(1, 1000) i;
    insert into admin.features (id, key, name, status) values (gen_random_uuid(), 'core', '{"vi":"Cơ bản"}', 'on');
    insert into admin.features (id, key, name, status)
      select gen_random_uuid(), 'f-' || i, jsonb_build_object('vi', 'Feature ' || i), 'on'
      from generate_series(1, 199) i;
    insert into admin.tenants (id, key, name) select gen_random_uuid(), 't-' || i, 'Tenant ' || i
      from generate_series(1, 500) i;
    insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
      select gen_random_uuid(), t.id, 'u' || j, 'h', 'U', 'member'
      from admin.tenants t cross join generate_series(1, 20) j where t.key like 't-%';
    insert into admin.feature_entitlements (feature_id, tenant_id)
      select f.id, t.id from admin.features f
      join admin.tenants t on t.key like 't-%'
        and ((substr(t.key, 3)::int + substr(f.key, 3)::int) % 5) = 0
      where f.key like 'f-%';
    insert into admin.commands (id, name, description, workflow_id, input_map, output)
      select gen_random_uuid(), 'c-' || i, jsonb_build_object('vi', 'Command ' || i),
        (select id from admin.workflows where key = 'wf-' || ((i % 1000) + 1)),
        '{"text":{"source":"selection"}}'::jsonb, '{"field":"text","render":"text"}'::jsonb
      from generate_series(1, 5000) i;
    insert into admin.command_names (name, command_id) select name, id from admin.commands;
    insert into admin.feature_commands (feature_id, command_id)
      select f.id, c.id from admin.commands c
      join admin.features f on f.key in ('f-' || ((substr(c.name, 3)::int % 199) + 1),
        'f-' || (((substr(c.name, 3)::int + 1) % 199) + 1));
    insert into hub.agent_workflows (agent_id, workflow_id)
      select gen_random_uuid(), w.id from admin.workflows w cross join generate_series(1, 5) k;
    analyze;`);
  const [w] = await owner`select id from admin.workflows where key = 'wf-1'`;
  const [c] = await owner`select id from admin.commands where name = 'c-1'`;
  wfId = w?.id as string;
  cmdId = c?.id as string;
}

async function p95(fn: (i: number) => Promise<unknown>): Promise<number> {
  for (let w = 0; w < WARMUP; w++) await fn(-1 - w);
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn(i);
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  return ms[Math.ceil(RUNS * 0.95) - 1] ?? 0;
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await seed();
}, 120_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("ADM-NFR-03 · ngân sách p95 (spec M2 §6)", () => {
  test("ADM-NFR-03 · GET /admin/commands (mọi bộ lọc) < 150 ms", async () => {
    const [f] = await owner`select id from admin.features where key = 'f-3'`;
    expect(await p95(() => listCommands(call, page))).toBeLessThan(150);
    expect(await p95(() => listCommands(call, { ...page, q: "c-12", status: "on" }))).toBeLessThan(
      150,
    );
    expect(await p95(() => listCommands(call, { ...page, feature: f?.id as string }))).toBeLessThan(
      150,
    );
    expect(await p95(() => listCommands(call, { ...page, workflow: wfId }))).toBeLessThan(150);
  });

  test("ADM-NFR-03 · GET /admin/workflows (kèm đếm, attached=false) < 150 ms; GET /admin/features < 100 ms", async () => {
    expect(await p95(() => listWorkflows(call, page))).toBeLessThan(150);
    expect(await p95(() => listWorkflows(call, { ...page, attached: false }))).toBeLessThan(150);
    expect(await p95(() => listFeatures(call, page))).toBeLessThan(100);
  });

  test("ADM-NFR-03 · GET /admin/commands/:id/access < 150 ms", async () => {
    expect(await p95(() => commandAccess(call, cmdId, page))).toBeLessThan(150);
  });

  test("ADM-NFR-03 · POST/PATCH /admin/commands < 100 ms; POST/PUT /admin/secrets < 50 ms", async () => {
    const [f] = await owner`select id from admin.features where key = 'f-9'`;
    const create = (i: number) =>
      createCommand(call, {
        name: `perf-${i + 10}`,
        aliases: [],
        description: { vi: "Đo" },
        workflow_id: wfId,
        args: [],
        input_map: { text: { source: "selection" } },
        output: { field: "text", render: "text" },
        mode: "sync",
        enabled: true,
        feature_ids: [f?.id as string],
      });
    expect(await p95(create)).toBeLessThan(100);
    let v = 1;
    expect(
      await p95(async (i) => {
        await updateCommand(call, cmdId, { version: v, description: { vi: `Mô tả ${i}` } });
        v += 1;
      }),
    ).toBeLessThan(100);
    expect(
      await p95((i) =>
        createSecret(secretCall, { name: `PERF_S_${i + 10}`, value: "x".repeat(2048) }),
      ),
    ).toBeLessThan(50);
    expect(await p95(() => replaceSecret(secretCall, "PERF_KEY", "y".repeat(2048)))).toBeLessThan(
      50,
    );
  });
});
