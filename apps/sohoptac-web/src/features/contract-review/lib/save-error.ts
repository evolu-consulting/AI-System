// HD-FR-26 · S04/S05: câu lỗi khi lưu (mgmt-app `errText`): 409 ⇒ "vừa được cập nhật", mất mạng ⇒ câu mạng, còn lại ⇒ câu chung.
// Không hiện thông điệp thô của máy chủ (tiếng Anh, có thể lộ chi tiết) — trừ lỗi giao/kho: máy chủ soạn sẵn câu tiếng Việt nêu
// dòng/tồn (delivery.routes), hiện nguyên văn kèm gợi ý. 409 KHÔNG phải xung đột phiên bản thì không báo "người khác cập nhật".
import { ApiError } from "@ai/web-kit/http";

type T = (key: string) => string;

/** Lỗi giao hàng / kho: thông điệp máy chủ là câu tiếng Việt do mình soạn (an toàn để hiện). */
const SERVER_TEXT = new Set([
  "STOCK_INSUFFICIENT",
  "DELIVERY_OVER",
  "DELIVERY_INVALID",
  "DELIVERY_LOCKED",
]);
const KEYED: Record<string, string> = {
  CONTRACT_LOCKED: "contracts.lock.errLocked",
  OBLIGATION_DONE: "contracts.errors.alreadyDone",
  MILESTONE_CONFIRMED: "contracts.errors.alreadyDone",
};

export function saveErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    const code = e.code as string;
    if (KEYED[code]) return t(KEYED[code]);
    if (SERVER_TEXT.has(code) && e.message) {
      return code === "STOCK_INSUFFICIENT"
        ? `${e.message}. ${t("contracts.errors.stockHint")}`
        : e.message;
    }
    if (e.status === 409) return t("contracts.errors.conflict");
    if (e.code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}
