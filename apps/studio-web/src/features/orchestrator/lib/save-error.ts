// HUB-FR-62 · H4a-R07 · lỗi lưu (không phải VERSION_CONFLICT) → lỗi gắn trường hoặc toast theo mã.
import { describeApiError, type MessageSpec } from "#/lib/api-error";
import { mapIssues, type OrchErrors } from "./draft";

export type SaveFailure = { errors: OrchErrors; toast?: MessageSpec };

type Detailed = { code?: unknown; details?: { issues?: unknown } | null };

export function classifySaveError(err: unknown): SaveFailure {
  const e = (err ?? {}) as Detailed;
  switch (e.code) {
    case "VALIDATION_ERROR": {
      const raw = e.details?.issues;
      const errors = mapIssues(Array.isArray(raw) ? (raw as { path?: unknown }[]) : []);
      return Object.keys(errors).length > 0 ? { errors } : { errors, toast: describeApiError(err) };
    }
    case "ORCHESTRATOR_EXISTS":
    case "TENANT_INACTIVE":
    case "INVALID_REFERENCE":
      return { errors: { tenant_id: `errors.${String(e.code)}` } };
    case "AGENT_NOT_ORCHESTRATABLE":
      return { errors: { agent_id: "errors.AGENT_NOT_ORCHESTRATABLE" } };
    default:
      return { errors: {}, toast: describeApiError(err) };
  }
}
