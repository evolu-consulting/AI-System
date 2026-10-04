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

// HUB-FR-11, HUB-FR-14 · `CMD_*` (H2a plan §2.1, P3): hằng riêng — thêm vào `CHAT_API_ERRORS` làm đỏ test khoá C1 (đúng 6 mã).
export const CMD_SUGGESTIONS_MAX = 3;
export const CMD_ARG_LIST_MAX = 50;

/** Lỗi E12 khi tin là lệnh `/…`: trả JSON trước khi tạo run (R07). */
export const CHAT_COMMAND_ERRORS = {
  CMD_NOT_FOUND: 404,
  CMD_MISSING_ARG: 422,
} as const satisfies Record<string, 404 | 422>;

export type ChatCommandErrorCode = keyof typeof CHAT_COMMAND_ERRORS;
export const CHAT_COMMAND_ERROR_CODES = Object.keys(CHAT_COMMAND_ERRORS) as ChatCommandErrorCode[];

export const CmdNotFoundDetailsSchema = z.strictObject({
  suggestions: z.array(z.string()).max(CMD_SUGGESTIONS_MAX),
});
export type CmdNotFoundDetails = z.infer<typeof CmdNotFoundDetailsSchema>;

export const CmdMissingArgDetailsSchema = z.strictObject({
  missing: z.array(z.string()).max(CMD_ARG_LIST_MAX),
  invalid: z.array(z.string()).max(CMD_ARG_LIST_MAX),
});
export type CmdMissingArgDetails = z.infer<typeof CmdMissingArgDetailsSchema>;
