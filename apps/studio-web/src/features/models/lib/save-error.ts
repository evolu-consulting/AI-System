// HUB-FR-66 · lỗi lưu/xoá provider (không phải VERSION_CONFLICT) → lỗi gắn trường (key i18n) hoặc toast.
import { describeApiError, type MessageSpec } from "#/lib/api-error";

export type ProviderField = "key" | "vendor" | "secret_id" | "base_url" | "max_concurrency";
export type SaveFailure = { field?: ProviderField; message?: string; toast?: MessageSpec };

type Detailed = { code?: unknown; details?: { issues?: unknown; field?: unknown } | null };
const ISSUE_KEY: Record<ProviderField, string> = {
  key: "models.err.key",
  vendor: "models.err.vendor",
  secret_id: "models.err.secret",
  base_url: "models.err.baseUrl",
  max_concurrency: "models.err.slots",
};
const isField = (v: string): v is ProviderField => v in ISSUE_KEY;

const CODE_TOAST: Record<string, string> = {
  PROVIDER_HAS_HISTORY: "models.errors.providerHasHistory",
  PROVIDER_READONLY: "models.errors.providerReadonly",
  PROVIDER_IN_USE: "models.errors.providerInUse",
  NOT_CONFIGURED: "errors.NOT_CONFIGURED",
};

function fromIssues(raw: unknown): SaveFailure | null {
  if (!Array.isArray(raw)) return null;
  for (const i of raw as { path?: unknown }[]) {
    const head = Array.isArray(i.path) ? String(i.path[0]) : String(i.path ?? "");
    if (isField(head)) return { field: head, message: ISSUE_KEY[head] };
  }
  return null;
}

export function classifySaveError(err: unknown): SaveFailure {
  const e = (err ?? {}) as Detailed;
  if (e.code === "KEY_TAKEN") return { field: "key", message: "models.errors.keyTaken" };
  if (e.code === "INVALID_REFERENCE" && e.details?.field === "secret_id")
    return { field: "secret_id", message: ISSUE_KEY.secret_id };
  const issue = e.code === "VALIDATION_ERROR" ? fromIssues(e.details?.issues) : null;
  if (issue) return issue;
  const key = typeof e.code === "string" ? CODE_TOAST[e.code] : undefined;
  return { toast: key ? { key } : describeApiError(err) };
}
