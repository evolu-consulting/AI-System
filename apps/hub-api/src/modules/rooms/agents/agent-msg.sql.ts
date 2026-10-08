// HUB-FR-101 · HUB-FR-95 · X2b cột/JOIN đọc tin agent trong timeline (plan D3). Scope user: `hub.runs`/`hub.messages` qua
// RLS chỉ trả hàng của người gọi ⇒ người khác không bao giờ nhận bản riêng (`side_effect`), không lọc tay.
import type { Ask, RoomAgentRef } from "@ai/contracts/chat";
import { sql } from "drizzle-orm";
import type { AgentData, WaitKind } from "./room-post.view";

type Num = number | string;

/** Alias bảng chính `m` = `hub.room_messages`. */
export const AGENT_COLS = sql`m.run_id, m.trigger_message_id, m.run_status, m.wait_kind, m.ask,
  m.step_count, m.run_ms, ag.key as agent_key, ag.name as agent_name, tm.sender_id as caller_id,
  cu.display_name as caller_name, cu.username as caller_username, pm.content as private_content,
  pm.ask as private_ask`;

export const AGENT_JOINS = sql`
  left join hub.agents ag on m.sender_type = 'agent' and ag.id = m.sender_id
  left join hub.room_messages tm on m.sender_type = 'agent' and tm.id = m.trigger_message_id
    and tm.room_id = m.room_id
  left join admin.users cu on cu.id = tm.sender_id and cu.tenant_id = m.tenant_id
  left join hub.runs vr on m.wait_kind = 'side_effect' and vr.id = m.run_id and vr.tenant_id = m.tenant_id
  left join hub.messages pm on pm.id = vr.answer_message_id and pm.tenant_id = m.tenant_id`;

export type AgentSqlCols = {
  sender_type: "user" | "agent";
  content: string;
  run_id?: string | null;
  trigger_message_id?: string | null;
  run_status?: AgentData["runStatus"] | null;
  wait_kind?: WaitKind | null;
  ask?: Ask | null;
  step_count?: Num | null;
  run_ms?: Num | null;
  agent_key?: string | null;
  agent_name?: RoomAgentRef["name"] | null;
  caller_id?: string | null;
  caller_name?: string | null;
  caller_username?: string | null;
  private_content?: string | null;
  private_ask?: Ask | null;
};

const num = (v: Num | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Hàng tin agent đủ cột ⇒ `AgentData`; tin người / thiếu cột ⇒ null. */
export function agentDataOf(r: AgentSqlCols): AgentData | null {
  if (r.sender_type !== "agent" || !r.run_id || !r.trigger_message_id || !r.caller_id) return null;
  const agent = r.agent_key && r.agent_name ? { key: r.agent_key, name: r.agent_name } : null;
  return {
    runId: r.run_id,
    triggerMessageId: r.trigger_message_id,
    runStatus: r.run_status ?? "finished",
    waitKind: r.wait_kind ?? null,
    ask: r.ask ?? null,
    stepCount: num(r.step_count),
    runMs: num(r.run_ms),
    agent,
    caller: {
      id: r.caller_id,
      displayName: r.caller_name ?? null,
      username: r.caller_username ?? null,
    },
    content: r.content,
    privateContent: r.private_content ?? null,
    privateAsk: r.private_ask ?? null,
  };
}
