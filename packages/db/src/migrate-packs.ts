// PK-FR-04 · PK-FR-01 · PK-AC04 · N1 plan §3 "Runner": migration bộ khung gói (`migrations-packs/`, bảng theo dõi
// `drizzle.__drizzle_migrations_packs`) rồi từng gói (`migrations-pack-<k>/`, bảng `__drizzle_migrations_pack_<k>`), đánh số
// riêng từ 0001. Gọi SAU `runHubMigrations` (cần `hub_api`, `admin.features`); trong `withMigrateLock` vì `packs.install` có
// CREATE/ALTER ROLE (đối tượng cụm). Gói kiểm thử (`devOnly`) không chạy ở production. Lần 2 ⇒ 0 migration mới.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { AppEnv } from "./env";
import { withMigrateLock } from "./migrate-hub";

const dir = (name: string): string => fileURLToPath(new URL(`../${name}`, import.meta.url));

export const PACKS_KIT_TABLE = "__drizzle_migrations_packs";
/** Gói đã đăng ký, chạy theo đúng thứ tự mảng. Khoá theo `PACK_KEY_RE` (@ai/contracts) — hằng, nên ghép tên bảng an toàn. */
export const PACK_DIRS = [
  { key: "pkdemo", dir: dir("migrations-pack-pkdemo"), devOnly: true },
  { key: "contracts", dir: dir("migrations-pack-contracts"), devOnly: false },
  // N4 · ADR-0021: dịch vụ tri thức dùng khuôn gói (schema `knowledge`, role `knowledge_rw`) — không phải gói nghiệp vụ.
  { key: "knowledge", dir: dir("migrations-pack-knowledge"), devOnly: false },
  // CR-102 · com-c3: bảng tin chủ quản ↔ đối tác (user ngoài, CR-102a).
  { key: "community", dir: dir("migrations-pack-community"), devOnly: false },
] as const satisfies readonly { key: string; dir: string; devOnly: boolean }[];

export type PackMigrateResult = { kit: number; packs: Record<string, number> };

type Sql = ReturnType<typeof postgres>;
const packTable = (key: string): string => `__drizzle_migrations_pack_${key}`;

/** Số dòng bảng theo dõi; bảng chưa có = 0. `table` chỉ nhận hằng/khoá gói đã kiểm ở trên. */
async function applied(sql: Sql, table: string): Promise<number> {
  const [reg] = await sql<
    { r: string | null }[]
  >`select to_regclass(${`drizzle.${table}`})::text as r`;
  if (!reg?.r) return 0;
  const [row] = await sql.unsafe<{ n: number }[]>(
    `select count(*)::int as n from drizzle.${table}`,
  );
  return row?.n ?? 0;
}

/** Áp một thư mục migration, trả số migration vừa áp. */
async function apply(sql: Sql, folder: string, table: string): Promise<number> {
  const before = await applied(sql, table);
  await migrate(drizzle(sql), { migrationsFolder: folder, migrationsTable: table });
  return (await applied(sql, table)) - before;
}

/** Trả số migration **vừa áp**: `kit` (bộ khung) và `packs[k]` (mỗi gói được chạy ở môi trường này). */
export async function runPackMigrations(opts: {
  url: string;
  appEnv: AppEnv;
}): Promise<PackMigrateResult> {
  return withMigrateLock(opts.url, async () => {
    const sql = postgres(opts.url, { max: 1, onnotice: () => {} });
    try {
      const kit = await apply(sql, dir("migrations-packs"), PACKS_KIT_TABLE);
      const packs: Record<string, number> = {};
      for (const p of PACK_DIRS) {
        if (p.devOnly && opts.appEnv === "production") continue;
        packs[p.key] = await apply(sql, p.dir, packTable(p.key));
      }
      return { kit, packs };
    } finally {
      await sql.end();
    }
  });
}
