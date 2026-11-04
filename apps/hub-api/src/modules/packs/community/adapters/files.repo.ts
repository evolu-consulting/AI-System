// CR-118 · cr118-community-files · §11.1: SQL bảng khung `community.files` (FileBox org `t_<tenant>`). Mọi câu chạy trong tx
// người xem ⇒ RLS 0006 `files_visible` (chính người tải lên ∨ tệp trên bài người xem thấy) quyết định "thấy"; lọc
// `tenant_id` tường minh thêm (phòng thủ chiều sâu). Một câu mỗi việc (Luật 4c).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type FileRow = { id: string; file_id: string; name: string; mime: string; size: number };

export async function insertFile(
  tx: Tx,
  r: {
    tenantId: string;
    fileId: string;
    versionId: string | null;
    name: string;
    mime: string;
    size: number;
    createdBy: string;
  },
): Promise<string> {
  const rows = await tx.execute<{ id: string }>(sql`
    insert into community.files (tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
    values (${r.tenantId}::uuid, ${`t_${r.tenantId}`}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime}, ${r.size},
      ${r.createdBy}::uuid)
    returning id::text as id`);
  return rows[0]?.id as string;
}

/** Tệp người xem được tải (RLS); không thấy / đã xoá mềm ⇒ null. */
export async function visibleFile(tx: Tx, tenantId: string, id: string): Promise<FileRow | null> {
  const rows = await tx.execute<FileRow>(sql`
    select id::text as id, file_id, name, mime, size_bytes::int as size from community.files
    where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`);
  return rows[0] ?? null;
}

/** Tệp được GẮN vào bài: chính người gọi tải lên, hoặc đã nằm trên bài `postId` (sửa bài giữ tệp cũ). Một câu theo tập. */
export async function attachableFiles(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
  userId: string,
  postId: string | null,
): Promise<FileRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx.execute<FileRow>(sql`
    select f.id::text as id, f.file_id, f.name, f.mime, f.size_bytes::int as size from community.files f
    where f.tenant_id = ${tenantId}::uuid and f.deleted_at is null
      and f.id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid))
      and (f.created_by = ${userId}::uuid or exists (select 1 from community.media m
        where m.file_id = f.id and m.post_id = ${postId}::uuid))`);
  return [...rows];
}
