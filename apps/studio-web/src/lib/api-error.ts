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
  "SECRET_IN_USE",
  "SECRET_NAME_TAKEN",
  "NOT_CONFIGURED",
  "KH_CONNECTION_EXISTS",
  "KH_CONNECTION_IN_USE",
  "KH_CONNECTION_NOT_FOUND",
  "KH_SECRET_INVALID",
  "KH_AGENT_RUNTIME",
  "KH_URL_NOT_ALLOWED",
]);

export function describeApiError(err: unknown): MessageSpec {
  if (!(err instanceof ApiError)) return { key: "login.err.server", params: { code: "UNKNOWN" } };
  if (err.code === "NETWORK_ERROR") return { key: "login.err.network" };
  if (err.code === "VERSION_CONFLICT") return { key: "errors.VERSION_CONFLICT" };
  if (KNOWN.has(err.code)) {
    const d = (err.details ?? {}) as { field?: unknown; reason?: unknown; agents?: unknown };
    const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
    if (err.code === "KH_URL_NOT_ALLOWED" && str(d.reason) === "")
      return { key: "errors.KH_URL_NOT_ALLOWED_BARE" };
    return {
      key: `errors.${err.code}`,
      params: { field: str(d.field), reason: str(d.reason), agents: str(d.agents) },
    };
  }
  return {
    key: "login.err.server",
    params: { code: err.code === "HTTP_ERROR" ? "UNKNOWN" : err.code },
  };
}
