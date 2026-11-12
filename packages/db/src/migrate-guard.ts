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
  {
    table: "__drizzle_migrations_hub",
    tag: "0029_k1_kh",
    dbHash: "fafb379b31278735a3338f07dfdc685e2e861c4880ee2181f6dd600edf10ff1b",
    why: "cr120-int-reds: thêm guard chạy lại cho CHECK entity (không đặt về danh sách hẹp); lần đầu áp y hệt bản cũ",
  },
  {
    table: "__drizzle_migrations_hub",
    tag: "0030_h4b2_models",
    dbHash: "847b18e6df6194941e4d80014fbf2703952e6a825ff0e3488f56680f174b9baf",
    why: "cr120-int-reds: thêm guard chạy lại cho CHECK entity (kiểu 0071); lần đầu áp y hệt bản cũ",
  },
  {
    table: "__drizzle_migrations_hub",
    tag: "0068_process_library",
    dbHash: "f8baecce0dff924a1efdddf4c583dd76a34c691f3f17a73543fb007d9cb357e8",
    why: "cr120-int-reds: phần bảng gán cũ chỉ chạy khi còn là bảng (sau hub 0091 là VIEW); lần đầu áp y hệt bản cũ",
  },
  // Hash THẬT trên prod sohoptac2 (đọc 2026-11-06 = sha256 bản fd7385677~1 của chính file đó, khác 3 hash trên — tính lệch
  // dòng/CRLF). Deploy CR-121 bị migrate-guard chặn vì thiếu 3 dòng này.
  {
    table: "__drizzle_migrations_hub",
    tag: "0029_k1_kh",
    dbHash: "f2f3c41abb190348ff4bbd2cb4fc90e0205c80391b7aca53dc5377b320d84e68",
    why: "prod sohoptac2: bản 0029 trước fd7385677 (cr120-int-reds)",
  },
  {
    table: "__drizzle_migrations_hub",
    tag: "0030_h4b2_models",
    dbHash: "82c2bd32184dc1c3654fea718648cd9711de36e5b36f5298d2c0996d258e3d47",
    why: "prod sohoptac2: bản 0030 trước fd7385677 (cr120-int-reds)",
  },
  {
    table: "__drizzle_migrations_hub",
    tag: "0068_process_library",
    dbHash: "dd1f1821f219b319d23ea8599ae82263f4887b59de6297c674c2e076796bbac4",
    why: "prod sohoptac2: bản 0068 trước fd7385677 (cr120-int-reds)",
  },
  {
    table: "__drizzle_migrations_pack_contracts",
    tag: "0094_inbox_awaiting",
    dbHash: "1f2fd04c161f6b890015195ed74e158204fc835df05e00d568139b90e7cc8037",
    why: "CR-127 C2: bỏ ALTER CHECK hub.evidence khỏi migration gói (chuyển sang hub 0137); CR-127 chưa deploy, DB dev đã áp bản cũ — kết quả tương đương",
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
