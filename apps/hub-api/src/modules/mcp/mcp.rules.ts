// HUB-FR-50, HUB-FR-95, WRK-FR-13 · H2a-R18–R20, P7 · luật thuần MCP `/mcp` (plan §6, plan-rules): JSON-RPC 2.0,
// thương lượng phiên bản, danh sách tool theo agent ∩ enabled ∩ payload, kiểm tham số tool, timeout tool.
import type { WorkflowInput } from "@ai/contracts";
import type { JobAttachment } from "@ai/contracts/hub";
import { MCP_PROTOCOL_VERSIONS } from "@ai/contracts/hub-internal";
import type { CatalogWorkflow, WorkflowInputValue } from "../commands/catalog.types";
import { appNeedsQuery } from "../commands/command-input.rules";

export type RpcId = string | number;
/** Không `id` = notification (→ 202). */
export type RpcRequest = { kind: "request"; id: RpcId | null; method: string; params: unknown };
export type RpcErrorCode = -32700 | -32600 | -32601 | -32602 | -32603;
export type RpcError = { kind: "error"; id: RpcId | null; code: RpcErrorCode; message: string };

export type JsonSchemaProperty = {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
};
export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
};
export type McpTool = { name: string; description: string; inputSchema: JsonSchemaObject };

export type McpToolsInput = {
  agentWorkflowIds: ReadonlySet<string>;
  workflows: readonly CatalogWorkflow[];
  allowed: readonly string[];
  /** H2c P12 · vắng → H2a nguyên văn; `false` → bỏ workflow có input `file`; `true` → giữ + input `file`. B0: chưa dùng (B8). */
  hasFiles?: boolean;
};

export type ToolArgsResult =
  | { ok: true; inputs: Record<string, WorkflowInputValue>; query: string | null }
  | { ok: false };

/** = `WORKFLOW_INPUT_TEXT_MAX` (contract hub) — giá trị text dài hơn bị coi là tham số sai. */
const TEXT_MAX = 64_000;
const QUERY_INPUT = "query";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const rpcIdOf = (v: unknown): RpcId | null =>
  typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) ? v : null;

/** Batch (mảng), thiếu `method`, `jsonrpc ≠ "2.0"`, không phải object → `-32600`. */
export function parseRpc(body: unknown): RpcRequest | RpcError {
  const id = isObj(body) ? rpcIdOf(body.id) : null;
  if (!isObj(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string")
    return { kind: "error", id, code: -32600, message: "Invalid Request" };
  return { kind: "request", id, method: body.method, params: body.params };
}

/** Bản ∈ `MCP_PROTOCOL_VERSIONS` giữ nguyên; khác → bản đầu. */
export function negotiateProtocol(v: unknown): string {
  const known = MCP_PROTOCOL_VERSIONS as readonly unknown[];
  return known.includes(v) ? (v as string) : MCP_PROTOCOL_VERSIONS[0];
}

function propertyOf(i: WorkflowInput): JsonSchemaProperty | null {
  switch (i.type) {
    case "text":
      return { type: "string", description: i.description };
    case "number":
      return { type: "number", description: i.description };
    case "boolean":
      return { type: "boolean", description: i.description };
    case "select":
      return { type: "string", enum: [...(i.options ?? [])], description: i.description };
    default:
      // `file` (H2c): không đưa cho model.
      return null;
  }
}

/** H2c P12 · `withFiles` → input `file` = chuỗi tên file trong `attachments/` (plan-rules §5). B0: chưa dùng (B8). */
export function toolInputSchema(
  inputs: readonly WorkflowInput[],
  _withFiles = false,
): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  for (const i of inputs) {
    const p = propertyOf(i);
    if (!p) continue;
    properties[i.name] = p;
    if (i.required) required.push(i.name);
  }
  return { type: "object", properties, required };
}

const hasRequiredFile = (w: CatalogWorkflow): boolean =>
  w.inputSchema.some((i) => i.type === "file" && i.required);

/** App `chat`/`agent` cần `query` (như lệnh `/`) — `input_schema` không có `query` thì model không thể gọi đúng. */
const lacksQuery = (w: CatalogWorkflow): boolean =>
  appNeedsQuery(w.appType) && !w.inputSchema.some((i) => i.name === QUERY_INPUT);

/**
 * R19: `agentWorkflowIds` ∩ `enabled` ∩ `allowed`; bỏ workflow có input `file` bắt buộc và app `chat`/`agent` thiếu input
 * `query` (REVIEW 1 Hub #6); sắp `name`.
 */
export function mcpToolsFor(i: McpToolsInput): McpTool[] {
  const allowed = new Set(i.allowed);
  const usable = (w: CatalogWorkflow): boolean =>
    i.agentWorkflowIds.has(w.id) && w.enabled && allowed.has(w.key);
  return i.workflows
    .filter((w) => usable(w) && !hasRequiredFile(w) && !lacksQuery(w))
    .map((w) => ({
      name: w.key,
      description: w.description ?? w.name,
      inputSchema: toolInputSchema(w.inputSchema),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Giá trị hợp kiểu input → giá trị gửi Dify; sai → undefined. */
function argValue(i: WorkflowInput, v: unknown): WorkflowInputValue | undefined {
  switch (i.type) {
    case "text":
      return typeof v === "string" && v.length <= TEXT_MAX ? v : undefined;
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    case "boolean":
      return typeof v === "boolean" ? v : undefined;
    case "select":
      return typeof v === "string" && (i.options ?? []).includes(v) ? v : undefined;
    default:
      return undefined;
  }
}

/** Kiểu đúng theo `input_schema`; thiếu input bắt buộc / sai kiểu → `{ok:false}`. Khoá lạ bị bỏ. */
export function validateToolArgs(inputs: readonly WorkflowInput[], args: unknown): ToolArgsResult {
  if (!isObj(args)) return { ok: false };
  const out: Record<string, WorkflowInputValue> = {};
  for (const i of inputs) {
    const raw = args[i.name];
    if (raw === undefined || raw === null) {
      if (i.required) return { ok: false };
      continue;
    }
    const v = argValue(i, raw);
    if (v === undefined) return { ok: false };
    out[i.name] = v;
  }
  const q = out[QUERY_INPUT];
  return { ok: true, inputs: out, query: q === undefined ? null : String(q) };
}

/** `min(agentTimeoutS, maxS)`. */
export function toolTimeoutS(agentTimeoutS: number, maxS: number): number {
  return Math.min(agentTimeoutS, maxS);
}

// ---------- kết quả / phản hồi JSON-RPC (plan §6, plan-errors §4, spike S1) ----------

/** Bản stateless: client gọi `server/discover`, không `initialize`; mọi result phải có `resultType` (spike S1). */
export const MCP_STATELESS_VERSION = "2026-07-28";
/** `serverInfo` cố định (plan §6). */
export const MCP_SERVER_INFO = { name: "ai-hub", version: "1" } as const;
export const MCP_UNKNOWN_TOOL = "Unknown tool";

export type ToolErrorCode = "INVALID_ARGS" | "NOT_CONFIGURED" | "UPSTREAM_ERROR" | "TIMEOUT";
/** `content[0].text` nguyên văn plan-errors §4 (đọc bởi model; tiếng Anh, không theo locale). */
export const TOOL_ERROR_TEXT: Record<ToolErrorCode, string> = {
  INVALID_ARGS: "Invalid arguments for this tool.",
  NOT_CONFIGURED: "This tool is not configured.",
  UPSTREAM_ERROR: "The tool's service returned an error.",
  TIMEOUT: "The tool took too long to respond.",
};

/** H2c R23, PL5 · câu `isError` của tool khi tham số `file` sai / Dify từ chối file (tiếng Anh, model đọc). */
export const TOOL_FILE_TEXT = {
  NOT_ATTACHED: "This file is not attached to this message.",
  REJECTED: "Dify rejected this file (type or size).",
} as const;

/** H2c P12 · tham số `file` của tool → file của job: chuỗi; khớp `name` chính xác trước, rồi `id`; khác → null. */
export function fileArg(_v: unknown, _files: readonly JobAttachment[]): JobAttachment | null {
  throw new Error("not implemented: fileArg");
}

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
};

export const toolText = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: false,
});

export const toolError = (code: ToolErrorCode): ToolResult => ({
  content: [{ type: "text", text: TOOL_ERROR_TEXT[code] }],
  isError: true,
});

/**
 * Request thuộc chế độ 2026-07-28: header `MCP-Protocol-Version` hoặc `params._meta.protocolVersion` = bản stateless.
 * `tools/call` chỉ thêm `resultType` ở chế độ này (chế độ cũ giữ đúng hình `{content, isError}`).
 */
export function isStatelessRequest(headerVersion: string | undefined, params: unknown): boolean {
  if (headerVersion === MCP_STATELESS_VERSION) return true;
  const meta = isObj(params) && isObj(params._meta) ? params._meta : null;
  return meta?.protocolVersion === MCP_STATELESS_VERSION;
}

/** `initialize` / `server/discover`: phiên bản đề nghị ở `params.protocolVersion` hoặc `params._meta.protocolVersion`. */
export function requestedProtocol(params: unknown): unknown {
  if (!isObj(params)) return undefined;
  if (params.protocolVersion !== undefined) return params.protocolVersion;
  return isObj(params._meta) ? params._meta.protocolVersion : undefined;
}

export function initializeResult(params: unknown): Record<string, unknown> {
  return {
    protocolVersion: negotiateProtocol(requestedProtocol(params)),
    capabilities: { tools: { listChanged: false } },
    serverInfo: { ...MCP_SERVER_INFO },
  };
}

export function discoverResult(params: unknown): Record<string, unknown> {
  return { ...initializeResult(params), supportedVersions: [...MCP_PROTOCOL_VERSIONS] };
}

/** `ttlMs` + `cacheScope:"private"` (danh sách theo token job) — thiếu thì CLI 2.1.286 mất tool im lặng (spike S1). */
export function toolsListResult(tools: readonly McpTool[]): Record<string, unknown> {
  return { tools: [...tools], ttlMs: 0, cacheScope: "private" };
}

export type RpcResponse =
  | { jsonrpc: "2.0"; id: RpcId | null; result: Record<string, unknown> }
  | { jsonrpc: "2.0"; id: RpcId | null; error: { code: RpcErrorCode; message: string } };

/** `complete` = thêm `resultType:"complete"` (mọi result trừ `tools/call` ở chế độ cũ). */
export function rpcResult(
  id: RpcId | null,
  result: Record<string, unknown>,
  complete: boolean,
): RpcResponse {
  return { jsonrpc: "2.0", id, result: complete ? { ...result, resultType: "complete" } : result };
}

export function rpcError(id: RpcId | null, code: RpcErrorCode, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** `params.name` của `tools/call` (header `Mcp-Name` chỉ là gợi ý — spike S1). */
export function toolCallParams(params: unknown): { name: string | null; args: unknown } {
  if (!isObj(params)) return { name: null, args: undefined };
  return { name: typeof params.name === "string" ? params.name : null, args: params.arguments };
}
