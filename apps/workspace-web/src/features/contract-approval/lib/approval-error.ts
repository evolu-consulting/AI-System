// HD-FR-34 · HD-FR-35 · S05: câu lỗi của thao tác duyệt (không hiện thông điệp thô máy chủ). Mã lạ ⇒ câu chung của trang.
import { ApiError } from "@ai/web-kit/http";

type T = (key: string, o?: Record<string, unknown>) => string;

const KEYS: Record<string, string> = {
  STARTER_CANNOT_REVIEW: "contracts.approval.errors.starter",
  NOT_REVIEWER: "contracts.approval.errors.notReviewer",
  FEEDBACK_REQUIRED: "contracts.approval.errors.reason",
  APPROVAL_NOT_OPEN: "contracts.approval.errors.notOpen",
  REVIEW_TASK_CLOSED: "contracts.approval.errors.notOpen",
  EXTRACT_BUSY: "contracts.approval.errors.notOpen",
  // CR-107: Thử lại / Huỷ & mở lại / Mở lại.
  APPROVAL_GROUP_MISSING: "contracts.approval.errors.groupMissing",
  // p24 · 409 Mở lại khi lượt đang chờ mở quy trình; 422 quy trình dùng phòng ban công ty chưa có
  APPROVAL_FLOW_STARTING: "contracts.approval.errors.flowStarting",
  GROUPS_MISSING: "contracts.approval.errors.groupsMissing",
  FORBIDDEN: "contracts.approval.errors.notOwner",
  PACK_FORBIDDEN: "contracts.approval.errors.notOwner",
  ENGINE_UNAVAILABLE: "contracts.approval.errors.engineUnavailable",
};

export function approvalErrorText(e: unknown, t: T): string {
  if (!(e instanceof ApiError)) return t("contracts.errors.unknown");
  const code: string = e.code; // mã gói hợp đồng không nằm trong `ApiErrorCode` (chat)
  const k = KEYS[code];
  if (k) return t(k);
  if (code === "ACTION_QUOTA") {
    const limit = (e.details as { limit?: number } | undefined)?.limit;
    return t("contracts.approval.errors.quota", { limit: limit ?? "" });
  }
  if (code === "TOO_MANY_PROCESS_RUNS") {
    const max = (e.details as { max?: number } | undefined)?.max;
    return t("contracts.approval.errors.runLimit", { max: max ?? "" });
  }
  if (code === "NETWORK_ERROR") return t("contracts.errors.network");
  return t("contracts.errors.unknown");
}
