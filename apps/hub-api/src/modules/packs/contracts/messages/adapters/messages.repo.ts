// CR-132 M3 · HD-MSG-01..12 · SQL hội thoại + thành viên trong tx `PackUow` (role `contracts_rw`, RLS tenant + thành viên — 0107). `tenant_id` tường minh
// (từ token) ngoài RLS; mọi câu tham số, văn bản hằng; số câu mỗi thao tác cố định (không vòng theo hàng). Không phải thành viên ⇒ không dòng ⇒ use case 404.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type {
  ListQuery,
  MessagesRepo,
  MsgFacts,
  RawConversation,
} from "../application/messages.ports";
import { iso, uuidArr } from "./messages.sql";
import { directoryRepo } from "./messages-directory.repo";
import { attachmentsRepo, searchRepo } from "./messages-find.repo";
import { prefsRepo } from "./messages-prefs.repo";
import { messagesSendRepo } from "./messages-send.repo";

const MEMBERS_JSON = sql`(select coalesce(json_agg(json_build_object('user_id', mm.user_id, 'role', mm.role,
    'joined_at', ${iso("mm.joined_at")}, 'last_read_seq', mm.last_read_seq) order by mm.joined_at, mm.user_id), '[]'::json)
  from contracts.msg_members mm where mm.tenant_id = c.tenant_id and mm.conversation_id = c.id)`;

/**
 * Tóm tắt hội thoại của MỘT người. `pick` = bộ lọc/sắp/`limit` áp lên (thành viên × hội thoại) TRƯỚC khi tính phần đắt (tin cuối, chưa đọc,
 * thành viên) ⇒ chỉ tính cho trang được chọn, không cho cả 200 hội thoại. Tin cuối (lateral theo PK), chưa đọc (lateral trần 99, bỏ qua khi đã đọc hết).
 */
function summary(t: string, me: string, withMembers: boolean, pick: SQL) {
  return sql`select c.id, c.kind, c.title, ${iso("c.last_at")} as last_at, c.last_at as last_ts, null::json as partner, c.my_role,
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
          and x.seq > c.me_read and x.sender_id <> c.me_id and x.deleted_at is null limit 100) s) u
    order by c.last_at desc, c.id desc`;
}

/**
 * CR-178 · chỉ cuộc còn tin chưa đọc: cùng luật đếm với `summary.unread` / `unread` (tin sau mốc đọc, không do mình gửi, chưa thu hồi); áp TRƯỚC `limit` nên trang luôn đầy.
 * CR-190 · cộng cuộc người gọi đã «đánh dấu chưa đọc» (badge và danh sách khớp nhau).
 */
const UNREAD_ONLY = sql`and ((c.last_seq > me.last_read_seq and exists (select 1 from contracts.msg_messages x
    where x.tenant_id = c.tenant_id and x.conversation_id = c.id and x.seq > me.last_read_seq and x.sender_id <> me.user_id and x.deleted_at is null))
    or exists (select 1 from contracts.msg_conv_prefs p where p.tenant_id = me.tenant_id and p.user_id = me.user_id and p.conv_kind = 'internal'
      and p.conv_id = c.id and p.marked_unread_at is not null))`;

/** CR-190 · id cuộc `partner` người gọi đã đánh dấu chưa đọc (mảng, MỘT truy vấn con) — truyền cho hàm hub; hàm hub vẫn chỉ xét cuộc người gọi là một đầu. */
const flaggedPartnerIds = (
  t: string,
  me: string,
) => sql`array(select p.conv_id from contracts.msg_conv_prefs p
  where p.tenant_id = ${t}::uuid and p.user_id = ${me}::uuid and p.conv_kind = 'partner' and p.marked_unread_at is not null)`;

/** Cuộc `partner` của người gọi (`pmsg_inbox`, MỘT lần gọi hàm) về cùng dạng cột với `summary` để `UNION ALL`. Tên/công ty/«chỉ đọc» đã tính trong hàm. */
function partnerPick(t: string, me: string, q: ListQuery): SQL {
  return sql`select pm.id, 'partner'::text as kind, null::text as title, ${iso("pm.last_at")} as last_at, pm.last_at as last_ts,
      'member'::text as my_role, 2 as member_count, pm.peer_user as peer_id, pm.unread, pm.last::json as last, null::json as members,
      json_build_object('peer_name', pm.peer_name, 'peer_title', pm.peer_title, 'peer_active', pm.peer_active, 'company_id', pm.company_id,
        'company_name', pm.company_name, 'read_only', pm.read_only) as partner
    from ${
      q.unreadOnly
        ? sql`hub.pmsg_inbox_unread(${q.company}::uuid, ${q.cursor?.at ?? null}::timestamptz, ${q.cursor?.id ?? null}::uuid, ${q.limit}::int, ${flaggedPartnerIds(t, me)})`
        : sql`hub.pmsg_inbox(${q.company}::uuid, ${q.cursor?.at ?? null}::timestamptz, ${q.cursor?.id ?? null}::uuid, ${q.limit}::int)`
    } pm`;
}

/** Danh sách hợp nhất (P9) — MỘT câu: mỗi nguồn LIMIT n (keyset `(last_at, id)` DESC dùng chung), rồi sắp + LIMIT n ngoài. */
function listSql(t: string, me: string, q: ListQuery): SQL {
  const cur = q.cursor;
  const internal = summary(
    t,
    me,
    false,
    sql`${cur ? sql`and (c.last_at, c.id) < (${cur.at}::timestamptz, ${cur.id}::uuid)` : sql``}
      ${q.unreadOnly ? UNREAD_ONLY : sql``}
      order by c.last_at desc, c.id desc limit ${q.limit}::int`,
  );
  const cols = sql`x.id, x.kind, x.title, x.last_at, x.my_role, x.member_count, x.peer_id, x.unread, x.last, x.members, x.partner`;
  const im = sql`select i.id, i.kind, i.title, i.last_at, i.last_ts, i.my_role, i.member_count, i.peer_id, i.unread, i.last, i.members, i.partner from im i`;
  const pm = sql`select p.id, p.kind, p.title, p.last_at, p.last_ts, p.my_role, p.member_count, p.peer_id, p.unread, p.last, p.members, p.partner from pm p`;
  const body =
    q.source.internal && q.source.partner ? sql`${im} union all ${pm}` : q.source.partner ? pm : im;
  const ctes = [
    q.source.internal ? sql`im as (${internal})` : null,
    q.source.partner ? sql`pm as (${partnerPick(t, me, q)})` : null,
  ].filter((x): x is SQL => x !== null);
  return sql`with ${sql.join(ctes, sql`, `)}
    select ${cols} from (${body}) x order by x.last_ts desc, x.id desc limit ${q.limit}::int`;
}

/**
 * CR-190 · cuộc người gọi «đánh dấu chưa đọc» mà KHÔNG còn tin chưa đọc thật tính +1 mỗi cuộc (cờ là «ít nhất một»; cuộc đã có tin chưa đọc thật không cộng đôi) và người gọi còn là một đầu / thành viên.
 * Nội bộ: cùng luật đếm với `summary.unread` (tin sau mốc, không do mình gửi, chưa thu hồi). `partner`: `hub.pmsg_flagged_idle` (hub 0166) áp đúng luật đó và kiểm «còn là một đầu». Một biểu thức, không theo dòng.
 */
const flaggedCount = (
  t: string,
  me: string,
  withPartner: boolean,
) => sql`((select count(*)::int from (select 1 from contracts.msg_conv_prefs p
    where p.tenant_id = ${t}::uuid and p.user_id = ${me}::uuid and p.marked_unread_at is not null and p.conv_kind = 'internal'
      and exists (select 1 from contracts.msg_members m where m.tenant_id = p.tenant_id and m.conversation_id = p.conv_id and m.user_id = p.user_id)
      and not exists (select 1 from contracts.msg_members m join contracts.msg_conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id
        where m.tenant_id = p.tenant_id and m.conversation_id = p.conv_id and m.user_id = p.user_id and c.last_seq > m.last_read_seq
          and exists (select 1 from contracts.msg_messages x where x.tenant_id = m.tenant_id and x.conversation_id = m.conversation_id
            and x.seq > m.last_read_seq and x.sender_id <> m.user_id and x.deleted_at is null))
    limit 999) f) + ${withPartner ? sql`(select count(*)::int from hub.pmsg_flagged_idle(${flaggedPartnerIds(t, me)}))` : sql`0`})`;

/** Đọc hội thoại: danh sách, chi tiết, tổng chưa đọc, sự thật cho kiểm quyền, tìm 1-1. */
function readRepo(
  tx: Tx,
  t: string,
): Pick<
  MessagesRepo,
  "conversations" | "conversation" | "conversationsByIds" | "unread" | "facts" | "findDm"
> {
  return {
    conversations: (me, q) => tx.execute<RawConversation>(listSql(t, me, q)),
    conversation: async (me, cid) => {
      const [r] = await tx.execute<RawConversation>(
        summary(t, me, true, sql`and c.id = ${cid}::uuid`),
      );
      return r ?? null;
    },
    // CR-190 · danh bạ nhóm: dòng đầy đủ (tin cuối, chưa đọc) CHỈ cho các cuộc của trang — MỘT câu `= any`, RLS thành viên.
    conversationsByIds: (me, ids) =>
      ids.length === 0
        ? Promise.resolve([])
        : tx.execute<RawConversation>(
            summary(t, me, false, sql`and c.id = any(${uuidArr(ids)}::uuid[])`),
          ),
    // Tổng chưa đọc — MỘT câu (spec §6): nội bộ (bỏ hội thoại đã đọc hết, quét khoảng PK `msg_messages` trần 100/hội thoại, dừng sớm ở 999) cộng `pmsg_unread()`
    // (cùng luật đếm cho cuộc `partner`), kẹp 999. Chi phí theo trần 999, không theo tổng số tin chưa đọc.
    unread: async (me, withPartner = true) => {
      const [r] = await tx.execute<{ total: number }>(sql`
        select least((select count(*)::int from (select 1 from contracts.msg_members m
          join contracts.msg_conversations c on c.tenant_id = m.tenant_id and c.id = m.conversation_id and c.last_seq > m.last_read_seq
          cross join lateral (select 1 from contracts.msg_messages x
            where x.tenant_id = m.tenant_id and x.conversation_id = m.conversation_id and x.seq > m.last_read_seq
              and x.sender_id <> m.user_id and x.deleted_at is null limit 100) u
          where m.tenant_id = ${t}::uuid and m.user_id = ${me}::uuid limit 999) s) + ${withPartner ? sql`hub.pmsg_unread()` : sql`0`} + ${flaggedCount(t, me, withPartner)}, 999)::int as total`);
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
  };
}

/** Ghi hội thoại + thành viên. */
function memberRepo(
  tx: Tx,
  t: string,
): Pick<
  MessagesRepo,
  "createConversation" | "addMembers" | "rename" | "setOwner" | "removeMember" | "dropIfEmpty"
> {
  return {
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
  };
}

export function messagesRepo(tx: Tx, t: string): MessagesRepo {
  return {
    ...readRepo(tx, t),
    ...memberRepo(tx, t),
    ...messagesSendRepo(tx, t),
    ...attachmentsRepo(tx, t),
    ...searchRepo(tx, t),
    ...prefsRepo(tx, t),
    ...directoryRepo(tx, t),
  };
}
