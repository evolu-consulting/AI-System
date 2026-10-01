// ADM-NFR-06 · schema quản lý bằng migration có version (spec M0 §4). CLI: `bun run db:migrate`.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { type AppEnv, loadDbEnv } from "./env";

const MAIN_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
const DEV_DIR = fileURLToPath(new URL("../migrations-dev", import.meta.url));
const MAIN_TABLE = "__drizzle_migrations";
const DEV_TABLE = "__drizzle_migrations_dev";

type Sql = ReturnType<typeof postgres>;

/** Số dòng bảng theo dõi của Drizzle; bảng chưa có = 0 (migrate() trả void, qc#3). */
async function applied(sql: Sql, table: typeof MAIN_TABLE | typeof DEV_TABLE): Promise<number> {
  const [reg] = await sql<
    { r: string | null }[]
  >`select to_regclass(${`drizzle.${table}`})::text as r`;
  if (!reg?.r) return 0;
  // `table` chỉ nhận hai hằng ở trên nên ghép chuỗi an toàn.
  const [row] = await sql.unsafe<{ n: number }[]>(
    `select count(*)::int as n from drizzle.${table}`,
  );
  return row?.n ?? 0;
}

/** Trả số migration **vừa áp** trong lần gọi này: `main` (mọi môi trường), `dev` (chỉ khác production). */
export async function runMigrations(opts: {
  url: string;
  appEnv: AppEnv;
}): Promise<{ main: number; dev: number }> {
  const sql = postgres(opts.url, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(sql);
    const main0 = await applied(sql, MAIN_TABLE);
    await migrate(db, { migrationsFolder: MAIN_DIR, migrationsTable: MAIN_TABLE });
    const main = (await applied(sql, MAIN_TABLE)) - main0;
    if (opts.appEnv === "production") return { main, dev: 0 };
    const dev0 = await applied(sql, DEV_TABLE);
    await migrate(db, { migrationsFolder: DEV_DIR, migrationsTable: DEV_TABLE });
    return { main, dev: (await applied(sql, DEV_TABLE)) - dev0 };
  } finally {
    await sql.end();
  }
}

export function describeError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  const hint =
    code === "ECONNREFUSED" ? " — Postgres chưa chạy? Thử: docker compose up -d --wait" : "";
  return `${typeof code === "string" ? `${code}: ` : ""}${msg}${hint}`;
}

if (import.meta.main) {
  try {
    const env = loadDbEnv(process.env);
    const r = await runMigrations({ url: env.DATABASE_URL, appEnv: env.APP_ENV });
    console.log(`db:migrate OK (${env.APP_ENV}): main +${r.main}, dev +${r.dev}`);
  } catch (err) {
    console.error(`db:migrate lỗi: ${describeError(err)}`);
    process.exit(1);
  }
}
