// HUB-FR-13, HUB-FR-43, HUB-FR-80, HUB-FR-89 · HUB-BR-04 · H2a-R09–R11, R15, R17 · `RunDriver` của run lệnh sync (plan H2a
// §5.1 bước 4, §5.2): step `workflow` (nhãn tĩnh) → app-key ngay trước khi gọi (R17) → Dify streaming, mỗi mẩu chữ →
// `delta` ≤ 40 ký tự → `run.finished`/`run.failed` (`runErrorText` H1). Hạn = `commands.timeout_s` tính từ lúc driver bắt
// đầu; hết hạn → client gọi stop → `TIMEOUT`. Huỷ (E15 abort writer) → client gọi stop; run đã `cancelled` bởi E15.
// Usage `billing=dify` (`log_dify_usage`) khi Dify trả kết quả hoặc đã cấp `task_id`. Không log/ghi app-key: thân lỗi
// upstream đã che (`maskSecret`) chỉ vào `run_steps.detail.upstream`.
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { stepLabel } from "../conversations/conversations.rules";
import { type CredentialService, isCredentialError } from "../dify/credential.service";
import type { DifyClient, DifyRunOutcome } from "../dify/dify.client";
import { difyUser } from "../dify/dify.rules";
import { recordDifyUsage } from "../dify/dify.usage";
import { chunkText } from "../orchestrator/orchestrator.rules";
import type { RunContext, RunDriver } from "../runs/runs.service";
import type { SseWriter } from "../runs/sse/sse-writer";
import * as repo from "./command-run.repo";
import type { PreparedCommand } from "./commands.service";

export type CommandDriverDeps = {
  db: Db;
  credentials: Pick<CredentialService, "apiKey">;
  dify: Pick<DifyClient, "runStreaming">;
  log: Logger;
};

/** Kết cục một lần chạy: `stopped` = writer đã dừng (huỷ E15 / mất lease) — không kết thúc run ở đây. */
type Outcome =
  | { kind: "finished"; text: string }
  | { kind: "failed"; code: ChatRunErrorCode; trace: Record<string, unknown> }
  | { kind: "stopped"; trace: Record<string, unknown> };

type Step = { id: string; seq: number };
type Live = { d: CommandDriverDeps; p: PreparedCommand; writer: SseWriter; log: Logger };

/** Phát `delta` tuần tự (callback Dify đồng bộ): nối hàng promise; lỗi phát (fencing) → bỏ, writer tự dừng. */
class DeltaPipe {
  #chain: Promise<void> = Promise.resolve();
  sent = "";
  constructor(private readonly writer: SseWriter) {}

  push(text: string): void {
    this.sent += text;
    this.#chain = this.#chain.then(() => this.#emit(text));
  }
  async #emit(text: string): Promise<void> {
    for (const part of chunkText(text)) {
      if (this.writer.done) return;
      await this.writer.emit({ event: "delta", data: { text: part } }).catch(() => {});
    }
  }
  flushed(): Promise<void> {
    return this.#chain;
  }
}

function system<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withHubScope(db, { kind: "system" }, fn);
}

/** Step `workflow` `running` + `step.started` (nhãn theo `runs.locale`, không tên/key workflow — R09). */
async function openStep(l: Live): Promise<Step> {
  const r = l.writer.run;
  const id = crypto.randomUUID();
  const detail = l.p.extraTokens > 0 ? { extra_tokens: l.p.extraTokens } : null;
  const seq = await system(l.d.db, (tx) =>
    repo.openWorkflowStep(tx, {
      id,
      runId: r.id,
      tenantId: r.tenantId,
      userId: r.userId,
      workflowId: l.p.workflow.id,
      detail,
    }),
  );
  // Writer đã dừng (huỷ ngay sau tạo run) → vẫn đi tiếp: client Dify thấy `signal` đã abort, step đóng `failed`.
  await l.writer
    .emit({
      event: "step.started",
      data: { step_id: `s${seq}`, label: stepLabel("workflow", r.locale) },
    })
    .catch(() => {});
  return { id, seq };
}

/** Kết thúc step + `step.finished` (bỏ phát khi writer đã dừng). */
async function closeStep(l: Live, step: Step, o: Outcome): Promise<void> {
  const status = o.kind === "finished" ? "ok" : "failed";
  const detail = {
    ...(l.p.extraTokens > 0 && { extra_tokens: l.p.extraTokens }),
    ...(o.kind !== "finished" && o.trace),
  };
  const r = l.writer.run;
  const t = await system(l.d.db, (tx) =>
    repo.closeWorkflowStep(tx, { id: step.id, runId: r.id, status, detail }),
  );
  if (!t || l.writer.done) return;
  const ms = Math.max(0, t.finishedAt.getTime() - t.startedAt.getTime());
  await l.writer
    .emit({ event: "step.finished", data: { step_id: `s${step.seq}`, status, ms } })
    .catch(() => {});
}

/** Kết quả client Dify → kết cục run (plan-errors §2). `timedOut` chỉ xét khi client trả `aborted`. */
function outcomeOf(res: DifyRunOutcome, timedOut: boolean): Outcome {
  if (res.kind === "finished") return { kind: "finished", text: res.text };
  if (res.kind === "failed") {
    const trace = { code: res.code, reason: res.reason, http_status: res.httpStatus };
    return { kind: "failed", code: res.code, trace: { ...trace, upstream: res.detail } };
  }
  if (timedOut)
    return { kind: "failed", code: "TIMEOUT", trace: { code: "TIMEOUT", reason: "timeout" } };
  return { kind: "stopped", trace: { code: "CANCELLED", reason: "cancelled" } };
}

/** Gọi Dify trong hạn `timeout_s`; ghi usage (R15) khi có kết quả hoặc đã có `task_id`. */
async function callDify(
  l: Live,
  step: Step,
  pipe: DeltaPipe,
  timeout: AbortSignal,
): Promise<Outcome> {
  const { p, writer } = l;
  const r = writer.run;
  let apiKey: string;
  try {
    apiKey = await l.d.credentials.apiKey(p.workflow.id);
  } catch (err) {
    if (!isCredentialError(err)) throw err;
    return {
      kind: "failed",
      code: "NOT_CONFIGURED",
      trace: { code: err.code, reason: err.reason },
    };
  }
  const signal = AbortSignal.any([writer.signal, timeout]);
  const req = {
    appType: p.workflow.appType,
    baseUrl: p.workflow.baseUrl,
    apiKey,
    inputs: p.inputs,
    query: p.query,
    user: difyUser(p.tenantKey, r.userId),
    conversationId: null,
    outputField: p.command.output.field,
  };
  const res = await l.d.dify.runStreaming(req, signal, (t) => pipe.push(t));
  await pipe.flushed();
  if (res.kind === "finished" || res.taskId !== null) {
    const usage = { tenantId: r.tenantId, runId: r.id, stepId: step.id, userId: r.userId };
    await recordDifyUsage(l.d.db, {
      ...usage,
      featureId: p.featureId,
      agentId: null,
      usage: res.usage,
      latencyMs: res.ms,
    });
  }
  return outcomeOf(res, timeout.aborted && !writer.signal.aborted);
}

/** `run.finished` (mk không chunk → phát `delta` từ `outputs`) / `run.failed`; `stopped` → không ghi. */
async function deliver(l: Live, pipe: DeltaPipe, o: Outcome): Promise<void> {
  if (o.kind === "stopped") return;
  if (o.kind === "failed") {
    await l.writer.finish({ kind: "failed", code: o.code });
    return;
  }
  if (pipe.sent.length === 0) pipe.push(o.text);
  await pipe.flushed();
  await l.writer.finish({ kind: "finished", content: o.text });
}

export async function driveCommand(
  d: CommandDriverDeps,
  p: PreparedCommand,
  ctx: RunContext,
): Promise<void> {
  const { writer } = ctx;
  const r = writer.run;
  const log = ctx.log.child({ run_id: r.id, tenant_id: r.tenantId, user_id: r.userId });
  const l: Live = { d, p, writer, log };
  const timeout = AbortSignal.timeout(p.command.timeoutS * 1000);
  try {
    const step = await openStep(l);
    const pipe = new DeltaPipe(writer);
    const o = await callDify(l, step, pipe, timeout);
    await closeStep(l, step, o);
    const code = o.kind === "finished" ? null : o.kind === "failed" ? o.code : "CANCELLED";
    log.info("command-run", { command_id: p.command.id, workflow_id: p.workflow.id, code });
    await deliver(l, pipe, o);
  } catch (err) {
    if (writer.signal.aborted || writer.done) return;
    log.error("command-run-failed", safeErrorFields(err));
    await writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" });
  } finally {
    if (!writer.done) writer.abort();
  }
}

/** `RunDriver` cho một lệnh sync đã chuẩn bị (snapshot R08): chạy nền, tự kết thúc run. */
export function commandDriver(d: CommandDriverDeps, p: PreparedCommand): RunDriver {
  return {
    start: (ctx) => {
      void driveCommand(d, p, ctx);
    },
  };
}
