// HUB-FR-62 · H4a-R07 · lỗi lưu (không phải VERSION_CONFLICT) → lỗi gắn trường hoặc toast theo mã.
import { describeApiError, type MessageSpec } from "#/lib/api-error";
import { mapIssues, type OrchErrors } from "./draft";

export type SaveFailure = { errors: OrchErrors; toast?: MessageSpec };

type Detailed = { code?: unknown; details?: { issues?: unknown; field?: unknown } | null };

/** Form có ô tenant không (Sheet theo tenant: có; form mặc định: không). */
type Ctx = { hasTenant: boolean };

/** Gắn lỗi vào ô `field` nếu form có ô đó; không có ô tương ứng → toast. */
function onField(err: unknown, field: unknown, ctx: Ctx): SaveFailure {
  const code = String((err as Detailed).code);
  if (field === "agent_id") return { errors: { agent_id: `errors.${code}` } };
  if (field === "tenant_id" && ctx.hasTenant) return { errors: { tenant_id: `errors.${code}` } };
  return { errors: {}, toast: describeApiError(err) };
}

export function classifySaveError(err: unknown, ctx: Ctx = { hasTenant: true }): SaveFailure {
  const e = (err ?? {}) as Detailed;
  switch (e.code) {
    case "VALIDATION_ERROR": {
      const raw = e.details?.issues;
      const errors = mapIssues(Array.isArray(raw) ? (raw as { path?: unknown }[]) : []);
      return Object.keys(errors).length > 0 ? { errors } : { errors, toast: describeApiError(err) };
    }
    case "ORCHESTRATOR_EXISTS":
    case "TENANT_INACTIVE":
      return onField(err, "tenant_id", ctx);
    case "INVALID_REFERENCE":
      return onField(err, e.details?.field, ctx);
    case "AGENT_NOT_ORCHESTRATABLE":
      return onField(err, "agent_id", ctx);
    default:
      return { errors: {}, toast: describeApiError(err) };
  }
}
