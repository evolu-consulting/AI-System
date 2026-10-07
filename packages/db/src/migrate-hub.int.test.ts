// HUB-FR-75, WRK-FR-24 · runHubMigrations trên DB riêng `ai_system_h1_test` (plan H1 §1 P1, §7; không đụng TEST_DATABASE_URL).
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { resetTestDb, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const URL = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const sql = postgres(URL, { max: 1, onnotice: () => {} });
/** Số migration Hub = số entry journal (thêm migration không phải sửa test). */
const HUB_N = (
  JSON.parse(
    readFileSync(
      new globalThis.URL("../migrations-hub/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  ) as { entries: unknown[] }
).entries.length;

beforeAll(async () => {
  const name = "ai_system_h1_test";
  if (process.env.HUB_TEST_DATABASE_URL) return;
  const m = postgres(withDatabase(BASE, "postgres"), { max: 1, onnotice: () => {} });
  try {
    const [row] = await m`select 1 as one from pg_database where datname = ${name}`;
    if (!row) await m.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await m.end();
  }
});
afterAll(() => sql.end());
beforeEach(() => resetTestDb(URL));

const HUB_TABLES = [
  "agent_entitlements",
  "agent_grants",
  "agent_types",
  "agent_workflows",
  "agents",
  "attachments",
  "audit_log",
  "cli_sessions",
  "config_meta",
  "conversations",
  "flows",
  "jobs",
  "messages",
  "model_profiles",
  "orchestrator_settings",
  "provider_state",
  "providers",
  "room_members",
  "room_messages",
  "rooms",
  "run_steps",
  "runs",
  "tool_confirmations",
  "usage_logs",
  "workflow_flags",
];

const hubTables = async () =>
  (
    await sql<{ t: string }[]>`
      select table_name as t from information_schema.tables where table_schema = 'hub' order by 1`
  ).map((r) => r.t);

const can = async (role: string, table: string, priv: string) =>
  (await sql<{ ok: boolean }[]>`select has_table_privilege(${role}, ${table}, ${priv}) as ok`)[0]
    ?.ok;

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code,
  );

/** DB stub M4 (test) có sẵn 1 grant + 1 usage_logs cũ, rồi migrate Hub. Trả tenant của dòng cũ. */
async function migrateOverStub(): Promise<string> {
  expect(await runMigrations({ url: URL, appEnv: "test" })).toEqual({ main: 10, dev: 3 });
  const tid = crypto.randomUUID();
  await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${crypto.randomUUID()}, ${tid}, 'user', ${crypto.randomUUID()})`;
  await sql`insert into hub.usage_logs (tenant_id, billing) values (${tid}, 'api')`;
  expect(await runHubMigrations({ url: URL, appEnv: "test" })).toEqual({ hub: HUB_N, hubDev: 1 });
  return tid;
}

const migrateAll = async (appEnv: "test" | "production") => {
  await runMigrations({ url: URL, appEnv });
  await runHubMigrations({ url: URL, appEnv });
};

describe("HUB-FR-75 · runHubMigrations (int, ai_system_h1_test)", () => {
  test("DB sạch (production): main → hub đủ 25 bảng (H3b + audit_log + 3 bảng phòng X2a), không hub-dev; lần 2 {0,0}", async () => {
    expect(await runMigrations({ url: URL, appEnv: "production" })).toEqual({ main: 10, dev: 0 });
    expect(await runHubMigrations({ url: URL, appEnv: "production" })).toEqual({
      hub: HUB_N,
      hubDev: 0,
    });
    expect(await hubTables()).toEqual(HUB_TABLES);
    expect(await runHubMigrations({ url: URL, appEnv: "production" })).toEqual({
      hub: 0,
      hubDev: 0,
    });
    // Stub dev áp sau hub (đổi production → test trên cùng DB) không lỗi, runMigrations không đổi số.
    expect(await runMigrations({ url: URL, appEnv: "test" })).toEqual({ main: 0, dev: 3 });
    expect(await runHubMigrations({ url: URL, appEnv: "test" })).toEqual({ hub: 0, hubDev: 1 });
  });

  test("DB có stub: dòng cũ giữ (FK NOT VALID), dòng mới phải có agent; lần 2 {0,0}", async () => {
    await migrateOverStub();
    expect(await runHubMigrations({ url: URL, appEnv: "development" })).toEqual({
      hub: 0,
      hubDev: 0,
    });
    expect(await hubTables()).toEqual(HUB_TABLES);
    const fks = await sql<{ conname: string; convalidated: boolean }[]>`
      select conname, convalidated from pg_constraint
      where conname in ('agent_grants_agent_id_fkey', 'agent_workflows_agent_id_fkey') order by 1`;
    expect([...fks]).toEqual([
      { conname: "agent_grants_agent_id_fkey", convalidated: false },
      { conname: "agent_workflows_agent_id_fkey", convalidated: false },
    ]);
    expect(
      await code(sql`insert into hub.agent_workflows (agent_id, workflow_id)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()})`),
    ).toBe("23503");
  });
});

describe("HUB-FR-83 · usage_logs trên DB có stub (int)", () => {
  test("HUB-FR-83 · cột mới nullable (dòng cũ giữ), token ≥ 0, billing ∈ {api, subscription, dify}; admin_rw đọc được", async () => {
    const tid = await migrateOverStub();
    const [u] = await sql`select job_id, cache_read_tokens, cache_write_tokens from hub.usage_logs`;
    expect(u).toEqual({ job_id: null, cache_read_tokens: null, cache_write_tokens: null });
    const ins = (cols: Record<string, string | number>) =>
      code(sql`insert into hub.usage_logs ${sql({ tenant_id: tid, billing: "api", ...cols })}`);
    expect(await ins({ cache_read_tokens: -1 })).toBe("23514");
    expect(await ins({ input_tokens: -1 })).toBe("23514");
    expect(await ins({ billing: "free" })).toBe("23514");
    expect(await ins({ billing: "subscription", cost_usd: 0 })).toBe("ok");
    for (const t of ["hub.agent_workflows", "hub.agent_grants", "hub.usage_logs"])
      expect(await can("admin_rw", t, "SELECT")).toBe(true);
    expect(await can("admin_rw", "hub.runs", "SELECT")).toBe(false);
  });

  test("HUB-FR-33 · mỗi job tối đa một dòng usage (unique job_id; ON CONFLICT bỏ qua), dòng không job không giới hạn", async () => {
    const tid = await migrateOverStub();
    const job = crypto.randomUUID();
    const ins = (jobId: string | null) =>
      code(sql`insert into hub.usage_logs (tenant_id, billing, job_id)
        values (${tid}, 'subscription', ${jobId})`);
    expect(await ins(job)).toBe("ok");
    expect(await ins(job)).toBe("23505");
    await sql`insert into hub.usage_logs (tenant_id, billing, job_id)
      values (${tid}, 'subscription', ${job}) on conflict (job_id) where job_id is not null do nothing`;
    expect(await ins(null)).toBe("ok");
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from hub.usage_logs where job_id = ${job}`;
    expect(n?.n).toBe(1);
  });
});

describe("HUB-FR-75 · role + GRANT (int)", () => {
  test("agent_runtime chỉ bảng runtime; hub_api = hub_rw + hub_ro, không BYPASSRLS", async () => {
    await migrateAll("test");
    const roles = await sql<{ rolname: string; rolcanlogin: boolean; rolbypassrls: boolean }[]>`
      select rolname, rolcanlogin, rolbypassrls from pg_roles
      where rolname in ('hub_rw', 'hub_api', 'agent_runtime') order by 1`;
    expect([...roles]).toEqual([
      { rolname: "agent_runtime", rolcanlogin: true, rolbypassrls: false },
      { rolname: "hub_api", rolcanlogin: true, rolbypassrls: false },
      { rolname: "hub_rw", rolcanlogin: false, rolbypassrls: false },
    ]);
    const [m] = await sql<{ rw: boolean; ro: boolean }[]>`
      select pg_has_role('hub_api', 'hub_rw', 'member') as rw, pg_has_role('hub_api', 'hub_ro', 'member') as ro`;
    expect(m).toEqual({ rw: true, ro: true });
    expect(await can("agent_runtime", "hub.conversations", "SELECT")).toBe(false);
    expect(await can("agent_runtime", "hub.runs", "SELECT")).toBe(false);
    expect(await can("agent_runtime", "admin.tenants", "SELECT")).toBe(false);
    expect(await can("agent_runtime", "hub.jobs", "UPDATE")).toBe(true);
    expect(await can("agent_runtime", "hub.jobs", "INSERT")).toBe(false);
    expect(await can("agent_runtime", "hub.cli_sessions", "DELETE")).toBe(true);
    expect(await can("hub_rw", "hub.runs", "DELETE")).toBe(true);
    expect(await can("hub_rw", "hub.jobs", "DELETE")).toBe(false);
    // H2a (0002): dify-agent đọc/ghi session (R14); 0005 (REVIEW 1): thêm DELETE để xoá phiên Dify hết hạn (404).
    expect(await can("hub_rw", "hub.cli_sessions", "SELECT")).toBe(true);
    expect(await can("hub_rw", "hub.cli_sessions", "DELETE")).toBe(true);
  });
});

describe("HUB-FR-86 · hub.tenant_sub_limit — slot subscription theo tenant (int)", () => {
  test("HUB-FR-86 · chỉ agent_runtime EXECUTE; trả max_concurrent_sub của tenant (null = không giới hạn)", async () => {
    await migrateAll("test");
    const [ex] = await sql<{ rt: boolean; pub: boolean }[]>`
      select has_function_privilege('agent_runtime', 'hub.tenant_sub_limit(uuid)', 'EXECUTE') as rt,
             has_function_privilege('hub_api', 'hub.tenant_sub_limit(uuid)', 'EXECUTE') as pub`;
    expect(ex).toEqual({ rt: true, pub: false });
    const ts = await sql<{ id: string }[]>`
      insert into admin.tenants (key, name, max_concurrent_sub)
      values ('h1-mig', 'H1', 3), ('h1-mig-free', 'H1 free', null) returning id`;
    const limit = (id: string) =>
      sql.begin(async (tx) => {
        await tx`set local role agent_runtime`;
        const [r] = await tx<{ n: number | null }[]>`select hub.tenant_sub_limit(${id}::uuid) as n`;
        return r?.n;
      });
    expect(await limit(ts[0]?.id ?? "")).toBe(3);
    expect(await limit(ts[1]?.id ?? "")).toBeNull();
  });
});

describe("HUB-FR-75 · runs CHECK (int)", () => {
  test("runs: CHECK runs_error_cols_ck, error_code ⇔ failed/cancelled, locale; unique run running mỗi flow", async () => {
    await runMigrations({ url: URL, appEnv: "production" });
    await runHubMigrations({ url: URL, appEnv: "production" });
    const tid = crypto.randomUUID();
    const uid = crypto.randomUUID();
    const [c] = await sql<
      { id: string }[]
    >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
      values (${tid}, ${uid}, 'a', 'a') returning id`;
    const [f] = await sql<
      { id: string }[]
    >`insert into hub.flows (tenant_id, user_id, conversation_id, title)
      values (${tid}, ${uid}, ${c?.id ?? ""}, 'a') returning id`;
    const run = (extra: Record<string, unknown>) =>
      sql`insert into hub.runs ${sql({
        tenant_id: tid,
        user_id: uid,
        conversation_id: c?.id,
        flow_id: f?.id,
        status: "running",
        config_version: "1",
        user_message_id: crypto.randomUUID(),
        answer_message_id: crypto.randomUUID(),
        ...extra,
      } as Record<string, string>)}`;
    const done = { status: "failed", finished_at: new Date().toISOString() };
    expect(await code(run({ ...done, error_code: "TIMEOUT", error_message: "m" }))).toBe("23514");
    expect(
      await code(run({ ...done, error_code: "NOPE", error_message: "m", error_hint: "h" })),
    ).toBe("23514");
    expect(await code(run(done))).toBe("23514");
    expect(await code(run({ locale: "fr" }))).toBe("23514");
    expect(await code(run({ status: "finished" }))).toBe("23514");
    expect(
      await code(run({ ...done, error_code: "TIMEOUT", error_message: "m", error_hint: "" })),
    ).toBe("ok");
    expect(await code(run({}))).toBe("ok");
    expect(await code(run({}))).toBe("23505");
    const [r] = await sql<
      { locale: string }[]
    >`select locale from hub.runs where status = 'running'`;
    expect(r?.locale).toBe("vi");
  });
});
