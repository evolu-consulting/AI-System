// CR-132 M3 · HD-MSG-01..12 · SQL hội thoại + thành viên trong tx `PackUow` (role `contracts_rw`, RLS tenant + thành viên — 0107). `tenant_id` tường minh
// (từ token) ngoài RLS; mọi câu tham số, văn bản hằng; số câu mỗi thao tác cố định (không vòng theo hàng). Không phải thành viên ⇒ không dòng ⇒ use case 404.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { MessagesRepo, MsgFacts, RawConversation } from "../application/messages.ports";
import { iso } from "./messages.sql";
import { messagesSendRepo } from "./messages-send.repo";

const MEMBERS_JSON = sql`(select coalesce(json_agg(json_build_object('user_id', mm.user_id, 'role', mm.role,
    'joined_at', ${iso("mm.joined_at")}, 'last_read_seq', mm.last_read_seq) order by mm.joined_at, mm.user_id), '[]'::json)
  from contracts.msg_members mm where mm.tenant_id = c.tenant_id and mm.conversation_id = c.id)`;

/** Tóm tắt hội thoại của MỘT người: tin cuối (lateral theo PK), chưa đọc (lateral, trần 99, bỏ qua khi đã đọc hết), người còn lại của 1-1. */
/**
 * Tóm tắt hội thoại của MỘT người. `pick` = bộ lọc/sắp/`limit` áp lên (thành viên × hội thoại) TRƯỚC khi tính phần đắt (tin cuối, chưa đọc,
 * thành viên) ⇒ chỉ tính cho trang được chọn, không cho cả 200 hội thoại. Tin cuối (lateral theo PK), chưa đọc (lateral trần 99, bỏ qua khi đã đọc hết).
 */
function summary(t: string, me: string, withMembers: boolean, pick: SQL) {
  return sql`select c.id, c.kind, c.title, ${iso("c.last_at")} as last_at, c.my_role,
      (select count(*)::int from contracts.msg_members mm where mm.tenant_id = c.tenant_id and mm.conversation_id = c.id) as member_count,
      (select mm.user_id from contracts.msg_members mm where mm.tenant_id = c.tenant_id and mm.conversation_id = c.id
         and mm.user_id <> c.me_id and c.kind = 'direct' limit 1) as peer_id,
      u.n as unread,
      case when lm.seq is null then null else json_build_object('seq', lm.seq, 'sender_id', lm.sender_id,
        'preview', lm.preview, 'has_files', lm.has_files, 'deleted', lm.deleted, 'at', lm.at) end as last,
      ${withMembers ? MEMBERS_JSON : sql`null::json`} as members
    from (select c.tenant_id, c.id, c.kind, c.title, c.last_at, c.last_seq, me.user_id as me_id, me.role as my_role, me.last_read_seq as me_read
      from contracts.msg_members me
      join contracts.msg_conversations c on c.tenant_id = me.tenant_id and c.id = me.conversation_id
      where me.tenant_id = ${t}::uuid and me.user_id = ${me}::uuid ${pick}) c
    left join lateral (select x.seq, x.sender_id, case when x.deleted_at is null then left(x.body, 240) else '' end as preview,
        exists (select 1 from contracts.msg_files f where f.tenant_id = x.tenant_id and f.conversation_id = x.conversation_id and f.seq = x.seq) as has_files,
        x.deleted_at is not null as deleted, ${iso("x.created_at")} as at
      from contracts.msg_messages x where x.tenant_id = c.tenant_id and x.conversation_id = c.id order by x.seq desc limit 1) lm on true
    cross join lateral (select count(*)::int as n from (select 1 from contracts.msg_messages x
        where c.last_seq > c.me_read and x.tenant_id = c.tenant_id and x.conversation_id = c.id
          and x.seq > c.me_read and x.sender_id <> c.me_id and x.deleted_at is null limit 99) s) u
    order by c.last_at desc, c.id desc`;
}

export function messagesRepo(tx: Tx, t: string): MessagesRepo {
  return {
    conversations: (me, cursor, limit) =>
      tx.execute<RawConversation>(
        summary(
          t,
          me,
          false,
          sql`${cursor ? sql`and (c.last_at, c.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : sql``}
            order by c.last_at desc, c.id desc limit ${limit}::int`,
        ),
      ),
    conversation: async (me, cid) => {
      const [r] = await tx.execute<RawConversation>(
        summary(t, me, true, sql`and c.id = ${cid}::uuid`),
      );
      return r ?? null;
    },
    // Tổng chưa đọc — MỘT câu (spec §6): bỏ hội thoại đã đọc hết, quét khoảng PK `msg_messages` trần 100/hội thoại, kẹp 999. Dòng chưa đọc
    // chảy qua vòng lặp lồng và `LIMIT 999` dừng sớm ⇒ chi phí theo trần 999, không theo tổng số tin chưa đọc (cùng kết quả `least(sum, 999)`).
    unread: async (me) => {
      const [r] = await tx.execute<{ total: number }>(sql`
        select count(*)::int as total from (select 1 from contracts.msg_members m
          join contracts.msg_conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id and c.last_seq > m.last_read_seq
          cross join lateral (select 1 from contracts.msg_messages x
            where x.tenant_id = m.tenant_id and x.conversation_id = m.conversation_id and x.seq > m.last_read_seq
              and x.sender_id <> m.user_id and x.deleted_at is null limit 100) u
          where m.tenant_id = ${t}::uuid and m.user_id = ${me}::uuid limit 999) s`);
      return r?.total ?? 0;
    },
    facts: async (me, cid, lock) => {
      const [r] =
        await tx.execute<MsgFacts>(sql`select c.kind, c.last_seq::int as last_seq, me.role as my_role, ${MEMBERS_JSON} as members
        from contracts.msg_conversations c
        join contracts.msg_members me on me.tenant_id = c.tenant_id and me.conversation_id = c.id and me.user_id = ${me}::uuid
        where c.tenant_id = ${t}::uuid and c.id = ${cid}::uuid ${lock ? sql`for update of c` : sql``}`);
      return r ?? null;
    },
    findDm: async (key) => {
      const [r] = await tx.execute<{ id: string }>(sql`select id from contracts.msg_conversations
        where tenant_id = ${t}::uuid and dm_key = ${key}`);
      return r?.id ?? null;
    },
    createConversation: async (c) => {
      await tx.execute(sql`insert into contracts.msg_conversations (tenant_id, id, kind, title, dm_key, created_by)
        values (${t}::uuid, ${c.id}::uuid, ${c.kind}, ${c.title}, ${c.dmKey}, ${c.createdBy}::uuid)`);
    },
    addMembers: async (cid, rows, readFrom) => {
      if (rows.length === 0) return;
      await tx.execute(sql`insert into contracts.msg_members (tenant_id, conversation_id, user_id, role, last_read_seq)
        select ${t}::uuid, ${cid}::uuid, x.user_id, x.role, ${readFrom}::bigint
        from json_to_recordset(${JSON.stringify(rows)}::text::json) as x(user_id uuid, role text)`);
    },
    rename: async (cid, title) => {
      await tx.execute(sql`update contracts.msg_conversations set title = ${title}
        where tenant_id = ${t}::uuid and id = ${cid}::uuid`);
    },
    setOwner: async (cid, userId) => {
      await tx.execute(sql`update contracts.msg_members set role = 'owner'
        where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and user_id = ${userId}::uuid`);
    },
    removeMember: async (cid, userId) => {
      await tx.execute(sql`delete from contracts.msg_members
        where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and user_id = ${userId}::uuid`);
    },
    dropIfEmpty: async (cid) => {
      const [r] = await tx.execute<{ r: boolean }>(
        sql`select contracts.msg_drop_if_empty(${cid}::uuid) as r`,
      );
      return r?.r === true;
    },
    ...messagesSendRepo(tx, t),
  };
}
