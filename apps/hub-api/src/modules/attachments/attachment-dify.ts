// HUB-FR-12 · HUB-FR-50 · H2c-R21, R22 · P14 · file của run → Dify `/files/upload` (lệnh sync/async — B7; MCP `tools/call` —
// B8). Đọc nội dung từ kho (`storageKey(tenant, id)`), gửi tên `safe_name` + mime; trả kết quả upload + trace
// `detail.upload` (plan-errors §4: `{mime, size, ms}` + `status`/`reason` khi lỗi). Không log tên file / app-key.
import type { DifyFileInput } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { type DifyUploadResult, uploadDifyFile } from "../dify/dify-upload";
import { difyFileType } from "./attachment.rules";
import { fileAvailable } from "./attachments.repo";
import type { RunFile } from "./run-files.rules";
import { type AttachmentStorage, storageKey } from "./storage";

/** Nội dung file đã gắn mà kho không có (purged/mất) — người gọi kết thúc `INTERNAL_ERROR`, log `attachment-content-missing`. */
export class AttachmentContentMissing extends Error {
  constructor(readonly attachmentId: string) {
    super("attachment-content-missing");
  }
}

/**
 * RV-8 · hàng file đã dọn (`purged_at`) / hội thoại đã xoá trước khi upload — trạng thái hợp lệ, không phải lỗi kho: MCP trả
 * câu tĩnh (`isError`), lệnh kết thúc `INTERNAL_ERROR` (câu H1 tĩnh) với log info `attachment-unavailable`.
 */
export class AttachmentUnavailable extends AttachmentContentMissing {}

export type DifyUploadTarget = { baseUrl: string; apiKey: string; user: string };

/** `run_steps.detail.upload` (plan-errors §4). */
export type UploadTrace = {
  mime: string;
  size: number;
  ms: number;
  status?: number;
  reason?: "file_rejected" | "upstream";
};

export type AttachmentUpload = { result: DifyUploadResult; trace: UploadTrace };

export type AttachmentDifyDeps = {
  storage: Pick<AttachmentStorage, "blob"> | null;
  /** Kiểm hàng còn dùng được trước khi upload (RV-8); vắng ⇒ bỏ kiểm (unit test). */
  db?: Db;
  fetch?: typeof fetch;
};

/** Giá trị input `file` gửi Dify (R22). */
export function difyFileInput(file: Pick<RunFile, "mime">, uploadFileId: string): DifyFileInput {
  return {
    type: difyFileType(file.mime),
    transfer_method: "local_file",
    upload_file_id: uploadFileId,
  };
}

function traceOf(file: RunFile, r: DifyUploadResult): UploadTrace {
  const t: UploadTrace = { mime: file.mime, size: file.size, ms: r.ms };
  if (r.ok || r.code === "ABORTED") return t;
  return { ...t, ...(r.status !== null && { status: r.status }), reason: r.reason };
}

/**
 * Một file → một upload (T8). Hàng đã dọn ⇒ `AttachmentUnavailable` (RV-8); kho vắng/không có nội dung ⇒
 * `AttachmentContentMissing`.
 */
export async function uploadToDify(
  d: AttachmentDifyDeps,
  f: { tenantId: string; file: RunFile },
  target: DifyUploadTarget,
  signal: AbortSignal,
): Promise<AttachmentUpload> {
  const { db } = d;
  if (db) {
    const ok = await withHubScope(db, { kind: "system" }, (tx) =>
      fileAvailable(tx, f.tenantId, f.file.id),
    );
    if (!ok) throw new AttachmentUnavailable(f.file.id);
  }
  const blob = d.storage
    ? await d.storage.blob(storageKey(f.tenantId, f.file.id), f.file.mime)
    : null;
  if (!blob) throw new AttachmentContentMissing(f.file.id);
  const result = await uploadDifyFile(
    { ...target, file: blob, name: f.file.name },
    signal,
    d.fetch,
  );
  return { result, trace: traceOf(f.file, result) };
}
