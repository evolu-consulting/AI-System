// FILE_STORAGE_UNAVAILABLE (503, FileBox chưa cấu hình) ⇒ câu rõ cho người dùng; lỗi khác ⇒ câu chung "Không tải lên được".
import { ApiError } from "@ai/web-kit/http";

type T = (key: string) => string;

export function uploadErrorText(e: unknown, t: T): string {
  const code: string | undefined = e instanceof ApiError ? e.code : undefined;
  return code === "FILE_STORAGE_UNAVAILABLE"
    ? t("contracts.list.fileStorageUnavailable")
    : t("contracts.list.uploadFailed");
}
