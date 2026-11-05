// CR-120 · G4 · `RunEventRepo` gắn tx + `tenantId` của UoW: sự kiện run (`hub.process_run_events`, PK (run, event)) và tìm stage
// `wait_event` đang chờ theo snapshot. MỌI câu lọc `tenant_id` (kể cả scope system). Run đã khoá bởi người gọi (run → stage → timer).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { RunEventRepo } from "../../application/ports";

export function runEventRepo(tx: Tx, tenantId: string): RunEventRepo {
  return {
    async record(runId, event, now) {
      await tx.execute(sql`insert into hub.process_run_events (tenant_id, process_run_id, event, received_at)
        values (${tenantId}, ${runId}, ${event}, ${now.toISOString()}::timestamptz)
        on conflict (process_run_id, event) do nothing`);
    },
    async has(runId, event) {
      const rows = await tx.execute(sql`select 1 from hub.process_run_events
        where tenant_id = ${tenantId} and process_run_id = ${runId} and event = ${event}`);
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
