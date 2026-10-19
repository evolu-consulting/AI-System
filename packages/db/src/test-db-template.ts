// ADM-NFR-06 · DB test dựng từ template đã migrate (nhanh hơn reset + migrate lại ~50 migration mỗi lần gọi).
// Template mang COMMENT = `key:sha256(migrations*/**)`; lệch → dựng lại dưới advisory lock (nhiều worker không dựng hai lần,
// không chạy ALTER ROLE của migration dev song song). Đường nóng không tạo/xoá database (xem cloneMigratedTestDb).
// Chỉ nhận DB tên kết thúc `_test`. `resetTestDb` giữ nguyên cho test migration (cần schema rỗng).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { runPackMigrations } from "./migrate-packs";
import { resetToSnapshot, type Snapshot, snapshot } from "./test-db-reset";

const DB_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Khoá advisory chung cho mọi lần dựng template (hằng tuỳ ý, cố định). */
const BUILD_LOCK = 7_316_204_611;
const KEY_RE = /^[a-z0-9_]{1,24}$/;
const MAX_NAME = 63;

export type CloneOpts = { key: string; migrate: (url: string) => Promise<unknown> };

/** Migrate Admin (main + dev), như các fixture M1–M3 (`appEnv` test ≡ development: chỉ production khác). */
export const migrateAdminTest = async (url: string): Promise<void> => {
  await runMigrations({ url, appEnv: "test" });
};

/** Migrate Admin + Hub + gói (`appEnv: test` ⇒ có `pkdemo`), như `prepareDb` của H1 (PK-FR-04: DB mẫu có schema gói). */
export const migrateFullTest = async (url: string): Promise<void> => {
  await runMigrations({ url, appEnv: "test" });
  await runHubMigrations({ url, appEnv: "test" });
  await runPackMigrations({ url, appEnv: "test" });
};

export function dbNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Tên template suy từ DB đích + key; luôn hậu tố `_test`, ≤ 63 ký tự (dài quá → băm tên đích). */
export function templateDbName(target: string, key: string): string {
  if (!target.endsWith("_test")) throw new Error("template: tên DB phải kết thúc _test");
  if (!KEY_RE.test(key)) throw new Error(`template: key không hợp lệ ${JSON.stringify(key)}`);
  const name = `${target.slice(0, -"_test".length)}_${key}_tpl_test`;
  return name.length <= MAX_NAME ? name : `t_${sha(target).slice(0, 12)}_${key}_tpl_test`;
}

/** sha256 của mọi file dưới `packages/db/migrations*` (đường dẫn tương đối + nội dung, thứ tự ổn định). */
export function migrationsHash(root = DB_ROOT): string {
  const files: string[] = [];
  for (const d of readdirSync(root, { withFileTypes: true }))
    if (d.isDirectory() && d.name.startsWith("migrations"))
      for (const f of readdirSync(join(root, d.name), { recursive: true, withFileTypes: true }))
        if (f.isFile()) files.push(join(f.parentPath, f.name));
  const h = createHash("sha256");
  for (const f of files.map((x) => relative(root, x).replaceAll("\\", "/")).sort())
    h.update(`${f}\0${sha(readFileSync(join(root, f)))}\n`);
  return h.digest("hex");
}

let hashMemo: string | undefined;
const comment = (key: string) => {
  hashMemo ??= migrationsHash();
  return `${key}:${hashMemo}`;
};

type Sql = postgres.Sql;
/** Cùng URL, đổi tên database (như `withDatabase` ở test-db.ts; chép lại để tránh import vòng). */
function onDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function tplComment(m: Sql, tpl: string): Promise<string | null> {
  const [r] = await m<{ c: string | null }[]>`
    select shobj_description(oid, 'pg_database') as c from pg_database where datname = ${tpl}`;
  return r?.c ?? null;
}

async function ensureTemplate(m: Sql, url: string, tpl: string, o: CloneOpts): Promise<void> {
  const want = comment(o.key);
  if ((await tplComment(m, tpl)) === want) return;
  await m`select pg_advisory_lock(${BUILD_LOCK})`;
  try {
    if ((await tplComment(m, tpl)) === want) return;
    for (let i = 0; ; i++) {
      await m.unsafe(`DROP DATABASE IF EXISTS ${q(tpl)} WITH (FORCE)`);
      await m.unsafe(`CREATE DATABASE ${q(tpl)}`);
      try {
        await o.migrate(onDb(url, tpl));
        break;
      } catch (e) {
        // ALTER ROLE của migration đụng tiến trình ngoài khoá (vd test migration đang chạy) → XX000; dựng lại.
        if (i >= 2 || !/tuple concurrently updated/.test(String((e as Error)?.cause ?? e))) throw e;
      }
    }
    await m.unsafe(`COMMENT ON DATABASE ${q(tpl)} IS '${want.replaceAll("'", "''")}'`);
  } finally {
    await m`select pg_advisory_unlock(${BUILD_LOCK})`;
  }
}

/** CREATE DATABASE … TEMPLATE lỗi 55006 khi template đang có phiên khác (vd đang dựng lại) → thử lại ngắn. */
async function cloneWithRetry(m: Sql, target: string, tpl: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await m.unsafe(`CREATE DATABASE ${q(target)} TEMPLATE ${q(tpl)}`);
      return;
    } catch (e) {
      if (code(e) !== "55006" || i >= 50) throw e;
      await Bun.sleep(100);
    }
  }
}

/**
 * Gom rác DB (đích cũ sau mỗi lần clone lại) trong tiến trình khi một đích có ≥ GC_AT cái — chạy lẻ `bun test`. Mỗi DROP
 * DATABASE ép một checkpoint toàn cụm (đo trên Windows: 0,25–5 s) nên `test:int:par` tắt bằng `TEST_DB_GC=0`, xoá ở cuối.
 */
const GC_AT = 16;
const code = (e: unknown) => (e as { code?: string } | null)?.code;

/** Mẫu LIKE + bộ sinh tên DB rác của một đích (`…_trash_<id>_test`, ≤ 63 ký tự). */
export function trashNames(target: string): { like: string; next: () => string } {
  const stem = target.slice(0, -"_test".length);
  const s = stem.length <= 30 ? stem : `t_${sha(target).slice(0, 12)}`;
  let n = 0;
  return {
    like: `${s.replaceAll("_", "\\_")}\\_trash\\_%\\_test`,
    next: () => `${s}_trash_${Date.now().toString(36)}${(n++ % 1296).toString(36)}_test`,
  };
}

/** Ngắt mọi phiên khác tới `db`. */
async function terminate(m: Sql, db: string): Promise<void> {
  await m`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${db} and pid <> pg_backend_pid()`;
}

/** Ngắt mọi phiên tới `from` rồi đổi tên (tức thì, không checkpoint). `from` không tồn tại → false. */
async function renameDb(m: Sql, from: string, to: string): Promise<boolean> {
  for (let i = 0; ; i++) {
    await terminate(m, from);
    try {
      await m.unsafe(`ALTER DATABASE ${q(from)} RENAME TO ${q(to)}`);
      return true;
    } catch (e) {
      if (code(e) === "3D000") return false;
      // 55006: phiên vừa ngắt chưa thoát hẳn, hoặc pool vừa nối lại → ngắt lại.
      if (code(e) !== "55006" || i >= 100) throw e;
      await Bun.sleep(20);
    }
  }
}

/** Xoá mọi DB rác khớp `like` (mặc định: của mọi đích) khi có ≥ `min` cái. Trả số DB đã xoá. */
export async function dropTrashDbs(
  url: string,
  like = "%\\_trash\\_%\\_test",
  min = 1,
): Promise<number> {
  const m = postgres(onDb(url, "postgres"), { max: 4, onnotice: () => {} });
  try {
    const rows = await m<
      { n: string }[]
    >`select datname as n from pg_database where datname like ${like}`;
    const names = rows.map((r) => r.n).filter((n) => /_trash_[0-9a-z]+_test$/.test(n));
    if (names.length < min) return 0;
    await Promise.all(names.map((n) => m.unsafe(`DROP DATABASE IF EXISTS ${q(n)} WITH (FORCE)`)));
    return names.length;
  } finally {
    await m.end();
  }
}

/** Ảnh chụp mỗi đích ngay sau lần clone gần nhất trong tiến trình này, gắn với đúng lần dựng template. */
const snaps = new Map<string, { tag: string; snap: Snapshot }>();

async function onTarget<T>(url: string, f: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await f(sql);
  } finally {
    await sql.end();
  }
}

/**
 * DB `url` (tên kết thúc `_test`) về đúng trạng thái "vừa migrate" bằng `migrate` (template dựng/dựng lại khi thiếu hoặc lệch
 * hash migration). Mọi kết nối khác tới DB đích bị ngắt. Đường nhanh (~0,1 s): schema còn y như lúc clone → xoá dữ liệu, chèn
 * lại hàng ban đầu, đặt lại sequence (test-db-reset.ts). Đường chậm (DB chưa từng clone, hoặc test đã đổi schema/quyền):
 * đổi tên DB cũ thành rác (không DROP ở đường nóng) rồi CREATE DATABASE … TEMPLATE.
 */
export async function cloneMigratedTestDb(url: string | undefined, o: CloneOpts): Promise<void> {
  if (!url) throw new Error("TEST_DATABASE_URL chưa đặt");
  const target = dbNameOf(url);
  if (!target.endsWith("_test")) throw new Error("cloneMigratedTestDb: tên DB phải kết thúc _test");
  const tpl = templateDbName(target, o.key);
  const m = postgres(onDb(url, "postgres"), { max: 1, onnotice: () => {} });
  try {
    await ensureTemplate(m, url, tpl, o);
    const [t] = await m<
      { o: number }[]
    >`select oid::int as o from pg_database where datname = ${tpl}`;
    const tag = `${comment(o.key)}@${t?.o}`;
    // Ảnh chụp đọc thẳng từ template (một lần mỗi tiến trình): mỗi lô `bun test` mới không phải clone lại.
    let snap = snaps.get(target)?.tag === tag ? snaps.get(target)?.snap : undefined;
    if (!snap) {
      snap = await onTarget(onDb(url, tpl), snapshot);
      snaps.set(target, { tag, snap });
    }
    await terminate(m, target);
    const s = snap;
    if (await onTarget(url, (sql) => resetToSnapshot(sql, s)).catch(() => false)) return;
    const trash = trashNames(target);
    await renameDb(m, target, trash.next());
    await cloneWithRetry(m, target, tpl);
    if (process.env.TEST_DB_GC !== "0") await dropTrashDbs(url, trash.like, GC_AT);
  } finally {
    await m.end();
  }
}
