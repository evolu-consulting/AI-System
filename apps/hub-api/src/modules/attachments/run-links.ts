// CR-125 · cr125-run-attachments · tệp đính kèm ↔ lượt chạy (`hub.process_run_files`, migration 0130).
// GHI (trong tx của người thao tác, scope `user`): chỉ liên kết tệp `upload` CỦA CHÍNH người đó (không phòng, chưa xoá) — id của người khác
// bị bỏ lặng lẽ (không lộ tồn tại, không nâng quyền đọc). Lượt con kế thừa CHỈ tệp đã liên kết với lượt cha.
// ĐỌC (`GET /attachments/:id(/content)`, nhánh thêm sau luật chủ-sở-hữu): (1) scope user — có liên kết tới lượt mà người xem XEM ĐƯỢC
// (definer `hub.process_run_viewer`: người tạo, người được giao, quản trị công ty, thành viên phòng nguồn) ⇒ (2) scope system đọc hàng tệp
// theo tenant tường minh. Không thấy ⇒ null ⇒ service trả 404 cùng thân. Công ty khác: definer trả null (lượt khác tenant), RLS chặn.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { fileRowById, type ReadableAttachment } from "./attachments.repo";
import { uuidArrayLiteral } from "./run-links.rules";

export type RunFileSource = "start" | "form" | "subprocess";

/** Liên kết tệp `ids` (của `userId`) vào lượt `runId`. Trả số hàng mới. Gọi TRONG tx đã có lượt (cùng tx tạo lượt / gửi form). */
export async function linkRunFiles(
  tx: Tx,
  o: {
    tenantId: string;
    userId: string;
    runId: string;
    ids: readonly string[];
    source: RunFileSource;
  },
): Promise<number> {
  if (o.ids.length === 0) return 0;
  const rows = await tx.execute<{ attachment_id: string }>(sql`
    insert into hub.process_run_files (process_run_id, attachment_id, tenant_id, linked_by, source)
    select ${o.runId}::uuid, a.id, a.tenant_id, ${o.userId}::uuid, ${o.source}
    from hub.attachments a
    where a.id = any(${uuidArrayLiteral(o.ids)}::uuid[]) and a.tenant_id = ${o.tenantId}::uuid
      and a.user_id = ${o.userId}::uuid and a.origin = 'upload' and a.room_id is null and a.purged_at is null
    on conflict do nothing
    returning attachment_id`);
  return rows.length;
}

/** Lượt con kế thừa tệp `ids` ĐÃ liên kết với lượt cha (input_map). Trả số hàng mới. */
export async function inheritRunFiles(
  tx: Tx,
  o: { tenantId: string; parentRunId: string; childRunId: string; ids: readonly string[] },
): Promise<number> {
  if (o.ids.length === 0) return 0;
  const rows = await tx.execute<{ attachment_id: string }>(sql`
    insert into hub.process_run_files (process_run_id, attachment_id, tenant_id, linked_by, source)
    select ${o.childRunId}::uuid, f.attachment_id, f.tenant_id, f.linked_by, 'subprocess'
    from hub.process_run_files f
    where f.process_run_id = ${o.parentRunId}::uuid and f.tenant_id = ${o.tenantId}::uuid
      and f.attachment_id = any(${uuidArrayLiteral(o.ids)}::uuid[])
    on conflict do nothing
    returning attachment_id`);
  return rows.length;
}

/** Có liên kết tới ít nhất một lượt mà người xem xem được (scope `user`; lọc tenant tường minh). */
async function viewableLink(tx: Tx, o: { tenantId: string; id: string }): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.process_run_files f
    where f.attachment_id = ${o.id}::uuid and f.tenant_id = ${o.tenantId}::uuid
      and hub.process_run_viewer(f.process_run_id) is not null limit 1`);
  return r !== undefined;
}

/** Nhánh đọc theo quyền xem lượt: tệp được liên kết vào lượt người xem xem được ⇒ hàng tệp; khác ⇒ null. */
export async function readableRunFile(
  db: Db,
  u: AuthUser,
  id: string,
): Promise<ReadableAttachment | null> {
  const ok = await withHubScope(
    db,
    { kind: "user", tenantId: u.tenantId, userId: u.userId },
    (tx) => viewableLink(tx, { tenantId: u.tenantId, id }),
  );
  if (!ok) return null;
  return withHubScope(db, { kind: "system" }, (tx) =>
    fileRowById(tx, { tenantId: u.tenantId, id }),
  );
}
