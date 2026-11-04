// FILE_STORAGE_UNAVAILABLE (503, FileBox chưa cấu hình), FILE_TOO_LARGE/FILE_TYPE/UPLOAD_QUOTA/DOCX_BUSY ⇒ câu rõ cho người dùng;
// lỗi khác ⇒ câu chung "Không tải lên được".
import { ApiError } from "@ai/web-kit/http";

type T = (key: string) => string;

const KEYS: Record<string, string> = {
  FILE_STORAGE_UNAVAILABLE: "contracts.list.fileStorageUnavailable",
  FILE_TOO_LARGE: "contracts.list.upload.tooLarge",
  FILE_TYPE: "contracts.list.upload.badType",
  UPLOAD_QUOTA: "contracts.list.upload.quota",
  UPLOAD_QUOTA_UNAVAILABLE: "contracts.list.fileStorageUnavailable",
  DOCX_BUSY: "contracts.list.upload.busy",
};

export function uploadErrorText(e: unknown, t: T): string {
  const code: string | undefined = e instanceof ApiError ? e.code : undefined;
  return t((code && KEYS[code]) || "contracts.list.uploadFailed");
}
