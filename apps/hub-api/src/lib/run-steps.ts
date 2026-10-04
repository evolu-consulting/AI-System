// HUB-FR-50, HUB-FR-89 · H2a P11 · INSERT `hub.run_steps` cấp `seq = max(seq)+1` trong DB (plan-db §2 `insertStep`): bước
// `tool` do `/mcp` ghi (có thể ở instance khác) xen giữa bước của vòng Orchestrator, nên không ai đếm `seq` trong bộ nhớ.
// Dùng chung cho runner / orchestrator / mcp (luật depcruise cấm import `*.repo.ts` khác module).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type RunStepType = "orchestrator" | "delegate" | "workflow" | "tool";
export type RunStepStatus = "running" | "ok" | "failed" | "skipped";

export type NewRunStep = {
  id: string;
  tenantId: string;
  userId: string;
  runId: string;
  type: RunStepType;
  agentId: string | null;
  providerKey: string | null;
  jobId: string | null;
  /** Bắt buộc khi `workflow`/`tool`, null với loại khác (CHECK `run_steps`). */
  workflowId: string | null;
  labelKey: string;
  status: RunStepStatus;
  detail: Record<string, unknown> | null;
  /** Bước đã xong ngay khi ghi (`skipped`) → `finished_at = started_at`. */
  finished?: boolean;
};

/** Thử lại khi 23505 `run_steps_run_seq_uq` (plan-db §2: ≤ 3 lần rồi lỗi → `INTERNAL_ERROR` ở người gọi). */
export const INSERT_STEP_RETRIES = 3;
const SEQ_UQ = "run_steps_run_seq_uq";

function seqConflict(err: unknown): boolean {
  const e = err as { code?: unknown; constraint_name?: unknown; cause?: unknown } | null;
  const pg = (e?.code === undefined ? e?.cause : e) as typeof e;
  return pg?.code === "23505" && pg.constraint_name === SEQ_UQ;
}

/**
 * Trong transaction của người gọi. Khoá advisory theo run (tới hết transaction) tuần tự hoá các INSERT cùng run, nên
 * `max(seq)+1` thấy dòng của transaction trước đã COMMIT; 23505 (người ghi không qua hàm này) → thử lại trong savepoint.
 * Trả `seq` đã cấp.
 */
export async function insertStep(tx: Tx, s: NewRunStep): Promise<number> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`hub.run_steps:${s.runId}`}, 0))`,
  );
  for (let attempt = 0; ; attempt++) {
    try {
      return await tx.transaction((sp) => insertOnce(sp, s));
    } catch (err) {
      if (!seqConflict(err) || attempt >= INSERT_STEP_RETRIES) throw err;
    }
  }
}

async function insertOnce(tx: Tx, s: NewRunStep): Promise<number> {
  const now = sql`date_trunc('milliseconds', now())`;
  const detail = s.detail === null ? null : JSON.stringify(s.detail);
  const rows = await tx.execute<{
    seq: number;
  }>(sql`INSERT INTO hub.run_steps (id, tenant_id, user_id, run_id,
      seq, type, agent_id, provider_key, job_id, workflow_id, label_key, status, detail, started_at, finished_at)
    SELECT ${s.id}::uuid, ${s.tenantId}::uuid, ${s.userId}::uuid, ${s.runId}::uuid, coalesce(max(seq), 0) + 1,
      ${s.type}::text, ${s.agentId}::uuid, ${s.providerKey}::text, ${s.jobId}::uuid, ${s.workflowId}::uuid,
      ${s.labelKey}::text, ${s.status}::text, ${detail}::jsonb, ${now}, ${s.finished ? now : null}::timestamptz
    FROM hub.run_steps WHERE run_id = ${s.runId}::uuid
    RETURNING seq`);
  const seq = rows[0]?.seq;
  if (typeof seq !== "number") throw new Error("insertStep: no seq returned");
  return seq;
}
