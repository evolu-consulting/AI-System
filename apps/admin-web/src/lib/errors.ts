// ADM-FR-01, ADM-FR-04, ADM-FR-60, ADM-FR-10 · M2-R28 · mã lỗi API → key i18n (plan-frontend §6). Không hiển thị `message` của server nếu đã có key.

import type { HubAdminErrorCode } from "@ai/contracts/hub-admin";
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
  // M3
  "groups.error.betaProtected",
  "access.error.notEntitled",
  "access.error.coreProtected",
  // X1 F5 (Hub `/agent-grants*`)
  "hubErrors.forbidden",
  "hubErrors.tenantRequired",
  "hubErrors.agentGone",
  "hubErrors.subjectGone",
  "hubErrors.notEntitled",
  "hubErrors.notGrantable",
  "hubErrors.network",
  // X1 F4 (`POST /admin/commands/test`, plan-frontend-copy.md)
  "commands.test.error.hubUnavailable",
  "commands.test.error.hubNotConfigured",
  "commands.test.error.notConfigured",
  "commands.test.error.invalidReference",
  "commands.test.error.forbidden",
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
  BETA_GROUP_PROTECTED: "groups.error.betaProtected",
  NOT_ENTITLED: "access.error.notEntitled",
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
export function describeError(
  err: unknown,
  opts?: { keyTaken?: string; coreProtected?: string },
): MessageSpec {
  if (!(err instanceof ApiError)) return { key: "toast.saveFailed", params: { reason: "" } };
  if (err.code === "TEMP_LOCKED") {
    return { key: "auth.error.tempLocked", params: { time: untilTime(err.details) } };
  }
  if (err.code === "KEY_TAKEN" && opts?.keyTaken) return { key: opts.keyTaken };
  if (err.code === "CORE_FEATURE_PROTECTED" && opts?.coreProtected)
    return { key: opts.coreProtected };
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

const HUB_KEYS: Record<Exclude<HubAdminErrorCode, "INVALID_REFERENCE">, string> = {
  FORBIDDEN: "hubErrors.forbidden",
  TENANT_REQUIRED: "hubErrors.tenantRequired",
  NOT_ENTITLED: "hubErrors.notEntitled",
  AGENT_NOT_GRANTABLE: "hubErrors.notGrantable",
};

/** Lỗi từ Hub `/agent-grants*` (`HUB_ADMIN_ERRORS`, plan-frontend §2.3): mạng/5xx/mã lạ → "Không kết nối được Hub". */
export function describeHubError(err: unknown): MessageSpec {
  if (!(err instanceof ApiError)) return { key: "hubErrors.network" };
  const code = err.code as string;
  if (code === "INVALID_REFERENCE") {
    const subject = detailString(err.details, "field") === "subject_id";
    return { key: subject ? "hubErrors.subjectGone" : "hubErrors.agentGone" };
  }
  const key = (HUB_KEYS as Record<string, string | undefined>)[code];
  return key && err.status < 500 ? { key } : { key: "hubErrors.network" };
}

type Issue = { path?: unknown; message?: unknown };

/** `VALIDATION_ERROR` của test: `details.issues[]` → "path: message; …" (path `run_as_user_id` đã đổi tên ở admin-api). */
export function validationIssues(details: unknown): { text: string; paths: string[] } {
  const raw = (details as { issues?: unknown } | null | undefined)?.issues;
  const issues = Array.isArray(raw) ? (raw as Issue[]) : [];
  const paths = issues.map((i) => (Array.isArray(i.path) ? i.path.join(".") : ""));
  const text = issues
    .map((i, n) => {
      const m = typeof i.message === "string" ? i.message : "";
      return paths[n] ? `${paths[n]}: ${m}` : m;
    })
    .filter((x) => x !== "")
    .join("; ");
  return { text, paths };
}

/** Lỗi gắn với ô "Chạy với tư cách": `INVALID_REFERENCE {field}` hoặc issue có path `run_as_user_id`. */
export function isRunAsError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === "INVALID_REFERENCE")
    return detailString(err.details, "field") === "run_as_user_id";
  return (
    err.code === "VALIDATION_ERROR" &&
    validationIssues(err.details).paths.includes("run_as_user_id")
  );
}

/**
 * Lỗi "Chạy thử" (`POST /admin/commands/test`, `COMMAND_TEST_ERRORS` + `FORBIDDEN`/`VALIDATION_ERROR`/`INVALID_REFERENCE`).
 * Trả các dòng hiển thị; `SIDE_EFFECT_CONFIRM_REQUIRED` do panel xử lý (hộp xác nhận), không qua đây.
 * 5xx khác 503 / mã lạ ⇒ "Hub không phản hồi" (BL3: map theo status 502).
 */
export function describeCommandTestError(err: unknown, name: string): MessageSpec[] {
  if (!(err instanceof ApiError)) return [{ key: "commands.test.error.hubUnavailable" }];
  const code = err.code as string;
  const d = (err.details ?? {}) as Record<string, unknown>;
  switch (code) {
    case "NETWORK_ERROR":
      return [{ key: "auth.error.network" }];
    case "HUB_NOT_CONFIGURED":
      return [{ key: "commands.test.error.hubNotConfigured" }];
    case "NOT_CONFIGURED":
      return [{ key: "commands.test.error.notConfigured" }];
    case "INVALID_REFERENCE":
      return [{ key: "commands.test.error.invalidReference" }];
    case "FORBIDDEN":
      return [{ key: "commands.test.error.forbidden" }];
    case "CMD_MISSING_ARG": {
      const out: MessageSpec[] = [
        {
          key: "commands.test.error.missingArg",
          params: { name, missing: asList(d.missing).join(", ") },
        },
      ];
      const invalid = asList(d.invalid);
      if (invalid.length) {
        out.push({
          key: "commands.test.error.invalidArg",
          params: { invalid: invalid.join(", ") },
        });
      }
      return out;
    }
    case "VALIDATION_ERROR": {
      const text = validationIssues(err.details).text || err.message;
      return [{ key: "commands.test.error.validation", params: { message: text } }];
    }
    default:
      return [{ key: "commands.test.error.hubUnavailable" }];
  }
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
