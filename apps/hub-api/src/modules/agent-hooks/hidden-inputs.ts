// agent-hooks · biến ẩn Hub tự điền khi agent gọi một workflow (tool MCP / stage `tool`): `user_token` = access token của user
// (workflow hook / tool KH gọi KH fork thay user). Chỉ điền biến workflow khai báo; không có ⇒ không I/O. Không log giá trị.
// dlc-engine: bỏ `hub_ticket` / `hub_conversation_id` (vé gọi ngược `/dify/agent-calls` của flow quy trình DLC trên Dify cũ).
import type { ToolCall } from "../mcp/adapters/workflow-invoker";
import type { UserTokens } from "./user-token";

export function hiddenInputsFor(d: { tokens: UserTokens }) {
  return async (call: ToolCall): Promise<Record<string, string>> => {
    if (!call.wf.inputSchema.some((i) => i.name === "user_token")) return {};
    const t = await d.tokens.forUser(call.ctx.tenantId, call.ctx.userId);
    return t ? { user_token: t } : {};
  };
}
