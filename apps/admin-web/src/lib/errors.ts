// ADM-FR-01, ADM-FR-04, ADM-FR-60, ADM-FR-10 · M2-R28 · mã lỗi API → key i18n (plan-frontend §6). Không hiển thị `message` của server nếu đã có key.

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
  // M2 (plan-frontend §8)
  "secrets.error.nameTaken",
  "secrets.delete.blocked",
  "workflows.delete.blocked",
  "workflows.blocked.disable",
  "workflows.schemaBreaks",
  "workflows.error.keyTaken",
  "commands.error.workflowDisabled",
  "commands.error.nameTaken",
  "commands.error.featureRequired",
  "commands.error.mapMissing",
  "commands.error.mapUnknown",
  "commands.error.mapUnknownArg",
  "features.error.coreProtected",
  "features.error.keyTaken",
  "features.delete.blocked",
  "errors.invalidReference",
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
  SECRET_NAME_TAKEN: "secrets.error.nameTaken",
  SECRET_IN_USE: "secrets.delete.blocked",
  SCHEMA_BREAKS_COMMANDS: "workflows.schemaBreaks",
  WORKFLOW_DISABLED: "commands.error.workflowDisabled",
  COMMAND_NEEDS_FEATURE: "commands.error.featureRequired",
  CORE_FEATURE_PROTECTED: "features.error.coreProtected",
  FEATURE_HAS_EXCLUSIVE_COMMANDS: "features.delete.blocked",
  INVALID_REFERENCE: "errors.invalidReference",
};

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** `INPUT_MAP_INVALID`: mỗi nhóm không rỗng thành một câu (server chỉ gửi message cố định tiếng Anh). */
export function describeInputMapErrors(details: unknown): MessageSpec[] {
  const d = (details ?? {}) as Record<string, unknown>;
  const groups: [string, string][] = [
    ["missing", "commands.error.mapMissing"],
    ["unknown", "commands.error.mapUnknown"],
    ["unknown_args", "commands.error.mapUnknownArg"],
  ];
  return groups.flatMap(([field, key]) => {
    const names = asList(d[field]);
    return names.length ? [{ key, params: { names: names.join(", ") } }] : [];
  });
}

function detailString(details: unknown, field: string): string {
  const v = (details as Record<string, unknown> | null | undefined)?.[field];
  return typeof v === "string" ? v : "";
}

/** Lỗi → câu hiển thị. Mã chưa biết/5xx → `toast.saveFailed` kèm `message` server làm lý do. */
export function describeError(err: unknown, opts?: { keyTaken?: string }): MessageSpec {
  if (!(err instanceof ApiError)) return { key: "toast.saveFailed", params: { reason: "" } };
  if (err.code === "TEMP_LOCKED") {
    return { key: "auth.error.tempLocked", params: { time: untilTime(err.details) } };
  }
  if (err.code === "KEY_TAKEN" && opts?.keyTaken) return { key: opts.keyTaken };
  if (err.code === "LAST_ADMIN") return { key: lastAdminKey(err.details) };
  if (err.code === "COMMAND_NAME_TAKEN") {
    return { key: "commands.error.nameTaken", params: { name: detailString(err.details, "name") } };
  }
  if (err.code === "WORKFLOW_IN_USE") {
    const disable = detailString(err.details, "action") === "disable";
    return { key: disable ? "workflows.blocked.disable" : "workflows.delete.blocked" };
  }
  if (err.code === "INPUT_MAP_INVALID") {
    const first = describeInputMapErrors(err.details)[0];
    if (first) return first;
  }
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
