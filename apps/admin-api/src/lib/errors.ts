// ADM-NFR-06, ADM-FR-01 · lỗi có mã (CONVENTIONS §5, spec M0 §3.1, M1 §3). Status lấy từ API_ERRORS (một nguồn).
import { API_ERRORS, type ErrorCode, type ErrorResponse } from "@ai/contracts";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: ContentfulStatusCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Message tiếng Anh cố định theo mã; web dịch theo `code`. Không chứa dữ liệu người dùng. */
const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Invalid request",
  TENANT_REQUIRED: "tenant_id is required",
  ROLE_NOT_ALLOWED: "Role not allowed",
  EMAIL_REQUIRED: "Email is required for this role",
  PASSWORD_UNCHANGED: "New password must differ from the current one",
  INVALID_CURRENT_PASSWORD: "Current password is incorrect",
  UNAUTHORIZED: "Unauthorized",
  INVALID_CREDENTIALS: "Invalid company code, username or password",
  INVALID_REFRESH_TOKEN: "Invalid refresh token",
  REFRESH_SUPERSEDED: "Refresh token was just rotated",
  INVALID_CHANGE_TOKEN: "Invalid or expired change token",
  FORBIDDEN: "Forbidden",
  ACCOUNT_LOCKED: "Account is locked",
  SELF_ACTION_FORBIDDEN: "This action cannot be applied to yourself",
  NOT_FOUND: "Not found",
  VERSION_CONFLICT: "Version conflict",
  KEY_TAKEN: "Company code is already taken",
  USERNAME_TAKEN: "Username is already taken",
  EMAIL_TAKEN: "Email is already taken",
  LAST_ADMIN: "Cannot remove the last active admin",
  PLATFORM_TENANT_LOCKED: "The platform tenant cannot be locked",
  TEMP_LOCKED: "Temporarily locked",
  INTERNAL_ERROR: "Internal server error",
};

export function appError(code: ErrorCode, details?: unknown): AppError {
  return new AppError(code, API_ERRORS[code] as ContentfulStatusCode, MESSAGES[code], details);
}

export function isAppError(err: unknown, code?: ErrorCode): err is AppError {
  return err instanceof AppError && (code === undefined || err.code === code);
}

/** Không thêm key `details` khi vắng, để body khớp tuyệt đối `{error:{code,message}}`. */
export function toErrorBody(code: string, message: string, details?: unknown): ErrorResponse {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}
