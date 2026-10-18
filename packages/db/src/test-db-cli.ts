// ADM-NFR-06 · `bun run db:test:create <tag>` / `db:test:drop <tag>`: DB test riêng mỗi agent (TECH-DEBT #17,
// test-plan M3 G4, plan M3 §12). NOTIFY, bộ đếm deadlock và `config_meta` là trạng thái chung của một database nên các
// agent không được dùng chung `ai_system_test`. Role (admin_rw, hub_ro, admin_api) là của cluster → dùng chung được.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { describeError, runMigrations } from "./migrate";
import { dropTrashDbs, testDbName, testEnvFile, withDatabase } from "./test-db";

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

/** Tạo DB rỗng (không migrate, không ghi env) cho mỗi tag nếu thiếu — dùng bởi `test:int:par` trước khi chia worker. */
async function ensure(tags: string[]): Promise<void> {
  const names = tags.map(testDbName);
  await onMaintenance(async (sql) => {
    for (const name of names) {
      const [row] = await sql`select 1 as one from pg_database where datname = ${name}`;
      if (!row) await sql.unsafe(`CREATE DATABASE "${name}"`);
    }
  });
  console.log(`db:test:ensure OK: ${names.join(", ")}`);
}

/** Ô (slot) worker của `test:int:par`: 1..12 ⇒ DB `ai_system_s<ô>_test`, `ai_system_s<ô>_h1_test`, Redis DB <ô> (0 = dev,
 * 13–14 e2e, 15 mặc định). Giữ bằng advisory lock phiên trên DB `postgres` ⇒ hai lượt chạy cùng lúc không dùng chung ô;
 * lượt chết (kết nối đóng) tự nhả. */
const SLOT_MAX = 12;
const SLOT_LOCK = 7_316_204_700;

async function acquireSlots(sql: postgres.Sql, n: number): Promise<number[]> {
  const got: number[] = [];
  for (let s = 1; s <= SLOT_MAX && got.length < n; s++) {
    const [r] = await sql<{ ok: boolean }[]>`select pg_try_advisory_lock(${SLOT_LOCK + s}) as ok`;
    if (r?.ok) got.push(s);
  }
  if (got.length) return got;
  // Hết ô: chờ (bằng khoá, không poll) tới khi ô 1 được nhả.
  await sql`select pg_advisory_lock(${SLOT_LOCK + 1})`;
  return [1];
}

/** `lease <n>`: giữ tối đa n ô còn trống (chờ tới khi có ≥ 1), tạo DB của ô, in `LEASE <ô,…>`; nhả khi stdin đóng. */
async function lease(n: number): Promise<void> {
  const sql = postgres(withDatabase(baseUrl(), "postgres"), { max: 1, onnotice: () => {} });
  const got = await acquireSlots(sql, n);
  for (const name of got.flatMap((s) => [testDbName(`s${s}`), testDbName(`s${s}_h1`)])) {
    const [row] = await sql`select 1 as one from pg_database where datname = ${name}`;
    if (!row) await sql.unsafe(`CREATE DATABASE "${name}"`);
  }
  console.log(`LEASE ${got.join(",")}`);
  for await (const _ of Bun.stdin.stream()) {
    // giữ khoá tới khi tiến trình cha đóng stdin (xong hoặc chết)
  }
  await sql.end();
}
async function drop(tag: string): Promise<void> {
  const name = testDbName(tag);
  await onMaintenance(async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    // Template của `cloneMigratedTestDb` (`<stem>_<key>_tpl_test`); lỡ trúng template tag khác chỉ tốn một lần dựng lại.
    const stem = name.slice(0, -"_test".length).replaceAll("_", "\\_");
    const tpls = await sql<{ n: string }[]>`select datname as n from pg_database
      where datname like ${`${stem}\\_%\\_tpl\\_test`}`;
    for (const { n } of tpls) await sql.unsafe(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`);
  });
  const envFile = `.env.test-${tag}.local`;
  if (existsSync(envFile)) rmSync(envFile);
  console.log(`db:test:drop OK: ${name}; xoá ${envFile}`);
}

if (import.meta.main) {
  const [cmd, tag = "", ...more] = process.argv.slice(2);
  try {
    if (cmd === "create") await create(tag);
    else if (cmd === "drop") await drop(tag);
    else if (cmd === "ensure") await ensure([tag, ...more]);
    else if (cmd === "lease") await lease(Math.max(1, Number(tag) || 1));
    else if (cmd === "gc") {
      const t0 = performance.now();
      const n = await dropTrashDbs(baseUrl(), undefined, Math.max(1, Number(tag) || 1));
      console.log(
        `db:test:gc OK: xoá ${n} DB rác (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
      );
    } else
      throw new Error(
        "dùng: test-db-cli.ts create|drop <tag> | ensure <tag>… | lease <n> | gc [tối thiểu]",
      );
  } catch (err) {
    console.error(`db:test:${cmd ?? "?"} lỗi: ${describeError(err)}`);
    process.exit(1);
  }
}
