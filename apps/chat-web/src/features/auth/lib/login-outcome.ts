// CHAT-AC-01, CHAT-AC-02 · kết quả đăng nhập → việc UI làm. Lỗi thông tin luôn là một câu chung (không nói ô nào sai).
import type { LoginResponse } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";

export type LoginOutcome =
  | { kind: "ok" }
  /** Câu báo trong vùng `role=alert` trên nút Đăng nhập (key i18n). */
  | { kind: "alert"; key: string }
  /** Tài khoản / công ty bị khoá (kể cả khoá tạm sau nhiều lần sai) → LockedDialog. */
  | { kind: "locked" };

const LOCKED_CODES = new Set<string>(["ACCOUNT_LOCKED", "TEMP_LOCKED"]);

/** Chat không có bước đổi mật khẩu / 2FA: hai trạng thái đó → nhắc hoàn tất trong Evolu Control. */
export function outcomeOfResponse(res: LoginResponse): LoginOutcome {
  return res.status === "authenticated" ? { kind: "ok" } : { kind: "alert", key: "login.useAdmin" };
}

export function outcomeOfError(err: unknown): LoginOutcome {
  if (!(err instanceof ApiError)) return { kind: "alert", key: "errors.unknown.title" };
  if (LOCKED_CODES.has(err.code)) return { kind: "locked" };
  if (err.code === "NETWORK_ERROR") return { kind: "alert", key: "conn.down" };
  if (err.status >= 500 || err.status === 0) return { kind: "alert", key: "errors.unknown.title" };
  return { kind: "alert", key: "login.invalid" };
}
