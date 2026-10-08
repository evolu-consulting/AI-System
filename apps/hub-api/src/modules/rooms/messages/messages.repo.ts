// HUB-FR-96 · HUB-FR-100 · truy vấn tin phòng: lịch sử, gửi, đã đọc (X2a plan-db §5 hàng Gửi/Đọc/Lịch sử, §6). Chạy trong
// `withHubScope({kind:"user"})`; mọi câu lọc `tenant_id` tường minh, RLS (`is_room_member`) là lưới. Gửi: chỉ gọi SAU
// `lockFor` (khoá hàng `rooms` trước `room_members`/`room_messages`). Đánh dấu đọc cũng sau `lockFor` (RV1 #5), chỉ chạm hàng mình.
import { ROOM_FLOW_RECENT_MAX, type RoomAgentRef } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { AGENT_COLS, AGENT_JOINS, type AgentSqlCols, agentDataOf } from "../agents/agent-msg.sql";
import { rowFor } from "../agents/room-post.view";
import type { Me } from "../manage/rooms.repo";
import type { FanoutRow } from "../room-events";
import type { FlowRecentRow, RoomMessageRow } from "../rooms.map";

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
  flow_id: string | null;
  placement: "main" | "flow";
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
    ...(r.flow_id && { flowId: r.flow_id, placement: r.placement }),
  };
}

const COLS = sql`m.id, m.room_id, m.seq, m.sender_type, m.sender_id, m.content, m.client_msg_id, m.created_at,
  u.display_name, u.username, m.flow_id, m.placement`;

/** X2b · tóm tắt thread gắn trên tin agent `main` gốc (vắng ở tin khác: aggregate 0 / null). CR-050: + chưa xem, ≤ 3 tin mới. */
type FlowSqlCols = {
  flow_message_count: Num;
  flow_last_active_at: Ts | null;
  flow_unread: Num | null;
  flow_recent: FlowRecentSql[] | null;
};

/** CR-050 · một phần tử `json_agg` của `flow_recent` (json ⇒ ts là chuỗi). */
type FlowRecentSql = {
  id: string;
  seq: Num;
  sender_type: "user" | "agent";
  sender_id: string | null;
  display_name: string | null;
  username: string | null;
  agent_key: string | null;
  agent_name: RoomAgentRef["name"] | null;
  content: string;
  created_at: Ts;
  unread: boolean;
};

/** Chỉ tính cho tin agent `main` gốc của thread (filter một lần theo hàng ngoài `m`). */
const ROOT = sql`m.sender_type = 'agent' and m.placement = 'main' and m.flow_id is not null`;

/**
 * CR-050 · "của mình" trong thread: tin người do mình gửi, hoặc tin agent của lượt mình gọi (`tt` = tin gọi, như R19) —
 * không bao giờ tính là chưa xem. Alias `t` = tin thread, `tt` = tin gọi của `t`.
 */
const mineIn = (me: Me) =>
  sql`((t.sender_type = 'user' and t.sender_id = ${me.userId}) or (t.sender_type = 'agent' and tt.sender_id = ${me.userId}))`;

/** CR-050 · mốc đọc thread của mình (RLS `room_flow_reads` chỉ trả hàng của mình); chưa có hàng ⇒ 0. */
const readCursor = (
  me: Me,
  room: SQL,
  flow: SQL,
) => sql`coalesce((select fr.last_read_seq from hub.room_flow_reads fr
  where fr.room_id = ${room} and fr.flow_id = ${flow} and fr.user_id = ${me.userId}), 0)`;

/** CR-050 · lúc mình (lại) vào phòng — tin trước đó không tính là chưa xem (review #5: người vào sau không bị ngập highlight). */
const joinedAt = (me: Me, room: SQL) => sql`(select mb.joined_at from hub.room_members mb
  where mb.room_id = ${room} and mb.user_id = ${me.userId} and mb.left_at is null)`;

/** CR-050 · tin thread `t` chưa xem: sau mốc đọc, sau lúc vào phòng, không phải của mình. */
const unseen = (me: Me, cur: SQL, joined: SQL) =>
  sql`(t.seq > ${cur} and t.created_at > ${joined} and not ${mineIn(me)})`;

/**
 * `flow{message_count,last_active_at}` (plan §2.2): đếm tin `flow` của thread + tin mới nhất; `room_messages_flow_idx
 * (room_id, flow_id, seq)`. CR-050: `fc.cur` = mốc đọc thread của mình (`room_flow_reads`, RLS chỉ hàng của mình; vắng = 0),
 * `fc.joined` = lúc mình vào phòng ⇒ `flow_unread` = tin `flow` chưa xem (`unseen`); `flow_recent` = ≤ 3 tin `flow` mới nhất.
 */
const flowLateral = (me: Me) => sql`
  left join lateral (
    select ${readCursor(me, sql`m.room_id`, sql`m.flow_id`)} as cur, ${joinedAt(me, sql`m.room_id`)} as joined
    where ${ROOT}) fc on true
  left join lateral (
    select count(*) filter (where t.placement = 'flow') as flow_message_count,
      max(t.created_at) as flow_last_active_at,
      count(*) filter (where t.placement = 'flow' and ${unseen(me, sql`fc.cur`, sql`fc.joined`)}) as flow_unread
    from hub.room_messages t
    left join hub.room_messages tt on t.sender_type = 'agent' and tt.id = t.trigger_message_id and tt.room_id = t.room_id
    where ${ROOT} and t.room_id = m.room_id and t.tenant_id = m.tenant_id and t.flow_id = m.flow_id) fs on true
  left join lateral (
    select json_agg(x order by x.seq) as flow_recent
    from (
      select t.id, t.seq, t.sender_type, t.sender_id, su.display_name, su.username, ra.key as agent_key,
        ra.name as agent_name, t.content, t.created_at, ${unseen(me, sql`fc.cur`, sql`fc.joined`)} as unread
      from hub.room_messages t
      left join hub.room_messages tt on t.sender_type = 'agent' and tt.id = t.trigger_message_id
        and tt.room_id = t.room_id
      left join admin.users su on t.sender_type = 'user' and su.id = t.sender_id and su.tenant_id = t.tenant_id
      left join hub.agents ra on t.sender_type = 'agent' and ra.id = t.sender_id
      where ${ROOT} and t.room_id = m.room_id and t.tenant_id = m.tenant_id and t.flow_id = m.flow_id
        and t.placement = 'flow'
      order by t.seq desc
      limit ${ROOM_FLOW_RECENT_MAX}) x) fx on true`;

const FLOW_COLS = sql`fs.flow_message_count, fs.flow_last_active_at, fs.flow_unread, fx.flow_recent`;

const toRecent = (r: FlowRecentSql): FlowRecentRow => ({
  id: r.id,
  seq: Number(r.seq),
  senderType: r.sender_type,
  sender: { id: r.sender_id ?? r.id, displayName: r.display_name, username: r.username },
  agent: r.agent_key && r.agent_name ? { key: r.agent_key, name: r.agent_name } : null,
  content: r.content,
  createdAt: toDate(r.created_at),
  unread: r.unread,
});

const withFlow = (row: RoomMessageRow, f: FlowSqlCols): RoomMessageRow =>
  f.flow_last_active_at === null
    ? row
    : {
        ...row,
        flow: {
          messageCount: Number(f.flow_message_count),
          lastActiveAt: toDate(f.flow_last_active_at),
          unread: Number(f.flow_unread ?? 0),
          recent: (f.flow_recent ?? []).map(toRecent),
        },
      };

/**
 * R15 · tối đa `limit + 1` tin có `seq < before` (vắng ⇒ tin cuối), `seq` giảm dần. X2b: `flowId` vắng ⇒ timeline
 * (`placement='main'`, `room_messages_main_idx`); có ⇒ mọi tin của thread (`main`+`flow`, `room_messages_flow_idx`) —
 * gọi SAU khi đã kiểm thread thuộc phòng (`threadRoot`).
 */
export async function pageDesc(
  tx: Tx,
  me: Me,
  roomId: string,
  q: { beforeSeq?: number; limit: number; flowId?: string },
): Promise<RoomMessageRow[]> {
  const before = q.beforeSeq === undefined ? sql`` : sql`and m.seq < ${q.beforeSeq}`;
  const where =
    q.flowId === undefined ? sql`and m.placement = 'main'` : sql`and m.flow_id = ${q.flowId}`;
  const rows = await tx.execute<MessageSqlRow & AgentSqlCols & FlowSqlCols>(sql`
    select ${COLS}, ${AGENT_COLS}, ${FLOW_COLS}
    from hub.room_messages m
    left join admin.users u on u.id = m.sender_id and u.tenant_id = m.tenant_id ${AGENT_JOINS} ${flowLateral(me)}
    where m.room_id = ${roomId} and m.tenant_id = ${me.tenantId} ${where} ${before}
    order by m.seq desc limit ${q.limit + 1}`);
  // X2b D3 · tin agent theo người xem (bản riêng `side_effect` chỉ có khi RLS `runs` trả hàng = người gọi).
  return rows.map((r) => withFlow(rowFor(toRow(r), agentDataOf(r), me.userId), r));
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
 * Cấp `seq` kế qua definer `hub.room_next_seq` (RV1 #1: thành viên không sửa `last_seq` trực tiếp): khoá hàng `rooms`, kiểm
 * thành viên dưới khoá, `last_activity_at = clock_timestamp()` cắt ms (P07), DM ⇒ bỏ ẩn cả hai bên (R07). Gọi SAU `lockFor`.
 */
export async function bumpSeq(tx: Tx, me: Me, roomId: string): Promise<{ seq: number; at: Date }> {
  await tx.execute(sql`select hub.room_next_seq(${roomId}::uuid)`);
  const [row] = await tx.execute<{ last_seq: Num; last_activity_at: Ts }>(sql`
    select last_seq, last_activity_at from hub.rooms where id = ${roomId} and tenant_id = ${me.tenantId}`);
  if (!row) throw new Error("room vanished under lock");
  return { seq: Number(row.last_seq), at: toDate(row.last_activity_at) };
}

/** Tin người. `id` vắng ⇒ ngẫu nhiên; tin gọi agent: `id = runs.user_message_id` (X2b B1). `flowId` = thread (D12). */
export type NewMessage = {
  id?: string;
  roomId: string;
  seq: number;
  content: string;
  clientMsgId: string;
  at: Date;
  flowId?: string;
  placement?: "main" | "flow";
};

export async function insertMessage(tx: Tx, me: Me, p: NewMessage): Promise<RoomMessageRow> {
  const [row] = await tx.execute<MessageSqlRow>(sql`
    with m as (
      insert into hub.room_messages (id, room_id, tenant_id, seq, sender_type, sender_id, content, client_msg_id,
        created_at, flow_id, placement)
      values (${p.id ?? crypto.randomUUID()}, ${p.roomId}, ${me.tenantId}, ${p.seq}, 'user', ${me.userId},
        ${p.content}, ${p.clientMsgId}, ${p.at.toISOString()}::timestamptz, ${p.flowId ?? null}, ${p.placement ?? "main"})
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

/**
 * D13 · chưa đọc của phòng + tổng chưa đọc của từng thành viên (definer; tổng người khác chỉ có ngay sau khi gửi, RV1 #4).
 * CẢNH BÁO (security-2 N3): `room_fanout` nhận "vừa gửi" bằng `xmin = pg_current_xact_id_if_assigned()` ⇒ nếu INSERT tin
 * nằm trong SAVEPOINT (subtransaction, vd. `tx.transaction(...)` lồng) thì `xmin` là xid con ≠ xid top ⇒ `total` người khác
 * = NULL ⇒ phát 0. Gọi cùng mức transaction với `insertMessage`, không bọc INSERT trong savepoint.
 */
export async function fanout(tx: Tx, roomId: string): Promise<FanoutRow[]> {
  const rows = await tx.execute<{ user_id: string; unread: Num; total: Num | null }>(sql`
    select user_id, unread, total from hub.room_fanout(${roomId}::uuid)`);
  return rows.map((r) => ({
    user_id: r.user_id,
    unread: Number(r.unread),
    total: Number(r.total ?? 0),
  }));
}

/** Đánh dấu đọc: `last_seq` phòng + mốc đọc của mình (gọi SAU `lockFor`, RV1 #5). null ⇒ không phải thành viên ⇒ 404. */
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

/**
 * CR-050 · mốc đọc thread của mình chỉ tăng, kẹp ≤ seq lớn nhất của thread; trả số tin `flow` chưa xem sau khi ghi. Gọi SAU
 * `lockFor` + `threadRoot` (thread thuộc phòng); RLS `room_flow_reads` là lưới (chỉ hàng của mình, `is_room_thread`).
 */
export async function advanceFlowRead(
  tx: Tx,
  me: Me,
  p: { roomId: string; flowId: string; seq: number },
): Promise<number> {
  const { roomId, flowId, seq } = p;
  await tx.execute(sql`
    insert into hub.room_flow_reads as fr (room_id, tenant_id, flow_id, user_id, last_read_seq)
    select ${roomId}, ${me.tenantId}, ${flowId}, ${me.userId}, least(${seq}::bigint, coalesce(max(t.seq), 0))
    from hub.room_messages t
    where t.room_id = ${roomId} and t.tenant_id = ${me.tenantId} and t.flow_id = ${flowId}
    on conflict (room_id, flow_id, user_id)
      do update set last_read_seq = greatest(fr.last_read_seq, excluded.last_read_seq)`);
  const room = sql`${roomId}::uuid`;
  const cur = readCursor(me, room, sql`${flowId}::uuid`);
  const [row] = await tx.execute<{ unread: Num }>(sql`
    select count(*) as unread
    from hub.room_messages t
    left join hub.room_messages tt on t.sender_type = 'agent' and tt.id = t.trigger_message_id and tt.room_id = t.room_id
    where t.room_id = ${roomId} and t.tenant_id = ${me.tenantId} and t.flow_id = ${flowId} and t.placement = 'flow'
      and ${unseen(me, cur, joinedAt(me, room))}`);
  return Number(row?.unread ?? 0);
}
