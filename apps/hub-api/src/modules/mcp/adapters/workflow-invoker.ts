// HUB-FR-50, HUB-FR-95, HUB-FR-146 · H2a-R20, R22 · H2c P14 · P-d2 D2-02/D2-27 (T18s, tách từ `mcp.service.ts`, không đổi
// hành vi): pipeline gọi một workflow Dify của `tools/call` — lấy key → bước `tool` `running` → (upload file) → Dify gom
// trong hạn `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)` → kết thúc bước + usage `billing=dify` (một câu, T18-perf).
// Mỗi câu tx ngắn riêng; không giữ tx trong lúc gọi mạng. Không bao giờ log token/app-key/tham số. Số câu: `/mcp` 5 (key 2,
// khoá+mở bước 2, đóng bước+usage 1); stage `tool` (`ownRun`) 4 (D2-27/D2-28).
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
import { difyRunMeta, recordDifyRunOnly } from "../../dify/dify.usage";
import * as repo from "../mcp.repo";
import { type ToolResult, toolError, toolText, toolTimeoutS } from "../mcp.rules";
import { type StepCode, stepCodeOf } from "../mcp-call";
import { type ToolFile, type ToolUploadResult, uploadToolFiles } from "../mcp-files";

/**
 * Ai gọi (phần `McpContext` pipeline cần): bước `tool` + usage ghi vào run này, hạn theo agent này. P-d2 · stage `tool`:
 * `agentId` null + `timeoutS` = `stage.timeout_s` (D2-17, vẫn kẹp `HUB_DIFY_TIMEOUT_MAX_S`).
 */
export type InvokeCaller = {
  tenantId: string;
  userId: string;
  runId: string;
  agentId: string | null;
  timeoutS?: number;
  /**
   * T18-perf · run chỉ người gọi này ghi `run_steps` (hub run của stage `tool`) ⇒ bỏ khoá advisory khi mở bước (`seq`
   * vẫn đúng nhờ thử lại 23505). Vắng ⇒ khoá như `/mcp` (bước xen với vòng Orchestrator).
   */
  ownRun?: boolean;
};
export type ToolArgs = {
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  files: readonly ToolFile[];
};
/** Trace thêm vào `detail` bước `tool` (R22: `confirmation: "consumed"`; H2c: `upload` + lỗi upload). */
export type StepTrace = {
  confirmation?: "consumed" | "gate_review";
  upload?: UploadTrace;
} & Record<string, unknown>;
/** Một lời gọi tool; `signal` = kết nối `/mcp` của request (đóng = huỷ run → abort Dify + stop). */
export type ToolCall = { ctx: InvokeCaller; wf: CatalogWorkflow; signal?: AbortSignal };

/**
 * P-d2 T18-2 · D2-13 · Q-D2-2: chi tiết lỗi cho executor `tool` (không đổi `ToolResult` của `/mcp`). `sent=false` chỉ khi
 * chắc chắn chưa tới Dify workflow (thiếu key, upload lỗi, lỗi lập kết nối); còn lại (kể cả hết hạn) ⇒ `true`.
 */
export type InvokeFailure = {
  code: string;
  httpStatus: number | null;
  sent: boolean;
  reason: string | null;
};
/** Cổng gọi workflow (D2-02): cùng pipeline `/mcp`, dùng chung cho `McpService` và executor `tool` (T18). */
export type WorkflowInvoker = {
  run(
    call: ToolCall,
    args: ToolArgs,
    trace: StepTrace,
    onFail?: (f: InvokeFailure) => void,
  ): Promise<ToolResult>;
};
type OnFail = ((f: InvokeFailure) => void) | undefined;

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
  /**
   * dlc-dify · biến ẩn gộp vào input gửi Dify (vé gọi ngược `hub_ticket`, `user_token`) — KHÔNG ghi vào `detail.inputs`
   * của bước `tool`. Chỉ điền biến workflow khai báo. Vắng ⇒ như cũ.
   */
  hiddenInputs?: (call: ToolCall) => Promise<Record<string, string>>;
};

type Invoke = {
  args: ToolArgs;
  trace: StepTrace;
  apiKey: string;
  stepId: string;
  inputs: Record<string, string>;
  onFail: OnFail;
};
type FinishDetail = StepTrace & {
  inputs: Record<string, string>;
  code: StepCode | null;
  upstream?: string;
};

/** dlc-dify · hạn chạy nền của workflow `hub_async` (giây). */
export const ASYNC_MAX_S = 24 * 3600;
export const isAsyncWorkflow = (wf: CatalogWorkflow) =>
  wf.inputSchema.some((i) => i.name === "hub_async");
/** dlc-dify · nơi báo kết quả workflow chạy nền (gắn lúc mount `/dify`); vắng ⇒ chỉ đóng bước `tool`. */
export const asyncFlowSink: {
  done?: (call: ToolCall, r: { ok: boolean; text: string }) => Promise<void>;
} = {};

export class DifyWorkflowInvoker implements WorkflowInvoker {
  constructor(private readonly d: WorkflowInvokerDeps) {}

  /** Lấy key → bước `tool` `running` → Dify gom → kết thúc bước + usage. `trace` gộp vào `detail` của bước. */
  async run(
    call: ToolCall,
    args: ToolArgs,
    trace: StepTrace,
    onFail?: (f: InvokeFailure) => void,
  ): Promise<ToolResult> {
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
      onFail?.({ code: "NOT_CONFIGURED", httpStatus: null, sent: false, reason: null });
      return toolError("NOT_CONFIGURED");
    }
    const inputs = maskInputs(args.inputs, apiKey);
    await this.#startStep(ctx, wf, stepId, inputs);
    const o: Invoke = { args, trace, apiKey, stepId, inputs, onFail };
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
      inputs: { ...up.inputs, ...(await this.#hidden(call)) },
      query: o.args.query,
      user,
      conversationId: null,
      outputField: wf.outputField,
    };
    if (isAsyncWorkflow(wf))
      return this.#detach(call, o, { ...req, inputs: { ...req.inputs, hub_async: "1" } }, trace);
    const out = await this.d.dify.runStreaming(req, signal, () => {});
    const code = stepCodeOf(out, timeout.aborted);
    const upstream = out.kind === "failed" ? out.detail : null;
    const detail = { ...trace, inputs: o.inputs, code, ...(upstream ? { upstream } : {}) };
    await this.#finishWithUsage(ctx, o.stepId, detail, out, wf.id);
    if (out.kind === "finished") return toolText(out.text);
    const mapped = code === "TIMEOUT" || code === "NOT_CONFIGURED" ? code : "UPSTREAM_ERROR";
    o.onFail?.(failureOf(out, code === "CANCELLED" ? code : mapped));
    // `CANCELLED`: kết nối đã đóng, không ai đọc kết quả này.
    return toolError(mapped);
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
    // Upload lỗi ⇒ workflow CHƯA được gọi (0 lời gọi workflow) ⇒ `sent:false`.
    o.onFail?.({ code, httpStatus: null, sent: false, reason: null });
    if (up.kind === "failed") return up.result;
    // `CANCELLED`: kết nối đã đóng, không ai đọc kết quả này.
    return toolError(code === "TIMEOUT" ? "TIMEOUT" : "UPSTREAM_ERROR");
  }

  /**
   * dlc-dify · workflow khai báo input `hub_async` (quy trình chạy hàng giờ, có bước chờ user): KHÔNG gắn vào kết nối
   * `/mcp` (job của agent hết hạn ≤ 3600 s sẽ huỷ nó) — chạy nền tới `ASYNC_MAX_S`, trả ngay "đã khởi động"; xong ⇒ đóng
   * bước `tool` + usage và báo kết quả về hội thoại qua `asyncFlowSink` (đăng ký ở `app.dlc.ts`).
   */
  #detach(
    call: ToolCall,
    o: Invoke,
    req: Parameters<DifyClient["runStreaming"]>[0],
    trace: StepTrace,
  ): ToolResult {
    const bg = AbortSignal.timeout(ASYNC_MAX_S * 1000);
    const { ctx, wf } = call;
    void (async () => {
      const out = await this.d.dify.runStreaming(req, bg, () => {});
      const code = stepCodeOf(out, bg.aborted);
      const upstream = out.kind === "failed" ? out.detail : null;
      const detail = {
        ...trace,
        inputs: o.inputs,
        code,
        async: true,
        ...(upstream ? { upstream } : {}),
      };
      await this.#finishWithUsage(ctx, o.stepId, detail, out, wf.id).catch((e) =>
        this.d.log.warn("async-tool-close-failed", { run_id: ctx.runId, ...safeErrorFields(e) }),
      );
      const text =
        out.kind === "finished"
          ? out.text
          : `Flow ${wf.key} ended: ${code}${upstream ? ` (${upstream.slice(0, 300)})` : ""}`;
      await asyncFlowSink
        .done?.(call, { ok: out.kind === "finished", text })
        .catch((e) =>
          this.d.log.warn("async-flow-report-failed", { run_id: ctx.runId, ...safeErrorFields(e) }),
        );
    })();
    this.d.log.info("async-flow-started", { run_id: ctx.runId, workflow: wf.key });
    return toolText(
      `STARTED: the ${wf.key} flow is now running in the background (it can take hours and pauses when a step needs the person). ` +
        "Its steps will ask questions / approvals in this chat, and the final report will be posted here when it finishes. Tell the person it started; do not wait for it.",
    );
  }

  async #hidden(call: ToolCall): Promise<Record<string, string>> {
    if (!this.d.hiddenInputs) return {};
    try {
      return await this.d.hiddenInputs(call);
    } catch (err) {
      this.d.log.warn("tool-hidden-inputs-failed", {
        run_id: call.ctx.runId,
        ...safeErrorFields(err),
      });
      return {};
    }
  }

  /** R20: `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)` theo cấu hình Hub hiện hành. */
  async #timeoutS(ctx: InvokeCaller): Promise<number> {
    const max = this.d.difyTimeoutMaxS;
    if (ctx.timeoutS !== undefined) return toolTimeoutS(ctx.timeoutS, max);
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
        lock: ctx.ownRun !== true,
      }),
    );
  }

  /**
   * T18-perf · đóng bước + usage `billing=dify` (R15) MỘT câu (CTE `update` + `log_dify_usage`, văn bản cố định). Câu gộp
   * lỗi ⇒ đóng bước riêng rồi cảnh báo usage như trước (lỗi usage không làm hỏng bước).
   */
  async #finishWithUsage(
    ctx: InvokeCaller,
    stepId: string,
    detail: FinishDetail,
    out: DifyRunOutcome,
    workflowId: string,
  ): Promise<void> {
    const status = detail.code ? "failed" : "ok";
    const step = { id: stepId, runId: ctx.runId, tenantId: ctx.tenantId, status, detail } as const;
    const usage = {
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      stepId,
      userId: ctx.userId,
      featureId: null,
      agentId: ctx.agentId,
      usage: out.usage,
      latencyMs: out.ms,
      run: difyRunMeta(out, workflowId, "agent"),
    };
    if (out.kind !== "finished" && !out.taskId) {
      // Dify lỗi trước khi cấp task_id (vd chưa publish): chỉ lịch sử chạy (best-effort), không usage.
      await recordDifyRunOnly(this.d.db, usage).catch((err) =>
        this.d.log.warn("tool-run-record-failed", { run_id: ctx.runId, ...safeErrorFields(err) }),
      );
      return this.#finishStep(ctx, stepId, detail);
    }
    try {
      await withHubScope(this.d.db, { kind: "system" }, (tx) =>
        repo.finishToolStepWithUsage(tx, step, usage),
      );
    } catch (err) {
      this.d.log.warn("tool-usage-failed", { run_id: ctx.runId, ...safeErrorFields(err) });
      await this.#finishStep(ctx, stepId, detail);
    }
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
}

/** Lỗi workflow ⇒ chi tiết cho stage `tool`: lỗi lập kết nối ⇒ chưa gửi; HTTP/SSE/hết hạn ⇒ đã gửi (an toàn, Q-D2-2). */
function failureOf(
  out: Exclude<DifyRunOutcome, { kind: "finished" }>,
  code: string,
): InvokeFailure {
  if (out.kind === "aborted") return { code, httpStatus: null, sent: true, reason: null };
  return { code, httpStatus: out.httpStatus, sent: out.connectFailed !== true, reason: out.reason };
}
