// fix-stale-resubmit · câu lỗi dùng chung cho mọi thao tác trên HĐ: mã máy chủ ⇒ câu dễ hiểu, không bao giờ hiện thông điệp thô (tiếng Anh).
import { ApiError } from "@ai/web-kit/http";

type T = (key: string, o?: Record<string, unknown>) => string;

/** Câu khi bản HĐ trên màn đã cũ (người khác — hoặc chính thao tác trước — vừa đổi `version`); màn đã tự tải lại bản mới. */
export const STALE_KEY = "contracts.errors.stale";

export const isStale = (e: unknown): boolean =>
  e instanceof ApiError && (e.code as string) === "CONTRACT_STALE";

/** Mã chưa có câu riêng ⇒ câu chung «Có lỗi, thử lại» kèm mã trong ngoặc (để báo hỗ trợ); không có mã (mạng / thân lạ) ⇒ câu chung thuần. */
export function unknownErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    const code = e.code as string;
    if (code && code !== "HTTP_ERROR" && code !== "NETWORK_ERROR")
      return t("contracts.errors.unknownCode", { code });
  }
  return t("contracts.errors.unknown");
}
