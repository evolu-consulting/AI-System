// com-fix-community-login · CR-102 · luật thuần của màn Đăng nhập community-web (như contracts-web: Mã công ty / Tên đăng nhập /
// Mật khẩu, gọi thẳng admin-api `/auth/*` với `X-App: community` ⇒ cookie `ai_rt_community`). Đối tác không cần chat-web.
// Bước kế sau `/auth/login` hoặc `/auth/totp/verify`: vào app / đổi mật khẩu bắt buộc / nhập mã 2FA. Câu báo tiếng Việt.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts";
import type { LoginResponse } from "@ai/contracts/chat";
import { lockUntilClock, retryMinutes } from "@ai/web-kit/auth-limit";
import { ApiError } from "@ai/web-kit/http";

export type LoginStep =
  | { kind: "done" }
  | { kind: "change"; token: string }
  | { kind: "totp"; token: string };
export type AuthStage = "login" | "change" | "totp";

/** Mã công ty / tên đăng nhập gửi lên: trim + chữ thường (khớp `LoginIdSchema`). */
export const normalizeLoginId = (v: string): string => v.trim().toLowerCase();

export function stepOf(res: LoginResponse): LoginStep {
  if (res.status === "password_change_required") return { kind: "change", token: res.change_token };
  if (res.status === "totp_required") return { kind: "totp", token: res.totp_token };
  return { kind: "done" };
}

function limitMessage(err: ApiError): string | null {
  if (err.code === "TEMP_LOCKED") {
    const time = lockUntilClock(err.details);
    return time ? `Tài khoản tạm khoá đến ${time}. Vui lòng thử lại sau.` : null;
  }
  if (err.code === "RATE_LIMITED")
    return `Thử quá nhiều lần. Vui lòng thử lại sau ${retryMinutes(err.details, err.retryAfter)} phút.`;
  if (err.code === "AUTH_UNAVAILABLE")
    return "Đăng nhập tạm thời không khả dụng. Vui lòng thử lại sau.";
  return null;
}

/** Lỗi ở từng bước → câu báo. Sai thông tin luôn là một câu chung (không lộ tài khoản có tồn tại hay không). */
export function loginError(err: unknown, stage: AuthStage = "login"): string {
  if (!(err instanceof ApiError)) return "Có lỗi xảy ra. Vui lòng thử lại.";
  const limited = limitMessage(err);
  if (limited) return limited;
  const code: string = err.code;
  if (code === "ACCOUNT_LOCKED" || code === "TEMP_LOCKED")
    return "Tài khoản đã bị khoá. Liên hệ quản trị viên của bên chủ quản.";
  if (code === "NETWORK_ERROR") return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  if (code === "INVALID_CHANGE_TOKEN" || code === "INVALID_TOTP_TOKEN")
    return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (err.status >= 500 || err.status === 0) return "Có lỗi xảy ra. Vui lòng thử lại.";
  if (stage === "change")
    return code === "PASSWORD_UNCHANGED"
      ? "Mật khẩu mới phải khác mật khẩu tạm."
      : `Mật khẩu mới chưa đạt yêu cầu (${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} ký tự).`;
  if (stage === "totp") return "Mã xác thực không đúng.";
  return "Mã công ty, tên đăng nhập hoặc mật khẩu không đúng.";
}

/** Kiểm tra form đổi mật khẩu bắt buộc ở trình duyệt (server kiểm lại). null = hợp lệ. */
export function newPasswordError(next: string, confirm: string): string | null {
  if (next.length < PASSWORD_MIN_LEN || next.length > PASSWORD_MAX_LEN)
    return `Mật khẩu mới cần ${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} ký tự.`;
  if (next !== confirm) return "Hai mật khẩu không khớp.";
  return null;
}

/** Link "Đăng nhập bằng AI System" (nội bộ): `login=1` ⇒ AI System chưa có phiên thì hỏi đăng nhập rồi quay lại; đích quay về do
 *  admin-api lấy từ catalog (link không mang URL nào). null = chưa cấu hình SSO. */
export function ssoLoginHref(ssoBase: string, app: string): string | null {
  const base = ssoBase.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/sso?${new URLSearchParams({ app, next: "/", login: "1" })}`;
}
