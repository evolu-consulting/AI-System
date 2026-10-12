// CHAT-AC-53/60 · lỗi của `POST /review-tasks/:id/decision` → câu hiển thị. Thuần.
import type { TFunction } from "i18next";
import { ApiError } from "~/lib/http";

/** `null` ⇒ việc đã đóng (người khác xử lý trước), thoát êm; ngược lại ⇒ câu lỗi cho composer/ô inline. */
export function reviewErrorMessage(err: unknown, t: TFunction): string | null {
  if (err instanceof ApiError) {
    if (err.code === "REVIEW_TASK_CLOSED") return null;
    const key = `process.common.apiError.${err.code}`;
    const msg = t(key);
    if (msg !== key) return msg;
  }
  return t("process.common.error.network");
}

/** Lỗi nghĩa là view đã cũ (đóng/đổi bước) ⇒ làm tươi để thẻ tự đóng hoặc đổi tuỳ chọn. */
export const isStaleReviewError = (err: unknown): boolean =>
  err instanceof ApiError &&
  (err.code === "REVIEW_TASK_CLOSED" ||
    err.code === "BACK_TARGET_INVALID" ||
    err.code === "PROCESS_RUN_STATE");
