// HD8-FR-03 · câu lỗi khi lưu cách tính: 422 mang đúng câu của mgmt (`config.problem`, tiếng Việt) ⇒ hiện nguyên; 403 / mạng / lạ
// ⇒ câu theo mã (không hiện thông điệp thô khác).
import { ApiError } from "@ai/web-kit/http";

export function scoringErrorText(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    const code: string = e.code;
    if (code === "SCORING_INVALID") return e.message;
    if (code === "PACK_FORBIDDEN") return t("contracts.ledger.errors.PACK_FORBIDDEN");
    if (code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}
