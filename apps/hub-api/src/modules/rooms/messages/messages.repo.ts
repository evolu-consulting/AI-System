// HUB-FR-96 · HUB-FR-100 · truy vấn tin phòng: lịch sử, gửi, đã đọc (X2a plan-db §5 hàng Gửi/Đọc/Lịch sử, §6). Chạy trong
// `withHubScope({kind:"user"})`; mọi câu lọc `tenant_id` tường minh, RLS (`is_room_member`) là lưới. Gửi: chỉ gọi SAU
// `lockFor` (khoá hàng `rooms` trước `room_members`/`room_messages`). Đánh dấu đọc chỉ chạm hàng của mình, không khoá `rooms`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Me } from "../manage/rooms.repo";
import type { FanoutRow } from "../room-events";
import type { RoomMessageRow } from "../rooms.map";

type Ts = Date | string;
type Num = number | string;
const toDate = (v: Ts): Date => (v instanceof Date ? v : new Date(v));

type MessageSqlRow = {
  id: string;
  room_id: string;
  seq: Num;
  sender_type: "user" | "agent";
  sender_id: string | null;
  content: string;
  client_msg_id: string | null;
  created_at: Ts;
  display_name: string | null;
  username: string | null;
};

function toRow(r: MessageSqlRow): RoomMessageRow {
  return {
    id: r.id,
    roomId: r.room_id,
    seq: Number(r.seq),
    senderType: r.sender_type,
    sender: { id: r.sender_id ?? r.id, displayName: r.display_name, username: r.username },
    content: r.content,
    clientMsgId: r.client_msg_id,
    createdAt: toDate(r.created_at),
  };
}

const COLS = sql`m.id, m.room_id, m.seq, m.sender_type, m.sender_id, m.content, m.client_msg_id, m.created_at,
  u.display_name, u.username`;

/** R15 · tối đa `limit + 1` tin có `seq < before` (vắng ⇒ tin cuối), `seq` giảm dần (`room_messages_seq_uq`). */
export async function pageDesc(
  tx: Tx,
  me: Me,
  roomId: string,
  q: { beforeSeq?: number; limit: number },
): Promise<RoomMessageRow[]> {
  const before = q.beforeSeq === undefined ? sql`` : sql`and m.seq < ${q.beforeSeq}`;
  const rows = await tx.execute<MessageSqlRow>(sql`
    select ${COLS}
    from hub.room_messages m
    left join admin.users u on u.id = m.sender_id and u.tenant_id = m.tenant_id
    where m.room_id = ${roomId} and m.tenant_id = ${me.tenantId} ${before}
    order by m.seq desc limit ${q.limit + 1}`);
  return rows.map(toRow);
}

/** Tin đã gửi với cùng `client_msg_id` của chính mình (gửi lại ⇒ 200, X2a-AC07). */
export async function findByClientId(
  tx: Tx,
  me: Me,
  roomId: string,
  clientMsgId: string,
): Promise<RoomMessageRow | null> {
  const [row] = await tx.execute<MessageSqlRow>(sql`
    select ${COLS}
    from hub.room_messages m
    left join admin.users u on u.id = m.sender_id and u.tenant_id = m.tenant_id
    where m.room_id = ${roomId} and m.tenant_id = ${me.tenantId} and m.sender_id = ${me.userId}
      and m.client_msg_id = ${clientMsgId}`);
  return row ? toRow(row) : null;
}

/**
 * Cấp `seq` kế (dưới khoá hàng `rooms`). Mốc thời gian = `clock_timestamp()` SAU khi giữ khoá (không phải `now()` = đầu
 * transaction) cắt tới ms (cursor `GET /rooms`) ⇒ thứ tự thời gian khớp thứ tự khoá với bớt/rời (P07).
 */
export async function bumpSeq(tx: Tx, me: Me, roomId: string): Promise<{ seq: number; at: Date }> {
  const [row] = await tx.execute<{ last_seq: Num; last_activity_at: Ts }>(sql`
    update hub.rooms set last_seq = last_seq + 1,
      last_activity_at = date_trunc('milliseconds', clock_timestamp())
    where id = ${roomId} and tenant_id = ${me.tenantId}
    returning last_seq, last_activity_at`);
  if (!row) throw new Error("room vanished under lock");
  return { seq: Number(row.last_seq), at: toDate(row.last_activity_at) };
}

export async function insertMessage(
  tx: Tx,
  me: Me,
  p: { roomId: string; seq: number; content: string; clientMsgId: string; at: Date },
): Promise<RoomMessageRow> {
  const [row] = await tx.execute<MessageSqlRow>(sql`
    with m as (
      insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, client_msg_id, created_at)
      values (${p.roomId}, ${me.tenantId}, ${p.seq}, 'user', ${me.userId}, ${p.content}, ${p.clientMsgId},
        ${p.at.toISOString()}::timestamptz)
      returning *)
    select ${COLS} from m
    left join admin.users u on u.id = m.sender_id and u.tenant_id = m.tenant_id`);
  if (!row) throw new Error("insert room_messages returned no row");
  return toRow(row);
}

/** D5 · mốc đọc của mình chỉ tăng; trả mốc sau khi ghi (null = không còn là thành viên). */
export async function advanceRead(
  tx: Tx,
  me: Me,
  roomId: string,
  seq: number,
): Promise<number | null> {
  const [row] = await tx.execute<{ last_read_seq: Num }>(sql`
    update hub.room_members set last_read_seq = greatest(last_read_seq, ${seq})
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and user_id = ${me.userId} and left_at is null
    returning last_read_seq`);
  return row ? Number(row.last_read_seq) : null;
}

/** R07 · tin mới trong DM ⇒ hết ẩn cho cả hai bên (policy UPDATE cho phép hàng peer, chặn tự nâng owner). */
export async function unhideAll(tx: Tx, me: Me, roomId: string): Promise<void> {
  await tx.execute(sql`
    update hub.room_members set hidden_at = null
    where room_id = ${roomId} and tenant_id = ${me.tenantId} and left_at is null and hidden_at is not null`);
}

/** D13 · chưa đọc của phòng + tổng chưa đọc của từng thành viên (hàm definer: người gửi không thấy phòng khác). */
export async function fanout(tx: Tx, roomId: string): Promise<FanoutRow[]> {
  const rows = await tx.execute<{ user_id: string; unread: Num; total: Num }>(sql`
    select user_id, unread, total from hub.room_fanout(${roomId}::uuid)`);
  return rows.map((r) => ({
    user_id: r.user_id,
    unread: Number(r.unread),
    total: Number(r.total),
  }));
}

/** Đánh dấu đọc: `last_seq` phòng + mốc đọc của mình, không khoá (plan-db §6). null ⇒ không phải thành viên ⇒ 404. */
export async function readState(
  tx: Tx,
  me: Me,
  roomId: string,
): Promise<{ lastSeq: number; lastReadSeq: number } | null> {
  const [row] = await tx.execute<{ last_seq: Num; last_read_seq: Num }>(sql`
    select r.last_seq, m.last_read_seq
    from hub.rooms r
    join hub.room_members m on m.room_id = r.id and m.user_id = ${me.userId} and m.left_at is null
    where r.id = ${roomId} and r.tenant_id = ${me.tenantId} and r.deleted_at is null`);
  return row ? { lastSeq: Number(row.last_seq), lastReadSeq: Number(row.last_read_seq) } : null;
}
