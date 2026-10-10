// HUB-FR-104 · B1 · có migration 0019 chưa (test-plan §1, §5): fixture chỉ chèn bảng/cột mới SAU khi `hasPaSchema` = true;
// vắng ⇒ bỏ chèn, ca đỏ ở `expect(ready).toBe(true)` (không PostgresError ở beforeAll).
import { expect } from "bun:test";
import type postgres from "postgres";

type Sql = postgres.Sql;

/** `to_regclass('hub.process_runs') IS NOT NULL` + cột `room_messages.process_kind` (plan-thread §3). */
export async function hasPaSchema(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select
      to_regclass('hub.process_runs') is not null
      and to_regclass('hub.process_thread_events') is not null
      and exists (select 1 from information_schema.columns
                  where table_schema = 'hub' and table_name = 'room_messages' and column_name = 'process_kind') as ok`;
  return r?.ok === true;
}

/** Ca đầu mỗi `it` int cần 0019: đỏ đúng lý do khi chưa có migration. */
export function needSchema(ready: boolean): void {
  expect({ migration0019: ready }).toEqual({ migration0019: true });
}

/** Bảng có tồn tại (S0-01). */
export async function tableExists(sql: Sql, qname: string): Promise<boolean> {
  const [r] = await sql<{ ok: boolean }[]>`select to_regclass(${qname}) is not null as ok`;
  return r?.ok === true;
}

/** Cột + nullable (S0-01). */
export async function columnInfo(
  sql: Sql,
  table: string,
  column: string,
): Promise<{ exists: boolean; nullable: boolean }> {
  const [r] = await sql<
    { is_nullable: string }[]
  >`select is_nullable from information_schema.columns
    where table_schema = 'hub' and table_name = ${table} and column_name = ${column}`;
  return { exists: r !== undefined, nullable: r?.is_nullable === "YES" };
}
