// dlc-dify · biến ẩn Hub tự điền khi agent gọi một workflow (tool MCP / stage `tool`): `hub_ticket` = vé gọi ngược gắn
// user + hội thoại của run (để node Dify gọi `POST /dify/agent-calls`), `user_token` = access token của user (gọi KH
// thay user). Chỉ điền biến workflow khai báo; không có biến nào ⇒ không I/O. Không log giá trị.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { UserTokens } from "../agent-hooks/user-token";
import type { ToolCall } from "../mcp/adapters/workflow-invoker";
import type { FlowTicket, FlowTickets } from "./tickets";

type RunOwner = { conversation_id: string; role: FlowTicket["role"] };

async function runOwner(db: Db, runId: string, userId: string): Promise<RunOwner | null> {
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<RunOwner>(sql`select r.conversation_id, u.role
      from hub.runs r join admin.users u on u.id = ${userId}::uuid
      where r.id = ${runId}::uuid`),
  );
  return r ?? null;
}

type HiddenDeps = { db: Db; tickets: FlowTickets; tokens: UserTokens };

/** `hub_ticket` / `hub_conversation_id` theo hội thoại của run (vắng run ⇒ không điền). */
async function flowInputs(d: HiddenDeps, call: ToolCall, names: Set<string>) {
  const out: Record<string, string> = {};
  const { ctx } = call;
  const o = await runOwner(d.db, ctx.runId, ctx.userId);
  if (!o) return out;
  if (names.has("hub_conversation_id")) out.hub_conversation_id = o.conversation_id;
  if (names.has("hub_ticket"))
    out.hub_ticket = await d.tickets.issue({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      role: o.role,
      conversationId: o.conversation_id,
      workflowKey: call.wf.key,
    });
  return out;
}

export function hiddenInputsFor(d: HiddenDeps) {
  return async (call: ToolCall): Promise<Record<string, string>> => {
    const names = new Set(call.wf.inputSchema.map((i) => i.name));
    const out: Record<string, string> = {};
    const { ctx } = call;
    if (names.has("user_token")) {
      const t = await d.tokens.forUser(ctx.tenantId, ctx.userId);
      if (t) out.user_token = t;
    }
    if (names.has("hub_ticket") || names.has("hub_conversation_id"))
      Object.assign(out, await flowInputs(d, call, names));
    return out;
  };
}
