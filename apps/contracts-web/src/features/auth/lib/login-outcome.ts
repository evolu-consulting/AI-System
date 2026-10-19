// PK-FR-10 · TF4 · L1b · kết quả đăng nhập → câu báo (key i18n + tham số). Sai thông tin luôn là một câu chung.
import type { LoginResponse } from "@ai/contracts/chat";
import { lockUntilClock, retryMinutes } from "@ai/web-kit/auth-limit";
import { ApiError } from "@ai/web-kit/http";

export type LoginMessage = { key: string; params?: Record<string, string | number> };
/** `null` = vào app; còn lại = câu hiện trong vùng `role=alert`. */
export type LoginOutcome = LoginMessage | null;

/** Không có bước đổi mật khẩu / 2FA ở app gói: hai trạng thái đó → nhắc hoàn tất trong trang quản trị. */
export function outcomeOfResponse(res: LoginResponse): LoginOutcome {
  return res.status === "authenticated" ? null : { key: "contracts.login.useAdmin" };
}

/** L1: khoá tạm có giờ ⇒ "Tạm khoá đến HH:MM"; quá nhiều lượt ⇒ "N phút"; 503 giới hạn ⇒ tạm không khả dụng. */
function limitMessage(err: ApiError): LoginMessage | null {
  if (err.code === "TEMP_LOCKED") {
    const time = lockUntilClock(err.details);
    return time ? { key: "contracts.login.tempLocked", params: { time } } : null;
  }
  if (err.code === "RATE_LIMITED") {
    const minutes = retryMinutes(err.details, err.retryAfter);
    return { key: "contracts.login.rateLimited", params: { minutes } };
  }
  if (err.code === "AUTH_UNAVAILABLE") return { key: "contracts.login.unavailable" };
  return null;
}

export function outcomeOfError(err: unknown): LoginOutcome {
  if (!(err instanceof ApiError)) return { key: "contracts.errors.unknown" };
  const limited = limitMessage(err);
  if (limited) return limited;
  if (err.code === "ACCOUNT_LOCKED" || err.code === "TEMP_LOCKED")
    return { key: "contracts.login.locked" };
  if (err.code === "NETWORK_ERROR") return { key: "contracts.errors.network" };
  if (err.status >= 500 || err.status === 0) return { key: "contracts.errors.unknown" };
  return { key: "contracts.login.invalid" };
}
