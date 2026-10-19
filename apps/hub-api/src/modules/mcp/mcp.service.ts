// HUB-FR-50, HUB-FR-95, WRK-FR-13 · H2a-R18–R20 · P4, P7, P11, P12 · MCP server `/mcp` (plan §6): xác thực token job
// (`hashJobToken` → job `agent.cli` `running`), JSON-RPC `initialize`/`server/discover`/`ping`/`tools/list`/`tools/call`.
// `tools/call` kiểm tham số + file + cổng `side_effect` rồi gọi `WorkflowInvoker` (`adapters/workflow-invoker.ts`, T18s:
// Dify gom trong hạn tool, bước `tool`, usage). Không bao giờ log token/app-key/tham số.
// H2c (B8, P12, R23): `tools/list` theo `payload.attachments` (`hasFiles`); `tools/call` input `file` → `fileArg` → xác nhận
// `side_effect` (không đổi) → upload Dify (`mcp-files.ts`) → gọi workflow.
import { AgentCliJobSchema, type JobAttachment } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { hashJobToken, isJobToken } from "../../lib/job-token";
import type { Logger } from "../../lib/logger";
import type { CatalogWorkflow } from "../commands/catalog.types";
import { agentWorkflowIds } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { type KhJobCtx, type KhQueryService, khJobCtx } from "../kh/kh.query.service";
import type { ToolArgs, WorkflowInvoker } from "./adapters/workflow-invoker";
import * as repo from "./mcp.repo";
import {
  discoverResult,
  initializeResult,
  isStatelessRequest,
  MCP_UNKNOWN_TOOL,
  type McpToolDef,
  mcpToolsFor,
  type RpcRequest,
  type RpcResponse,
  rpcError,
  rpcResult,
  type ToolResult,
  toolCallParams,
  toolError,
  toolsListResult,
  validateToolArgs,
} from "./mcp.rules";
import { notAttached, resolveToolFiles } from "./mcp-files";
import type { PackMcpTools } from "./pack-tools.provider";

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
  /** K1 D6 · `kh_jobs` + stage của job; null ⇒ không `kh-query`. */
  kh: KhJobCtx | null;
};

/**
 * Cổng xác nhận `side_effect` (plan-db §3.2; bản thật `confirmationGate` ở `confirm.service.ts`, nối trong `app.mcp.ts`):
 * trả kết quả thay cho lời gọi Dify (yêu cầu xác nhận), hoặc null = được chạy (đã tiêu thụ xác nhận). Vắng → từ chối.
 */
export type SideEffectGate = (ctx: McpContext, wf: CatalogWorkflow) => Promise<ToolResult | null>;

/** Mặc định khi không nối cổng: tool `side_effect` không chạy (không có xác nhận ⇒ không gọi Dify). */
export function refuseSideEffect(log: Logger): SideEffectGate {
  return async (ctx, wf) => {
    log.warn("tool-side-effect-unconfirmed", { run_id: ctx.runId, workflow_id: wf.id });
    return toolError("NOT_CONFIGURED");
  };
}

export type McpServiceDeps = {
  db: Db;
  config: ConfigCache;
  log: Logger;
  /** Pipeline gọi Dify (key → bước `tool` → Dify gom → usage); một bản dùng chung, dựng ở `app.mcp.ts`. */
  invoker: WorkflowInvoker;
  sideEffect?: SideEffectGate;
  kh?: KhQueryService;
  /** N2-FR-03 · tool của gói (CR-087); vắng ⇒ không có. */
  packTools?: PackMcpTools;
};

/** Một lời gọi tool; `signal` = kết nối `/mcp` của request (đóng = huỷ run → abort Dify + stop). */
type ToolCall = { ctx: McpContext; wf: CatalogWorkflow; signal?: AbortSignal };

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
      kh: khJobCtx(job.khItems, job.stageRunId),
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
  async tools(ctx: McpContext): Promise<McpToolDef[]> {
    const [snapshot, catalog] = await Promise.all([
      this.d.config.snapshot(),
      this.d.config.catalog(),
    ]);
    return [
      ...mcpToolsFor({
        agentWorkflowIds: agentWorkflowIds(snapshot, ctx.agentId),
        workflows: [...catalog.workflows.values()],
        allowed: ctx.tools,
        hasFiles: ctx.files.length > 0,
      }),
      ...(this.d.kh?.tools(ctx) ?? []),
      ...((await this.d.packTools?.tools(ctx)) ?? []),
    ];
  }

  async #call(
    ctx: McpContext,
    req: RpcRequest,
    stateless: boolean,
    signal?: AbortSignal,
  ): Promise<RpcResponse> {
    const { name, args } = toolCallParams(req.params);
    const kh = this.d.kh?.accepts(ctx, name);
    if (kh) return rpcResult(req.id, await kh.call(args), stateless);
    const pk = await this.d.packTools?.accepts(ctx, name); // N2-FR-03
    if (pk) return rpcResult(req.id, await pk.call(args), stateless);
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
    if (!wf.sideEffect) return this.d.invoker.run(call, args, {});
    const gated = await (this.d.sideEffect ?? refuseSideEffect(this.d.log))(ctx, wf);
    // Qua cổng = đã tiêu thụ xác nhận (R22) → trace `consumed` trên bước `tool`; gọi Dify đúng một lần, không retry.
    return gated ?? this.d.invoker.run(call, args, { confirmation: "consumed" });
  }
}
