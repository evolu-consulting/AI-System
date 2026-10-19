// PK-FR-10 · TF4 · kết quả đăng nhập → câu báo (key i18n). Sai thông tin luôn là một câu chung (không nói ô nào sai).
import type { LoginResponse } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";

/** `null` = vào app; chuỗi = key i18n hiện trong vùng `role=alert`. */
export type LoginOutcome = string | null;

const LOCKED_CODES = new Set<string>(["ACCOUNT_LOCKED", "TEMP_LOCKED"]);

/** Không có bước đổi mật khẩu / 2FA ở app gói: hai trạng thái đó → nhắc hoàn tất trong trang quản trị. */
export function outcomeOfResponse(res: LoginResponse): LoginOutcome {
  return res.status === "authenticated" ? null : "contracts.login.useAdmin";
}

export function outcomeOfError(err: unknown): LoginOutcome {
  if (!(err instanceof ApiError)) return "contracts.errors.unknown";
  if (LOCKED_CODES.has(err.code)) return "contracts.login.locked";
  if (err.code === "NETWORK_ERROR") return "contracts.errors.network";
  if (err.status >= 500 || err.status === 0) return "contracts.errors.unknown";
  return "contracts.login.invalid";
}
