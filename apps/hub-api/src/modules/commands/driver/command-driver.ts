// HUB-FR-13, HUB-FR-43, HUB-FR-80, HUB-FR-89 · HUB-BR-04 · H2a-R09–R11, R15, R17 · `RunDriver` của run lệnh sync (plan H2a
// §5.1 bước 4, §5.2): step `workflow` (nhãn tĩnh) → app-key ngay trước khi gọi (R17) → Dify streaming, mỗi mẩu chữ →
// `delta` ≤ 40 ký tự → `run.finished`/`run.failed` (`runErrorText` H1). Hạn = `commands.timeout_s` tính từ lúc driver bắt
// đầu; hết hạn → client gọi stop → `TIMEOUT`. Huỷ (E15 abort writer) → client gọi stop; run đã `cancelled` bởi E15.
// Usage `billing=dify` (`log_dify_usage`) khi Dify trả kết quả hoặc đã cấp `task_id`. Không log/ghi app-key: thân lỗi
// upstream đã che (`maskSecret`) chỉ vào `run_steps.detail.upstream`. H2c (B7, P13–P14): lệnh có `files` → upload Dify sau
// `step.started`, trước lời gọi workflow (`command-files.ts`); trace `detail.upload`; lỗi upload ⇒ `run.failed` (plan-errors §4).
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import {
  AttachmentContentMissing,
  AttachmentUnavailable,
  type UploadTrace,
} from "../../attachments/attachment-dify";
import type { RunFile } from "../../attachments/run-files.rules";
import type { AttachmentStorage } from "../../attachments/storage";
import { stepLabel } from "../../conversations/conversations.rules";
import { type CredentialService, isCredentialError } from "../../dify/credential.service";
import type { DifyClient, DifyRunOutcome } from "../../dify/dify.client";
import { difyUser } from "../../dify/dify.rules";
import { recordDifyUsage } from "../../dify/dify.usage";
import { chunkText } from "../../orchestrator/orchestrator.rules";
import type { RunContext, RunDriver } from "../../runs/runs.service";
import type { SseWriter } from "../../runs/sse/sse-writer";
import type { PreparedCommand } from "../commands.service";
import { type CommandFilesResult, uploadCommandFiles } from "./command-files";
import * as repo from "./command-run.repo";

export type CommandDriverDeps = {
  db: Db;
  credentials: Pick<CredentialService, "apiKey">;
  dify: Pick<DifyClient, "runStreaming">;
  log: Logger;
  /** H2c · kho file (`AppDeps.attachments.storage`); vắng/null ⇒ lệnh có file kết thúc `INTERNAL_ERROR` (PL14). */
  storage?: Pick<AttachmentStorage, "blob"> | null;
  /** Test: `fetch` cho Dify `/files/upload`. */
  fetch?: typeof fetch;
};

/** Kết cục một lần chạy: `stopped` = writer đã dừng (huỷ E15 / mất lease) — không kết thúc run ở đây. */
export type Outcome =
  | { kind: "finished"; text: string }
  | { kind: "failed"; code: ChatRunErrorCode; trace: Record<string, unknown>; reason?: string }
  | { kind: "stopped"; trace: Record<string, unknown> };

/** `upload` = trace upload Dify thành công (H2c) — giữ trong `detail` khi đóng step. */
export type Step = { id: string; seq: number; upload?: UploadTrace | null };
type Live = {
  d: CommandDriverDeps;
  p: PreparedCommand;
  writer: SseWriter;
  log: Logger;
  files: readonly RunFile[];
};
/** Phần `Live` mà mở/đóng step cần (dùng chung driver async, B6). */
export type StepLive = { d: { db: Db }; p: PreparedCommand; writer: SseWriter };

/** Phát `delta` tuần tự (callback Dify đồng bộ): nối hàng promise; lỗi phát (fencing) → bỏ, writer tự dừng. */
export class DeltaPipe {
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
export async function openStep(l: StepLive): Promise<Step> {
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
export async function closeStep(l: StepLive, step: Step, o: Outcome): Promise<void> {
  const status = o.kind === "finished" ? "ok" : "failed";
  const detail = {
    ...(l.p.extraTokens > 0 && { extra_tokens: l.p.extraTokens }),
    ...(step.upload && { upload: step.upload }),
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

const INTERNAL: Outcome = {
  kind: "failed",
  code: "INTERNAL_ERROR",
  trace: { code: "INTERNAL_ERROR", reason: null },
};

/**
 * REVIEW 1 Hub #3: ngoại lệ sau khi mở step (DB lấy key, ghi/đóng…) → đóng step `failed INTERNAL_ERROR` (best-effort, như
 * `DifyAgentRunner#execute`) để step không treo `running`. `closeStep` chỉ đổi step còn `running` nên gọi lại vô hại.
 */
export async function failOpenStep(l: StepLive, step: Step | null, log: Logger): Promise<void> {
  if (!step) return;
  await closeStep(l, step, INTERNAL).catch((err) =>
    log.warn("command-step-close-failed", safeErrorFields(err)),
  );
}

/** R15: usage `billing=dify`; lỗi ghi chỉ cảnh báo — Dify đã xong, run không thành `INTERNAL_ERROR` (REVIEW 1 Hub #2). */
async function usageOf(l: Live, step: Step, res: DifyRunOutcome): Promise<void> {
  if (res.kind !== "finished" && res.taskId === null) return;
  const r = l.writer.run;
  try {
    await recordDifyUsage(l.d.db, {
      tenantId: r.tenantId,
      runId: r.id,
      stepId: step.id,
      userId: r.userId,
      featureId: l.p.featureId,
      agentId: null,
      usage: res.usage,
      latencyMs: res.ms,
    });
  } catch (err) {
    l.log.warn("command-usage-failed", safeErrorFields(err));
  }
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

/** App-key ngay trước khi dùng (R17); thiếu/hỏng → kết cục `NOT_CONFIGURED`. */
export async function workflowKey(
  credentials: Pick<CredentialService, "apiKey">,
  workflowId: string,
): Promise<string | Outcome> {
  try {
    return await credentials.apiKey(workflowId);
  } catch (err) {
    if (!isCredentialError(err)) throw err;
    return {
      kind: "failed",
      code: "NOT_CONFIGURED",
      trace: { code: err.code, reason: err.reason },
    };
  }
}

/** Upload lỗi/abort → kết cục run (plan-errors §4); `aborted` do hạn (writer còn sống) → `TIMEOUT`. */
export function fileOutcome(
  r: Exclude<CommandFilesResult, { kind: "ok" }>,
  timedOut: boolean,
): Outcome {
  if (r.kind === "failed")
    return { kind: "failed", code: r.code, trace: r.trace, reason: r.reason };
  const trace = { upload: r.upload };
  if (timedOut)
    return {
      kind: "failed",
      code: "TIMEOUT",
      trace: { code: "TIMEOUT", reason: "timeout", ...trace },
    };
  return { kind: "stopped", trace: { code: "CANCELLED", reason: "cancelled", ...trace } };
}

/** Gọi Dify trong hạn `timeout_s` (file lệnh upload trước — H2c); ghi usage (R15) khi có kết quả hoặc đã có `task_id`. */
async function callDify(
  l: Live,
  step: Step,
  pipe: DeltaPipe,
  timeout: AbortSignal,
): Promise<Outcome> {
  const { p, writer } = l;
  const r = writer.run;
  const apiKey = await workflowKey(l.d.credentials, p.workflow.id);
  if (typeof apiKey !== "string") return apiKey;
  const signal = AbortSignal.any([writer.signal, timeout]);
  const user = difyUser(p.tenantKey, r.userId);
  const files = await uploadCommandFiles(
    { storage: l.d.storage ?? null, db: l.d.db, fetch: l.d.fetch, log: l.log },
    { p, files: l.files, tenantId: r.tenantId, apiKey, user },
    signal,
  );
  if (files.kind !== "ok") return fileOutcome(files, timeout.aborted && !writer.signal.aborted);
  step.upload = files.upload;
  const req = {
    appType: p.workflow.appType,
    baseUrl: p.workflow.baseUrl,
    apiKey,
    inputs: files.inputs,
    query: p.query,
    user,
    conversationId: null,
    outputField: p.command.output.field,
  };
  const res = await l.d.dify.runStreaming(req, signal, (t) => pipe.push(t));
  await pipe.flushed();
  await usageOf(l, step, res);
  return outcomeOf(res, timeout.aborted && !writer.signal.aborted);
}

/** Lỗi bất ngờ của driver → log (nội dung file mất ⇒ `attachment-content-missing`, plan-errors §5). */
export function logDriverError(log: Logger, err: unknown): void {
  if (err instanceof AttachmentUnavailable)
    log.info("attachment-unavailable", { attachment_id: err.attachmentId });
  else if (err instanceof AttachmentContentMissing)
    log.error("attachment-content-missing", { attachment_id: err.attachmentId });
  else log.error("command-run-failed", safeErrorFields(err));
}

/** `run.finished` (mk không chunk → phát `delta` từ `outputs`) / `run.failed`; `stopped` → không ghi. */
export async function deliver(
  l: Pick<StepLive, "writer">,
  pipe: DeltaPipe,
  o: Outcome,
): Promise<void> {
  if (o.kind === "stopped") return;
  if (o.kind === "failed") {
    await l.writer.finish({ kind: "failed", code: o.code, reason: o.reason ?? null });
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
  const l: Live = { d, p, writer, log, files: ctx.files };
  const timeout = AbortSignal.timeout(p.command.timeoutS * 1000);
  let open: Step | null = null;
  try {
    const step = await openStep(l);
    open = step;
    const pipe = new DeltaPipe(writer);
    const o = await callDify(l, step, pipe, timeout);
    await closeStep(l, step, o);
    open = null;
    const code = o.kind === "finished" ? null : o.kind === "failed" ? o.code : "CANCELLED";
    log.info("command-run", { command_id: p.command.id, workflow_id: p.workflow.id, code });
    await deliver(l, pipe, o);
  } catch (err) {
    await failOpenStep(l, open, log);
    if (writer.signal.aborted || writer.done) return;
    logDriverError(log, err);
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
