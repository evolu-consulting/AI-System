// CR-118 · cr118-auth · lỗi từng bước login gộp → câu báo (khoá i18n + tham số). Gộp luật L1b của contracts-web với bước đổi
// mật khẩu bắt buộc / TOTP của community-web (com-fix-community-login). Sai thông tin luôn là một câu chung.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts";
import { lockUntilClock, retryMinutes } from "@ai/web-kit/auth-limit";
import { ApiError } from "@ai/web-kit/http";

export type AuthStage = "login" | "change" | "totp";
export type LoginMessage = { key: string; params?: Record<string, string | number> };

const K = (key: string, params?: LoginMessage["params"]): LoginMessage =>
  params ? { key: `contracts.${key}`, params } : { key: `contracts.${key}` };

function limitMessage(err: ApiError): LoginMessage | null {
  if (err.code === "TEMP_LOCKED") {
    const time = lockUntilClock(err.details);
    return time ? K("login.tempLocked", { time }) : null;
  }
  if (err.code === "RATE_LIMITED")
    return K("login.rateLimited", { minutes: retryMinutes(err.details, err.retryAfter) });
  if (err.code === "AUTH_UNAVAILABLE") return K("login.unavailable");
  return null;
}

function stageMessage(code: string, stage: AuthStage): LoginMessage {
  if (stage === "change")
    return code === "PASSWORD_UNCHANGED"
      ? K("login.passwordUnchanged")
      : K("login.passwordWeak", { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN });
  if (stage === "totp") return K("login.totpWrong");
  return K("login.invalid");
}

export function errorOf(err: unknown, stage: AuthStage): LoginMessage {
  if (!(err instanceof ApiError)) return K("errors.unknown");
  const limited = limitMessage(err);
  if (limited) return limited;
  const code: string = err.code;
  if (code === "ACCOUNT_LOCKED" || code === "TEMP_LOCKED") return K("login.locked");
  if (code === "NETWORK_ERROR") return K("errors.network");
  if (code === "INVALID_CHANGE_TOKEN" || code === "INVALID_TOTP_TOKEN") return K("login.expired");
  if (err.status >= 500 || err.status === 0) return K("errors.unknown");
  return stageMessage(code, stage);
}

/** Form đổi mật khẩu bắt buộc. null = hợp lệ. */
export function newPasswordError(next: string, confirm: string): LoginMessage | null {
  if (next.length < PASSWORD_MIN_LEN || next.length > PASSWORD_MAX_LEN)
    return K("login.passwordLen", { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN });
  if (next !== confirm) return K("login.passwordMismatch");
  return null;
}
