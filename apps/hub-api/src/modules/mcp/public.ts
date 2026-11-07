// ADR-0037 · cửa công khai DUY NHẤT của module `mcp`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type {
  InvokeCaller,
  InvokeFailure,
  ToolCall,
  WorkflowInvoker,
} from "./adapters/workflow-invoker";
export type { ChatBinding, ChatGrant, ChatToolTokens } from "./chat-token";
export { chatTokenTtlS, HUB_TOOL_TOKEN_INPUT } from "./chat-token";
export { isAgreeReply } from "./confirm.rules";
export type { McpToolDef, ToolErrorCode, ToolResult } from "./mcp.rules";
export { mcpToolsFor, TOOL_ERROR_TEXT, toolError, toolText } from "./mcp.rules";
