// ADM-FR-01, ADM-FR-04, ADM-FR-60 · mã lỗi API → key i18n (plan-frontend §6). Không hiển thị `message` của server nếu đã có key.

import { formatClock } from "./format";
import { ApiError } from "./http";

export type MessageSpec = { key: string; params?: Record<string, string | number> };

/** Mọi key tĩnh mà `describeError` có thể trả về (test FE2 kiểm tồn tại trong vi.json/en.json). */
export const ERROR_MESSAGE_KEYS = [
  "auth.error.network",
  "auth.error.invalid",
  "auth.error.tempLocked",
  "auth.error.accountLocked",
  "auth.error.server",
  "password.error.currentWrong",
  "password.error.same",
  "password.error.tokenExpired",
  "state.forbiddenAction",
  "state.notFound.body",
  "errors.selfAction",
  "users.error.lastAdmin",
  "users.error.lastPlatformAdmin",
  "users.error.emailRequired",
  "users.error.usernameTaken",
  "users.error.emailTaken",
  "tenants.error.keyTaken",
  "common.tenantPicker.required",
  "errors.platformTenantLocked",
  "errors.versionConflict",
  "toast.saveFailed",
] as const;

function untilTime(details: unknown): string {
  const until = (details as { until?: unknown } | null | undefined)?.until;
  return typeof until === "string" ? formatClock(until) : "";
}

function lastAdminKey(details: unknown): string {
  const scope = (details as { scope?: unknown } | null | undefined)?.scope;
  return scope === "platform" ? "users.error.lastPlatformAdmin" : "users.error.lastAdmin";
}

const STATIC_KEYS: Partial<Record<string, string>> = {
  NETWORK_ERROR: "auth.error.network",
  INVALID_CREDENTIALS: "auth.error.invalid",
  ACCOUNT_LOCKED: "auth.error.accountLocked",
  INVALID_CURRENT_PASSWORD: "password.error.currentWrong",
  PASSWORD_UNCHANGED: "password.error.same",
  INVALID_CHANGE_TOKEN: "password.error.tokenExpired",
  FORBIDDEN: "state.forbiddenAction",
  NOT_FOUND: "state.notFound.body",
  SELF_ACTION_FORBIDDEN: "errors.selfAction",
  EMAIL_REQUIRED: "users.error.emailRequired",
  USERNAME_TAKEN: "users.error.usernameTaken",
  EMAIL_TAKEN: "users.error.emailTaken",
  KEY_TAKEN: "tenants.error.keyTaken",
  TENANT_REQUIRED: "common.tenantPicker.required",
  PLATFORM_TENANT_LOCKED: "errors.platformTenantLocked",
  VERSION_CONFLICT: "errors.versionConflict",
};

/** Lỗi → câu hiển thị. Mã chưa biết/5xx → `toast.saveFailed` kèm `message` server làm lý do. */
export function describeError(err: unknown): MessageSpec {
  if (!(err instanceof ApiError)) return { key: "toast.saveFailed", params: { reason: "" } };
  if (err.code === "TEMP_LOCKED") {
    return { key: "auth.error.tempLocked", params: { time: untilTime(err.details) } };
  }
  if (err.code === "LAST_ADMIN") return { key: lastAdminKey(err.details) };
  const key = STATIC_KEYS[err.code];
  if (key) return { key };
  return { key: "toast.saveFailed", params: { reason: err.message } };
}

/** Lỗi đăng nhập: 5xx/mã lạ → `auth.error.server` kèm mã. */
export function describeLoginError(err: unknown): MessageSpec {
  if (err instanceof ApiError) {
    const spec = describeError(err);
    if (spec.key === "toast.saveFailed") {
      return { key: "auth.error.server", params: { code: err.code } };
    }
    return spec;
  }
  return { key: "auth.error.server", params: { code: "UNKNOWN" } };
}
