import { afterAll, describe, expect, it } from "bun:test";
import { runMigrations } from "@ai/db";
import postgres from "postgres";
import { resetTestDb } from "../../../packages/db/src/test-db";
import { fails, ROOT, run } from "./_helpers";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev` rồi `bun run test:int`");
}
const sql = postgres(URL, { max: 1, onnotice: () => {} });
afterAll(async () => {
  await sql.end();
});

const HUB_TABLES = ["agent_grants", "agent_workflows", "usage_logs"];

async function tablesIn(schemas: string[]): Promise<string[]> {
  const rows = await sql<{ t: string }[]>`
    select table_schema || '.' || table_name as t
    from information_schema.tables
    where table_schema in ${sql(schemas)}
    order by 1`;
  return rows.map((r) => r.t);
}

describe("ADM-NFR-06 · M0-AC03 · db:migrate (development)", () => {
  it("ADM-NFR-06 · M0-AC03 · có đúng 3 bảng hub.* và không có bảng admin.*", async () => {
    await resetTestDb(URL);
    const r = await runMigrations({ url: URL, appEnv: "development" });
    expect(r).toEqual({ main: 1, dev: 1 });
    expect(await tablesIn(["admin", "hub"])).toEqual([
      "hub.agent_grants",
      "hub.agent_workflows",
      "hub.usage_logs",
    ]);
    const ns = await sql`select 1 as one from pg_namespace where nspname = 'admin'`;
    expect(ns.map((x) => x.one)).toEqual([1]);
  });

  it("ADM-NFR-06 · M0-AC03 · role admin_rw và hub_ro tồn tại, NOLOGIN", async () => {
    const rows = await sql<{ rolname: string; rolcanlogin: boolean }[]>`
      select rolname, rolcanlogin from pg_roles
      where rolname in ('admin_rw', 'hub_ro') order by 1`;
    expect(rows.map((r) => [r.rolname, r.rolcanlogin])).toEqual([
      ["admin_rw", false],
      ["hub_ro", false],
    ]);
  });

  it("ADM-NFR-06 · M0-AC03 · admin_rw chỉ SELECT được 3 bảng hub.*; USAGE schema admin/hub", async () => {
    for (const t of HUB_TABLES) {
      const [p] = await sql<{ sel: boolean; ins: boolean }[]>`
        select has_table_privilege('admin_rw', ${`hub.${t}`}, 'SELECT') as sel,
               has_table_privilege('admin_rw', ${`hub.${t}`}, 'INSERT') as ins`;
      expect(p).toEqual({ sel: true, ins: false });
    }
    const [s] = await sql<{ a: boolean; h: boolean; r: boolean }[]>`
      select has_schema_privilege('admin_rw', 'admin', 'USAGE') as a,
             has_schema_privilege('admin_rw', 'hub', 'USAGE') as h,
             has_schema_privilege('hub_ro', 'admin', 'USAGE') as r`;
    expect(s).toEqual({ a: true, h: true, r: true });
  });

  it("ADM-NFR-06 · M0-AC03 · default privileges: bảng/sequence mới trong admin cấp đúng quyền", async () => {
    await sql`create table admin.qc_probe (id serial primary key)`;
    try {
      const [p] = await sql<Record<string, boolean>[]>`
        select has_table_privilege('admin_rw', 'admin.qc_probe', 'INSERT') as rw_ins,
               has_table_privilege('admin_rw', 'admin.qc_probe', 'DELETE') as rw_del,
               has_table_privilege('hub_ro', 'admin.qc_probe', 'SELECT') as ro_sel,
               has_table_privilege('hub_ro', 'admin.qc_probe', 'INSERT') as ro_ins,
               has_sequence_privilege('admin_rw', 'admin.qc_probe_id_seq', 'USAGE') as rw_seq`;
      expect(p).toEqual({ rw_ins: true, rw_del: true, ro_sel: true, ro_ins: false, rw_seq: true });
    } finally {
      await sql`drop table admin.qc_probe`;
    }
  });

  it("ADM-NFR-06 · M0-AC03 · stub hub: index và ràng buộc theo spec §4.2", async () => {
    const idx = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'hub' order by 1`;
    const names = idx.map((i) => i.indexname);
    for (const n of [
      "agent_workflows_workflow_id_idx",
      "agent_grants_uq",
      "agent_grants_subject_idx",
      "usage_logs_tenant_at_idx",
      "usage_logs_tenant_feature_at_idx",
    ]) {
      expect(names).toContain(n);
    }
    const A = "00000000-0000-7000-8000-0000000000a1";
    const T = "00000000-0000-7000-8000-0000000000b1";
    expect(
      await fails(
        sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
            values (${A}, ${T}, 'team', ${A})`,
      ),
    ).toBe(true);
    expect(
      await fails(sql`insert into hub.usage_logs (tenant_id, billing) values (${T}, 'khac')`),
    ).toBe(true);
    expect(
      await fails(
        sql`insert into hub.usage_logs (tenant_id, billing, input_tokens) values (${T}, 'api', -1)`,
      ),
    ).toBe(true);
    const [row] = await sql<{ input_tokens: number; overage: boolean; cost_usd: string | null }[]>`
      insert into hub.usage_logs (tenant_id, billing) values (${T}, 'dify')
      returning input_tokens, overage, cost_usd`;
    expect(row).toEqual({ input_tokens: 0, overage: false, cost_usd: null });
  });

  it("ADM-NFR-06 · M0-AC03 · chạy lần 2 không đổi gì (exit/idempotent)", async () => {
    const count = async (t: string) =>
      (await sql.unsafe(`select count(*)::int as n from drizzle.${t}`))[0]?.n;
    const before = [await count("__drizzle_migrations"), await count("__drizzle_migrations_dev")];
    const r = await runMigrations({ url: URL, appEnv: "development" });
    expect(r).toEqual({ main: 0, dev: 0 });
    expect([await count("__drizzle_migrations"), await count("__drizzle_migrations_dev")]).toEqual(
      before,
    );
    expect(before).toEqual([1, 1]);
  });

  it("ADM-NFR-06 · M0-AC03 · role đã có sẵn (DB reset nhưng role ở mức cluster) vẫn migrate được", async () => {
    await resetTestDb(URL);
    await expect(runMigrations({ url: URL, appEnv: "test" })).resolves.toEqual({ main: 1, dev: 1 });
  });

  it("ADM-NFR-06 · M0-AC03 · db:migrate không kết nối được → exit 1, nêu ECONNREFUSED và gợi ý compose", () => {
    const r = run(["bun", "packages/db/src/migrate.ts"], ROOT, {
      APP_ENV: "test",
      DATABASE_URL: "postgres://ai:ai_dev_pw@127.0.0.1:1/ai_system",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("ECONNREFUSED");
    expect(r.out).toContain("docker compose up -d --wait");
  });
});

describe("ADM-NFR-06 · M0-AC04 · db:migrate (production)", () => {
  it("ADM-NFR-06 · M0-AC04 · có schema admin, hub; không có bảng hub.*; không có bảng theo dõi dev", async () => {
    await resetTestDb(URL);
    const r = await runMigrations({ url: URL, appEnv: "production" });
    expect(r).toEqual({ main: 1, dev: 0 });
    const ns = await sql<{ nspname: string }[]>`
      select nspname from pg_namespace where nspname in ('admin', 'hub') order by 1`;
    expect(ns.map((n) => n.nspname)).toEqual(["admin", "hub"]);
    expect(await tablesIn(["admin", "hub"])).toEqual([]);
    const [dev] = await sql<{ r: string | null }[]>`
      select to_regclass('drizzle.__drizzle_migrations_dev')::text as r`;
    expect(dev?.r).toBeNull();
  });
});

describe("ADM-NFR-06 · M0-AC03 · resetTestDb an toàn", () => {
  it("ADM-NFR-06 · M0-AC03 · resetTestDb từ chối DB không có hậu tố _test", async () => {
    // host/cổng không tồn tại: nếu bản cài đặt quên kiểm tên thì cũng không xoá được gì
    await expect(resetTestDb("postgres://ai:x@127.0.0.1:1/ai_system")).rejects.toThrow(/_test/);
  });

  it("ADM-NFR-06 · M0-AC03 · resetTestDb với URL vắng/rỗng → lỗi nêu TEST_DATABASE_URL", async () => {
    await expect(resetTestDb(undefined)).rejects.toThrow("TEST_DATABASE_URL chưa đặt");
    await expect(resetTestDb("")).rejects.toThrow("TEST_DATABASE_URL chưa đặt");
  });
});
