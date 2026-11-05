// CR-120 · G4 · `RunEventRepo` gắn tx + `tenantId` của UoW: sự kiện run (`hub.process_run_events`, PK (run, event)) và tìm stage
// `wait_event` đang chờ theo snapshot. MỌI câu lọc `tenant_id` (kể cả scope system). Run đã khoá bởi người gọi (run → stage → timer).
// Sự kiện được TIÊU THỤ bởi đúng stage chờ nó (`consumed_by`): run quay lại bước chờ lần nữa ⇒ không qua ngay bằng sự kiện cũ;
// bắn lại ⇒ nạp lại (consumed_by = null).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { RunEventRepo } from "../../application/ports";

export function runEventRepo(tx: Tx, tenantId: string): RunEventRepo {
  return {
    async expected(runId, event) {
      // Có stage `wait_event` đúng khoá đang chờ hoặc còn PHÍA TRƯỚC (idx ≥ stage hiện tại của run) trong snapshot.
      const rows = await tx.execute(sql`select 1 from hub.process_runs r,
          jsonb_array_elements(r.snapshot->'stages') with ordinality as s(e, ord)
        where r.id = ${runId} and r.tenant_id = ${tenantId}
          and s.e->'executor'->>'kind' = 'wait_event' and s.e->'executor'->>'event' = ${event}
          and s.ord - 1 >= r.current_stage_idx
        limit 1`);
      return rows.length > 0;
    },
    async record(runId, event, now) {
      await tx.execute(sql`insert into hub.process_run_events (tenant_id, process_run_id, event, received_at)
        values (${tenantId}, ${runId}, ${event}, ${now.toISOString()}::timestamptz)
        on conflict (process_run_id, event) do update
          set received_at = excluded.received_at, consumed_by = null`);
    },
    async has(runId, event) {
      const rows = await tx.execute(sql`select 1 from hub.process_run_events
        where tenant_id = ${tenantId} and process_run_id = ${runId} and event = ${event}
          and consumed_by is null`);
      return rows.length > 0;
    },
    async consume(runId, event, stageRunId) {
      const rows =
        await tx.execute(sql`update hub.process_run_events set consumed_by = ${stageRunId}
        where tenant_id = ${tenantId} and process_run_id = ${runId} and event = ${event}
          and consumed_by is null
        returning 1`);
      return rows.length > 0;
    },
    async waitingStages(runId, event) {
      const rows = await tx.execute<{ id: string }>(sql`select s.id
        from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
        where s.tenant_id = ${tenantId} and s.process_run_id = ${runId} and s.status = 'waiting_timer'
          and r.snapshot->'stages'->(s.stage_idx)->'executor'->>'kind' = 'wait_event'
          and r.snapshot->'stages'->(s.stage_idx)->'executor'->>'event' = ${event}
        order by s.stage_idx`);
      return rows.map((x) => x.id);
    },
  };
}
