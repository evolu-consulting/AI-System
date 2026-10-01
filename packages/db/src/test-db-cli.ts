// ADM-NFR-06 · `bun run db:test:create <tag>` / `db:test:drop <tag>`: DB test riêng mỗi agent (TECH-DEBT #17,
// test-plan M3 G4, plan M3 §12). NOTIFY, bộ đếm deadlock và `config_meta` là trạng thái chung của một database nên các
// agent không được dùng chung `ai_system_test`. Role (admin_rw, hub_ro, admin_api) là của cluster → dùng chung được.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { describeError, runMigrations } from "./migrate";
import { testDbName, testEnvFile, withDatabase } from "./test-db";

const ENV_FILE = ".env.local";

function baseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
  return url;
}

/** Chạy một lệnh trên DB `postgres` (CREATE/DROP DATABASE không chạy được trong DB đích). */
async function onMaintenance(run: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const sql = postgres(withDatabase(baseUrl(), "postgres"), { max: 1, onnotice: () => {} });
  try {
    await run(sql);
  } finally {
    await sql.end();
  }
}

async function create(tag: string): Promise<void> {
  const name = testDbName(tag);
  await onMaintenance(async (sql) => {
    const [row] = await sql`select 1 as one from pg_database where datname = ${name}`;
    if (!row) await sql.unsafe(`CREATE DATABASE "${name}"`);
  });
  const r = await runMigrations({ url: withDatabase(baseUrl(), name), appEnv: "test" });
  const out = `.env.test-${tag}.local`;
  writeFileSync(out, testEnvFile(readFileSync(ENV_FILE, "utf8"), name));
  console.log(`db:test:create OK: ${name} (main +${r.main}, dev +${r.dev}); env: ${out}`);
}

async function drop(tag: string): Promise<void> {
  const name = testDbName(tag);
  await onMaintenance(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
  const envFile = `.env.test-${tag}.local`;
  if (existsSync(envFile)) rmSync(envFile);
  console.log(`db:test:drop OK: ${name}; xoá ${envFile}`);
}

if (import.meta.main) {
  const [cmd, tag = ""] = process.argv.slice(2);
  try {
    if (cmd === "create") await create(tag);
    else if (cmd === "drop") await drop(tag);
    else throw new Error("dùng: test-db-cli.ts create|drop <tag>");
  } catch (err) {
    console.error(`db:test:${cmd ?? "?"} lỗi: ${describeError(err)}`);
    process.exit(1);
  }
}
