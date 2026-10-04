// HUB-FR-13, HUB-FR-43, HUB-FR-89 · WRK-FR-07 · H2a-R12, R13 · P9, P10, P13 · `RunDriver` của run lệnh `mode=async` (plan H2a
// §5.3): `WorkflowJobRunner` (provider `dify` tắt/thiếu → `NOT_CONFIGURED`, không job; có → step
// `workflow` + job `workflow.async` một transaction, `step.started` ngay sau COMMIT) → `job.result{text}` → `delta` ≤ 40 →
// `run.finished`; `job.failed` → `run.failed <code>`. Hạn = `commands.timeout_s` tính từ lúc driver bắt đầu (≈ tạo run), giữ
// qua mọi lần requeue: hết hạn → `run.failed TIMEOUT` (`SseWriter.finish` huỷ job như E15: `cancel_requested_at` + NOTIFY
// `job_cancel`). Huỷ E15 / mất lease → chỉ đóng step. Payload không chứa secret/URL/token (Runtime lấy key qua Q5).
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { stepLabel } from "../conversations/conversations.rules";
import { difyUser } from "../dify/dify.rules";
import { buildWorkflowJobPayload } from "../runner/runner.rules";
import type { WorkflowJobOutcome, WorkflowJobRunner } from "../runner/workflow-job-runner";
import type { RunContext, RunDriver } from "../runs/runs.service";
import { closeStep, DeltaPipe, deliver, type Outcome, type StepLive } from "./command-driver";
import type { PreparedCommand } from "./commands.service";

export type AsyncCommandDriverDeps = {
  db: Db;
  jobs: Pick<WorkflowJobRunner, "run">;
  log: Logger;
};

/** Kết cục runner → kết cục run. `aborted` do hạn (writer còn sống) → `TIMEOUT`; còn lại = huỷ/mất lease. */
export function asyncOutcome(o: WorkflowJobOutcome, timedOut: boolean): Outcome {
  if (o.kind === "result") return { kind: "finished", text: o.text };
  if (o.kind === "failed") return { kind: "failed", code: o.code, trace: o.trace };
  if (timedOut)
    return { kind: "failed", code: "TIMEOUT", trace: { code: "TIMEOUT", reason: "timeout" } };
  return { kind: "stopped", trace: { code: "CANCELLED", reason: "cancelled" } };
}

/** Job `workflow.async` tới kết cục, đóng step. null = không enqueue (run đã đóng / không còn của mình). */
async function runJob(
  d: AsyncCommandDriverDeps,
  l: StepLive,
  timeout: AbortSignal,
): Promise<Outcome | null> {
  const { p, writer } = l;
  const r = writer.run;
  const payload = buildWorkflowJobPayload({
    jobId: crypto.randomUUID(),
    runId: r.id,
    stepId: crypto.randomUUID(),
    tenantId: r.tenantId,
    userId: r.userId,
    conversationId: r.conversationId,
    flowId: r.flowId,
    featureId: p.featureId,
    commandId: p.command.id,
    workflow: p.workflow,
    inputs: p.inputs,
    query: p.query,
    outputField: p.command.output.field,
    difyUser: difyUser(p.tenantKey, r.userId),
    timeoutS: p.command.timeoutS,
  });
  const onEnqueued = async (seq: number) => {
    const data = { step_id: `s${seq}`, label: stepLabel("workflow", r.locale) };
    await writer.emit({ event: "step.started", data }).catch(() => {});
  };
  const stepDetail = p.extraTokens > 0 ? { extra_tokens: p.extraTokens } : null;
  const signal = AbortSignal.any([writer.signal, timeout]);
  const res = await d.jobs.run({ payload, stepDetail, onEnqueued }, signal);
  if (res.kind === "not_enqueued") return null;
  const o = asyncOutcome(res, timeout.aborted && !writer.signal.aborted);
  await closeStep(l, { id: payload.step_id, seq: res.seq }, o);
  return o;
}

export async function driveAsyncCommand(
  d: AsyncCommandDriverDeps,
  p: PreparedCommand,
  ctx: RunContext,
): Promise<void> {
  const { writer } = ctx;
  const r = writer.run;
  const log = ctx.log.child({ run_id: r.id, tenant_id: r.tenantId, user_id: r.userId });
  const l: StepLive = { d, p, writer };
  const timeout = AbortSignal.timeout(p.command.timeoutS * 1000);
  try {
    const o = await runJob(d, l, timeout);
    if (!o) return;
    const code = o.kind === "finished" ? null : o.kind === "failed" ? o.code : "CANCELLED";
    log.info("command-run", { command_id: p.command.id, workflow_id: p.workflow.id, code });
    await deliver(l, new DeltaPipe(writer), o);
  } catch (err) {
    if (writer.signal.aborted || writer.done) return;
    log.error("command-run-failed", safeErrorFields(err));
    await writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" });
  } finally {
    if (!writer.done) writer.abort();
  }
}

/** `RunDriver` cho một lệnh async đã chuẩn bị (snapshot R08): chạy nền, tự kết thúc run. */
export function asyncCommandDriver(d: AsyncCommandDriverDeps, p: PreparedCommand): RunDriver {
  return {
    start: (ctx) => {
      void driveAsyncCommand(d, p, ctx);
    },
  };
}
