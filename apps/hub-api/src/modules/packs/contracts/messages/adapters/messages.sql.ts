// CR-132 M3 · mảnh SQL dùng chung của repo tin nhắn.
import { sql } from "drizzle-orm";

/** Thời điểm dạng ISO µs (UTC) — giữ độ chính xác PG để làm con trỏ phân trang và `Date.parse` được ở TS. `col` là tên cột trong câu (hằng, không từ người dùng). */
export const iso = (col: string) =>
  sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Mảng uuid dạng literal Postgres cho `= any($1::uuid[])` (id đã qua zod uuid). */
export const uuidArr = (ids: readonly string[]) => `{${ids.join(",")}}`;
