// HUB-FR-13, HUB-FR-89 · WRK-FR-07 · H2a-R12, R13 · P9, P10 · SQL job `workflow.async` (plan H2a §5.3, plan-db §2). Gọi trong
// `withHubScope(system)` (việc nền của chủ run). Thứ tự khoá §3.5: runs → run_steps → jobs.
import {
  JOB_ENQUEUED_CHANNEL,
  type JobEnqueuedPayload,
  type WorkflowAsyncJob,
} from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { jobs } from "@ai/db/schema/hub";
import { eq, sql } from "drizzle-orm";
import { insertStep } from "../../../lib/run-steps";
import type { JobRow } from "../runner.rules";

/**
 * `runs FOR SHARE` (còn `running` ∧ còn của `owner`) → provider `dify` bật (đọc DB trong transaction, không tin cache:
 * P9) → step `workflow` `running` (gắn `job_id`) → `INSERT hub.jobs (workflow.async, dify, agent_id NULL)` →
 * `pg_notify('job_enqueued')`, một transaction (NOTIFY giao khi COMMIT). Trả `seq` của step + đã có job chưa (provider
 * tắt/thiếu → step vẫn ghi, không job); null = run đã đóng/không còn của mình (không ghi gì).
 */
export async function enqueueWorkflowJob(
  tx: Tx,
  p: WorkflowAsyncJob,
  owner: string,
  detail: Record<string, unknown> | null,
): Promise<{ seq: number; enqueued: boolean } | null> {
  const live = await tx.execute(sql`select 1 from hub.runs
    where id = ${p.run_id} and status = 'running' and owner = ${owner} for share`);
  if (live.length === 0) return null;
  const on = await tx.execute(
    sql`select 1 from hub.providers where key = ${p.provider_key} and enabled`,
  );
  const enqueued = on.length > 0;
  const seq = await insertStep(tx, {
    id: p.step_id,
    tenantId: p.tenant_id,
    userId: p.user_id,
    runId: p.run_id,
    type: "workflow",
    agentId: null,
    providerKey: enqueued ? p.provider_key : null,
    jobId: enqueued ? p.job_id : null,
    workflowId: p.workflow_id,
    labelKey: "step.workflow",
    status: "running",
    detail,
  });
  if (!enqueued) return { seq, enqueued };
  await tx.execute(sql`INSERT INTO hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, priority, payload)
    VALUES (${p.job_id}, ${p.tenant_id}, ${p.user_id}, ${p.run_id}, ${p.step_id}, ${p.conversation_id}, NULL,
      'workflow.async', 'dify', 100, ${JSON.stringify(p)}::jsonb)`);
  const note: JobEnqueuedPayload = { v: 1, job_id: p.job_id, provider_key: p.provider_key };
  await tx.execute(sql`select pg_notify(${JOB_ENQUEUED_CHANNEL}, ${JSON.stringify(note)})`);
  return { seq, enqueued };
}

/** Trạng thái job + đã `queued` quá `maxWaitS` **tính từ `queued_at`** chưa (P10: requeue đặt lại đồng hồ). */
export async function readWorkflowJob(
  tx: Tx,
  jobId: string,
  maxWaitS: number,
): Promise<(JobRow & { queueExpired: boolean }) | undefined> {
  const [row] = await tx
    .select({
      status: jobs.status,
      result: jobs.result,
      errorCode: jobs.errorCode,
      errorReason: jobs.errorReason,
      errorMessage: jobs.errorMessage,
      queueExpired: sql<boolean>`${jobs.queuedAt} <= now() - make_interval(secs => ${maxWaitS})`,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  return row;
}

/** plan-db §2 "Hết hạn queued" (nguyên văn): 0 dòng = Runtime vừa claim hoặc job vừa được requeue. */
export async function expireWorkflowQueued(
  tx: Tx,
  jobId: string,
  reason: string,
  maxWaitS: number,
): Promise<boolean> {
  const rows = await tx.execute(
    sql`UPDATE hub.jobs SET status = 'failed', error_code = 'ALL_PROVIDERS_EXHAUSTED', error_reason = ${reason},
      finished_at = now() WHERE id = ${jobId} AND status = 'queued'
      AND queued_at < now() - make_interval(secs => ${maxWaitS}) RETURNING id`,
  );
  return rows.length > 0;
}
