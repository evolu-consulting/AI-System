// HUB-FR-95 · X1-AC15 · X1-R09 · plan X1 §2.3: Hub chỉ đọc cờ `side_effect` từ cột `admin.workflows.side_effect`
// (migration Admin 0009) — thiếu cột ⇒ `server.ts` dừng khi khởi động (gợi ý `bun run db:migrate`).
// Đọc `information_schema` (chỉ thấy cột role `hub_api` có quyền SELECT — đúng điều Hub cần).
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";

/** Cột Admin Hub bắt buộc: `[bảng, cột]` trong schema `admin`. */
export const REQUIRED_ADMIN_COLUMNS = [["workflows", "side_effect"]] as const;

/** Cột bắt buộc còn thiếu, dạng `admin.<bảng>.<cột>`, theo thứ tự `REQUIRED_ADMIN_COLUMNS`; đủ ⇒ `[]`. */
export async function missingAdminColumns(db: Db): Promise<string[]> {
  const rows = await db.db.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns where table_schema = 'admin'`);
  const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  return REQUIRED_ADMIN_COLUMNS.filter(([t, c]) => !have.has(`${t}.${c}`)).map(
    ([t, c]) => `admin.${t}.${c}`,
  );
}
