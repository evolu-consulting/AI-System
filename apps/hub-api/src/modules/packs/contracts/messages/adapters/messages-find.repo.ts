// CR-178 · SQL đọc «Ảnh & tệp» (M4) và tìm tin (M3) của cuộc nội bộ, trong tx `PackUow` (role `contracts_rw`, RLS tenant + thành viên — 0107). MỖI thao tác đúng MỘT câu SQL
// (không vòng theo hàng); `tenant_id` tường minh ngoài RLS; mọi giá trị là tham số, văn bản hằng.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { AttachQuery, MessagesRepo, RawAttachment } from "../application/messages.ports";
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
