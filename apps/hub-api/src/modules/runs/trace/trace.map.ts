// HUB-FR-52 · H3b-R18, R49 · hàng DB trace → contract `RunTrace` (plan H3b §5.4 bước 5). Thuần: `detail` qua
// `redactTraceDetail(detail, view)`, `ms` qua `stepMs`, usage gắn theo `step_id`, cắt ≤ 200 + `truncated`.
import {
  type RunTrace,
  type StepUsage,
  TRACE_JOBS_MAX,
  TRACE_STEPS_MAX,
  type TraceJob,
  type TraceMessage,
  type TraceStep,
} from "@ai/contracts/hub-admin";
import type {
  TraceJobRow,
  TraceMessageRow,
  TraceRunRow,
  TraceStepRow,
  TraceUsageRow,
} from "./trace.repo";
import { redactTraceDetail, stepMs } from "./trace.rules";

export type TraceRows = {
  run: TraceRunRow;
  steps: TraceStepRow[];
  jobs: TraceJobRow[];
  usage: TraceUsageRow[];
  messages: TraceMessageRow[];
};

const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());

function usageOf(u: TraceUsageRow): StepUsage {
  return {
    model: u.model,
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    cost_usd: u.costUsd,
    billable_usd: u.billableUsd,
  };
}

const EMPTY_TOTAL = {
  model: null,
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: null,
  billable_usd: null,
} as const;

function stepOf(
  s: TraceStepRow,
  usage: ReadonlyMap<string, StepUsage>,
  view: "own" | "platform",
): TraceStep {
  return {
    id: s.id,
    seq: s.seq,
    type: s.type as TraceStep["type"],
    agent: s.agentId !== null && s.agentKey !== null ? { id: s.agentId, key: s.agentKey } : null,
    workflow_id: s.workflowId,
    provider_key: s.providerKey,
    job_id: s.jobId,
    label_key: s.labelKey,
    status: s.status,
    started_at: s.startedAt.toISOString(),
    finished_at: isoOrNull(s.finishedAt),
    ms: stepMs(s.startedAt, s.finishedAt),
    detail: redactTraceDetail(s.detail, view),
    usage: usage.get(s.id) ?? null,
  };
}

function jobOf(j: TraceJobRow): TraceJob {
  return {
    id: j.id,
    step_id: j.stepId,
    type: j.type,
    provider_key: j.providerKey,
    status: j.status,
    attempts: j.attempts,
    error_code: j.errorCode,
    error_reason: j.errorReason,
    created_at: j.createdAt.toISOString(),
    started_at: isoOrNull(j.startedAt),
    finished_at: isoOrNull(j.finishedAt),
  };
}

function messageOf(rows: readonly TraceMessageRow[], id: string | null): TraceMessage | null {
  const m = id === null ? undefined : rows.find((r) => r.id === id);
  return m ? { id: m.id, content: m.content, created_at: m.createdAt.toISOString() } : null;
}

function runOf(r: TraceRunRow): RunTrace["run"] {
  return {
    id: r.id,
    tenant_id: r.tenantId,
    user_id: r.userId,
    kind: r.kind,
    status: r.status,
    error_code: r.errorCode,
    error_message: r.errorMessage,
    config_version: r.configVersion,
    conversation_id: r.conversationId,
    flow_id: r.flowId,
    tokens_used: r.tokensUsed,
    started_at: r.startedAt.toISOString(),
    finished_at: isoOrNull(r.finishedAt),
  };
}

/** `view` = kết quả `traceAccess` (chỉ `own`/`platform` tới được đây). */
export function toRunTrace(rows: TraceRows, view: "own" | "platform"): RunTrace {
  const byStep = new Map<string, StepUsage>();
  let total: RunTrace["usage_total"] = EMPTY_TOTAL;
  for (const u of rows.usage) {
    if (u.total) total = { ...usageOf(u), model: null };
    else if (u.stepId !== null) byStep.set(u.stepId, usageOf(u));
  }
  return {
    run: runOf(rows.run),
    messages: {
      user: messageOf(rows.messages, rows.run.userMessageId),
      answer: messageOf(rows.messages, rows.run.answerMessageId),
    },
    steps: rows.steps.slice(0, TRACE_STEPS_MAX).map((s) => stepOf(s, byStep, view)),
    jobs: rows.jobs.slice(0, TRACE_JOBS_MAX).map(jobOf),
    usage_total: total,
    truncated: rows.steps.length > TRACE_STEPS_MAX || rows.jobs.length > TRACE_JOBS_MAX,
  };
}
