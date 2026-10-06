// HUB-FR-72 · mã lỗi API Studio → key i18n `errors.<CODE>` (plan-frontend-copy "Lỗi theo mã"); mã lạ → `login.err.server`.
import { ApiError } from "./http";

export type MessageSpec = { key: string; params?: Record<string, string> };

const KNOWN = new Set([
  "FORBIDDEN",
  "INVALID_REFERENCE",
  "BASH_ACK_REQUIRED",
  "AGENT_IN_USE_AS_ORCHESTRATOR",
  "AGENT_HAS_HISTORY",
  "AGENT_HAS_ACCESS",
  "ORCHESTRATOR_EXISTS",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "KEY_TAKEN",
  "AGENT_NOT_ORCHESTRATABLE",
  "ORCHESTRATOR_DEFAULT_PROTECTED",
  "TENANT_INACTIVE",
]);

export function describeApiError(err: unknown): MessageSpec {
  if (!(err instanceof ApiError)) return { key: "login.err.server", params: { code: "UNKNOWN" } };
  if (err.code === "NETWORK_ERROR") return { key: "login.err.network" };
  if (err.code === "VERSION_CONFLICT") return { key: "errors.VERSION_CONFLICT" };
  if (KNOWN.has(err.code)) {
    const field = (err.details as { field?: unknown } | null | undefined)?.field;
    return { key: `errors.${err.code}`, params: { field: typeof field === "string" ? field : "" } };
  }
  return {
    key: "login.err.server",
    params: { code: err.code === "HTTP_ERROR" ? "UNKNOWN" : err.code },
  };
}
