// HUB-FR-43 · CHAT-AC-31 · lỗi có mã theo `CHAT_API_ERRORS` (contract chat, plan §4) + `CHAT_COMMAND_ERRORS` (H2a C1,
// HUB-FR-14) + `CHAT_ROUTING_ERRORS` (H2b, HUB-FR-91/94) + `CHAT_ATTACHMENT_ERRORS` (H2c, HUB-FR-44) + `HUB_ADMIN_ERRORS`
// (H3b, HUB-FR-78 — API quản trị, không thuộc contract chat). Status lấy từ contract (một nguồn).
import {
  CHAT_API_ERRORS,
  CHAT_ATTACHMENT_ERRORS,
  CHAT_COMMAND_ERRORS,
  CHAT_ROOM_AGENT_ERRORS,
  CHAT_ROOM_ERRORS,
  CHAT_ROUTING_ERRORS,
  type ChatAttachmentErrorCode,
  type ChatCommandErrorCode,
  type ChatErrorCode,
  type ChatRoomAgentErrorCode,
  type ChatRoomErrorCode,
  type ChatRoutingErrorCode,
  type ErrorResponse,
} from "@ai/contracts/chat";
import { HUB_ADMIN_ERRORS, type HubAdminErrorCode } from "@ai/contracts/hub-admin";
import { STUDIO_ERRORS, type StudioErrorCode } from "@ai/contracts/studio";
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

  /** H2b P9: header kèm phản hồi lỗi (vd `Retry-After` của 429); `app.onError` chép ra response. Gán qua `appError`. */
  headers?: Readonly<Record<string, string>>;
}

/**
 * Mã HTTP Hub trả: client chat C1 + lệnh `/` (H2a, hằng riêng — Q3) + định tuyến `@`/giới hạn run (H2b, P2) + file (H2c,
 * P2) + API quản trị `/agent-grants*`, `/runs/:id/trace` (H3b plan §2.1).
 */
export type HubErrorCode =
  | ChatErrorCode
  | ChatCommandErrorCode
  | ChatRoutingErrorCode
  | ChatAttachmentErrorCode
  | ChatRoomErrorCode
  | ChatRoomAgentErrorCode
  | HubAdminErrorCode
  | StudioErrorCode;
const HUB_ERRORS: Record<HubErrorCode, ContentfulStatusCode> = {
  ...CHAT_API_ERRORS,
  ...CHAT_COMMAND_ERRORS,
  ...CHAT_ROUTING_ERRORS,
  ...CHAT_ATTACHMENT_ERRORS,
  ...CHAT_ROOM_ERRORS,
  ...CHAT_ROOM_AGENT_ERRORS,
  ...HUB_ADMIN_ERRORS,
  ...STUDIO_ERRORS,
};

/** Message tiếng Anh cố định theo mã; client dịch theo `code`. Không chứa dữ liệu người dùng (plan-errors H2a §1). */
export const ERROR_MESSAGES: Record<HubErrorCode, string> = {
  VALIDATION_ERROR: "Invalid request",
  AUTH_EXPIRED: "Session expired",
  NOT_FOUND: "Not found",
  FLOW_BUSY: "Flow is busy",
  EVENTS_EXPIRED: "Run events have expired",
  INTERNAL_ERROR: "Internal server error",
  CMD_NOT_FOUND: "Command not found",
  CMD_MISSING_ARG: "Missing or invalid command argument",
  AGENT_NOT_FOUND: "Agent not found",
  TOO_MANY_RUNS: "Too many running requests",
  ATTACHMENT_NOT_FOUND: "Attachment not found",
  ATTACHMENT_QUOTA_EXCEEDED: "Storage quota exceeded",
  ATTACHMENT_TOO_LARGE: "File too large",
  ATTACHMENT_TYPE_NOT_ALLOWED: "File type not allowed",
  ROOM_NOT_FOUND: "Room not found",
  USER_NOT_FOUND: "User not found",
  NOT_ROOM_OWNER: "Only the room owner can do this",
  DM_IMMUTABLE: "Direct messages cannot be changed",
  ROOM_FULL: "Room is full",
  OWNER_MUST_TRANSFER: "Transfer ownership before leaving",
  GROUP_NOT_HIDEABLE: "Groups cannot be hidden",
  DM_SELF: "Cannot message yourself",
  NOT_RUN_CALLER: "Only the person who asked the agent can reply",
  FORBIDDEN: "Forbidden",
  TENANT_REQUIRED: "tenant_id is required",
  INVALID_REFERENCE: "Invalid reference",
  NOT_ENTITLED: "Not entitled",
  AGENT_NOT_GRANTABLE: "Agent cannot be granted",
  VERSION_CONFLICT: "Version conflict",
  KEY_TAKEN: "Key already taken",
  BASH_ACK_REQUIRED: "Bash tool requires acknowledgement",
  AGENT_IN_USE_AS_ORCHESTRATOR: "Agent is in use as Orchestrator",
  AGENT_HAS_HISTORY: "Agent has run history",
  AGENT_HAS_ACCESS: "Agent has access grants",
  AGENT_NOT_ORCHESTRATABLE: "Agent cannot be Orchestrator",
  ORCHESTRATOR_EXISTS: "Orchestrator already exists for tenant",
  ORCHESTRATOR_DEFAULT_PROTECTED: "Default Orchestrator cannot be deleted",
  TENANT_INACTIVE: "Tenant is inactive",
};

export function appError(
  code: HubErrorCode,
  details?: unknown,
  headers?: Readonly<Record<string, string>>,
): AppError {
  const err = new AppError(code, HUB_ERRORS[code], ERROR_MESSAGES[code], details);
  if (headers) err.headers = headers;
  return err;
}

export function isAppError(err: unknown, code?: HubErrorCode): err is AppError {
  return err instanceof AppError && (code === undefined || err.code === code);
}

/** Không thêm key `details` khi vắng, để body khớp tuyệt đối `{error:{code,message}}`. */
export function toErrorBody(code: string, message: string, details?: unknown): ErrorResponse {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

/** Lỗi bất kỳ → status + body (+ header của `AppError`). Lỗi lạ → 500 INTERNAL_ERROR (người gọi log riêng, không lộ message). */
export function mapError(err: unknown): {
  status: ContentfulStatusCode;
  body: ErrorResponse;
  headers?: Readonly<Record<string, string>>;
} {
  if (err instanceof AppError) {
    const body = toErrorBody(err.code, err.message, err.details);
    return { status: err.status, body, ...(err.headers && { headers: err.headers }) };
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
