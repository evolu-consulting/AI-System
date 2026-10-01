// ADM-FR-04, ADM-FR-60, ADM-FR-10 · helper SQL dùng chung cho list.
import { users } from "@ai/db";
import { type AnyColumn, getTableName, type SQL, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

/** `%q%` cho ILIKE; ký tự đại diện `\ % _` trong `q` được thoát để tìm đúng chuỗi người dùng gõ. */
export const likeArg = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * Cột của câu NGOÀI dùng trong subquery tương quan, luôn ghi đủ `"schema"."bảng"."cột"`: câu select một bảng
 * (không join) của Drizzle in cột KHÔNG kèm tên bảng, nên `${secrets.id}` trong subquery `from workflows` thành `"id"`
 * và bị hiểu là `workflows.id` (lỗi `used_by: []` ở T6).
 */
export function outer(col: AnyColumn): SQL {
  const table = col.table as PgTable;
  const schema = getTableConfig(table).schema ?? "public";
  return sql.raw(`"${schema}"."${getTableName(table)}"."${col.name}"`);
}

/**
 * Username của người ghi (`updated_by`/`granted_by`) bằng subquery theo PK, KHÔNG join `users`: `users` bật RLS nên
 * planner ước lượng sai số hàng và chọn nested loop quét cả bảng cho mỗi hàng (đo M2: 1.000 workflow × 10.000 user =
 * ~1 s). Subquery chỉ chạy cho hàng của trang, dùng `users_pkey`.
 */
export const usernameOf = (col: AnyColumn): SQL<string | null> =>
  sql<string | null>`(select ${users.username} from ${users} where ${users.id} = ${outer(col)})`;
