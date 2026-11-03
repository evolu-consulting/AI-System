// CR-116 · bench hub (chỉ đo): bản sao bảng Hub vào schema `bench` (LIKE … INCLUDING DEFAULTS INCLUDING INDEXES — không FK,
// không CHECK) để seed nhanh mà giữ đúng kiểu cột + index thật; `fill` điền cột NOT NULL không default theo kiểu.
import type { Sql } from "@ai/test-kit/db";

/** `bench.<name>` = bản sao cấu trúc + index của `<schema>.<table>`. `extra` = câu tạo index biến thể (tuỳ chọn). */
export async function cloneTable(
  sql: Sql,
  src: string,
  name: string,
  extra: string[] = [],
): Promise<void> {
  await sql.unsafe("create schema if not exists bench");
  await sql.unsafe(`drop table if exists bench.${name} cascade`);
  await sql.unsafe(`create table bench.${name} (like ${src} including defaults including indexes)`);
  for (const e of extra) await sql.unsafe(e);
}

type Col = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};
const FILL: Record<string, string> = {
  uuid: "gen_random_uuid()",
  text: "'x'",
  "character varying": "'x'",
  integer: "0",
  smallint: "0",
  bigint: "0",
  numeric: "0",
  "double precision": "0",
  real: "0",
  boolean: "false",
  "timestamp with time zone": "now()",
  "timestamp without time zone": "now()",
  date: "current_date",
  jsonb: "'{}'::jsonb",
  json: "'{}'::json",
  ARRAY: "'{}'",
  tsvector: "''::tsvector",
};

/** Chèn `n` hàng vào `bench.<name>`; `over` = biểu thức SQL theo `i` (1..n) cho cột cần giá trị cụ thể. */
export async function fill(
  sql: Sql,
  name: string,
  n: number,
  over: Record<string, string>,
): Promise<void> {
  const cols = (await sql`select column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema = 'bench' and table_name = ${name}
      and is_generated = 'NEVER' order by ordinal_position`) as unknown as Col[];
  const names: string[] = [];
  const exprs: string[] = [];
  for (const c of cols) {
    const o = over[c.column_name];
    if (o !== undefined) {
      names.push(`"${c.column_name}"`);
      exprs.push(o);
    } else if (c.is_nullable === "NO" && c.column_default === null) {
      const f = FILL[c.data_type];
      if (!f)
        throw new Error(
          `fill: bench.${name}.${c.column_name} kiểu ${c.data_type} chưa có giá trị mặc định`,
        );
      names.push(`"${c.column_name}"`);
      exprs.push(f);
    }
  }
  const unknown = Object.keys(over).filter((k) => !cols.some((c) => c.column_name === k));
  if (unknown.length) throw new Error(`fill: bench.${name} không có cột ${unknown.join(", ")}`);
  await sql.unsafe(
    `insert into bench.${name} (${names.join(", ")}) select ${exprs.join(", ")} from generate_series(1, ${n}) i`,
  );
  await sql.unsafe(`vacuum analyze bench.${name}`);
}

/** uuid tất định từ số (để biểu thức seed và tham số truy vấn cùng sinh một id). */
export const uid = (prefix: number, i: number): string =>
  `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
export const uidSql = (prefix: number, expr = "i"): string =>
  `('${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-' || lpad(to_hex(${expr}), 12, '0'))::uuid`;
