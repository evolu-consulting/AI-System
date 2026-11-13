// CR-125 · cr125-run-attachments · tệp đính kèm ↔ lượt chạy (`hub.process_run_files`, migration 0130).
// GHI (trong tx của người thao tác, scope `user`): chỉ liên kết tệp `upload` CỦA CHÍNH người đó (không phòng, chưa xoá) — id của người khác
// bị bỏ lặng lẽ (không lộ tồn tại, không nâng quyền đọc). Lượt con kế thừa tệp đã liên kết với lượt cha (truyền qua input_map) + tệp của lượt con anh em mở trước (CR-140).
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

/**
 * Lượt con kế thừa liên kết tệp (CHỈ liên kết, không chép tệp), MỘT câu SQL theo tập: (1) tệp `ids` ĐÃ liên kết với lượt cha (input_map);
 * (2) CR-140 · mọi tệp CHƯA xoá của các lượt con ANH EM đã mở trước (cùng `parent_run_id`, cùng công ty, trừ chính lượt này; bỏ lượt lỗi / hết hạn / đã huỷ — thử lại mở lượt mới) — để bước sau của
 * dây chuyền nhiều quy trình con thấy tệp bước trước. Lượt ngoài cây của cha, công ty khác: không khớp điều kiện ⇒ không thấy.
 * Gọi TRƯỚC `linkChild` nên anh em = lượt khác có `parent_run_id` = cha. Trả số hàng mới.
 */
export async function inheritRunFiles(
  tx: Tx,
  o: { tenantId: string; parentRunId: string; childRunId: string; ids: readonly string[] },
): Promise<number> {
  const rows = await tx.execute<{ attachment_id: string }>(sql`
    insert into hub.process_run_files (process_run_id, attachment_id, tenant_id, linked_by, source)
    select distinct on (f.attachment_id) ${o.childRunId}::uuid, f.attachment_id, f.tenant_id, f.linked_by, 'subprocess'
    from hub.process_run_files f
    join hub.attachments a on a.id = f.attachment_id and a.tenant_id = f.tenant_id and a.purged_at is null
    where f.tenant_id = ${o.tenantId}::uuid
      and ((f.process_run_id = ${o.parentRunId}::uuid and f.attachment_id = any(${uuidArrayLiteral(o.ids)}::uuid[]))
        or f.process_run_id in (select s.id from hub.process_runs s
              where s.parent_run_id = ${o.parentRunId}::uuid and s.tenant_id = ${o.tenantId}::uuid
                and s.id <> ${o.childRunId}::uuid
                and s.status not in ('failed', 'expired', 'cancelled')))
    order by f.attachment_id, f.created_at
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

export type RecordRunFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  source: RunFileSource;
  added_at: Date;
};

/**
 * CR-133 · «Tài liệu kèm» (nhóm 2): tệp kèm các lượt duyệt của MỘT bản ghi gói (`pack_key` + `pack_record_id`), chỉ lượt mà người xem XEM ĐƯỢC
 * (cùng luật `readableRunFile` ⇒ bấm tải luôn được). Hai câu SQL cố định (không N+1 theo lượt): (1) scope `user` — liên kết tệp ⋈ lượt đã qua
 * `process_run_viewer`; (2) scope `system` — tên/kích thước tệp theo mảng id + tenant (RLS user chỉ thấy tệp của chủ). Tệp đã xoá nội dung bị bỏ.
 */
export async function recordRunFiles(
  db: Db,
  u: Pick<AuthUser, "tenantId" | "userId">,
  o: { packKey: string; recordId: string },
): Promise<RecordRunFile[]> {
  const links = await withHubScope(
    db,
    { kind: "user", tenantId: u.tenantId, userId: u.userId },
    (tx) =>
      tx.execute<{ id: string; source: RunFileSource; added_at: Date }>(sql`
        select distinct on (f.attachment_id) f.attachment_id as id, f.source, f.created_at as added_at
        from hub.process_runs r
        join hub.process_run_files f on f.process_run_id = r.id and f.tenant_id = r.tenant_id
        where r.tenant_id = ${u.tenantId}::uuid and r.pack_key = ${o.packKey} and r.pack_record_id = ${o.recordId}::uuid
          and hub.process_run_viewer(r.id) is not null
        order by f.attachment_id, f.created_at`),
  );
  if (links.length === 0) return [];
  const ids = links.map((l) => l.id);
  const rows = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{ id: string; filename: string; mime: string; size: number | string }>(sql`
      select a.id, a.filename, a.mime, a.size from hub.attachments a
      where a.tenant_id = ${u.tenantId}::uuid and a.id = any(${uuidArrayLiteral(ids)}::uuid[]) and a.purged_at is null`),
  );
  const by = new Map(rows.map((r) => [r.id, r]));
  return links
    .flatMap((l) => {
      const a = by.get(l.id);
      return a
        ? [
            {
              id: l.id,
              name: a.filename,
              mime: a.mime,
              size: Number(a.size),
              source: l.source,
              added_at: l.added_at,
            },
          ]
        : [];
    })
    .sort((x, y) => x.added_at.getTime() - y.added_at.getTime());
}
