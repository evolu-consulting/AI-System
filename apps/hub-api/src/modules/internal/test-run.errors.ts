// HUB-FR-51, HUB-FR-89 · lỗi HTTP `/internal/test-run` ngoài bảng chat (plan-errors H2a §1): status lấy từ contract
// `HUB_INTERNAL_ERRORS` (một nguồn), câu tiếng Anh cố định, không dữ liệu động.
import { HUB_INTERNAL_ERRORS } from "@ai/contracts/hub-internal";
import { AppError } from "../../lib/errors";

type InternalOnlyCode = "UNAUTHORIZED" | "NOT_CONFIGURED" | "UNAVAILABLE";

const MESSAGES: Record<InternalOnlyCode, string> = {
  UNAUTHORIZED: "Unauthorized",
  NOT_CONFIGURED: "Not configured",
  UNAVAILABLE: "Service unavailable",
};

export function internalError(code: InternalOnlyCode): AppError {
  return new AppError(code, HUB_INTERNAL_ERRORS[code], MESSAGES[code]);
}
