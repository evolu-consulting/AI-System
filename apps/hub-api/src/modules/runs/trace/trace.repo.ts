// HUB-FR-52 · HUB-FR-87 · H3b-R17–R19 · SQL `GET /runs/:id/trace` (plan-db H3b §5, nguyên văn). Transaction + scope
// do service mở. `TRACE_RUN` lọc chủ (`tenant_id, user_id`) khi có `owner` (scope user, như `runs.repo.findRun`); mọi
// câu sau lọc `tenant_id = run.tenant_id` (K10: hàng cùng run_id nhưng tenant khác không lọt — A100). Không đọc
// `jobs.payload/result/token_hash/error_message` (R18).

import { TRACE_JOBS_MAX, TRACE_STEPS_MAX } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

export type Owner = { tenantId: string; userId: string };
/** postgres.js qua Drizzle trả timestamptz dạng chuỗi (parser trong suốt) — chuẩn hoá ở đây. */
type Ts = Date | string;

export type TraceRunRow = {
  id: string;
  tenantId: string;
  userId: string;
  kind: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  configVersion: number;
  conversationId: string;
  flowId: string;
  userMessageId: string | null;
  answerMessageId: string | null;
  tokensUsed: number;
  startedAt: Date;
  finishedAt: Date | null;
};

export type TraceStepRow = {
  id: string;
  seq: number;
  type: string;
  agentId: string | null;
  agentKey: string | null;
  workflowId: string | null;
  providerKey: string | null;
  jobId: string | null;
  labelKey: string;
  status: string;
  detail: unknown;
  startedAt: Date;
  finishedAt: Date | null;
};

export type TraceJobRow = {
  id: string;
  stepId: string;
  type: string;
  providerKey: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  errorReason: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

/** `stepId` null + `total` true = dòng tổng mọi hàng của run (gồm dòng `step_id` NULL). */
export type TraceUsageRow = {
  stepId: string | null;
  total: boolean;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string | null;
  billableUsd: string | null;
};

export type TraceMessageRow = { id: string; content: string; createdAt: Date };

const toDate = (v: Ts): Date => (v instanceof Date ? v : new Date(v));
const toDateOrNull = (v: Ts | null): Date | null => (v === null ? null : toDate(v));

/** TRACE_RUN — PK; `owner` có ⇒ thêm điều kiện chủ (nhánh a), vắng ⇒ scope system (nhánh b, sau `traceAccess`). */
export async function traceRun(
  tx: Tx,
  id: string,
  owner: Owner | null,
): Promise<TraceRunRow | null> {
  const own: SQL = owner
    ? sql` and tenant_id = ${owner.tenantId} and user_id = ${owner.userId}`
    : sql``;
  const [r] = await tx.execute<
    Record<string, unknown>
  >(sql`select id, tenant_id, user_id, kind, status, error_code,
      error_message, config_version, conversation_id, flow_id, user_message_id, answer_message_id, tokens_used,
      started_at, finished_at
    from hub.runs where id = ${id}${own}`);
  if (!r) return null;
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    userId: r.user_id as string,
    kind: r.kind as string,
    status: r.status as string,
    errorCode: r.error_code as string | null,
    errorMessage: r.error_message as string | null,
    configVersion: Number(r.config_version),
    conversationId: r.conversation_id as string,
    flowId: r.flow_id as string,
    userMessageId: r.user_message_id as string | null,
    answerMessageId: r.answer_message_id as string | null,
    tokensUsed: Number(r.tokens_used),
    startedAt: toDate(r.started_at as Ts),
    finishedAt: toDateOrNull(r.finished_at as Ts | null),
  };
}

/** TRACE_STEPS — `LIMIT 201` để biết `truncated` (index `run_steps_run_seq_uq`). */
export async function traceSteps(tx: Tx, runId: string, tenantId: string): Promise<TraceStepRow[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`select s.id, s.seq, s.type, s.agent_id,
      a.key as agent_key, s.workflow_id, s.provider_key, s.job_id, s.label_key, s.status, s.detail, s.started_at,
      s.finished_at
    from hub.run_steps s left join hub.agents a on a.id = s.agent_id
    where s.run_id = ${runId} and s.tenant_id = ${tenantId}
    order by s.seq limit ${TRACE_STEPS_MAX + 1}`);
  return rows.map((r) => ({
    id: r.id as string,
    seq: Number(r.seq),
    type: r.type as string,
    agentId: r.agent_id as string | null,
    agentKey: r.agent_key as string | null,
    workflowId: r.workflow_id as string | null,
    providerKey: r.provider_key as string | null,
    jobId: r.job_id as string | null,
    labelKey: r.label_key as string,
    status: r.status as string,
    detail: r.detail,
    startedAt: toDate(r.started_at as Ts),
    finishedAt: toDateOrNull(r.finished_at as Ts | null),
  }));
}

/** TRACE_JOBS — `LIMIT 201` (index `jobs_run_idx`); KHÔNG `payload`, `result`, `token_hash`, `error_message`. */
export async function traceJobs(tx: Tx, runId: string, tenantId: string): Promise<TraceJobRow[]> {
  const rows = await tx.execute<
    Record<string, unknown>
  >(sql`select id, step_id, type, provider_key, status,
      attempts, error_code, error_reason, created_at, started_at, finished_at
    from hub.jobs where run_id = ${runId} and tenant_id = ${tenantId}
    order by created_at, id limit ${TRACE_JOBS_MAX + 1}`);
  return rows.map((r) => ({
    id: r.id as string,
    stepId: r.step_id as string,
    type: r.type as string,
    providerKey: r.provider_key as string,
    status: r.status as string,
    attempts: Number(r.attempts),
    errorCode: r.error_code as string | null,
    errorReason: r.error_reason as string | null,
    createdAt: toDate(r.created_at as Ts),
    startedAt: toDateOrNull(r.started_at as Ts | null),
    finishedAt: toDateOrNull(r.finished_at as Ts | null),
  }));
}

/**
 * TRACE_USAGE — theo step + dòng tổng (`grouping sets`, một lần quét `usage_logs_run_idx`). Tiền chỉ có khi MỌI hàng
 * của nhóm có giá (NULL = "chưa định giá", không cộng thiếu).
 */
export async function traceUsage(
  tx: Tx,
  runId: string,
  tenantId: string,
): Promise<TraceUsageRow[]> {
  const rows = await tx.execute<
    Record<string, unknown>
  >(sql`select step_id, grouping(step_id) = 1 as total,
      max(model) as model, coalesce(sum(input_tokens), 0)::int as input_tokens,
      coalesce(sum(output_tokens), 0)::int as output_tokens,
      case when count(cost_usd) = count(*) then sum(cost_usd)::text end as cost_usd,
      case when count(billable_usd) = count(*) then sum(billable_usd)::text end as billable_usd
    from hub.usage_logs where run_id = ${runId} and tenant_id = ${tenantId}
    group by grouping sets ((step_id), ())`);
  return rows.map((r) => ({
    stepId: r.step_id as string | null,
    total: r.total === true,
    model: r.model as string | null,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    costUsd: r.cost_usd as string | null,
    billableUsd: r.billable_usd as string | null,
  }));
}

/** TRACE_MESSAGES — tin user + câu trả lời của run (PK). */
export async function traceMessages(
  tx: Tx,
  tenantId: string,
  ids: readonly (string | null)[],
): Promise<TraceMessageRow[]> {
  const want = ids.filter((v): v is string => v !== null);
  if (want.length === 0) return [];
  const rows = await tx.execute<Record<string, unknown>>(sql`select id, content, created_at
    from hub.messages
    where tenant_id = ${tenantId} and id in (${sql.join(
      want.map((v) => sql`${v}::uuid`),
      sql`, `,
    )})`);
  return rows.map((r) => ({
    id: r.id as string,
    content: r.content as string,
    createdAt: toDate(r.created_at as Ts),
  }));
}

/** Tên đăng nhập của người xem cho hàng audit (actor có thể khác tenant run — chỉ lấy `username`). */
export async function actorUsername(tx: Tx, userId: string): Promise<string | null> {
  const [r] = await tx.execute<{ username: string }>(
    sql`select username from admin.users where id = ${userId}`,
  );
  return r?.username ?? null;
}
