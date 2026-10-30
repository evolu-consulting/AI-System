// fix-migrate-guard · chặn lệch journal ↔ bảng theo dõi trước khi gọi `migrate()` của Drizzle.
// Drizzle chỉ đọc dòng mới nhất (`created_at`) rồi áp các entry có `when` lớn hơn ⇒ hai migration trùng `when` (vd prod
// 2026-10-30: `0064_agent_hooks` từ nhánh khác và `0064_ops_watch` cùng 1798900000000) bị bỏ qua IM LẶNG. Ở đây fail cứng khi:
//   (1) DB có dòng mà hash không thuộc journal (migration lạ / file đã sửa sau khi áp mà chưa khai báo ACCEPTED_EDITS);
//   (2) journal có entry `when` ≤ mốc cuối của DB nhưng hash chưa có trong DB (Drizzle sẽ không bao giờ áp).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";

export type JournalEntry = { tag: string; when: number; hash: string };
export type DbRow = { hash: string; created_at: number };
/** File migration đã sửa SAU khi áp ở môi trường thật (hash cũ còn trong DB). Chỉ thêm khi chắc nội dung tương đương. */
export type AcceptedEdit = { table: string; tag: string; dbHash: string; why: string };

export const ACCEPTED_EDITS: readonly AcceptedEdit[] = [
  {
    table: "__drizzle_migrations_hub",
    tag: "0048_agent_studio_overrides",
    dbHash: "7aeecbb713aae20e7ff551d7fca8f44291250176e26ba850ad9a8f5d53b7abfe",
    why: "6a0d535d (2026-10-21) viết lại 0048 cho idempotent sau khi prod đã áp bản 8992a44d",
  },
];

type Journal = { entries: { tag: string; when: number }[] };

/** Đọc journal + hash đúng cách Drizzle tính (sha256 nội dung file .sql). */
export function readJournal(folder: string): JournalEntry[] {
  const j = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as Journal;
  return j.entries.map((e) => ({
    tag: e.tag,
    when: e.when,
    hash: createHash("sha256")
      .update(readFileSync(join(folder, `${e.tag}.sql`)).toString())
      .digest("hex"),
  }));
}

/** Logic thuần: trả danh sách lỗi (rỗng = khớp). */
export function journalDrift(
  table: string,
  journal: readonly JournalEntry[],
  rows: readonly DbRow[],
  accepted: readonly AcceptedEdit[] = ACCEPTED_EDITS,
): string[] {
  const edits = accepted.filter((a) => a.table === table);
  const jHash = new Set(journal.map((e) => e.hash));
  const tags = new Set(journal.map((e) => e.tag));
  const dbHash = new Set(rows.map((r) => r.hash));
  const editedOk = (h: string) => edits.some((a) => a.dbHash === h && tags.has(a.tag));
  const errors: string[] = [];
  for (const r of rows) {
    if (jHash.has(r.hash) || editedOk(r.hash)) continue;
    errors.push(
      `DB có migration không có trong journal: created_at=${r.created_at} hash=${r.hash.slice(0, 16)}… (nhánh khác đã deploy? file đã sửa sau khi áp?)`,
    );
  }
  const last = rows.reduce((m, r) => Math.max(m, r.created_at), Number.NEGATIVE_INFINITY);
  for (const e of journal) {
    if (e.when > last || dbHash.has(e.hash)) continue;
    if (edits.some((a) => a.tag === e.tag && dbHash.has(a.dbHash))) continue;
    errors.push(
      `journal ${e.tag} (when=${e.when}) ≤ mốc cuối DB ${last} nhưng chưa áp — Drizzle sẽ bỏ qua im lặng`,
    );
  }
  return errors;
}

type Sql = ReturnType<typeof postgres>;

/** Fail cứng nếu bảng `drizzle.<table>` lệch journal `folder`. Bảng chưa có ⇒ DB sạch, bỏ qua. */
export async function assertMigrationsInSync(
  sql: Sql,
  folder: string,
  table: string,
): Promise<void> {
  const [reg] = await sql<
    { r: string | null }[]
  >`select to_regclass(${`drizzle.${table}`})::text as r`;
  if (!reg?.r) return;
  // `table` chỉ nhận hằng/khoá gói đã kiểm ở nơi gọi nên ghép chuỗi an toàn.
  const rows = await sql.unsafe<{ hash: string; created_at: string }[]>(
    `select hash, created_at::text as created_at from drizzle.${table}`,
  );
  const errors = journalDrift(
    table,
    readJournal(folder),
    rows.map((r) => ({ hash: r.hash, created_at: Number(r.created_at) })),
  );
  if (errors.length > 0)
    throw new Error(
      `migrate-guard drizzle.${table} lệch journal (${folder}):\n  - ${errors.join("\n  - ")}`,
    );
}
