// HUB-FR-50, HUB-FR-95, WRK-FR-13 · H2a-R18–R20 · P4, P7, P11, P12 · MCP server `/mcp` (plan §6): xác thực token job
// (`hashJobToken` → job `agent.cli` `running`), JSON-RPC `initialize`/`server/discover`/`ping`/`tools/list`/`tools/call`.
// `tools/call` gọi Dify gom (bỏ `delta`, lấy kết quả cuối) với timeout `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)`,
// ghi bước `tool` (inputs che secret rồi cắt) + usage `billing=dify`. Không bao giờ log token/app-key/tham số.
// H2c (B8, P12, R23): `tools/list` theo `payload.attachments` (`hasFiles`); `tools/call` input `file` → `fileArg` → xác nhận
// `side_effect` (không đổi) → upload Dify (`mcp-files.ts`) → gọi workflow.
import { AgentCliJobSchema, type JobAttachment } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import { hashJobToken, isJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import { AttachmentContentMissing, type UploadTrace } from "../attachments/attachment-dify";
import type { AttachmentStorage } from "../attachments/storage";
import type { CatalogWorkflow, WorkflowInputValue } from "../commands/catalog.types";
import { tenantKeyOf } from "../config/catalog.rules";
import { agentWorkflowIds } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { type CredentialService, isCredentialError } from "../dify/credential.service";
import type { DifyClient, DifyRunOutcome } from "../dify/dify.client";
import { difyUser, maskInputs } from "../dify/dify.rules";
import { recordDifyUsage } from "../dify/dify.usage";
import * as repo from "./mcp.repo";
import {
  discoverResult,
  initializeResult,
  isStatelessRequest,
  MCP_UNKNOWN_TOOL,
  type McpTool,
  mcpToolsFor,
  type RpcRequest,
  type RpcResponse,
  rpcError,
  rpcResult,
  type ToolErrorCode,
  type ToolResult,
  toolCallParams,
  toolError,
  toolsListResult,
  toolText,
  toolTimeoutS,
  validateToolArgs,
} from "./mcp.rules";
import {
  notAttached,
  resolveToolFiles,
  type ToolFile,
  type ToolUploadResult,
  uploadToolFiles,
} from "./mcp-files";

/** Ngữ cảnh của token (plan §6 Auth). `tools` = `payload.mcp.tools`. */
export type McpContext = {
  jobId: string;
  tenantId: string;
  userId: string;
  runId: string;
  flowId: string;
  agentId: string;
  tools: readonly string[];
  /** H2c · `payload.attachments` (vắng ⇒ []). */
  files: readonly JobAttachment[];
};

/**
 * Cổng xác nhận `side_effect` (plan-db §3.2; bản thật `confirmationGate` ở `confirm.service.ts`, nối trong `app.mcp.ts`):
 * trả kết quả thay cho lời gọi Dify (yêu cầu xác nhận), hoặc null = được chạy (đã tiêu thụ xác nhận). Vắng → từ chối.
 */
export type SideEffectGate = (ctx: McpContext, wf: CatalogWorkflow) => Promise<ToolResult | null>;

export type McpServiceDeps = {
  db: Db;
  config: ConfigCache;
  credentials: CredentialService;
  dify: DifyClient;
  /** = `HUB_DIFY_TIMEOUT_MAX_S`. */
  difyTimeoutMaxS: number;
  log: Logger;
  sideEffect?: SideEffectGate;
  /** H2c · kho file (`AppDeps.attachments.storage`); vắng/null ⇒ tool có file ném `AttachmentContentMissing` (-32603). */
  storage?: Pick<AttachmentStorage, "blob"> | null;
  /** Test: `fetch` cho Dify `/files/upload`. */
  fetch?: typeof fetch;
};

type ToolArgs = {
  inputs: Record<string, WorkflowInputValue>;
  query: string | null;
  files: readonly ToolFile[];
};
/** Trace thêm vào `detail` bước `tool` (R22: `confirmation: "consumed"`; H2c: `upload` + lỗi upload). */
type StepTrace = { confirmation?: "consumed"; upload?: UploadTrace } & Record<string, unknown>;
/** Mã trong `detail` bước `tool`: mã tool, hoặc `CANCELLED` (kết nối `/mcp` đóng) / `INTERNAL_ERROR` (ngoại lệ). */
type StepCode = ToolErrorCode | "CANCELLED" | "INTERNAL_ERROR";
/** Một lời gọi tool; `signal` = kết nối `/mcp` của request (đóng = huỷ run → abort Dify + stop). */
type ToolCall = { ctx: McpContext; wf: CatalogWorkflow; signal?: AbortSignal };
type Invoke = {
  args: ToolArgs;
  trace: StepTrace;
  apiKey: string;
  stepId: string;
  inputs: Record<string, string>;
};

export class McpService {
  constructor(private readonly d: McpServiceDeps) {}

  /** `Authorization: Bearer <token>` → ngữ cảnh; mọi sai (hình token, không hash, job không `agent.cli`) → null. */
  async authenticate(authorization: string | undefined): Promise<McpContext | null> {
    const m = /^Bearer (\S+)$/.exec(authorization ?? "");
    const token = m?.[1];
    if (!token || !isJobToken(token)) return null;
    const job = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      repo.jobByTokenHash(tx, hashJobToken(token)),
    );
    if (job?.type !== "agent.cli" || !job.agentId) return null;
    const p = AgentCliJobSchema.safeParse(job.payload);
    if (!p.success) return null;
    return {
      jobId: job.id,
      tenantId: job.tenantId,
      userId: job.userId,
      runId: job.runId,
      flowId: p.data.flow_id,
      agentId: job.agentId,
      tools: p.data.mcp?.tools ?? [],
      files: p.data.attachments ?? [],
    };
  }

  /** Một request JSON-RPC (có `id`). Method lạ → `-32601`. `signal` = kết nối HTTP (`c.req.raw.signal`). */
  async handle(
    ctx: McpContext,
    req: RpcRequest,
    headerVersion?: string,
    signal?: AbortSignal,
  ): Promise<RpcResponse> {
    const { id, params } = req;
    switch (req.method) {
      case "initialize":
        return rpcResult(id, initializeResult(params), true);
      case "server/discover":
        return rpcResult(id, discoverResult(params), true);
      case "ping":
        return rpcResult(id, {}, true);
      case "tools/list":
        return rpcResult(id, toolsListResult(await this.tools(ctx)), true);
      case "tools/call":
        return this.#call(ctx, req, isStatelessRequest(headerVersion, params), signal);
      default:
        return rpcError(id, -32601, "Method not found");
    }
  }

  /** R19 từ cache (0 query DB): workflow gắn agent ∩ `enabled` ∩ `payload.mcp.tools`; H2c `hasFiles` = job có file. */
  async tools(ctx: McpContext): Promise<McpTool[]> {
    const [snapshot, catalog] = await Promise.all([
      this.d.config.snapshot(),
      this.d.config.catalog(),
    ]);
    return mcpToolsFor({
      agentWorkflowIds: agentWorkflowIds(snapshot, ctx.agentId),
      workflows: [...catalog.workflows.values()],
      allowed: ctx.tools,
      hasFiles: ctx.files.length > 0,
    });
  }

  async #call(
    ctx: McpContext,
    req: RpcRequest,
    stateless: boolean,
    signal?: AbortSignal,
  ): Promise<RpcResponse> {
    const { name, args } = toolCallParams(req.params);
    const tools = await this.tools(ctx);
    const catalog = await this.d.config.catalog();
    const wf = [...catalog.workflows.values()].find((w) => w.key === name);
    // Không nói lý do (agent khác / tắt / ngoài payload) — HUB-BR-19.
    if (!name || !wf || !tools.some((t) => t.name === name))
      return rpcError(req.id, -32602, MCP_UNKNOWN_TOOL);
    const result = await this.#callTool({ ctx, wf, signal }, args);
    return rpcResult(req.id, result, stateless);
  }

  async #callTool(call: ToolCall, rawArgs: unknown): Promise<ToolResult> {
    const { ctx, wf } = call;
    const valid = validateToolArgs(wf.inputSchema, rawArgs);
    if (!valid.ok) return toolError("INVALID_ARGS");
    // H2c R23: validate (H2a) trước, rồi file thuộc job — sai ⇒ câu tĩnh, 0 lời gọi Dify, không bước (B7-7).
    const files = resolveToolFiles(wf, valid.inputs, ctx.files);
    if (!files.ok) return notAttached();
    const args: ToolArgs = { inputs: valid.inputs, query: valid.query, files: files.files };
    if (!wf.sideEffect) return this.#runTool(call, args, {});
    const gated = await (this.d.sideEffect ?? refuseSideEffect(this.d.log))(ctx, wf);
    // Qua cổng = đã tiêu thụ xác nhận (R22) → trace `consumed` trên bước `tool`; gọi Dify đúng một lần, không retry.
    return gated ?? this.#runTool(call, args, { confirmation: "consumed" });
  }

  /** Lấy key → bước `tool` `running` → Dify gom → kết thúc bước + usage. `trace` gộp vào `detail` của bước. */
  async #runTool(call: ToolCall, args: ToolArgs, trace: StepTrace): Promise<ToolResult> {
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
    ctx: McpContext,
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
    const deps = { storage: this.d.storage ?? null, fetch: this.d.fetch, log: this.d.log };
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
    ctx: McpContext,
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
  async #timeoutS(ctx: McpContext): Promise<number> {
    const max = this.d.difyTimeoutMaxS;
    const agent = (await this.d.config.snapshot()).agents.find((a) => a.id === ctx.agentId);
    return toolTimeoutS(agent?.timeoutS ?? max, max);
  }

  #startStep(
    ctx: McpContext,
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

  #finishStep(
    ctx: McpContext,
    stepId: string,
    detail: StepTrace & {
      inputs: Record<string, string>;
      code: StepCode | null;
      upstream?: string;
    },
  ): Promise<void> {
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
  async #usage(ctx: McpContext, stepId: string, out: DifyRunOutcome): Promise<void> {
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

/** Kết quả Dify → mã bước (plan-errors §4); xong → null. Huỷ do hết hạn tool → `TIMEOUT`; do kết nối đóng → `CANCELLED`. */
function stepCodeOf(out: DifyRunOutcome, timedOut: boolean): StepCode | null {
  if (out.kind === "finished") return null;
  if (out.kind === "aborted") return timedOut ? "TIMEOUT" : "CANCELLED";
  return out.code;
}

/** Mặc định khi không nối cổng: tool `side_effect` không chạy (không có xác nhận ⇒ không gọi Dify). */
function refuseSideEffect(log: Logger): SideEffectGate {
  return async (ctx, wf) => {
    log.warn("tool-side-effect-unconfirmed", { run_id: ctx.runId, workflow_id: wf.id });
    return toolError("NOT_CONFIGURED");
  };
}
