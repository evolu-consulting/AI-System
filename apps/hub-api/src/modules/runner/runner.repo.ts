// HUB-FR-89 · HUB-FR-24 · SQL của AgentRunner (plan H1 §5.6, plan-db §3.3). Gọi trong `withHubScope(system)` (việc nền
// của chủ run); `hub.jobs`/`provider_state` không RLS. Thứ tự khoá §3.5: run_steps → jobs.
import { JOB_ENQUEUED_CHANNEL, type JobEnqueuedPayload, type JobPayload } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { jobs, providerState, runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";
import type { JobRow } from "./runner.rules";

const NOW_MS = sql`date_trunc('milliseconds', now())`;

export async function providerStateOf(
  tx: Tx,
  key: string,
): Promise<{ status: string; cooldownUntil: Date | null } | undefined> {
  const [row] = await tx
    .select({ status: providerState.status, cooldownUntil: providerState.cooldownUntil })
    .from(providerState)
    .where(eq(providerState.providerKey, key));
  return row;
}

export type StepInsert = {
  stepId: string;
  seq: number;
  type: "orchestrator" | "delegate";
  labelKey: string;
};

/**
 * §5.6 bước 2 · `run_steps` (running) → `INSERT hub.jobs` → `pg_notify('job_enqueued')` cùng transaction: NOTIFY chỉ
 * giao khi COMMIT nên Runtime nhận NOTIFY là thấy dòng job.
 */
export async function enqueueJob(tx: Tx, p: JobPayload, step: StepInsert): Promise<void> {
  await tx.insert(runSteps).values({
    id: step.stepId,
    tenantId: p.tenant_id,
    userId: p.user_id,
    runId: p.run_id,
    seq: step.seq,
    type: step.type,
    agentId: p.agent.id,
    providerKey: p.provider_key,
    jobId: p.job_id,
    labelKey: step.labelKey,
    status: "running",
    startedAt: NOW_MS,
  });
  await tx.insert(jobs).values({
    id: p.job_id,
    tenantId: p.tenant_id,
    userId: p.user_id,
    runId: p.run_id,
    stepId: p.step_id,
    conversationId: p.conversation_id,
    agentId: p.agent.id,
    type: p.type,
    providerKey: p.provider_key,
    payload: p,
  });
  const note: JobEnqueuedPayload = { v: 1, job_id: p.job_id, provider_key: p.provider_key };
  await tx.execute(sql`select pg_notify(${JOB_ENQUEUED_CHANNEL}, ${JSON.stringify(note)})`);
}

/** §5.6 bước 4–5 · trạng thái job + đã `queued` quá `maxWaitS` chưa (đồng hồ DB, cùng gốc `created_at`). */
export async function readJob(
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
      queueExpired: sql<boolean>`${jobs.createdAt} <= now() - make_interval(secs => ${maxWaitS})`,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  return row;
}

/** Token của job (Runtime ghi `usage_logs` cùng transaction kết thúc); chưa có → 0. */
export async function jobUsage(
  tx: Tx,
  jobId: string,
): Promise<{ input_tokens: number; output_tokens: number }> {
  const rows = await tx.execute<{ input_tokens: number; output_tokens: number }>(
    sql`select input_tokens::int as input_tokens, output_tokens::int as output_tokens
      from hub.usage_logs where job_id = ${jobId} limit 1`,
  );
  return rows[0] ?? { input_tokens: 0, output_tokens: 0 };
}

/**
 * Đầu vào `queueTimeoutReason`: số job subscription `running` của tenant + `max_concurrent_sub` (chỉ khi provider của
 * job là subscription; khác → null, slot tenant không áp).
 */
export async function slotCounts(
  tx: Tx,
  p: { tenantId: string; providerKey: string },
): Promise<{ tenantRunning: number; tenantLimit: number | null }> {
  const rows = await tx.execute<{ running: number; lim: number | null }>(
    sql`select
      (select count(*)::int from hub.jobs r join hub.providers rp on rp.key = r.provider_key
        where r.status = 'running' and r.tenant_id = ${p.tenantId} and rp.kind = 'subscription') as running,
      (select t.max_concurrent_sub from admin.tenants t
        where t.id = ${p.tenantId}
          and exists (select 1 from hub.providers pp where pp.key = ${p.providerKey} and pp.kind = 'subscription')) as lim`,
  );
  const r = rows[0];
  return { tenantRunning: r?.running ?? 0, tenantLimit: r?.lim ?? null };
}

/** §5.6 bước 5 (nguyên văn plan): 0 dòng = Runtime vừa claim. Chỉ Hub hết hạn job `queued` (plan-db §8 R11). */
export async function expireQueued(tx: Tx, jobId: string, reason: string): Promise<boolean> {
  const rows = await tx.execute(
    sql`UPDATE hub.jobs SET status = 'failed', error_code = 'ALL_PROVIDERS_EXHAUSTED', error_reason = ${reason},
      finished_at = now() WHERE id = ${jobId} AND status = 'queued' RETURNING id`,
  );
  return rows.length > 0;
}

/** Kết thúc step của job; `detail` giữ bản gốc lỗi Runtime (P11: chỉ ở đây + log, không ra client). */
export async function finishStep(
  tx: Tx,
  p: { stepId: string; runId: string; status: "ok" | "failed"; detail: Record<string, unknown> },
): Promise<{ startedAt: Date; finishedAt: Date } | null> {
  const [row] = await tx
    .update(runSteps)
    .set({ status: p.status, detail: p.detail, finishedAt: NOW_MS })
    .where(
      and(eq(runSteps.id, p.stepId), eq(runSteps.runId, p.runId), eq(runSteps.status, "running")),
    )
    .returning({ startedAt: runSteps.startedAt, finishedAt: runSteps.finishedAt });
  if (!row?.finishedAt) return null;
  return { startedAt: row.startedAt, finishedAt: row.finishedAt };
}
