// ADM-FR-04, ADM-FR-05, ADM-FR-63, ADM-BR-08 · mã lỗi của module users (bảng mã: API_ERRORS, spec M1 §3).
import type { ErrorCode } from "@ai/contracts";

export const USERS_ERROR_CODES = [
  "VALIDATION_ERROR",
  "TENANT_REQUIRED",
  "ROLE_NOT_ALLOWED",
  "EMAIL_REQUIRED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "SELF_ACTION_FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "USERNAME_TAKEN",
  "EMAIL_TAKEN",
  "LAST_ADMIN",
] as const satisfies readonly ErrorCode[];
