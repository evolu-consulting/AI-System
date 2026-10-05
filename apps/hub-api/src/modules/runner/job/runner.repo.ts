// HUB-FR-89 · HUB-FR-24 · SQL của AgentRunner (plan H1 §5.6, plan-db §3.3). Gọi trong `withHubScope(system)` (việc nền
// của chủ run); `hub.jobs`/`provider_state` không RLS. Thứ tự khoá §3.5: runs → run_steps → jobs.
import { type AgentCliJob, JOB_ENQUEUED_CHANNEL, type JobEnqueuedPayload } from "@ai/contracts/hub";
import type { Tx } from "@ai/db";
import { jobs, providerState, runSteps } from "@ai/db/schema/hub";
import { and, eq, sql } from "drizzle-orm";
import { insertStep } from "../../../lib/run-steps";
import type { JobRow } from "../runner.rules";

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
  type: "orchestrator" | "delegate";
  labelKey: string;
  /** Step đã có (thử lại cùng step): mở lại `running` với job mới thay vì INSERT. */
  reopen?: boolean;
};

/**
 * §5.6 bước 2 · `runs FOR SHARE` (còn `running` và còn của `owner`, P12/H1-R14) → `run_steps` (running) → `INSERT
 * hub.jobs` → `pg_notify('job_enqueued')` cùng transaction: NOTIFY chỉ giao khi COMMIT nên Runtime nhận NOTIFY là thấy
 * dòng job. Run đã bị huỷ/sweeper đóng → false, không ghi gì (job mới sẽ chạy tới timeout giữ slot). `FOR SHARE` chặn
 * huỷ/kết thúc (`UPDATE runs`) tới COMMIT ⇒ job vừa INSERT luôn được `cancelJobs` của bên đóng nhìn thấy.
 * Trả `seq` của step (P11: DB cấp; SSE `step_id = s<seq>`), null = không ghi.
 */
export async function enqueueJob(
  tx: Tx,
  p: AgentCliJob,
  step: StepInsert & { owner: string },
): Promise<number | null> {
  const live = await tx.execute(sql`select 1 from hub.runs
    where id = ${p.run_id} and status = 'running' and owner = ${step.owner} for share`);
  if (live.length === 0) return null;
  const seq = step.reopen
    ? await reopenStep(tx, p, step.stepId)
    : await insertStep(tx, {
        id: step.stepId,
        tenantId: p.tenant_id,
        userId: p.user_id,
        runId: p.run_id,
        type: step.type,
        agentId: p.agent.id,
        providerKey: p.provider_key,
        jobId: p.job_id,
        workflowId: null,
        labelKey: step.labelKey,
        status: "running",
        detail: null,
      });
  if (seq === null) return null;
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
  return seq;
}

/** Thử lại cùng step: trỏ sang job mới, `running` lại (giữ `started_at`, `seq`). Không có step → null. */
async function reopenStep(tx: Tx, p: AgentCliJob, stepId: string): Promise<number | null> {
  const [row] = await tx
    .update(runSteps)
    .set({ jobId: p.job_id, status: "running", finishedAt: null })
    .where(and(eq(runSteps.id, stepId), eq(runSteps.runId, p.run_id)))
    .returning({ seq: runSteps.seq });
  return row?.seq ?? null;
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

export type OrphanJob = { id: string; runId: string };

/** Ngưỡng orphan phía Hub (giây), dùng chung câu requeue H2a và câu `failed` H1 (plan-db H2a §2: Hub `$1 = 60`). */
export const ORPHAN_S = 60;

/**
 * plan-db H2a §2 "Requeue orphan" (nguyên văn, chạy **trước** `sweepOrphanJobs` cùng lượt): job `workflow.async` mất
 * heartbeat, `attempts < 3`, chưa huỷ, không (`side_effect` ∧ đã gửi Dify) → `queued` (xoá token/worker, `queued_at` mới)
 * + `pg_notify('job_enqueued')` mỗi dòng (giao khi COMMIT). Không XADD: job chưa kết thúc (R13, AC-W06).
 */
export async function requeueOrphanJobs(tx: Tx): Promise<OrphanJob[]> {
  const rows = await tx.execute<{
    id: string;
    run_id: string;
  }>(sql`UPDATE hub.jobs SET status = 'queued',
    worker_id = NULL, pgid = NULL, heartbeat_at = NULL, started_at = NULL,
    token_hash = NULL, dispatched_at = NULL, queued_at = now()
    WHERE status = 'running' AND type = 'workflow.async' AND heartbeat_at < now() - make_interval(secs => ${ORPHAN_S})
      AND attempts < 3 AND cancel_requested_at IS NULL
      AND NOT (coalesce((payload->>'side_effect')::boolean, false) AND dispatched_at IS NOT NULL)
    RETURNING id, run_id, worker_id, pgid`);
  const out = [...rows].map((r) => ({ id: r.id, runId: r.run_id }));
  for (const j of out) {
    const note: JobEnqueuedPayload = { v: 1, job_id: j.id, provider_key: "dify" };
    await tx.execute(sql`select pg_notify(${JOB_ENQUEUED_CHANNEL}, ${JSON.stringify(note)})`);
  }
  return out;
}

/**
 * plan-db §5.5 (nguyên văn, Hub và Runtime cùng chạy): job `running` mất heartbeat > `ORPHAN_S` → `failed` `orphaned`.
 * Chỉ bên nhận dòng trong `RETURNING` phát `job.failed`.
 */
export async function sweepOrphanJobs(tx: Tx): Promise<OrphanJob[]> {
  const rows = await tx.execute<{
    id: string;
    run_id: string;
  }>(sql`UPDATE hub.jobs SET status = 'failed',
    error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now()
    WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => ${ORPHAN_S})
    RETURNING id, run_id, worker_id, pgid`);
  return [...rows].map((r) => ({ id: r.id, runId: r.run_id }));
}
