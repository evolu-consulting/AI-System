// FILE_STORAGE_UNAVAILABLE (503, FileBox chưa cấu hình), FILE_TOO_LARGE/FILE_TYPE/UPLOAD_QUOTA/DOCX_BUSY ⇒ câu rõ cho người dùng;
// CR-122 p9: FILE_TOO_MANY_PAGES (422, kèm {pages, limit}) ⇒ "Tệp có N trang, vượt giới hạn M trang…"; lỗi khác ⇒ câu chung.
import { ApiError } from "@ai/web-kit/http";

type T = (key: string, opts?: Record<string, unknown>) => string;

const KEYS: Record<string, string> = {
  FILE_STORAGE_UNAVAILABLE: "contracts.list.fileStorageUnavailable",
  FILE_TOO_LARGE: "contracts.list.upload.tooLarge",
  FILE_TOO_MANY_PAGES: "contracts.list.upload.tooManyPages",
  FILE_TYPE: "contracts.list.upload.badType",
  ESIGN_NEEDS_PDF: "contracts.list.upload.esignNeedsPdf",
  UPLOAD_QUOTA: "contracts.list.upload.quota",
  UPLOAD_QUOTA_UNAVAILABLE: "contracts.list.fileStorageUnavailable",
  DOCX_BUSY: "contracts.list.upload.busy",
};

export function uploadErrorText(e: unknown, t: T): string {
  const code: string | undefined = e instanceof ApiError ? e.code : undefined;
  const d =
    e instanceof ApiError
      ? (e.details as { pages?: number; limit?: number; format?: string } | null)
      : null;
  // CR-122 p9: định dạng nhận ra nhưng chưa đọc được ⇒ "Định dạng HEIC chưa đọc được — hãy lưu sang PDF hoặc JPG".
  if (code === "FILE_TYPE" && d?.format && d.format !== "images")
    return t("contracts.list.upload.unreadableFormat", { format: d.format.toUpperCase() });
  return t((code && KEYS[code]) || "contracts.list.uploadFailed", {
    pages: d?.pages,
    limit: d?.limit,
  });
}
