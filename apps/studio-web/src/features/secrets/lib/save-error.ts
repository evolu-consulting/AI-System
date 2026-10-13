// HUB-FR-68 · lỗi lưu (không phải VERSION_CONFLICT) → lỗi gắn trường (key i18n) hoặc toast theo mã.
import { describeApiError, type MessageSpec } from "#/lib/api-error";

export type SecretField = "name" | "value" | "scope";
export type SaveFailure = { field?: SecretField; message?: string; toast?: MessageSpec };

type Detailed = { code?: unknown; details?: { issues?: unknown } | null };
const FIELD: Record<string, SecretField> = { name: "name", value: "value", tenant_id: "scope" };
const ISSUE_KEY: Record<SecretField, string> = {
  name: "secrets.err.nameFormat",
  value: "secrets.err.valueLen",
  scope: "errors.VALIDATION_ERROR",
};

function fromIssues(err: unknown, raw: unknown): SaveFailure {
  const list = Array.isArray(raw) ? (raw as { path?: unknown }[]) : [];
  for (const i of list) {
    const head = Array.isArray(i.path) ? String(i.path[0]) : String(i.path ?? "");
    const field = FIELD[head];
    if (field) return { field, message: ISSUE_KEY[field] };
  }
  return { toast: describeApiError(err) };
}

export function classifySaveError(err: unknown): SaveFailure {
  const e = (err ?? {}) as Detailed;
  if (e.code === "SECRET_NAME_TAKEN") return { field: "name", message: "errors.SECRET_NAME_TAKEN" };
  if (e.code === "VALIDATION_ERROR") return fromIssues(err, e.details?.issues);
  return { toast: describeApiError(err) };
}
