// HUB-FR-50, HUB-FR-95, HUB-FR-146 · H2a-R20, R22 · H2c P14 · P-d2 D2-02/D2-27 (T18s, tách từ `mcp.service.ts`, không đổi
// hành vi): pipeline gọi một workflow Dify của `tools/call` — lấy key → bước `tool` `running` → (upload file) → Dify gom
// trong hạn `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)` → kết thúc bước + usage `billing=dify`. 4 câu/lời gọi (D2-27),
// mỗi câu tx ngắn riêng; không giữ tx trong lúc gọi mạng. Không bao giờ log token/app-key/tham số.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import { AttachmentContentMissing, type UploadTrace } from "../../attachments/attachment-dify";
import type { AttachmentStorage } from "../../attachments/storage";
import type { CatalogWorkflow, WorkflowInputValue } from "../../commands/catalog.types";
import { tenantKeyOf } from "../../config/catalog.rules";
import type { ConfigCache } from "../../config/config.service";
import { type CredentialService, isCredentialError } from "../../dify/credential.service";
import type { DifyClient, DifyRunOutcome } from "../../dify/dify.client";
import { difyUser, maskInputs } from "../../dify/dify.rules";
import { recordDifyUsage } from "../../dify/dify.usage";
import * as repo from "../mcp.repo";
import { type ToolResult, toolError, toolText, toolTimeoutS } from "../mcp.rules";
import { type StepCode, stepCodeOf } from "../mcp-call";
import { type ToolFile, type ToolUploadResult, uploadToolFiles } from "../mcp-files";

/** Ai gọi (phần `McpContext` pipeline cần): bước `tool` + usage ghi vào run này, hạn theo agent này. */
export type InvokeCaller = { tenantId: string; userId: string; runId: string; agentId: string };
export type ToolArgs = {
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  files: readonly ToolFile[];
};
/** Trace thêm vào `detail` bước `tool` (R22: `confirmation: "consumed"`; H2c: `upload` + lỗi upload). */
export type StepTrace = { confirmation?: "consumed"; upload?: UploadTrace } & Record<
  string,
  unknown
>;
/** Một lời gọi tool; `signal` = kết nối `/mcp` của request (đóng = huỷ run → abort Dify + stop). */
export type ToolCall = { ctx: InvokeCaller; wf: CatalogWorkflow; signal?: AbortSignal };

/** Cổng gọi workflow (D2-02): cùng pipeline `/mcp`, dùng chung cho `McpService` và executor `tool` (T18). */
export type WorkflowInvoker = {
  run(call: ToolCall, args: ToolArgs, trace: StepTrace): Promise<ToolResult>;
};

export type WorkflowInvokerDeps = {
  db: Db;
  config: ConfigCache;
  credentials: CredentialService;
  dify: DifyClient;
  /** = `HUB_DIFY_TIMEOUT_MAX_S`. */
  difyTimeoutMaxS: number;
  log: Logger;
  /** H2c · kho file (`AppDeps.attachments.storage`); vắng/null ⇒ tool có file ném `AttachmentContentMissing` (-32603). */
  storage?: Pick<AttachmentStorage, "blob"> | null;
  /** Test: `fetch` cho Dify `/files/upload`. */
  fetch?: typeof fetch;
};

type Invoke = {
  args: ToolArgs;
  trace: StepTrace;
  apiKey: string;
  stepId: string;
  inputs: Record<string, string>;
};
type FinishDetail = StepTrace & {
  inputs: Record<string, string>;
  code: StepCode | null;
  upstream?: string;
};

export class DifyWorkflowInvoker implements WorkflowInvoker {
  constructor(private readonly d: WorkflowInvokerDeps) {}

  /** Lấy key → bước `tool` `running` → Dify gom → kết thúc bước + usage. `trace` gộp vào `detail` của bước. */
  async run(call: ToolCall, args: ToolArgs, trace: StepTrace): Promise<ToolResult> {
    const { ctx, wf } = call;
    const stepId = crypto.randomUUID();
    let apiKey: string;
    try {
      apiKey = await this.d.credentials.apiKey(wf.id);
    } catch (err) {
      if (!isCredentialError(err)) throw err;
      const inputs = maskInputs(args.inputs, "");
      await this.#startStep(ctx, wf, stepId, inputs);
      const detail = { ...trace, inputs, code: "NOT_CONFIGURED" as const };
      await this.#guarded(ctx, stepId, inputs, () => this.#finishStep(ctx, stepId, detail));
      return toolError("NOT_CONFIGURED");
    }
    const inputs = maskInputs(args.inputs, apiKey);
    await this.#startStep(ctx, wf, stepId, inputs);
    const o: Invoke = { args, trace, apiKey, stepId, inputs };
    return this.#guarded(ctx, stepId, inputs, () => this.#invoke(call, o));
  }

  /** REVIEW 1 Hub #3: ngoại lệ sau khi mở bước → đóng bước `failed INTERNAL_ERROR` (best-effort) rồi ném tiếp (-32603). */
  async #guarded<T>(
    ctx: InvokeCaller,
    stepId: string,
    inputs: Record<string, string>,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      await this.#finishStep(ctx, stepId, { inputs, code: "INTERNAL_ERROR" }).catch((e) =>
        this.d.log.warn("tool-step-close-failed", { run_id: ctx.runId, ...safeErrorFields(e) }),
      );
      throw err;
    }
  }

  /** Dify gom trong hạn tool, nghe thêm kết nối `/mcp` (đóng → abort + stop, bước `CANCELLED`). */
  async #invoke(call: ToolCall, o: Invoke): Promise<ToolResult> {
    const { ctx, wf } = call;
    const tenantKey = tenantKeyOf(await this.d.config.catalog(), ctx.tenantId);
    const timeout = AbortSignal.timeout((await this.#timeoutS(ctx)) * 1000);
    const signal = call.signal ? AbortSignal.any([timeout, call.signal]) : timeout;
    const user = difyUser(tenantKey, ctx.userId);
    const up = await this.#upload(call, o, user, signal);
    if (up.kind !== "ok") return this.#uploadFailed(ctx, o, up, timeout.aborted);
    const trace: StepTrace = { ...o.trace, ...(up.upload && { upload: up.upload }) };
    const req = {
      appType: wf.appType,
      baseUrl: wf.baseUrl,
      apiKey: o.apiKey,
      inputs: up.inputs,
      query: o.args.query,
      user,
      conversationId: null,
      outputField: wf.outputField,
    };
    const out = await this.d.dify.runStreaming(req, signal, () => {});
    const code = stepCodeOf(out, timeout.aborted);
    const upstream = out.kind === "failed" ? out.detail : null;
    const detail = { ...trace, inputs: o.inputs, code, ...(upstream ? { upstream } : {}) };
    await this.#finishStep(ctx, o.stepId, detail);
    await this.#usage(ctx, o.stepId, out);
    if (out.kind === "finished") return toolText(out.text);
    // `CANCELLED`: kết nối đã đóng, không ai đọc kết quả này.
    return toolError(code === "TIMEOUT" || code === "NOT_CONFIGURED" ? code : "UPSTREAM_ERROR");
  }

  /** H2c P14: file của tool → Dify `/files/upload` (key + `user` như lời gọi workflow); không file ⇒ `ok` ngay. */
  async #upload(
    call: ToolCall,
    o: Invoke,
    user: string,
    signal: AbortSignal,
  ): Promise<ToolUploadResult> {
    const { ctx, wf } = call;
    if (o.args.files.length === 0) return { kind: "ok", inputs: o.args.inputs, upload: null };
    const deps = {
      storage: this.d.storage ?? null,
      db: this.d.db,
      fetch: this.d.fetch,
      log: this.d.log,
    };
    const x = {
      tenantId: ctx.tenantId,
      workflowId: wf.id,
      target: { baseUrl: wf.baseUrl, apiKey: o.apiKey, user },
    };
    try {
      return await uploadToolFiles(deps, x, o.args, signal);
    } catch (err) {
      if (err instanceof AttachmentContentMissing)
        this.d.log.error("attachment-content-missing", { attachment_id: err.attachmentId });
      throw err;
    }
  }

  /** Upload lỗi/huỷ → đóng bước `failed` (trace `upload`), 0 lời gọi workflow (plan-errors §3). */
  async #uploadFailed(
    ctx: InvokeCaller,
    o: Invoke,
    up: Exclude<ToolUploadResult, { kind: "ok" }>,
    timedOut: boolean,
  ): Promise<ToolResult> {
    const code = up.kind === "failed" ? up.code : timedOut ? "TIMEOUT" : "CANCELLED";
    const failed = up.kind === "failed" ? up.trace : { upload: up.upload };
    await this.#finishStep(ctx, o.stepId, { ...o.trace, ...failed, inputs: o.inputs, code });
    if (up.kind === "failed") return up.result;
    // `CANCELLED`: kết nối đã đóng, không ai đọc kết quả này.
    return toolError(code === "TIMEOUT" ? "TIMEOUT" : "UPSTREAM_ERROR");
  }

  /** R20: `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)` theo cấu hình Hub hiện hành. */
  async #timeoutS(ctx: InvokeCaller): Promise<number> {
    const max = this.d.difyTimeoutMaxS;
    const agent = (await this.d.config.snapshot()).agents.find((a) => a.id === ctx.agentId);
    return toolTimeoutS(agent?.timeoutS ?? max, max);
  }

  #startStep(
    ctx: InvokeCaller,
    wf: CatalogWorkflow,
    stepId: string,
    inputs: Record<string, string>,
  ): Promise<number> {
    return withHubScope(this.d.db, { kind: "system" }, (tx) =>
      repo.insertToolStep(tx, {
        id: stepId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        runId: ctx.runId,
        agentId: ctx.agentId,
        workflowId: wf.id,
        detail: { inputs },
      }),
    );
  }

  #finishStep(ctx: InvokeCaller, stepId: string, detail: FinishDetail): Promise<void> {
    const status = detail.code ? "failed" : "ok";
    return withHubScope(this.d.db, { kind: "system" }, (tx) =>
      repo.finishToolStep(tx, {
        id: stepId,
        runId: ctx.runId,
        tenantId: ctx.tenantId,
        status,
        detail,
      }),
    );
  }

  /** R15: một dòng `billing=dify` mỗi lời gọi Dify đã tới được Dify (có `task_id` hoặc xong), `feature_id` NULL. */
  async #usage(ctx: InvokeCaller, stepId: string, out: DifyRunOutcome): Promise<void> {
    if (out.kind !== "finished" && !out.taskId) return;
    try {
      await recordDifyUsage(this.d.db, {
        tenantId: ctx.tenantId,
        runId: ctx.runId,
        stepId,
        userId: ctx.userId,
        featureId: null,
        agentId: ctx.agentId,
        usage: out.usage,
        latencyMs: out.ms,
      });
    } catch (err) {
      this.d.log.warn("tool-usage-failed", { run_id: ctx.runId, ...safeErrorFields(err) });
    }
  }
}
