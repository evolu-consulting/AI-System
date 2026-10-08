// CHAT-AC-31, HUB-FR-43 · mã lỗi HTTP kênh chat + mã `run.failed` (spec C1 §3, plan §2.4–§2.5).
// `/auth/*` giữ mã của Admin (`API_ERRORS` trong `../common`), không lặp ở đây.
import { z } from "zod";
import { UuidSchema } from "../common";
import { ATTACH_PER_MESSAGE_MAX } from "./attachments";

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

// HUB-FR-91, HUB-FR-94 · lỗi định tuyến `@` + giới hạn run (H2b plan §2.1, P2, P9): hằng riêng — không đổi `CHAT_API_ERRORS`.
export const AGENT_SUGGESTIONS_MAX = 3;
export const RETRY_AFTER_HEADER = "Retry-After";
export const TOO_MANY_RUNS_RETRY_AFTER_S = 5;

/** Lỗi E12 trước khi tạo run: tag `@` không tìm thấy (404), vượt giới hạn run đang chạy (429 + `Retry-After`). */
export const CHAT_ROUTING_ERRORS = {
  AGENT_NOT_FOUND: 404,
  TOO_MANY_RUNS: 429,
} as const satisfies Record<string, 404 | 429>;

export type ChatRoutingErrorCode = keyof typeof CHAT_ROUTING_ERRORS;
export const CHAT_ROUTING_ERROR_CODES = Object.keys(CHAT_ROUTING_ERRORS) as ChatRoutingErrorCode[];

export const AgentNotFoundDetailsSchema = z.strictObject({
  suggestions: z.array(z.string()).max(AGENT_SUGGESTIONS_MAX),
});
export type AgentNotFoundDetails = z.infer<typeof AgentNotFoundDetailsSchema>;

// HUB-FR-44, HUB-FR-12 · lỗi đính kèm (H2c plan §2.1, P2): hằng riêng — không đổi `CHAT_API_ERRORS`.
/** Lỗi `POST /attachments` (413/415/409) và E12 (404 `ATTACHMENT_NOT_FOUND{ids}`). */
export const CHAT_ATTACHMENT_ERRORS = {
  ATTACHMENT_NOT_FOUND: 404,
  ATTACHMENT_QUOTA_EXCEEDED: 409,
  ATTACHMENT_TOO_LARGE: 413,
  ATTACHMENT_TYPE_NOT_ALLOWED: 415,
} as const satisfies Record<string, 404 | 409 | 413 | 415>;

export type ChatAttachmentErrorCode = keyof typeof CHAT_ATTACHMENT_ERRORS;
export const CHAT_ATTACHMENT_ERROR_CODES = Object.keys(
  CHAT_ATTACHMENT_ERRORS,
) as ChatAttachmentErrorCode[];

export const AttachmentNotFoundDetailsSchema = z.strictObject({
  ids: z.array(UuidSchema).min(1).max(ATTACH_PER_MESSAGE_MAX),
});
export type AttachmentNotFoundDetails = z.infer<typeof AttachmentNotFoundDetailsSchema>;

// HUB-FR-96…100 · lỗi phòng chat (X2a plan §2.1): hằng riêng, không đổi `CHAT_API_ERRORS`; 400 khác là `VALIDATION_ERROR`.
export const CHAT_ROOM_ERRORS = {
  ROOM_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  NOT_ROOM_OWNER: 403,
  DM_IMMUTABLE: 409,
  ROOM_FULL: 409,
  OWNER_MUST_TRANSFER: 409,
  GROUP_NOT_HIDEABLE: 409,
  DM_SELF: 400,
} as const satisfies Record<string, 400 | 403 | 404 | 409>;

export type ChatRoomErrorCode = keyof typeof CHAT_ROOM_ERRORS;
export const CHAT_ROOM_ERROR_CODES = Object.keys(CHAT_ROOM_ERRORS) as ChatRoomErrorCode[];

export const UserNotFoundDetailsSchema = z.strictObject({
  user_ids: z.array(UuidSchema).min(1).max(200),
});
export type UserNotFoundDetails = z.infer<typeof UserNotFoundDetailsSchema>;

/** `requested` = tổng thành viên sau khi thêm (gồm chủ). */
export const RoomFullDetailsSchema = z.strictObject({
  max: z.literal(50),
  requested: z.number().int().min(0),
});
export type RoomFullDetails = z.infer<typeof RoomFullDetailsSchema>;

// HUB-FR-101 · lỗi agent trong phòng (X2b plan §2.1, D9): hằng riêng, không đổi `CHAT_ROOM_ERRORS`. Không `details`.
export const CHAT_ROOM_AGENT_ERRORS = {
  NOT_RUN_CALLER: 403,
} as const satisfies Record<string, 403>;

export type ChatRoomAgentErrorCode = keyof typeof CHAT_ROOM_AGENT_ERRORS;
export const CHAT_ROOM_AGENT_ERROR_CODES = Object.keys(
  CHAT_ROOM_AGENT_ERRORS,
) as ChatRoomAgentErrorCode[];
