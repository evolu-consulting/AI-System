// HUB-FR-101 · X2b tx2 đăng tin agent (plan D4, §4.2, §5 hàng Đăng/Reconcile). Chạy trong `withHubScope({kind:"system"})`.
// Đọc run (không khoá) → definer `hub.room_post_agent_message` (khoá rooms → runs → room_members → room_messages) →
// `hub.room_fanout_sys`. Không log nội dung.
import type { Ask, RoomAgentRef } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { FanoutRow } from "../room-events";

type Num = number | string;
type Ts = Date | string;

export type RunOutcomeRow = {
  runId: string;
  roomId: string;
  /** Thread (`flows.room_flow_id`). */
  threadId: string | null;
  callerId: string;
  caller: { id: string; displayName: string | null; username: string | null };
  status: "running" | "finished" | "failed" | "cancelled";
  locale: "vi" | "en";
  answerMessageId: string;
  triggerMessageId: string;
  /** `room_messages.sender_id`: agent (run `direct` / agent Orchestrator chọn) hoặc tenant Orchestrator. */
  senderId: string;
  agent: RoomAgentRef | null;
  content: string;
  ask: Ask | null;
  pendingConfirm: boolean;
  stepCount: number;
  runMs: number;
};

type OutcomeSql = {
  id: string;
  room_id: string;
  thread_id: string | null;
  user_id: string;
  caller_name: string | null;
  caller_username: string | null;
  status: RunOutcomeRow["status"];
  locale: "vi" | "en";
  answer_message_id: string;
  user_message_id: string;
  sender_id: string;
  agent_key: string | null;
  agent_name: RoomAgentRef["name"] | null;
  content: string | null;
  ask: Ask | null;
  pending_confirm: boolean;
  step_count: Num;
  run_ms: Num;
};

const toOutcome = (r: OutcomeSql): RunOutcomeRow => ({
  runId: r.id,
  roomId: r.room_id,
  threadId: r.thread_id,
  callerId: r.user_id,
  caller: { id: r.user_id, displayName: r.caller_name, username: r.caller_username },
  status: r.status,
  locale: r.locale,
  answerMessageId: r.answer_message_id,
  triggerMessageId: r.user_message_id,
  senderId: r.sender_id,
  agent: r.agent_key && r.agent_name ? { key: r.agent_key, name: r.agent_name } : null,
  content: r.content ?? "",
  ask: r.ask,
  pendingConfirm: r.pending_confirm,
  stepCount: Number(r.step_count),
  runMs: Math.max(0, Number(r.run_ms)),
});

/**
 * Kết quả run phòng (tin trả lời ở hội thoại nền, xác nhận pending, số bước). null = không phải run phòng. Không tin cột
 * `runs` đơn lẻ (security-1 #1): `threadId` chỉ có khi flow nền thuộc hội thoại nền của (phòng, người gọi); `content`/`ask`
 * chỉ từ tin assistant của chính run. Definer kiểm lại các điều đó **và** tin gọi (`room_messages` không đọc được ở scope
 * system) ⇒ `threadId` null ⇒ definer chắc chắn `skipped`. Tên agent chỉ khi agent được cấp cho tenant của run (security-2 M1).
 */
export async function runOutcome(tx: Tx, runId: string): Promise<RunOutcomeRow | null> {
  const [row] = await tx.execute<OutcomeSql>(sql`
    select r.id, r.room_id, case when c.id is not null then f.room_flow_id end as thread_id, r.user_id,
      u.display_name as caller_name, u.username as caller_username, r.status, r.locale, r.answer_message_id,
      r.user_message_id, coalesce(r.agent_id, f.agent_id, r.orchestrator_tenant_id, r.tenant_id) as sender_id,
      a.key as agent_key, a.name as agent_name, pm.content, pm.ask,
      exists (select 1 from hub.tool_confirmations t
              where t.run_id = r.id and t.tenant_id = r.tenant_id and t.status = 'pending') as pending_confirm,
      (select count(*) from hub.run_steps s where s.run_id = r.id and s.tenant_id = r.tenant_id) as step_count,
      floor(extract(epoch from (coalesce(r.finished_at, now()) - r.started_at)) * 1000) as run_ms
    from hub.runs r
    join hub.flows f on f.id = r.flow_id and f.tenant_id = r.tenant_id
    left join hub.conversations c on c.id = f.conversation_id and c.tenant_id = r.tenant_id
      and c.room_id = r.room_id and c.user_id = r.user_id and f.user_id = r.user_id
    left join hub.agents a on a.id = coalesce(r.agent_id, f.agent_id)
      and exists (select 1 from hub.agent_entitlements e where e.agent_id = a.id and e.tenant_id = r.tenant_id)
    left join hub.messages pm on pm.id = r.answer_message_id and pm.tenant_id = r.tenant_id and pm.run_id = r.id
      and pm.user_id = r.user_id and pm.flow_id = r.flow_id and pm.role = 'assistant'
    left join admin.users u on u.id = r.user_id and u.tenant_id = r.tenant_id
    where r.id = ${runId} and r.room_id is not null`);
  return row ? toOutcome(row) : null;
}

export type PostMeta = {
  run_status: "finished" | "failed" | "cancelled";
  wait_kind?: "need_input" | "side_effect";
  /** Chỉ khi `wait_kind = need_input` (CHECK `room_messages_ask_ck`, 23514). */
  ask?: Ask;
  step_count: number;
  run_ms: number;
};

export type PostResult = {
  posted: boolean;
  reason: "posted" | "already" | "skipped";
  seq: number | null;
  createdAt: Date | null;
  placement: "main" | "flow" | null;
};

/**
 * Definer idempotent (`runs.room_posted_at`): `already` = đã đăng / run còn `running`; `skipped` = R17 hoặc hàng `runs`
 * không khớp phòng/thread/tin (đánh dấu đã xử lý). Sender suy trong definer (security-1 #6, `p_sender` bỏ qua).
 */
export async function postAgentMessage(
  tx: Tx,
  p: { runId: string; content: string; meta: PostMeta },
): Promise<PostResult> {
  const [row] = await tx.execute<{
    posted: boolean;
    reason: PostResult["reason"];
    seq: Num | null;
    created_at: Ts | null;
    placement: "main" | "flow" | null;
  }>(sql`
    select * from hub.room_post_agent_message(${p.runId}::uuid, null::uuid, ${p.content},
      ${JSON.stringify(p.meta)}::jsonb)`);
  if (!row) throw new Error("room_post_agent_message returned no row");
  return {
    posted: row.posted,
    reason: row.reason,
    seq: row.seq === null ? null : Number(row.seq),
    createdAt: row.created_at === null ? null : new Date(row.created_at),
    placement: row.placement,
  };
}

/** Chưa đọc của phòng + tổng chưa đọc của mọi thành viên hiện tại (sau khi đăng, cùng tx2). */
export async function fanoutSys(tx: Tx, roomId: string): Promise<FanoutRow[]> {
  const rows = await tx.execute<{ user_id: string; unread: Num; total: Num }>(sql`
    select user_id, unread, total from hub.room_fanout_sys(${roomId}::uuid)`);
  return rows.map((r) => ({
    user_id: r.user_id,
    unread: Number(r.unread),
    total: Number(r.total),
  }));
}

/** Reconcile · run phòng đã dừng mà chưa đăng (`runs_room_unposted_idx`), cũ trước; bỏ `skip` (đang lùi). */
export async function unpostedRuns(
  tx: Tx,
  limit = 20,
  skip: readonly string[] = [],
): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select r.id from hub.runs r
    where r.room_id is not null and r.room_posted_at is null and r.status <> 'running'
      and r.id <> all(${`{${skip.join(",")}}`}::uuid[])
    order by r.finished_at limit ${limit}`);
  return rows.map((r) => r.id);
}
