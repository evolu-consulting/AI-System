// CR-178 · SQL đọc «Ảnh & tệp» (M4) và tìm tin (M3) của cuộc nội bộ, trong tx `PackUow` (role `contracts_rw`, RLS tenant + thành viên — 0107). MỖI thao tác đúng MỘT câu SQL
// (không vòng theo hàng); `tenant_id` tường minh ngoài RLS; mọi giá trị là tham số, văn bản hằng.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type {
  AttachQuery,
  MessagesRepo,
  RawAttachment,
  RawSearchHit,
} from "../application/messages.ports";
import { iso } from "./messages.sql";

type R<K extends keyof MessagesRepo> = Pick<MessagesRepo, K>;

const kindSql = (k: AttachQuery["kind"]): SQL =>
  k === "image"
    ? sql`and f.mime like 'image/%'`
    : k === "file"
      ? sql`and f.mime not like 'image/%'`
      : sql``;

/** Tệp đã gửi của cuộc: đã gắn tin (seq không null), tin chưa thu hồi, tệp chưa xoá; keyset `(seq, file_id)` DESC trên PK/index `msg_files (tenant, conv, seq)`. */
export function attachmentsRepo(tx: Tx, t: string): R<"attachments"> {
  return {
    attachments: (cid, q) =>
      tx.execute<RawAttachment>(sql`select f.id, f.name, f.mime, f.size_bytes::int as size, mf.seq::int as seq, m.sender_id, ${iso("m.created_at")} as at
        from contracts.msg_files mf
        join contracts.files f on f.id = mf.file_id and f.tenant_id = mf.tenant_id and f.deleted_at is null
        join contracts.msg_messages m on m.tenant_id = mf.tenant_id and m.conversation_id = mf.conversation_id and m.seq = mf.seq and m.deleted_at is null
        where mf.tenant_id = ${t}::uuid and mf.conversation_id = ${cid}::uuid and mf.seq is not null ${kindSql(q.kind)}
          ${q.cur ? sql`and (mf.seq, mf.file_id) < (${q.cur.seq}::bigint, ${q.cur.id}::uuid)` : sql``}
        order by mf.seq desc, mf.file_id desc limit ${q.limit}::int`),
  };
}

/**
 * Tìm tin nội bộ (M3): `hub.fold` hai phía (cùng hàm với chỉ mục trigram `msg_messages_fold_trgm_ix` ⇒ dùng được chỉ mục), tin chưa thu hồi (khớp điều kiện của chỉ mục từng phần), keyset
 * `(created_at, conversation_id, seq)` DESC. Lọc + LIMIT trước, rồi mới join cuộc + tìm người 1-1 trên ≤ limit dòng. RLS giữ chỉ thành viên.
 */
export function searchRepo(tx: Tx, t: string): R<"search"> {
  return {
    search: (me, q) =>
      tx.execute<RawSearchHit>(sql`with h as (
          select m.conversation_id, m.seq, m.sender_id, m.created_at as ts, m.body from contracts.msg_messages m
          where m.tenant_id = ${t}::uuid and m.deleted_at is null and hub.fold(m.body) like '%' || hub.fold(${q.pattern}::text) || '%'
            ${q.conversationId ? sql`and m.conversation_id = ${q.conversationId}::uuid` : sql``}
            ${q.cur ? sql`and (m.created_at, m.conversation_id, m.seq) < (${q.cur.at}::timestamptz, ${q.cur.cid}::uuid, ${q.cur.seq}::bigint)` : sql``}
          order by m.created_at desc, m.conversation_id desc, m.seq desc limit ${q.limit}::int)
        select h.conversation_id, c.kind, c.title, h.seq::int as seq, h.sender_id, ${iso("h.ts")} as at, h.body,
          (select mm.user_id from contracts.msg_members mm where mm.tenant_id = c.tenant_id and mm.conversation_id = c.id
             and mm.user_id <> ${me}::uuid and c.kind = 'direct' limit 1) as peer_id
        from h join contracts.msg_conversations c on c.tenant_id = ${t}::uuid and c.id = h.conversation_id
        order by h.ts desc, h.conversation_id desc, h.seq desc`),
  };
}
