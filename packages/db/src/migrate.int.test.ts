import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { resetTestDb } from "./test-db";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const sql = postgres(URL, { max: 1, onnotice: () => {} });
afterAll(() => sql.end());

const hubTables = async () =>
  (
    await sql<{ t: string }[]>`
      select table_name as t from information_schema.tables where table_schema = 'hub' order by 1`
  ).map((r) => r.t);

describe("ADM-NFR-06 · runMigrations (int)", () => {
  beforeEach(() => resetTestDb(URL));

  test("test: áp main + dev, 3 bảng hub, admin_rw SELECT được usage_logs; lần 2 {0,0}", async () => {
    expect(await runMigrations({ url: URL, appEnv: "test" })).toEqual({ main: 1, dev: 1 });
    expect(await hubTables()).toEqual(["agent_grants", "agent_workflows", "usage_logs"]);
    const [p] = await sql<{ ok: boolean }[]>`
      select has_table_privilege('admin_rw', 'hub.usage_logs', 'SELECT') as ok`;
    expect(p?.ok).toBe(true);
    expect(await runMigrations({ url: URL, appEnv: "development" })).toEqual({ main: 0, dev: 0 });
  });

  test("production: chỉ main, không bảng hub, không bảng theo dõi dev", async () => {
    expect(await runMigrations({ url: URL, appEnv: "production" })).toEqual({ main: 1, dev: 0 });
    expect(await hubTables()).toEqual([]);
    const [r] = await sql<{ r: string | null }[]>`
      select to_regclass('drizzle.__drizzle_migrations_dev')::text as r`;
    expect(r?.r).toBeNull();
  });

  test("production rồi test trên cùng DB: dev áp sau, main không áp lại", async () => {
    await runMigrations({ url: URL, appEnv: "production" });
    expect(await runMigrations({ url: URL, appEnv: "test" })).toEqual({ main: 0, dev: 1 });
  });
});
