// CHAT-AC-31, HUB-FR-43 · mã lỗi HTTP kênh chat + mã `run.failed` (spec C1 §3, plan §2.4–§2.5).
// `/auth/*` giữ mã của Admin (`API_ERRORS` trong `../common`), không lặp ở đây.
import { z } from "zod";

/** Mã lỗi HTTP của endpoint Hub (không phải `/auth/*`) → status. */
export const CHAT_API_ERRORS = {
  VALIDATION_ERROR: 400,
  AUTH_EXPIRED: 401,
  NOT_FOUND: 404,
  FLOW_BUSY: 409,
  EVENTS_EXPIRED: 410,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, 400 | 401 | 404 | 409 | 410 | 500>;

export type ChatErrorCode = keyof typeof CHAT_API_ERRORS;
export type ChatApiErrorStatus = (typeof CHAT_API_ERRORS)[ChatErrorCode];
export const CHAT_ERROR_CODES = Object.keys(CHAT_API_ERRORS) as ChatErrorCode[];
export const ChatErrorCodeSchema = z.enum(CHAT_ERROR_CODES as [ChatErrorCode, ...ChatErrorCode[]]);

/** Mã trong `run.failed.code` và `RunError.code`; câu chữ ở ui-chat-extension §8. */
export const CHAT_RUN_ERROR_CODES = [
  "ALL_PROVIDERS_EXHAUSTED",
  "TIMEOUT",
  "UPSTREAM_ERROR",
  "CANCELLED",
  "BUDGET_EXCEEDED",
  "NOT_CONFIGURED",
  "INTERNAL_ERROR",
] as const;
