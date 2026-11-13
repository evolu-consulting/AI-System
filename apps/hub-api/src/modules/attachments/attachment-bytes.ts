// cr125-contract-from-step · đọc NỘI DUNG một tệp đính kèm cho module khác trong hub (gói Hợp đồng tạo HĐ từ tệp của bước Soạn thảo). CHỈ tệp đã
// liên kết với lượt (`hub.process_run_files`, 0130): tệp khác của công ty không thành tệp hợp đồng được.
// Scope system, lọc `tenant_id` tường minh: tệp của công ty khác / đã xoá nội dung / quá lớn / chưa liên kết lượt ⇒ null (không lộ lý do).
import type { Db } from "@ai/db";
import { setHubTenantInTx, withHubScope } from "@ai/db/hub-scope";
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
    const f = r ? await readBlob(storage, r) : null;
    return f ? { name: f.name, bytes: f.bytes } : null;
  };
}

async function readBlob(storage: AttachmentStorage, r: Row): Promise<EvidenceFileBytes | null> {
  if (Number(r.size) > MAX_BYTES) return null;
  const blob = await storage.blob(
    storageLocatorOf({
      storage_key: r.storage_key,
      filebox_file_id: r.filebox_file_id,
      filebox_version_id: r.filebox_version_id,
    }),
    r.mime,
  );
  return blob
    ? { name: r.filename, mime: r.mime, bytes: new Uint8Array(await blob.arrayBuffer()) }
    : null;
}

export type EvidenceFileBytes = { name: string; mime: string; bytes: Uint8Array };

/**
 * CR-127 · E4b · byte một tệp/chữ ký của BẰNG CHỨNG duyệt (`hub.evidence`). Chỉ cấp khi `fileId` là chữ ký hoặc tệp của CHÍNH bằng chứng
 * `evidenceId` (qua `hub.evidence_get`, DEFINER, chỉ tenant của tx) — không mở đọc theo id chung. Quyền xem (BR-26) do gói gọi kiểm trước.
 * Sai tenant / bằng chứng / tệp không thuộc bằng chứng / đã xoá nội dung / quá lớn ⇒ null (không lộ lý do).
 */
export function evidenceFileBytesOf(db: Db, storage: AttachmentStorage) {
  return async (
    tenantId: string,
    evidenceId: string,
    fileId: string,
  ): Promise<EvidenceFileBytes | null> => {
    if (!isUuidName(tenantId) || !isUuidName(evidenceId) || !isUuidName(fileId)) return null;
    const [r] = await withHubScope(db, { kind: "system" }, async (tx) => {
      // `evidence_get` đọc tenant từ `app.tenant_id`: scope system để trống ⇒ đặt lại trong tx (transaction-local).
      await setHubTenantInTx(tx, tenantId);
      return tx.execute<Row>(sql`select a.filename, a.mime, a.size, a.storage_key, a.filebox_file_id, a.filebox_version_id
        from hub.evidence_get(array[${evidenceId}::uuid]) e
        join hub.attachments a on a.tenant_id = e.tenant_id
          and (a.id = e.signature_attachment_id or a.id = any (e.attachment_ids))
        where a.id = ${fileId}::uuid and a.tenant_id = ${tenantId}::uuid and a.purged_at is null`);
    });
    return r ? readBlob(storage, r) : null;
  };
}

/**
 * CR-127 · U4b-3 + CR-144 · TÊN + loại (mime) tệp/chữ ký của các bằng chứng (`fileId → filename`) cho PDF Hồ sơ duyệt — MỘT câu theo lô (`hub.evidence_get(ids)` DEFINER,
 * chỉ tenant của tx; id bằng chứng tenant khác ⇒ không có dòng). Không đọc nội dung tệp.
 */
export function evidenceFileNamesOf(db: Db) {
  return async (
    tenantId: string,
    evidenceIds: readonly string[],
  ): Promise<Map<string, { name: string; mime: string }>> => {
    const ids = evidenceIds.filter((x) => isUuidName(x));
    if (!isUuidName(tenantId) || ids.length === 0) return new Map();
    const rows = await withHubScope(db, { kind: "system" }, async (tx) => {
      await setHubTenantInTx(tx, tenantId);
      return tx.execute<{
        id: string;
        filename: string;
        mime: string;
      }>(sql`select a.id::text as id, a.filename, a.mime
        from hub.evidence_get(${`{${ids.join(",")}}`}::uuid[]) e
        join hub.attachments a on a.tenant_id = e.tenant_id
          and (a.id = e.signature_attachment_id or a.id = any (e.attachment_ids))
        where a.tenant_id = ${tenantId}::uuid and a.purged_at is null`);
    });
    return new Map([...rows].map((r) => [r.id, { name: r.filename, mime: r.mime }]));
  };
}
