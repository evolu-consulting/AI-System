// HUB-FR-75, WRK-FR-24 · HUB-H1-AC-08 · ADM-NFR-06 · test-plan H1 §5 A48–A51 + readiness lần 4 #51 (CHECK `runs_error_cols_ck`):
// migration Hub trên DB sạch và DB có stub cho cùng schema, không đụng số migration Admin, stub Admin M4 vẫn dùng được,
// quyền role. Ca DB thuần (schema D1) — có thể xanh trước code hub-api (test-plan §8, chấp nhận).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runMigrations } from "@ai/db";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { resetTestDb, withDatabase } from "@ai/db/test-db";
import postgres from "postgres";
import {
  AGENT_RT_URL,
  insertFixture,
  type Json,
  OWNER_URL,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  T,
  USERS,
} from "./_fixtures";

// Tên DB stub suy từ DB test (HUB_TEST_DATABASE_URL): `<tên>_test` -> `<tên>_stub_test`, mỗi DB test có stub riêng (agent chạy song song);
// DB mặc định `ai_system_h1_test` giữ tên cũ `ai_system_h1stub_test`.
const OWNER_DB = decodeURIComponent(new URL(OWNER_URL).pathname.slice(1));
const STUB_DB =
  OWNER_DB === "ai_system_h1_test"
    ? "ai_system_h1stub_test"
    : OWNER_DB.endsWith("_test")
      ? `${OWNER_DB.slice(0, -5)}_stub_test`
      : `${OWNER_DB}_stub`;
/** Số migration Hub hiện có = số entry journal (đọc lúc chạy), không khoá theo số file D1. */
const journalCount = (dir: string): number =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../../../packages/db/${dir}/meta/_journal.json`, import.meta.url),
        "utf8",
      ),
    ) as { entries: unknown[] }
  ).entries.length;
const STUB_URL = withDatabase(OWNER_URL, STUB_DB);
let sql: Sql;
let stub: Sql;

/** DB "có stub": Admin (kèm stub dev `hub.agent_grants/agent_workflows/usage_logs`) + dòng cũ, rồi mới migrate Hub. */
async function prepareStubDb(): Promise<void> {
  const m = postgres(withDatabase(OWNER_URL, "postgres"), { max: 1, onnotice: () => {} });
  try {
    const [row] = await m`select 1 as one from pg_database where datname = ${STUB_DB}`;
    if (!row) await m.unsafe(`CREATE DATABASE "${STUB_DB}"`);
  } finally {
    await m.end();
  }
  await resetTestDb(STUB_URL);
  await runMigrations({ url: STUB_URL, appEnv: "test" });
  const s = postgres(STUB_URL, { max: 1, onnotice: () => {} });
  try {
    await s`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values ('a3000000-0000-4000-8000-000000000001', ${T.acme}, 'user', ${USERS.lan.id})`;
    await s`insert into hub.agent_workflows (agent_id, workflow_id)
      values ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002')`;
    await s`insert into hub.usage_logs (tenant_id, billing, input_tokens, output_tokens) values (${T.acme}, 'api', 10, 5)`;
  } finally {
    await s.end();
  }
}

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await prepareStubDb();
  stub = postgres(STUB_URL, { max: 2, onnotice: () => {} });
}, 120_000);
afterAll(async () => {
  await stub?.end();
  await sql?.end();
});

/** Mô tả schema `hub`: cột, CHECK/FK/UNIQUE, index, policy RLS (so hai DB). */
async function hubSchema(db: Sql): Promise<Json> {
  const cols = await db`select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema = 'hub' order by 1, 2`;
  const cons =
    await db`select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'hub' order by 1, 2`;
  const idx =
    await db`select tablename, indexname, indexdef from pg_indexes where schemaname = 'hub' order by 1, 2`;
  const pol = await db`select tablename, policyname, roles::text as roles, cmd, qual, with_check
    from pg_policies where schemaname = 'hub' order by 1, 2`;
  const rls =
    await db`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'hub' and c.relkind = 'r' order by 1`;
  return { cols: [...cols], cons: [...cons], idx: [...idx], pol: [...pol], rls: [...rls] };
}
const sqlState = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code,
  );
const can = async (db: Sql, role: string, table: string, priv: string): Promise<boolean> => {
  const [r] = await db<
    { ok: boolean }[]
  >`select has_table_privilege(${role}, ${table}, ${priv}) as ok`;
  return r?.ok ?? false;
};

describe("A48–A51 · migration Hub và quyền [HUB-H1-AC-08 · HUB-FR-75]", () => {
  it("A48 · DB sạch và DB có stub: schema hub giống nhau (cột, CHECK, index, policy, RLS); lần 2 = {hub:0, hubDev:0} [HUB-H1-AC-08]", async () => {
    expect(await runHubMigrations({ url: STUB_URL, appEnv: "test" })).toEqual({
      hub: journalCount("migrations-hub"),
      hubDev: journalCount("migrations-hub-dev"),
    });
    expect(await hubSchema(stub)).toEqual(await hubSchema(sql));
    for (const url of [OWNER_URL, STUB_URL])
      expect(await runHubMigrations({ url, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
    const [old] = await stub<{ n: number }[]>`select count(*)::int as n from hub.usage_logs`;
    expect(old?.n).toBe(1);
  });

  it("A49 · runMigrations Admin không đổi: đã áp {main: 11, dev: 3}, gọi lại = {0, 0} sau khi có Hub [P1 · ADM-NFR-06]", async () => {
    expect(await runMigrations({ url: OWNER_URL, appEnv: "test" })).toEqual({ main: 0, dev: 0 });
    const [r] = await sql<{ main: number; dev: number }[]>`select
      (select count(*)::int from drizzle.__drizzle_migrations) as main,
      (select count(*)::int from drizzle.__drizzle_migrations_dev) as dev`;
    expect(r).toEqual({ main: 11, dev: 3 });
  });

  it("A50 · INSERT kiểu Admin M4 vẫn chạy (cột mới nullable); INSERT usage của Runtime (role agent_runtime, ON CONFLICT job_id) idempotent; admin_rw đọc được [M4 · WRK-FR-24]", async () => {
    const [m4] =
      await sql`insert into hub.usage_logs (tenant_id, run_id, user_id, feature_id, billing, input_tokens,
        output_tokens, cost_usd, billable_usd, overage, at)
      values (${T.acme}, 'a3000000-0000-4000-8000-000000000101', ${USERS.lan.id}, null, 'api', 100, 50,
              '0.06', '0.10', false, now())
      returning job_id, cache_read_tokens, cache_write_tokens`;
    expect({ ...m4 }).toEqual({ job_id: null, cache_read_tokens: null, cache_write_tokens: null });
    const [uq] =
      await sql`select indexdef from pg_indexes where schemaname = 'hub' and indexname = 'usage_logs_job_uq'`;
    expect(String(uq?.indexdef)).toContain("UNIQUE");

    const rt = postgres(AGENT_RT_URL, { max: 1, onnotice: () => {} });
    const job = "a3000000-0000-4000-8000-000000000201";
    try {
      for (let i = 0; i < 2; i++) {
        await rt`insert into hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key,
            model, billing, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billable_usd,
            overage, latency_ms, job_id)
          values (${T.acme}, ${R.runDone}, 'a3000000-0000-4000-8000-000000000202', ${USERS.lan.id}, null,
                  'a3000000-0000-4000-8000-000000000203', 'fake-cli', null, 'subscription', 1200, 300, 800, null,
                  0, null, false, 1500, ${job})
          on conflict (job_id) where job_id is not null do nothing`;
      }
    } finally {
      await rt.end();
    }
    const [n] = await sql<
      { n: number }[]
    >`select count(*)::int as n from hub.usage_logs where job_id = ${job}`;
    expect(n?.n).toBe(1);
    expect(await can(sql, "admin_rw", "hub.usage_logs", "SELECT")).toBe(true);
  });

  it("A51 · quyền: admin_rw chỉ SELECT 3 bảng stub; hub_api không UPDATE usage_logs; agent_runtime đúng plan §3.4 [plan §3.4]", async () => {
    const want: [string, string, string, boolean][] = [
      ["admin_rw", "hub.agent_grants", "SELECT", true],
      ["admin_rw", "hub.agent_workflows", "SELECT", true],
      ["admin_rw", "hub.usage_logs", "SELECT", true],
      ["admin_rw", "hub.usage_logs", "INSERT", false],
      ["admin_rw", "hub.agent_grants", "UPDATE", false],
      ["admin_rw", "hub.runs", "SELECT", false],
      ["admin_rw", "hub.jobs", "SELECT", false],
      ["admin_rw", "hub.agents", "SELECT", false],
      ["hub_api", "hub.usage_logs", "SELECT", true],
      ["hub_api", "hub.usage_logs", "UPDATE", false],
      ["hub_api", "hub.usage_logs", "INSERT", false],
      ["hub_api", "hub.jobs", "INSERT", true],
      ["hub_api", "hub.jobs", "DELETE", false],
      ["agent_runtime", "hub.jobs", "SELECT", true],
      ["agent_runtime", "hub.jobs", "UPDATE", true],
      ["agent_runtime", "hub.jobs", "INSERT", false],
      ["agent_runtime", "hub.usage_logs", "INSERT", true],
      ["agent_runtime", "hub.usage_logs", "UPDATE", false],
      ["agent_runtime", "hub.cli_sessions", "DELETE", true],
      ["agent_runtime", "hub.provider_state", "UPDATE", true],
      ["agent_runtime", "hub.agent_types", "INSERT", true],
      ["agent_runtime", "hub.providers", "SELECT", true],
      ["agent_runtime", "hub.providers", "UPDATE", false],
      ["agent_runtime", "hub.runs", "SELECT", false],
      ["agent_runtime", "hub.runs", "UPDATE", false],
      ["agent_runtime", "hub.messages", "SELECT", false],
    ];
    const got: [string, string, string, boolean][] = [];
    for (const [role, t, p] of want) got.push([role, t, p, await can(sql, role, t, p)]);
    expect(got).toEqual(want);
  });

  it("#51 · UPDATE runs đặt error_code thiếu error_message/hint → 23514 (runs_error_cols_ck); đủ ba cột → được [plan-errors §Ghi · HUB-BR-04]", async () => {
    {
      expect(
        await sqlState(sql`update hub.runs set status = 'failed', finished_at = now(), error_code = 'INTERNAL_ERROR'
          where id = ${R.runLive}`),
      ).toBe("23514");
      expect(
        await sqlState(sql`update hub.runs set status = 'failed', finished_at = now(), error_code = 'INTERNAL_ERROR',
          error_message = 'Có lỗi khi xử lý yêu cầu.' where id = ${R.runLive}`),
      ).toBe("23514");
      class Rollback extends Error {}
      const ok = await sqlState(
        sql.begin(async (tx) => {
          await tx`update hub.runs set status = 'failed', finished_at = now(), error_code = 'INTERNAL_ERROR',
            error_message = 'Có lỗi khi xử lý yêu cầu.', error_hint = '' where id = ${R.runLive}`;
          throw new Rollback("rollback");
        }),
      );
      expect(ok).toBeUndefined();
      const [r] = await sql`select status, error_code from hub.runs where id = ${R.runLive}`;
      expect({ ...r }).toEqual({ status: "running", error_code: null });
    }
  });
});
