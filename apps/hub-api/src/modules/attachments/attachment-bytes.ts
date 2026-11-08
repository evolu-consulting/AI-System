// cr125-contract-from-step · đọc NỘI DUNG một tệp đính kèm cho module khác trong hub (gói Hợp đồng tạo HĐ từ tệp của bước Soạn thảo). CHỈ tệp đã
// liên kết với lượt (`hub.process_run_files`, 0130): tệp khác của công ty không thành tệp hợp đồng được.
// Scope system, lọc `tenant_id` tường minh: tệp của công ty khác / đã xoá nội dung / quá lớn / chưa liên kết lượt ⇒ null (không lộ lý do).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { type AttachmentStorage, isUuidName, storageLocatorOf } from "./storage";

/** Trần byte đọc vào bộ nhớ (= trần tải lên HĐ 20 MiB). */
const MAX_BYTES = 20 * 1024 * 1024;

type Row = {
  filename: string;
  mime: string;
  size: string | number;
  storage_key: string;
  filebox_file_id: string | null;
  filebox_version_id: string | null;
};

export function attachmentBytesOf(db: Db, storage: AttachmentStorage) {
  return async (
    tenantId: string,
    runId: string,
    id: string,
  ): Promise<{ name: string; bytes: Uint8Array } | null> => {
    if (!isUuidName(tenantId) || !isUuidName(runId) || !isUuidName(id.toLowerCase())) return null;
    const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<Row>(sql`select a.filename, a.mime, a.size, a.storage_key, a.filebox_file_id, a.filebox_version_id
        from hub.attachments a
        join hub.process_run_files f on f.attachment_id = a.id and f.tenant_id = a.tenant_id
        where a.id = ${id}::uuid and a.tenant_id = ${tenantId}::uuid and f.process_run_id = ${runId}::uuid
          and a.purged_at is null`),
    );
    if (!r || Number(r.size) > MAX_BYTES) return null;
    const blob = await storage.blob(
      storageLocatorOf({
        storage_key: r.storage_key,
        filebox_file_id: r.filebox_file_id,
        filebox_version_id: r.filebox_version_id,
      }),
      r.mime,
    );
    return blob ? { name: r.filename, bytes: new Uint8Array(await blob.arrayBuffer()) } : null;
  };
}
