// HUB-FR-146 · AC-H41 · D2-32 · D2-45 · PD2-I52/PD2-P05 · plan-d2 §9: `ProcessRunSummary.wait_until`/`retry_at` THEO TẬP —
// MỘT câu mỗi trang (`process_timers` lọc `process_run_id = any(ids)` + `tenant_id`, văn bản cố định, `process_timers_run_idx`),
// không câu theo run (Luật 4c). Giá trị = `due_at` sớm nhất của hẹn mở (chưa bắn, chưa huỷ) cùng loại; không có ⇒ `null`.
// Chạy trong scope đọc của người gọi (RLS `process_timers_hub_rw` gác tenant; `tenant_id` lọc tường minh).
import type { ProcessRunSummary } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type RunTimes = Pick<ProcessRunSummary, "wait_until" | "retry_at">;
type Row = { run_id: string; wait_until: string | null; retry_at: string | null };

const NONE: RunTimes = { wait_until: null, retry_at: null };
const iso = (expr: string) =>
  sql.raw(`to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** Hẹn mở sớm nhất theo loại cho các run của trang; `ids` rỗng ⇒ không truy vấn. */
export async function runTimesOf(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, RunTimes>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<Row>(sql`
    select t.process_run_id::text as run_id,
      ${iso("min(t.due_at) filter (where t.kind = 'wait_until')")} as wait_until,
      ${iso("min(t.due_at) filter (where t.kind = 'retry')")} as retry_at
    from hub.process_timers t
    where t.tenant_id = ${tenantId} and t.process_run_id = any(${`{${ids.join(",")}}`}::uuid[])
      and t.fired_at is null and t.cancelled_at is null
    group by t.process_run_id`);
  return new Map(rows.map((r) => [r.run_id, { wait_until: r.wait_until, retry_at: r.retry_at }]));
}

/** Mapper: gắn mốc chờ/thử lại vào summary (run không có hẹn mở ⇒ cả hai `null`, PD2-I52). */
export function withRunTimes<S extends { id: string }>(
  s: S,
  times: ReadonlyMap<string, RunTimes>,
): S & RunTimes {
  return { ...s, ...(times.get(s.id) ?? NONE) };
}
