// CR-132 M3 · HD-MSG-02..07 · SQL tin nhắn (danh sách tin, gửi, thu hồi, đã đọc, gắn tệp). Gửi = MỘT câu CTE (tăng `last_seq` khoá hàng hội thoại →
// chèn tin → trả thành viên); trùng `client_id` ⇒ trả bản cũ, không tăng seq. Thu hồi = MỘT câu (tin + soft-delete tệp). Tải tệp lên ở M5.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { MessagesRepo, RawMessage, RevokeRow, SentRow } from "../application/messages.ports";
import { iso, uuidArr } from "./messages.sql";

const FILE_JSON = sql`json_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size_bytes::int)`;
type FileRow = RawMessage["files"][number];

export function messagesSendRepo(
  tx: Tx,
  t: string,
): Pick<MessagesRepo, "page" | "send" | "attach" | "filesOf" | "revoke" | "markRead"> {
  return {
    // Thành viên (1 dòng) + trang tin (tối đa limit+1, mới → cũ) + tệp từng tin (lateral theo index `msg_files (tenant,conv,seq)`).
    page: async (me, cid, before, limit) => {
      const [r] = await tx.execute<{ items: RawMessage[] }>(sql`select coalesce((
          select json_agg(p order by p.seq desc) from (
            select x.seq::int as seq, x.id, x.sender_id, x.client_id, case when x.deleted_at is null then x.body else '' end as body,
              ${iso("x.created_at")} as at, x.deleted_at is not null as deleted,
              case when x.deleted_at is not null then '[]'::json else coalesce(fl.files, '[]'::json) end as files
            from contracts.msg_messages x
            left join lateral (select json_agg(${FILE_JSON} order by f.created_at, f.id) as files
              from contracts.msg_files mf join contracts.files f on f.id = mf.file_id and f.tenant_id = mf.tenant_id and f.deleted_at is null
              where mf.tenant_id = x.tenant_id and mf.conversation_id = x.conversation_id and mf.seq = x.seq) fl on true
            where x.tenant_id = ${t}::uuid and x.conversation_id = ${cid}::uuid
              ${before === null ? sql`` : sql`and x.seq < ${before}::bigint`}
            order by x.seq desc limit ${limit + 1}::int) p), '[]'::json) as items
        from contracts.msg_members m
        where m.tenant_id = ${t}::uuid and m.conversation_id = ${cid}::uuid and m.user_id = ${me}::uuid`);
      return r ? r.items : null;
    },
    send: async ({ me, cid, clientId, body }) => {
      const rows = await tx.execute<SentRow>(sql`with
        mem as (select 1 as x from contracts.msg_members where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and user_id = ${me}::uuid),
        dup as (select seq, id, sender_id, client_id, body, created_at from contracts.msg_messages
          where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and sender_id = ${me}::uuid and client_id = ${clientId}::uuid
            and exists (select 1 from mem)),
        bump as (update contracts.msg_conversations set last_seq = last_seq + 1, last_at = now()
          where tenant_id = ${t}::uuid and id = ${cid}::uuid and exists (select 1 from mem) and not exists (select 1 from dup)
          returning last_seq),
        ins as (insert into contracts.msg_messages (tenant_id, conversation_id, seq, sender_id, client_id, body)
          select ${t}::uuid, ${cid}::uuid, bump.last_seq, ${me}::uuid, ${clientId}::uuid, ${body} from bump
          returning seq, id, sender_id, client_id, body, created_at),
        cur as (select *, false as dup from ins union all select *, true as dup from dup)
        select cur.seq::int as seq, cur.id, cur.sender_id, cur.client_id, cur.body, ${iso("cur.created_at")} as at, false as deleted,
          '[]'::json as files, cur.dup,
          (select coalesce(array_agg(mm.user_id::text), '{}') from contracts.msg_members mm
            where mm.tenant_id = ${t}::uuid and mm.conversation_id = ${cid}::uuid) as member_ids
        from cur`);
      return rows[0] ?? null;
    },
    attach: async ({ me, cid, seq, fileIds }) => {
      const rows = await tx.execute<FileRow>(sql`with u as (
          update contracts.msg_files set seq = ${seq}::bigint
          where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and file_id = any(${uuidArr(fileIds)}::uuid[])
            and uploaded_by = ${me}::uuid and seq is null returning file_id)
        select f.id, f.name, f.mime, f.size_bytes::int as size from u
        join contracts.files f on f.id = u.file_id and f.tenant_id = ${t}::uuid and f.deleted_at is null order by f.created_at, f.id`);
      return [...rows];
    },
    filesOf: async (cid, seq) => {
      const rows =
        await tx.execute<FileRow>(sql`select f.id, f.name, f.mime, f.size_bytes::int as size
        from contracts.msg_files mf join contracts.files f on f.id = mf.file_id and f.tenant_id = mf.tenant_id and f.deleted_at is null
        where mf.tenant_id = ${t}::uuid and mf.conversation_id = ${cid}::uuid and mf.seq = ${seq}::bigint order by f.created_at, f.id`);
      return [...rows];
    },
    // Thu hồi: chỉ người gửi, chưa thu hồi; xoá chữ + soft-delete tệp của tin trong CÙNG câu. Giữ hàng `msg_files` (policy tệp ở M5 còn chặn người ngoài).
    revoke: async ({ me, cid, seq }) => {
      const [r] = await tx.execute<RevokeRow>(sql`with
        m as (select sender_id, deleted_at from contracts.msg_messages
          where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and seq = ${seq}::bigint
            and exists (select 1 from contracts.msg_members where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and user_id = ${me}::uuid)),
        upd as (update contracts.msg_messages set deleted_at = now(), body = ''
          where tenant_id = ${t}::uuid and conversation_id = ${cid}::uuid and seq = ${seq}::bigint
            and sender_id = ${me}::uuid and deleted_at is null returning seq),
        fl as (update contracts.files f set deleted_at = now() from contracts.msg_files mf
          where mf.tenant_id = ${t}::uuid and mf.conversation_id = ${cid}::uuid and mf.seq = ${seq}::bigint
            and exists (select 1 from upd) and f.tenant_id = ${t}::uuid and f.id = mf.file_id and f.deleted_at is null returning f.id)
        select m.sender_id, m.deleted_at is not null as was_deleted, exists (select 1 from upd) as done from m`);
      return r ?? null;
    },
    // Cùng công thức `clampRead(current, requested, lastSeq)` (domain): max(hiện tại, min(yêu cầu, tin cuối)).
    markRead: async (me, cid, seq) => {
      const [r] = await tx.execute<{ last_read_seq: number }>(sql`update contracts.msg_members m
        set last_read_seq = greatest(m.last_read_seq, least(${seq}::bigint, c.last_seq))
        from contracts.msg_conversations c
        where m.tenant_id = ${t}::uuid and m.conversation_id = ${cid}::uuid and m.user_id = ${me}::uuid
          and c.tenant_id = m.tenant_id and c.id = m.conversation_id
        returning m.last_read_seq::int as last_read_seq`);
      return r ? r.last_read_seq : null;
    },
  };
}
