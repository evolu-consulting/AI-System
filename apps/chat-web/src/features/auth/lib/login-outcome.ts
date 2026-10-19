// CHAT-AC-01, CHAT-AC-02 · L1b · kết quả đăng nhập → việc UI làm. Lỗi thông tin luôn là một câu chung (không nói ô nào sai).
import type { LoginResponse } from "@ai/contracts/chat";
import { lockUntilClock, retryMinutes } from "@ai/web-kit/auth-limit";
import { ApiError } from "@ai/web-kit/http";

export type LoginOutcome =
  | { kind: "ok" }
  /** Câu báo trong vùng `role=alert` trên nút Đăng nhập (key i18n + tham số). */
  | { kind: "alert"; key: string; params?: Record<string, string | number> }
  /** Tài khoản / công ty bị khoá (hoặc khoá tạm không rõ giờ mở) → LockedDialog. */
  | { kind: "locked" };

/** Chat không có bước đổi mật khẩu / 2FA: hai trạng thái đó → nhắc hoàn tất trong Evolu Control. */
export function outcomeOfResponse(res: LoginResponse): LoginOutcome {
  return res.status === "authenticated" ? { kind: "ok" } : { kind: "alert", key: "login.useAdmin" };
}

/** L1: khoá tạm có giờ mở ⇒ "Tạm khoá đến HH:MM"; quá nhiều lượt ⇒ "thử lại sau N phút"; 503 giới hạn ⇒ tạm không khả dụng. */
function limitOutcome(err: ApiError): LoginOutcome | null {
  if (err.code === "TEMP_LOCKED") {
    const time = lockUntilClock(err.details);
    return time ? { kind: "alert", key: "login.tempLocked", params: { time } } : { kind: "locked" };
  }
  if (err.code === "RATE_LIMITED") {
    const minutes = retryMinutes(err.details, err.retryAfter);
    return { kind: "alert", key: "login.rateLimited", params: { minutes } };
  }
  if (err.code === "AUTH_UNAVAILABLE") return { kind: "alert", key: "login.unavailable" };
  return null;
}

export function outcomeOfError(err: unknown): LoginOutcome {
  if (!(err instanceof ApiError)) return { kind: "alert", key: "errors.unknown.title" };
  const limited = limitOutcome(err);
  if (limited) return limited;
  if (err.code === "ACCOUNT_LOCKED") return { kind: "locked" };
  if (err.code === "NETWORK_ERROR") return { kind: "alert", key: "conn.down" };
  if (err.status >= 500 || err.status === 0) return { kind: "alert", key: "errors.unknown.title" };
  return { kind: "alert", key: "login.invalid" };
}
