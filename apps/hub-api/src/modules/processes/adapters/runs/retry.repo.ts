// HUB-FR-143 · PD-R03/R04/R06 · K1/K2 · plan §4.2 · `RetryRepo` gắn tx + `tenantId` của UoW: bộ đếm thử lại của
// `hub.stage_runs` (cột 0036). MỌI câu lọc `(id, tenant_id)` kể cả scope system. Người gọi đã khoá run (plan §6).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { RetryRepo } from "../../application/ports";

type Row = {
  retry_count: number;
  retry_attempt: number | null;
  retry_round: number | null;
  attempt: number;
  round: number;
};

const numOrNull = (v: number | null): number | null => (v === null ? null : Number(v));

/** `stage_runs_retry_ck`: `last_error_code` ≤ 64 ký tự. */
const ERROR_CODE_MAX = 64;

export function retryRepo(tx: Tx, tenantId: string): RetryRepo {
  return {
    async loadRetryState(stageRunId) {
      const [r] = await tx.execute<Row>(sql`
        select retry_count, retry_attempt, retry_round, attempt, round from hub.stage_runs
        where id = ${stageRunId} and tenant_id = ${tenantId}`);
      if (!r) return null;
      return {
        retryCount: Number(r.retry_count),
        retryAttempt: numOrNull(r.retry_attempt),
        retryRound: numOrNull(r.retry_round),
        attempt: Number(r.attempt),
        round: Number(r.round),
      };
    },
    async markWaiting(stageRunId, w) {
      await tx.execute(sql`
        update hub.stage_runs set status = 'waiting_timer', current_run_id = null,
          retry_count = ${w.retryCount}, retry_attempt = ${w.attempt}, retry_round = ${w.round},
          last_error_code = ${w.lastErrorCode.slice(0, ERROR_CODE_MAX)},
          updated_at = ${w.now.toISOString()}::timestamptz
        where id = ${stageRunId} and tenant_id = ${tenantId}`);
    },
    resetRetry: (stageRunId) => resetRetry(tx, tenantId, stageRunId),
  };
}

/** PD-R04 · effect `reset_retry` (cũng gọi từ `gates.effects` — code cũ đang ở trong tx đã khoá run, K2). */
export async function resetRetry(tx: Tx, tenantId: string, stageRunId: string): Promise<void> {
  await tx.execute(sql`update hub.stage_runs set retry_count = 0, last_error_code = null
    where id = ${stageRunId} and tenant_id = ${tenantId}`);
}
