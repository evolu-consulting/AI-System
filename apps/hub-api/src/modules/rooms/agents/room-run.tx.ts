// HUB-FR-101 · HUB-BR-21 · X2b ghi phía gọi agent trong tx `user` của người gọi (plan §1 D1, D5, D12; §5 hàng Gọi). Gọi SAU
// `lockFor(rooms)`. Thứ tự (B1): hội thoại nền (`room_id`) → flow nền (`room_flow_id`) → `createRunTx` → `runs.room_id` →
// tin gọi. Hội thoại nền / flow nền tạo lười, idempotent bằng unique `(room_id,user_id)` / `(room_flow_id,user_id)`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Me } from "../manage/rooms.repo";

/** Tiêu đề cố định của bản ghi nền ẩn (không lộ qua C1, D2). */
const SHIM_TITLE = "room";

/** D1 · hội thoại nền của (phòng, mình): tạo nếu chưa có; trả id. */
export async function ensureShim(tx: Tx, me: Me, roomId: string): Promise<string> {
  await tx.execute(sql`
    insert into hub.conversations (id, tenant_id, user_id, title, title_norm, room_id)
    values (${crypto.randomUUID()}, ${me.tenantId}, ${me.userId}, ${SHIM_TITLE}, ${SHIM_TITLE}, ${roomId})
    on conflict (room_id, user_id) where room_id is not null do nothing`);
  const [row] = await tx.execute<{ id: string }>(sql`
    select id from hub.conversations
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and user_id = ${me.userId}`);
  if (!row) throw new Error("room shim conversation missing");
  return row.id;
}

/**
 * D12 · flow nền của mình cho thread `thread` (null = mở thread mới: flow mới, `room_flow_id = id`). Người tag sau có
 * flow riêng trỏ về thread. Trả id flow nền (dùng cho `runs.flow_id`).
 */
export async function ensureFlow(
  tx: Tx,
  me: Me,
  p: { conversationId: string; thread: string | null; title: string },
): Promise<string> {
  const id = crypto.randomUUID();
  const roomFlow = p.thread ?? id;
  await tx.execute(sql`
    insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count, room_flow_id)
    values (${id}, ${me.tenantId}, ${me.userId}, ${p.conversationId}, ${p.title}, 0, ${roomFlow})
    on conflict (room_flow_id, user_id) where room_flow_id is not null do nothing`);
  const [row] = await tx.execute<{ id: string }>(sql`
    select id from hub.flows
    where room_flow_id = ${roomFlow} and tenant_id = ${me.tenantId} and user_id = ${me.userId}`);
  if (!row) throw new Error("room flow missing");
  return row.id;
}

/** Gắn run vào phòng (`runs.room_id`) ngay sau `createRunTx`, cùng tx. */
export async function setRunRoom(tx: Tx, me: Me, runId: string, roomId: string): Promise<void> {
  await tx.execute(sql`
    update hub.runs set room_id = ${roomId}
    where id = ${runId} and tenant_id = ${me.tenantId} and user_id = ${me.userId}`);
}
