// HUB-FR-43 · CHAT-AC-31 · lỗi có mã theo `CHAT_API_ERRORS` (contract chat, plan §4). Status lấy từ contract (một nguồn).
import { CHAT_API_ERRORS, type ChatErrorCode, type ErrorResponse } from "@ai/contracts/chat";
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

/** Message tiếng Anh cố định theo mã; client dịch theo `code`. Không chứa dữ liệu người dùng. */
export const ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  VALIDATION_ERROR: "Invalid request",
  AUTH_EXPIRED: "Session expired",
  NOT_FOUND: "Not found",
  FLOW_BUSY: "Flow is busy",
  EVENTS_EXPIRED: "Run events have expired",
  INTERNAL_ERROR: "Internal server error",
};

export function appError(code: ChatErrorCode, details?: unknown): AppError {
  return new AppError(code, CHAT_API_ERRORS[code], ERROR_MESSAGES[code], details);
}

export function isAppError(err: unknown, code?: ChatErrorCode): err is AppError {
  return err instanceof AppError && (code === undefined || err.code === code);
}

/** Không thêm key `details` khi vắng, để body khớp tuyệt đối `{error:{code,message}}`. */
export function toErrorBody(code: string, message: string, details?: unknown): ErrorResponse {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

/** Lỗi bất kỳ → status + body. Lỗi lạ → 500 INTERNAL_ERROR (người gọi log riêng, không lộ message). */
export function mapError(err: unknown): { status: ContentfulStatusCode; body: ErrorResponse } {
  if (err instanceof AppError) {
    return { status: err.status, body: toErrorBody(err.code, err.message, err.details) };
  }
  return { status: 500, body: toErrorBody("INTERNAL_ERROR", ERROR_MESSAGES.INTERNAL_ERROR) };
}

/** Trường an toàn để log: tên + message, bỏ SQL/tham số (DrizzleQueryError mang câu SQL, lỗi gốc ở `cause`). */
export function safeErrorFields(err: unknown): { error_name: string; error: string } {
  if (!(err instanceof Error)) return { error_name: typeof err, error: "non-error thrown" };
  const cause = (err as { cause?: unknown }).cause;
  const src = "query" in err && cause instanceof Error ? cause : err;
  return { error_name: src.name, error: src.message };
}
