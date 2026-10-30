// HUB-FR-75, WRK-FR-24 · migration schema `hub` (plan H1 §1 P1): `migrations-hub/` (mọi môi trường) + `migrations-hub-dev/`
// (mật khẩu login dev, khác production). Tách khỏi `runMigrations` để test khoá Admin (`{main: 10, dev: 3}`) không đổi.
// Gọi **sau** `runMigrations` (hàm `hub.tenant_sub_limit` đọc `admin.tenants`). CLI: `bun run db:migrate`.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { AppEnv } from "./env";
import { assertMigrationsInSync } from "./migrate-guard";

const HUB_DIR = fileURLToPath(new URL("../migrations-hub", import.meta.url));
const HUB_DEV_DIR = fileURLToPath(new URL("../migrations-hub-dev", import.meta.url));
export const HUB_TABLE = "__drizzle_migrations_hub";
export const HUB_DEV_TABLE = "__drizzle_migrations_hub_dev";
/**
 * Khoá advisory toàn cụm quanh mỗi lần migrate: migration có `CREATE/ALTER ROLE` (đối tượng của cụm, không của DB) nên hai
 * tiến trình migrate song song (kể cả trên hai DB khác nhau, vd worker `test:int:par`) lỗi XX000 `tuple concurrently updated`.
 */
export const MIGRATE_LOCK = 7_316_204_612;

/**
 * Chạy `fn` khi giữ MIGRATE_LOCK. Advisory lock chỉ có hiệu lực trong một database nên khoá giữ trên DB `postgres` (chung cả
 * cụm). Không nối được DB `postgres` (vd dịch vụ quản lý không cho) ⇒ chạy không khoá như trước.
 */
export async function withMigrateLock<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const u = new URL(url);
  u.pathname = "/postgres";
  const lock = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    await lock`select pg_advisory_lock(${MIGRATE_LOCK})`.catch(() => undefined);
    return await fn();
  } finally {
    await lock.end();
  }
}

type Sql = ReturnType<typeof postgres>;

/** Số dòng bảng theo dõi; bảng chưa có = 0. `table` chỉ nhận hai hằng ở trên nên ghép chuỗi an toàn. */
async function applied(sql: Sql, table: typeof HUB_TABLE | typeof HUB_DEV_TABLE): Promise<number> {
  const [reg] = await sql<
    { r: string | null }[]
  >`select to_regclass(${`drizzle.${table}`})::text as r`;
  if (!reg?.r) return 0;
  const [row] = await sql.unsafe<{ n: number }[]>(
    `select count(*)::int as n from drizzle.${table}`,
  );
  return row?.n ?? 0;
}

/** Trả số migration **vừa áp** lần này: `hub` (mọi môi trường), `hubDev` (chỉ khác production). */
export async function runHubMigrations(opts: {
  url: string;
  appEnv: AppEnv;
}): Promise<{ hub: number; hubDev: number }> {
  return withMigrateLock(opts.url, () => migrateHub(opts));
}

async function migrateHub(opts: {
  url: string;
  appEnv: AppEnv;
}): Promise<{ hub: number; hubDev: number }> {
  const sql = postgres(opts.url, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(sql);
    const hub0 = await applied(sql, HUB_TABLE);
    await assertMigrationsInSync(sql, HUB_DIR, HUB_TABLE);
    await migrate(db, { migrationsFolder: HUB_DIR, migrationsTable: HUB_TABLE });
    const hub = (await applied(sql, HUB_TABLE)) - hub0;
    if (opts.appEnv === "production") return { hub, hubDev: 0 };
    const dev0 = await applied(sql, HUB_DEV_TABLE);
    await assertMigrationsInSync(sql, HUB_DEV_DIR, HUB_DEV_TABLE);
    await migrate(db, { migrationsFolder: HUB_DEV_DIR, migrationsTable: HUB_DEV_TABLE });
    return { hub, hubDev: (await applied(sql, HUB_DEV_TABLE)) - dev0 };
  } finally {
    await sql.end();
  }
}
