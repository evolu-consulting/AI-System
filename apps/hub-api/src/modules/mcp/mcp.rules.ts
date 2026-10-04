// HUB-FR-50, HUB-FR-95, WRK-FR-13 · H2a-R18–R20, P7 · luật thuần MCP `/mcp` (plan §6, plan-rules). B0: chỉ chữ ký (B8).
import type { WorkflowInput } from "@ai/contracts";
import type { CatalogWorkflow, WorkflowInputValue } from "../commands/catalog.types";

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
};

export type ToolArgsResult =
  | { ok: true; inputs: Record<string, WorkflowInputValue>; query: string | null }
  | { ok: false };

/** Batch (mảng), thiếu `method`, `jsonrpc ≠ "2.0"`, không phải object → `-32600`. */
export function parseRpc(body: unknown): RpcRequest | RpcError {
  throw new Error(`not implemented: parseRpc(${typeof body})`);
}

/** Bản ∈ `MCP_PROTOCOL_VERSIONS` giữ nguyên; khác → bản đầu. */
export function negotiateProtocol(v: unknown): string {
  throw new Error(`not implemented: negotiateProtocol(${typeof v})`);
}

export function toolInputSchema(inputs: readonly WorkflowInput[]): JsonSchemaObject {
  throw new Error(`not implemented: toolInputSchema(${inputs.length})`);
}

/** R19: `agentWorkflowIds` ∩ `enabled` ∩ `allowed`; bỏ workflow có input `file` bắt buộc; sắp `name`. */
export function mcpToolsFor(i: McpToolsInput): McpTool[] {
  throw new Error(`not implemented: mcpToolsFor(${i.workflows.length})`);
}

export function validateToolArgs(inputs: readonly WorkflowInput[], args: unknown): ToolArgsResult {
  throw new Error(`not implemented: validateToolArgs(${inputs.length}, ${typeof args})`);
}

/** `min(agentTimeoutS, maxS)`. */
export function toolTimeoutS(agentTimeoutS: number, maxS: number): number {
  throw new Error(`not implemented: toolTimeoutS(${agentTimeoutS}, ${maxS})`);
}
