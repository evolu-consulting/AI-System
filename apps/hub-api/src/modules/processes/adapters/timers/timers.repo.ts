// HUB-FR-143 · HUB-FR-144 · PD-R11/R12 · K1/K3 · plan §5–§6: `TimerRepo` gắn tx + `tenantId` của UoW. MỌI câu có
// `tenant_id = $t` kể cả scope system (policy system thấy mọi tenant — bài học `scanDue` P-c2). Khoá run trước timer.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { TimerRepo } from "../../application/ports";
import type { Timer } from "../../domain/types";
import { timerKindOf } from "../processes.mapper";

type TimerRow = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  stage_run_id: string;
  kind: string;
  due_at: string | Date;
  fired_at: string | Date | null;
  cancelled_at: string | Date | null;
};

const at = (v: string | Date): Date => (v instanceof Date ? v : new Date(v));
const atOrNull = (v: string | Date | null): Date | null => (v === null ? null : at(v));

const toTimer = (r: TimerRow): Timer => ({
  id: r.id,
  tenantId: r.tenant_id,
  runId: r.process_run_id,
  stageRunId: r.stage_run_id,
  kind: timerKindOf(r.kind),
  dueAt: at(r.due_at),
  firedAt: atOrNull(r.fired_at),
  cancelledAt: atOrNull(r.cancelled_at),
});

export function timerRepo(tx: Tx, tenantId: string): TimerRepo {
  return {
    async lockById(id) {
      const rows = await tx.execute<TimerRow>(sql`
        select id, tenant_id, process_run_id, stage_run_id, kind, due_at, fired_at, cancelled_at
        from hub.process_timers where id = ${id} and tenant_id = ${tenantId} for update`);
      const r = rows[0];
      return r ? toTimer(r) : null;
    },
    async markFired(id, now) {
      const rows = await tx.execute(sql`
        update hub.process_timers set fired_at = ${now.toISOString()}::timestamptz
        where id = ${id} and tenant_id = ${tenantId} and fired_at is null and cancelled_at is null
        returning 1`);
      return rows.length > 0;
    },
    async cancelForRun(runId, stageRunIds, now) {
      const all = stageRunIds === "all";
      const ids = all ? "{}" : `{${stageRunIds.join(",")}}`;
      const rows = await tx.execute(sql`
        update hub.process_timers set cancelled_at = ${now.toISOString()}::timestamptz
        where tenant_id = ${tenantId} and process_run_id = ${runId}
          and fired_at is null and cancelled_at is null
          and (${all}::boolean or stage_run_id = any(${ids}::uuid[]))
        returning 1`);
      return rows.length;
    },
  };
}
