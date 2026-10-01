// ADM-FR-60, ADM-FR-61 · mã lỗi của module tenants (bảng mã: API_ERRORS, spec M1 §3).
import type { ErrorCode } from "@ai/contracts";

export const TENANTS_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "KEY_TAKEN",
  "VERSION_CONFLICT",
  "PLATFORM_TENANT_LOCKED",
] as const satisfies readonly ErrorCode[];
