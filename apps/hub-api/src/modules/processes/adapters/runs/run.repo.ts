// HUB-FR-143 · K1/K3 · plan §5–§6: `RunRepo` gắn tx + `tenantId` của UoW — khoá run theo `(id, tenant_id)` (thứ tự khoá
// `process_runs → stage_runs → process_timers`). Run tenant khác ⇒ `null` kể cả scope system.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { RunRepo } from "../../application/ports";
import { runStatusOf } from "../processes.mapper";

export function runRepo(tx: Tx, tenantId: string): RunRepo {
  return {
    async lock(runId) {
      const rows = await tx.execute<{ id: string; tenant_id: string; status: string }>(sql`
        select id, tenant_id, status from hub.process_runs
        where id = ${runId} and tenant_id = ${tenantId} for update`);
      const r = rows[0];
      return r ? { id: r.id, tenantId: r.tenant_id, status: runStatusOf(r.status) } : null;
    },
  };
}
