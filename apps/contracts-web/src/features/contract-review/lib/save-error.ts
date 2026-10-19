// HD-FR-26 · S04/S05: câu lỗi khi lưu (mgmt-app `errText`): 409 ⇒ "vừa được cập nhật", mất mạng ⇒ câu mạng, còn lại ⇒ câu chung.
// Không hiện thông điệp thô của máy chủ (tiếng Anh, có thể lộ chi tiết).
import { ApiError } from "@ai/web-kit/http";

type T = (key: string) => string;

export function saveErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return t("contracts.errors.conflict");
    if (e.code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}
