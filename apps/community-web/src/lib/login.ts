// com-fix-community-login · CR-102 · luật thuần của màn Đăng nhập community-web (như contracts-web: Mã công ty / Tên đăng nhập /
// Mật khẩu, gọi thẳng admin-api `/auth/*` với `X-App: community` ⇒ cookie `ai_rt_community`). Đối tác không cần chat-web.
// Bước kế sau `/auth/login` hoặc `/auth/totp/verify`: vào app / đổi mật khẩu bắt buộc / nhập mã 2FA. Câu báo tiếng Việt.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts";
import type { LoginResponse } from "@ai/contracts/chat";
import { retryMinutes } from "@ai/web-kit/auth-limit";
import { ApiError } from "@ai/web-kit/http";
import { t } from "../i18n";

export type LoginStep =
  | { kind: "done" }
  | { kind: "change"; token: string }
  | { kind: "totp"; token: string };
export type AuthStage = "login" | "change" | "totp";
const wrong = (): string => t("community.login.wrong");

/** Mã công ty / tên đăng nhập gửi lên: trim + chữ thường (khớp `LoginIdSchema`). */
export const normalizeLoginId = (v: string): string => v.trim().toLowerCase();

export function stepOf(res: LoginResponse): LoginStep {
  if (res.status === "password_change_required") return { kind: "change", token: res.change_token };
  if (res.status === "totp_required") return { kind: "totp", token: res.totp_token };
  return { kind: "done" };
}

function limitMessage(err: ApiError): string | null {
  if (err.code === "RATE_LIMITED")
    return t("community.login.rateLimited", { n: retryMinutes(err.details, err.retryAfter) });
  if (err.code === "AUTH_UNAVAILABLE") return t("community.login.unavailable");
  return null;
}

/** Lỗi ở từng bước → câu báo. Sai thông tin luôn là một câu chung (không lộ tài khoản có tồn tại hay không). */
export function loginError(err: unknown, stage: AuthStage = "login"): string {
  if (!(err instanceof ApiError)) return t("community.login.generic");
  const limited = limitMessage(err);
  if (limited) return limited;
  const code: string = err.code;
  // Review (thấp): TEMP_LOCKED được trả TRƯỚC khi kiểm mật khẩu và chỉ cho tên đăng nhập có thật ⇒ ở bước đăng nhập hiện như sai
  // thông tin (không lộ tài khoản tồn tại). ACCOUNT_LOCKED chỉ sau mật khẩu đúng ⇒ báo rõ được.
  if (code === "TEMP_LOCKED" && stage === "login") return wrong();
  if (code === "ACCOUNT_LOCKED" || code === "TEMP_LOCKED") return t("community.login.locked");
  if (code === "NETWORK_ERROR") return t("community.login.network");
  if (code === "INVALID_CHANGE_TOKEN" || code === "INVALID_TOTP_TOKEN")
    return t("community.login.expired");
  if (err.status >= 500 || err.status === 0) return t("community.login.generic");
  if (stage === "change")
    return code === "PASSWORD_UNCHANGED"
      ? t("community.login.passwordUnchanged")
      : t("community.login.passwordWeak", { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN });
  if (stage === "totp") return t("community.login.totpWrong");
  return wrong();
}

/** Kiểm tra form đổi mật khẩu bắt buộc ở trình duyệt (server kiểm lại). null = hợp lệ. */
export function newPasswordError(next: string, confirm: string): string | null {
  if (next.length < PASSWORD_MIN_LEN || next.length > PASSWORD_MAX_LEN)
    return t("community.login.passwordLen", { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN });
  if (next !== confirm) return t("community.login.passwordMismatch");
  return null;
}

/** Link "Đăng nhập bằng AI System" (nội bộ): `login=1` ⇒ AI System chưa có phiên thì hỏi đăng nhập rồi quay lại; đích quay về do
 *  admin-api lấy từ catalog (link không mang URL nào). null = chưa cấu hình SSO. */
export function ssoLoginHref(ssoBase: string, app: string): string | null {
  const base = ssoBase.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/sso?${new URLSearchParams({ app, next: "/", login: "1" })}`;
}
