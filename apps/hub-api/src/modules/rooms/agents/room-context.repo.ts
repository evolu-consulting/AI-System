// HUB-FR-101 · HUB-BR-21 · X2b đọc phía gọi agent (plan §3 bước 4, §6): thread của phòng, run đang chờ, ngữ cảnh. Chạy
// trong `withHubScope({kind:"user"})` (RLS thành viên là lưới); mọi câu lọc `tenant_id` + `room_id` tường minh (lớp 1 cách
// ly §6). KHÔNG đọc `hub.messages` (hội thoại riêng / flow nền) cho ngữ cảnh.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Me } from "../manage/rooms.repo";
import { ROOM_CONTEXT_MAX, type RoomCtxRow } from "./room-agent.rules";

type Num = number | string;

/** Tin gốc của thread `flowId` trong phòng (tin `main` sớm nhất mang `flow_id`); null = không phải thread của phòng. */
export async function threadRoot(
  tx: Tx,
  me: Me,
  roomId: string,
  flowId: string,
): Promise<{ seq: number } | null> {
  const [row] = await tx.execute<{ seq: Num }>(sql`
    select m.seq from hub.room_messages m
    where m.room_id = ${roomId} and m.tenant_id = ${me.tenantId} and m.flow_id = ${flowId}
      and m.placement = 'main'
    order by m.seq limit 1`);
  return row ? { seq: Number(row.seq) } : null;
}

export type WaitingRow = { flowId: string; callerId: string; status: "running" | "waiting" };

/** Lượt `runId` của phòng theo definer `room_run_states` (thành viên thấy cả run người khác, không nội dung). */
export async function roomRunState(
  tx: Tx,
  roomId: string,
  runId: string,
): Promise<WaitingRow | null> {
  const [row] = await tx.execute<{
    flow_id: string;
    caller_id: string;
    status: WaitingRow["status"];
  }>(sql`
    select s.flow_id, s.caller_id, s.status from hub.room_run_states(${roomId}::uuid) s
    where s.run_id = ${runId}::uuid limit 1`);
  return row ? { flowId: row.flow_id, callerId: row.caller_id, status: row.status } : null;
}

/** Flow nền của run chờ (RLS `runs`: chỉ người gọi thấy). */
export async function runFlowOf(tx: Tx, me: Me, runId: string): Promise<string | null> {
  const [row] = await tx.execute<{ flow_id: string }>(sql`
    select r.flow_id from hub.runs r
    where r.id = ${runId} and r.tenant_id = ${me.tenantId} and r.user_id = ${me.userId}`);
  return row?.flow_id ?? null;
}

/** D15 · agent của các xác nhận `pending` trên flow nền của mình. */
export async function pendingConfirmAgents(tx: Tx, me: Me, flowId: string): Promise<string[]> {
  const rows = await tx.execute<{ agent_id: string }>(sql`
    select distinct t.agent_id from hub.tool_confirmations t
    where t.flow_id = ${flowId} and t.tenant_id = ${me.tenantId} and t.user_id = ${me.userId}
      and t.status = 'pending'`);
  return rows.map((r) => r.agent_id);
}

type CtxSqlRow = {
  room_id: string;
  flow_id: string | null;
  seq: Num;
  sender_type: "user" | "agent";
  sender_name: string | null;
  content: string;
  placement: "main" | "flow";
};

const toCtx = (r: CtxSqlRow): RoomCtxRow => ({
  roomId: r.room_id,
  flowId: r.flow_id,
  seq: Number(r.seq),
  senderType: r.sender_type,
  senderName: r.sender_name ?? "",
  content: r.content,
  placement: r.placement,
});

const CTX_COLS = sql`m.room_id, m.flow_id, m.seq, m.sender_type, m.content, m.placement,
  coalesce(nullif(u.display_name, ''), nullif(u.username, ''), m.sender_id::text) as sender_name`;

/**
 * §6 · ≤ `limit` tin có `seq < before`, `seq` giảm dần: vắng `flowId` ⇒ tin `main` của timeline (`room_messages_main_idx`,
 * ≤ 20); có ⇒ mọi tin của thread (`room_messages_flow_idx`, ≤ 50).
 */
export async function contextRows(
  tx: Tx,
  me: Me,
  q: { roomId: string; before: number; flowId?: string; limit?: number },
): Promise<RoomCtxRow[]> {
  const where = q.flowId ? sql`m.flow_id = ${q.flowId}` : sql`m.placement = 'main'`;
  const limit = q.limit ?? (q.flowId ? ROOM_CONTEXT_MAX.thread : ROOM_CONTEXT_MAX.main);
  const rows = await tx.execute<CtxSqlRow>(sql`
    select ${CTX_COLS} from hub.room_messages m
    left join admin.users u on u.id = m.sender_id and u.tenant_id = m.tenant_id
    where m.room_id = ${q.roomId} and m.tenant_id = ${me.tenantId} and ${where} and m.seq < ${q.before}
    order by m.seq desc limit ${limit}`);
  return rows.map(toCtx);
}
