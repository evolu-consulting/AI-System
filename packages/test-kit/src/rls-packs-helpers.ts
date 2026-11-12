// Tiện ích dùng chung cho các khai báo bảng của bộ RLS theo hợp đồng (rls-packs.int.test.ts, rls-packs-cks.ts).
import { userId } from "./builders";
import type { Sql } from "./db";

export const who = userId(901);

/** `INSERT … RETURNING id::text` (owner hoặc role) — trả khoá chính dạng chuỗi. */
export const one = async (sql: Sql, text: string, params: unknown[]): Promise<string> => {
  const rows = (await sql.unsafe(
    `${text} returning id::text as id`,
    params as never[],
  )) as unknown as { id: string }[];
  return rows[0]?.id as string;
};
export const rnd = (pk?: string): string => pk ?? crypto.randomUUID();
export const parent = (sql: Sql, table: string, t: string): Promise<string> =>
  sql
    .unsafe(`select id::text as id from ${table} where tenant_id = $1 order by id limit 1`, [t])
    .then((r) => (r[0] as unknown as { id: string }).id);
