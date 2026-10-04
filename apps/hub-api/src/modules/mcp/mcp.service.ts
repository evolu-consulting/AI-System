// HUB-FR-50, HUB-FR-95, WRK-FR-13 · H2a-R18–R20 · P4, P7, P11, P12 · MCP server `/mcp` (plan §6): xác thực token job
// (`hashJobToken` → job `agent.cli` `running`), JSON-RPC `initialize`/`server/discover`/`ping`/`tools/list`/`tools/call`.
// `tools/call` gọi Dify gom (bỏ `delta`, lấy kết quả cuối) với timeout `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)`,
// ghi bước `tool` (inputs che secret rồi cắt) + usage `billing=dify`. Không bao giờ log token/app-key/tham số.
import { AgentCliJobSchema } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import { hashJobToken, isJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import type { CatalogWorkflow, WorkflowInputValue } from "../commands/catalog.types";
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

/** Ngữ cảnh của token (plan §6 Auth). `tools` = `payload.mcp.tools`. */
export type McpContext = {
  jobId: string;
  tenantId: string;
  userId: string;
  runId: string;
  flowId: string;
  agentId: string;
  tools: readonly string[];
};

/**
 * Chỗ nối xác nhận `side_effect` (B9, plan-db §3): trả kết quả thay cho lời gọi Dify (vd yêu cầu xác nhận), hoặc null =
 * được chạy (đã tiêu thụ xác nhận). Mặc định B8: từ chối — không bao giờ chạy tool `side_effect` khi chưa có luồng xác nhận.
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
};

type ToolArgs = { inputs: Record<string, WorkflowInputValue>; query: string | null };

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
    };
  }

  /** Một request JSON-RPC (có `id`). Method lạ → `-32601`. */
  async handle(ctx: McpContext, req: RpcRequest, headerVersion?: string): Promise<RpcResponse> {
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
        return this.#call(ctx, req, isStatelessRequest(headerVersion, params));
      default:
        return rpcError(id, -32601, "Method not found");
    }
  }

  /** R19 từ cache (0 query DB): workflow gắn agent ∩ `enabled` ∩ `payload.mcp.tools`. */
  async tools(ctx: McpContext): Promise<McpTool[]> {
    const [snapshot, catalog] = await Promise.all([
      this.d.config.snapshot(),
      this.d.config.catalog(),
    ]);
    return mcpToolsFor({
      agentWorkflowIds: agentWorkflowIds(snapshot, ctx.agentId),
      workflows: [...catalog.workflows.values()],
      allowed: ctx.tools,
    });
  }

  async #call(ctx: McpContext, req: RpcRequest, stateless: boolean): Promise<RpcResponse> {
    const { name, args } = toolCallParams(req.params);
    const tools = await this.tools(ctx);
    const catalog = await this.d.config.catalog();
    const wf = [...catalog.workflows.values()].find((w) => w.key === name);
    // Không nói lý do (agent khác / tắt / ngoài payload) — HUB-BR-19.
    if (!name || !wf || !tools.some((t) => t.name === name))
      return rpcError(req.id, -32602, MCP_UNKNOWN_TOOL);
    const result = await this.#callTool(ctx, wf, args);
    return rpcResult(req.id, result, stateless);
  }

  async #callTool(ctx: McpContext, wf: CatalogWorkflow, rawArgs: unknown): Promise<ToolResult> {
    const args = validateToolArgs(wf.inputSchema, rawArgs);
    if (!args.ok) return toolError("INVALID_ARGS");
    if (wf.sideEffect) {
      const gated = await (this.d.sideEffect ?? refuseSideEffect(this.d.log))(ctx, wf);
      if (gated) return gated;
    }
    return this.#runTool(ctx, wf, args);
  }

  /** Lấy key → bước `tool` `running` → Dify gom → kết thúc bước + usage. */
  async #runTool(ctx: McpContext, wf: CatalogWorkflow, args: ToolArgs): Promise<ToolResult> {
    const stepId = crypto.randomUUID();
    let apiKey: string;
    try {
      apiKey = await this.d.credentials.apiKey(wf.id);
    } catch (err) {
      if (!isCredentialError(err)) throw err;
      const inputs = maskInputs(args.inputs, "");
      await this.#startStep(ctx, wf, stepId, inputs);
      await this.#finishStep(ctx, stepId, { inputs, code: "NOT_CONFIGURED" });
      return toolError("NOT_CONFIGURED");
    }
    const inputs = maskInputs(args.inputs, apiKey);
    await this.#startStep(ctx, wf, stepId, inputs);
    const tenantKey = (await this.d.config.catalog()).tenantKeys.get(ctx.tenantId) ?? "";
    const timeout = AbortSignal.timeout((await this.#timeoutS(ctx)) * 1000);
    const req = {
      appType: wf.appType,
      baseUrl: wf.baseUrl,
      apiKey,
      inputs: args.inputs,
      query: args.query,
      user: difyUser(tenantKey, ctx.userId),
      conversationId: null,
      outputField: wf.outputField,
    };
    const out = await this.d.dify.runStreaming(req, timeout, () => {});
    const code = errorCodeOf(out);
    const upstream = out.kind === "failed" ? out.detail : null;
    await this.#finishStep(ctx, stepId, { inputs, code, ...(upstream ? { upstream } : {}) });
    await this.#usage(ctx, stepId, out);
    return out.kind === "finished" ? toolText(out.text) : toolError(code ?? "UPSTREAM_ERROR");
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
    detail: { inputs: Record<string, string>; code: ToolErrorCode | null; upstream?: string },
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

/** Kết quả Dify → mã lỗi tool (plan-errors §4); xong → null. Huỷ chỉ do hết hạn tool → `TIMEOUT`. */
function errorCodeOf(out: DifyRunOutcome): ToolErrorCode | null {
  if (out.kind === "finished") return null;
  if (out.kind === "aborted") return "TIMEOUT";
  return out.code;
}

/** Mặc định tới B9: tool `side_effect` không chạy (không có xác nhận ⇒ không gọi Dify). */
function refuseSideEffect(log: Logger): SideEffectGate {
  return async (ctx, wf) => {
    log.warn("tool-side-effect-unconfirmed", { run_id: ctx.runId, workflow_id: wf.id });
    return toolError("NOT_CONFIGURED");
  };
}
