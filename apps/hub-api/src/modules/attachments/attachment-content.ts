// HUB-FR-44 · HUB-FR-139 · H2c-R13 · FB1 §3.4 · giải nội dung `/content` (tách khỏi `attachments.service.ts` cho trần 400 dòng):
// kho FileBox + điều hướng (navigate) ⇒ 302 tới `/link`; ngược lại (local, hoặc fetch cors/vắng Sec-Fetch) ⇒ phát inline.
import { appError, safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { contentDisposition } from "./attachment.rules";
import type { ReadableAttachment } from "./attachments.repo";
import {
  type AttachmentStorage,
  parseFileboxLocator,
  StorageKeyError,
  storageLocatorOf,
} from "./storage";

/**
 * Nội dung + header R13 của `/content` (plan §5.7). `Blob` thay vì stream: Bun chỉ gửi `Content-Length` khi thân có kích
 * thước biết trước (stream ⇒ chunked). FB1 (HUB-FR-139): kho FileBox + navigate ⇒ nhánh `redirect` (302 tới `/link`).
 */
export type ContentResult =
  | { kind: "blob"; body: Blob; headers: Record<string, string> }
  | { kind: "redirect"; url: string };

/** Sau RLS (`r` đã đọc được, chưa purged): chọn nhánh redirect/inline (FB1 §3.4). */
export async function resolveContent(
  storage: AttachmentStorage,
  r: ReadableAttachment,
  o: { navigate?: boolean },
  log: Logger,
): Promise<ContentResult> {
  const locator = storageLocatorOf({
    storage_key: r.storageKey,
    filebox_file_id: r.fileboxFileId,
    filebox_version_id: r.fileboxVersionId,
  });
  const fb = parseFileboxLocator(locator);
  if (fb && o.navigate && storage.link) return redirect(storage, fb.fileId, r.id, log);
  const file = await inline(storage, locator, r.mime, r.id, log);
  return { kind: "blob", body: file, headers: contentHeaders(r, file.size) };
}

/** Nhánh redirect (FileBox `/link`): 404 ⇒ content-missing 404; lỗi FileBox ⇒ 500 (chat không chặn). */
async function redirect(
  storage: AttachmentStorage,
  fileId: string,
  attachmentId: string,
  log: Logger,
): Promise<ContentResult> {
  let url: string | null;
  try {
    // biome-ignore lint/style/noNonNullAssertion: gọi chỉ khi `storage.link` tồn tại (kiểm ở `resolveContent`).
    url = await storage.link!(fileId);
  } catch (e) {
    log.error("attachment-open-failed", { attachment_id: attachmentId, ...safeErrorFields(e) });
    throw appError("INTERNAL_ERROR");
  }
  if (url === null) {
    log.error("attachment-content-missing", { attachment_id: attachmentId });
    throw appError("NOT_FOUND");
  }
  return { kind: "redirect", url };
}

/** Nhánh inline: đọc nội dung (local đọc đĩa / FileBox `/content`); kho mất/404 ⇒ content-missing 404; lỗi ⇒ 500. */
async function inline(
  storage: AttachmentStorage,
  locator: string,
  mime: string,
  attachmentId: string,
  log: Logger,
): Promise<Blob> {
  let file: Blob | null;
  try {
    file = await storage.blob(locator, mime);
  } catch (e) {
    if (e instanceof StorageKeyError) log.error("attachment-path-escape", { key: attachmentId });
    else
      log.error("attachment-open-failed", { attachment_id: attachmentId, ...safeErrorFields(e) });
    throw appError("INTERNAL_ERROR");
  }
  if (!file) {
    log.error("attachment-content-missing", { attachment_id: attachmentId });
    throw appError("NOT_FOUND");
  }
  return file;
}

/** Header tải về (R13, plan §5.7): không đoán kiểu, sandbox, luôn `attachment`, không cache dùng chung. */
export function contentHeaders(r: { filename: string; mime: string }, size: number) {
  return {
    "Content-Type": r.mime,
    "Content-Length": String(size),
    "Content-Disposition": contentDisposition(r.filename),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
  };
}
